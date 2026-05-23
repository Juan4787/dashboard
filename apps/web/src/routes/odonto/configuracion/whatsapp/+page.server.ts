import { env } from '$env/dynamic/private';
import { ensureMockMessagingSetup, REMINDER_TEMPLATE_NAME, DEFAULT_REMINDER_TEMPLATE_BODY } from '$lib/server/messaging';
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
			template: null,
			lastEvent: null,
			webhookUrl: '/api/whatsapp/webhook',
			hasJobSecret: Boolean(env.INTERNAL_JOB_SECRET),
			hasVerifyToken: Boolean(env.WHATSAPP_VERIFY_TOKEN)
		};
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
	if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');
	if (context.role === 'professional') throw redirect(303, '/odonto/mis-turnos');

	const [{ data: account }, { data: template }, { data: lastEvent }] = await Promise.all([
		supabase
			.from('messaging_accounts')
			.select('id, provider, status, phone_number, phone_number_id, waba_id, display_name, access_token_secret_name, bot_enabled, reminders_enabled, last_error, updated_at')
			.eq('business_id', context.business.id)
			.order('created_at', { ascending: true })
			.limit(1)
			.maybeSingle(),
		supabase
			.from('message_templates')
			.select('id, provider, provider_template_id, name, category, language, status, body, rejection_reason, updated_at')
			.eq('business_id', context.business.id)
			.eq('name', REMINDER_TEMPLATE_NAME)
			.order('created_at', { ascending: true })
			.limit(1)
			.maybeSingle(),
		supabase
			.from('whatsapp_webhook_events')
			.select('id, event_type, processed, processing_error, received_at')
			.eq('business_id', context.business.id)
			.order('received_at', { ascending: false })
			.limit(1)
			.maybeSingle()
	]);

	return {
		demo: false,
		context,
		account,
		template,
		lastEvent,
		webhookUrl: '/api/whatsapp/webhook',
		hasJobSecret: Boolean(env.INTERNAL_JOB_SECRET),
		hasVerifyToken: Boolean(env.WHATSAPP_VERIFY_TOKEN)
	};
};

export const actions: Actions = {
	create_mock_setup: async ({ locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
		if (!context?.canManage) return fail(403, { message: 'No tenés permisos para configurar WhatsApp.' });
		await ensureMockMessagingSetup(supabase, context.business.id);
		await supabase.from('businesses').update({ whatsapp_enabled: true }).eq('id', context.business.id);
		return { success: true, message: 'WhatsApp mock activado.' };
	},

	save_account: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
		if (!context?.canManage) return fail(403, { message: 'No tenés permisos para configurar WhatsApp.' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		const provider = String(form.get('provider') ?? 'mock').trim();
		const status = String(form.get('status') ?? 'pending').trim();
		const payload = {
			business_id: context.business.id,
			provider,
			status,
			phone_number: String(form.get('phone_number') ?? '').trim() || null,
			phone_number_id: String(form.get('phone_number_id') ?? '').trim() || null,
			waba_id: String(form.get('waba_id') ?? '').trim() || null,
			display_name: String(form.get('display_name') ?? '').trim() || null,
			access_token_secret_name: String(form.get('access_token_secret_name') ?? '').trim() || null,
			bot_enabled: form.get('bot_enabled') === 'true',
			reminders_enabled: form.get('reminders_enabled') === 'true',
			last_error: null,
			updated_at: new Date().toISOString()
		};

		if (!['mock', 'meta_cloud', 'bsp'].includes(provider)) return fail(400, { message: 'Proveedor inválido.' });
		if (!['pending', 'active', 'paused', 'error'].includes(status)) return fail(400, { message: 'Estado inválido.' });

		const result = id
			? await supabase
					.from('messaging_accounts')
					.update(payload)
					.eq('id', id)
					.eq('business_id', context.business.id)
			: await supabase.from('messaging_accounts').insert(payload);
		if (result.error) {
			console.error('Error guardando cuenta WhatsApp', result.error);
			return fail(500, { message: 'No se pudo guardar la cuenta.' });
		}
		await supabase
			.from('businesses')
			.update({ whatsapp_enabled: status === 'active' })
			.eq('id', context.business.id);
		return { success: true, message: 'Cuenta guardada.' };
	},

	save_template: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
		if (!context?.canManage) return fail(403, { message: 'No tenés permisos para configurar WhatsApp.' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		const status = String(form.get('status') ?? 'draft').trim();
		const payload = {
			business_id: context.business.id,
			provider: String(form.get('provider') ?? 'mock').trim(),
			provider_template_id: String(form.get('provider_template_id') ?? '').trim() || null,
			name: REMINDER_TEMPLATE_NAME,
			category: 'utility',
			language: String(form.get('language') ?? 'es_AR').trim() || 'es_AR',
			status,
			body: String(form.get('body') ?? DEFAULT_REMINDER_TEMPLATE_BODY).trim() || DEFAULT_REMINDER_TEMPLATE_BODY,
			rejection_reason: String(form.get('rejection_reason') ?? '').trim() || null,
			updated_at: new Date().toISOString()
		};

		if (!['draft', 'pending', 'approved', 'rejected', 'paused'].includes(status)) {
			return fail(400, { message: 'Estado de template inválido.' });
		}

		const result = id
			? await supabase
					.from('message_templates')
					.update(payload)
					.eq('id', id)
					.eq('business_id', context.business.id)
			: await supabase.from('message_templates').insert(payload);
		if (result.error) {
			console.error('Error guardando template WhatsApp', result.error);
			return fail(500, { message: 'No se pudo guardar el template.' });
		}
		return { success: true, message: 'Template guardado.' };
	}
};
