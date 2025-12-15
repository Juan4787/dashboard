import { env } from '$env/dynamic/private';
import { createSupabaseServerClient, resolveModuleByEmail } from '$lib/server/supabase';
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

		const module = resolveModuleByEmail(email);
		if (!module) {
			return fail(400, {
				message: 'Solo podés recuperar la clave con los emails de Sabrina o del Administrador (ANSES).',
				email
			});
		}

		const supabase = await createSupabaseServerClient(module, null, fetch);
		const redirectTo = env.PUBLIC_SITE_URL
			? `${env.PUBLIC_SITE_URL}/reset/callback`
			: 'http://localhost:5173/reset/callback';

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
