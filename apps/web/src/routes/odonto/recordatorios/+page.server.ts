import { env } from '$env/dynamic/private';
import { resolveActiveBusiness } from '$lib/server/business';
import { generateReminderDispatches, processQueuedMessageDispatches } from '$lib/server/messaging';
import { createSupabaseAdminClient, createSupabaseServerClient } from '$lib/server/supabase';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const dayRange = (date: string) => {
	const start = new Date(`${date}T00:00:00.000`);
	const end = new Date(start);
	end.setDate(end.getDate() + 1);
	return { start: start.toISOString(), end: end.toISOString() };
};

const defaultDate = () => {
	const value = new Date();
	value.setDate(value.getDate() + 1);
	return value.toISOString().slice(0, 10);
};

export const load: PageServerLoad = async ({ locals, fetch, cookies, url }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return { demo: true, context: null, date: defaultDate(), appointments: [], dispatches: [], account: null };
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
	if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');
	if (context.role === 'professional') throw redirect(303, '/odonto/mis-turnos');

	const date = url.searchParams.get('date') ?? defaultDate();
	const { start, end } = dayRange(date);
	const [{ data: appointments }, { data: dispatches }, { data: account }] = await Promise.all([
		supabase
			.from('appointments')
			.select('id, patient_id, starts_at, status, reminder_due_at, confirmation_token, service_name_snapshot, professional_name_snapshot, patients(id, full_name, phone_e164)')
			.eq('business_id', context.business.id)
			.gte('starts_at', start)
			.lt('starts_at', end)
			.order('starts_at', { ascending: true }),
		supabase
			.from('message_dispatches')
			.select('id, appointment_id, patient_id, status, scheduled_for, sent_at, delivered_at, read_at, failed_at, human_error_message, provider_message_id, patients(id, full_name, phone_e164)')
			.eq('business_id', context.business.id)
			.eq('type', 'appointment_reminder_24h')
			.order('scheduled_for', { ascending: true }),
		supabase
			.from('messaging_accounts')
			.select('id, provider, status, reminders_enabled')
			.eq('business_id', context.business.id)
			.order('created_at', { ascending: true })
			.limit(1)
			.maybeSingle()
	]);

	return {
		demo: false,
		context,
		date,
		appointments: appointments ?? [],
		dispatches: dispatches ?? [],
		account
	};
};

export const actions: Actions = {
	generate: async ({ locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
		if (!context?.canOperate) return fail(403, { message: 'No tenés permisos para generar recordatorios.' });
		const admin = await createSupabaseAdminClient('odonto', fetch);
		const result = await generateReminderDispatches(admin, { businessId: context.business.id });
		return { success: true, message: `Generados: ${result.created}. Omitidos: ${result.skipped}.` };
	},

	process: async ({ locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
		if (!context?.canOperate) return fail(403, { message: 'No tenés permisos para procesar recordatorios.' });
		const admin = await createSupabaseAdminClient('odonto', fetch);
		const result = await processQueuedMessageDispatches(admin, { limit: 20 });
		return { success: true, message: `Enviados: ${result.sent}. Fallidos: ${result.failed}.` };
	}
};
