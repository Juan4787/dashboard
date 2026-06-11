// Alta de suscripción push para un turno. El permiso se pidió en el navegador DESPUÉS
// de que el paciente tocó "Recibir recordatorio" (nunca al cargar la página).

import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { loadAppointmentForToken } from '$lib/server/appointment-token';
import {
	isPushConfigured,
	isValidSubscriptionPayload,
	saveAppointmentPushSubscription
} from '$lib/server/push';
import type { RequestHandler } from './$types';

const ACTIVE_STATUSES = ['reserved', 'confirmed', 'reschedule_requested'];

export const POST: RequestHandler = async ({ params, request, fetch }) => {
	if (env.DEMO_MODE === 'true') return json({ ok: true, demo: true });
	if (!isPushConfigured()) {
		return json({ ok: false, message: 'Push no configurado.' }, { status: 503 });
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

	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		return json({ ok: false, message: 'Suscripción inválida.' }, { status: 400 });
	}
	if (!isValidSubscriptionPayload(payload)) {
		return json({ ok: false, message: 'Suscripción inválida.' }, { status: 400 });
	}

	try {
		await saveAppointmentPushSubscription(
			supabase,
			appointment,
			payload,
			request.headers.get('user-agent')
		);
	} catch (error) {
		console.error('Error guardando suscripción push', error);
		return json({ ok: false, message: 'No se pudo activar el recordatorio.' }, { status: 500 });
	}

	return json({ ok: true });
};
