import { env } from '$env/dynamic/private';
import { demoBusinessContext } from '$lib/server/business';
import { getAvailabilitySlots } from '$lib/server/availability';
import {
	getHumanAppointmentErrorMessage,
	isAppointmentStatus,
	rescheduleAppointment,
	updateAppointmentStatus,
	updateProfessionalAppointmentStatus
} from '$lib/server/appointments';
import { getOdontoContext } from '$lib/server/odonto-context';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const localDateFor = (isoDate: string, timeZone: string) => {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	const parts = Object.fromEntries(formatter.formatToParts(new Date(isoDate)).map((part) => [part.type, part.value]));
	return `${parts.year}-${parts.month}-${parts.day}`;
};

const canUseProfessionalStatusAction = (
	role: string,
	status: string
): status is 'attended' | 'no_show' =>
	role === 'professional' && (status === 'attended' || status === 'no_show');

export const load: PageServerLoad = async ({ params, locals, fetch, cookies, url }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			appointment: null,
			auditLogs: [],
			userLabels: {},
			reprogramDate: new Date().toISOString().slice(0, 10),
			reprogramSlots: [],
			fromDate: '',
			demo: true
		};
	}

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	const { data, error } = await supabase
		.from('appointments')
		.select(
			'id, business_id, patient_id, service_id, professional_id, starts_at, ends_at, blocking_starts_at, blocking_ends_at, status, source, service_name_snapshot, professional_name_snapshot, duration_minutes_snapshot, buffer_before_minutes_snapshot, buffer_after_minutes_snapshot, reminder_due_at, confirmed_at, cancelled_at, cancelled_reason, reschedule_requested_at, attended_at, no_show_at, internal_note, created_by_user_id, updated_by_user_id, cancelled_by_user_id, created_at, updated_at, patients(id, full_name, phone_e164, email, blocked)'
		)
		.eq('business_id', business.business.id)
		.eq('id', params.appointmentId)
		.maybeSingle();

	if (error) {
		console.error('Error cargando turno', error);
		throw kitError(500, 'No se pudo cargar el turno');
	}
	if (!data) throw kitError(404, 'Turno no encontrado o sin permiso');

	const reprogramDate =
		url.searchParams.get('reprogram_date') ?? localDateFor(data.starts_at, business.business.timezone);
	const fromDate = url.searchParams.get('from_date') ?? localDateFor(data.starts_at, business.business.timezone);

	const [auditResult, usersResult, reprogramSlots] = await Promise.all([
		supabase
			.from('audit_logs')
			.select('id, user_id, action, entity_type, entity_id, metadata, created_at')
			.eq('business_id', business.business.id)
			.eq('entity_type', 'appointment')
			.eq('entity_id', params.appointmentId)
			.order('created_at', { ascending: false }),
		supabase.rpc('list_business_users', { target_business_id: business.business.id }),
		business.canOperate && !['cancelled', 'attended', 'no_show'].includes(data.status)
			? getAvailabilitySlots(supabase, {
					business: business.business,
					serviceId: data.service_id,
					professionalId: data.professional_id,
					fromDate: reprogramDate,
					toDate: reprogramDate,
					publicOnly: false,
					excludeAppointmentId: data.id
				})
			: Promise.resolve([])
	]);

	if (auditResult.error) console.error('Error cargando auditoria del turno', auditResult.error);
	if (usersResult.error) console.error('Error cargando usuarios para auditoria', usersResult.error);

	const userLabels = Object.fromEntries(
		(usersResult.data ?? []).map((user: any) => [String(user.user_id), user.email ?? String(user.user_id).slice(0, 8)])
	);

	return {
		context: business,
		appointment: data,
		auditLogs: auditResult.data ?? [],
		userLabels,
		reprogramDate,
		reprogramSlots,
		fromDate,
		demo: false
	};
};

export const actions: Actions = {
	update_status: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });

		const form = await request.formData();
		const status = String(form.get('status') ?? '').trim();
		if (!isAppointmentStatus(status)) return fail(400, { message: 'Estado inválido.' });

		try {
			if (business.canOperate) {
				await updateAppointmentStatus(supabase, {
					businessId: business.business.id,
					appointmentId: params.appointmentId,
					status,
					userId,
					reason: String(form.get('reason') ?? '').trim() || null
				});
			} else if (canUseProfessionalStatusAction(business.role, status)) {
				await updateProfessionalAppointmentStatus(supabase, {
					businessId: business.business.id,
					appointmentId: params.appointmentId,
					status
				});
			} else {
				return fail(403, { message: 'No tenés permiso para modificar este turno.' });
			}
		} catch (error: any) {
			console.error('Error actualizando turno', error);
			return fail(400, { message: getHumanAppointmentErrorMessage(error) });
		}

		return { success: true, message: 'Turno actualizado.' };
	},
	reschedule: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permiso para reprogramar turnos.' });

		const form = await request.formData();
		const slotStartsAt = String(form.get('slot_starts_at') ?? '').trim();
		const reprogramDate = String(form.get('reprogram_date') ?? '').trim();
		if (!slotStartsAt || !reprogramDate) return fail(400, { message: 'Elegí un horario disponible.' });

		const { data: appointment, error: loadError } = await supabase
			.from('appointments')
			.select('id, service_id, professional_id, status')
			.eq('business_id', business.business.id)
			.eq('id', params.appointmentId)
			.maybeSingle();
		if (loadError) {
			console.error('Error cargando turno para reprogramar', loadError);
			return fail(500, { message: 'No se pudo cargar el turno.' });
		}
		if (!appointment) return fail(404, { message: 'No se encontró el turno.' });

		const slots = await getAvailabilitySlots(supabase, {
			business: business.business,
			serviceId: appointment.service_id,
			professionalId: appointment.professional_id,
			fromDate: reprogramDate,
			toDate: reprogramDate,
			publicOnly: false,
			excludeAppointmentId: appointment.id
		});
		const slot = slots.find((candidate) => candidate.starts_at === slotStartsAt);
		if (!slot) return fail(409, { message: 'Ese horario ya fue tomado.' });

		try {
			await rescheduleAppointment(supabase, {
				businessId: business.business.id,
				appointmentId: params.appointmentId,
				userId,
				startsAt: new Date(slot.starts_at)
			});
		} catch (error: any) {
			console.error('Error reprogramando turno', error);
			return fail(400, { message: getHumanAppointmentErrorMessage(error) });
		}

		throw redirect(303, `/odonto/turnos/${params.appointmentId}?from_date=${slot.date}&reprogram_date=${slot.date}`);
	}
};
