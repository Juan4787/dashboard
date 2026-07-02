// Recordatorios Web Push (secundarios al calendario; nunca en iOS).
//
// Confiabilidad del envío: claim atómico vía RPC claim_due_push_reminders
// (FOR UPDATE SKIP LOCKED + reclaim a los 10 min si el proceso murió entre claim y
// envío). sent_at se marca SOLO tras envío exitoso: un fallo transitorio reintenta
// en el próximo run en vez de perder el recordatorio.

import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import { writeAuditLog } from './audit';
import { formatInTimeZone } from '$lib/utils/format';
import { addMinutes } from './appointments';
import { publicAppointmentUrl } from './messaging';
import type { PublicAppointmentView } from './public-appointments';

const MAX_FAILURES = 3;

export const getVapidPublicKey = (): string | null =>
	publicEnv.PUBLIC_VAPID_PUBLIC_KEY?.trim() || env.VAPID_PUBLIC_KEY?.trim() || null;

export const isPushConfigured = (): boolean =>
	Boolean(getVapidPublicKey() && env.VAPID_PRIVATE_KEY?.trim());

let vapidConfigured = false;
const ensureVapid = () => {
	if (vapidConfigured) return;
	const publicKey = getVapidPublicKey();
	const privateKey = env.VAPID_PRIVATE_KEY?.trim();
	if (!publicKey || !privateKey) throw new Error('PUSH_NOT_CONFIGURED');
	webpush.setVapidDetails(env.VAPID_SUBJECT?.trim() || 'mailto:soporte@example.com', publicKey, privateKey);
	vapidConfigured = true;
};

export type PushSubscriptionPayload = {
	endpoint: string;
	keys: { p256dh: string; auth: string };
};

export const isValidSubscriptionPayload = (raw: unknown): raw is PushSubscriptionPayload => {
	const candidate = raw as PushSubscriptionPayload | null;
	return Boolean(
		candidate &&
			typeof candidate.endpoint === 'string' &&
			candidate.endpoint.startsWith('https://') &&
			candidate.keys &&
			typeof candidate.keys.p256dh === 'string' &&
			candidate.keys.p256dh.length > 0 &&
			typeof candidate.keys.auth === 'string' &&
			candidate.keys.auth.length > 0
	);
};

// Upsert por (turno, dispositivo): re-suscribirse refresca claves y revive una
// suscripción revocada. El mismo endpoint puede cubrir varios turnos.
export const saveAppointmentPushSubscription = async (
	supabase: SupabaseClient,
	appointment: PublicAppointmentView,
	payload: PushSubscriptionPayload,
	userAgent: string | null
) => {
	const now = new Date().toISOString();
	const { error } = await supabase.from('push_subscriptions').upsert(
		{
			business_id: appointment.business.id,
			appointment_id: appointment.id,
			endpoint: payload.endpoint,
			p256dh: payload.keys.p256dh,
			auth: payload.keys.auth,
			user_agent: userAgent,
			failed_count: 0,
			revoked_at: null,
			updated_at: now
		},
		{ onConflict: 'appointment_id,endpoint' }
	);
	if (error) throw error;

	await writeAuditLog(supabase, {
		businessId: appointment.business.id,
		userId: null,
		action: 'appointment.push_subscribed',
		entityType: 'appointment',
		entityId: appointment.id,
		metadata: { endpoint_host: new URL(payload.endpoint).hostname }
	});
};

// Reprogramación: invalida los avisos pendientes del horario VIEJO y deja que se
// recalculen los de 24h/2h para el NUEVO horario. Limpiar *_sent_at desbloquea el
// reenvío (el job no reenvía si sent_at ya está marcado) y limpiar *_claimed_at
// libera cualquier claim en vuelo; las ventanas se computan en claim_due_push_reminders
// contra el starts_at vivo, así que tras esto apuntan automáticamente a la fecha nueva.
// Requiere cliente service-role (push_subscriptions tiene RLS sin policies). No toca
// suscripciones revocadas (endpoint muerto: no resucita).
export const resetPushRemindersForReschedule = async (
	supabase: SupabaseClient,
	input: { businessId: string; appointmentId: string; now?: Date }
): Promise<number> => {
	const now = (input.now ?? new Date()).toISOString();
	const { data, error } = await supabase
		.from('push_subscriptions')
		.update({
			push_24h_claimed_at: null,
			push_24h_sent_at: null,
			push_2h_claimed_at: null,
			push_2h_sent_at: null,
			updated_at: now
		})
		.eq('business_id', input.businessId)
		.eq('appointment_id', input.appointmentId)
		.is('revoked_at', null)
		.select('id');
	if (error) throw error;
	return (data ?? []).length;
};

// Aviso inmediato de reprogramación: una notificación ya MOSTRADA en el navegador no
// se puede borrar sin enviar otro push. Este aviso sale en el momento con el MISMO tag
// que el recordatorio de 24h, así pisa la notificación vieja (horario viejo) aun en
// service workers sin la lógica de `group`, e informa el horario nuevo. No toca los
// flags sent/claimed: los recordatorios de 24h/2h del nuevo horario siguen su curso.
// Requiere cliente service-role (push_subscriptions tiene RLS sin policies).
export const sendReschedulePushNotice = async (
	supabase: SupabaseClient,
	input: { businessId: string; appointmentId: string; now?: Date }
) => {
	if (!isPushConfigured()) return { configured: false, sent: 0, failed: 0, revoked: 0 };
	ensureVapid();
	const now = input.now ?? new Date();

	const { data: appointment, error: appointmentError } = await supabase
		.from('appointments')
		.select('id, status, starts_at, confirmation_token, businesses!inner(name, timezone)')
		.eq('id', input.appointmentId)
		.eq('business_id', input.businessId)
		.maybeSingle();
	if (appointmentError) throw appointmentError;
	const business = (appointment as any)?.businesses;
	if (
		!appointment ||
		!['reserved', 'confirmed'].includes(String(appointment.status)) ||
		new Date(appointment.starts_at) <= now
	) {
		return { configured: true, sent: 0, failed: 0, revoked: 0 };
	}

	const { data: subscriptions, error: subscriptionsError } = await supabase
		.from('push_subscriptions')
		.select('id, endpoint, p256dh, auth')
		.eq('business_id', input.businessId)
		.eq('appointment_id', input.appointmentId)
		.is('revoked_at', null);
	if (subscriptionsError) throw subscriptionsError;
	if (!subscriptions || subscriptions.length === 0) {
		return { configured: true, sent: 0, failed: 0, revoked: 0 };
	}

	const { dateLabel, timeLabel } = formatInTimeZone(
		String(appointment.starts_at),
		String(business.timezone)
	);
	// Payload neutral (§67), como los recordatorios.
	const payload = JSON.stringify({
		title: `Turno en ${business.name}`,
		body: `Tu turno fue reprogramado para el ${dateLabel} a las ${timeLabel}.`,
		url: publicAppointmentUrl(String(appointment.confirmation_token)),
		tag: `turno-${input.appointmentId}-24h`,
		group: `turno-${input.appointmentId}`
	});

	let sent = 0;
	let failed = 0;
	let revoked = 0;
	for (const subscription of subscriptions) {
		try {
			await webpush.sendNotification(
				{
					endpoint: String(subscription.endpoint),
					keys: { p256dh: String(subscription.p256dh), auth: String(subscription.auth) }
				},
				payload,
				{ TTL: 3600, urgency: 'high' }
			);
			sent += 1;
		} catch (sendError) {
			failed += 1;
			console.error('Error enviando push de reprogramación', sendError);
			try {
				if (isGoneError(sendError)) {
					await revokeEndpoint(supabase, String(subscription.endpoint), now);
					revoked += 1;
				}
			} catch (cleanupError) {
				console.error('Error revocando endpoint tras push de reprogramación', cleanupError);
			}
		}
	}

	if (sent > 0) {
		await writeAuditLog(supabase, {
			businessId: input.businessId,
			userId: null,
			action: 'appointment.push_reschedule_notice',
			entityType: 'appointment',
			entityId: input.appointmentId,
			metadata: { sent, failed }
		});
	}

	return { configured: true, sent, failed, revoked };
};

type ClaimedReminder = {
	subscription_id: string;
	appointment_id: string;
	business_id: string;
	endpoint: string;
	p256dh: string;
	auth: string;
	reminder_kind: '24h' | '2h';
};

// Mismas ventanas que claim_due_push_reminders, evaluadas contra el starts_at VIVO:
// si una reprogramación corrió entre el claim y el envío, el turno puede haber salido
// de la ventana del kind reclamado. Enviar igual consumiría el sent_at con días de
// anticipación y el recordatorio real nunca saldría.
const isWithinReminderWindow = (kind: '24h' | '2h', startsAt: Date, now: Date) =>
	kind === '24h'
		? startsAt > addMinutes(now, 2 * 60) && startsAt <= addMinutes(now, 24 * 60)
		: startsAt > now && startsAt <= addMinutes(now, 2 * 60);

const isGoneError = (error: unknown) => {
	const statusCode = (error as { statusCode?: number })?.statusCode;
	return statusCode === 404 || statusCode === 410;
};

const revokeEndpoint = async (supabase: SupabaseClient, endpoint: string, now: Date) => {
	// El push service dio de baja la suscripción: muere para TODOS los turnos.
	await supabase
		.from('push_subscriptions')
		.update({ revoked_at: now.toISOString(), updated_at: now.toISOString() })
		.eq('endpoint', endpoint)
		.is('revoked_at', null);
};

const releaseClaim = async (
	supabase: SupabaseClient,
	claimed: ClaimedReminder,
	failedCount: number,
	now: Date
) => {
	const updates: Record<string, unknown> = {
		failed_count: failedCount,
		updated_at: now.toISOString(),
		[claimed.reminder_kind === '24h' ? 'push_24h_claimed_at' : 'push_2h_claimed_at']: null
	};
	if (failedCount >= MAX_FAILURES) updates.revoked_at = now.toISOString();
	await supabase.from('push_subscriptions').update(updates).eq('id', claimed.subscription_id);
};

export const sendDuePushReminders = async (
	supabase: SupabaseClient,
	input: { now?: Date; limit?: number } = {}
) => {
	if (!isPushConfigured()) return { configured: false, claimed: 0, sent: 0, failed: 0, revoked: 0 };
	ensureVapid();
	const now = input.now ?? new Date();

	// Limpieza: turnos terminales no necesitan recordatorio; sus suscripciones se revocan.
	let revoked = 0;
	const { data: staleRows } = await supabase
		.from('push_subscriptions')
		.select('id, appointments!inner(status)')
		.is('revoked_at', null)
		.in('appointments.status', ['cancelled', 'attended', 'no_show']);
	const staleIds = (staleRows ?? []).map((row: any) => String(row.id));
	if (staleIds.length > 0) {
		await supabase
			.from('push_subscriptions')
			.update({ revoked_at: now.toISOString(), updated_at: now.toISOString() })
			.in('id', staleIds);
		revoked += staleIds.length;
	}

	const { data: claimedRows, error: claimError } = await supabase.rpc('claim_due_push_reminders', {
		claim_now: now.toISOString(),
		claim_limit: input.limit ?? 50
	});
	if (claimError) throw claimError;

	let sent = 0;
	let failed = 0;

	for (const claimed of (claimedRows ?? []) as ClaimedReminder[]) {
		try {
			// Revalidación con el estado vivo: el claim pudo correr justo antes de una
			// cancelación o reprogramación.
			const { data: appointment, error: appointmentError } = await supabase
				.from('appointments')
				.select(
					'id, status, starts_at, confirmation_token, businesses!inner(name, timezone)'
				)
				.eq('id', claimed.appointment_id)
				.eq('business_id', claimed.business_id)
				.maybeSingle();
			if (appointmentError) throw appointmentError;
			const business = (appointment as any)?.businesses;
			if (
				!appointment ||
				!['reserved', 'confirmed'].includes(String(appointment.status)) ||
				!isWithinReminderWindow(claimed.reminder_kind, new Date(appointment.starts_at), now)
			) {
				await releaseClaim(supabase, claimed, 0, now);
				continue;
			}

			const { dateLabel, timeLabel } = formatInTimeZone(
				String(appointment.starts_at),
				String(business.timezone)
			);
			// Payload neutral (§67): sin servicio, sin datos clínicos. `group` permite al
			// service worker cerrar notificaciones viejas del mismo turno (otro kind).
			const payload = JSON.stringify({
				title: `Turno en ${business.name}`,
				body: `Te recordamos tu turno el ${dateLabel} a las ${timeLabel}.`,
				url: publicAppointmentUrl(String(appointment.confirmation_token)),
				tag: `turno-${claimed.appointment_id}-${claimed.reminder_kind}`,
				group: `turno-${claimed.appointment_id}`
			});

			await webpush.sendNotification(
				{ endpoint: claimed.endpoint, keys: { p256dh: claimed.p256dh, auth: claimed.auth } },
				payload,
				{ TTL: claimed.reminder_kind === '24h' ? 12 * 3600 : 3600, urgency: 'high' }
			);

			await supabase
				.from('push_subscriptions')
				.update({
					[claimed.reminder_kind === '24h' ? 'push_24h_sent_at' : 'push_2h_sent_at']:
						now.toISOString(),
					failed_count: 0,
					updated_at: now.toISOString()
				})
				.eq('id', claimed.subscription_id);

			await writeAuditLog(supabase, {
				businessId: claimed.business_id,
				userId: null,
				action: 'appointment.push_sent',
				entityType: 'appointment',
				entityId: claimed.appointment_id,
				metadata: { reminder_kind: claimed.reminder_kind }
			});
			sent += 1;
		} catch (sendError) {
			failed += 1;
			console.error('Error enviando push de recordatorio', sendError);
			try {
				if (isGoneError(sendError)) {
					await revokeEndpoint(supabase, claimed.endpoint, now);
					revoked += 1;
				} else {
					const { data: current } = await supabase
						.from('push_subscriptions')
						.select('failed_count')
						.eq('id', claimed.subscription_id)
						.maybeSingle();
					await releaseClaim(
						supabase,
						claimed,
						Number(current?.failed_count ?? 0) + 1,
						now
					);
				}
			} catch (cleanupError) {
				console.error('Error liberando claim de push', cleanupError);
			}
		}
	}

	return { configured: true, claimed: claimedRows?.length ?? 0, sent, failed, revoked };
};
