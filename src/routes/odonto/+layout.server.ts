import { getEmailFromAccessToken, isMasterEmail } from '$lib/server/supabase';
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.auth) {
		throw redirect(303, '/login');
	}
	if (locals.auth.module !== 'odonto') {
		// Administrativo deshabilitado por ahora.
		throw redirect(303, '/odonto/pacientes');
	}
	const email = getEmailFromAccessToken(locals.auth.access_token);
	return { module: 'odonto' as const, isMaster: isMasterEmail(email) };
};
