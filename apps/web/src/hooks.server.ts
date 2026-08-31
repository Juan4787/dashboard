import { dev } from '$app/environment';
import {
	createSupabaseServerClient,
	getEmailFromAccessToken,
	getModuleEntryRoute,
	isJwtExpired,
	isMasterEmail,
	type Module
} from '$lib/server/supabase';
import { redirect, type Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createHash } from 'node:crypto';

const AUTH_VALIDATION_CACHE_TTL_MS = 30_000;
const AUTH_VALIDATION_CACHE_MAX_ENTRIES = 500;
const validatedAccessTokens = new Map<string, number>();

const accessTokenCacheKey = (accessToken: string) =>
	createHash('sha256').update(accessToken).digest('base64url');

const hasFreshAuthValidation = (accessToken: string, now = Date.now()) => {
	const key = accessTokenCacheKey(accessToken);
	const expiresAt = validatedAccessTokens.get(key) ?? 0;
	if (expiresAt <= now) {
		validatedAccessTokens.delete(key);
		return false;
	}
	return true;
};

const rememberAuthValidation = (accessToken: string, now = Date.now()) => {
	if (validatedAccessTokens.size >= AUTH_VALIDATION_CACHE_MAX_ENTRIES) {
		const oldestKey = validatedAccessTokens.keys().next().value;
		if (typeof oldestKey === 'string') validatedAccessTokens.delete(oldestKey);
	}
	validatedAccessTokens.set(accessTokenCacheKey(accessToken), now + AUTH_VALIDATION_CACHE_TTL_MS);
};

const moduleHome = (module: Module) => getModuleEntryRoute(module);
const toHost = (value?: string | null) => {
	if (!value) return null;
	try {
		return new URL(value).host.toLowerCase();
	} catch {
		return null;
	}
};

const supabaseHosts = new Set(
	[toHost(env.ODONTO_SUPABASE_URL), toHost(env.ADMIN_SUPABASE_URL)].filter(
		(host): host is string => Boolean(host)
	)
);

export const handle: Handle = async ({ event, resolve }) => {
	const startedAt = performance.now();
	let authMs = 0;
	let dbQ = 0;
	let dbMs = 0;
	let dbMaxMs = 0;

	const originalFetch = event.fetch;
	event.fetch = async (input, init) => {
		const urlRaw =
			typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		let parsed: URL | null = null;
		try {
			parsed = new URL(urlRaw, event.url.origin);
		} catch {
			parsed = null;
		}

		const isSupabaseRequest = Boolean(parsed && supabaseHosts.has(parsed.host.toLowerCase()));
		const pathname = parsed?.pathname ?? '';
		const isRestRequest = isSupabaseRequest && pathname.startsWith('/rest/v1/');
		const isAuthRequest = isSupabaseRequest && pathname.startsWith('/auth/v1/');
		const fetchStart = performance.now();
		const response = await originalFetch(input, init);
		const fetchMs = performance.now() - fetchStart;

		if (isRestRequest || isAuthRequest) {
			dbQ += 1;
			dbMs += fetchMs;
			dbMaxMs = Math.max(dbMaxMs, fetchMs);
		}
		if (isAuthRequest) authMs += fetchMs;
		return response;
	};

	const moduleCookie = event.cookies.get('sb-module') as Module | undefined;
	const accessToken = event.cookies.get('sb-access-token');
	const refreshToken = event.cookies.get('sb-refresh-token');

	event.locals.auth =
		moduleCookie && accessToken && refreshToken
			? { module: moduleCookie, access_token: accessToken, refresh_token: refreshToken }
			: null;

	const clearAuthCookies = () => {
		const options = { path: '/' };
		event.cookies.delete('sb-module', options);
		event.cookies.delete('sb-access-token', options);
		event.cookies.delete('sb-refresh-token', options);
	};

	const isDemo = env.DEMO_MODE === 'true';
	if (event.locals.auth && !isDemo) {
		try {
			const supabase = await createSupabaseServerClient(
				event.locals.auth.module,
				null,
				event.fetch
			);
			if (isJwtExpired(event.locals.auth.access_token)) {
				const { data, error } = await supabase.auth.refreshSession({
					refresh_token: event.locals.auth.refresh_token
				});
				if (error || !data.session) {
					throw error ?? new Error('No se pudo refrescar la sesión');
				}

				const session = data.session;
				const cookieOptions = {
					path: '/',
					httpOnly: true,
					secure: !dev,
					sameSite: 'lax' as const,
					maxAge: 60 * 60 * 24 * 7
				};

				event.cookies.set('sb-module', event.locals.auth.module, cookieOptions);
				event.cookies.set('sb-access-token', session.access_token, cookieOptions);
				event.cookies.set('sb-refresh-token', session.refresh_token, cookieOptions);
				event.locals.auth = {
					module: event.locals.auth.module,
					access_token: session.access_token,
					refresh_token: session.refresh_token
				};
				// refreshSession ya validó el refresh token y emitió este access token.
				rememberAuthValidation(session.access_token);
			} else if (!hasFreshAuthValidation(event.locals.auth.access_token)) {
				const { data, error } = await supabase.auth.getClaims(
					event.locals.auth.access_token
				);
				if (error || !data?.claims?.sub) {
					throw error ?? new Error('Sesión inválida');
				}
				rememberAuthValidation(event.locals.auth.access_token);
			}
		} catch (err) {
			clearAuthCookies();
			throw redirect(303, '/login');
		}
	}

	const { pathname } = event.url;
	const wantsOdonto = pathname.startsWith('/odonto');
	const wantsAdmin = pathname.startsWith('/administrativo');
	const wantsMaster = pathname.startsWith('/odonto/maestro');
	const protectedRoute = wantsOdonto || wantsAdmin || wantsMaster;

	if (!event.locals.auth && protectedRoute) {
		throw redirect(303, '/login');
	}

	if (event.locals.auth) {
		const email = getEmailFromAccessToken(event.locals.auth.access_token);
		const isMaster = isMasterEmail(email);

		if (wantsMaster && !isMaster) {
			throw redirect(303, moduleHome('odonto'));
		}

		// Administrativo deshabilitado por ahora.
		if (wantsAdmin) {
			throw redirect(303, moduleHome('odonto'));
		}

		if (event.locals.auth.module === 'odonto' && wantsAdmin) {
			throw redirect(303, moduleHome('odonto'));
		}
		if (event.locals.auth.module === 'administrativo' && wantsOdonto) {
			throw redirect(303, moduleHome('odonto'));
		}
	}

	const response = await resolve(event);
	const securityHeaders: Record<string, string> = {
		'strict-transport-security': 'max-age=31536000',
		'x-content-type-options': 'nosniff',
		'x-frame-options': 'DENY',
		'referrer-policy': 'strict-origin-when-cross-origin',
		'permissions-policy': 'camera=(), microphone=(), geolocation=()'
	};
	for (const [name, value] of Object.entries(securityHeaders)) {
		if (!response.headers.has(name)) response.headers.set(name, value);
	}

	const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
	const isServerRenderedPage = response.headers.get('x-sveltekit-page') === 'true' || contentType.startsWith('text/html');
	if ((event.locals.auth || isServerRenderedPage) && !response.headers.has('cache-control')) {
		response.headers.set('cache-control', 'private, no-store');
	}

	const totalMs = performance.now() - startedAt;
	const loadMs = Math.max(totalMs - authMs, 0);
	const runtimeRegion = String(env.AWS_REGION ?? 'unknown').replace(
		/[^a-zA-Z0-9_-]/g,
		''
	);
	const timingValue = [
		`auth;dur=${authMs.toFixed(1)}`,
		`load;dur=${loadMs.toFixed(1)}`,
		`db;dur=${dbMs.toFixed(1)}`,
		`db_max;dur=${dbMaxMs.toFixed(1)}`,
		`db_q;desc="${dbQ}"`,
		`runtime_region;desc="${runtimeRegion || 'unknown'}"`
	].join(', ');
	const existingTiming = response.headers.get('Server-Timing');
	response.headers.set('Server-Timing', existingTiming ? `${existingTiming}, ${timingValue}` : timingValue);
	return response;
};
