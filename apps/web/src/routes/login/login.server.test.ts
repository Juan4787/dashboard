import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: {} as Record<string, string | undefined>,
	createSupabaseServerClient: vi.fn(),
	getModuleEntryRoute: vi.fn(() => '/odonto'),
	isMasterEmail: vi.fn(() => false),
	MASTER_EMAIL: 'master@example.com',
	enforceRateLimits: vi.fn(),
	loginPasswordRateLimitRules: vi.fn((email: string, ip: string) => [
		{ action: 'login_password_by_email', subject: email, ip }
	]),
	signupEmailRateLimitRules: vi.fn((email: string, ip: string) => [
		{ action: 'signup_email_by_email', subject: email, ip }
	]),
	rateLimitFail: vi.fn(() => ({ status: 429, message: 'rate limited' }))
}));

vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));
vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseServerClient: mocks.createSupabaseServerClient,
	getModuleEntryRoute: mocks.getModuleEntryRoute,
	isMasterEmail: mocks.isMasterEmail,
	MASTER_EMAIL: mocks.MASTER_EMAIL
}));
vi.mock('$lib/server/rate-limits', () => ({
	enforceRateLimits: mocks.enforceRateLimits,
	loginPasswordRateLimitRules: mocks.loginPasswordRateLimitRules,
	signupEmailRateLimitRules: mocks.signupEmailRateLimitRules,
	rateLimitFail: mocks.rateLimitFail
}));

const { actions } = await import('./+page.server');

const makeEvent = (entries: Record<string, string>) => ({
	request: new Request('https://app.test/login', {
		method: 'POST',
		body: new URLSearchParams(entries)
	}),
	cookies: {
		set: vi.fn()
	},
	fetch: vi.fn(),
	getClientAddress: vi.fn(() => '203.0.113.20')
});

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(mocks.env)) delete mocks.env[key];
	mocks.enforceRateLimits.mockResolvedValue(undefined);
	mocks.isMasterEmail.mockReturnValue(false);
});

describe('login/register server actions', () => {
	it('registra email/password libremente sin consultar allowed_emails', async () => {
		const auth = {
			signUp: vi.fn(async () => ({
				data: { session: { access_token: 'access', refresh_token: 'refresh' } },
				error: null
			}))
		};
		const supabase = { auth, rpc: vi.fn() };
		mocks.createSupabaseServerClient.mockResolvedValue(supabase);

		await expect(
			actions.register(
				makeEvent({
					email: 'nuevo@example.com',
					password: 'secret123',
					confirm_password: 'secret123',
					accepted_terms: 'true'
				}) as never
			)
		).rejects.toMatchObject({ status: 303, location: '/odonto' });

		expect(mocks.enforceRateLimits).toHaveBeenCalled();
		expect(auth.signUp).toHaveBeenCalledWith({
			email: 'nuevo@example.com',
			password: 'secret123'
		});
		expect(supabase.rpc).not.toHaveBeenCalledWith('is_email_enabled', expect.anything());
	});

	it('rechaza registro email/password si la confirmación no coincide antes de Auth', async () => {
		const auth = { signUp: vi.fn() };
		mocks.createSupabaseServerClient.mockResolvedValue({ auth });

		const result = (await actions.register(
			makeEvent({
				email: 'nuevo@example.com',
				password: 'secret123',
				confirm_password: 'otro123',
				accepted_terms: 'true'
			}) as never
		)) as { status: number; data: { message?: string } };

		expect(result.status).toBe(400);
		expect(result.data.message).toBe('Las contraseñas no coinciden.');
		expect(mocks.enforceRateLimits).not.toHaveBeenCalled();
		expect(auth.signUp).not.toHaveBeenCalled();
	});

	it('ingresa sin exigir que el email esté prehabilitado', async () => {
		const auth = {
			signInWithPassword: vi.fn(async () => ({
				data: { session: { access_token: 'access', refresh_token: 'refresh' } },
				error: null
			}))
		};
		const supabase = { auth, rpc: vi.fn() };
		mocks.createSupabaseServerClient.mockResolvedValue(supabase);

		await expect(
			actions.login(
				makeEvent({
					email: 'cliente@example.com',
					password: 'secret123'
				}) as never
			)
		).rejects.toMatchObject({ status: 303, location: '/odonto' });

		expect(auth.signInWithPassword).toHaveBeenCalledWith({
			email: 'cliente@example.com',
			password: 'secret123'
		});
		expect(supabase.rpc).not.toHaveBeenCalledWith('is_email_enabled', expect.anything());
	});
});
