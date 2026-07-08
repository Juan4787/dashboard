import { describe, expect, it } from 'vitest';
import {
	canonicalScheduleBlocks,
	scheduleBlocksFromRules,
	validateScheduleBlocks
} from './schedule-blocks';

describe('schedule blocks', () => {
	it('permite bloques estructurales con días y horarios distintos', () => {
		const result = validateScheduleBlocks([
			{ weekdays: [1, 3, 5], timeRanges: '8 a 15', slotInterval: '15' },
			{ weekdays: [6], timeRanges: '9 a 13', slotInterval: '15' }
		]);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.blocks).toEqual([
			{ weekdays: [1, 3, 5], ranges: [{ start: '08:00', end: '15:00' }], slotIntervalMinutes: 15 },
			{ weekdays: [6], ranges: [{ start: '09:00', end: '13:00' }], slotIntervalMinutes: 15 }
		]);
	});

	it('rechaza el mismo día en más de un bloque para evitar reemplazos ambiguos', () => {
		const result = validateScheduleBlocks([
			{ weekdays: [1, 2, 3, 4, 5, 6], timeRanges: '8 a 15', slotInterval: '15' },
			{ weekdays: [6], timeRanges: '9 a 13', slotInterval: '15' }
		]);

		expect(result).toMatchObject({
			ok: false,
			message: 'Un día no puede estar en dos bloques. Revisá los bloques 1 y 2.'
		});
	});

	it('agrupa reglas existentes por conjunto de días con la misma franja', () => {
		const blocks = scheduleBlocksFromRules([
			{ weekday: 1, start_time: '08:00:00', end_time: '15:00:00', slot_interval_minutes: 15 },
			{ weekday: 5, start_time: '08:00:00', end_time: '15:00:00', slot_interval_minutes: 15 },
			{ weekday: 6, start_time: '09:00:00', end_time: '13:00:00', slot_interval_minutes: 15 }
		]);

		expect(blocks).toEqual([
			{ id: 'block-1', weekdays: [1, 5], timeRanges: '08:00-15:00', slotInterval: '15' },
			{ id: 'block-2', weekdays: [6], timeRanges: '09:00-13:00', slotInterval: '15' }
		]);
	});

	it('canoniza bloques equivalentes aunque vengan con sintaxis horaria distinta', () => {
		expect(
			canonicalScheduleBlocks([{ weekdays: [5, 1], timeRanges: '8 a 15', slotInterval: '15' }])
		).toBe(canonicalScheduleBlocks([{ weekdays: [1, 5], timeRanges: '08:00-15:00', slotInterval: '15' }]));
	});
});

