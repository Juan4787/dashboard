import { env } from '$env/dynamic/private';
import { demoBusinessContext, resolveActiveBusiness } from '$lib/server/business';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { error as kitError, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');

	if (env.DEMO_MODE === 'true') {
		return {
			demo: true,
			context: demoBusinessContext(),
			bookingPath: '/reservar/demo-business'
		};
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth.access_token,
		cookies
	});
	if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');
	if (context.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	if (context.role !== 'owner' && context.role !== 'admin') throw redirect(303, '/odonto/agenda');

	return {
		demo: false,
		context,
		bookingPath: `/reservar/${context.business.id}`
	};
};
