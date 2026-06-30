import { describe, expect, it } from 'vitest';
import {
	buildReminderWhatsAppMessage,
	buildRescheduleWhatsAppMessage,
	buildWaMeUrl,
	classifyReminderCoverage,
	isReliablyActivePushSubscription,
	loadReminderCandidates,
	localDayWindowUtc
} from './reminders';
import { publicRescheduleUrl } from './messaging';

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

describe('isReliablyActivePushSubscription', () => {
	it('fiable: sin revocar y sin fallos', () => {
		expect(isReliablyActivePushSubscription({ revoked_at: null, failed_count: 0 })).toBe(true);
	});

	it('NO fiable: revocada (endpoint muerto / turno terminal)', () => {
		expect(
			isReliablyActivePushSubscription({ revoked_at: '2026-06-11T10:00:00.000Z', failed_count: 0 })
		).toBe(false);
	});

	it('NO fiable: con fallos de entrega registrados aunque no esté revocada', () => {
		expect(isReliablyActivePushSubscription({ revoked_at: null, failed_count: 1 })).toBe(false);
		expect(isReliablyActivePushSubscription({ revoked_at: null, failed_count: 2 })).toBe(false);
	});

	it('tolera nulls/strings raros: failed_count nulo cuenta como 0', () => {
		expect(isReliablyActivePushSubscription({ revoked_at: null, failed_count: null })).toBe(true);
		// revoked_at undefined (legado) se trata como no revocada
		expect(
			isReliablyActivePushSubscription({
				revoked_at: undefined as unknown as string | null,
				failed_count: 0
			})
		).toBe(true);
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

describe('loadReminderCandidates · exclusión por push fiable', () => {
	const business = {
		id: 'biz-1',
		name: 'Clínica Sabrina',
		timezone: CORDOBA,
		address: 'Av. Santa Fe 1234',
		maps_url: null
	};
	// 'mañana' a las 15:30 Córdoba, dentro de la ventana del día siguiente.
	const now = new Date('2026-06-11T12:00:00.000Z');
	const tomorrowAt = '2026-06-12T18:30:00.000Z'; // 15:30 -03

	const appointmentRow = (id: string) => ({
		id,
		starts_at: tomorrowAt,
		status: 'reserved',
		service_name_snapshot: 'Consulta',
		professional_name_snapshot: 'Dra. Lopez',
		confirmation_token: `tok-${id}`,
		calendar_action_status: 'not_offered',
		calendar_update_required_at: null,
		whatsapp_reminder_opened_at: null,
		whatsapp_reminder_marked_sent_at: null,
		patients: { id: `pat-${id}`, full_name: `Paciente ${id}`, phone_e164: '+5493510000001', blocked: false }
	});

	// Mock mínimo: from(tabla) entrega el siguiente resultado encolado para esa tabla;
	// toda la cadena de filtros es no-op y la query se resuelve al await (.then).
	const makeSupabase = (queues: Record<string, Array<{ data: unknown; error: unknown }>>) => {
		const consume = (table: string) => queues[table]?.shift() ?? { data: null, error: null };
		const chainFor = (table: string) => {
			const result = consume(table);
			const chain: any = {};
			for (const m of ['select', 'eq', 'is', 'in', 'gte', 'lt', 'order']) chain[m] = () => chain;
			chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
			return chain;
		};
		return { from: (table: string) => chainFor(table) } as any;
	};

	it('excluye solo el turno con suscripción push fiable; mantiene los flojos', async () => {
		const supabase = makeSupabase({
			appointments: [{ data: [appointmentRow('a'), appointmentRow('b'), appointmentRow('c')], error: null }],
			push_subscriptions: [
				{
					data: [
						{ appointment_id: 'a', revoked_at: null, failed_count: 0 }, // fiable → excluido
						{ appointment_id: 'b', revoked_at: null, failed_count: 2 } // con fallos → NO excluido
						// 'c' no tiene suscripción → NO excluido
					],
					error: null
				}
			],
			message_dispatches: [{ data: [], error: null }]
		});

		const candidates = await loadReminderCandidates(supabase, business, { day: 'manana', now });
		const ids = candidates.map((c) => c.appointment_id).sort();
		expect(ids).toEqual(['b', 'c']);
	});

	it('una fila fiable basta para excluir aunque coexista una con fallos del mismo turno', async () => {
		const supabase = makeSupabase({
			appointments: [{ data: [appointmentRow('a')], error: null }],
			push_subscriptions: [
				{
					data: [
						{ appointment_id: 'a', revoked_at: null, failed_count: 3 },
						{ appointment_id: 'a', revoked_at: null, failed_count: 0 }
					],
					error: null
				}
			],
			message_dispatches: [{ data: [], error: null }]
		});

		const candidates = await loadReminderCandidates(supabase, business, { day: 'manana', now });
		expect(candidates).toEqual([]);
	});
});

describe('buildRescheduleWhatsAppMessage', () => {
	it('arma el aviso neutral con nueva fecha/hora y el enlace privado', () => {
		const message = buildRescheduleWhatsAppMessage({
			patientName: 'Juan Pérez',
			startsAt: '2026-06-20T17:30:00.000Z',
			timezone: CORDOBA,
			businessName: 'Clínica Sabrina',
			rescheduleUrl: 'https://cita.example/turno/tok-1/reprogramado'
		});
		expect(message).toContain('Hola Juan Pérez. Reprogramamos tu turno en Clínica Sabrina.');
		expect(message).toContain('Nueva fecha:');
		expect(message).toContain(' a las 14:30.');
		expect(message).toContain('https://cita.example/turno/tok-1/reprogramado');
		// neutral: nada clínico
		expect(message).not.toMatch(/extracci|conducto|implante|diagn/i);
	});
});

describe('publicRescheduleUrl', () => {
	it('apunta a /turno/<token>/reprogramado', () => {
		expect(publicRescheduleUrl('tok-1')).toMatch(/\/turno\/tok-1\/reprogramado$/);
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
