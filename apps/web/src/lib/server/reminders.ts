// Sección Recordatorios: turnos próximos SIN cobertura de recordatorio registrada,
// para refuerzo manual por WhatsApp desde recepción.
//
// Criterios de inclusión (ver plan, Fase 8):
// - status reserved/confirmed, dentro de la ventana Hoy/Mañana (TZ del negocio), futuro.
// - sin acción de calendario (not_offered/offered) → "Sin recordatorio confirmado",
//   o reprogramado después de una acción → "Calendario pendiente de actualizar".
// - sin notificación confirmada por la persona y sin dispatch automático activo
//   (pipeline Meta dormida: si algún día se prende, acá no se duplica).
// "offered" NUNCA cuenta como cobertura: solo significa que vio la pantalla.
//
// La cobertura push exige una prueba positiva de interacción: "Sí, la recibí" o un
// clic real en la notificación. `displayed_at` es telemetría útil, pero una web no
// puede comprobar si Android bloqueó globalmente las notificaciones del navegador
// después del handoff; tampoco alcanzan el permiso, guardar un endpoint ni recibir
// un 201 del proveedor. Esta cobertura sólo evita el refuerzo manual: una suscripción
// vigente recibe siempre los avisos automáticos. Para los calendarios, la señal
// observable y suficiente es haber iniciado la entrega o la salida hacia la opción
// elegida: no afirmamos ni intentamos comprobar el guardado dentro de una aplicación
// externa.

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatInTimeZone } from '$lib/utils/format';
import { publicAppointmentUrl } from './messaging';
import { resolveMapsUrl } from './location';
import { normalizeArgentineWhatsAppPhone } from './phone';
import type { Business } from './business';
import { isManagedGoogleCalendarEnabled } from './google-calendar';

const ACTIVE_DISPATCH_STATUSES = ['scheduled', 'queued', 'sending', 'sent', 'delivered', 'read'];
const UNCOVERED_CALENDAR_STATUSES = new Set(['not_offered', 'offered']);
const CALENDAR_HANDOFF_STATUSES = new Set([
	'clicked_google',
	'clicked_ics',
	'downloaded_ics',
	'clicked_outlook',
	'clicked_phone_calendar'
]);

export type ReminderDay = 'hoy' | 'manana';

export type ReminderCoverage = 'sin_calendario' | 'pendiente_actualizar';

export type ReminderCandidate = {
	appointment_id: string;
	patient_id: string;
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

export const buildArgentineWaMeUrl = (
	phone: string | null | undefined,
	message: string
): string | null => {
	const phoneE164 = normalizeArgentineWhatsAppPhone(phone);
	return phoneE164 ? buildWaMeUrl(phoneE164, message) : null;
};

export type AppointmentActivationDelivery = {
	publicUrl: string;
	message: string;
	phoneE164: string | null;
	whatsappUrl: string | null;
};

export const buildAppointmentActivationDelivery = (
	phone: string | null | undefined,
	token: string
): AppointmentActivationDelivery => {
	const publicUrl = `${publicAppointmentUrl(token)}?creado=1`;
	const message = [
		'Tu turno quedó reservado.',
		'Activá acá el recordatorio:',
		publicUrl
	].join('\n');
	const phoneE164 = normalizeArgentineWhatsAppPhone(phone);
	return {
		publicUrl,
		message,
		phoneE164,
		whatsappUrl: phoneE164 ? buildWaMeUrl(phoneE164, message) : null
	};
};

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
	has_confirmed_notifications: boolean;
	has_active_dispatch: boolean;
	google_calendar_sync_status?: string | null;
	has_current_google_calendar_event?: boolean;
};

export const classifyReminderCoverage = (input: CoverageInput): ReminderCoverage | null => {
	if (input.has_confirmed_notifications || input.has_active_dispatch) return null;
	if (input.has_current_google_calendar_event) return null;

	// Si existe un vínculo administrado, manda el estado confirmado por Google y
	// no un click histórico. Solo active + la sequence actual es cobertura real.
	if (input.google_calendar_sync_status) {
		if (
			input.google_calendar_sync_status === 'pending_update' ||
			input.google_calendar_sync_status === 'active' ||
			input.calendar_update_required_at
		) {
			return 'pendiente_actualizar';
		}
		return 'sin_calendario';
	}

	// synced_google sin su vínculo verificable es una inconsistencia segura: el
	// turno vuelve a la lista en vez de ocultarse por un indicador huérfano.
	if (input.calendar_action_status === 'synced_google') {
		return input.calendar_update_required_at ? 'pendiente_actualizar' : 'sin_calendario';
	}
	if (input.calendar_update_required_at) return 'pendiente_actualizar';
	if (UNCOVERED_CALENDAR_STATUSES.has(input.calendar_action_status)) return 'sin_calendario';
	// Para Google, iPhone/ICS y Outlook alcanza con que nuestra ruta haya iniciado
	// la entrega del evento o la salida al editor prearmado. Es la última señal que
	// la web puede observar sin afirmar que la persona tocó "Guardar" afuera.
	if (CALENDAR_HANDOFF_STATUSES.has(input.calendar_action_status)) return null;
	// Un estado futuro o inválido nunca debe ocultar silenciosamente un turno.
	return 'sin_calendario';
};

export type ConfirmedPushSubscriptionInput = {
	revoked_at: string | null;
	verified_at: string | null;
};

// `verified_at` conserva una semántica estricta: hubo una confirmación positiva
// ("Sí, la recibí" o clic real en el aviso). No se usa para decidir si el sistema
// debe ENVIAR recordatorios.
export const hasConfirmedPushSubscription = (row: ConfirmedPushSubscriptionInput): boolean =>
	row.revoked_at == null && Boolean(row.verified_at);

// --- Carga principal ----------------------------------------------------------

export const loadReminderCandidates = async (
	supabase: SupabaseClient,
	business: Pick<Business, 'id' | 'name' | 'timezone' | 'address' | 'maps_url'>,
	options: {
		day: ReminderDay;
		now?: Date;
		// push_subscriptions no otorga acceso a usuarios autenticados. El caller
		// debe pasar un cliente service-role, después de validar el negocio y con
		// los appointment_id ya autorizados por la consulta principal.
		pushSubscriptionsSupabase: SupabaseClient;
	}
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
			calendar_sequence,
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
	const managedGoogleCalendarEnabled = isManagedGoogleCalendarEnabled();

	const [pushResult, dispatchResult, googleCalendarResult] = await Promise.all([
		options.pushSubscriptionsSupabase
			.from('push_subscriptions')
			.select('appointment_id, revoked_at, verified_at')
			.eq('business_id', business.id)
			.in('appointment_id', ids)
			.is('revoked_at', null)
			.not('verified_at', 'is', null),
		supabase
			.from('message_dispatches')
			.select('appointment_id, status')
			.eq('business_id', business.id)
			.eq('type', 'appointment_reminder_24h')
			.in('appointment_id', ids),
		managedGoogleCalendarEnabled
			? options.pushSubscriptionsSupabase
					.from('appointment_google_calendar_events')
					.select('appointment_id, sync_status, synced_sequence')
					.eq('business_id', business.id)
					.in('appointment_id', ids)
			: Promise.resolve({ data: [], error: null })
	]);
	if (pushResult.error) throw pushResult.error;
	if (dispatchResult.error) throw dispatchResult.error;
	if (googleCalendarResult.error) throw googleCalendarResult.error;
	const pushRows = pushResult.data;
	const dispatchRows = dispatchResult.data;
	const googleCalendarRows = googleCalendarResult.data;

	const confirmedPushAppointments = new Set(
		(pushRows ?? [])
			.filter((row: any) => hasConfirmedPushSubscription(row))
			.map((row: any) => String(row.appointment_id))
	);
	const dispatched = new Set(
		(dispatchRows ?? [])
			.filter((row: any) => ACTIVE_DISPATCH_STATUSES.includes(String(row.status)))
			.map((row: any) => String(row.appointment_id))
	);
	const googleCalendarByAppointment = new Map(
		(googleCalendarRows ?? []).map((row: any) => [String(row.appointment_id), row])
	);
	const mapsLink = resolveMapsUrl({ address: business.address, maps_url: business.maps_url });

	const candidates: ReminderCandidate[] = [];
	for (const row of appointments as any[]) {
		const patient = row.patients;
		if (patient?.blocked) continue;
		const googleCalendar = googleCalendarByAppointment.get(String(row.id)) as any;
		const coverage = classifyReminderCoverage({
			calendar_action_status: String(row.calendar_action_status ?? 'not_offered'),
			calendar_update_required_at: row.calendar_update_required_at ?? null,
			has_confirmed_notifications: confirmedPushAppointments.has(String(row.id)),
			has_active_dispatch: dispatched.has(String(row.id)),
			google_calendar_sync_status: googleCalendar?.sync_status
				? String(googleCalendar.sync_status)
				: null,
			has_current_google_calendar_event:
				String(googleCalendar?.sync_status ?? '') === 'active' &&
				Number(googleCalendar?.synced_sequence) === Number(row.calendar_sequence ?? 0)
		});
		if (!coverage) continue;

		// WhatsApp recibe siempre el móvil argentino canónico. Se recuperan formatos
		// locales 0/15 y valores legados; si falta información no se inventa un wa.me.
		const phone = normalizeArgentineWhatsAppPhone(patient?.phone_e164);
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
			patient_id: String(patient.id),
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

// El aviso de Agenda usa exactamente los mismos criterios que la sección
// Recordatorios. Así no anuncia turnos que ya tienen recordatorio confirmado.
export const countTomorrowUncovered = async (
	supabase: SupabaseClient,
	business: Pick<Business, 'id' | 'name' | 'timezone' | 'address' | 'maps_url'>,
	options: { now?: Date; pushSubscriptionsSupabase: SupabaseClient }
): Promise<number> =>
	(
		await loadReminderCandidates(supabase, business, {
			day: 'manana',
			now: options.now,
			pushSubscriptionsSupabase: options.pushSubscriptionsSupabase
		})
	).length;
