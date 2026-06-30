// Sección Recordatorios: turnos próximos SIN cobertura de recordatorio registrada,
// para refuerzo manual por WhatsApp desde recepción.
//
// Criterios de inclusión (ver plan, Fase 8):
// - status reserved/confirmed, dentro de la ventana Hoy/Mañana (TZ del negocio), futuro.
// - sin acción de calendario (not_offered/offered) → "Sin calendario registrado",
//   o reprogramado después de una acción → "Calendario pendiente de actualizar".
// - sin suscripción push FIABLE (cobertura secundaria) y sin dispatch automático
//   activo (pipeline Meta dormida: si algún día se prende, acá no se duplica).
// "offered" NUNCA cuenta como cobertura: solo significa que vio la pantalla.
//
// Fiabilidad del push (ver isReliablyActivePushSubscription): NO alcanza con que la
// fila exista sin revocar. `revoked_at` solo se marca cuando (a) el turno termina,
// (b) un envío devuelve 410/404, o (c) failed_count llega al máximo. Un endpoint
// muerto (permiso revocado / datos del sitio borrados) sigue sin revocar hasta el
// próximo intento de envío. Por eso solo se excluye un turno de la lista manual
// cuando la suscripción está sin revocar Y sin ningún fallo de entrega registrado.
// Sesgo deliberado: sub-excluir (un WhatsApp de más) es inocuo; sobre-excluir deja
// al paciente sin ningún recordatorio. Si el push de 24h falla, failed_count sube y
// el turno reaparece acá a tiempo.

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatInTimeZone } from '$lib/utils/format';
import { publicAppointmentUrl } from './messaging';
import { resolveMapsUrl } from './location';
import { isLikelyPhoneE164 } from './phone';
import type { Business } from './business';

const ACTIVE_DISPATCH_STATUSES = ['scheduled', 'queued', 'sending', 'sent', 'delivered', 'read'];
const UNCOVERED_CALENDAR_STATUSES = new Set(['not_offered', 'offered']);

export type ReminderDay = 'hoy' | 'manana';

export type ReminderCoverage = 'sin_calendario' | 'pendiente_actualizar';

export type ReminderCandidate = {
	appointment_id: string;
	starts_at: string;
	time_label: string;
	status: string;
	service_name: string;
	professional_name: string;
	patient_name: string;
	coverage: ReminderCoverage;
	phone_e164: string | null;
	whatsapp_url: string | null;
	whatsapp_opened_at: string | null;
	whatsapp_marked_sent_at: string | null;
};

// --- Ventanas de día en la zona horaria del negocio -------------------------

const tzOffsetMs = (date: Date, timeZone: string) => {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false
		})
			.formatToParts(date)
			.map((part) => [part.type, part.value])
	);
	const asUtc = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		Number(parts.hour) % 24,
		Number(parts.minute),
		Number(parts.second)
	);
	return asUtc - date.getTime();
};

const localMidnightUtc = (now: Date, timeZone: string, dayOffset: number): Date => {
	const offset = tzOffsetMs(now, timeZone);
	const local = new Date(now.getTime() + offset);
	const midnightAsUtc = Date.UTC(
		local.getUTCFullYear(),
		local.getUTCMonth(),
		local.getUTCDate() + dayOffset,
		0,
		0,
		0
	);
	// El offset puede cambiar entre `now` y la medianoche buscada (DST en otras
	// regiones); se recalcula sobre la aproximación.
	const approx = new Date(midnightAsUtc - offset);
	return new Date(midnightAsUtc - tzOffsetMs(approx, timeZone));
};

export const localDayWindowUtc = (
	now: Date,
	timeZone: string,
	day: ReminderDay
): { start: Date; end: Date } => {
	const offset = day === 'hoy' ? 0 : 1;
	return {
		start: localMidnightUtc(now, timeZone, offset),
		end: localMidnightUtc(now, timeZone, offset + 1)
	};
};

// --- Mensaje manual de WhatsApp (§48: neutral, sin datos clínicos) -----------

export type ReminderMessageInput = {
	patientName: string;
	startsAt: string;
	timezone: string;
	businessName: string;
	address: string | null;
	mapsLink: string | null;
	token: string;
};

export const buildReminderWhatsAppMessage = (input: ReminderMessageInput): string => {
	const { dateLabel, timeLabel } = formatInTimeZone(input.startsAt, input.timezone);
	const lines = [
		`Hola ${input.patientName}. Te recordamos tu turno el ${dateLabel} a las ${timeLabel} en ${input.businessName}.`,
		''
	];
	if (input.address) lines.push(`Dirección: ${input.address}`);
	if (input.mapsLink) lines.push(`Cómo llegar: ${input.mapsLink}`);
	lines.push(`Ver turno: ${publicAppointmentUrl(input.token)}`);
	return lines.join('\n');
};

export const buildWaMeUrl = (phoneE164: string, message: string): string =>
	`https://wa.me/${phoneE164.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;

// --- Mensaje manual de WhatsApp para reprogramación (§48: neutral) -----------

export type RescheduleMessageInput = {
	patientName: string;
	startsAt: string;
	timezone: string;
	businessName: string;
	rescheduleUrl: string;
};

export const buildRescheduleWhatsAppMessage = (input: RescheduleMessageInput): string => {
	const { dateLabel, timeLabel } = formatInTimeZone(input.startsAt, input.timezone);
	return [
		`Hola ${input.patientName}. Reprogramamos tu turno en ${input.businessName}.`,
		`Nueva fecha: ${dateLabel} a las ${timeLabel}.`,
		'',
		`Mirá el detalle actualizado acá: ${input.rescheduleUrl}`
	].join('\n');
};

// --- Clasificación de cobertura (pura, testeable) ----------------------------

export type CoverageInput = {
	calendar_action_status: string;
	calendar_update_required_at: string | null;
	has_active_push: boolean;
	has_active_dispatch: boolean;
};

export const classifyReminderCoverage = (input: CoverageInput): ReminderCoverage | null => {
	if (input.has_active_push || input.has_active_dispatch) return null;
	if (input.calendar_update_required_at) return 'pendiente_actualizar';
	if (UNCOVERED_CALENDAR_STATUSES.has(input.calendar_action_status)) return 'sin_calendario';
	return null;
};

// Detección FIABLE de push activo (pura, testeable). Solo se considera que el turno
// está cubierto por push cuando la suscripción no fue revocada y no acumula ningún
// fallo de entrega: failed_count > 0 significa que el push service ya rechazó algún
// envío, así que no podemos asegurar que el paciente vaya a recibir el recordatorio.
export type PushSubscriptionReliabilityInput = {
	revoked_at: string | null;
	failed_count: number | null;
};

export const isReliablyActivePushSubscription = (
	row: PushSubscriptionReliabilityInput
): boolean => row.revoked_at == null && Number(row.failed_count ?? 0) === 0;

// --- Carga principal ----------------------------------------------------------

export const loadReminderCandidates = async (
	supabase: SupabaseClient,
	business: Pick<Business, 'id' | 'name' | 'timezone' | 'address' | 'maps_url'>,
	options: { day: ReminderDay; now?: Date }
): Promise<ReminderCandidate[]> => {
	const now = options.now ?? new Date();
	const { start, end } = localDayWindowUtc(now, business.timezone, options.day);
	const windowStart = start.getTime() > now.getTime() ? start : now;

	const { data: rows, error } = await supabase
		.from('appointments')
		.select(
			`
			id,
			starts_at,
			status,
			service_name_snapshot,
			professional_name_snapshot,
			confirmation_token,
			calendar_action_status,
			calendar_update_required_at,
			whatsapp_reminder_opened_at,
			whatsapp_reminder_marked_sent_at,
			patients!inner(id, full_name, phone_e164, blocked)
		`
		)
		.eq('business_id', business.id)
		.in('status', ['reserved', 'confirmed'])
		.gte('starts_at', windowStart.toISOString())
		.lt('starts_at', end.toISOString())
		.order('starts_at', { ascending: true });
	if (error) throw error;

	const appointments = rows ?? [];
	if (appointments.length === 0) return [];
	const ids = appointments.map((row: any) => String(row.id));

	const [{ data: pushRows }, { data: dispatchRows }] = await Promise.all([
		supabase
			.from('push_subscriptions')
			.select('appointment_id, revoked_at, failed_count')
			.eq('business_id', business.id)
			.in('appointment_id', ids)
			.is('revoked_at', null),
		supabase
			.from('message_dispatches')
			.select('appointment_id, status')
			.eq('business_id', business.id)
			.eq('type', 'appointment_reminder_24h')
			.in('appointment_id', ids)
	]);

	const pushed = new Set(
		(pushRows ?? [])
			.filter((row: any) => isReliablyActivePushSubscription(row))
			.map((row: any) => String(row.appointment_id))
	);
	const dispatched = new Set(
		(dispatchRows ?? [])
			.filter((row: any) => ACTIVE_DISPATCH_STATUSES.includes(String(row.status)))
			.map((row: any) => String(row.appointment_id))
	);
	const mapsLink = resolveMapsUrl({ address: business.address, maps_url: business.maps_url });

	const candidates: ReminderCandidate[] = [];
	for (const row of appointments as any[]) {
		const patient = row.patients;
		if (patient?.blocked) continue;
		const coverage = classifyReminderCoverage({
			calendar_action_status: String(row.calendar_action_status ?? 'not_offered'),
			calendar_update_required_at: row.calendar_update_required_at ?? null,
			has_active_push: pushed.has(String(row.id)),
			has_active_dispatch: dispatched.has(String(row.id))
		});
		if (!coverage) continue;

		// Solo se ofrece el botón con un E.164 plausible: un valor legado malformado
		// generaría un wa.me roto ("Sin teléfono válido" es más honesto).
		const phone =
			patient?.phone_e164 && isLikelyPhoneE164(String(patient.phone_e164))
				? String(patient.phone_e164)
				: null;
		const patientName = String(patient?.full_name ?? 'Paciente');
		const whatsappUrl = phone
			? buildWaMeUrl(
					phone,
					buildReminderWhatsAppMessage({
						patientName,
						startsAt: String(row.starts_at),
						timezone: business.timezone,
						businessName: business.name,
						address: business.address,
						mapsLink,
						token: String(row.confirmation_token)
					})
				)
			: null;

		candidates.push({
			appointment_id: String(row.id),
			starts_at: String(row.starts_at),
			time_label: formatInTimeZone(String(row.starts_at), business.timezone).timeLabel,
			status: String(row.status),
			service_name: String(row.service_name_snapshot),
			professional_name: String(row.professional_name_snapshot),
			patient_name: patientName,
			coverage,
			phone_e164: phone,
			whatsapp_url: whatsappUrl,
			whatsapp_opened_at: row.whatsapp_reminder_opened_at ?? null,
			whatsapp_marked_sent_at: row.whatsapp_reminder_marked_sent_at ?? null
		});
	}
	return candidates;
};

// Count barato para el aviso en Agenda (aproximado: no descuenta push/dispatches,
// que son la excepción; el número exacto vive en la sección Recordatorios).
export const countTomorrowUncovered = async (
	supabase: SupabaseClient,
	business: Pick<Business, 'id' | 'timezone'>,
	now = new Date()
): Promise<number> => {
	const { start, end } = localDayWindowUtc(now, business.timezone, 'manana');
	const { count, error } = await supabase
		.from('appointments')
		.select('id', { count: 'exact', head: true })
		.eq('business_id', business.id)
		.in('status', ['reserved', 'confirmed'])
		.or('calendar_action_status.in.(not_offered,offered),calendar_update_required_at.not.is.null')
		.gte('starts_at', start.toISOString())
		.lt('starts_at', end.toISOString());
	if (error) throw error;
	return count ?? 0;
};
