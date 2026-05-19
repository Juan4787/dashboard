import { env } from '$env/dynamic/private';
import {
	createSupabaseServerClient,
	getModuleEntryRoute,
	isMasterEmail,
	MASTER_EMAIL
} from '$lib/server/supabase';
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
	login: async ({ request, cookies, fetch }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		const password = String(form.get('password') ?? '');

		if (!email || !password) {
			return fail(400, { message: 'Completá email y contraseña', email });
		}

		const isMaster = isMasterEmail(email);

		if (env.DEMO_MODE === 'true') {
			const cookieOptions = {
				path: '/',
				httpOnly: true,
				secure: !dev,
				sameSite: 'lax' as const,
				maxAge: 60 * 60 * 24 * 7
			};
			cookies.set('sb-module', 'odonto', cookieOptions);
			cookies.set('sb-access-token', 'demo', cookieOptions);
			cookies.set('sb-refresh-token', 'demo', cookieOptions);
			throw redirect(303, getModuleEntryRoute('odonto'));
		}

		const supabase = await createSupabaseServerClient('odonto', null, fetch);

		if (!isMaster) {
			const { data: allowed, error: allowedError } = await supabase.rpc('is_email_enabled', {
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
				return fail(403, {
					message:
						'Este email no está habilitado. Pedile acceso al administrador.',
					email
				});
			}
		}

		const { data, error } = await supabase.auth.signInWithPassword({ email, password });

		if (error || !data.session) {
			console.error('Error login Supabase', { email, error });
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

		cookies.set('sb-module', 'odonto', cookieOptions);
		cookies.set('sb-access-token', session.access_token, cookieOptions);
		cookies.set('sb-refresh-token', session.refresh_token, cookieOptions);

		if (isMaster) {
			throw redirect(303, '/odonto/maestro');
		}

		throw redirect(303, getModuleEntryRoute('odonto'));
	},
	register: async ({ request, cookies, fetch }) => {
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'Registro no disponible en modo demo' });
		}

		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		const password = String(form.get('password') ?? '');

		if (!email || !password) {
			return fail(400, { message: 'Completá email y contraseña', email });
		}
		if (password.length < 6) {
			return fail(400, { message: 'La contraseña debe tener al menos 6 caracteres', email });
		}

		if (isMasterEmail(email)) {
			return fail(400, { message: `El email maestro (${MASTER_EMAIL}) no se registra acá.`, email });
		}

		const supabase = await createSupabaseServerClient('odonto', null, fetch);
		const { data: allowed, error: allowedError } = await supabase.rpc('is_email_enabled', {
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
			return fail(403, {
				message: 'Este email no está habilitado para registrarse.',
				email
			});
		}

		const { data, error } = await supabase.auth.signUp({ email, password });
		if (error) {
			console.error('Error registro Supabase', { email, error });
			const msg = error?.message?.toLowerCase() ?? '';
			if (msg.includes('user already registered') || msg.includes('already registered')) {
				return fail(400, { message: 'El email ya está registrado. Ingresá con tu contraseña.', email });
			}
			return fail(400, { message: 'No pudimos crear la cuenta. Revisá los datos e intentá de nuevo.', email });
		}

		if (!data.session) {
			return fail(400, {
				message:
					'La cuenta se creó pero falta confirmación por email. Desactivá la verificación en Supabase para ingresar automáticamente.',
				email
			});
		}

		const cookieOptions = {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'lax' as const,
			maxAge: 60 * 60 * 24 * 7
		};

		cookies.set('sb-module', 'odonto', cookieOptions);
		cookies.set('sb-access-token', data.session.access_token, cookieOptions);
		cookies.set('sb-refresh-token', data.session.refresh_token, cookieOptions);

		throw redirect(303, getModuleEntryRoute('odonto'));
	}
};
