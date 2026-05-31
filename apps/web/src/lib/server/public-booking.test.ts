import { describe, expect, it } from 'vitest';
import { getPublicBookingErrorMessage, summarizeSlotsByDate } from './public-booking';
import type { AvailabilitySlot } from './availability';

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
});
