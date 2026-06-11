import { describe, expect, it } from 'vitest';
import {
	getPublicAppointmentMessage,
	getPublicTokenErrorMessage,
	type PublicAppointmentView
} from './public-appointments';

const appointment = (overrides: Partial<PublicAppointmentView>): PublicAppointmentView => ({
	id: 'appointment-1',
	token: 'token-1',
	status: 'reserved',
	starts_at: '2026-05-14T12:00:00.000Z',
	ends_at: '2026-05-14T12:30:00.000Z',
	service_name_snapshot: 'Consulta',
	professional_name_snapshot: 'Dra. Pérez',
	calendar_action_status: 'not_offered',
	calendar_action_at: null,
	calendar_action_count: 0,
	calendar_sequence: 0,
	calendar_update_required_at: null,
	business: {
		id: 'business-1',
		name: 'Consultorio',
		slug: 'consultorio',
		phone: null,
		address: null,
		address_instructions: null,
		maps_link: null,
		logo_url: null,
		timezone: 'America/Argentina/Cordoba',
		is_active: true,
		cancellation_policy: null
	},
	patient_name: 'Paciente',
	public_status_label: 'Reservado',
	public_actions_available: true,
	can_confirm: true,
	can_cancel: true,
	can_request_reschedule: true,
	is_past: false,
	...overrides
});

describe('getPublicAppointmentMessage', () => {
	it('devuelve un mensaje público para turnos reservados', () => {
		expect(getPublicAppointmentMessage(appointment({}))).toBe('Tu turno está reservado.');
	});

	it('explica estados cerrados sin exponer datos internos', () => {
		expect(getPublicAppointmentMessage(appointment({ status: 'cancelled', public_status_label: 'Cancelado' }))).toBe(
			'Este turno ya fue cancelado.'
		);
		expect(
			getPublicAppointmentMessage(
				appointment({
					status: 'reschedule_requested',
					public_status_label: 'Quiere reprogramar',
					can_confirm: false,
					can_request_reschedule: false
				})
			)
		).toBe('Recibimos tu pedido de reprogramación. El consultorio lo gestionará.');
	});

	it('bloquea acciones públicas cuando el turno ya pasó o el negocio está inactivo', () => {
		expect(getPublicAppointmentMessage(appointment({ is_past: true }))).toBe('Este turno ya no admite cambios online.');
		expect(
			getPublicAppointmentMessage(
				appointment({
					business: { ...appointment({}).business, is_active: false }
				})
			)
		).toBe('Este turno no admite cambios online en este momento.');
		expect(getPublicAppointmentMessage(appointment({ public_actions_available: false }))).toBe(
			'Este enlace no está disponible en este momento. Contactá al consultorio.'
		);
	});
});

describe('getPublicTokenErrorMessage', () => {
	it('traduce errores de token a mensajes humanos', () => {
		expect(getPublicTokenErrorMessage(new Error('PUBLIC_TOKEN_NOT_FOUND'))).toBe(
			'El enlace no es válido o ya no está disponible.'
		);
		expect(getPublicTokenErrorMessage(new Error('PUBLIC_TOKEN_APPOINTMENT_PAST'))).toBe(
			'Este turno ya no admite cambios online.'
		);
		expect(getPublicTokenErrorMessage(new Error('PUBLIC_TOKEN_CANCEL_DENIED'))).toBe(
			'Este turno no se puede cancelar desde este enlace.'
		);
		expect(getPublicTokenErrorMessage(new Error('PUBLIC_TOKEN_COMMERCIAL_UNAVAILABLE'))).toBe(
			'Este enlace no está disponible en este momento. Contactá al consultorio.'
		);
	});
});
