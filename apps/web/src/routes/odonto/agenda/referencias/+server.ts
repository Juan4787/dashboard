import { env } from '$env/dynamic/private';
import { getOdontoContext } from '$lib/server/odonto-context';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, fetch, cookies, setHeaders }) => {
	if (!locals.auth) throw redirect(303, '/login');
	setHeaders({ 'cache-control': 'private, no-store' });
	if (env.DEMO_MODE === 'true') {
		return json({ professionals: [], services: [], patients: [], service_professional_ids: {} });
	}

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	if (business.role === 'professional') {
		return json({ message: 'No tenés permisos para administrar la agenda.' }, { status: 403 });
	}
	const businessId = business.business.id;
	const [professionalsResult, servicesResult, patientsResult, assignmentsResult] = await Promise.all([
		supabase
			.from('professionals')
			.select('id, name, specialty, is_active')
			.eq('business_id', businessId)
			.eq('is_active', true)
			.order('sort_order')
			.order('name'),
		supabase
			.from('services')
			.select('id, name, duration_minutes, is_active')
			.eq('business_id', businessId)
			.eq('is_active', true)
			.order('sort_order')
			.order('name'),
		supabase
			.from('patients')
			.select('id, full_name, phone_e164, blocked')
			.eq('business_id', businessId)
			.is('archived_at', null)
			.order('updated_at', { ascending: false })
			.limit(250),
		supabase
			.from('professional_services')
			.select('service_id, professional_id')
			.eq('business_id', businessId)
	]);
	const error =
		professionalsResult.error ??
		servicesResult.error ??
		patientsResult.error ??
		assignmentsResult.error;
	if (error) {
		console.error('Error cargando referencias de agenda', error);
		return json({ message: 'No se pudieron cargar profesionales, servicios y pacientes.' }, { status: 500 });
	}
	const serviceProfessionalIds = (assignmentsResult.data ?? []).reduce<Record<string, string[]>>(
		(acc, assignment: any) => {
			const serviceId = String(assignment.service_id);
			acc[serviceId] = acc[serviceId] ?? [];
			acc[serviceId].push(String(assignment.professional_id));
			return acc;
		},
		{}
	);
	return json({
		professionals: professionalsResult.data ?? [],
		services: servicesResult.data ?? [],
		patients: patientsResult.data ?? [],
		service_professional_ids: serviceProfessionalIds
	});
};
