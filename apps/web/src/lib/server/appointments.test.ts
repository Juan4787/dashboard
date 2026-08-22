import { describe, expect, it } from 'vitest';
import {
	assertCanTransitionAppointment,
	createJointAppointment,
	createOrFindPatientForAppointment,
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
		const overlapMessage = getHumanAppointmentErrorMessage({ code: '23P01' });
		expect(overlapMessage).toContain('al menos uno de los profesionales');
		expect(overlapMessage).toContain('No se reservó a ningún integrante');
		expect(overlapMessage).toContain('elegí otra opción disponible');
		expect(getHumanAppointmentErrorMessage(new Error('PROFESSIONAL_SERVICE_NOT_ASSIGNED'))).toBe(
			'Al menos uno de los profesionales seleccionados no está habilitado para este procedimiento. Volvé al paso del equipo, quitá a ese profesional o asignale el procedimiento desde su configuración.'
		);
		expect(getHumanAppointmentErrorMessage(new Error('PATIENT_BLOCKED'))).toContain(
			'Revisá su ficha'
		);
	});
});

describe('patient identity during appointment creation', () => {
	it('conserva el texto de un teléfono inválido sin usarlo como identidad ni WhatsApp', async () => {
		const inserted: Record<string, unknown>[] = [];
		let lookups = 0;
		const supabase = {
			from: (table: string) => {
				if (table !== 'patients') throw new Error(`Tabla inesperada: ${table}`);
				return {
					select: () => {
						lookups += 1;
						throw new Error('No debía buscar identidad por un teléfono inválido');
					},
					insert: async (payload: Record<string, unknown>) => {
						inserted.push(payload);
						return { error: null };
					}
				};
			}
		};

		await createOrFindPatientForAppointment(supabase as never, {
			businessId: 'business-1',
			ownerId: 'owner-1',
			name: 'Paciente nuevo',
			phone: '123',
			communicationPhoneE164: null
		});

		expect(lookups).toBe(0);
		expect(inserted).toHaveLength(1);
		expect(inserted[0]).toMatchObject({
			phone: '123',
			phone_raw: '123',
			phone_e164: null
		});
	});

	it('reutiliza la ficha creada por otra reserva simultánea con el mismo teléfono', async () => {
		let lookups = 0;
		let inserts = 0;
		const supabase = {
			from: (table: string) => {
				if (table !== 'patients') throw new Error(`Tabla inesperada: ${table}`);
				return {
					select: () => {
						const query: any = {
							eq: () => query,
							maybeSingle: async () => {
								lookups += 1;
								return lookups === 1
									? { data: null, error: null }
									: { data: { id: 'patient-concurrent', blocked: false }, error: null };
							}
						};
						return query;
					},
					insert: async () => {
						inserts += 1;
						return {
							error: {
								code: '23505',
								message:
									'duplicate key value violates unique constraint "patients_business_phone_e164_uq"'
							}
						};
					}
				};
			}
		};

		const patientId = await createOrFindPatientForAppointment(supabase as never, {
			businessId: 'business-1',
			ownerId: 'owner-1',
			name: 'Juan Carlos',
			phone: '351 555 0000'
		});

		expect(patientId).toBe('patient-concurrent');
		expect(lookups).toBe(2);
		expect(inserts).toBe(1);
	});
});

describe('joint appointment creation', () => {
	const createExistingPatientJointMock = () => {
		const rpcCalls: Array<{ name: string; payload: Record<string, unknown> }> = [];
		let tableReads = 0;
		const supabase = {
			from: (table: string) => {
				tableReads += 1;
				if (table !== 'patients') throw new Error(`Tabla inesperada: ${table}`);
				return {
					select: () => {
						const query: any = {
							eq: () => query,
							maybeSingle: async () => ({
								data: { id: 'patient-1', blocked: false },
								error: null
							})
						};
						return query;
					}
				};
			},
			rpc: (name: string, payload: Record<string, unknown>) => {
				rpcCalls.push({ name, payload });
				return {
					single: async () => ({
						data: {
							id: 'appointment-1',
							professional_name_snapshot: 'Dra. Uno, Dr. Dos'
						},
						error: null
					})
				};
			}
		};
		return { supabase: supabase as never, rpcCalls, getTableReads: () => tableReads };
	};

	it('envía una sola operación atómica con todo el equipo y la excepción de descanso', async () => {
		const { supabase, rpcCalls } = createExistingPatientJointMock();

		const created = await createJointAppointment(supabase, {
			businessId: 'business-1',
			createdByUserId: 'user-1',
			patientId: 'patient-1',
			serviceId: 'service-1',
			professionalIds: ['professional-1', 'professional-2'],
			startsAt: new Date('2026-07-30T13:00:00.000Z'),
			ignoreBreak: true
		});

		expect(created.id).toBe('appointment-1');
		expect(rpcCalls).toEqual([
			{
					name: 'create_joint_appointment_with_phone_decision',
				payload: {
					p_business_id: 'business-1',
					p_patient_id: 'patient-1',
					p_service_id: 'service-1',
					p_professional_ids: ['professional-1', 'professional-2'],
					p_starts_at: '2026-07-30T13:00:00.000Z',
					p_internal_note: null,
					p_created_by_user_id: 'user-1',
					p_ignore_break: true,
						p_source: 'manual',
						p_phone_communication_status: 'unknown',
						p_phone_warning_acknowledged: false
				}
			}
		]);
	});

	it('no toca pacientes ni crea el turno si falta aceptar la advertencia del teléfono', async () => {
		const { supabase, rpcCalls, getTableReads } = createExistingPatientJointMock();

		await expect(
			createJointAppointment(supabase, {
				businessId: 'business-1',
				patientId: 'patient-1',
				patientPhone: '123',
				serviceId: 'service-1',
				professionalIds: ['professional-1', 'professional-2'],
				startsAt: new Date('2026-07-30T13:00:00.000Z'),
				phoneCommunicationStatus: 'invalid'
			})
		).rejects.toThrow('PHONE_WARNING_ACKNOWLEDGEMENT_REQUIRED');
		expect(getTableReads()).toBe(0);
		expect(rpcCalls).toHaveLength(0);
	});

	it('persiste la aceptación explícita y no permite declarar válido un número inválido', async () => {
		const acknowledged = createExistingPatientJointMock();
		await createJointAppointment(acknowledged.supabase, {
			businessId: 'business-1',
			patientId: 'patient-1',
			patientPhone: '123',
			serviceId: 'service-1',
			professionalIds: ['professional-1', 'professional-2'],
			startsAt: new Date('2026-07-30T13:00:00.000Z'),
			phoneCommunicationStatus: 'invalid',
			phoneWarningAcknowledged: true
		});
		expect(acknowledged.rpcCalls[0]?.payload).toMatchObject({
			p_phone_communication_status: 'invalid',
			p_phone_warning_acknowledged: true
		});

		const forged = createExistingPatientJointMock();
		await expect(
			createJointAppointment(forged.supabase, {
				businessId: 'business-1',
				patientId: 'patient-1',
				patientPhone: '123',
				serviceId: 'service-1',
				professionalIds: ['professional-1', 'professional-2'],
				startsAt: new Date('2026-07-30T13:00:00.000Z'),
				phoneCommunicationStatus: 'valid'
			})
		).rejects.toThrow('PHONE_COMMUNICATION_STATUS_MISMATCH');
		expect(forged.getTableReads()).toBe(0);
	});

	it('mantiene compatibles las reservas públicas con teléfonos externos no clasificables', async () => {
		const { supabase, rpcCalls } = createExistingPatientJointMock();
		await createJointAppointment(supabase, {
			businessId: 'business-1',
			patientId: 'patient-1',
			patientPhone: '+598 99 123 456',
			serviceId: 'service-1',
			professionalIds: ['professional-1', 'professional-2'],
			startsAt: new Date('2026-07-30T13:00:00.000Z'),
			source: 'public_booking'
		});

		expect(rpcCalls[0]?.payload).toMatchObject({
			p_source: 'public_booking',
			p_phone_communication_status: 'unknown',
			p_phone_warning_acknowledged: false
		});
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

	it('vuelve a respetar el descanso salvo que la nueva reprogramación lo ignore explícitamente', async () => {
		const { supabase, updates } = createRescheduleMock({
			...baseRow,
			ignore_break: true,
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
		expect(updates[0].ignore_break).toBe(false);
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
