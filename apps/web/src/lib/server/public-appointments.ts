import type { SupabaseClient } from '@supabase/supabase-js';
import { writeAuditLog } from './audit';
import {
	APPOINTMENT_STATUS_LABELS,
	type AppointmentStatus,
	addMinutes,
	isAppointmentStatus
} from './appointments';
import {
	PUBLIC_BUSINESS_SELECT,
	canUsePublicBusiness,
	expirePublicBookingHolds,
	publicHash,
	recordPublicBookingAttempt
} from './public-booking';

export type PublicAppointmentAction = 'confirm' | 'cancel' | 'reschedule';

export type PublicAppointmentView = {
	id: string;
	token: string;
	patient_id: string;
	status: AppointmentStatus;
	hold_expires_at: string | null;
	starts_at: string;
	ends_at: string;
	service_name_snapshot: string;
	professional_name_snapshot: string;
	business: {
		id: string;
		name: string;
		slug: string;
		phone: string | null;
		address: string | null;
		logo_url: string | null;
		timezone: string;
		is_active: boolean;
		cancellation_policy: string | null;
	};
	patient_name: string | null;
	public_status_label: string;
	public_actions_available: boolean;
	can_confirm: boolean;
	can_cancel: boolean;
	can_request_reschedule: boolean;
	is_past: boolean;
	is_hold_expired: boolean;
};

const appointmentSelect = `
	id,
	confirmation_token,
	status,
	hold_expires_at,
	starts_at,
	ends_at,
	patient_id,
	service_name_snapshot,
	professional_name_snapshot,
	businesses!inner(${PUBLIC_BUSINESS_SELECT}),
	patients(full_name)
`;

const activePublicStatuses = ['pending_confirmation', 'reserved', 'confirmed', 'reschedule_requested'] as const;
const publicActionAttempt: Record<
	PublicAppointmentAction,
	'token_confirm' | 'token_cancel' | 'token_reschedule'
> = {
	confirm: 'token_confirm',
	cancel: 'token_cancel',
	reschedule: 'token_reschedule'
};

export const loadPublicAppointmentByToken = async (
	supabase: SupabaseClient,
	token: string,
	now = new Date()
): Promise<PublicAppointmentView | null> => {
	await expirePublicBookingHolds(supabase);
	const { data, error } = await supabase
		.from('appointments')
		.select(appointmentSelect)
		.eq('confirmation_token', token)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;

	const status = String(data.status);
	if (!isAppointmentStatus(status)) return null;
	const business = (data as any).businesses;
	const startsAt = new Date(data.starts_at);
	const isPast = startsAt <= now;
	const holdExpiresAt = data.hold_expires_at ? new Date(data.hold_expires_at) : null;
	const isHoldExpired = status === 'pending_confirmation' && Boolean(holdExpiresAt && holdExpiresAt <= now);
	const isBusinessActive = Boolean(business?.is_active);
	const canUsePublicTokens = isBusinessActive
		? await canUsePublicBusiness(supabase, String(business.id), business.created_at ?? null)
		: false;
	const canAct = isBusinessActive && canUsePublicTokens && !isPast && !isHoldExpired;

	return {
		id: String(data.id),
		token: String(data.confirmation_token),
		patient_id: String((data as any).patient_id),
		status,
		hold_expires_at: data.hold_expires_at ? String(data.hold_expires_at) : null,
		starts_at: String(data.starts_at),
		ends_at: String(data.ends_at),
		service_name_snapshot: String(data.service_name_snapshot),
		professional_name_snapshot: String(data.professional_name_snapshot),
		business: {
			id: String(business.id),
			name: String(business.name),
			slug: String(business.slug),
			phone: business.phone ?? null,
			address: business.address ?? null,
			logo_url: business.logo_url ?? null,
			timezone: String(business.timezone),
			is_active: Boolean(business.is_active),
			cancellation_policy: business.cancellation_policy ?? null
		},
		patient_name: (data as any).patients?.full_name ?? null,
		public_status_label: APPOINTMENT_STATUS_LABELS[status],
		public_actions_available: canUsePublicTokens,
		can_confirm: canAct && (status === 'pending_confirmation' || status === 'reserved'),
		can_cancel:
			canAct &&
			(status === 'pending_confirmation' ||
				status === 'reserved' ||
				status === 'confirmed' ||
				status === 'reschedule_requested'),
		can_request_reschedule: canAct && (status === 'reserved' || status === 'confirmed'),
		is_past: isPast,
		is_hold_expired: isHoldExpired
	};
};

export const getPublicAppointmentMessage = (appointment: PublicAppointmentView | null) => {
	if (!appointment) return 'El enlace no es válido o ya no está disponible.';
	if (!appointment.business.is_active) return 'Este turno no admite cambios online en este momento.';
	if (!appointment.public_actions_available) {
		return 'Este enlace no está disponible en este momento. Contactá al consultorio.';
	}
	if (appointment.is_hold_expired || appointment.status === 'expired') {
		return 'Este horario pendiente expiró. Elegí otro turno disponible.';
	}
	if (appointment.is_past) return 'Este turno ya no admite cambios online.';
	if (appointment.status === 'cancelled') return 'Este turno ya fue cancelado.';
	if (appointment.status === 'pending_confirmation') {
		return 'Este horario está retenido por unos minutos. Confirmalo para fijar el turno.';
	}
	if (appointment.status === 'confirmed') return 'Tu turno está confirmado.';
	if (appointment.status === 'reschedule_requested') {
		return 'Recibimos tu pedido de reprogramación. El consultorio lo gestionará.';
	}
	if (appointment.status === 'attended' || appointment.status === 'no_show') {
		return 'Este turno ya no admite cambios online.';
	}
	return 'Tu turno está reservado.';
};

const assertCanApplyPublicAction = (
	appointment: PublicAppointmentView,
	action: PublicAppointmentAction
) => {
	if (!appointment.business.is_active) throw new Error('PUBLIC_TOKEN_BUSINESS_DISABLED');
	if (!appointment.public_actions_available) throw new Error('PUBLIC_TOKEN_COMMERCIAL_UNAVAILABLE');
	if (appointment.is_past) throw new Error('PUBLIC_TOKEN_APPOINTMENT_PAST');
	if (!activePublicStatuses.includes(appointment.status as any)) {
		throw new Error('PUBLIC_TOKEN_APPOINTMENT_CLOSED');
	}
	if (action === 'confirm' && appointment.status === 'confirmed') return;
	if (action === 'confirm' && !['pending_confirmation', 'reserved'].includes(appointment.status)) {
		throw new Error('PUBLIC_TOKEN_CONFIRM_DENIED');
	}
	if (action === 'cancel' && !appointment.can_cancel) throw new Error('PUBLIC_TOKEN_CANCEL_DENIED');
	if (action === 'reschedule' && !appointment.can_request_reschedule) {
		throw new Error('PUBLIC_TOKEN_RESCHEDULE_DENIED');
	}
};

export const applyPublicAppointmentAction = async (
	supabase: SupabaseClient,
	input: {
		token: string;
		action: PublicAppointmentAction;
		note?: string | null;
		ip?: string | null;
		userAgent?: string | null;
		now?: Date;
	}
) => {
	const now = input.now ?? new Date();
	let appointment: PublicAppointmentView | null = null;
	const attemptAction = publicActionAttempt[input.action];

	try {
		appointment = await loadPublicAppointmentByToken(supabase, input.token, now);
		if (!appointment) throw new Error('PUBLIC_TOKEN_NOT_FOUND');
		assertCanApplyPublicAction(appointment, input.action);

		if (input.action === 'confirm' && appointment.status === 'confirmed') {
			await recordPublicBookingAttempt(supabase, {
				businessId: appointment.business.id,
				ipHash: publicHash(input.ip),
				action: attemptAction,
				success: true,
				userAgent: input.userAgent,
				metadata: { appointment_id: appointment.id, action: input.action, changed: false }
			});
			return { appointment, changed: false };
		}

		const updates: Record<string, unknown> = {
			updated_at: now.toISOString(),
			updated_by_user_id: null
		};
		const metadata: Record<string, unknown> = {
			source: 'public_token',
			from_status: appointment.status
		};
		let auditAction = '';

		if (input.action === 'confirm') {
			updates.status = 'confirmed';
			updates.confirmed_at = now.toISOString();
			updates.public_confirmed_at = now.toISOString();
			updates.hold_expires_at = null;
			auditAction = 'appointment.public_confirmed';
			metadata.to_status = 'confirmed';
		} else if (input.action === 'cancel') {
			updates.status = 'cancelled';
			updates.cancelled_at = now.toISOString();
			updates.cancelled_by_user_id = null;
			updates.cancelled_reason = input.note?.trim() || 'Cancelado por paciente desde link público';
			auditAction = 'appointment.public_cancelled';
			metadata.to_status = 'cancelled';
		} else {
			updates.status = 'reschedule_requested';
			updates.reschedule_requested_at = now.toISOString();
			auditAction = 'appointment.public_reschedule_requested';
			metadata.to_status = 'reschedule_requested';
		}

		let updateQuery = supabase
			.from('appointments')
			.update(updates)
			.eq('id', appointment.id)
			.eq('business_id', appointment.business.id);
		if (input.action === 'confirm') {
			updateQuery = updateQuery.in('status', ['pending_confirmation', 'reserved']);
		} else if (input.action === 'cancel') {
			updateQuery = updateQuery.in('status', ['pending_confirmation', 'reserved', 'confirmed', 'reschedule_requested']);
		} else {
			updateQuery = updateQuery.in('status', ['reserved', 'confirmed']);
		}
		const { data: updatedAppointment, error } = await updateQuery.select('id').maybeSingle();
		if (error) throw error;
		if (!updatedAppointment) throw new Error('PUBLIC_TOKEN_APPOINTMENT_CLOSED');

		await writeAuditLog(supabase, {
			businessId: appointment.business.id,
			userId: null,
			action: auditAction,
			entityType: 'appointment',
			entityId: appointment.id,
			metadata
		});

		if (input.action === 'confirm') {
			const { error: patientUpdateError } = await supabase
				.from('patients')
				.update({
					origin: 'public_booking',
					archived_at: null,
					public_hold_archived_at: null,
					updated_at: now.toISOString()
				})
				.eq('business_id', appointment.business.id)
				.eq('id', appointment.patient_id)
				.eq('origin', 'public_hold');
			if (patientUpdateError) throw patientUpdateError;
		}

		await recordPublicBookingAttempt(supabase, {
			businessId: appointment.business.id,
			ipHash: publicHash(input.ip),
			action: attemptAction,
			success: true,
			userAgent: input.userAgent,
			metadata: { appointment_id: appointment.id, action: input.action }
		});

		const updated = await loadPublicAppointmentByToken(supabase, input.token, addMinutes(now, 0));
		return { appointment: updated ?? appointment, changed: true };
	} catch (error) {
		await recordPublicBookingAttempt(supabase, {
			businessId: appointment?.business.id ?? null,
			ipHash: publicHash(input.ip),
			action: attemptAction,
			success: false,
			errorCode: (error as Error)?.message ?? 'UNKNOWN',
			userAgent: input.userAgent,
			metadata: { appointment_id: appointment?.id ?? null, action: input.action }
		});
		throw error;
	}
};

export const getPublicTokenErrorMessage = (error: unknown) => {
	const raw = `${(error as { message?: string; details?: string })?.message ?? ''} ${(error as { details?: string })?.details ?? ''}`;
	if (raw.includes('PUBLIC_TOKEN_NOT_FOUND')) return 'El enlace no es válido o ya no está disponible.';
	if (raw.includes('PUBLIC_TOKEN_BUSINESS_DISABLED')) return 'Este turno no admite cambios online en este momento.';
	if (raw.includes('PUBLIC_TOKEN_COMMERCIAL_UNAVAILABLE')) {
		return 'Este enlace no está disponible en este momento. Contactá al consultorio.';
	}
	if (raw.includes('PUBLIC_TOKEN_APPOINTMENT_PAST')) return 'Este turno ya no admite cambios online.';
	if (raw.includes('PUBLIC_TOKEN_APPOINTMENT_CLOSED')) return 'Este turno ya está cerrado.';
	if (raw.includes('PUBLIC_TOKEN_CONFIRM_DENIED')) return 'Este turno no se puede confirmar desde este enlace.';
	if (raw.includes('PUBLIC_TOKEN_CANCEL_DENIED')) return 'Este turno no se puede cancelar desde este enlace.';
	if (raw.includes('PUBLIC_TOKEN_RESCHEDULE_DENIED')) {
		return 'Este turno no puede pedir reprogramación desde este enlace.';
	}
	return 'No se pudo completar la acción.';
};
