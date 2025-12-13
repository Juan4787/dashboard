import { getModuleEntryRoute, type Module } from '$lib/server/supabase';
import { redirect, type Handle } from '@sveltejs/kit';

const moduleHome = (module: Module) => getModuleEntryRoute(module);

export const handle: Handle = async ({ event, resolve }) => {
	const moduleCookie = event.cookies.get('sb-module') as Module | undefined;
	const accessToken = event.cookies.get('sb-access-token');
	const refreshToken = event.cookies.get('sb-refresh-token');

	event.locals.auth =
		moduleCookie && accessToken && refreshToken
			? { module: moduleCookie, access_token: accessToken, refresh_token: refreshToken }
			: null;

	const { pathname } = event.url;
	const wantsOdonto = pathname.startsWith('/odonto');
	const wantsAdmin = pathname.startsWith('/administrativo');
	const protectedRoute = wantsOdonto || wantsAdmin;

	if (!event.locals.auth && protectedRoute) {
		throw redirect(303, '/login');
	}

	if (event.locals.auth) {
		if (event.locals.auth.module === 'odonto' && wantsAdmin) {
			throw redirect(303, moduleHome('odonto'));
		}
		if (event.locals.auth.module === 'administrativo' && wantsOdonto) {
			throw redirect(303, moduleHome('administrativo'));
		}
	}

	return resolve(event);
};
