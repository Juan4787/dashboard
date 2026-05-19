import { createSupabaseServerClient, getEmailFromAccessToken, isMasterEmail } from '$lib/server/supabase';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const ensureMaster = (accessToken?: string | null) => {
	const email = getEmailFromAccessToken(accessToken);
	if (!email || !isMasterEmail(email)) {
		throw redirect(303, '/odonto/pacientes');
	}
	return email;
};

export const load: PageServerLoad = async ({ locals, fetch }) => {
	if (!locals.auth) {
		throw redirect(303, '/login');
	}

	const email = ensureMaster(locals.auth.access_token);
	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const { data, error } = await supabase
		.from('allowed_emails')
		.select('id, email, enabled, created_at')
		.order('email', { ascending: true });

	if (error) {
		console.error('Error cargando emails habilitados', error);
		return { emails: [], loadError: 'No se pudo cargar la lista. Revisá Supabase.', masterEmail: email };
	}

	return { emails: data ?? [], masterEmail: email, loadError: null };
};

export const actions: Actions = {
	add_email: async ({ request, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		ensureMaster(locals.auth.access_token);

		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		const enabled = form.get('enabled') === 'true';

		if (!email || !email.includes('@')) {
			return fail(400, { message: 'Ingresá un email válido.', email });
		}

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const { error } = await supabase.from('allowed_emails').insert({ email, enabled });

		if (error) {
			console.error('Error creando email habilitado', error);
			const msg = error.message?.toLowerCase() ?? '';
			if (msg.includes('duplicate') || msg.includes('unique')) {
				return fail(409, { message: 'Ese email ya existe en la lista.', email });
			}
			return fail(500, { message: 'No pudimos guardar el email.', email });
		}

		return { success: true };
	},
	toggle_email: async ({ request, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		ensureMaster(locals.auth.access_token);

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const enabled = String(form.get('enabled') ?? '') === 'true';

		if (!id) {
			return fail(400, { message: 'Email inválido.' });
		}

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const { error } = await supabase.from('allowed_emails').update({ enabled }).eq('id', id);

		if (error) {
			console.error('Error actualizando email', error);
			return fail(500, { message: 'No pudimos actualizar el email.' });
		}

		return { success: true };
	},
	delete_email: async ({ request, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		ensureMaster(locals.auth.access_token);

		const form = await request.formData();
		const id = String(form.get('id') ?? '');

		if (!id) {
			return fail(400, { message: 'Email inválido.' });
		}

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const { error } = await supabase.from('allowed_emails').delete().eq('id', id);

		if (error) {
			console.error('Error eliminando email', error);
			return fail(500, { message: 'No pudimos eliminar el email.' });
		}

		return { success: true };
	}
};
