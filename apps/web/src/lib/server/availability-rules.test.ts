import { describe, expect, it } from 'vitest';
import { replaceProfessionalScheduleBlocks } from './availability-rules';

describe('replaceProfessionalScheduleBlocks', () => {
	it('reemplaza todo el set semanal del profesional desde bloques normalizados', async () => {
		const calls: unknown[] = [];
		const deleteBuilder = {
			eq(column: string, value: string) {
				calls.push({ type: 'delete.eq', column, value });
				return deleteBuilder;
			},
			then(resolve: (value: { error: null }) => unknown) {
				return Promise.resolve(resolve({ error: null }));
			}
		};
		const supabase = {
			from(table: string) {
				expect(table).toBe('availability_rules');
				return {
					delete() {
						calls.push({ type: 'delete' });
						return deleteBuilder;
					},
					insert(rows: unknown[]) {
						calls.push({ type: 'insert', rows });
						return Promise.resolve({ error: null });
					}
				};
			}
		};

		await replaceProfessionalScheduleBlocks(supabase as never, {
			businessId: 'biz-1',
			professionalId: 'pro-1',
			blocks: [
				{
					weekdays: [1, 5],
					ranges: [{ start: '08:00', end: '15:00' }],
					slotIntervalMinutes: 15
				},
				{
					weekdays: [6],
					ranges: [{ start: '09:00', end: '13:00' }],
					slotIntervalMinutes: 20
				}
			]
		});

		expect(calls).toEqual([
			{ type: 'delete' },
			{ type: 'delete.eq', column: 'business_id', value: 'biz-1' },
			{ type: 'delete.eq', column: 'professional_id', value: 'pro-1' },
			{
				type: 'insert',
				rows: [
					{
						business_id: 'biz-1',
						professional_id: 'pro-1',
						weekday: 1,
						start_time: '08:00',
						end_time: '15:00',
						slot_interval_minutes: 15,
						is_active: true
					},
					{
						business_id: 'biz-1',
						professional_id: 'pro-1',
						weekday: 5,
						start_time: '08:00',
						end_time: '15:00',
						slot_interval_minutes: 15,
						is_active: true
					},
					{
						business_id: 'biz-1',
						professional_id: 'pro-1',
						weekday: 6,
						start_time: '09:00',
						end_time: '13:00',
						slot_interval_minutes: 20,
						is_active: true
					}
				]
			}
		]);
	});
});

