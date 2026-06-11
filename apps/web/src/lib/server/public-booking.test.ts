import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	addDaysToDateString,
	clearPublicBookingScanCache,
	getPublicBookingErrorMessage,
	loadPublicBookingState,
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
			'Ese horario ya fue reservado. Elegí otro horario disponible.'
		);
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

const createSupabaseMock = () => ({
	from: (table: string) => ({
		select: (columns: string) => {
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
				return queryBuilder([{ id: 'pro-1', is_active: true, is_public: true }]);
			}
			if (table === 'professional_services') {
				if (columns.includes('professionals!inner')) {
					return queryBuilder([
						{
							professional_id: 'pro-1',
							professionals: {
								id: 'pro-1',
								name: 'Dra. Uno',
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
