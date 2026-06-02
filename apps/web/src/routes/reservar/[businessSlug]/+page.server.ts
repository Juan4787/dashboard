import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import {
	createPublicBooking,
	getPublicBookingErrorMessage,
	loadPublicBookingState,
	publicHash,
	verifyTurnstileIfConfigured
} from '$lib/server/public-booking';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const valuesFromForm = (form: FormData) => Object.fromEntries(form.entries());

export const load: PageServerLoad = async ({ params, fetch, url }) => {
	if (env.DEMO_MODE === 'true') {
		return {
			state: {
				business: {
					id: 'demo-business',
					name: 'Consultorio demo',
					slug: 'consultorio-demo',
					phone: '351 555 0101',
					address: 'Av. Demo 123',
					logo_url: null,
					timezone: 'America/Argentina/Cordoba',
					public_booking_enabled: true,
					is_active: true,
					min_booking_notice_minutes: 0,
					max_booking_days_ahead: 30,
					cancellation_policy: null
				},
				services: [
					{ id: 'demo-consulta', name: 'Consulta', description: 'Evaluación inicial.', duration_minutes: 30, price_label: null },
					{ id: 'demo-limpieza', name: 'Limpieza', description: 'Control y limpieza dental.', duration_minutes: 45, price_label: null }
				],
				professionals: [
					{ id: 'demo-dra-perez', name: 'Dra. Pérez', specialty: 'Odontología general', avatar_url: null }
				],
				slots: [],
				days: [],
				issue: null
			},
			selected: {
				serviceId: url.searchParams.get('service_id') ?? '',
				professionalId: url.searchParams.get('professional_id') ?? '',
				date: url.searchParams.get('date') ?? '',
				slot: url.searchParams.get('slot') ?? ''
			},
			turnstileSiteKey: null,
			demo: true
		};
	}

	try {
		const supabase = await createSupabaseAdminClient('odonto', fetch);
		const state = await loadPublicBookingState(supabase, {
			slug: params.businessSlug,
			serviceId: url.searchParams.get('service_id'),
			professionalId: url.searchParams.get('professional_id'),
			date: url.searchParams.get('date')
		});

		return {
			state,
			selected: {
				serviceId: url.searchParams.get('service_id') ?? '',
				professionalId: url.searchParams.get('professional_id') ?? '',
				date: url.searchParams.get('date') ?? '',
				slot: url.searchParams.get('slot') ?? ''
			},
			turnstileSiteKey: publicEnv.PUBLIC_TURNSTILE_SITE_KEY ?? null,
			demo: false
		};
	} catch (error) {
		console.error('Error cargando reserva publica', error);
		return {
			state: {
				business: null,
				services: [],
				professionals: [],
				slots: [],
				days: [],
				issue: 'missing_service_role'
			},
			selected: { serviceId: '', professionalId: '', date: '', slot: '' },
			turnstileSiteKey: null,
			demo: false
		};
	}
};

export const actions: Actions = {
	create_booking: async ({ request, params, fetch, getClientAddress }) => {
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'La demo no crea turnos reales.' });

		const form = await request.formData();
		const serviceId = String(form.get('service_id') ?? '').trim();
		const professionalId = String(form.get('professional_id') ?? '').trim();
		const slotStartsAt = String(form.get('slot_starts_at') ?? '').trim();
		const patientName = String(form.get('patient_name') ?? '').trim();
		const patientPhone = String(form.get('patient_phone') ?? '').trim();
		const patientEmail = String(form.get('patient_email') ?? '').trim();
		const note = String(form.get('note') ?? '').trim();
		const idempotencyKey = String(form.get('idempotency_key') ?? '').trim();
		const turnstileToken = String(form.get('cf-turnstile-response') ?? '').trim();
		const userAgent = request.headers.get('user-agent') ?? null;
		const ip = getClientAddress();

		if (!serviceId || !professionalId || !slotStartsAt) {
			return fail(400, { message: 'Elegí servicio, profesional y horario.', values: valuesFromForm(form) });
		}

		try {
			await verifyTurnstileIfConfigured({
				secret: env.TURNSTILE_SECRET_KEY,
				token: turnstileToken,
				remoteIp: ip,
				fetchImpl: fetch
			});

			const supabase = await createSupabaseAdminClient('odonto', fetch);
			const result = await createPublicBooking(supabase, {
				slug: params.businessSlug,
				serviceId,
				professionalId,
				slotStartsAt,
				patientName,
				patientPhone,
				patientEmail,
				note,
				idempotencyKey,
				ipHash: publicHash(ip),
				userAgent
			});
			throw redirect(303, `/turno/${result.appointment.confirmation_token}?creado=1`);
		} catch (error: any) {
			if (error?.status && error?.location) throw error;
			console.error('Error creando reserva publica', error);
			return fail(400, {
				message: getPublicBookingErrorMessage(error),
				values: valuesFromForm(form)
			});
		}
	}
};
