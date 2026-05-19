import { describe, expect, it } from 'vitest';
import { addMinutes, overlaps, zonedDateTimeToUtc } from './availability';

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
});
