import { env } from '$env/dynamic/private';
import { demoBusinessContext } from '$lib/server/business';
import { writeAuditLog } from '$lib/server/audit';
import { getOdontoContext } from '$lib/server/odonto-context';
import { idsFromForm, setServiceProfessionals } from '$lib/server/professional-services';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const boolFromForm = (form: FormData, key: string) => form.get(key) === 'true';

const parsePositiveInt = (value: FormDataEntryValue | null, fallback = 0) => {
	const parsed = Number(value ?? fallback);
	return Number.isInteger(parsed) ? parsed : fallback;
};

export const load: PageServerLoad = async ({ locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			services: [],
			professionals: [],
			serviceProfessionalIds: {},
			demo: true
		};
	}

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	if (!business.canOperate) throw redirect(303, business.role === 'professional' ? '/odonto/mis-turnos' : '/odonto/agenda');
	const [{ data, error }, { data: professionals }, { data: assignments }] = await Promise.all([
		supabase
			.from('services')
			.select('id, name, description, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_label, is_public, is_active, sort_order')
			.eq('business_id', business.business.id)
			.order('sort_order')
			.order('name'),
		supabase
			.from('professionals')
			.select('id, name, is_active, is_public, sort_order')
			.eq('business_id', business.business.id)
			.order('sort_order')
			.order('name'),
		supabase
			.from('professional_services')
			.select('service_id, professional_id')
			.eq('business_id', business.business.id)
	]);

	if (error) console.error('Error cargando servicios', error);
	const serviceProfessionalIds = (assignments ?? []).reduce(
		(acc: Record<string, string[]>, assignment: any) => {
			const serviceId = String(assignment.service_id);
			acc[serviceId] = acc[serviceId] ?? [];
			acc[serviceId].push(String(assignment.professional_id));
			return acc;
		},
		{}
	);

	return {
		context: business,
		services: data ?? [],
		professionals: professionals ?? [],
		serviceProfessionalIds,
		demo: false
	};
};

export const actions: Actions = {
	create_service: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para crear servicios.' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const duration = parsePositiveInt(form.get('duration_minutes'), 30);
		if (!name) return fail(400, { message: 'El nombre es obligatorio.', values: Object.fromEntries(form) });
		if (duration <= 0) return fail(400, { message: 'La duración debe ser mayor a 0.', values: Object.fromEntries(form) });
		const isAvailable = boolFromForm(form, 'is_available');
		const professionalIds = idsFromForm(form, 'professional_id');

		const { data, error } = await supabase
			.from('services')
			.insert({
				business_id: business.business.id,
				name,
				description: String(form.get('description') ?? '').trim() || null,
				duration_minutes: duration,
				buffer_before_minutes: Math.max(parsePositiveInt(form.get('buffer_before_minutes'), 0), 0),
				buffer_after_minutes: Math.max(parsePositiveInt(form.get('buffer_after_minutes'), 0), 0),
				price_label: String(form.get('price_label') ?? '').trim() || null,
				is_public: isAvailable,
				is_active: isAvailable
			})
			.select('id')
			.single();

		if (error) {
			console.error('Error creando servicio', error);
			return fail(500, { message: 'No se pudo crear el servicio.', values: Object.fromEntries(form) });
		}

		try {
			await setServiceProfessionals(supabase, business.business.id, data.id, professionalIds);
		} catch (assignmentError) {
			console.error('Error asignando profesionales al servicio', assignmentError);
			return fail(500, {
				message: 'El servicio se creó, pero no se pudieron guardar los profesionales que lo atienden.',
				values: Object.fromEntries(form)
			});
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'service.created',
			entityType: 'service',
			entityId: data?.id ?? null,
			metadata: { name, duration_minutes: duration }
		});

		return { success: true, message: 'Servicio creado.' };
	},
	update_service: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para editar servicios.' });

		const form = await request.formData();
		const serviceId = String(form.get('service_id') ?? '').trim();
		const name = String(form.get('name') ?? '').trim();
		const duration = parsePositiveInt(form.get('duration_minutes'), 30);
		if (!serviceId) return fail(400, { message: 'Servicio inválido.' });
		if (!name) return fail(400, { message: 'El nombre es obligatorio.' });
		if (duration <= 0) return fail(400, { message: 'La duración debe ser mayor a 0.' });
		const isAvailable = boolFromForm(form, 'is_available');
		const professionalIds = idsFromForm(form, 'professional_id');

		const { error } = await supabase
			.from('services')
			.update({
				name,
				description: String(form.get('description') ?? '').trim() || null,
				duration_minutes: duration,
				buffer_before_minutes: Math.max(parsePositiveInt(form.get('buffer_before_minutes'), 0), 0),
				buffer_after_minutes: Math.max(parsePositiveInt(form.get('buffer_after_minutes'), 0), 0),
				price_label: String(form.get('price_label') ?? '').trim() || null,
				is_public: isAvailable,
				is_active: isAvailable,
				updated_at: new Date().toISOString()
			})
			.eq('business_id', business.business.id)
			.eq('id', serviceId);

		if (error) {
			console.error('Error actualizando servicio', error);
			return fail(500, { message: 'No se pudo actualizar el servicio.' });
		}

		try {
			await setServiceProfessionals(supabase, business.business.id, serviceId, professionalIds);
		} catch (assignmentError) {
			console.error('Error actualizando profesionales del servicio', assignmentError);
			const message =
				assignmentError instanceof Error && assignmentError.message === 'INVALID_PROFESSIONAL_ASSIGNMENT'
					? 'Algún profesional seleccionado no pertenece a este consultorio.'
					: 'No se pudieron actualizar los profesionales que atienden este servicio.';
			return fail(500, { message });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'service.updated',
			entityType: 'service',
			entityId: serviceId,
			metadata: { professional_ids: professionalIds }
		});

		return { success: true, message: 'Servicio actualizado.' };
	}
};
