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

const normalizeSearch = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '');

const appointmentMatchesQuery = (appointment: any, query: string) => {
	if (!query) return true;
	const haystack = [
		appointment.patients?.full_name,
		appointment.patients?.phone_e164,
		appointment.patients?.dni,
		appointment.patients?.email,
		appointment.service_name_snapshot,
		appointment.professional_name_snapshot,
		appointment.internal_note
	]
		.map((value) => normalizeSearch(String(value ?? '')))
		.join(' ');
	return haystack.includes(query);
};

export const load: PageServerLoad = async ({ locals, fetch, cookies, url }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			date: today(),
			selectedProfessionalId: '',
			selectedStatus: '',
			selectedServiceId: '',
			selectedQuery: '',
			selectedPatientId: '',
			searchApplied: false,
			appointments: [],
			stats: APPOINTMENT_STATUSES.map((status) => ({ status, count: 0 })),
			totalAppointments: 0,
			professionals: [],
			services: [],
			serviceProfessionalIds: {},
			patients: [],
			demo: true
		};
	}

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	if (business.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	const date = url.searchParams.get('date') ?? todayForTimezone(business.business.timezone);
	const professionalId = url.searchParams.get('professional_id') ?? '';
	const status = url.searchParams.get('status') ?? '';
	const serviceId = url.searchParams.get('service_id') ?? '';
	const query = String(url.searchParams.get('q') ?? '').trim();
	const patientId = url.searchParams.get('patient_id') ?? '';
	const normalizedQuery = normalizeSearch(query);
	const searchApplied =
		url.searchParams.has('date') ||
		Boolean(professionalId || status || serviceId || normalizedQuery || patientId);
	const dayStart = zonedDateTimeToUtc(date, '00:00', business.business.timezone);
	const dayEnd = zonedDateTimeToUtc(date, '23:59', business.business.timezone);

	const { data: dayAppointments, error: appointmentsError } = await supabase
		.from('appointments')
		.select(
			'id, patient_id, service_id, professional_id, starts_at, ends_at, status, source, service_name_snapshot, professional_name_snapshot, internal_note, cancelled_reason, patients(full_name, phone_e164, dni, email)'
		)
		.eq('business_id', business.business.id)
		.gte('starts_at', dayStart.toISOString())
		.lte('starts_at', dayEnd.toISOString())
		.order('starts_at');
	if (appointmentsError) {
		console.error('Error cargando agenda diaria', appointmentsError);
	}

	const filteredAppointments = (dayAppointments ?? []).filter((appointment: any) => {
		if (professionalId && appointment.professional_id !== professionalId) return false;
		if (serviceId && appointment.service_id !== serviceId) return false;
		if (patientId && appointment.patient_id !== patientId) return false;
		if (status && appointment.status !== status) return false;
		if (!appointmentMatchesQuery(appointment, normalizedQuery)) return false;
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
		selectedProfessionalId: professionalId,
		selectedStatus: status,
		selectedServiceId: serviceId,
		selectedQuery: query,
		selectedPatientId: patientId,
		searchApplied,
		appointments: appointments ?? [],
		stats,
		totalAppointments: (dayAppointments ?? []).length,
		professionals: professionals ?? [],
		services: services ?? [],
		serviceProfessionalIds,
		patients: patientRows,
		demo: false
	};
};

export const actions: Actions = {
	create_appointment: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.capabilities.canCreateAppointment) {
			return fail(403, { message: 'No tenés permisos para crear turnos.' });
		}

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
			const created = await createManualAppointment(supabase, {
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

		const form = await request.formData();
		const appointmentId = String(form.get('appointment_id') ?? '').trim();
		const status = String(form.get('status') ?? '').trim();
		const date = String(form.get('date') ?? today()).trim();
		const professionalId = String(form.get('professional_id') ?? '').trim();
		const selectedStatus = String(form.get('selected_status') ?? '').trim();
		const serviceId = String(form.get('service_id') ?? '').trim();
		if (!appointmentId || !isAppointmentStatus(status)) return fail(400, { message: 'Estado inválido.' });
		const canApplyStatus =
			status === 'cancelled'
				? business.capabilities.canCancelAppointment
				: status === 'attended' || status === 'no_show'
					? business.capabilities.canMarkAppointmentAttendance
					: business.capabilities.canEditAppointment;
		if (!canApplyStatus) return fail(403, { message: 'No tenés permisos para modificar turnos.' });

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
