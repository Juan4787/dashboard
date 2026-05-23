import { env } from '$env/dynamic/private';
import { resolveActiveBusiness } from '$lib/server/business';
import { applyProviderMessageStatus } from '$lib/server/messaging';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch, cookies, url }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return { demo: true, context: null, dispatches: [], inboundMessages: [], filters: { status: '', type: '' } };
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
	if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');
	if (context.role === 'professional') throw redirect(303, '/odonto/mis-turnos');

	const status = url.searchParams.get('status') ?? '';
	const type = url.searchParams.get('type') ?? '';
	let dispatchQuery = supabase
		.from('message_dispatches')
		.select(
			'id, appointment_id, patient_id, type, status, to_phone_e164, scheduled_for, sent_at, delivered_at, read_at, failed_at, human_error_message, provider_message_id, created_at, appointments(id, starts_at, service_name_snapshot, professional_name_snapshot), patients(id, full_name, phone_e164)'
		)
		.eq('business_id', context.business.id)
		.order('created_at', { ascending: false })
		.limit(100);
	if (status) dispatchQuery = dispatchQuery.eq('status', status);
	if (type) dispatchQuery = dispatchQuery.eq('type', type);

	const [{ data: dispatches, error: dispatchesError }, { data: inboundMessages, error: inboundError }] = await Promise.all([
		dispatchQuery,
		supabase
			.from('inbound_messages')
			.select('id, from_phone_e164, text, requires_human, received_at, created_at')
			.eq('business_id', context.business.id)
			.order('received_at', { ascending: false })
			.limit(50)
	]);
	if (dispatchesError) throw dispatchesError;
	if (inboundError) throw inboundError;

	return {
		demo: false,
		context,
		dispatches: dispatches ?? [],
		inboundMessages: inboundMessages ?? [],
		filters: { status, type }
	};
};

export const actions: Actions = {
	retry_dispatch: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
		if (!context?.canOperate) return fail(403, { message: 'No tenés permisos para reintentar mensajes.' });

		const form = await request.formData();
		const dispatchId = String(form.get('dispatch_id') ?? '').trim();
		const { error } = await supabase
			.from('message_dispatches')
			.update({
				status: 'queued',
				queued_at: new Date().toISOString(),
				failed_at: null,
				last_error_code: null,
				last_error_message: null,
				human_error_message: null,
				updated_at: new Date().toISOString()
			})
			.eq('business_id', context.business.id)
			.eq('id', dispatchId)
			.eq('status', 'failed');
		if (error) return fail(500, { message: 'No se pudo reintentar el mensaje.' });
		return { success: true, message: 'Mensaje en cola.' };
	},

	simulate_status: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
		if (!context?.canOperate) return fail(403, { message: 'No tenés permisos para simular estados.' });

		const form = await request.formData();
		const providerMessageId = String(form.get('provider_message_id') ?? '').trim();
		const status = String(form.get('status') ?? '').trim();
		if (!providerMessageId || !['sent', 'delivered', 'read', 'failed'].includes(status)) {
			return fail(400, { message: 'Estado inválido.' });
		}
		await applyProviderMessageStatus(supabase, {
			providerMessageId,
			status: status as 'sent' | 'delivered' | 'read' | 'failed'
		});
		return { success: true, message: 'Estado actualizado.' };
	}
};
