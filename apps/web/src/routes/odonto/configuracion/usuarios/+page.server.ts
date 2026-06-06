import {
	BUSINESS_ROLES,
	demoBusinessContext,
	isBusinessRole,
	resolveActiveBusiness,
	type BusinessRole
} from '$lib/server/business';
import {
	findProfessionalByEmail,
	humanProfessionalEmailConflict,
	normalizeProfessionalEmail
} from '$lib/server/professionals';
import {
	createSupabaseAdminClient,
	createSupabaseServerClient,
	getAuthUserId
} from '$lib/server/supabase';
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
		.order('sort_order')
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

const roleAccessErrorMessage = (error: { code?: string; message?: string } | null | undefined) => {
	const raw = error?.message ?? '';
	if (raw.includes('BUSINESS_MANAGE_DENIED')) return 'No tenés permisos para administrar roles.';
	if (raw.includes('INVALID_EMAIL')) return 'Ingresá un email válido.';
	if (raw.includes('INVALID_ROLE')) return 'El rol seleccionado no es válido.';
	if (raw.includes('PROFESSIONAL_REQUIRED')) return 'Seleccioná o creá el profesional asociado.';
	if (raw.includes('PROFESSIONAL_NOT_FOUND')) return 'No se encontró el profesional seleccionado.';
	if (raw.includes('PROFESSIONAL_ALREADY_LINKED_TO_USER')) {
		return 'Ese profesional ya está vinculado a otro usuario.';
	}
	if (raw.includes('PROFESSIONAL_EMAIL_ALREADY_EXISTS')) {
		return 'Ese correo ya está cargado en otro profesional.';
	}
	if (error?.code === '42P10' || raw.includes('no unique or exclusion constraint matching the on conflict')) {
		return 'Falta aplicar la migración de roles en la base de datos.';
	}
	if (raw.includes('ADMIN_OWNER_ACTION_DENIED')) return 'Un administrador no puede modificar dueños ni otros administradores.';
	if (raw.includes('LAST_OWNER_BLOCKED')) return 'El consultorio debe conservar al menos un dueño.';
	if (raw.includes('SELF_REMOVE_DENIED')) return 'No podés quitar tu propio rol desde esta pantalla.';
	return 'No se pudo guardar el rol.';
};

const roleLabel = (role: BusinessRole) => {
	const labels: Record<BusinessRole, string> = {
		owner: 'Dueño',
		admin: 'Administrador',
		reception: 'Recepción',
		professional: 'Profesional',
		readonly: 'Solo lectura'
	};
	return labels[role];
};

const findAuthUserIdByEmail = async (admin: SupabaseClient, email: string) => {
	for (let page = 1; page <= 20; page += 1) {
		const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
		if (error) throw error;
		const user = data.users.find((item) => item.email?.trim().toLowerCase() === email);
		if (user?.id) return user.id;
		if (data.users.length < 1000) return null;
	}
	return null;
};

const enableAllowedEmail = async (admin: SupabaseClient, email: string, actorId: string | null) => {
	const { data: existingRows, error: readError } = await admin
		.from('allowed_emails')
		.select('id, email')
		.ilike('email', email)
		.limit(20);
	if (readError) throw readError;

	const ids = (existingRows ?? []).map((row: any) => String(row.id)).filter(Boolean);
	if (ids.length > 0) {
		const { error } = await admin
			.from('allowed_emails')
			.update({
				email,
				enabled: true,
				disabled_at: null,
				disabled_reason: null,
				updated_by: actorId,
				updated_at: new Date().toISOString()
			})
			.in('id', ids);
		if (error) throw error;
		return;
	}

	const { error } = await admin.from('allowed_emails').insert({
		email,
		enabled: true,
		created_by: actorId,
		updated_by: actorId
	});
	if (error) throw error;
};

const saveRoleAccessDirect = async ({
	admin,
	businessId,
	email,
	role,
	professionalId,
	actorId,
	actorRole,
	currentAccess
}: {
	admin: SupabaseClient;
	businessId: string;
	email: string;
	role: BusinessRole;
	professionalId: string | null;
	actorId: string | null;
	actorRole: BusinessRole;
	currentAccess: BusinessRoleAccess[];
}) => {
	if (!actorId) throw new Error('AUTH_REQUIRED');
	if (actorRole === 'admin' && (role === 'owner' || role === 'admin')) {
		throw new Error('ADMIN_OWNER_ACTION_DENIED');
	}
	if (role === 'professional' && !professionalId) {
		throw new Error('PROFESSIONAL_REQUIRED');
	}

	const targetUserId = await findAuthUserIdByEmail(admin, email);

	if (role === 'professional' && professionalId) {
		const { data: linkedRows, error: linkedError } = await admin
			.from('professional_users')
			.select('id, user_id')
			.eq('business_id', businessId)
			.eq('professional_id', professionalId)
			.limit(10);
		if (linkedError) throw linkedError;
		if ((linkedRows ?? []).some((row: any) => !targetUserId || String(row.user_id) !== targetUserId)) {
			throw new Error('PROFESSIONAL_ALREADY_LINKED_TO_USER');
		}
	}

	await enableAllowedEmail(admin, email, actorId);

	if (targetUserId) {
		const existing = currentAccess.find(
			(item) => item.status === 'active' && item.user_id === targetUserId
		);
		if (actorRole === 'admin' && existing?.role && (existing.role === 'owner' || existing.role === 'admin')) {
			throw new Error('ADMIN_OWNER_ACTION_DENIED');
		}
		if (existing?.role === 'owner' && role !== 'owner' && countOwners(currentAccess) <= 1) {
			throw new Error('LAST_OWNER_BLOCKED');
		}

		if (existing) {
			const { error } = await admin
				.from('business_users')
				.update({
					role,
					status: 'active',
					disabled_at: null,
					disabled_reason: null,
					updated_by: actorId,
					updated_at: new Date().toISOString()
				})
				.eq('id', existing.id)
				.eq('business_id', businessId);
			if (error) throw error;
		} else {
			const { error } = await admin.from('business_users').insert({
				business_id: businessId,
				user_id: targetUserId,
				role,
				status: 'active',
				accepted_at: new Date().toISOString(),
				created_by: actorId,
				updated_by: actorId
			});
			if (error) throw error;
		}

		if (role === 'professional' && professionalId) {
			const deleteByUser = await admin
				.from('professional_users')
				.delete()
				.eq('business_id', businessId)
				.eq('user_id', targetUserId);
			if (deleteByUser.error) throw deleteByUser.error;
			const deleteByProfessional = await admin
				.from('professional_users')
				.delete()
				.eq('business_id', businessId)
				.eq('professional_id', professionalId);
			if (deleteByProfessional.error) throw deleteByProfessional.error;
			const { error } = await admin.from('professional_users').insert({
				business_id: businessId,
				professional_id: professionalId,
				user_id: targetUserId
			});
			if (error) throw error;
		} else {
			const { error } = await admin
				.from('professional_users')
				.delete()
				.eq('business_id', businessId)
				.eq('user_id', targetUserId);
			if (error) throw error;
		}

		const { error: inviteError } = await admin
			.from('business_user_invites')
			.update({
				status: 'accepted',
				accepted_user_id: targetUserId,
				accepted_at: new Date().toISOString(),
				updated_at: new Date().toISOString()
			})
			.eq('business_id', businessId)
			.ilike('email', email)
			.eq('status', 'pending');
		if (inviteError) throw inviteError;

		return {
			status:
				existing?.role === role &&
				(role !== 'professional' || existing.professional_id === professionalId)
					? 'already_active'
					: 'active'
		};
	}

	const existingPending = currentAccess.find(
		(item) => item.status === 'pending' && item.email.toLowerCase() === email
	);
	if (existingPending) {
		const { error } = await admin
			.from('business_user_invites')
			.update({
				role,
				professional_id: professionalId,
				invited_by: actorId,
				updated_at: new Date().toISOString()
			})
			.eq('id', existingPending.id)
			.eq('business_id', businessId);
		if (error) throw error;
		return {
			status:
				existingPending.role === role &&
				(role !== 'professional' || existingPending.professional_id === professionalId)
					? 'already_pending'
					: 'pending'
		};
	}

	const { error } = await admin.from('business_user_invites').insert({
		business_id: businessId,
		email,
		role,
		professional_id: professionalId,
		invited_by: actorId
	});
	if (error) throw error;
	return { status: 'pending' };
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

		const { supabase, context, currentUserId } = await getUsersPageContext({ locals, fetch, cookies });
		if (!context.canManage) {
			return fail(403, { message: 'No tenés permisos para administrar roles.', values });
		}

		const currentAccess = await listRoleAccess(supabase, context.business.id);
		const existing = currentAccess.find((item) => item.email.toLowerCase() === email);
		if (existing?.role === role) {
			return fail(400, {
				message: `Ese correo ya está asignado al rol ${roleLabel(role)}.`,
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
				const existingProfessional = await findProfessionalByEmail(
					supabase,
					context.business.id,
					normalizeProfessionalEmail(email)
				);
				if (existingProfessional) {
					return fail(400, {
						message: humanProfessionalEmailConflict(existingProfessional),
						values
					});
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
				const professionals = await listProfessionals(supabase, context.business.id);
				const selectedProfessional = professionals.find((professional) => professional.id === professionalId);
				if (!selectedProfessional) {
					return fail(400, { message: 'No se encontró el profesional seleccionado.', values });
				}
				const selectedEmail = normalizeProfessionalEmail(selectedProfessional.email);
				if (selectedEmail && selectedEmail !== email) {
					return fail(400, {
						message: `Ese profesional ya tiene cargado ${selectedEmail}. Corregí el email del profesional o seleccioná otro perfil.`,
						values
					});
				}
				const existingProfessional = await findProfessionalByEmail(
					supabase,
					context.business.id,
					normalizeProfessionalEmail(email),
					professionalId
				);
				if (existingProfessional) {
					return fail(400, {
						message: humanProfessionalEmailConflict(existingProfessional),
						values
					});
				}
				if (!selectedEmail) {
					const { error: updateProfessionalEmailError } = await supabase
						.from('professionals')
						.update({ email, updated_at: new Date().toISOString() })
						.eq('business_id', context.business.id)
						.eq('id', professionalId);
					if (updateProfessionalEmailError) {
						console.error('Error actualizando email del profesional', updateProfessionalEmailError);
						return fail(500, { message: roleAccessErrorMessage(updateProfessionalEmailError), values });
					}
				}
			}
		}

		const admin = await createSupabaseAdminClient('odonto', fetch);
		let result: { status: string };
		try {
			result = await saveRoleAccessDirect({
				admin,
				businessId: context.business.id,
				email,
				role,
				professionalId,
				actorId: currentUserId,
				actorRole: context.role,
				currentAccess
			});
		} catch (error) {
			if (createdProfessionalId) {
				await admin
					.from('professionals')
					.delete()
					.eq('business_id', context.business.id)
					.eq('id', createdProfessionalId);
			}
			console.error('Error guardando acceso al negocio', error);
			return fail(500, { message: roleAccessErrorMessage(error as { code?: string; message?: string }), values });
		}

		const status = String(result.status ?? '');
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
			return fail(400, { message: 'Rol inválido.' });
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
			return fail(404, { message: 'Rol no encontrado en este consultorio.' });
		}
		if (target.role === 'owner' && role !== 'owner' && countOwners(members) <= 1) {
			return fail(400, { message: 'El consultorio debe conservar al menos un dueño.' });
		}
		if (role === 'professional' && !target.professional_id) {
			return fail(400, { message: 'Para asignar rol profesional, usá Asignar rol y vinculá un profesional.' });
		}

		const { error } = await supabase.rpc('update_business_role_access', {
			target_access_id: membershipId,
			target_role: role
		});

		if (error) {
			console.error('Error actualizando rol', error);
			return fail(500, { message: roleAccessErrorMessage(error) });
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
			return fail(400, { message: 'Rol inválido.' });
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
				return fail(500, { message: 'No se pudo quitar el rol pendiente.' });
			}
			return { success: true, message: 'Rol pendiente quitado.' };
		}

		const members = await listRoleAccess(supabase, context.business.id);
		const target = members.find((member) => member.id === accessId && member.status === 'active');
		if (!target) {
			return fail(404, { message: 'Rol no encontrado en este consultorio.' });
		}
		if (target.user_id === currentUserId) {
			return fail(400, { message: 'No podés quitar tu propio acceso desde esta pantalla.' });
		}
		if (target.role === 'owner' && countOwners(members) <= 1) {
			return fail(400, { message: 'El consultorio debe conservar al menos un dueño.' });
		}

		const { error } = await supabase.rpc('remove_business_role_access', {
			target_access_id: accessId
		});

		if (error) {
			console.error('Error quitando acceso', error);
			return fail(500, { message: roleAccessErrorMessage(error) });
		}

		return { success: true, message: 'Rol quitado del consultorio.' };
	}
};
