import { demoBusinessContext, resolveActiveBusiness } from '$lib/server/business';
import { getEmailFromAccessToken, isMasterEmail } from '$lib/server/supabase';
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { env } from '$env/dynamic/private';

export const load: LayoutServerLoad = async ({ locals, fetch, cookies }) => {
	if (!locals.auth) {
		throw redirect(303, '/login');
	}
	if (locals.auth.module !== 'odonto') {
		// Administrativo deshabilitado por ahora.
		throw redirect(303, '/odonto/pacientes');
	}
	const email = getEmailFromAccessToken(locals.auth.access_token);
	let activeBusiness = null;
	let businessError: string | null = null;

	if (env.DEMO_MODE === 'true') {
		activeBusiness = demoBusinessContext();
	} else {
		try {
			const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
			activeBusiness = await resolveActiveBusiness({
				supabase,
				accessToken: locals.auth.access_token,
				cookies
			});
			if (!activeBusiness && !isMasterEmail(email)) {
				businessError =
					'Tu email está habilitado, pero no tiene un consultorio asignado. Contactá soporte.';
			}
		} catch (err) {
			console.error('Error resolviendo negocio activo', err);
			businessError =
				err instanceof Error && err.message === 'MULTI_MEMBERSHIP_BLOCKED'
					? 'Este email tiene más de un acceso asociado. Contactá soporte para corregirlo.'
					: 'No se pudo cargar el negocio activo. Revisá que las migraciones de acceso estén aplicadas.';
		}
	}

	return {
		module: 'odonto' as const,
		isMaster: isMasterEmail(email),
		activeBusiness,
		businessError
	};
};
