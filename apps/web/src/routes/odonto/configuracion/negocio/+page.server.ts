import {
	BUSINESS_INDUSTRIES,
	isBusinessIndustry,
	normalizeSlug,
	resolveActiveBusiness
} from '$lib/server/business';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch, cookies, url }) => {
	if (!locals.auth) throw redirect(303, '/login');

	if (env.DEMO_MODE === 'true') {
		const { demoBusinessContext } = await import('$lib/server/business');
		return {
			context: demoBusinessContext(),
			industries: BUSINESS_INDUSTRIES,
			publicBookingUrl: `${url.origin}/reservar/consultorio-demo`,
			readiness: { services: 1, professionals: 1, availabilityRules: 1 },
			demo: true
		};
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth.access_token,
		cookies
	});

	if (!context) {
		throw kitError(500, 'No se pudo resolver el negocio activo');
	}
	if (context.role === 'professional') throw redirect(303, '/odonto/mis-turnos');

	const [{ count: services }, { count: professionals }, { count: availabilityRules }] = await Promise.all([
		supabase
			.from('services')
			.select('id', { count: 'exact', head: true })
			.eq('business_id', context.business.id)
			.eq('is_active', true)
			.eq('is_public', true),
		supabase
			.from('professionals')
			.select('id', { count: 'exact', head: true })
			.eq('business_id', context.business.id)
			.eq('is_active', true)
			.eq('is_public', true),
		supabase
			.from('availability_rules')
			.select('id', { count: 'exact', head: true })
			.eq('business_id', context.business.id)
			.eq('is_active', true)
	]);
	const siteUrl = publicEnv.PUBLIC_SITE_URL?.trim() || url.origin;
	const publicBookingUrl = `${siteUrl.replace(/\/$/, '')}/reservar/${context.business.slug}`;

	return {
		context,
		industries: BUSINESS_INDUSTRIES,
		publicBookingUrl,
		readiness: {
			services: services ?? 0,
			professionals: professionals ?? 0,
			availabilityRules: availabilityRules ?? 0
		},
		demo: false
	};
};

export const actions: Actions = {
	update_business: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const context = await resolveActiveBusiness({
			supabase,
			accessToken: locals.auth.access_token,
			cookies
		});

		if (!context) {
			return fail(500, { message: 'No se pudo resolver el negocio activo.' });
		}
		if (!context.canManage) {
			return fail(403, { message: 'No tenés permisos para editar el negocio.' });
		}

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const slug = normalizeSlug(String(form.get('slug') ?? ''));
		const industry = String(form.get('industry') ?? '').trim();
		const phone = String(form.get('phone') ?? '').trim();
		const email = String(form.get('email') ?? '').trim();
		const address = String(form.get('address') ?? '').trim();
		const logo_url = String(form.get('logo_url') ?? '').trim();
		const timezone = String(form.get('timezone') ?? '').trim() || 'America/Argentina/Cordoba';
		const min_booking_notice_minutes = Number(form.get('min_booking_notice_minutes') ?? 1440);
		const max_booking_days_ahead = Number(form.get('max_booking_days_ahead') ?? 60);
		const cancellation_policy = String(form.get('cancellation_policy') ?? '').trim();

		if (!name) {
			return fail(400, { message: 'El nombre del consultorio es obligatorio.', values: Object.fromEntries(form) });
		}
		if (!slug) {
			return fail(400, { message: 'El slug público es obligatorio.', values: Object.fromEntries(form) });
		}
		if (!isBusinessIndustry(industry)) {
			return fail(400, { message: 'La industria seleccionada no es válida.', values: Object.fromEntries(form) });
		}
		if (!Number.isInteger(min_booking_notice_minutes) || min_booking_notice_minutes < 0) {
			return fail(400, {
				message: 'La anticipación mínima debe ser un número entero mayor o igual a 0.',
				values: Object.fromEntries(form)
			});
		}
		if (!Number.isInteger(max_booking_days_ahead) || max_booking_days_ahead < 1) {
			return fail(400, {
				message: 'Los días máximos hacia adelante deben ser mayores a 0.',
				values: Object.fromEntries(form)
			});
		}

		const { error } = await supabase
			.from('businesses')
			.update({
				name,
				slug,
				industry,
				phone: phone || null,
				email: email || null,
				address: address || null,
				logo_url: logo_url || null,
				timezone,
				public_booking_enabled: form.get('public_booking_enabled') === 'true',
				whatsapp_enabled: form.get('whatsapp_enabled') === 'true',
				allow_same_day_booking: form.get('allow_same_day_booking') === 'true',
				min_booking_notice_minutes,
				max_booking_days_ahead,
				cancellation_policy: cancellation_policy || null,
				is_active: form.get('is_active') === 'true',
				updated_at: new Date().toISOString()
			})
			.eq('id', context.business.id);

		if (error) {
			console.error('Error actualizando negocio', error);
			const message = error.code === '23505' ? 'Ese slug ya está en uso.' : 'No se pudo guardar el negocio.';
			return fail(500, { message, values: Object.fromEntries(form) });
		}

		return { success: true };
	}
};
