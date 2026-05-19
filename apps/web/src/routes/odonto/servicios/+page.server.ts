import { env } from '$env/dynamic/private';
import { demoBusinessContext } from '$lib/server/business';
import { writeAuditLog } from '$lib/server/audit';
import { getOdontoContext } from '$lib/server/odonto-context';
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
		return { context: demoBusinessContext(), services: [], demo: true };
	}

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	if (!business.canOperate) throw redirect(303, business.role === 'professional' ? '/odonto/mis-turnos' : '/odonto/agenda');
	const { data, error } = await supabase
		.from('services')
		.select('id, name, description, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_label, is_public, is_active, sort_order')
		.eq('business_id', business.business.id)
		.order('sort_order')
		.order('name');

	if (error) console.error('Error cargando servicios', error);
	return { context: business, services: data ?? [], demo: false };
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
				is_public: boolFromForm(form, 'is_public'),
				is_active: boolFromForm(form, 'is_active'),
				sort_order: parsePositiveInt(form.get('sort_order'), 0)
			})
			.select('id')
			.single();

		if (error) {
			console.error('Error creando servicio', error);
			return fail(500, { message: 'No se pudo crear el servicio.', values: Object.fromEntries(form) });
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

		const { error } = await supabase
			.from('services')
			.update({
				name,
				description: String(form.get('description') ?? '').trim() || null,
				duration_minutes: duration,
				buffer_before_minutes: Math.max(parsePositiveInt(form.get('buffer_before_minutes'), 0), 0),
				buffer_after_minutes: Math.max(parsePositiveInt(form.get('buffer_after_minutes'), 0), 0),
				price_label: String(form.get('price_label') ?? '').trim() || null,
				is_public: boolFromForm(form, 'is_public'),
				is_active: boolFromForm(form, 'is_active'),
				sort_order: parsePositiveInt(form.get('sort_order'), 0),
				updated_at: new Date().toISOString()
			})
			.eq('business_id', business.business.id)
			.eq('id', serviceId);

		if (error) {
			console.error('Error actualizando servicio', error);
			return fail(500, { message: 'No se pudo actualizar el servicio.' });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'service.updated',
			entityType: 'service',
			entityId: serviceId
		});

		return { success: true, message: 'Servicio actualizado.' };
	}
};
