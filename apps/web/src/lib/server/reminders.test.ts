import { describe, expect, it } from 'vitest';
import {
	buildReminderWhatsAppMessage,
	buildWaMeUrl,
	classifyReminderCoverage,
	localDayWindowUtc
} from './reminders';

const CORDOBA = 'America/Argentina/Cordoba'; // UTC-3, sin DST

describe('localDayWindowUtc', () => {
	// 2026-06-11 02:00 UTC = 2026-06-10 23:00 en Córdoba: el día local NO es el día UTC.
	const now = new Date('2026-06-11T02:00:00.000Z');

	it('hoy: medianoche local correcta aunque el día UTC ya haya cambiado', () => {
		const { start, end } = localDayWindowUtc(now, CORDOBA, 'hoy');
		expect(start.toISOString()).toBe('2026-06-10T03:00:00.000Z');
		expect(end.toISOString()).toBe('2026-06-11T03:00:00.000Z');
	});

	it('mañana: día local siguiente', () => {
		const { start, end } = localDayWindowUtc(now, CORDOBA, 'manana');
		expect(start.toISOString()).toBe('2026-06-11T03:00:00.000Z');
		expect(end.toISOString()).toBe('2026-06-12T03:00:00.000Z');
	});
});

describe('classifyReminderCoverage', () => {
	const base = {
		calendar_action_status: 'not_offered',
		calendar_update_required_at: null,
		has_active_push: false,
		has_active_dispatch: false
	};

	it('sin acción de calendario: sin_calendario (offered NO cuenta como cobertura)', () => {
		expect(classifyReminderCoverage(base)).toBe('sin_calendario');
		expect(classifyReminderCoverage({ ...base, calendar_action_status: 'offered' })).toBe('sin_calendario');
	});

	it('acción registrada: cubierto (no aparece)', () => {
		expect(classifyReminderCoverage({ ...base, calendar_action_status: 'clicked_google' })).toBeNull();
		expect(classifyReminderCoverage({ ...base, calendar_action_status: 'downloaded_ics' })).toBeNull();
	});

	it('reprogramado tras acción: pendiente_actualizar aunque haya acción previa', () => {
		expect(
			classifyReminderCoverage({
				...base,
				calendar_action_status: 'clicked_google',
				calendar_update_required_at: '2026-06-10T12:00:00.000Z'
			})
		).toBe('pendiente_actualizar');
	});

	it('push o dispatch automático activos: cubierto', () => {
		expect(classifyReminderCoverage({ ...base, has_active_push: true })).toBeNull();
		expect(classifyReminderCoverage({ ...base, has_active_dispatch: true })).toBeNull();
	});
});

describe('buildReminderWhatsAppMessage', () => {
	it('arma el mensaje neutral con dirección, maps y link del turno', () => {
		const message = buildReminderWhatsAppMessage({
			patientName: 'Juan Pérez',
			startsAt: '2026-06-15T17:30:00.000Z',
			timezone: CORDOBA,
			businessName: 'Clínica Sabrina',
			address: 'Av. Santa Fe 1234',
			mapsLink: 'https://maps.app.goo.gl/xyz',
			token: 'tok-1'
		});
		expect(message).toContain('Hola Juan Pérez. Te recordamos tu turno el ');
		expect(message).toContain(' a las 14:30 en Clínica Sabrina.');
		expect(message).toContain('Dirección: Av. Santa Fe 1234');
		expect(message).toContain('Cómo llegar: https://maps.app.goo.gl/xyz');
		expect(message).toContain('Ver turno: ');
		expect(message).toContain('/turno/tok-1');
		// neutral: nada clínico
		expect(message).not.toMatch(/extracci|conducto|implante|diagn/i);
	});

	it('omite dirección y maps si faltan', () => {
		const message = buildReminderWhatsAppMessage({
			patientName: 'Ana',
			startsAt: '2026-06-15T17:30:00.000Z',
			timezone: CORDOBA,
			businessName: 'Clínica Sabrina',
			address: null,
			mapsLink: null,
			token: 'tok-2'
		});
		expect(message).not.toContain('Dirección:');
		expect(message).not.toContain('Cómo llegar:');
		expect(message).toContain('Ver turno: ');
	});
});

describe('buildWaMeUrl', () => {
	it('usa el número internacional sin + y encodea el mensaje', () => {
		const url = buildWaMeUrl('+5493512345678', 'Hola Juan. Turno mañana, ¿venís?');
		expect(url.startsWith('https://wa.me/5493512345678?text=')).toBe(true);
		expect(url).toContain(encodeURIComponent('¿venís?'));
		expect(url).not.toContain('+549');
	});
});
