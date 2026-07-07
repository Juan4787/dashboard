import { env } from '$env/dynamic/private';
import { clearSupabaseOAuthCookies, createSupabaseOAuthClient } from '$lib/server/supabase';
import type { RequestHandler } from '@sveltejs/kit';

const loginWithError = (url: URL, code: string): Response => {
	const target = new URL('/login', url.origin);
	target.searchParams.set('auth_error', code);
	return redirectResponse(target.toString());
};

const redirectResponse = (location: string): Response =>
	new Response(null, {
		status: 303,
		headers: { location }
	});

export const GET: RequestHandler = async ({ url, cookies, fetch }) => {
	if (env.DEMO_MODE === 'true') {
		return loginWithError(url, 'google_demo');
	}

	const mode = url.searchParams.get('mode') ?? 'login';
	const acceptedTerms = url.searchParams.get('accepted_terms') === 'true';
	if (mode === 'register' && !acceptedTerms) {
		return loginWithError(url, 'google_terms');
	}

	clearSupabaseOAuthCookies(cookies);
	const supabase = await createSupabaseOAuthClient('odonto', cookies, fetch);
	const { data, error } = await supabase.auth.signInWithOAuth({
		provider: 'google',
		options: {
			redirectTo: `${url.origin}/auth/callback`,
			scopes: 'openid email profile',
			queryParams: {
				prompt: 'select_account'
			}
		}
	});

	if (!error && typeof data.url === 'string' && data.url) {
		return redirectResponse(data.url);
	}

	console.error('Error iniciando OAuth con Google', error);
	return loginWithError(url, 'google_start');
};
