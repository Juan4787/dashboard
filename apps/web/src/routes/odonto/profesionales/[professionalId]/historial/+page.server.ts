import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/odonto-context';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return { professional: null, entries: [], loadError: null, demo: true };
	}

	const { business } = await getOdontoContext({ locals, fetch, cookies });
	if (!business.canManage) throw redirect(303, '/odonto/profesionales');

	const admin = await createSupabaseAdminClient('odonto', fetch);
	const businessId = business.business.id;

	const { data: professional } = await admin
		.from('professionals')
		.select('id, name')
		.eq('business_id', businessId)
		.eq('id', params.professionalId)
		.maybeSingle();

	const { data: entries, error } = await admin
		.from('clinical_entries')
		.select('id, created_at, entry_type, description, patient_id, patients(full_name)')
		.eq('business_id', businessId)
		.eq('professional_id', params.professionalId)
		.order('created_at', { ascending: false })
		.limit(300);

	return {
		professional: professional ?? null,
		entries: entries ?? [],
		loadError: error ? `No se pudo cargar el historial [${error.code ?? '?'}]: ${error.message ?? ''}` : null,
		demo: false
	};
};
