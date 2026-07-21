import { describe, expect, it, vi } from 'vitest';
import {
	addMinutes,
	calculateAvailabilitySlots,
	getAvailabilitySlots,
	overlaps,
	zonedDateTimeToUtc
} from './availability';

const business = {
	id: 'biz-1',
	timezone: 'America/Argentina/Cordoba',
	is_active: true,
	public_booking_enabled: true,
	min_booking_notice_minutes: 0,
	max_booking_days_ahead: 30
};

const queryBuilder = (data: unknown) => {
	const builder: Record<string, unknown> = {};
	for (const method of ['eq', 'in', 'lt', 'gt', 'neq']) {
		builder[method] = () => builder;
	}
	builder.maybeSingle = async () => ({ data, error: null });
	(builder as { then: unknown }).then = (resolve: (value: unknown) => unknown) =>
		resolve({ data, error: null });
	return builder;
};

const supabaseForAvailability = (input: {
	professionalName: string;
	rules: unknown[];
	exceptions?: unknown[];
}) => ({
	from: (table: string) => ({
		select: () => {
			if (table === 'services') {
				return queryBuilder({
					id: 'svc-1',
					business_id: business.id,
					name: 'Consulta',
					duration_minutes: 30,
					buffer_before_minutes: 0,
					buffer_after_minutes: 0,
					is_public: true,
					is_active: true
				});
			}
			if (table === 'professional_services') {
				return queryBuilder([
					{
						professional_id: 'pro-1',
						professionals: {
							id: 'pro-1',
							name: input.professionalName,
							is_public: true,
							is_active: true
						}
					}
				]);
			}
			if (table === 'availability_rules') return queryBuilder(input.rules);
			if (table === 'availability_exceptions') return queryBuilder(input.exceptions ?? []);
			if (table === 'appointments') return queryBuilder([]);
			return queryBuilder([]);
		}
	})
});

describe('availability core', () => {
	it('detecta solapamientos con rango semiabierto', () => {
		const base = new Date('2026-05-13T10:00:00.000Z');
		expect(overlaps(base, addMinutes(base, 60), addMinutes(base, 15), addMinutes(base, 45))).toBe(true);
		expect(overlaps(base, addMinutes(base, 60), addMinutes(base, 60), addMinutes(base, 90))).toBe(false);
		expect(overlaps(base, addMinutes(base, 60), addMinutes(base, -30), base)).toBe(false);
	});

	it('convierte fecha/hora de Argentina a UTC sin depender del timezone del servidor', () => {
		const utc = zonedDateTimeToUtc('2026-05-13', '09:30', 'America/Argentina/Cordoba');
		expect(utc.toISOString()).toBe('2026-05-13T12:30:00.000Z');
	});

	it('el atajo de primera disponibilidad conserva el horario más temprano aunque las reglas estén desordenadas', () => {
		const slots = calculateAvailabilitySlots({
			business: business as never,
			service: {
				id: 'svc-1',
				business_id: business.id,
				name: 'Consulta',
				duration_minutes: 30,
				buffer_before_minutes: 0,
				buffer_after_minutes: 0,
				is_public: true,
				is_active: true
			},
			professionals: [{ id: 'pro-1', name: 'Dra. Uno', is_public: true, is_active: true }],
			rules: [
				{
					id: 'late',
					professional_id: 'pro-1',
					weekday: 1,
					start_time: '11:00',
					end_time: '12:00',
					slot_interval_minutes: 30,
					is_active: true
				},
				{
					id: 'early',
					professional_id: 'pro-1',
					weekday: 1,
					start_time: '09:00',
					end_time: '10:00',
					slot_interval_minutes: 30,
					is_active: true
				}
			],
			exceptions: [],
			blocks: [],
			fromDate: '2026-06-22',
			toDate: '2026-06-22',
			publicOnly: true,
			now: new Date('2026-06-20T12:00:00.000Z'),
			maxSlots: 1
		});

		expect(slots.map((slot) => slot.time)).toEqual(['09:00']);
	});

	it('no genera slots públicos para profesionales sin nombre visible', async () => {
		const slots = await getAvailabilitySlots(
			supabaseForAvailability({
				professionalName: '   ',
				rules: [
					{
						id: 'rule-1',
						professional_id: 'pro-1',
						weekday: 1,
						start_time: '09:00',
						end_time: '10:00',
						slot_interval_minutes: 30,
						is_active: true
					}
				]
			}) as never,
			{
				business: business as never,
				serviceId: 'svc-1',
				fromDate: '2026-06-22',
				toDate: '2026-06-22',
				publicOnly: true
			}
		);

		expect(slots).toEqual([]);
	});

	it('no genera slots públicos para profesionales sin horario semanal activo', async () => {
		const slots = await getAvailabilitySlots(
			supabaseForAvailability({
				professionalName: 'Dra. Uno',
				rules: [],
				exceptions: [
					{
						id: 'exc-1',
						professional_id: 'pro-1',
						starts_at: '2026-06-22T12:00:00.000Z',
						ends_at: '2026-06-22T13:00:00.000Z',
						type: 'extra_available'
					}
				]
			}) as never,
			{
				business: business as never,
				serviceId: 'svc-1',
				fromDate: '2026-06-22',
				toDate: '2026-06-22',
				publicOnly: true
			}
		);

		expect(slots).toEqual([]);
	});

	it('bloquea todos los días incluidos en una ausencia de varias fechas', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-20T12:00:00.000Z'));
		try {
			const rules = [1, 2, 3, 4, 5].map((weekday) => ({
				id: `rule-${weekday}`,
				professional_id: 'pro-1',
				weekday,
				start_time: '09:00',
				end_time: '10:00',
				slot_interval_minutes: 30,
				is_active: true
			}));
			const slots = await getAvailabilitySlots(
				supabaseForAvailability({
					professionalName: 'Dra. Uno',
					rules,
					exceptions: [
						{
							id: 'vacaciones-1',
							professional_id: 'pro-1',
							starts_at: '2026-06-22T03:00:00.000Z',
							ends_at: '2026-06-25T03:00:00.000Z',
							type: 'blocked'
						}
					]
				}) as never,
				{
					business: business as never,
					serviceId: 'svc-1',
					fromDate: '2026-06-22',
					toDate: '2026-06-26'
				}
			);

			expect(slots.map((slot) => slot.date)).toEqual([
				'2026-06-25',
				'2026-06-25',
				'2026-06-26',
				'2026-06-26'
			]);
		} finally {
			vi.useRealTimers();
		}
	});
});
