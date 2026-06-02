import { env } from '$env/dynamic/private';
import { demoBusinessContext } from '$lib/server/business';
import { writeAuditLog } from '$lib/server/audit';
import { getOdontoContext } from '$lib/server/odonto-context';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const boolFromForm = (form: FormData, key: string) => form.get(key) === 'true';

export const load: PageServerLoad = async ({ locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');

	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			professionals: [],
			demo: true
		};
	}

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	if (!business.capabilities.canConfigureProfessionals) {
		throw redirect(303, business.role === 'professional' ? '/odonto/mis-turnos' : '/odonto/agenda');
	}
	const businessId = business.business.id;

	const { data: professionals, error: professionalsError } = await supabase
		.from('professionals')
		.select('id, name, specialty, phone, email, avatar_url, is_public, is_active, sort_order, created_at')
		.eq('business_id', businessId)
		.order('sort_order')
		.order('name');

	if (professionalsError) {
		console.error('Error cargando profesionales', professionalsError);
	}

	return {
		context: business,
		professionals: professionals ?? [],
		demo: false
	};
};

export const actions: Actions = {
	create_professional: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.capabilities.canConfigureProfessionals) return fail(403, { message: 'No tenés permisos para crear profesionales.' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'El nombre es obligatorio.', values: Object.fromEntries(form) });
		const isAvailable = boolFromForm(form, 'is_available');

		const { data, error } = await supabase
			.from('professionals')
			.insert({
				business_id: business.business.id,
				name,
				specialty: String(form.get('specialty') ?? '').trim() || null,
				phone: String(form.get('phone') ?? '').trim() || null,
				email: String(form.get('email') ?? '').trim() || null,
				is_public: isAvailable,
				is_active: isAvailable
			})
			.select('id')
			.single();

		if (error) {
			console.error('Error creando profesional', error);
			return fail(500, { message: 'No se pudo crear el profesional.', values: Object.fromEntries(form) });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'professional.created',
			entityType: 'professional',
			entityId: data?.id ?? null
		});

		return { success: true, message: 'Profesional creado.' };
	},
	update_professional: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.capabilities.canConfigureProfessionals) return fail(403, { message: 'No tenés permisos para editar profesionales.' });

		const form = await request.formData();
		const professionalId = String(form.get('professional_id') ?? '').trim();
		const name = String(form.get('name') ?? '').trim();
		if (!professionalId) return fail(400, { message: 'Profesional inválido.' });
		if (!name) return fail(400, { message: 'El nombre es obligatorio.' });
		const isAvailable = boolFromForm(form, 'is_available');

		const { error } = await supabase
			.from('professionals')
			.update({
				name,
				specialty: String(form.get('specialty') ?? '').trim() || null,
				phone: String(form.get('phone') ?? '').trim() || null,
				email: String(form.get('email') ?? '').trim() || null,
				is_public: isAvailable,
				is_active: isAvailable,
				updated_at: new Date().toISOString()
			})
			.eq('business_id', business.business.id)
			.eq('id', professionalId);

		if (error) {
			console.error('Error actualizando profesional', error);
			return fail(500, { message: 'No se pudo actualizar el profesional.' });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'professional.updated',
			entityType: 'professional',
			entityId: professionalId
		});

		return { success: true, message: 'Profesional actualizado.' };
	},
	link_user: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.capabilities.canManageUsers) return fail(403, { message: 'No tenés permisos para vincular usuarios.' });

		const form = await request.formData();
		const professionalId = String(form.get('professional_id') ?? '').trim();
		const targetUserId = String(form.get('user_id') ?? '').trim();
		if (!professionalId || !targetUserId) return fail(400, { message: 'Faltan datos para vincular.' });

		const { error } = await supabase.rpc('link_professional_user_safely', {
			p_business_id: business.business.id,
			p_professional_id: professionalId,
			p_user_id: targetUserId
		});

		if (error) {
			console.error('Error vinculando usuario profesional', error);
			const message = error.message?.includes('PROFESSIONAL_USER_ROLE_REQUIRED')
				? 'Ese usuario debe tener rol Profesional antes de vincularlo.'
				: error.message?.includes('USER_ALREADY_LINKED_TO_PROFESSIONAL')
					? 'Ese usuario ya está vinculado a otro profesional.'
					: error.message?.includes('PROFESSIONAL_ALREADY_LINKED_TO_USER')
						? 'Ese profesional ya tiene un usuario vinculado.'
						: 'No se pudo vincular el usuario.';
			return fail(500, { message });
		}

		return { success: true, message: 'Usuario vinculado.' };
	},
	unlink_user: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.capabilities.canManageUsers) return fail(403, { message: 'No tenés permisos para desvincular usuarios.' });

		const form = await request.formData();
		const linkId = String(form.get('link_id') ?? '').trim();
		const professionalId = String(form.get('professional_id') ?? '').trim();
		if (!linkId) return fail(400, { message: 'Vínculo inválido.' });

		const { error } = await supabase.rpc('unlink_professional_user_safely', {
			p_business_id: business.business.id,
			p_link_id: linkId
		});

		if (error) {
			console.error('Error desvinculando usuario profesional', error);
			return fail(500, { message: 'No se pudo desvincular el usuario.' });
		}
		void professionalId;

		return { success: true, message: 'Usuario desvinculado.' };
	}
};
