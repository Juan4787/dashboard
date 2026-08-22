export const ACTIVE_APPOINTMENT_STATUSES = [
	'reserved',
	'confirmed',
	'reschedule_requested'
] as const;

export type ActiveAppointmentStatus = (typeof ACTIVE_APPOINTMENT_STATUSES)[number];

export const isActiveAppointmentStatus = (status: unknown): status is ActiveAppointmentStatus =>
	(ACTIVE_APPOINTMENT_STATUSES as readonly unknown[]).includes(status);

export const isUpcomingActiveAppointment = (
	appointment: { starts_at?: string | null; status?: unknown },
	now: Date = new Date()
) => {
	if (!isActiveAppointmentStatus(appointment.status)) return false;
	const startsAt = Date.parse(String(appointment.starts_at ?? ''));
	return Number.isFinite(startsAt) && startsAt >= now.getTime();
};
