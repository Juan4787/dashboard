import { env } from '$env/dynamic/private';
import { demoBusinessContext } from '$lib/server/business';
import { writeAuditLog } from '$lib/server/audit';
import { getOdontoContext } from '$lib/server/odonto-context';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return { context: demoBusinessContext(), professional: null, services: [], assignedServiceIds: [], demo: true };
	}

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	if (!business.canOperate) throw redirect(303, business.role === 'professional' ? '/odonto/mis-turnos' : '/odonto/agenda');
	const businessId = business.business.id;

	const [{ data: professional, error: professionalError }, { data: services }, { data: assignments }] =
		await Promise.all([
			supabase
				.from('professionals')
				.select('id, name, specialty, is_active, is_public')
				.eq('business_id', businessId)
				.eq('id', params.professionalId)
				.maybeSingle(),
			supabase
				.from('services')
				.select('id, name, duration_minutes, is_active, is_public, sort_order')
				.eq('business_id', businessId)
				.order('sort_order')
				.order('name'),
			supabase
				.from('professional_services')
				.select('service_id')
				.eq('business_id', businessId)
				.eq('professional_id', params.professionalId)
		]);

	if (professionalError || !professional) throw kitError(404, 'Profesional no encontrado');

	return {
		context: business,
		professional,
		services: services ?? [],
		assignedServiceIds: (assignments ?? []).map((item: any) => String(item.service_id)),
		demo: false
	};
};

export const actions: Actions = {
	save_services: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para asignar servicios.' });

		const form = await request.formData();
		const serviceIds = form.getAll('service_id').map((value) => String(value).trim()).filter(Boolean);

		const { error: deleteError } = await supabase
			.from('professional_services')
			.delete()
			.eq('business_id', business.business.id)
			.eq('professional_id', params.professionalId);
		if (deleteError) {
			console.error('Error limpiando servicios del profesional', deleteError);
			return fail(500, { message: 'No se pudieron actualizar los servicios.' });
		}

		if (serviceIds.length > 0) {
			const { error: insertError } = await supabase.from('professional_services').insert(
				serviceIds.map((serviceId) => ({
					business_id: business.business.id,
					professional_id: params.professionalId,
					service_id: serviceId
				}))
			);
			if (insertError) {
				console.error('Error asignando servicios al profesional', insertError);
				return fail(500, { message: 'No se pudieron asignar los servicios.' });
			}
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'professional.services_updated',
			entityType: 'professional',
			entityId: params.professionalId,
			metadata: { service_ids: serviceIds }
		});

		return { success: true, message: 'Servicios asignados.' };
	}
};
