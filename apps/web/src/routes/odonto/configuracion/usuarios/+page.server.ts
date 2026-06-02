import {
	demoBusinessContext,
	isBusinessRole,
	resolveActiveBusiness,
	type BusinessRole
} from '$lib/server/business';
import { createSupabaseServerClient, getAuthUserId } from '$lib/server/supabase';
import { env } from '$env/dynamic/private';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';

type BusinessMember = {
	id: string;
	business_id: string;
	user_id: string;
	email: string | null;
	role: BusinessRole;
	created_at: string;
};

const DEMO_MEMBERS: BusinessMember[] = [
	{
		id: 'demo-owner',
		business_id: 'demo-business',
		user_id: 'demo-user',
		email: 'dueno@consultorio.demo',
		role: 'owner',
		created_at: new Date('2026-01-01T12:00:00Z').toISOString()
	},
	{
		id: 'demo-reception',
		business_id: 'demo-business',
		user_id: 'demo-reception-user',
		email: 'recepcion@consultorio.demo',
		role: 'reception',
		created_at: new Date('2026-01-02T12:00:00Z').toISOString()
	}
];

const normalizeEmail = (value: FormDataEntryValue | null) =>
	String(value ?? '')
		.trim()
		.toLowerCase();

const normalizeMember = (row: any): BusinessMember | null => {
	const role = String(row?.role ?? '');
	if (!row?.id || !row?.business_id || !row?.user_id || !isBusinessRole(role)) return null;
	return {
		id: String(row.id),
		business_id: String(row.business_id),
		user_id: String(row.user_id),
		email: row.email ? String(row.email) : null,
		role,
		created_at: String(row.created_at ?? '')
	};
};

const listMembers = async (
	supabase: SupabaseClient,
	businessId: string
): Promise<BusinessMember[]> => {
	const { data, error } = await supabase.rpc('list_business_users', {
		target_business_id: businessId
	});
	if (error) {
		throw error;
	}
	return ((data ?? []) as unknown[])
		.map(normalizeMember)
		.filter((item): item is BusinessMember => Boolean(item));
};

const getUsersPageContext = async ({
	locals,
	fetch,
	cookies
}: {
	locals: App.Locals;
	fetch: typeof globalThis.fetch;
	cookies: import('@sveltejs/kit').Cookies;
}) => {
	if (!locals.auth) throw redirect(303, '/login');

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const [context, currentUserId] = await Promise.all([
		resolveActiveBusiness({
			supabase,
			accessToken: locals.auth.access_token,
			cookies
		}),
		getAuthUserId(supabase, locals.auth.access_token)
	]);

	if (!context) {
		throw kitError(500, 'No se pudo resolver el negocio activo');
	}

	return { supabase, context, currentUserId };
};

const countOwners = (members: BusinessMember[]) =>
	members.filter((member) => member.role === 'owner').length;

const selectableRolesFor = (role: BusinessRole): BusinessRole[] => {
	if (role === 'owner') return ['owner', 'admin', 'reception', 'professional'];
	if (role === 'admin') return ['reception', 'professional'];
	return [];
};

export const load: PageServerLoad = async ({ locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');

	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			members: DEMO_MEMBERS,
			roles: ['owner', 'admin', 'reception', 'professional'] as BusinessRole[],
			currentUserId: 'demo-user',
			demo: true
		};
	}

	const { supabase, context, currentUserId } = await getUsersPageContext({ locals, fetch, cookies });
	if (!context.capabilities.canManageUsers) throw redirect(303, '/odonto/agenda');
	const members = await listMembers(supabase, context.business.id);

	return {
		context,
		members,
		roles: selectableRolesFor(context.role),
		currentUserId,
		demo: false
	};
};

export const actions: Actions = {
	add_user: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const form = await request.formData();
		const email = normalizeEmail(form.get('email'));
		const role = String(form.get('role') ?? '').trim();

		if (!email || !email.includes('@')) {
			return fail(400, { message: 'Ingresá un correo electrónico válido.', values: Object.fromEntries(form) });
		}
		if (!isBusinessRole(role)) {
			return fail(400, { message: 'El permiso seleccionado no es válido.', values: Object.fromEntries(form) });
		}

		const { supabase, context } = await getUsersPageContext({ locals, fetch, cookies });
		if (!context.capabilities.canManageUsers) {
			return fail(403, { message: 'No tenés permisos para administrar usuarios.' });
		}

		const { error } = await supabase.rpc('add_business_user_by_email', {
			target_business_id: context.business.id,
			target_email: email,
			target_role: role
		});

		if (error) {
			console.error('Error agregando usuario al negocio', error);
			const message = error.message?.includes('USER_NOT_FOUND')
				? 'Ese correo electrónico todavía no tiene una cuenta creada.'
				: error.message?.includes('ADMIN_OWNER_ACTION_DENIED')
					? 'Un administrador no puede crear dueños ni otros administradores.'
					: error.message?.includes('EMAIL_ALREADY_ASSIGNED')
						? 'Ese email ya está asociado a otro consultorio activo o pendiente.'
						: 'No se pudo agregar el usuario.';
			return fail(500, { message, values: Object.fromEntries(form) });
		}

		return { success: true, message: 'Usuario agregado al consultorio.' };
	},
	update_role: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const form = await request.formData();
		const membershipId = String(form.get('membership_id') ?? '').trim();
		const role = String(form.get('role') ?? '').trim();

		if (!membershipId) {
			return fail(400, { message: 'Usuario inválido.' });
		}
		if (!isBusinessRole(role)) {
			return fail(400, { message: 'El permiso seleccionado no es válido.' });
		}

		const { supabase, context } = await getUsersPageContext({ locals, fetch, cookies });
		if (!context.capabilities.canManageUsers) {
			return fail(403, { message: 'No tenés permisos para administrar usuarios.' });
		}

		const members = await listMembers(supabase, context.business.id);
		const target = members.find((member) => member.id === membershipId);
		if (!target) {
			return fail(404, { message: 'Usuario no encontrado en este consultorio.' });
		}
		if (target.role === 'owner' && role !== 'owner' && countOwners(members) <= 1) {
			return fail(400, { message: 'El consultorio debe conservar al menos un dueño.' });
		}

		const { error } = await supabase.rpc('change_business_user_role_safely', {
			p_membership_id: membershipId,
			p_role: role
		});

		if (error) {
			console.error('Error actualizando rol', error);
			const message = error.message?.includes('LAST_OWNER_BLOCKED')
				? 'El consultorio debe conservar al menos un dueño activo.'
				: error.message?.includes('ADMIN_OWNER_ACTION_DENIED')
					? 'Un administrador no puede modificar dueños ni otros administradores.'
					: 'No se pudo actualizar el permiso.';
			return fail(500, { message });
		}

		return { success: true, message: 'Permiso actualizado.' };
	},
	remove_user: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const form = await request.formData();
		const membershipId = String(form.get('membership_id') ?? '').trim();
		if (!membershipId) {
			return fail(400, { message: 'Usuario inválido.' });
		}

		const { supabase, context, currentUserId } = await getUsersPageContext({ locals, fetch, cookies });
		if (!context.capabilities.canManageUsers) {
			return fail(403, { message: 'No tenés permisos para administrar usuarios.' });
		}

		const members = await listMembers(supabase, context.business.id);
		const target = members.find((member) => member.id === membershipId);
		if (!target) {
			return fail(404, { message: 'Usuario no encontrado en este consultorio.' });
		}
		if (target.user_id === currentUserId) {
			return fail(400, { message: 'No podés quitar tu propio acceso desde esta pantalla.' });
		}
		if (target.role === 'owner' && countOwners(members) <= 1) {
			return fail(400, { message: 'El consultorio debe conservar al menos un dueño.' });
		}

		const { error } = await supabase.rpc('disable_business_user_safely', {
			p_membership_id: membershipId,
			p_reason: 'Deshabilitado desde Usuarios'
		});

		if (error) {
			console.error('Error quitando usuario', error);
			const message = error.message?.includes('LAST_OWNER_BLOCKED')
				? 'El consultorio debe conservar al menos un dueño activo.'
				: error.message?.includes('ADMIN_OWNER_ACTION_DENIED')
					? 'Un administrador no puede deshabilitar dueños ni otros administradores.'
					: 'No se pudo quitar el usuario.';
			return fail(500, { message });
		}

		return { success: true, message: 'Usuario deshabilitado del consultorio.' };
	}
};
