import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>
}));

const mocks = vi.hoisted(() => ({
	createSupabaseAdminClient: vi.fn(),
	getEmailFromAccessToken: vi.fn(),
	getUserIdFromAccessToken: vi.fn(),
	isMasterEmail: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient,
	getEmailFromAccessToken: mocks.getEmailFromAccessToken,
	getUserIdFromAccessToken: mocks.getUserIdFromAccessToken,
	isMasterEmail: mocks.isMasterEmail
}));

const { actions } = await import('./+page.server');

const BUSINESS_ID = '44444444-4444-4444-8444-444444444444';

type QueuedResult = { data?: unknown; error?: { message: string } | null };

const createDbMock = (queues: Record<string, QueuedResult[]> = {}) => {
	const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
	const tableQueues: Record<string, QueuedResult[]> = {};
	for (const [table, queue] of Object.entries(queues)) tableQueues[table] = [...queue];
	const client = {
		from: vi.fn((table: string) => {
			const result = tableQueues[table]?.shift() ?? { data: null, error: null };
			const q: Record<string, unknown> = {};
			const chain =
				(method: string) =>
				(...args: unknown[]) => {
					calls.push({ table, method, args });
					return q;
				};
			for (const method of ['select', 'eq', 'in', 'order', 'limit', 'upsert', 'update', 'insert']) {
				q[method] = vi.fn(chain(method));
			}
			q.maybeSingle = vi.fn(async () => result);
			(q as { then?: unknown }).then = (
				resolve: (value: unknown) => unknown,
				reject: (reason: unknown) => unknown
			) => Promise.resolve(result).then(resolve, reject);
			return q;
		})
	};
	return { client, calls };
};

const createMpFetch = (routes: Array<[string, { status?: number; body?: unknown }]>) => {
	const requests: Array<{ url: string; method: string }> = [];
	const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		requests.push({ url, method: init?.method ?? 'GET' });
		const hit = routes.find(([fragment]) => url.includes(fragment));
		if (!hit) return new Response('{}', { status: 404 });
		return new Response(JSON.stringify(hit[1].body ?? {}), { status: hit[1].status ?? 200 });
	});
	return { fetchMock: fetchMock as unknown as typeof fetch, requests };
};

const makeEvent = (opts: { fetchMock: typeof fetch; formEntries?: Record<string, string> }) => ({
	locals: { auth: { access_token: 'token', refresh_token: 'r' } },
	fetch: opts.fetchMock,
	request: new Request('https://app.test/odonto/maestro', {
		method: 'POST',
		body: new URLSearchParams(opts.formEntries ?? {})
	})
});

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
	envState.privateEnv.MP_ACCESS_TOKEN = 'token-de-prueba';
	mocks.getEmailFromAccessToken.mockReturnValue('master@mail.com');
	mocks.getUserIdFromAccessToken.mockReturnValue('master-user-id');
	mocks.isMasterEmail.mockReturnValue(true);
});

describe('action mp_cancel_subscription (maestro)', () => {
	it('cancela en MP una suscripción del consultorio y sincroniza el estado local', async () => {
		const admin = createDbMock({
			mp_subscriptions: [{ data: { preapproval_id: 'pre-9' }, error: null }, { error: null }]
		});
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		const { fetchMock, requests } = createMpFetch([
			['/preapproval/pre-9', { status: 200, body: { id: 'pre-9', status: 'cancelled' } }]
		]);

		const result = (await actions.mp_cancel_subscription(
			makeEvent({
				fetchMock,
				formEntries: { business_id: BUSINESS_ID, preapproval_id: 'pre-9' }
			}) as never
		)) as { success?: boolean; message?: string };

		expect(result.success).toBe(true);
		expect(requests).toHaveLength(2);
		expect(requests[0].method).toBe('GET');
		expect(requests[0].url).toContain('/authorized_payments/search');
		expect(requests[1].method).toBe('PUT');
		expect(requests[1].url).toContain('/preapproval/pre-9');
		const update = admin.calls.find(
			(c) => c.table === 'mp_subscriptions' && c.method === 'update'
		);
		expect(update).toBeDefined();
		expect(update!.args[0]).toMatchObject({ status: 'cancelled' });
		// El aislamiento por consultorio se verifica con el filtro compuesto.
		expect(
			admin.calls.some(
				(c) => c.method === 'eq' && c.args[0] === 'business_id' && c.args[1] === BUSINESS_ID
			)
		).toBe(true);
	});

	it('no cancela suscripciones que no pertenecen al consultorio indicado', async () => {
		const admin = createDbMock({
			mp_subscriptions: [{ data: null, error: null }]
		});
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		const { fetchMock, requests } = createMpFetch([]);

		const result = (await actions.mp_cancel_subscription(
			makeEvent({
				fetchMock,
				formEntries: { business_id: BUSINESS_ID, preapproval_id: 'pre-ajena' }
			}) as never
		)) as { status: number };

		expect(result.status).toBe(404);
		expect(requests).toHaveLength(0);
	});

	it('solo el maestro puede usar la action', async () => {
		mocks.isMasterEmail.mockReturnValue(false);
		const { fetchMock } = createMpFetch([]);

		await expect(
			actions.mp_cancel_subscription(
				makeEvent({
					fetchMock,
					formEntries: { business_id: BUSINESS_ID, preapproval_id: 'pre-9' }
				}) as never
			)
		).rejects.toMatchObject({ status: 303 });
	});
});

describe('action mp_reconcile_now (maestro)', () => {
	it('corre la conciliación real y devuelve el resumen', async () => {
		const admin = createDbMock({
			mp_subscriptions: [{ data: [], error: null }]
		});
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);
		const { fetchMock } = createMpFetch([]);

		const result = (await actions.mp_reconcile_now(makeEvent({ fetchMock }) as never)) as {
			success?: boolean;
			message?: string;
		};

		expect(result.success).toBe(true);
		expect(result.message).toContain('0 suscripciones revisadas');
	});
});
