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

const moduleHome = (module: Module) => getModuleEntryRoute(module);

export const handle: Handle = async ({ event, resolve }) => {
	const moduleCookie = event.cookies.get('sb-module') as Module | undefined;
	const accessToken = event.cookies.get('sb-access-token');
	const refreshToken = event.cookies.get('sb-refresh-token');

	event.locals.auth =
		moduleCookie && accessToken && refreshToken
			? { module: moduleCookie, access_token: accessToken, refresh_token: refreshToken }
			: null;

	const isDemo = env.DEMO_MODE === 'true';
	if (event.locals.auth && !isDemo) {
		if (isJwtExpired(event.locals.auth.access_token)) {
			try {
				const supabase = await createSupabaseServerClient('odonto', null);
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
			} catch (err) {
				const options = { path: '/' };
				event.cookies.delete('sb-module', options);
				event.cookies.delete('sb-access-token', options);
				event.cookies.delete('sb-refresh-token', options);
				throw redirect(303, '/login');
			}
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

	return resolve(event);
};
