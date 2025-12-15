import { env } from '$env/dynamic/private';
import { createSupabaseServerClient, getModuleEntryRoute, resolveModuleByEmail } from '$lib/server/supabase';
import { dev } from '$app/environment';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.auth) {
		throw redirect(302, getModuleEntryRoute(locals.auth.module));
	}
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, fetch }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');

		if (!email || !password) {
			return fail(400, { message: 'Completá email y contraseña', email });
		}

	const module = resolveModuleByEmail(email);
	if (!module) {
		return fail(400, { message: 'Usuario no autorizado', email });
	}

	if (env.DEMO_MODE === 'true') {
		const cookieOptions = {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'lax' as const,
			maxAge: 60 * 60 * 24 * 7
		};
		cookies.set('sb-module', module, cookieOptions);
		cookies.set('sb-access-token', 'demo', cookieOptions);
		cookies.set('sb-refresh-token', 'demo', cookieOptions);
		throw redirect(303, getModuleEntryRoute(module));
	}

		const supabase = await createSupabaseServerClient(module, null, fetch);
		const { data, error } = await supabase.auth.signInWithPassword({ email, password });

		if (error || !data.session) {
			console.error('Error login Supabase', { module, email, error });
			const msg = error?.message?.toLowerCase() ?? '';
			if ((error as any)?.code === 'email_provider_disabled' || msg.includes('email logins are disabled')) {
				return fail(400, {
					message:
						'En Supabase está desactivado el login por email. Activá "Email" en Authentication → Providers → Email.',
					email
				});
			}
			if (msg.includes('email not confirmed')) {
				return fail(400, {
					message: 'Tu email no está confirmado en Supabase. Confirmalo o desactivá la confirmación de email.',
					email
				});
			}
			if (msg.includes('invalid api key') || msg.includes('invalid jwt') || msg.includes('jwt')) {
				return fail(400, { message: 'Configuración de Supabase inválida. Revisá URL y ANON KEY.', email });
			}
			return fail(400, { message: 'Credenciales inválidas', email });
		}

		const session = data.session;
		const cookieOptions = {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'lax' as const,
			maxAge: 60 * 60 * 24 * 7 // 7 días
		};

		cookies.set('sb-module', module, cookieOptions);
		cookies.set('sb-access-token', session.access_token, cookieOptions);
		cookies.set('sb-refresh-token', session.refresh_token, cookieOptions);

		throw redirect(303, getModuleEntryRoute(module));
	}
};
