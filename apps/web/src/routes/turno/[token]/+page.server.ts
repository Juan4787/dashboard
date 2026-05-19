import { env } from '$env/dynamic/private';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import {
	applyPublicAppointmentAction,
	getPublicAppointmentMessage,
	getPublicTokenErrorMessage,
	loadPublicAppointmentByToken
} from '$lib/server/public-appointments';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const loadDemoAppointment = (token: string) => ({
	id: 'demo-appointment',
	token,
	status: 'reserved',
	starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
	ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
	service_name_snapshot: 'Consulta',
	professional_name_snapshot: 'Dra. Pérez',
	business: {
		id: 'demo-business',
		name: 'Consultorio demo',
		slug: 'consultorio-demo',
		phone: '351 555 0101',
		address: 'Av. Demo 123',
		logo_url: null,
		timezone: 'America/Argentina/Cordoba',
		is_active: true,
		cancellation_policy: null
	},
	patient_name: 'Paciente demo',
	public_status_label: 'Reservado',
	can_confirm: true,
	can_cancel: true,
	can_request_reschedule: true,
	is_past: false
});

export const load: PageServerLoad = async ({ params, fetch, url }) => {
	if (env.DEMO_MODE === 'true') {
		const appointment = loadDemoAppointment(params.token);
		return {
			appointment,
			message: getPublicAppointmentMessage(appointment as any),
			created: url.searchParams.has('creado'),
			suggestedAction: url.searchParams.get('accion') ?? '',
			demo: true
		};
	}

	try {
		const supabase = await createSupabaseAdminClient('odonto', fetch);
		const appointment = await loadPublicAppointmentByToken(supabase, params.token);
		return {
			appointment,
			message: getPublicAppointmentMessage(appointment),
			created: url.searchParams.has('creado'),
			suggestedAction: url.searchParams.get('accion') ?? '',
			demo: false
		};
	} catch (error) {
		console.error('Error cargando turno publico', error);
		return {
			appointment: null,
			message: 'El enlace no es válido o no está disponible.',
			created: false,
			suggestedAction: '',
			demo: false
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
