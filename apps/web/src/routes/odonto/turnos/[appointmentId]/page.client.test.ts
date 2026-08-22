/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import Page from './+page.svelte';

const appointment = {
	id: 'appointment-1',
	starts_at: '2026-08-20T15:00:00.000Z',
	ends_at: '2026-08-20T15:30:00.000Z',
	status: 'reserved',
	source: 'manual',
	service_name_snapshot: 'Consulta',
	professional_name_snapshot: 'Dra. Ramírez',
	duration_minutes_snapshot: 30,
	internal_note: null,
	cancelled_reason: null,
	patients: {
		id: 'patient-1',
		full_name: 'Paciente de prueba',
		phone_e164: '+5493511234567',
		email: null
	},
	professionals: [
		{
			professional_id: 'professional-1',
			position: 0,
			is_primary: true,
			professional_name_snapshot: 'Dra. Ramírez',
			break_minutes_snapshot: 0
		}
	]
};

const data = {
	context: { canOperate: true, role: 'owner' },
	appointment,
	auditLogs: [],
	messageDispatches: [],
	userLabels: {},
	reprogramDate: '2026-08-20',
	minReprogramDate: '2026-08-05',
	reprogramSlots: [],
	reprogramSlotsLoaded: false,
	fromDate: '2026-08-20',
	justRescheduled: false,
	justCreated: true,
	activationWhatsAppUrl:
		'https://wa.me/5493511234567?text=Tu%20turno%20qued%C3%B3%20reservado.',
	activationPublicUrl: 'https://cita-suite.test/turno/token-1?creado=1',
	phoneWarningAcknowledged: false,
	rescheduleWhatsAppUrl: null,
	reschedulePublicUrl: null,
	demo: false
};

afterEach(cleanup);

describe('último paso después de crear un turno desde Agenda', () => {
	it('presenta WhatsApp como la acción dominante y explica qué recibe el paciente', () => {
		render(Page, { data });

		expect(screen.getByRole('heading', { name: 'Último paso' })).toBeInTheDocument();
		const action = screen.getByRole('link', { name: 'Enviar enlace de activación' });
		expect(action).toHaveAttribute('href', data.activationWhatsAppUrl);
		expect(action).toHaveAttribute('target', '_blank');
		expect(action.className).toContain('bg-emerald-500');
		expect(action.className).toContain('min-h-[4.5rem]');
		expect(
			screen.getByText('El paciente recibirá un enlace para activar sus recordatorios.')
		).toBeInTheDocument();
	});

	it('no vuelve a advertir después de que el usuario confirmó sin un número utilizable', () => {
		render(Page, {
			data: { ...data, phoneWarningAcknowledged: true }
		});

		expect(screen.queryByRole('link', { name: 'Enviar enlace de activación' })).not.toBeInTheDocument();
		expect(screen.queryByText('Falta completar el teléfono del paciente')).not.toBeInTheDocument();
		expect(screen.queryByRole('heading', { name: 'Último paso' })).not.toBeInTheDocument();
	});

	it('mantiene el fallback para un turno legado creado sin decisión previa', () => {
		render(Page, { data: { ...data, activationWhatsAppUrl: null } });

		expect(screen.getByText('Falta completar el teléfono del paciente')).toBeInTheDocument();
	});

	it('no agrega el bloque a una visita normal del detalle', () => {
		render(Page, {
			data: { ...data, justCreated: false }
		});

		expect(screen.queryByRole('heading', { name: 'Último paso' })).not.toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Enviar enlace de activación' })).not.toBeInTheDocument();
	});
});
