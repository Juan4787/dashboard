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
			readiness: { services: 1, professionals: 1, availabilityRules: 1, reservableServices: 1, reservableProfessionals: 1 },
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

	const [
		{ count: services },
		{ count: professionals },
		{ count: availabilityRules },
		{ data: assignments },
		{ data: rules }
	] = await Promise.all([
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
			.eq('is_active', true),
		supabase
			.from('professional_services')
			.select('service_id, professional_id, services!inner(is_active, is_public), professionals!inner(is_active, is_public)')
			.eq('business_id', context.business.id),
		supabase
			.from('availability_rules')
			.select('professional_id')
			.eq('business_id', context.business.id)
			.eq('is_active', true)
	]);
	const professionalsWithRules = new Set((rules ?? []).map((rule: any) => String(rule.professional_id)));
	const readyServices = new Set<string>();
	const readyProfessionals = new Set<string>();
	for (const assignment of assignments ?? []) {
		const service = (assignment as any).services;
		const professional = (assignment as any).professionals;
		if (!service?.is_active || !service?.is_public) continue;
		if (!professional?.is_active || !professional?.is_public) continue;
		if (!professionalsWithRules.has(String((assignment as any).professional_id))) continue;
		readyServices.add(String((assignment as any).service_id));
		readyProfessionals.add(String((assignment as any).professional_id));
	}
	const siteUrl = publicEnv.PUBLIC_SITE_URL?.trim() || url.origin;
	const publicBookingUrl = `${siteUrl.replace(/\/$/, '')}/reservar/${context.business.slug}`;

	return {
		context,
		industries: BUSINESS_INDUSTRIES,
		publicBookingUrl,
		readiness: {
			services: services ?? 0,
			professionals: professionals ?? 0,
			availabilityRules: availabilityRules ?? 0,
			reservableServices: readyServices.size,
			reservableProfessionals: readyProfessionals.size
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
			return fail(400, { message: 'El nombre del enlace público es obligatorio.', values: Object.fromEntries(form) });
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
		if (min_booking_notice_minutes > 10080) {
			return fail(400, {
				message: 'La anticipación mínima no puede superar 7 días.',
				values: Object.fromEntries(form)
			});
		}
		if (!Number.isInteger(max_booking_days_ahead) || max_booking_days_ahead < 1 || max_booking_days_ahead > 90) {
			return fail(400, {
				message: 'Los días máximos hacia adelante deben estar entre 1 y 90.',
				values: Object.fromEntries(form)
			});
		}
		try {
			new Intl.DateTimeFormat('es-AR', { timeZone: timezone }).format(new Date());
		} catch {
			return fail(400, {
				message: 'La zona horaria no es válida.',
				values: Object.fromEntries(form)
			});
		}
		if (logo_url) {
			try {
				const logo = new URL(logo_url);
				if (logo.protocol !== 'https:') throw new Error('INVALID_PROTOCOL');
			} catch {
				return fail(400, {
					message: 'El logo debe ser una URL segura que empiece con https://.',
					values: Object.fromEntries(form)
				});
			}
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
			const message = error.code === '23505' ? 'Ese nombre de enlace público ya está en uso.' : 'No se pudo guardar el negocio.';
			return fail(500, { message, values: Object.fromEntries(form) });
		}

		return { success: true };
	}
};
