import { env } from '$env/dynamic/private';
import { demoBusinessContext } from '$lib/server/business';
import { getOdontoContext } from '$lib/server/odonto-context';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');

	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			professional: null,
			services: [],
			availabilityRules: [],
			availabilityExceptions: [],
			demo: true
		};
	}

	const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
	if (business.role !== 'professional' || !business.capabilities.canViewOwnAppointments) {
		throw redirect(303, '/odonto/agenda');
	}

	const { data: links, error: linksError } = await supabase
		.from('professional_users')
		.select('professional_id, professionals!inner(id, name, specialty, phone, email, is_active, is_public)')
		.eq('business_id', business.business.id)
		.eq('user_id', userId)
		.limit(2);

	if (linksError) {
		console.error('Error cargando perfil profesional', linksError);
	}

	const professional = (links ?? [])[0]?.professionals ?? null;
	const professionalId = (links ?? [])[0]?.professional_id ?? null;
	const hasInconsistentLinks = (links ?? []).length > 1;

	const [{ data: serviceLinks }, { data: availabilityRules }, { data: availabilityExceptions }] =
		professionalId
			? await Promise.all([
					supabase
						.from('professional_services')
						.select('services!inner(id, name, duration_minutes, price_label, is_active, is_public)')
						.eq('business_id', business.business.id)
						.eq('professional_id', professionalId),
					supabase
						.from('availability_rules')
						.select('weekday, start_time, end_time, slot_interval_minutes, is_active')
						.eq('business_id', business.business.id)
						.eq('professional_id', professionalId)
						.eq('is_active', true)
						.order('weekday')
						.order('start_time'),
					supabase
						.from('availability_exceptions')
						.select('starts_at, ends_at, type, reason')
						.eq('business_id', business.business.id)
						.eq('professional_id', professionalId)
						.gte('ends_at', new Date().toISOString())
						.order('starts_at')
						.limit(20)
				])
			: [{ data: [] }, { data: [] }, { data: [] }];

	return {
		context: business,
		professional,
		hasInconsistentLinks,
		services: (serviceLinks ?? []).map((item: any) => item.services).filter(Boolean),
		availabilityRules: availabilityRules ?? [],
		availabilityExceptions: availabilityExceptions ?? [],
		demo: false
	};
};
