import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>,
	publicEnv: {} as Record<string, string | undefined>
}));

vi.mock('web-push', () => ({
	default: {
		setVapidDetails: vi.fn(),
		sendNotification: vi.fn()
	}
}));
vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: envState.publicEnv }));

import webpush from 'web-push';
import {
	isValidSubscriptionPayload,
	resetPushRemindersForReschedule,
	sendDuePushReminders,
	sendReschedulePushNotice
} from './push';

const now = new Date('2026-06-11T12:00:00.000Z');

// Mock de supabase con cola de resultados por tabla: cada from(tabla) consume el
// siguiente resultado programado; update/upsert capturan el payload.
type Queued = { data?: unknown; error?: unknown; count?: number };
const createSupabaseMock = (queues: Record<string, Queued[]>, rpcResult: Queued) => {
	const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
	const consume = (table: string): Queued => queues[table]?.shift() ?? { data: null, error: null };
	const makeChain = (table: string) => {
		const result = consume(table);
		const chain: any = {};
		for (const method of ['select', 'eq', 'is', 'in', 'gte', 'lt', 'order', 'limit']) {
			chain[method] = () => chain;
		}
		chain.update = (payload: Record<string, unknown>) => {
			updates.push({ table, payload });
			return chain;
		};
		chain.insert = () => chain;
		chain.upsert = () => chain;
		chain.maybeSingle = async () => result;
		chain.single = async () => result;
		chain.then = (resolve: (value: Queued) => unknown) => Promise.resolve(result).then(resolve);
		return chain;
	};
	return {
		supabase: {
			from: (table: string) => makeChain(table),
			rpc: async () => rpcResult
		} as any,
		updates
	};
};

const claimedRow = {
	subscription_id: 'sub-1',
	appointment_id: 'apt-1',
	business_id: 'biz-1',
	endpoint: 'https://push.example/ep-1',
	p256dh: 'p256dh-key',
	auth: 'auth-key',
	reminder_kind: '24h'
};

const liveAppointment = {
	id: 'apt-1',
	status: 'confirmed',
	starts_at: '2026-06-12T11:00:00.000Z',
	confirmation_token: 'tok-1',
	businesses: { name: 'Clínica Sabrina', timezone: 'America/Argentina/Cordoba' }
};

beforeEach(() => {
	vi.mocked(webpush.sendNotification).mockReset();
	envState.privateEnv.VAPID_PUBLIC_KEY = 'test-public-key';
	envState.privateEnv.VAPID_PRIVATE_KEY = 'test-private-key';
	envState.privateEnv.VAPID_SUBJECT = 'mailto:test@example.com';
});

describe('isValidSubscriptionPayload', () => {
	it('acepta una suscripción válida', () => {
		expect(
			isValidSubscriptionPayload({
				endpoint: 'https://push.example/ep',
				keys: { p256dh: 'a', auth: 'b' }
			})
		).toBe(true);
	});

	it('rechaza endpoints no https y claves faltantes', () => {
		expect(isValidSubscriptionPayload({ endpoint: 'http://x', keys: { p256dh: 'a', auth: 'b' } })).toBe(false);
		expect(isValidSubscriptionPayload({ endpoint: 'https://x', keys: { p256dh: '', auth: 'b' } })).toBe(false);
		expect(isValidSubscriptionPayload(null)).toBe(false);
		expect(isValidSubscriptionPayload({})).toBe(false);
	});
});

describe('sendDuePushReminders', () => {
	it('envía el recordatorio y recién después marca sent_at del kind correcto', async () => {
		vi.mocked(webpush.sendNotification).mockResolvedValue({} as any);
		const { supabase, updates } = createSupabaseMock(
			{
				push_subscriptions: [{ data: [] }],
				appointments: [{ data: liveAppointment, error: null }]
			},
			{ data: [claimedRow], error: null }
		);

		const result = await sendDuePushReminders(supabase, { now });
		expect(result.sent).toBe(1);
		expect(result.failed).toBe(0);

		expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
		const payload = JSON.parse(vi.mocked(webpush.sendNotification).mock.calls[0][1] as string);
		expect(payload.title).toBe('Turno en Clínica Sabrina');
		expect(payload.body).toContain('a las 08:00');
		expect(payload.url).toContain('/turno/tok-1');

		const sentUpdate = updates.find((u) => u.payload.push_24h_sent_at);
		expect(sentUpdate).toBeTruthy();
	});

	it('revoca el endpoint ante 410 del push service', async () => {
		vi.mocked(webpush.sendNotification).mockRejectedValue({ statusCode: 410 });
		const { supabase, updates } = createSupabaseMock(
			{
				push_subscriptions: [{ data: [] }, { data: null }],
				appointments: [{ data: liveAppointment, error: null }]
			},
			{ data: [claimedRow], error: null }
		);

		const result = await sendDuePushReminders(supabase, { now });
		expect(result.failed).toBe(1);
		expect(result.revoked).toBe(1);
		const revokeUpdate = updates.find((u) => u.payload.revoked_at);
		expect(revokeUpdate).toBeTruthy();
		expect(updates.some((u) => u.payload.push_24h_sent_at)).toBe(false);
	});

	it('error transitorio: libera el claim e incrementa failed_count (reintenta luego)', async () => {
		vi.mocked(webpush.sendNotification).mockRejectedValue(new Error('timeout'));
		const { supabase, updates } = createSupabaseMock(
			{
				push_subscriptions: [{ data: [] }, { data: { failed_count: 0 } }, { data: null }],
				appointments: [{ data: liveAppointment, error: null }]
			},
			{ data: [claimedRow], error: null }
		);

		await sendDuePushReminders(supabase, { now });
		const release = updates.find((u) => u.payload.failed_count === 1);
		expect(release).toBeTruthy();
		expect(release?.payload.push_24h_claimed_at).toBeNull();
		expect(updates.some((u) => u.payload.push_24h_sent_at)).toBe(false);
	});

	it('turno cancelado tras el claim: no envía y libera el claim', async () => {
		const { supabase, updates } = createSupabaseMock(
			{
				push_subscriptions: [{ data: [] }, { data: null }],
				appointments: [{ data: { ...liveAppointment, status: 'cancelled' }, error: null }]
			},
			{ data: [claimedRow], error: null }
		);

		const result = await sendDuePushReminders(supabase, { now });
		expect(webpush.sendNotification).not.toHaveBeenCalled();
		expect(result.sent).toBe(0);
		expect(updates.some((u) => u.payload.push_24h_claimed_at === null)).toBe(true);
	});

	it('reprogramado fuera de la ventana tras el claim: libera el claim sin enviar', async () => {
		// Carrera claim→reschedule→send: el claim se tomó con el horario viejo (en
		// ventana), pero el turno vivo quedó a 5 días. Enviar consumiría el sent_at de
		// 24h con días de anticipación y el recordatorio real nunca saldría.
		const { supabase, updates } = createSupabaseMock(
			{
				push_subscriptions: [{ data: [] }, { data: null }],
				appointments: [
					{ data: { ...liveAppointment, starts_at: '2026-06-16T11:00:00.000Z' }, error: null }
				]
			},
			{ data: [claimedRow], error: null }
		);

		const result = await sendDuePushReminders(supabase, { now });
		expect(webpush.sendNotification).not.toHaveBeenCalled();
		expect(result.sent).toBe(0);
		expect(updates.some((u) => u.payload.push_24h_claimed_at === null)).toBe(true);
		expect(updates.some((u) => u.payload.push_24h_sent_at)).toBe(false);
	});

	it('sin VAPID configurado no hace nada', async () => {
		delete envState.privateEnv.VAPID_PUBLIC_KEY;
		delete envState.privateEnv.VAPID_PRIVATE_KEY;
		delete envState.publicEnv.PUBLIC_VAPID_PUBLIC_KEY;
		const { supabase } = createSupabaseMock({}, { data: [], error: null });
		const result = await sendDuePushReminders(supabase, { now });
		expect(result).toMatchObject({ configured: false, sent: 0 });
	});
});

describe('sendReschedulePushNotice', () => {
	const subscriptionRow = {
		id: 'sub-1',
		endpoint: 'https://push.example/ep-1',
		p256dh: 'p256dh-key',
		auth: 'auth-key'
	};

	it('envía el aviso con el tag del recordatorio de 24h y sin tocar flags sent/claimed', async () => {
		vi.mocked(webpush.sendNotification).mockResolvedValue({} as any);
		const { supabase, updates } = createSupabaseMock(
			{
				appointments: [{ data: liveAppointment, error: null }],
				push_subscriptions: [{ data: [subscriptionRow], error: null }]
			},
			{ data: null, error: null }
		);

		const result = await sendReschedulePushNotice(supabase, {
			businessId: 'biz-1',
			appointmentId: 'apt-1',
			now
		});

		expect(result.sent).toBe(1);
		expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
		const payload = JSON.parse(vi.mocked(webpush.sendNotification).mock.calls[0][1] as string);
		expect(payload.body).toContain('reprogramado');
		expect(payload.body).toContain('a las 08:00');
		// Mismo tag que el aviso de 24h: pisa la notificación vieja en el navegador.
		expect(payload.tag).toBe('turno-apt-1-24h');
		expect(payload.group).toBe('turno-apt-1');
		expect(payload.url).toContain('/turno/tok-1');
		// Los recordatorios del nuevo horario siguen su curso: no se marca nada.
		expect(
			updates.some(
				(u) =>
					'push_24h_sent_at' in u.payload ||
					'push_2h_sent_at' in u.payload ||
					'push_24h_claimed_at' in u.payload ||
					'push_2h_claimed_at' in u.payload
			)
		).toBe(false);
	});

	it('turno cancelado o pasado: no envía nada', async () => {
		const { supabase } = createSupabaseMock(
			{
				appointments: [{ data: { ...liveAppointment, status: 'cancelled' }, error: null }]
			},
			{ data: null, error: null }
		);

		const result = await sendReschedulePushNotice(supabase, {
			businessId: 'biz-1',
			appointmentId: 'apt-1',
			now
		});
		expect(result.sent).toBe(0);
		expect(webpush.sendNotification).not.toHaveBeenCalled();
	});

	it('endpoint muerto (410): revoca la suscripción', async () => {
		vi.mocked(webpush.sendNotification).mockRejectedValue({ statusCode: 410 });
		const { supabase, updates } = createSupabaseMock(
			{
				appointments: [{ data: liveAppointment, error: null }],
				push_subscriptions: [{ data: [subscriptionRow], error: null }, { data: null }]
			},
			{ data: null, error: null }
		);

		const result = await sendReschedulePushNotice(supabase, {
			businessId: 'biz-1',
			appointmentId: 'apt-1',
			now
		});
		expect(result.failed).toBe(1);
		expect(result.revoked).toBe(1);
		expect(updates.some((u) => u.payload.revoked_at)).toBe(true);
	});
});

describe('resetPushRemindersForReschedule', () => {
	// Mock que captura el payload del update y los filtros eq/is aplicados.
	const makeMock = (data: unknown = [{ id: 'sub-1' }]) => {
		const calls = {
			update: null as Record<string, unknown> | null,
			eq: [] as Array<[string, unknown]>,
			is: [] as Array<[string, unknown]>,
			table: ''
		};
		const chain: any = {
			update(payload: Record<string, unknown>) {
				calls.update = payload;
				return chain;
			},
			eq(col: string, val: unknown) {
				calls.eq.push([col, val]);
				return chain;
			},
			is(col: string, val: unknown) {
				calls.is.push([col, val]);
				return chain;
			},
			select: () => chain,
			then: (resolve: (v: unknown) => unknown) =>
				Promise.resolve({ data, error: null }).then(resolve)
		};
		const supabase = {
			from(table: string) {
				calls.table = table;
				return chain;
			}
		} as any;
		return { supabase, calls };
	};

	it('limpia sent/claimed de 24h y 2h del turno, sin tocar revocadas', async () => {
		const { supabase, calls } = makeMock([{ id: 'sub-1' }, { id: 'sub-2' }]);
		const count = await resetPushRemindersForReschedule(supabase, {
			businessId: 'biz-1',
			appointmentId: 'apt-1',
			now
		});

		expect(count).toBe(2);
		expect(calls.table).toBe('push_subscriptions');
		expect(calls.update).toEqual({
			push_24h_claimed_at: null,
			push_24h_sent_at: null,
			push_2h_claimed_at: null,
			push_2h_sent_at: null,
			updated_at: now.toISOString()
		});
		expect(calls.eq).toEqual([
			['business_id', 'biz-1'],
			['appointment_id', 'apt-1']
		]);
		expect(calls.is).toEqual([['revoked_at', null]]);
	});

	it('propaga el error de Supabase', async () => {
		const chain: any = {
			update: () => chain,
			eq: () => chain,
			is: () => chain,
			select: () => chain,
			then: (resolve: (v: unknown) => unknown) =>
				Promise.resolve({ data: null, error: new Error('boom') }).then(resolve)
		};
		const supabase = { from: () => chain } as any;
		await expect(
			resetPushRemindersForReschedule(supabase, { businessId: 'b', appointmentId: 'a' })
		).rejects.toThrow('boom');
	});
});
