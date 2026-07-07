import { redirect, error as kitError } from '@sveltejs/kit';
import type { Cookies } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	isDefaultBusinessPendingManualSetupError,
	resolveActiveBusiness,
	type BusinessContext
} from './business';
import { createSupabaseServerClient, getAuthUserId } from './supabase';

export type OdontoContext = {
	supabase: SupabaseClient;
	business: BusinessContext;
	userId: string;
};

export const getOdontoContext = async ({
	locals,
	fetch,
	cookies
}: {
	locals: App.Locals;
	fetch: typeof globalThis.fetch;
	cookies: Cookies;
}): Promise<OdontoContext> => {
	if (!locals.auth) throw redirect(303, '/login');

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	let business: BusinessContext | null = null;
	let userId: string | null = null;
	try {
		[business, userId] = await Promise.all([
			resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies }),
			getAuthUserId(supabase, locals.auth.access_token)
		]);
	} catch (error) {
		if (isDefaultBusinessPendingManualSetupError(error)) {
			throw redirect(303, '/odonto/pendiente');
		}
		throw error;
	}

	if (!business) throw kitError(500, 'No se pudo resolver el negocio activo');
	if (!userId) throw redirect(303, '/login');

	return { supabase, business, userId };
};
