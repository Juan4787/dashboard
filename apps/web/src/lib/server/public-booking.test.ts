import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	assertPublicBookingPatientPolicy,
	addDaysToDateString,
	clearPublicBookingScanCache,
	getPublicBookingErrorCode,
	getPublicBookingErrorMessage,
	loadPublicBookingState,
	PUBLIC_BOOKING_ERROR_MESSAGES,
	summarizeSlotsByDate,
	todayForBusiness
} from './public-booking';
import type { AvailabilitySlot } from './availability';

const { getAvailabilitySlotsMock } = vi.hoisted(() => ({ getAvailabilitySlotsMock: vi.fn() }));

vi.mock('./availability', async (importOriginal) => {
	const original = await importOriginal<typeof import('./availability')>();
	return { ...original, getAvailabilitySlots: getAvailabilitySlotsMock };
});

describe('public booking UX helpers', () => {
	it('usa un mensaje claro cuando el horario público ya no está disponible', () => {
		expect(getPublicBookingErrorMessage(new Error('PUBLIC_SLOT_UNAVAILABLE'))).toBe(
			'Ese horario acaba de ser ocupado. Elegí otro de los horarios disponibles.'
		);
	});

	it.each([
		['PUBLIC_RATE_LIMIT_IP', 'PUBLIC_RATE_LIMIT_IP'],
		['PUBLIC_RATE_LIMIT_PHONE', 'PUBLIC_RATE_LIMIT_PHONE'],
		['PUBLIC_BOOKING_ACTIVE_LIMIT', 'PUBLIC_BOOKING_ACTIVE_LIMIT'],
		['PUBLIC_BOOKING_BLOCKED_PATIENT', 'PUBLIC_BOOKING_BLOCKED_PATIENT'],
		['PATIENT_BLOCKED', 'PUBLIC_BOOKING_BLOCKED_PATIENT'],
		['PUBLIC_CAPTCHA_REQUIRED', 'PUBLIC_CAPTCHA_REQUIRED'],
		['PUBLIC_CAPTCHA_FAILED', 'PUBLIC_CAPTCHA_FAILED'],
		['PATIENT_NAME_ALREADY_EXISTS', 'PATIENT_NAME_ALREADY_EXISTS'],
		['PATIENT_DNI_ALREADY_EXISTS', 'PATIENT_DNI_ALREADY_EXISTS'],
		['SERVICE_NOT_FOUND', 'SERVICE_NOT_FOUND'],
		['PROFESSIONAL_NOT_FOUND', 'PROFESSIONAL_NOT_FOUND'],
		['PROFESSIONAL_SERVICE_NOT_ASSIGNED', 'PROFESSIONAL_SERVICE_NOT_ASSIGNED']
	] as const)('no confunde la causa técnica %s con otro mensaje', (technicalCode, expectedCode) => {
		const error = new Error(technicalCode);
		expect(getPublicBookingErrorCode(error)).toBe(expectedCode);
		expect(getPublicBookingErrorMessage(error)).toBe(PUBLIC_BOOKING_ERROR_MESSAGES[expectedCode]);
	});

	it('mantiene distintos y accionables todos los mensajes visibles', () => {
		const messages = Object.values(PUBLIC_BOOKING_ERROR_MESSAGES);
		expect(new Set(messages).size).toBe(messages.length);
		for (const message of messages) {
			expect(message).not.toMatch(/PUBLIC_|patient_id|appointments_|rate.?limit/i);
		}
		expect(PUBLIC_BOOKING_ERROR_MESSAGES.PUBLIC_BOOKING_ACTIVE_LIMIT).toContain('4 turnos');
		expect(PUBLIC_BOOKING_ERROR_MESSAGES.PUBLIC_BOOKING_ACTIVE_LIMIT).toContain('a futuro');
		expect(PUBLIC_BOOKING_ERROR_MESSAGES.PUBLIC_BOOKING_ACTIVE_LIMIT).toContain('nombre');
		expect(PUBLIC_BOOKING_ERROR_MESSAGES.PUBLIC_BOOKING_ACTIVE_LIMIT).not.toContain('teléfono');
	});

	it('resume días con nombres completos y sin repetir disponibilidad por cada día', () => {
		const slots: AvailabilitySlot[] = [
			{
				date: '2026-06-03',
				time: '09:00',
				starts_at: '2026-06-03T12:00:00.000Z',
				ends_at: '2026-06-03T12:30:00.000Z',
				professional_id: 'professional-1',
				professional_name: 'Profesional'
			},
			{
				date: '2026-06-03',
				time: '09:30',
				starts_at: '2026-06-03T12:30:00.000Z',
				ends_at: '2026-06-03T13:00:00.000Z',
				professional_id: 'professional-1',
				professional_name: 'Profesional'
			}
		];

		const days = summarizeSlotsByDate(slots, 'America/Argentina/Buenos_Aires');
		expect(days).toEqual([{ date: '2026-06-03', label: 'Miércoles 3 de junio', count: 2 }]);
	});

	it('ordena los días cronológicamente aunque los slots lleguen desordenados', () => {
		const slotFor = (date: string): AvailabilitySlot => ({
			date,
			time: '09:00',
			starts_at: `${date}T12:00:00.000Z`,
			ends_at: `${date}T12:30:00.000Z`,
			professional_id: 'professional-1',
			professional_name: 'Profesional'
		});
		const days = summarizeSlotsByDate(
			[slotFor('2026-06-20'), slotFor('2026-06-03'), slotFor('2026-06-10')],
			'America/Argentina/Buenos_Aires'
		);
		expect(days.map((day) => day.date)).toEqual(['2026-06-03', '2026-06-10', '2026-06-20']);
	});
});

const createPatientPolicyMock = (input: {
	patient: { id: string; blocked: boolean } | null;
	activeFutureCount?: number;
}) => {
	const calls: Array<{
		table?: string;
		method: string;
		column?: string;
		value?: unknown;
		fn?: string;
		args?: Record<string, unknown>;
	}> = [];
	const supabase = {
		rpc: async (fn: string, args: Record<string, unknown>) => {
			calls.push({ method: 'rpc', fn, args });
			return { data: input.activeFutureCount ?? 0, error: null };
		},
		from: (table: string) => ({
			select: () => {
				const query = {
					eq: (column: string, value: unknown) => {
						calls.push({ table, method: 'eq', column, value });
						return query;
					},
					maybeSingle: async () => ({ data: input.patient, error: null })
				};
				return query;
			}
		})
	};
	return { supabase: supabase as never, calls };
};

describe('public booking patient capacity', () => {
	const now = new Date('2026-07-10T15:00:00.000Z');

	it('permite el cuarto turno activo futuro', async () => {
		const { supabase } = createPatientPolicyMock({
			patient: { id: 'patient-1', blocked: false },
			activeFutureCount: 3
		});

		await expect(
			assertPublicBookingPatientPolicy(supabase, {
				businessId: 'business-1',
				patientName: 'Ana Gomez',
				phoneE164: '+5493515550000',
				now
			})
		).resolves.toBeUndefined();
	});

	it('rechaza inequívocamente el quinto turno activo futuro', async () => {
		const { supabase } = createPatientPolicyMock({
			patient: { id: 'patient-1', blocked: false },
			activeFutureCount: 4
		});

		await expect(
			assertPublicBookingPatientPolicy(supabase, {
				businessId: 'business-1',
				patientName: 'Ana Gomez',
				phoneE164: '+5493515550000',
				now
			})
		).rejects.toThrow('PUBLIC_BOOKING_ACTIVE_LIMIT');
	});

	it('consulta el cupo por nombre y no usa el teléfono como identidad', async () => {
		const { supabase, calls } = createPatientPolicyMock({
			patient: null,
			activeFutureCount: 0
		});

		await assertPublicBookingPatientPolicy(supabase, {
			businessId: 'business-1',
			patientName: '  Ana   Gomez  ',
			phoneE164: '+5493515559999',
			now
		});

		expect(calls).toContainEqual({
			method: 'rpc',
			fn: 'get_public_booking_active_future_count_by_name',
			args: {
				p_business_id: 'business-1',
				p_patient_name: '  Ana   Gomez  ',
				p_now: now.toISOString()
			}
		});
		expect(
			calls.some(
				(call) => call.table === 'appointments' || call.column === 'patient_id'
			)
		).toBe(false);
	});

	it('informa por separado cuando la ficha está bloqueada', async () => {
		const { supabase } = createPatientPolicyMock({
			patient: { id: 'patient-1', blocked: true }
		});

		await expect(
			assertPublicBookingPatientPolicy(supabase, {
				businessId: 'business-1',
				patientName: 'Ana Gomez',
				phoneE164: '+5493515550000',
				now
			})
		).rejects.toThrow('PUBLIC_BOOKING_BLOCKED_PATIENT');
	});
});

// ---------------------------------------------------------------------------
// loadPublicBookingState: el flujo navega la misma URL varias veces; estos tests
// fijan el contrato de performance (caché + reuso del escaneo de días).
// ---------------------------------------------------------------------------

const business = {
	id: 'biz-1',
	name: 'Consultorio Test',
	slug: 'consultorio-test',
	phone: null,
	address: 'Av. Test 123',
	address_instructions: null,
	maps_url: null,
	logo_url: null,
	timezone: 'America/Argentina/Cordoba',
	public_booking_enabled: true,
	is_active: true,
	created_at: '2026-01-01T00:00:00.000Z',
	min_booking_notice_minutes: 0,
	max_booking_days_ahead: 30,
	cancellation_policy: null
};

const subscription = {
	id: 'sub-1',
	business_id: 'biz-1',
	commercial_access_enabled: true,
	is_permanent: true,
	subscription_status: 'active',
	paid_until: null,
	grace_until: null,
	restricted_until: null,
	archived_at: null,
	expiration_notice_enabled: false
};

const queryBuilder = (data: unknown) => {
	const builder: Record<string, unknown> = {};
	for (const method of ['eq', 'in', 'gte', 'lte', 'lt', 'or', 'order', 'limit', 'is', 'neq', 'not']) {
		builder[method] = () => builder;
	}
	builder.maybeSingle = async () => ({ data, error: null });
	builder.single = async () => ({ data, error: null });
	(builder as { then: unknown }).then = (resolve: (value: unknown) => unknown) =>
		resolve({ data, error: null });
	return builder;
};

const createSupabaseMock = (overrides: { professionalName?: string } = {}) => ({
	from: (table: string) => ({
		select: (columns: string) => {
			const professionalName = overrides.professionalName ?? 'Dra. Uno';
			if (table === 'businesses') return queryBuilder(business);
			if (table === 'business_subscriptions') return queryBuilder(subscription);
			if (table === 'services') {
				return queryBuilder([
					{
						id: 'svc-1',
						name: 'Consulta',
						description: null,
						duration_minutes: 30,
						price_label: null,
						is_active: true,
						is_public: true,
						sort_order: 0
					}
				]);
			}
			if (table === 'professionals') {
				return queryBuilder([{ id: 'pro-1', name: professionalName, is_active: true, is_public: true }]);
			}
			if (table === 'professional_services') {
				if (columns.includes('professionals!inner')) {
					return queryBuilder([
						{
							professional_id: 'pro-1',
							professionals: {
								id: 'pro-1',
								name: professionalName,
								specialty: null,
								avatar_url: null,
								is_active: true,
								is_public: true,
								sort_order: 0
							}
						}
					]);
				}
				return queryBuilder([{ service_id: 'svc-1', professional_id: 'pro-1' }]);
			}
			return queryBuilder([]);
		}
	})
});

const slotsForRange = (fromDate: string, toDate: string): AvailabilitySlot[] => {
	const slots: AvailabilitySlot[] = [];
	let cursor = fromDate;
	while (cursor <= toDate) {
		slots.push({
			date: cursor,
			time: '10:00',
			starts_at: `${cursor}T13:00:00.000Z`,
			ends_at: `${cursor}T13:30:00.000Z`,
			professional_id: 'pro-1',
			professional_name: 'Dra. Uno'
		});
		cursor = addDaysToDateString(cursor, 1);
	}
	return slots;
};

describe('loadPublicBookingState (performance del flujo público)', () => {
	beforeEach(() => {
		clearPublicBookingScanCache();
		getAvailabilitySlotsMock.mockReset();
		getAvailabilitySlotsMock.mockImplementation(
			async (_supabase: unknown, input: { fromDate: string; toDate: string }) =>
				slotsForRange(input.fromDate, input.toDate)
		);
	});

	it('la fecha elegida dentro del rango escaneado se filtra sin query extra', async () => {
		const supabase = createSupabaseMock() as never;
		const today = todayForBusiness(business);
		const date = addDaysToDateString(today, 2);

		const state = await loadPublicBookingState(supabase, {
			slug: business.slug,
			serviceId: 'svc-1',
			professionalId: 'pro-1',
			date
		});

		expect(state.issue).toBeNull();
		expect(state.slots).toHaveLength(1);
		expect(state.slots[0]?.date).toBe(date);
		// 1 escaneo para next_available de profesionales + 1 escaneo de días.
		// La fecha puntual NO dispara una tercera llamada: se filtra del escaneo.
		expect(getAvailabilitySlotsMock).toHaveBeenCalledTimes(2);
		const dates = state.days.map((day) => day.date);
		expect(dates).toEqual([...dates].sort());
	});

	it('no ofrece profesionales públicos sin nombre visible', async () => {
		const supabase = createSupabaseMock({ professionalName: '   ' }) as never;

		const state = await loadPublicBookingState(supabase, {
			slug: business.slug,
			serviceId: 'svc-1'
		});

		expect(state.issue).toBe('no_services');
		expect(state.professionals).toEqual([]);
		expect(getAvailabilitySlotsMock).not.toHaveBeenCalled();
	});

	it('navegar de nuevo con la misma selección reusa el caché (cero escaneos nuevos)', async () => {
		const supabase = createSupabaseMock() as never;
		const today = todayForBusiness(business);
		const date = addDaysToDateString(today, 2);
		const input = { slug: business.slug, serviceId: 'svc-1', professionalId: 'pro-1', date };

		await loadPublicBookingState(supabase, input);
		const callsAfterFirst = getAvailabilitySlotsMock.mock.calls.length;
		const second = await loadPublicBookingState(supabase, input);

		expect(second.issue).toBeNull();
		expect(getAvailabilitySlotsMock).toHaveBeenCalledTimes(callsAfterFirst);
	});

	it('una fecha fuera del rango escaneado consulta solo ese día puntual', async () => {
		const supabase = createSupabaseMock() as never;
		const today = todayForBusiness(business);
		const farDate = addDaysToDateString(today, 20);

		const state = await loadPublicBookingState(supabase, {
			slug: business.slug,
			serviceId: 'svc-1',
			professionalId: 'pro-1',
			date: farDate
		});

		expect(state.issue).toBeNull();
		expect(state.slots).toHaveLength(1);
		expect(state.slots[0]?.date).toBe(farDate);
		expect(getAvailabilitySlotsMock).toHaveBeenCalledTimes(3);
		const lastCall = getAvailabilitySlotsMock.mock.calls.at(-1)?.[1] as {
			fromDate: string;
			toDate: string;
		};
		expect(lastCall.fromDate).toBe(farDate);
		expect(lastCall.toDate).toBe(farDate);
		// El día lejano se integra ordenado a la lista de días.
		const dates = state.days.map((day) => day.date);
		expect(dates).toEqual([...dates].sort());
		expect(dates).toContain(farDate);
	});
});
