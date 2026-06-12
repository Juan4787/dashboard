import { env } from '$env/dynamic/private';
import { ensureMockMessagingSetup } from '$lib/server/messaging';
import { resolveActiveBusiness } from '$lib/server/business';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return {
			demo: true,
			context: null,
			account: null,
			lastEvent: null,
			bookingPath: '/reservar/demo-business',
			pushStats: { active: 0, sent7d: 0, revoked7d: 0 }
		};
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
	if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');
	if (context.role === 'professional' || context.role === 'readonly') throw redirect(303, '/odonto/agenda');

	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
	const [
		{ data: account },
		{ data: lastEvent },
		{ count: activePush },
		{ count: pushSent7d },
		{ count: pushRevoked7d }
	] = await Promise.all([
		supabase
			.from('messaging_accounts')
			.select('id, provider, status, phone_number, display_name, bot_enabled, last_error, updated_at')
			.eq('business_id', context.business.id)
			.order('created_at', { ascending: true })
			.limit(1)
			.maybeSingle(),
		supabase
			.from('whatsapp_webhook_events')
			.select('id, event_type, processed, processing_error, received_at')
			.eq('business_id', context.business.id)
			.order('received_at', { ascending: false })
			.limit(1)
			.maybeSingle(),
		supabase
			.from('push_subscriptions')
			.select('id', { count: 'exact', head: true })
			.eq('business_id', context.business.id)
			.is('revoked_at', null),
		supabase
			.from('audit_logs')
			.select('id', { count: 'exact', head: true })
			.eq('business_id', context.business.id)
			.eq('action', 'appointment.push_sent')
			.gte('created_at', sevenDaysAgo),
		supabase
			.from('push_subscriptions')
			.select('id', { count: 'exact', head: true })
			.eq('business_id', context.business.id)
			.gte('revoked_at', sevenDaysAgo)
	]);

	return {
		demo: false,
		context,
		account,
		lastEvent,
		bookingPath: `/reservar/${context.business.id}`,
		pushStats: {
			active: activePush ?? 0,
			sent7d: pushSent7d ?? 0,
			revoked7d: pushRevoked7d ?? 0
		}
	};
};

export const actions: Actions = {
	activate_test_reply: async ({ locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
		if (!context?.canManage) return fail(403, { message: 'No tenés permisos para configurar comunicación.' });

		await ensureMockMessagingSetup(supabase, context.business.id);
		await supabase
			.from('messaging_accounts')
			.update({ bot_enabled: true, reminders_enabled: false, status: 'active' })
			.eq('business_id', context.business.id);
		await supabase.from('businesses').update({ whatsapp_enabled: true }).eq('id', context.business.id);

		return { success: true, message: 'Respuesta automática activada para prueba interna.' };
	},

	save_reply: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
		if (!context?.canManage) return fail(403, { message: 'No tenés permisos para configurar comunicación.' });

		const form = await request.formData();
		const accountId = String(form.get('account_id') ?? '').trim();
		const enabled = form.get('reply_enabled') === 'true';
		const displayName = String(form.get('display_name') ?? '').trim() || null;
		const phoneNumber = String(form.get('phone_number') ?? '').trim() || null;

		const payload = {
			business_id: context.business.id,
			provider: 'mock',
			status: enabled ? 'active' : 'paused',
			display_name: displayName,
			phone_number: phoneNumber,
			bot_enabled: enabled,
			reminders_enabled: false,
			updated_at: new Date().toISOString()
		};

		const result = accountId
			? await supabase
					.from('messaging_accounts')
					.update(payload)
					.eq('id', accountId)
					.eq('business_id', context.business.id)
			: await supabase.from('messaging_accounts').insert(payload);

		if (result.error) {
			console.error('Error guardando comunicación', result.error);
			return fail(500, { message: 'No se pudo guardar la comunicación.' });
		}

		await supabase.from('businesses').update({ whatsapp_enabled: enabled }).eq('id', context.business.id);
		return { success: true, message: enabled ? 'Respuesta automática activada.' : 'Respuesta automática pausada.' };
	}
};
