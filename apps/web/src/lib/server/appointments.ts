import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { writeAuditLog } from './audit';
import { normalizePhoneE164, normalizePhoneRaw } from './phone';
import {
	getPatientUniqueConflictField,
	isLegacyPatientNameConflict,
	LEGACY_PATIENT_NAME_CONFLICT_MESSAGE,
	PATIENT_UNIQUE_CONFLICT_MESSAGES
} from './patient-identity';

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

	if (raw.includes('appointment_professionals_no_break_overlap')) {
		return 'Ese horario invade el descanso configurado de al menos uno de los profesionales. Elegí la primera hora disponible que muestra la agenda. Si estás cargando el turno manualmente y confirmaste que nadie estará atendiendo a otro paciente al mismo tiempo, activá “Ignorar descanso” y volvé a elegir el horario.';
	}
	if (anyError?.code === '23P01' || raw.includes('appointments_no_overlapping_active')) {
		return 'Ese horario dejó de estar disponible porque al menos uno de los profesionales ya tiene otro turno que se superpone. No se reservó a ningún integrante del equipo. Volvé a la agenda, actualizá los horarios y elegí otra opción disponible.';
	}
	const patientConflictField = getPatientUniqueConflictField(anyError);
	if (patientConflictField) return PATIENT_UNIQUE_CONFLICT_MESSAGES[patientConflictField];
	if (isLegacyPatientNameConflict(anyError)) return LEGACY_PATIENT_NAME_CONFLICT_MESSAGE;
	if (raw.includes('APPOINTMENT_NOT_FOUND')) {
		return 'No encontramos ese turno. Volvé a la agenda y abrilo otra vez; es posible que haya sido eliminado o que ya no tengas acceso.';
	}
	if (raw.includes('PATIENT_NAME_REQUIRED')) {
		return 'Falta el nombre del paciente. Escribilo antes de intentar crear el turno.';
	}
	if (raw.includes('PATIENT_OWNER_REQUIRED')) {
		return 'No pudimos identificar al responsable del consultorio para crear la ficha del paciente. Pedile a un administrador que revise la configuración del equipo y volvé a intentar.';
	}
	if (raw.includes('PATIENT_NOT_FOUND')) {
		return 'No encontramos al paciente seleccionado. Buscalo otra vez en la lista o creá una ficha nueva antes de reservar.';
	}
	if (raw.includes('PATIENT_BLOCKED')) {
		return 'Ese paciente está bloqueado y no puede recibir nuevos turnos. Revisá su ficha y quitá el bloqueo sólo si corresponde.';
	}
	if (raw.includes('SERVICE_NOT_FOUND')) {
		return 'El procedimiento seleccionado ya no está disponible. Volvé al primer paso y elegí un procedimiento activo.';
	}
	if (raw.includes('PROFESSIONAL_NOT_FOUND')) {
		return 'Uno de los profesionales seleccionados ya no está activo. Volvé a elegir el equipo antes de reservar.';
	}
	if (
		raw.includes('PROFESSIONAL_SERVICE_NOT_ASSIGNED') ||
		raw.includes('TEAM_PROFESSIONAL_SERVICE_NOT_ASSIGNED')
	) {
		return 'Al menos uno de los profesionales seleccionados no está habilitado para este procedimiento. Volvé al paso del equipo, quitá a ese profesional o asignale el procedimiento desde su configuración.';
	}
	if (raw.includes('JOINT_APPOINTMENT_REQUIRES_TWO_PROFESSIONALS')) {
		return 'Un turno conjunto necesita por lo menos dos profesionales diferentes. Seleccioná dos o más integrantes del equipo y volvé a buscar horarios.';
	}
	if (
		raw.includes('JOINT_APPOINTMENT_DUPLICATE_PROFESSIONAL') ||
		raw.includes('JOINT_APPOINTMENT_INVALID_PROFESSIONAL')
	) {
		return 'La selección del equipo contiene un profesional repetido o inválido. Volvé al paso del equipo, revisá los integrantes marcados y continuá nuevamente.';
	}
	if (
		raw.includes('TEAM_MUST_BE_RECALCULATED') ||
		raw.includes('TEAM_PROFESSIONAL_NOT_AVAILABLE')
	) {
		return 'El equipo cambió desde que se abrió este turno y su disponibilidad debe calcularse de nuevo. Volvé a la agenda, revisá que todos sigan activos y asignados al procedimiento, y elegí un horario nuevo.';
	}
	if (raw.includes('APPOINTMENT_CANNOT_ATTEND_IN_FUTURE')) {
		return 'No podés marcar asistencia antes del horario del turno.';
	}
	if (raw.includes('APPOINTMENT_CANNOT_NO_SHOW_BEFORE_END')) {
		return 'No podés marcar no asistió antes de que termine el turno.';
	}
	if (raw.includes('APPOINTMENT_TERMINAL_STATUS')) {
		return 'Ese turno ya está cerrado porque fue cancelado o se registró su asistencia. No se puede volver a modificar.';
	}
	if (raw.includes('APPOINTMENT_INVALID_TRANSITION')) {
		return 'Ese cambio de estado no corresponde al estado actual del turno. Recargá la página y elegí una de las acciones disponibles.';
	}
	if (raw.includes('APPOINTMENT_STATUS_UNCHANGED')) {
		return 'El turno ya tiene ese estado. No hace falta guardar ningún cambio.';
	}
	if (raw.includes('APPOINTMENT_CANNOT_RESCHEDULE')) {
		return 'Este turno ya está cerrado y no puede reprogramarse. Si necesitás una nueva atención, creá un turno nuevo desde la agenda.';
	}
	if (raw.includes('APPOINTMENT_ACCESS_DENIED')) {
		return 'Tu usuario no forma parte del equipo asignado a este turno y no tiene permiso para modificarlo. Pedile ayuda a recepción o a un administrador.';
	}
	if (raw.includes('BUSINESS_ACCESS_RESTRICTED')) {
		return 'Tu acceso a Cita Suite venció. Activá tu suscripción para volver a usar la plataforma.';
	}
	if (raw.includes('INVALID_PROFESSIONAL_STATUS')) {
		return 'Desde el perfil profesional sólo se puede marcar si el paciente asistió o no asistió. Para otro cambio, pedile ayuda a recepción.';
	}
	return 'No pudimos completar la acción y no se guardó ningún cambio. Recargá la página y volvé a intentar; si vuelve a ocurrir, pedile a un administrador que revise el registro interno del error.';
};

const isPatientPhoneIdentityConflict = (error: unknown) => {
	return getPatientUniqueConflictField(
		error as { code?: string; message?: string; details?: string }
	) === 'phone';
};

const findPatientByPhone = async (
	supabase: SupabaseClient,
	businessId: string,
	phoneE164: string
) => {
	const { data, error } = await supabase
		.from('patients')
		.select('id, blocked')
		.eq('business_id', businessId)
		.eq('phone_e164', phoneE164)
		.maybeSingle();
	if (error) throw error;
	return data as { id?: string; blocked?: boolean } | null;
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
		const existing = await findPatientByPhone(supabase, input.businessId, phoneE164);
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

	const newPatientId = crypto.randomUUID();
	const { error } = await supabase
		.from('patients')
		.insert({
			id: newPatientId,
			business_id: input.businessId,
			owner_id: ownerId,
			full_name: fullName,
			phone: phoneE164?.replace(/\D/g, '') ?? phoneRaw,
			phone_raw: phoneRaw,
			phone_e164: phoneE164,
			email: email || null
		});

	if (error) {
		// Dos reservas simultáneas con un teléfono nuevo pueden intentar crear la
		// misma ficha. La restricción única decide cuál gana; la otra petición
		// vuelve a leer esa ficha en lugar de fallar con un error técnico.
		if (phoneE164 && isPatientPhoneIdentityConflict(error)) {
			const concurrentPatient = await findPatientByPhone(supabase, input.businessId, phoneE164);
			if (concurrentPatient?.blocked) throw new Error('PATIENT_BLOCKED');
			if (concurrentPatient?.id) return concurrentPatient.id;
		}
		throw error;
	}
	return newPatientId;
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
		ignoreBreak?: boolean;
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
			ignore_break: Boolean(input.ignoreBreak),
			created_by_user_id: input.createdByUserId ?? null,
			updated_by_user_id: input.createdByUserId ?? null,
			service_name_snapshot: 'Pendiente',
			professional_name_snapshot: 'Pendiente',
			duration_minutes_snapshot: Number(service.duration_minutes)
		})
		.select(
			'id, confirmation_token, starts_at, ends_at, service_name_snapshot, professional_name_snapshot'
		)
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

export const createJointAppointment = async (
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
		professionalIds: string[];
		startsAt: Date;
		internalNote?: string | null;
		ignoreBreak?: boolean;
	}
) => {
	const professionalIds = [
		...new Set(input.professionalIds.map((professionalId) => professionalId.trim()).filter(Boolean))
	];
	if (professionalIds.length < 2) {
		throw new Error('JOINT_APPOINTMENT_REQUIRES_TWO_PROFESSIONALS');
	}

	const patientId = await createOrFindPatientForAppointment(supabase, {
		businessId: input.businessId,
		ownerId: input.ownerId,
		patientId: input.patientId,
		name: input.patientName,
		phone: input.patientPhone,
		email: input.patientEmail
	});

	const { data, error } = await supabase
		.rpc('create_joint_appointment', {
			p_business_id: input.businessId,
			p_patient_id: patientId,
			p_service_id: input.serviceId,
			p_professional_ids: professionalIds,
			p_starts_at: input.startsAt.toISOString(),
			p_internal_note: input.internalNote || null,
			p_created_by_user_id: input.createdByUserId ?? null,
			p_ignore_break: Boolean(input.ignoreBreak)
		})
		.single();
	if (error) throw error;
	const appointment = data as
		| {
				id?: string;
				professional_name_snapshot?: string;
				service_name_snapshot?: string;
				confirmation_token?: string;
				starts_at?: string;
				ends_at?: string;
		  }
		| null;
	if (!appointment?.id) throw new Error('JOINT_APPOINTMENT_NOT_CREATED');
	return {
		...appointment,
		id: appointment.id
	};
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
		ignoreBreak?: boolean;
		now?: Date;
	}
) => {
	const now = input.now ?? new Date();
	const { data: appointment, error: loadError } = await supabase
		.from('appointments')
		.select(
			'id, service_id, professional_id, starts_at, ends_at, status, ignore_break, calendar_sequence, calendar_action_count'
		)
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
	// Versionado del evento de calendario: el ICS del mismo turno sale con SEQUENCE
	// incrementado, y si el paciente ya había registrado una acción de calendario el
	// turno queda "pendiente de actualizar" (banner en /turno + sección Recordatorios).
	const hadCalendarAction = Number((appointment as any).calendar_action_count ?? 0) > 0;
	const { error } = await supabase
		.from('appointments')
		.update({
			starts_at: input.startsAt.toISOString(),
			ends_at: endsAt.toISOString(),
			status: 'reserved',
			confirmed_at: null,
			reschedule_requested_at: null,
			reminder_due_at: null,
			calendar_sequence: Number((appointment as any).calendar_sequence ?? 0) + 1,
			calendar_update_required_at: hadCalendarAction ? now.toISOString() : null,
			// Una reprogramación vuelve a calcular desde cero. La excepción al
			// descanso sólo continúa si el usuario la solicita otra vez.
			ignore_break: Boolean(input.ignoreBreak),
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
			to_status: 'reserved',
			ignore_break: Boolean(input.ignoreBreak),
			calendar_update_required: hadCalendarAction
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
