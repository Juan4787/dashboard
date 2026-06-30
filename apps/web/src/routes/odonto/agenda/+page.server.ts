import { env } from '$env/dynamic/private';
import { demoBusinessContext } from '$lib/server/business';
import { getAvailabilitySlots, zonedDateTimeToUtc } from '$lib/server/availability';
import {
	APPOINTMENT_STATUSES,
	createManualAppointment,
	getHumanAppointmentErrorMessage,
	isAppointmentStatus,
	updateAppointmentStatus
} from '$lib/server/appointments';
import { getOdontoContext } from '$lib/server/odonto-context';
import { countTomorrowUncovered } from '$lib/server/reminders';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const today = () => new Date().toISOString().slice(0, 10);

const todayForTimezone = (timeZone: string) => {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		})
			.formatToParts(new Date())
			.map((part) => [part.type, part.value])
	);
	return `${parts.year}-${parts.month}-${parts.day}`;
};

const APPOINTMENT_COLUMNS =
	'id, patient_id, service_id, professional_id, starts_at, ends_at, status, source, service_name_snapshot, professional_name_snapshot, internal_note, cancelled_reason, patients(full_name, phone_e164, dni, email)';

// Tope por grupo (próximos/anteriores) al buscar con "Cualquier día".
const ANY_DAY_LIMIT = 100;

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export const load: PageServerLoad = async ({ locals, fetch, cookies, url }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			date: today(),
			anyDay: false,
			anyDayLimited: false,
			selectedProfessionalId: '',
			selectedStatus: '',
			selectedServiceId: '',
			selectedPatientId: '',
			searchApplied: false,
			appointments: [],
			stats: APPOINTMENT_STATUSES.map((status) => ({ status, count: 0 })),
			totalAppointments: 0,
			professionals: [],
			services: [],
			serviceProfessionalIds: {},
			patients: [],
			reminderCount: 0,
			demo: true
		};
	}

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	if (business.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	const dateParam = String(url.searchParams.get('date') ?? '').trim();
	const anyDay = dateParam === 'any';
	// Las fechas malformadas caen en "hoy" (antes rompían zonedDateTimeToUtc).
	const date = !anyDay && isIsoDate(dateParam) ? dateParam : todayForTimezone(business.business.timezone);
	const professionalId = url.searchParams.get('professional_id') ?? '';
	const status = url.searchParams.get('status') ?? '';
	const serviceId = url.searchParams.get('service_id') ?? '';
	const patientId = url.searchParams.get('patient_id') ?? '';
	const searchApplied =
		url.searchParams.has('date') || Boolean(professionalId || status || serviceId || patientId);

	let dayAppointments: any[] | null = null;
	let appointmentsError: unknown = null;
	let anyDayLimited = false;
	if (anyDay) {
		// "Cualquier día": los filtros van directo a SQL y se traen dos ventanas
		// acotadas — próximos (ascendente) y anteriores (descendente).
		const baseQuery = () => {
			let builder = supabase
				.from('appointments')
				.select(APPOINTMENT_COLUMNS)
				.eq('business_id', business.business.id);
			if (professionalId) builder = builder.eq('professional_id', professionalId);
			if (serviceId) builder = builder.eq('service_id', serviceId);
			if (patientId) builder = builder.eq('patient_id', patientId);
			if (status) builder = builder.eq('status', status);
			return builder;
		};
		const nowIso = new Date().toISOString();
		const [upcomingResult, pastResult] = await Promise.all([
			baseQuery().gte('starts_at', nowIso).order('starts_at').limit(ANY_DAY_LIMIT),
			baseQuery().lt('starts_at', nowIso).order('starts_at', { ascending: false }).limit(ANY_DAY_LIMIT)
		]);
		appointmentsError = upcomingResult.error ?? pastResult.error;
		const upcoming = upcomingResult.data ?? [];
		const past = pastResult.data ?? [];
		anyDayLimited = upcoming.length === ANY_DAY_LIMIT || past.length === ANY_DAY_LIMIT;
		dayAppointments = [...upcoming, ...past];
	} else {
		const dayStart = zonedDateTimeToUtc(date, '00:00', business.business.timezone);
		const dayEnd = zonedDateTimeToUtc(date, '23:59', business.business.timezone);
		({ data: dayAppointments, error: appointmentsError } = await supabase
			.from('appointments')
			.select(APPOINTMENT_COLUMNS)
			.eq('business_id', business.business.id)
			.gte('starts_at', dayStart.toISOString())
			.lte('starts_at', dayEnd.toISOString())
			.order('starts_at'));
	}
	if (appointmentsError) {
		console.error('Error cargando agenda diaria', appointmentsError);
	}

	const filteredAppointments = (dayAppointments ?? []).filter((appointment: any) => {
		if (professionalId && appointment.professional_id !== professionalId) return false;
		if (serviceId && appointment.service_id !== serviceId) return false;
		if (patientId && appointment.patient_id !== patientId) return false;
		if (status && appointment.status !== status) return false;
		return true;
	});

	const stats = APPOINTMENT_STATUSES.map((appointmentStatus) => ({
		status: appointmentStatus,
		count: filteredAppointments.filter((appointment: any) => appointment.status === appointmentStatus).length
	}));

	const [{ data: appointments }, { data: professionals }, { data: services }, { data: patients }, { data: assignments }] =
		await Promise.all([
			Promise.resolve({ data: filteredAppointments }),
			supabase
				.from('professionals')
				.select('id, name, specialty, is_active')
				.eq('business_id', business.business.id)
				.eq('is_active', true)
				.order('sort_order')
				.order('name'),
			supabase
				.from('services')
				.select('id, name, duration_minutes, is_active')
				.eq('business_id', business.business.id)
				.eq('is_active', true)
				.order('sort_order')
				.order('name'),
			supabase
				.from('patients')
				.select('id, full_name, phone_e164, blocked')
				.eq('business_id', business.business.id)
				.is('archived_at', null)
				.order('updated_at', { ascending: false })
				.limit(250),
			supabase
				.from('professional_services')
				.select('service_id, professional_id')
				.eq('business_id', business.business.id)
		]);

	const serviceProfessionalIds = (assignments ?? []).reduce<Record<string, string[]>>((acc, assignment: any) => {
		const service = String(assignment.service_id);
		acc[service] = acc[service] ?? [];
		acc[service].push(String(assignment.professional_id));
		return acc;
	}, {});

	// Aviso liviano de Recordatorios: count aproximado de mañana sin calendario
	// registrado (el número exacto, con exclusiones de push/dispatch, vive en la sección).
	let reminderCount = 0;
	try {
		reminderCount = await countTomorrowUncovered(supabase, business.business);
	} catch (reminderError) {
		console.error('Error contando recordatorios pendientes', reminderError);
	}

	let patientRows = patients ?? [];
	if (patientId && !patientRows.some((patient: any) => patient.id === patientId)) {
		const { data: selectedPatient } = await supabase
			.from('patients')
			.select('id, full_name, phone_e164, blocked')
			.eq('business_id', business.business.id)
			.eq('id', patientId)
			.maybeSingle();
		if (selectedPatient) patientRows = [selectedPatient, ...patientRows];
	}

	return {
		context: business,
		date,
		anyDay,
		anyDayLimited,
		selectedProfessionalId: professionalId,
		selectedStatus: status,
		selectedServiceId: serviceId,
		selectedPatientId: patientId,
		searchApplied,
		appointments: appointments ?? [],
		stats,
		totalAppointments: (dayAppointments ?? []).length,
		professionals: professionals ?? [],
		services: services ?? [],
		serviceProfessionalIds,
		patients: patientRows,
		reminderCount,
		demo: false
	};
};

export const actions: Actions = {
	create_appointment: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para crear turnos.' });

		const form = await request.formData();
		const serviceId = String(form.get('service_id') ?? '').trim();
		const professionalId = String(form.get('professional_id') ?? '').trim();
		const date = String(form.get('date') ?? '').trim();
		const time = String(form.get('time') ?? '').trim();
		const patientId = String(form.get('patient_id') ?? '').trim();
		const patientName = String(form.get('patient_name') ?? '').trim();
		const patientPhone = String(form.get('patient_phone') ?? '').trim();
		const patientEmail = String(form.get('patient_email') ?? '').trim();
		const startsAt = zonedDateTimeToUtc(date, time, business.business.timezone);

		if (!serviceId || !professionalId || !date || !time) {
			return fail(400, { message: 'Completá servicio, profesional, fecha y hora.', values: Object.fromEntries(form) });
		}
		if (!patientId && !patientName) {
			return fail(400, { message: 'Seleccioná un paciente o cargá uno nuevo.', values: Object.fromEntries(form) });
		}

		const slots = await getAvailabilitySlots(supabase, {
			business: business.business,
			serviceId,
			professionalId,
			fromDate: date,
			toDate: date,
			publicOnly: false
		});
		if (!slots.some((slot) => slot.starts_at === startsAt.toISOString() && slot.professional_id === professionalId)) {
			return fail(409, { message: 'Ese horario no está disponible para ese servicio y profesional.', values: Object.fromEntries(form) });
		}

		try {
			const admin = await createSupabaseAdminClient('odonto', fetch);
			const created = await createManualAppointment(admin, {
				businessId: business.business.id,
				ownerId: userId,
				createdByUserId: userId,
				patientId: patientId || null,
				patientName,
				patientPhone,
				patientEmail,
				serviceId,
				professionalId,
				startsAt,
				internalNote: String(form.get('internal_note') ?? '').trim() || null
			});
			throw redirect(303, `/odonto/turnos/${created.id}`);
		} catch (error: any) {
			if (error?.status && error?.location) throw error;
			console.error('Error creando turno', error);
			const message = getHumanAppointmentErrorMessage(error);
			return fail(error?.code === '23P01' ? 409 : 500, { message, values: Object.fromEntries(form) });
		}
	},
	update_status: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para modificar turnos.' });

		const form = await request.formData();
		const appointmentId = String(form.get('appointment_id') ?? '').trim();
		const status = String(form.get('status') ?? '').trim();
		const date = String(form.get('date') ?? today()).trim();
		const professionalId = String(form.get('professional_id') ?? '').trim();
		const selectedStatus = String(form.get('selected_status') ?? '').trim();
		const serviceId = String(form.get('service_id') ?? '').trim();
		if (!appointmentId || !isAppointmentStatus(status)) return fail(400, { message: 'Estado inválido.' });
		if (status === 'confirmed') {
			return fail(400, { message: 'La confirmación queda reservada al paciente desde su enlace.' });
		}

		try {
			await updateAppointmentStatus(supabase, {
				businessId: business.business.id,
				appointmentId,
				status,
				userId,
				reason: String(form.get('reason') ?? '').trim() || null
			});
		} catch (error: any) {
			console.error('Error actualizando turno', error);
			return fail(400, { message: getHumanAppointmentErrorMessage(error) });
		}

		const params = new URLSearchParams({ date });
		if (professionalId) params.set('professional_id', professionalId);
		if (selectedStatus) params.set('status', selectedStatus);
		if (serviceId) params.set('service_id', serviceId);
		throw redirect(303, `/odonto/agenda?${params.toString()}`);
	}
};
