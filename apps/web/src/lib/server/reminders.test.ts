import { beforeEach, describe, expect, it, vi } from 'vitest';

const googleCalendarFlag = vi.hoisted(() => ({ enabled: false }));
vi.mock('./google-calendar', () => ({
	isManagedGoogleCalendarEnabled: () => googleCalendarFlag.enabled
}));
import {
	buildReminderWhatsAppMessage,
	buildRescheduleWhatsAppMessage,
	buildWaMeUrl,
	classifyReminderCoverage,
	countTomorrowUncovered,
	hasActivePushSubscription,
	loadReminderCandidates,
	localDayWindowUtc
} from './reminders';
import { publicRescheduleUrl } from './messaging';

const CORDOBA = 'America/Argentina/Cordoba'; // UTC-3, sin DST

beforeEach(() => {
	googleCalendarFlag.enabled = false;
});

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
		has_active_notifications: false,
		has_active_dispatch: false
	};

	it('sin acción de calendario: sin_calendario (offered NO cuenta como cobertura)', () => {
		expect(classifyReminderCoverage(base)).toBe('sin_calendario');
		expect(classifyReminderCoverage({ ...base, calendar_action_status: 'offered' })).toBe('sin_calendario');
	});

	it('una acción de calendario verificable queda cubierta', () => {
		expect(classifyReminderCoverage({ ...base, calendar_action_status: 'downloaded_ics' })).toBeNull();
	});

	it('un click directo en Google nunca se confunde con un evento guardado', () => {
		expect(
			classifyReminderCoverage({
				...base,
				calendar_action_status: 'clicked_google'
			})
		).toBe('sin_calendario');
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

	it('avisos activados o dispatch automático activo: cubierto', () => {
		expect(classifyReminderCoverage({ ...base, has_active_notifications: true })).toBeNull();
		expect(classifyReminderCoverage({ ...base, has_active_dispatch: true })).toBeNull();
		expect(
			classifyReminderCoverage({
				...base,
				calendar_action_status: 'clicked_google',
				has_active_notifications: true
			})
		).toBeNull();
	});

	it('solo acepta Google Calendar cuando confirmó la sequence actual', () => {
		expect(
			classifyReminderCoverage({
				...base,
				calendar_action_status: 'synced_google',
				google_calendar_sync_status: 'active',
				has_current_google_calendar_event: true
			})
		).toBeNull();
		expect(
			classifyReminderCoverage({
				...base,
				calendar_action_status: 'synced_google',
				google_calendar_sync_status: 'active',
				has_current_google_calendar_event: false
			})
		).toBe('pendiente_actualizar');
	});

	it('no oculta una sincronización fallida ni un indicador Google huérfano', () => {
		expect(
			classifyReminderCoverage({
				...base,
				calendar_action_status: 'synced_google',
				google_calendar_sync_status: 'needs_reconnect'
			})
		).toBe('sin_calendario');
		expect(
			classifyReminderCoverage({ ...base, calendar_action_status: 'synced_google' })
		).toBe('sin_calendario');
	});
});

describe('hasActivePushSubscription', () => {
	it('activa: confirmada y sin revocar', () => {
		expect(
			hasActivePushSubscription({
				revoked_at: null,
				verified_at: '2026-06-11T10:00:00.000Z'
			})
		).toBe(true);
	});

	it('inactiva: revocada (endpoint muerto / turno terminal)', () => {
		expect(
			hasActivePushSubscription({
				revoked_at: '2026-06-11T10:00:00.000Z',
				verified_at: '2026-06-11T09:00:00.000Z'
			})
		).toBe(false);
	});

	it('inactiva: el endpoint existe pero la prueba no fue confirmada', () => {
		expect(hasActivePushSubscription({ revoked_at: null, verified_at: null })).toBe(false);
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

describe('loadReminderCandidates · exclusión por avisos activados', () => {
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
		calendar_sequence: 0,
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
			for (const m of ['select', 'eq', 'is', 'not', 'in', 'gte', 'lt', 'order']) chain[m] = () => chain;
			chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
			return chain;
		};
		return { from: (table: string) => chainFor(table) } as any;
	};

	it('excluye toda suscripción verificada, incluso si tuvo un fallo transitorio', async () => {
		const supabase = makeSupabase({
			appointments: [{ data: [appointmentRow('a'), appointmentRow('b'), appointmentRow('c')], error: null }],
			push_subscriptions: [
				{
					data: [
						{ appointment_id: 'a', revoked_at: null, verified_at: now.toISOString(), failed_count: 0 },
						{ appointment_id: 'b', revoked_at: null, verified_at: now.toISOString(), failed_count: 2 }
						// 'c' no tiene suscripción → NO excluido
					],
					error: null
				}
			],
			message_dispatches: [{ data: [], error: null }]
		});

		const candidates = await loadReminderCandidates(supabase, business, {
			day: 'manana',
			now,
			pushSubscriptionsSupabase: supabase
		});
		const ids = candidates.map((c) => c.appointment_id).sort();
		expect(ids).toEqual(['c']);
	});

	it('mantiene visible el turno mientras la prueba no fue confirmada', async () => {
		const supabase = makeSupabase({
			appointments: [{ data: [appointmentRow('a')], error: null }],
			push_subscriptions: [
				{ data: [{ appointment_id: 'a', revoked_at: null, verified_at: null }], error: null }
			],
			message_dispatches: [{ data: [], error: null }]
		});

		const candidates = await loadReminderCandidates(supabase, business, {
			day: 'manana',
			now,
			pushSubscriptionsSupabase: supabase
		});
		expect(candidates.map((candidate) => candidate.appointment_id)).toEqual(['a']);
	});

	it('mantiene visible el turno si sólo se abrió el editor directo de Google', async () => {
		const row = { ...appointmentRow('a'), calendar_action_status: 'clicked_google' };
		const supabase = makeSupabase({
			appointments: [{ data: [row], error: null }],
			push_subscriptions: [{ data: [], error: null }],
			message_dispatches: [{ data: [], error: null }]
		});

		const candidates = await loadReminderCandidates(supabase, business, {
			day: 'manana',
			now,
			pushSubscriptionsSupabase: supabase
		});
		expect(candidates.map((candidate) => candidate.appointment_id)).toEqual(['a']);
	});

	it('una suscripción activa basta para excluir aunque coexista una revocada', async () => {
		const supabase = makeSupabase({
			appointments: [{ data: [appointmentRow('a')], error: null }],
			push_subscriptions: [
				{
					data: [
						{ appointment_id: 'a', revoked_at: '2026-06-11T10:00:00.000Z', verified_at: now.toISOString() },
						{ appointment_id: 'a', revoked_at: null, verified_at: now.toISOString() }
					],
					error: null
				}
			],
			message_dispatches: [{ data: [], error: null }]
		});

		const candidates = await loadReminderCandidates(supabase, business, {
			day: 'manana',
			now,
			pushSubscriptionsSupabase: supabase
		});
		expect(candidates).toEqual([]);
	});

	it('vuelve a incluir una suscripción revocada si no hay calendario', async () => {
		const supabase = makeSupabase({
			appointments: [{ data: [appointmentRow('a')], error: null }],
			push_subscriptions: [
				{ data: [{ appointment_id: 'a', revoked_at: '2026-06-11T10:00:00.000Z', verified_at: now.toISOString() }], error: null }
			],
			message_dispatches: [{ data: [], error: null }]
		});

		const candidates = await loadReminderCandidates(supabase, business, {
			day: 'manana',
			now,
			pushSubscriptionsSupabase: supabase
		});
		expect(candidates.map((candidate) => candidate.appointment_id)).toEqual(['a']);
	});

	it('el contador de Agenda usa la misma exclusión por avisos activados', async () => {
		const supabase = makeSupabase({
			appointments: [{ data: [appointmentRow('a'), appointmentRow('b')], error: null }],
			push_subscriptions: [
				{
					data: [
						{ appointment_id: 'a', revoked_at: null, verified_at: now.toISOString(), failed_count: 1 },
						{ appointment_id: 'b', revoked_at: '2026-06-11T10:00:00.000Z', verified_at: now.toISOString() }
					],
					error: null
				}
			],
			message_dispatches: [{ data: [], error: null }]
		});

		await expect(
			countTomorrowUncovered(supabase, business, { now, pushSubscriptionsSupabase: supabase })
		).resolves.toBe(1);
	});

	it('excluye un evento Google únicamente cuando la versión vigente fue confirmada', async () => {
		googleCalendarFlag.enabled = true;
		const synced = { ...appointmentRow('a'), calendar_action_status: 'synced_google' };
		const stale = {
			...appointmentRow('b'),
			calendar_action_status: 'synced_google',
			calendar_sequence: 2,
			calendar_update_required_at: '2026-06-11T11:00:00.000Z'
		};
		const supabase = makeSupabase({
			appointments: [{ data: [synced, stale], error: null }],
			push_subscriptions: [{ data: [], error: null }],
			message_dispatches: [{ data: [], error: null }],
			appointment_google_calendar_events: [
				{
					data: [
						{ appointment_id: 'a', sync_status: 'active', synced_sequence: 0 },
						{ appointment_id: 'b', sync_status: 'pending_update', synced_sequence: 1 }
					],
					error: null
				}
			]
		});

		const candidates = await loadReminderCandidates(supabase, business, {
			day: 'manana',
			now,
			pushSubscriptionsSupabase: supabase
		});
		expect(candidates.map((candidate) => [candidate.appointment_id, candidate.coverage])).toEqual([
			['b', 'pendiente_actualizar']
		]);
	});

	it('consulta las notificaciones con el cliente privilegiado, no con la sesión del usuario', async () => {
		googleCalendarFlag.enabled = true;
		const userSupabase = makeSupabase({
			appointments: [{ data: [appointmentRow('a')], error: null }],
			message_dispatches: [{ data: [], error: null }]
		});
		const pushSubscriptionsSupabase = makeSupabase({
			push_subscriptions: [
				{ data: [{ appointment_id: 'a', revoked_at: null, verified_at: now.toISOString() }], error: null }
			],
			appointment_google_calendar_events: [{ data: [], error: null }]
		});

		const candidates = await loadReminderCandidates(userSupabase, business, {
			day: 'manana',
			now,
			pushSubscriptionsSupabase
		});

		expect(candidates).toEqual([]);
	});

	it('falla de forma segura si no puede verificar la versión de Google Calendar', async () => {
		googleCalendarFlag.enabled = true;
		const userSupabase = makeSupabase({
			appointments: [{ data: [appointmentRow('a')], error: null }],
			message_dispatches: [{ data: [], error: null }]
		});
		const privilegedSupabase = makeSupabase({
			push_subscriptions: [{ data: [], error: null }],
			appointment_google_calendar_events: [
				{ data: null, error: new Error('calendar inaccessible') }
			]
		});

		await expect(
			loadReminderCandidates(userSupabase, business, {
				day: 'manana',
				now,
				pushSubscriptionsSupabase: privilegedSupabase
			})
		).rejects.toThrow('calendar inaccessible');
	});

	it('falla de forma segura si no se puede leer el estado de los avisos', async () => {
		const userSupabase = makeSupabase({
			appointments: [{ data: [appointmentRow('a')], error: null }],
			message_dispatches: [{ data: [], error: null }]
		});
		const pushSubscriptionsSupabase = makeSupabase({
			push_subscriptions: [{ data: null, error: new Error('push inaccesible') }]
		});

		await expect(
			loadReminderCandidates(userSupabase, business, {
				day: 'manana',
				now,
				pushSubscriptionsSupabase
			})
		).rejects.toThrow('push inaccesible');
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
