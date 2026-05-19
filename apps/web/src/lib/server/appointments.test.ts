import { describe, expect, it } from 'vitest';
import {
	assertCanTransitionAppointment,
	getHumanAppointmentErrorMessage
} from './appointments';

const pastStart = new Date('2026-05-13T10:00:00.000Z');
const pastEnd = new Date('2026-05-13T11:00:00.000Z');
const now = new Date('2026-05-13T12:00:00.000Z');

describe('appointment transitions', () => {
	it('allows active appointments to be confirmed or cancelled', () => {
		expect(() =>
			assertCanTransitionAppointment({
				currentStatus: 'reserved',
				nextStatus: 'confirmed',
				startsAt: pastStart,
				endsAt: pastEnd,
				now
			})
		).not.toThrow();

		expect(() =>
			assertCanTransitionAppointment({
				currentStatus: 'confirmed',
				nextStatus: 'cancelled',
				startsAt: pastStart,
				endsAt: pastEnd,
				now
			})
		).not.toThrow();
	});

	it('blocks terminal appointments from returning to active states', () => {
		expect(() =>
			assertCanTransitionAppointment({
				currentStatus: 'cancelled',
				nextStatus: 'confirmed',
				startsAt: pastStart,
				endsAt: pastEnd,
				now
			})
		).toThrow('APPOINTMENT_TERMINAL_STATUS');
	});

	it('blocks attendance before start and no-show before end', () => {
		expect(() =>
			assertCanTransitionAppointment({
				currentStatus: 'reserved',
				nextStatus: 'attended',
				startsAt: new Date('2026-05-13T13:00:00.000Z'),
				endsAt: new Date('2026-05-13T14:00:00.000Z'),
				now
			})
		).toThrow('APPOINTMENT_CANNOT_ATTEND_IN_FUTURE');

		expect(() =>
			assertCanTransitionAppointment({
				currentStatus: 'reserved',
				nextStatus: 'no_show',
				startsAt: new Date('2026-05-13T11:30:00.000Z'),
				endsAt: new Date('2026-05-13T12:30:00.000Z'),
				now
			})
		).toThrow('APPOINTMENT_CANNOT_NO_SHOW_BEFORE_END');
	});
});

describe('appointment error messages', () => {
	it('maps overlap and domain errors to human messages', () => {
		expect(getHumanAppointmentErrorMessage({ code: '23P01' })).toBe('Ese horario ya fue tomado.');
		expect(getHumanAppointmentErrorMessage(new Error('PROFESSIONAL_SERVICE_NOT_ASSIGNED'))).toBe(
			'Este profesional no ofrece ese servicio.'
		);
		expect(getHumanAppointmentErrorMessage(new Error('PATIENT_BLOCKED'))).toBe(
			'Ese paciente está bloqueado.'
		);
	});
});
