import { describe, expect, it } from 'vitest';
import {
	assertCanTransitionAppointment,
	getHumanAppointmentErrorMessage,
	rescheduleAppointment
} from './appointments';

// Mock mínimo de supabase para rescheduleAppointment: captura el payload del update.
const createRescheduleMock = (appointmentRow: Record<string, unknown>) => {
	const updates: Record<string, unknown>[] = [];
	const supabase = {
		from: (table: string) => {
			if (table === 'appointments') {
				return {
					select: () => ({
						eq: () => ({
							eq: () => ({
								maybeSingle: async () => ({ data: appointmentRow, error: null })
							})
						})
					}),
					update: (payload: Record<string, unknown>) => {
						updates.push(payload);
						return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
					}
				};
			}
			if (table === 'services') {
				return {
					select: () => ({
						eq: () => ({
							eq: () => ({
								maybeSingle: async () => ({
									data: { duration_minutes: 30, is_active: true },
									error: null
								})
							})
						})
					})
				};
			}
			return { insert: async () => ({ error: null }) };
		}
	};
	return { supabase: supabase as any, updates };
};

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
		expect(getHumanAppointmentErrorMessage({ code: '23P01' })).toBe(
			'Ese horario ya fue reservado. Elegí otro horario disponible.'
		);
		expect(getHumanAppointmentErrorMessage(new Error('PROFESSIONAL_SERVICE_NOT_ASSIGNED'))).toBe(
			'Este profesional no ofrece ese servicio.'
		);
		expect(getHumanAppointmentErrorMessage(new Error('PATIENT_BLOCKED'))).toBe(
			'Ese paciente está bloqueado.'
		);
	});
});

describe('rescheduleAppointment y versionado de calendario', () => {
	const baseRow = {
		id: 'apt-1',
		service_id: 'svc-1',
		professional_id: 'pro-1',
		starts_at: '2026-06-15T17:30:00.000Z',
		ends_at: '2026-06-15T18:00:00.000Z',
		status: 'confirmed'
	};
	const newStart = new Date('2026-06-20T14:00:00.000Z');

	it('incrementa calendar_sequence y marca pendiente de actualizar si hubo acción', async () => {
		const { supabase, updates } = createRescheduleMock({
			...baseRow,
			calendar_sequence: 1,
			calendar_action_count: 2
		});
		await rescheduleAppointment(supabase, {
			businessId: 'biz-1',
			appointmentId: 'apt-1',
			userId: 'user-1',
			startsAt: newStart,
			now
		});
		expect(updates).toHaveLength(1);
		expect(updates[0].calendar_sequence).toBe(2);
		expect(updates[0].calendar_update_required_at).toBe(now.toISOString());
	});

	it('incrementa sequence pero NO marca actualización si nunca hubo acción', async () => {
		const { supabase, updates } = createRescheduleMock({
			...baseRow,
			calendar_sequence: 0,
			calendar_action_count: 0
		});
		await rescheduleAppointment(supabase, {
			businessId: 'biz-1',
			appointmentId: 'apt-1',
			userId: 'user-1',
			startsAt: newStart,
			now
		});
		expect(updates[0].calendar_sequence).toBe(1);
		expect(updates[0].calendar_update_required_at).toBeNull();
	});

	it('rechaza reprogramar turnos terminales', async () => {
		const { supabase } = createRescheduleMock({
			...baseRow,
			status: 'cancelled',
			calendar_sequence: 0,
			calendar_action_count: 0
		});
		await expect(
			rescheduleAppointment(supabase, {
				businessId: 'biz-1',
				appointmentId: 'apt-1',
				userId: 'user-1',
				startsAt: newStart,
				now
			})
		).rejects.toThrow('APPOINTMENT_CANNOT_RESCHEDULE');
	});
});
