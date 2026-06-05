import { env } from '$env/dynamic/private';
import { resolveActiveBusiness } from '$lib/server/business';
import { createSupabaseServerClient, getAuthUserId } from '$lib/server/supabase';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch, cookies }) => {
	if (!locals.auth) {
		throw redirect(303, '/login');
	}

	if (env.DEMO_MODE === 'true') {
		return { demo: true, context: null, driveConnection: null, canLinkExternalFiles: true };
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth.access_token,
		cookies
	});
	const hasConsultorioSettings = Boolean(
		context?.capabilities.canConfigureBusiness ||
			context?.capabilities.canManageUsers ||
			context?.capabilities.canManageSubscription ||
			context?.capabilities.canConfigureCommunication
	);
	if (!context || !hasConsultorioSettings) {
		throw redirect(303, context?.role === 'professional' ? '/odonto/mi-perfil' : '/odonto/agenda');
	}
	const ownerId = await getAuthUserId(supabase, locals.auth.access_token);
	if (!ownerId) {
		return { demo: false, driveConnection: null, canLinkExternalFiles: false };
	}

	const { data, error } = await supabase
		.from('drive_connections')
		.select('owner_id, connected_email, root_folder_id, updated_at')
		.eq('owner_id', ownerId)
		.maybeSingle();

	if (error) {
		console.error('Error cargando Drive connection', error);
	}

	return {
		demo: false,
		context,
		driveConnection: data ?? null,
		canLinkExternalFiles: Boolean(context?.capabilities.canLinkExternalFiles)
	};
};

export const actions: Actions = {
	save_drive_connection: async ({ request, locals, fetch, cookies }) => {
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

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const ownerId = await getAuthUserId(supabase, locals.auth.access_token);
		if (!ownerId) {
			return fail(401, { message: 'Sesion invalida. Volve a iniciar sesion.' });
		}
		const context = await resolveActiveBusiness({
			supabase,
		accessToken: locals.auth.access_token,
		cookies
	});
	const hasConsultorioSettings = Boolean(
		context?.capabilities.canConfigureBusiness ||
			context?.capabilities.canManageUsers ||
			context?.capabilities.canManageSubscription ||
			context?.capabilities.canConfigureCommunication
	);
	if (!context || !hasConsultorioSettings || !context.capabilities.canLinkExternalFiles) {
		return fail(403, {
			message: 'No tenés permisos para administrar esta configuración.'
		});
	}
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
	disconnect_drive: async ({ locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const ownerId = await getAuthUserId(supabase, locals.auth.access_token);
		if (!ownerId) {
			return fail(401, { message: 'Sesion invalida. Volve a iniciar sesion.' });
		}
		const context = await resolveActiveBusiness({
			supabase,
		accessToken: locals.auth.access_token,
		cookies
	});
	const hasConsultorioSettings = Boolean(
		context?.capabilities.canConfigureBusiness ||
			context?.capabilities.canManageUsers ||
			context?.capabilities.canManageSubscription ||
			context?.capabilities.canConfigureCommunication
	);
	if (!context || !hasConsultorioSettings) {
		return fail(500, { message: 'No se pudo resolver el negocio activo.' });
	}
		if (!context.capabilities.canLinkExternalFiles) {
			return fail(403, {
				message: 'La cuenta está suspendida. Regularizá la suscripción para volver a operar.'
			});
		}
		const { error } = await supabase.from('drive_connections').delete().eq('owner_id', ownerId);
		const { error: resetError } =
			context.role === 'owner' || context.role === 'admin'
				? await supabase.rpc('clear_patient_drive_folders_safely', {
						p_business_id: context.business.id
					})
				: { error: null };

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
