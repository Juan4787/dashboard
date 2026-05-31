import type { SupabaseClient } from '@supabase/supabase-js';
import { writeAuditLog } from './audit';
import { normalizePhoneE164, normalizePhoneRaw } from './phone';

export const APPOINTMENT_STATUSES = [
	'reserved',
	'confirmed',
	'cancelled',
	'reschedule_requested',
	'attended',
	'no_show'
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_SOURCES = ['public_booking', 'manual', 'whatsapp_bot', 'admin'] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
	reserved: 'Reservado',
	confirmed: 'Confirmado',
	cancelled: 'Cancelado',
	reschedule_requested: 'Quiere reprogramar',
	attended: 'Asistió',
	no_show: 'No asistió'
};

export const APPOINTMENT_SOURCE_LABELS: Record<AppointmentSource, string> = {
	public_booking: 'Reserva pública',
	manual: 'Manual',
	whatsapp_bot: 'WhatsApp',
	admin: 'Admin'
};

export const isAppointmentStatus = (value: string): value is AppointmentStatus =>
	(APPOINTMENT_STATUSES as readonly string[]).includes(value);

export const addMinutes = (date: Date, minutes: number) =>
	new Date(date.getTime() + minutes * 60_000);

const transitionMap: Record<AppointmentStatus, AppointmentStatus[]> = {
	reserved: ['confirmed', 'cancelled', 'reschedule_requested', 'attended', 'no_show'],
	confirmed: ['cancelled', 'reschedule_requested', 'attended', 'no_show'],
	reschedule_requested: ['cancelled', 'attended', 'no_show'],
	cancelled: [],
	attended: [],
	no_show: []
};

export const isTerminalAppointmentStatus = (status: AppointmentStatus) =>
	status === 'cancelled' || status === 'attended' || status === 'no_show';

export const assertCanTransitionAppointment = (input: {
	currentStatus: AppointmentStatus;
	nextStatus: AppointmentStatus;
	startsAt: Date;
	endsAt: Date;
	now?: Date;
}) => {
	const now = input.now ?? new Date();

	if (input.currentStatus === input.nextStatus) {
		throw new Error('APPOINTMENT_STATUS_UNCHANGED');
	}

	if (isTerminalAppointmentStatus(input.currentStatus)) {
		throw new Error('APPOINTMENT_TERMINAL_STATUS');
	}

	if (!transitionMap[input.currentStatus].includes(input.nextStatus)) {
		throw new Error('APPOINTMENT_INVALID_TRANSITION');
	}

	if (input.nextStatus === 'attended' && input.startsAt > now) {
		throw new Error('APPOINTMENT_CANNOT_ATTEND_IN_FUTURE');
	}

	if (input.nextStatus === 'no_show' && input.endsAt > now) {
		throw new Error('APPOINTMENT_CANNOT_NO_SHOW_BEFORE_END');
	}
};

export const getHumanAppointmentErrorMessage = (error: unknown) => {
	const anyError = error as { code?: string; message?: string; details?: string };
	const raw = `${anyError?.message ?? ''} ${anyError?.details ?? ''}`;

	if (anyError?.code === '23P01' || raw.includes('appointments_no_overlapping_active')) {
		return 'Ese horario ya fue reservado. Elegí otro horario disponible.';
	}
	if (raw.includes('APPOINTMENT_NOT_FOUND')) return 'No se encontró el turno.';
	if (raw.includes('PATIENT_NAME_REQUIRED')) return 'Cargá el nombre del paciente.';
	if (raw.includes('PATIENT_OWNER_REQUIRED')) return 'No se encontró el responsable del consultorio.';
	if (raw.includes('PATIENT_NOT_FOUND')) return 'No se encontró el paciente seleccionado.';
	if (raw.includes('PATIENT_BLOCKED')) return 'Ese paciente está bloqueado.';
	if (raw.includes('SERVICE_NOT_FOUND')) return 'No se encontró el servicio o está inactivo.';
	if (raw.includes('PROFESSIONAL_NOT_FOUND')) return 'No se encontró el profesional o está inactivo.';
	if (raw.includes('PROFESSIONAL_SERVICE_NOT_ASSIGNED')) return 'Este profesional no ofrece ese servicio.';
	if (raw.includes('APPOINTMENT_CANNOT_ATTEND_IN_FUTURE')) {
		return 'No podés marcar asistencia antes del horario del turno.';
	}
	if (raw.includes('APPOINTMENT_CANNOT_NO_SHOW_BEFORE_END')) {
		return 'No podés marcar no asistió antes de que termine el turno.';
	}
	if (raw.includes('APPOINTMENT_TERMINAL_STATUS')) return 'Ese turno ya está cerrado.';
	if (raw.includes('APPOINTMENT_INVALID_TRANSITION')) return 'Ese cambio de estado no está permitido.';
	if (raw.includes('APPOINTMENT_STATUS_UNCHANGED')) return 'El turno ya tiene ese estado.';
	if (raw.includes('APPOINTMENT_CANNOT_RESCHEDULE')) return 'Ese turno no se puede reprogramar.';
	if (raw.includes('APPOINTMENT_ACCESS_DENIED')) return 'No tenés permiso para modificar este turno.';
	if (raw.includes('BUSINESS_ACCESS_RESTRICTED')) {
		return 'La cuenta está suspendida. Regularizá la suscripción para volver a operar.';
	}
	if (raw.includes('INVALID_PROFESSIONAL_STATUS')) return 'El profesional solo puede marcar asistencia o ausencia.';

	return 'No se pudo completar la acción.';
};

export const createOrFindPatientForAppointment = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		ownerId?: string | null;
		patientId?: string | null;
		name?: string | null;
		phone?: string | null;
		email?: string | null;
	}
) => {
	if (input.patientId) {
		const { data: patient, error } = await supabase
			.from('patients')
			.select('id, blocked')
			.eq('business_id', input.businessId)
			.eq('id', input.patientId)
			.maybeSingle();
		if (error) throw error;
		if (!patient?.id) throw new Error('PATIENT_NOT_FOUND');
		if (patient.blocked) throw new Error('PATIENT_BLOCKED');
		return input.patientId;
	}

	const fullName = String(input.name ?? '').trim();
	const phoneRaw = normalizePhoneRaw(input.phone);
	const phoneE164 = normalizePhoneE164(input.phone);
	const email = String(input.email ?? '').trim();

	if (!fullName) {
		throw new Error('PATIENT_NAME_REQUIRED');
	}

	if (phoneE164) {
		const { data: existing, error: existingError } = await supabase
			.from('patients')
			.select('id, blocked')
			.eq('business_id', input.businessId)
			.eq('phone_e164', phoneE164)
			.maybeSingle();
		if (existingError) throw existingError;
		if (existing?.blocked) throw new Error('PATIENT_BLOCKED');
		if (existing?.id) return existing.id as string;
	}

	let ownerId = input.ownerId ?? null;
	if (!ownerId) {
		const { data: owner, error: ownerError } = await supabase
			.from('business_users')
			.select('user_id')
			.eq('business_id', input.businessId)
			.eq('role', 'owner')
			.order('created_at', { ascending: true })
			.limit(1)
			.maybeSingle();
		if (ownerError) throw ownerError;
		ownerId = owner?.user_id ?? null;
	}
	if (!ownerId) throw new Error('PATIENT_OWNER_REQUIRED');

	const { data, error } = await supabase
		.from('patients')
		.insert({
			business_id: input.businessId,
			owner_id: ownerId,
			full_name: fullName,
			phone: phoneE164?.replace(/\D/g, '') ?? phoneRaw,
			phone_raw: phoneRaw,
			phone_e164: phoneE164,
			email: email || null
		})
		.select('id')
		.single();

	if (error) throw error;
	if (!data?.id) throw new Error('PATIENT_CREATE_FAILED');
	return data.id as string;
};

export const createManualAppointment = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		ownerId?: string | null;
		createdByUserId?: string | null;
		patientId?: string | null;
		patientName?: string | null;
		patientPhone?: string | null;
		patientEmail?: string | null;
		serviceId: string;
		professionalId: string;
		startsAt: Date;
		internalNote?: string | null;
		source?: AppointmentSource;
	}
) => {
	const patientId = await createOrFindPatientForAppointment(supabase, {
		businessId: input.businessId,
		ownerId: input.ownerId,
		patientId: input.patientId,
		name: input.patientName,
		phone: input.patientPhone,
		email: input.patientEmail
	});

	const { data: service, error: serviceError } = await supabase
		.from('services')
		.select('duration_minutes')
		.eq('business_id', input.businessId)
		.eq('id', input.serviceId)
		.eq('is_active', true)
		.maybeSingle();
	if (serviceError) throw serviceError;
	if (!service?.duration_minutes) throw new Error('SERVICE_NOT_FOUND');

	const endsAt = addMinutes(input.startsAt, Number(service.duration_minutes));

	const { data, error } = await supabase
		.from('appointments')
		.insert({
			business_id: input.businessId,
			patient_id: patientId,
			service_id: input.serviceId,
			professional_id: input.professionalId,
			starts_at: input.startsAt.toISOString(),
			ends_at: endsAt.toISOString(),
			blocking_starts_at: input.startsAt.toISOString(),
			blocking_ends_at: endsAt.toISOString(),
			status: 'reserved',
			source: input.source ?? 'manual',
			reminder_due_at: null,
			internal_note: input.internalNote || null,
			created_by_user_id: input.createdByUserId ?? null,
			updated_by_user_id: input.createdByUserId ?? null,
			service_name_snapshot: 'Pendiente',
			professional_name_snapshot: 'Pendiente',
			duration_minutes_snapshot: Number(service.duration_minutes)
		})
		.select('id')
		.single();

	if (error) throw error;

	await writeAuditLog(supabase, {
		businessId: input.businessId,
		userId: input.createdByUserId ?? null,
		action: input.source === 'public_booking' ? 'appointment.public_created' : 'appointment.created',
		entityType: 'appointment',
		entityId: data?.id ?? null,
		metadata: {
			source: input.source ?? 'manual',
			patient_id: patientId,
			service_id: input.serviceId,
			professional_id: input.professionalId,
			starts_at: input.startsAt.toISOString()
		}
	});

	return data;
};

export const updateAppointmentStatus = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		appointmentId: string;
		status: AppointmentStatus;
		userId: string;
		reason?: string | null;
		now?: Date;
	}
) => {
	const now = input.now ?? new Date();

	const { data: appointment, error: loadError } = await supabase
		.from('appointments')
		.select('id, starts_at, ends_at, status')
		.eq('business_id', input.businessId)
		.eq('id', input.appointmentId)
		.maybeSingle();
	if (loadError) throw loadError;
	if (!appointment) throw new Error('APPOINTMENT_NOT_FOUND');

	assertCanTransitionAppointment({
		currentStatus: appointment.status as AppointmentStatus,
		nextStatus: input.status,
		startsAt: new Date(appointment.starts_at),
		endsAt: new Date(appointment.ends_at),
		now
	});

	const updates: Record<string, unknown> = {
		status: input.status,
		updated_by_user_id: input.userId,
		updated_at: now.toISOString()
	};

	if (input.status === 'confirmed') updates.confirmed_at = now.toISOString();
	if (input.status === 'cancelled') {
		updates.cancelled_at = now.toISOString();
		updates.cancelled_by_user_id = input.userId;
		updates.cancelled_reason = input.reason || null;
	}
	if (input.status === 'reschedule_requested') updates.reschedule_requested_at = now.toISOString();
	if (input.status === 'attended') updates.attended_at = now.toISOString();
	if (input.status === 'no_show') updates.no_show_at = now.toISOString();

	const { error } = await supabase
		.from('appointments')
		.update(updates)
		.eq('business_id', input.businessId)
		.eq('id', input.appointmentId);
	if (error) throw error;

	await writeAuditLog(supabase, {
		businessId: input.businessId,
		userId: input.userId,
		action: `appointment.${input.status}`,
		entityType: 'appointment',
		entityId: input.appointmentId,
		metadata: {
			from_status: appointment.status,
			to_status: input.status,
			reason: input.status === 'cancelled' ? (input.reason ?? null) : null
		}
	});
};

export const rescheduleAppointment = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		appointmentId: string;
		userId: string;
		startsAt: Date;
		now?: Date;
	}
) => {
	const now = input.now ?? new Date();
	const { data: appointment, error: loadError } = await supabase
		.from('appointments')
		.select('id, service_id, professional_id, starts_at, ends_at, status')
		.eq('business_id', input.businessId)
		.eq('id', input.appointmentId)
		.maybeSingle();
	if (loadError) throw loadError;
	if (!appointment) throw new Error('APPOINTMENT_NOT_FOUND');
	if (isTerminalAppointmentStatus(appointment.status as AppointmentStatus)) {
		throw new Error('APPOINTMENT_CANNOT_RESCHEDULE');
	}

	const { data: service, error: serviceError } = await supabase
		.from('services')
		.select('duration_minutes, is_active')
		.eq('business_id', input.businessId)
		.eq('id', appointment.service_id)
		.maybeSingle();
	if (serviceError) throw serviceError;
	if (!service?.duration_minutes || !service.is_active) throw new Error('SERVICE_NOT_FOUND');

	const endsAt = addMinutes(input.startsAt, Number(service.duration_minutes));
	const { error } = await supabase
		.from('appointments')
		.update({
			starts_at: input.startsAt.toISOString(),
			ends_at: endsAt.toISOString(),
			status: 'reserved',
			confirmed_at: null,
			reschedule_requested_at: null,
			reminder_due_at: null,
			updated_by_user_id: input.userId,
			updated_at: now.toISOString()
		})
		.eq('business_id', input.businessId)
		.eq('id', input.appointmentId);
	if (error) throw error;

	await writeAuditLog(supabase, {
		businessId: input.businessId,
		userId: input.userId,
		action: 'appointment.rescheduled',
		entityType: 'appointment',
		entityId: input.appointmentId,
		metadata: {
			from_starts_at: appointment.starts_at,
			from_ends_at: appointment.ends_at,
			to_starts_at: input.startsAt.toISOString(),
			to_ends_at: endsAt.toISOString(),
			from_status: appointment.status,
			to_status: 'reserved'
		}
	});
};

export const updateProfessionalAppointmentStatus = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		appointmentId: string;
		status: Extract<AppointmentStatus, 'attended' | 'no_show'>;
	}
) => {
	const { error } = await supabase.rpc('professional_update_appointment_status', {
		target_business_id: input.businessId,
		target_appointment_id: input.appointmentId,
		target_status: input.status
	});
	if (error) throw error;
};
