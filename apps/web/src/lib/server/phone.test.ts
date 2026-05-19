import { describe, expect, it } from 'vitest';
import { isLikelyPhoneE164, normalizePhoneE164 } from './phone';

describe('normalizePhoneE164', () => {
	it('normaliza variantes argentinas del mismo móvil', () => {
		expect(normalizePhoneE164('3511234567')).toBe('+5493511234567');
		expect(normalizePhoneE164('+543511234567')).toBe('+5493511234567');
		expect(normalizePhoneE164('+5493511234567')).toBe('+5493511234567');
	});

	it('devuelve null para entradas vacías', () => {
		expect(normalizePhoneE164('')).toBeNull();
		expect(normalizePhoneE164(null)).toBeNull();
	});
});

describe('isLikelyPhoneE164', () => {
	it('acepta teléfonos normalizados con longitud internacional razonable', () => {
		expect(isLikelyPhoneE164('+5493511234567')).toBe(true);
		expect(isLikelyPhoneE164('3511234567')).toBe(true);
	});

	it('rechaza valores demasiado cortos o vacíos', () => {
		expect(isLikelyPhoneE164('123')).toBe(false);
		expect(isLikelyPhoneE164('')).toBe(false);
		expect(isLikelyPhoneE164(null)).toBe(false);
	});
});
