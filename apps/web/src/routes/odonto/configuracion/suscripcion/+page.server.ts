import { env } from '$env/dynamic/private';
import { demoBusinessContext, resolveActiveBusiness } from '$lib/server/business';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { error as kitError, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');

	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			grants: [],
			demo: true
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
	if (context.role === 'readonly') throw redirect(303, '/odonto/agenda');
	if (context.role !== 'owner' && context.role !== 'admin') {
		throw redirect(303, '/odonto/configuracion');
	}

	const { data: grants, error } = await supabase
		.from('access_grants')
		.select(
			'id, operation, duration_unit, duration_seconds, is_permanent_grant, amount, source, note, admin_email, paid_until_before, paid_until_after, status_before, status_after, created_at'
		)
		.eq('business_id', context.business.id)
		.order('created_at', { ascending: false })
		.limit(30);

	if (error) {
		console.error('Error cargando historial de suscripción', error);
	}

	return {
		context,
		grants: grants ?? [],
		demo: false
	};
};
