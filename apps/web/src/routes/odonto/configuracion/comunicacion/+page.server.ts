import { env } from '$env/dynamic/private';
import {
	BOT_REPLY_TEMPLATE_NAME,
	DEFAULT_BOT_REPLY_TEMPLATE_BODY,
	ensureMockMessagingSetup,
	type MessagingProviderName
} from '$lib/server/messaging';
import { resolveActiveBusiness } from '$lib/server/business';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const parseProvider = (value: FormDataEntryValue | null): MessagingProviderName => {
	const provider = String(value ?? 'meta_cloud').trim();
	return provider === 'mock' ? 'mock' : 'meta_cloud';
};

const normalizeNullable = (value: FormDataEntryValue | null) => {
	const text = String(value ?? '').trim();
	return text || null;
};

export const load: PageServerLoad = async ({ locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return {
			demo: true,
			context: null,
			account: null,
			botTemplate: null,
			defaultBotReplyBody: DEFAULT_BOT_REPLY_TEMPLATE_BODY,
			lastEvent: null,
			bookingPath: '/reservar/demo-business',
			pushStats: { active: 0, sent7d: 0, revoked7d: 0 }
		};
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
	if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');
	if (context.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	if (context.role !== 'owner' && context.role !== 'admin') throw redirect(303, '/odonto/agenda');

	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
	const [
		{ data: account },
		{ data: botTemplate },
		{ data: lastEvent },
		{ count: activePush },
		{ count: pushSent7d },
		{ count: pushRevoked7d }
	] = await Promise.all([
		supabase
			.from('messaging_accounts')
			.select(
				'id, provider, status, phone_number, phone_number_id, waba_id, display_name, access_token_secret_name, bot_enabled, reminders_enabled, last_error, updated_at'
			)
			.eq('business_id', context.business.id)
			.order('created_at', { ascending: true })
			.limit(1)
			.maybeSingle(),
		supabase
			.from('message_templates')
			.select('id, body, status, updated_at')
			.eq('business_id', context.business.id)
			.eq('name', BOT_REPLY_TEMPLATE_NAME)
			.eq('language', 'es_AR')
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
		botTemplate,
		defaultBotReplyBody: DEFAULT_BOT_REPLY_TEMPLATE_BODY,
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
		const provider = parseProvider(form.get('provider'));
		const displayName = normalizeNullable(form.get('display_name'));
		const phoneNumber = normalizeNullable(form.get('phone_number'));
		const phoneNumberId = normalizeNullable(form.get('phone_number_id'));
		const wabaId = normalizeNullable(form.get('waba_id'));
		const accessTokenSecretName =
			normalizeNullable(form.get('access_token_secret_name')) ?? 'WHATSAPP_ACCESS_TOKEN';
		const replyBody = String(form.get('reply_body') ?? '').trim();

		if (enabled && provider === 'meta_cloud') {
			if (!phoneNumber) return fail(400, { message: 'Cargá el teléfono de WhatsApp.' });
			if (!phoneNumberId) return fail(400, { message: 'Cargá el Phone Number ID de Meta.' });
			if (!accessTokenSecretName) return fail(400, { message: 'Cargá la variable del token de WhatsApp.' });
		}
		if (!replyBody) return fail(400, { message: 'Cargá el mensaje automático.' });
		if (replyBody.length > 1000) {
			return fail(400, { message: 'El mensaje automático no puede superar 1000 caracteres.' });
		}

		const payload = {
			business_id: context.business.id,
			provider,
			status: enabled ? 'active' : 'paused',
			display_name: displayName,
			phone_number: phoneNumber,
			phone_number_id: provider === 'meta_cloud' ? phoneNumberId : null,
			waba_id: provider === 'meta_cloud' ? wabaId : null,
			access_token_secret_name: provider === 'meta_cloud' ? accessTokenSecretName : null,
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
			if (result.error.code === '23505') {
				return fail(409, { message: 'Ese Phone Number ID ya está asignado a otro consultorio.' });
			}
			return fail(500, { message: 'No se pudo guardar la comunicación.' });
		}

		const { error: templateError } = await supabase.from('message_templates').upsert(
			{
				business_id: context.business.id,
				provider,
				name: BOT_REPLY_TEMPLATE_NAME,
				category: 'service',
				language: 'es_AR',
				status: 'approved',
				body: replyBody,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'business_id,name,language' }
		);
		if (templateError) {
			console.error('Error guardando template de respuesta automática', templateError);
			return fail(500, { message: 'No se pudo guardar el mensaje automático.' });
		}

		await supabase.from('businesses').update({ whatsapp_enabled: enabled }).eq('id', context.business.id);
		return { success: true, message: enabled ? 'Respuesta automática activada.' : 'Respuesta automática pausada.' };
	}
};
