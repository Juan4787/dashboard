// Alta de suscripción push para un turno. El permiso se pidió en el navegador DESPUÉS
// de que el paciente tocó "Recibir recordatorio" (nunca al cargar la página).

import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { loadAppointmentForToken } from '$lib/server/appointment-token';
import {
	getLatestPushTestStatus,
	getPushDeliveryStatus,
	isPushConfigured,
	isValidPushDeliveryId,
	isValidSubscriptionPayload,
	recordPushTestFeedback,
	saveAppointmentPushSubscription,
	sendTestPushNotification
} from '$lib/server/push';
import type { RequestHandler } from './$types';

const ACTIVE_STATUSES = ['reserved', 'confirmed', 'reschedule_requested'];

export const POST: RequestHandler = async ({ params, request, fetch, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	if (env.DEMO_MODE === 'true') return json({ ok: true, demo: true });
	if (!isPushConfigured()) {
		return json(
			{ ok: false, message: 'Las notificaciones no están disponibles en este momento.' },
			{ status: 503 }
		);
	}

	const { appointment, supabase } = await loadAppointmentForToken(fetch, params.token);
	if (
		!appointment ||
		!supabase ||
		appointment.is_past ||
		!ACTIVE_STATUSES.includes(appointment.status)
	) {
		return json({ ok: false, message: 'El turno no admite recordatorios.' }, { status: 404 });
	}

	let raw: unknown;
	try {
		const body = await request.text();
		if (body.length > 16_384) throw new Error('BODY_TOO_LARGE');
		raw = JSON.parse(body);
	} catch {
		return json(
			{ ok: false, message: 'No pudimos leer la configuración del navegador.' },
			{ status: 400 }
		);
	}
	const wrapped = raw as { subscription?: unknown; test?: unknown } | null;
	const payload = wrapped?.subscription ?? raw;
	// Compatibilidad con clientes anteriores: el body crudo sólo guarda. La prueba
	// inmediata se dispara únicamente con el contrato nuevo `{ subscription, test }`.
	const requestTest = Boolean(wrapped?.subscription && wrapped.test === true);
	if (!isValidSubscriptionPayload(payload)) {
		return json(
			{ ok: false, message: 'El navegador no entregó una configuración de notificaciones válida.' },
			{ status: 400 }
		);
	}

	try {
		const saved = await saveAppointmentPushSubscription(
			supabase,
			appointment,
			payload,
			request.headers.get('user-agent')
		);
		if (requestTest) {
			const testResult = await sendTestPushNotification(supabase, {
				appointment,
				subscription: {
					id: saved.id,
					endpoint: payload.endpoint,
					p256dh: payload.keys.p256dh,
					auth: payload.keys.auth
				}
			});
			if (!testResult.accepted) {
				return json(
					{
						ok: false,
						code: testResult.gone ? 'subscription_expired' : 'test_not_accepted',
						message: testResult.gone
							? 'La suscripción del navegador venció. Volvé a activar las notificaciones.'
							: 'No pudimos enviar la notificación de prueba. Revisá tu conexión y volvé a intentar.'
					},
					{ status: testResult.gone ? 410 : 502 }
				);
			}
			const delivery = testResult.deliveryId
				? await getPushDeliveryStatus(supabase, {
						appointmentId: appointment.id,
						deliveryId: testResult.deliveryId
					})
				: null;
			return json({ ok: true, delivery, verificationAvailable: Boolean(delivery) });
		}

		const delivery = await getLatestPushTestStatus(supabase, { subscriptionId: saved.id });
		return json({ ok: true, delivery, verificationAvailable: Boolean(delivery) });
	} catch (error) {
		console.error('Error guardando suscripción push', error);
		return json(
			{
				ok: false,
				message: 'No pudimos activar las notificaciones. Revisá tu conexión y volvé a intentar.'
			},
			{ status: 500 }
		);
	}
};

export const GET: RequestHandler = async ({ params, url, fetch, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const deliveryId = (url.searchParams.get('delivery_id') ?? '').trim();
	if (!isValidPushDeliveryId(deliveryId)) {
		return json({ ok: false, message: 'No pudimos verificar la prueba.' }, { status: 400 });
	}
	const { appointment, supabase } = await loadAppointmentForToken(fetch, params.token);
	if (!appointment || !supabase) {
		return json({ ok: false, message: 'El turno no está disponible.' }, { status: 404 });
	}
	try {
		const delivery = await getPushDeliveryStatus(supabase, {
			appointmentId: appointment.id,
			deliveryId
		});
		if (!delivery) {
			return json({ ok: false, message: 'No pudimos verificar la prueba.' }, { status: 404 });
		}
		return json({ ok: true, delivery });
	} catch (error) {
		console.error('Error consultando prueba push', error);
		return json(
			{ ok: false, message: 'No pudimos comprobar la notificación todavía.' },
			{ status: 500 }
		);
	}
};

export const PATCH: RequestHandler = async ({ params, request, fetch, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	let raw: unknown;
	try {
		const body = await request.text();
		if (body.length > 4096) throw new Error('BODY_TOO_LARGE');
		raw = JSON.parse(body);
	} catch {
		return json({ ok: false, message: 'No pudimos guardar tu respuesta.' }, { status: 400 });
	}
	const input = raw as { deliveryId?: unknown; visible?: unknown } | null;
	const deliveryId = typeof input?.deliveryId === 'string' ? input.deliveryId.trim() : '';
	if (!isValidPushDeliveryId(deliveryId) || typeof input?.visible !== 'boolean') {
		return json({ ok: false, message: 'No pudimos guardar tu respuesta.' }, { status: 400 });
	}

	const { appointment, supabase } = await loadAppointmentForToken(fetch, params.token);
	if (!appointment || !supabase) {
		return json({ ok: false, message: 'El turno no está disponible.' }, { status: 404 });
	}
	try {
		const updated = await recordPushTestFeedback(supabase, {
			appointmentId: appointment.id,
			deliveryId,
			visible: input.visible
		});
		if (!updated) {
			return json({ ok: false, message: 'No pudimos guardar tu respuesta.' }, { status: 404 });
		}
		const delivery = await getPushDeliveryStatus(supabase, {
			appointmentId: appointment.id,
			deliveryId
		});
		return json({ ok: true, delivery });
	} catch (error) {
		console.error('Error guardando confirmación de prueba push', error);
		return json(
			{ ok: false, message: 'No pudimos guardar tu respuesta. Volvé a intentar.' },
			{ status: 500 }
		);
	}
};
