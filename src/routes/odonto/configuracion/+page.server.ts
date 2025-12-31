import { env } from '$env/dynamic/private';
import { createSupabaseServerClient, getUserIdFromAccessToken } from '$lib/server/supabase';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
	if (!locals.auth) {
		throw redirect(303, '/login');
	}

	if (env.DEMO_MODE === 'true') {
		return { demo: true, driveConnection: null };
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const ownerId = getUserIdFromAccessToken(locals.auth.access_token);
	if (!ownerId) {
		return { demo: false, driveConnection: null };
	}

	const { data, error } = await supabase
		.from('drive_connections')
		.select('owner_id, connected_email, root_folder_id, updated_at')
		.eq('owner_id', ownerId)
		.maybeSingle();

	if (error) {
		console.error('Error cargando Drive connection', error);
	}

	return { demo: false, driveConnection: data ?? null };
};

export const actions: Actions = {
	save_drive_connection: async ({ request, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const form = await request.formData();
		const connected_email = String(form.get('connected_email') ?? '').trim();
		const root_folder_id = String(form.get('root_folder_id') ?? '').trim();

		if (!connected_email || !root_folder_id) {
			return fail(400, { message: 'Faltan datos para guardar la conexion.' });
		}

		const ownerId = getUserIdFromAccessToken(locals.auth.access_token);
		if (!ownerId) {
			return fail(401, { message: 'Sesion invalida. Volve a iniciar sesion.' });
		}

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const { error } = await supabase
			.from('drive_connections')
			.upsert(
				{
					owner_id: ownerId,
					connected_email,
					root_folder_id,
					updated_at: new Date().toISOString()
				},
				{ onConflict: 'owner_id' }
			);

		if (error) {
			console.error('Error guardando Drive connection', error);
			return fail(500, { message: 'No se pudo guardar la conexion con Drive.' });
		}

		return { success: true };
	},
	disconnect_drive: async ({ locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const ownerId = getUserIdFromAccessToken(locals.auth.access_token);
		if (!ownerId) {
			return fail(401, { message: 'Sesion invalida. Volve a iniciar sesion.' });
		}

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const { error } = await supabase.from('drive_connections').delete().eq('owner_id', ownerId);
		const { error: resetError } = await supabase
			.from('patients')
			.update({ drive_folder_id: null })
			.eq('owner_id', ownerId);

		if (error) {
			console.error('Error desconectando Drive', error);
			return fail(500, { message: 'No se pudo desconectar Drive.' });
		}
		if (resetError) {
			console.error('Error limpiando carpetas Drive en pacientes', resetError);
		}

		return { success: true };
	}
};
