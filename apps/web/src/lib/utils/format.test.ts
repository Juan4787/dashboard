import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatInTimeZone } from './format';

// Caso que rompía sin timezone: 21:30 ART = 00:30 UTC del día SIGUIENTE.
// En SSR (Netlify corre en UTC) la fecha aparecía corrida un día.
const lateEvening = '2026-06-16T00:30:00.000Z';

describe('formatDateTime con timezone', () => {
	it('muestra la hora local del negocio aunque cruce medianoche UTC', () => {
		const label = formatDateTime(lateEvening, 'America/Argentina/Cordoba');
		expect(label).toContain('15 de junio');
		expect(label).toContain('21:30');
	});

	it('sin timezone mantiene el comportamiento previo (zona del runtime)', () => {
		expect(formatDateTime(lateEvening)).toBeTruthy();
		expect(formatDateTime(null)).toBe('');
	});
});

describe('formatDate con timezone', () => {
	it('respeta la fecha local del negocio', () => {
		expect(formatDate(lateEvening, 'America/Argentina/Cordoba')).toContain('15 de junio');
	});
});

describe('formatInTimeZone', () => {
	it('devuelve etiquetas de día y hora en la zona del negocio', () => {
		const labels = formatInTimeZone(lateEvening, 'America/Argentina/Cordoba');
		expect(labels.dateLabel).toContain('15 de junio');
		expect(labels.timeLabel).toBe('21:30');
		expect(labels.full).toBe(`${labels.dateLabel} a las ${labels.timeLabel}`);
	});
});
