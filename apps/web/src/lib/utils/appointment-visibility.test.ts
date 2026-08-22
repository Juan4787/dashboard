import { describe, expect, it } from 'vitest';
import {
	ACTIVE_APPOINTMENT_STATUSES,
	isActiveAppointmentStatus,
	isUpcomingActiveAppointment
} from './appointment-visibility';

const now = new Date('2026-08-22T15:00:00.000Z');

describe('upcoming active appointments', () => {
	it('defines the only statuses that remain operationally active', () => {
		expect(ACTIVE_APPOINTMENT_STATUSES).toEqual([
			'reserved',
			'confirmed',
			'reschedule_requested'
		]);
		expect(isActiveAppointmentStatus('cancelled')).toBe(false);
		expect(isActiveAppointmentStatus('attended')).toBe(false);
		expect(isActiveAppointmentStatus('no_show')).toBe(false);
	});

	it('keeps only active appointments at or after the current instant', () => {
		expect(
			isUpcomingActiveAppointment(
				{ starts_at: '2026-08-22T15:00:00.000Z', status: 'reserved' },
				now
			)
		).toBe(true);
		expect(
			isUpcomingActiveAppointment(
				{ starts_at: '2026-08-22T14:59:59.999Z', status: 'confirmed' },
				now
			)
		).toBe(false);
		expect(
			isUpcomingActiveAppointment(
				{ starts_at: '2026-08-23T15:00:00.000Z', status: 'cancelled' },
				now
			)
		).toBe(false);
		expect(isUpcomingActiveAppointment({ starts_at: 'invalid', status: 'reserved' }, now)).toBe(
			false
		);
	});
});
