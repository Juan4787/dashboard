import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {
		ODONTO_SUPABASE_URL: 'https://odonto.supabase.co',
		ADMIN_SUPABASE_URL: 'https://admin.supabase.co'
	} as Record<string, string | undefined>
}));

const mocks = vi.hoisted(() => ({
	createSupabaseServerClient: vi.fn(),
	getEmailFromAccessToken: vi.fn(),
	getModuleEntryRoute: vi.fn(() => '/odonto'),
	isJwtExpired: vi.fn(),
	isMasterEmail: vi.fn()
}));

vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseServerClient: mocks.createSupabaseServerClient,
	getEmailFromAccessToken: mocks.getEmailFromAccessToken,
	getModuleEntryRoute: mocks.getModuleEntryRoute,
	isJwtExpired: mocks.isJwtExpired,
	isMasterEmail: mocks.isMasterEmail
}));

const { handle } = await import('./hooks.server');

const makeEvent = () => {
	const cookieValues: Record<string, string> = {
		'sb-module': 'odonto',
		'sb-access-token': 'forged-token',
		'sb-refresh-token': 'refresh-token'
	};
	return {
		url: new URL('https://app.test/odonto'),
		locals: {},
		fetch: vi.fn(async () => new Response('{}')),
		cookies: {
			get: vi.fn((key: string) => cookieValues[key]),
			set: vi.fn(),
			delete: vi.fn()
		}
	};
};

describe('hooks auth validation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isJwtExpired.mockReturnValue(false);
		mocks.getEmailFromAccessToken.mockReturnValue('owner@test.com');
		mocks.isMasterEmail.mockReturnValue(false);
	});

	it('rechaza un access token no vencido si Supabase Auth no lo valida', async () => {
		const event = makeEvent();
		const resolve = vi.fn(async () => new Response('ok'));
		mocks.createSupabaseServerClient.mockResolvedValue({
			auth: {
				getUser: vi.fn(async () => ({ data: { user: null }, error: new Error('invalid') }))
			}
		});

		await expect(handle({ event, resolve } as never)).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});

		expect(resolve).not.toHaveBeenCalled();
		expect(event.cookies.delete).toHaveBeenCalledWith('sb-module', { path: '/' });
		expect(event.cookies.delete).toHaveBeenCalledWith('sb-access-token', { path: '/' });
		expect(event.cookies.delete).toHaveBeenCalledWith('sb-refresh-token', { path: '/' });
	});
});
