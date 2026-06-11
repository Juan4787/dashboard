import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import {
	applyPublicAppointmentAction,
	demoPublicAppointment,
	getPublicAppointmentMessage,
	getPublicTokenErrorMessage,
	loadPublicAppointmentByToken,
	type PublicAppointmentView
} from '$lib/server/public-appointments';
import { markCalendarOffered } from '$lib/server/calendar-tracking';
import { classifyUserAgent, isLikelyBotUserAgent } from '$lib/device';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const SOON_WINDOW_MS = 2 * 60 * 60 * 1000;

const isStartingSoon = (appointment: PublicAppointmentView, now: Date) => {
	const remaining = new Date(appointment.starts_at).getTime() - now.getTime();
	return remaining > 0 && remaining <= SOON_WINDOW_MS;
};

export const load: PageServerLoad = async ({ params, fetch, url, request, setHeaders }) => {
	// La página expone datos del turno detrás del token: nunca debe quedar cacheada.
	setHeaders({ 'cache-control': 'no-store' });
	const userAgent = request.headers.get('user-agent');
	const device = classifyUserAgent(userAgent);
	const vapidPublicKey = publicEnv.PUBLIC_VAPID_PUBLIC_KEY?.trim() || null;

	if (env.DEMO_MODE === 'true') {
		const appointment = demoPublicAppointment(params.token);
		return {
			appointment,
			message: getPublicAppointmentMessage(appointment),
			created: url.searchParams.has('creado'),
			suggestedAction: url.searchParams.get('accion') ?? '',
			demo: true,
			device,
			isSoon: false,
			vapidPublicKey
		};
	}

	try {
		const supabase = await createSupabaseAdminClient('odonto', fetch);
		const now = new Date();
		const appointment = await loadPublicAppointmentByToken(supabase, params.token, now);
		if (
			appointment &&
			appointment.calendar_action_status === 'not_offered' &&
			!appointment.is_past &&
			appointment.status !== 'cancelled' &&
			!isLikelyBotUserAgent(userAgent)
		) {
			// Best-effort: los previews de WhatsApp/Telegram quedan filtrados por UA.
			await markCalendarOffered(supabase, appointment, now);
		}
		return {
			appointment,
			message: getPublicAppointmentMessage(appointment),
			created: url.searchParams.has('creado'),
			suggestedAction: url.searchParams.get('accion') ?? '',
			demo: false,
			device,
			isSoon: appointment ? isStartingSoon(appointment, now) : false,
			vapidPublicKey
		};
	} catch (error) {
		console.error('Error cargando turno publico', error);
		return {
			appointment: null,
			message: 'El enlace no es válido o no está disponible.',
			created: false,
			suggestedAction: '',
			demo: false,
			device,
			isSoon: false,
			vapidPublicKey
		};
	}
};

export const actions: Actions = {
	confirm: async ({ params, fetch, request, getClientAddress }) => {
		if (env.DEMO_MODE === 'true') return { success: true, message: 'Turno confirmado.' };
		try {
			const supabase = await createSupabaseAdminClient('odonto', fetch);
			await applyPublicAppointmentAction(supabase, {
				token: params.token,
				action: 'confirm',
				ip: getClientAddress(),
				userAgent: request.headers.get('user-agent')
			});
			return { success: true, message: 'Turno confirmado.' };
		} catch (error) {
			console.error('Error confirmando turno publico', error);
			return fail(400, { message: getPublicTokenErrorMessage(error) });
		}
	},
	cancel: async ({ params, fetch, request, getClientAddress }) => {
		if (env.DEMO_MODE === 'true') return { success: true, message: 'Turno cancelado.' };
		const form = await request.formData();
		if (form.get('confirm_cancel') !== 'true') {
			return fail(400, { message: 'Confirmá que querés cancelar el turno.' });
		}
		try {
			const supabase = await createSupabaseAdminClient('odonto', fetch);
			await applyPublicAppointmentAction(supabase, {
				token: params.token,
				action: 'cancel',
				note: String(form.get('note') ?? '').trim() || null,
				ip: getClientAddress(),
				userAgent: request.headers.get('user-agent')
			});
			return { success: true, message: 'Turno cancelado.' };
		} catch (error) {
			console.error('Error cancelando turno publico', error);
			return fail(400, { message: getPublicTokenErrorMessage(error) });
		}
	},
	request_reschedule: async ({ params, fetch, request, getClientAddress }) => {
		if (env.DEMO_MODE === 'true') return { success: true, message: 'Pedido de reprogramación recibido.' };
		const form = await request.formData();
		try {
			const supabase = await createSupabaseAdminClient('odonto', fetch);
			await applyPublicAppointmentAction(supabase, {
				token: params.token,
				action: 'reschedule',
				note: String(form.get('note') ?? '').trim() || null,
				ip: getClientAddress(),
				userAgent: request.headers.get('user-agent')
			});
			return { success: true, message: 'Pedido de reprogramación recibido.' };
		} catch (error) {
			console.error('Error solicitando reprogramacion publica', error);
			return fail(400, { message: getPublicTokenErrorMessage(error) });
		}
	}
};
