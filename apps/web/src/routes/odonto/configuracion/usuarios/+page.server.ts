import {
	BUSINESS_ROLES,
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

type RoleAccessStatus = 'active' | 'pending';

type BusinessRoleAccess = {
	id: string;
	business_id: string;
	user_id: string | null;
	email: string;
	role: BusinessRole;
	status: RoleAccessStatus;
	professional_id: string | null;
	created_at: string;
};

type ProfessionalOption = {
	id: string;
	name: string;
	email: string | null;
	is_active: boolean;
	is_public: boolean;
};

const DEMO_MEMBERS: BusinessRoleAccess[] = [
	{
		id: 'demo-owner',
		business_id: 'demo-business',
		user_id: 'demo-user',
		email: 'dueno@consultorio.demo',
		role: 'owner',
		status: 'active',
		professional_id: null,
		created_at: new Date('2026-01-01T12:00:00Z').toISOString()
	},
	{
		id: 'demo-reception',
		business_id: 'demo-business',
		user_id: 'demo-reception-user',
		email: 'recepcion@consultorio.demo',
		role: 'reception',
		status: 'active',
		professional_id: null,
		created_at: new Date('2026-01-02T12:00:00Z').toISOString()
	}
];

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (value: FormDataEntryValue | null) =>
	String(value ?? '')
		.trim()
		.toLowerCase();

const normalizeAccess = (row: any): BusinessRoleAccess | null => {
	const role = String(row?.role ?? '');
	const status = String(row?.status ?? '');
	if (!row?.id || !row?.business_id || !row?.email || !isBusinessRole(role)) return null;
	if (status !== 'active' && status !== 'pending') return null;
	return {
		id: String(row.id),
		business_id: String(row.business_id),
		user_id: row.user_id ? String(row.user_id) : null,
		email: String(row.email),
		role,
		status,
		professional_id: row.professional_id ? String(row.professional_id) : null,
		created_at: String(row.created_at ?? '')
	};
};

const listRoleAccess = async (
	supabase: SupabaseClient,
	businessId: string
): Promise<BusinessRoleAccess[]> => {
	const { data, error } = await supabase.rpc('list_business_role_access', {
		target_business_id: businessId
	});
	if (error) throw error;
	return ((data ?? []) as unknown[])
		.map(normalizeAccess)
		.filter((item): item is BusinessRoleAccess => Boolean(item));
};

const listProfessionals = async (
	supabase: SupabaseClient,
	businessId: string
): Promise<ProfessionalOption[]> => {
	const { data, error } = await supabase
		.from('professionals')
		.select('id, name, email, is_active, is_public')
		.eq('business_id', businessId)
		.order('name');
	if (error) throw error;
	return ((data ?? []) as ProfessionalOption[]).map((item) => ({
		id: String(item.id),
		name: String(item.name ?? ''),
		email: item.email ? String(item.email) : null,
		is_active: Boolean(item.is_active),
		is_public: Boolean(item.is_public)
	}));
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

const countOwners = (members: BusinessRoleAccess[]) =>
	members.filter((member) => member.status === 'active' && member.role === 'owner').length;

const roleAccessErrorMessage = (error: { message?: string } | null | undefined) => {
	const raw = error?.message ?? '';
	if (raw.includes('BUSINESS_MANAGE_DENIED')) return 'No tenés permisos para administrar roles.';
	if (raw.includes('INVALID_EMAIL')) return 'Ingresá un email válido.';
	if (raw.includes('INVALID_ROLE')) return 'El rol seleccionado no es válido.';
	if (raw.includes('PROFESSIONAL_REQUIRED')) return 'Seleccioná o creá el profesional asociado.';
	if (raw.includes('PROFESSIONAL_NOT_FOUND')) return 'No se encontró el profesional seleccionado.';
	return 'No se pudo guardar el acceso.';
};

export const load: PageServerLoad = async ({ locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');

	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			members: DEMO_MEMBERS,
			professionals: [],
			roles: BUSINESS_ROLES,
			currentUserId: 'demo-user',
			demo: true
		};
	}

	const { supabase, context, currentUserId } = await getUsersPageContext({ locals, fetch, cookies });
	if (context.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	const [members, professionals] = await Promise.all([
		listRoleAccess(supabase, context.business.id),
		listProfessionals(supabase, context.business.id)
	]);

	return {
		context,
		members,
		professionals,
		roles: BUSINESS_ROLES,
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
		const values = Object.fromEntries(form);
		const email = normalizeEmail(form.get('email'));
		const role = String(form.get('role') ?? '').trim();
		const professionalMode = String(form.get('professional_mode') ?? 'existing');
		const selectedProfessionalId = String(form.get('professional_id') ?? '').trim();
		const newProfessionalName = String(form.get('professional_name') ?? '').trim();

		if (!EMAIL_FORMAT_REGEX.test(email)) {
			return fail(400, { message: 'Ingresá un email válido.', values });
		}
		if (!isBusinessRole(role)) {
			return fail(400, { message: 'El rol seleccionado no es válido.', values });
		}

		const { supabase, context } = await getUsersPageContext({ locals, fetch, cookies });
		if (!context.canManage) {
			return fail(403, { message: 'No tenés permisos para administrar roles.', values });
		}

		const currentAccess = await listRoleAccess(supabase, context.business.id);
		const existing = currentAccess.find((item) => item.email.toLowerCase() === email);
		if (existing?.role === role) {
			return fail(400, {
				message: `Ese correo ya está asignado al rol ${role}.`,
				values
			});
		}

		let professionalId: string | null = null;
		let createdProfessionalId: string | null = null;
		if (role === 'professional') {
			if (professionalMode === 'new') {
				if (!newProfessionalName) {
					return fail(400, { message: 'Ingresá el nombre del profesional.', values });
				}
				const { data: created, error: createError } = await supabase
					.from('professionals')
					.insert({
						business_id: context.business.id,
						name: newProfessionalName,
						email,
						is_active: true,
						is_public: false
					})
					.select('id')
					.single();
				if (createError || !created?.id) {
					console.error('Error creando profesional pendiente', createError);
					return fail(500, { message: 'No se pudo crear el profesional.', values });
				}
				professionalId = String(created.id);
				createdProfessionalId = professionalId;
			} else {
				professionalId = selectedProfessionalId;
				if (!professionalId) {
					return fail(400, { message: 'Seleccioná un profesional.', values });
				}
			}
		}

		const { data, error } = await supabase.rpc('upsert_business_role_access', {
			target_business_id: context.business.id,
			target_email: email,
			target_role: role,
			target_professional_id: professionalId
		});

		if (error) {
			if (createdProfessionalId) {
				await supabase
					.from('professionals')
					.delete()
					.eq('business_id', context.business.id)
					.eq('id', createdProfessionalId);
			}
			console.error('Error guardando acceso al negocio', error);
			return fail(500, { message: roleAccessErrorMessage(error), values });
		}

		const status = String(data?.[0]?.status ?? '');
		if (status === 'already_active' || status === 'already_pending') {
			return { success: true, message: 'Ese correo ya tenía ese rol asignado.' };
		}
		if (status === 'pending') {
			return {
				success: true,
				message: 'Email habilitado. Cuando la persona cree su cuenta, el rol se asignará automáticamente.'
			};
		}

		return { success: true, message: 'Rol asignado al consultorio.' };
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
			return fail(400, { message: 'Acceso inválido.' });
		}
		if (!isBusinessRole(role)) {
			return fail(400, { message: 'El rol seleccionado no es válido.' });
		}

		const { supabase, context } = await getUsersPageContext({ locals, fetch, cookies });
		if (!context.canManage) {
			return fail(403, { message: 'No tenés permisos para administrar roles.' });
		}

		const members = await listRoleAccess(supabase, context.business.id);
		const target = members.find((member) => member.id === membershipId && member.status === 'active');
		if (!target) {
			return fail(404, { message: 'Acceso no encontrado en este consultorio.' });
		}
		if (target.role === 'owner' && role !== 'owner' && countOwners(members) <= 1) {
			return fail(400, { message: 'El consultorio debe conservar al menos un dueño.' });
		}
		if (role === 'professional' && !target.professional_id) {
			return fail(400, { message: 'Para asignar rol profesional, usá Nuevo acceso y vinculá un profesional.' });
		}

		const { error } = await supabase
			.from('business_users')
			.update({ role })
			.eq('id', membershipId)
			.eq('business_id', context.business.id);

		if (error) {
			console.error('Error actualizando rol', error);
			return fail(500, { message: 'No se pudo actualizar el rol.' });
		}

		return { success: true, message: 'Rol actualizado.' };
	},
	remove_user: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const form = await request.formData();
		const accessId = String(form.get('access_id') ?? form.get('membership_id') ?? '').trim();
		const status = String(form.get('status') ?? 'active').trim();
		if (!accessId) {
			return fail(400, { message: 'Acceso inválido.' });
		}

		const { supabase, context, currentUserId } = await getUsersPageContext({ locals, fetch, cookies });
		if (!context.canManage) {
			return fail(403, { message: 'No tenés permisos para administrar roles.' });
		}

		if (status === 'pending') {
			const { error } = await supabase.rpc('cancel_business_role_invite', {
				target_invite_id: accessId
			});
			if (error) {
				console.error('Error cancelando invitación', error);
				return fail(500, { message: 'No se pudo quitar el acceso pendiente.' });
			}
			return { success: true, message: 'Acceso pendiente quitado.' };
		}

		const members = await listRoleAccess(supabase, context.business.id);
		const target = members.find((member) => member.id === accessId && member.status === 'active');
		if (!target) {
			return fail(404, { message: 'Acceso no encontrado en este consultorio.' });
		}
		if (target.user_id === currentUserId) {
			return fail(400, { message: 'No podés quitar tu propio acceso desde esta pantalla.' });
		}
		if (target.role === 'owner' && countOwners(members) <= 1) {
			return fail(400, { message: 'El consultorio debe conservar al menos un dueño.' });
		}

		if (target.user_id) {
			const { error: linkError } = await supabase
				.from('professional_users')
				.delete()
				.eq('business_id', context.business.id)
				.eq('user_id', target.user_id);
			if (linkError) {
				console.error('Error quitando vínculos profesionales', linkError);
				return fail(500, { message: 'No se pudo quitar el vínculo profesional.' });
			}
		}

		const { error } = await supabase
			.from('business_users')
			.delete()
			.eq('id', accessId)
			.eq('business_id', context.business.id);

		if (error) {
			console.error('Error quitando acceso', error);
			return fail(500, { message: 'No se pudo quitar el acceso.' });
		}

		return { success: true, message: 'Acceso quitado del consultorio.' };
	}
};
