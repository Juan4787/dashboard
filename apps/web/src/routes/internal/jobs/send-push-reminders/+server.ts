// Job de envío de recordatorios push (cron externo ~cada 10 min, igual que los jobs
// de dispatches). Idempotente: claim atómico en la RPC + sent_at tras envío exitoso.

import { assertInternalJobRequest } from '$lib/server/internal-jobs';
import { sendDuePushReminders } from '$lib/server/push';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, fetch, url }) => {
	const unauthorized = assertInternalJobRequest(request);
	if (unauthorized) return unauthorized;

	const supabase = await createSupabaseAdminClient('odonto', fetch);
	const result = await sendDuePushReminders(supabase, {
		limit: Number(url.searchParams.get('limit') ?? 50)
	});
	return json(result);
};
