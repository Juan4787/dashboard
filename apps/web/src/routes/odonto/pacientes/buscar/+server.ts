import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/odonto-context';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const cleanQuery = (value: string) => value.trim().replace(/\s+/g, ' ');

export const GET: RequestHandler = async ({ url, locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') return json({ patients: [] });

	const query = cleanQuery(url.searchParams.get('q') ?? '');
	if (query.length < 2) return json({ patients: [] });

	const { supabase, business } = await getOdontoContext({
		locals,
		fetch,
		cookies,
		membershipCache: 'short'
	});
	const safeQuery = query.replace(/[%_]/g, '\\$&');
	const digits = query.replace(/\D/g, '');
	const filters = [
		`full_name.ilike.%${safeQuery}%`,
		`phone_e164.ilike.%${safeQuery}%`,
		`dni.ilike.%${safeQuery}%`
	];
	if (digits.length >= 3) filters.push(`phone_e164.ilike.%${digits}%`);

	const { data, error } = await supabase
		.from('patients')
		.select('id, full_name, phone_e164, blocked')
		.eq('business_id', business.business.id)
		.is('archived_at', null)
		.or(filters.join(','))
		.order('updated_at', { ascending: false })
		.limit(12);

	if (error) {
		console.error('Error buscando pacientes', error);
		return json({ message: 'No se pudo buscar pacientes.' }, { status: 500 });
	}

	return json({ patients: data ?? [] });
};
