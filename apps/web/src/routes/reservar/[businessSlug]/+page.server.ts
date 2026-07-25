import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import { resolveMapsUrl } from '$lib/server/location';
import {
	isValidPatientFullName,
	normalizePatientFullName,
	PATIENT_FULL_NAME_ERROR_MESSAGE
} from '$lib/utils/patient-name';
import {
	createPublicBooking,
	getPublicBookingCdnCacheControl,
	getPublicBookingErrorMessage,
	loadPublicBookingState,
	publicHash,
	verifyTurnstileIfConfigured
} from '$lib/server/public-booking';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const valuesFromForm = (form: FormData) => Object.fromEntries(form.entries());

// OJO performance: este load NUNCA debe leer el parámetro `slot`. SvelteKit
// trackea los search params accedidos: al no leerlo, elegir horario no re-ejecuta
// el load (la página lo resuelve client-side desde page.url) y es instantáneo.
export const load: PageServerLoad = async ({ params, fetch, url, setHeaders }) => {
	const requestedProfessionalIds = [
		...new Set(
			url.searchParams
				.getAll('professional_ids')
				.flatMap((value) => value.split(','))
				.map((value) => value.trim())
				.filter(Boolean)
		)
	];
	const bookingMode: 'individual' | 'joint' =
		url.searchParams.get('booking_mode') === 'joint' || requestedProfessionalIds.length > 1
			? 'joint'
			: 'individual';
	const selected = {
		serviceId: url.searchParams.get('service_id') ?? '',
		bookingMode,
		professionalId:
			bookingMode === 'individual' ? (url.searchParams.get('professional_id') ?? '') : '',
		professionalIds: bookingMode === 'joint' ? requestedProfessionalIds : [],
		date: url.searchParams.get('date') ?? ''
	};
	// El navegador no conserva datos; Netlify sí puede servirlos desde su caché
	// durable. Los pasos con horarios usan TTL muy corto y la creación del turno
	// siempre revalida la disponibilidad viva antes de guardar.
	setHeaders({
		'cache-control': 'no-store',
		'netlify-cdn-cache-control': getPublicBookingCdnCacheControl(selected)
	});

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
			selected,
			mapsLink: resolveMapsUrl({ address: 'Av. Demo 123' }),
			turnstileSiteKey: null,
			demo: true
		};
	}

	try {
		const supabase = await createSupabaseAdminClient('odonto', fetch);
		const state = await loadPublicBookingState(supabase, {
			slug: params.businessSlug,
			serviceId: selected.serviceId,
			professionalId: selected.professionalId,
			professionalIds: selected.professionalIds,
			bookingMode: selected.bookingMode,
			date: selected.date
		});

		if (state.business && params.businessSlug !== state.business.id) {
			throw redirect(302, `/reservar/${state.business.id}${url.search}`);
		}

		return {
			state,
			selected,
			mapsLink: state.business
				? resolveMapsUrl({ address: state.business.address, maps_url: state.business.maps_url })
				: null,
			turnstileSiteKey: publicEnv.PUBLIC_TURNSTILE_SITE_KEY ?? null,
			demo: false
		};
	} catch (error: any) {
		if (error?.status && error?.location) throw error;
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
			selected: {
				serviceId: '',
				bookingMode: 'individual',
				professionalId: '',
				professionalIds: [],
				date: ''
			},
			mapsLink: null,
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
		const requestedProfessionalIds = [
			...new Set(
				[
					...form.getAll('professional_ids').flatMap((value) => String(value).split(',')),
					String(form.get('professional_id') ?? '')
				]
					.map((value) => value.trim())
					.filter(Boolean)
			)
		];
		const bookingMode =
			String(form.get('booking_mode') ?? '').trim() === 'joint' ||
			requestedProfessionalIds.length > 1
				? 'joint'
				: 'individual';
		const professionalIds =
			bookingMode === 'joint' ? requestedProfessionalIds : requestedProfessionalIds.slice(0, 1);
		const professionalId = professionalIds[0] ?? '';
		const slotStartsAt = String(form.get('slot_starts_at') ?? '').trim();
		const patientName = normalizePatientFullName(String(form.get('patient_name') ?? ''));
		const patientPhone = String(form.get('patient_phone') ?? '').trim();
		const patientEmail = String(form.get('patient_email') ?? '').trim();
		const note = String(form.get('note') ?? '').trim();
		const turnstileToken = String(form.get('cf-turnstile-response') ?? '').trim();
		const userAgent = request.headers.get('user-agent') ?? null;
		const ip = getClientAddress();

		if (!serviceId || !slotStartsAt) {
			return fail(400, {
				message:
					'Falta el procedimiento o el horario. Volvé al inicio de la reserva, completá todos los pasos y elegí una de las opciones mostradas.',
				values: valuesFromForm(form)
			});
		}
		if (bookingMode === 'joint' && professionalIds.length < 2) {
			return fail(400, {
				message:
					'Para reservar con un equipo, seleccioná por lo menos dos profesionales diferentes y buscá nuevamente los días disponibles.',
				values: valuesFromForm(form)
			});
		}
		if (bookingMode === 'individual' && !professionalId) {
			return fail(400, {
				message:
					'Falta elegir el profesional. Volvé al segundo paso, seleccioná quién realizará el procedimiento y elegí nuevamente el horario.',
				values: valuesFromForm(form)
			});
		}
		if (!isValidPatientFullName(patientName)) {
			return fail(400, {
				message: PATIENT_FULL_NAME_ERROR_MESSAGE,
				values: { ...valuesFromForm(form), patient_name: patientName }
			});
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
				professionalIds,
				bookingMode,
				slotStartsAt,
				patientName,
				patientPhone,
				patientEmail,
				note,
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
