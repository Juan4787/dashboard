import { env } from '$env/dynamic/private';
import { createSupabaseServerClient, isMasterEmail } from '$lib/server/supabase';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	return {};
};

export const actions: Actions = {
	default: async ({ request, fetch }) => {
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo' });
		}

		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim().toLowerCase();

		if (!email) {
			return fail(400, { message: 'Ingresá un email válido', email });
		}

		if (!isMasterEmail(email)) {
			const supabaseCheck = await createSupabaseServerClient('odonto', null, fetch);
			const { data: allowed, error: allowedError } = await supabaseCheck.rpc('is_email_enabled', {
				p_email: email
			});
			if (allowedError) {
				console.error('Error validando email habilitado', allowedError);
				return fail(500, {
					message: 'Falta configurar el control de emails habilitados en Supabase.',
					email
				});
			}
			if (!allowed) {
				return fail(400, {
					message: 'Ese email no está habilitado para recuperar contraseña.',
					email
				});
			}
		}

		const supabase = await createSupabaseServerClient('odonto', null, fetch);
		const rawSiteUrl =
			env.PUBLIC_SITE_URL ??
			env.SITE_URL ??
			env.URL ??
			env.DEPLOY_PRIME_URL ??
			env.DEPLOY_URL ??
			(env.VERCEL_URL ? `https://${env.VERCEL_URL}` : '');
		const baseUrl = rawSiteUrl ? rawSiteUrl.replace(/\/+$/, '') : '';
		const redirectTo = baseUrl ? `${baseUrl}/reset/callback` : 'http://localhost:5173/reset/callback';

		const { error } = await supabase.auth.resetPasswordForEmail(email, {
			redirectTo
		});

		if (error) {
			console.error('Error reset password', error);
			return fail(500, { message: 'No pudimos enviar el correo. Intentá de nuevo.', email });
		}

		return { success: true, email };
	}
};
