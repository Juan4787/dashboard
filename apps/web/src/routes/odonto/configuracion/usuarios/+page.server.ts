import {
	demoBusinessContext,
	isBusinessRole,
	resolveActiveBusiness,
	type BusinessRole
} from '$lib/server/business';
import {
	createSupabaseAdminClient,
	createSupabaseServerClient,
	getAuthUserId
} from '$lib/server/supabase';
import { writeAuditLog } from '$lib/server/audit';
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

type PendingInvite = {
	id: string;
	business_id: string;
	email: string;
	role: BusinessRole;
	professional_id: string | null;
	expires_at: string;
	created_at: string;
};

type RoleProfessional = {
	id: string;
	name: string;
	email: string | null;
	profile_status: 'incomplete' | 'complete';
	name_source: 'manual' | 'email_placeholder';
	is_active: boolean;
	is_public: boolean;
};

const ROLE_LABELS: Record<BusinessRole, string> = {
	owner: 'Dueño',
	admin: 'Administrador',
	reception: 'Recepción',
	professional: 'Profesional',
	readonly: 'Solo lectura'
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

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const shouldUseRoleAssignmentFallback = (error: { code?: string; message?: string }) =>
	error.code === '42P10' ||
	Boolean(error.message?.includes('there is no unique or exclusion constraint matching'));

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

const normalizeInvite = (row: any): PendingInvite | null => {
	const role = String(row?.role ?? '');
	if (!row?.id || !row?.business_id || !row?.email || !isBusinessRole(role)) return null;
	return {
		id: String(row.id),
		business_id: String(row.business_id),
		email: String(row.email),
		role,
		professional_id: row.professional_id ? String(row.professional_id) : null,
		expires_at: String(row.expires_at ?? ''),
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

const listPendingInvites = async (
	supabase: SupabaseClient,
	businessId: string
): Promise<PendingInvite[]> => {
	const { data, error } = await supabase
		.from('business_user_invites')
		.select('id, business_id, email, role, professional_id, expires_at, created_at')
		.eq('business_id', businessId)
		.eq('status', 'pending')
		.order('created_at', { ascending: false });
	if (error) throw error;
	return ((data ?? []) as unknown[])
		.map(normalizeInvite)
		.filter((item): item is PendingInvite => Boolean(item));
};

const listRoleProfessionals = async (
	supabase: SupabaseClient,
	businessId: string
): Promise<RoleProfessional[]> => {
	const { data, error } = await supabase
		.from('professionals')
		.select('id, name, email, profile_status, name_source, is_active, is_public')
		.eq('business_id', businessId)
		.order('name');
	if (error) throw error;
	return (data ?? []).map((row: any) => ({
		id: String(row.id),
		name: String(row.name),
		email: row.email ? String(row.email) : null,
		profile_status: row.profile_status === 'incomplete' ? 'incomplete' : 'complete',
		name_source: row.name_source === 'email_placeholder' ? 'email_placeholder' : 'manual',
		is_active: Boolean(row.is_active),
		is_public: Boolean(row.is_public)
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

const countOwners = (members: BusinessMember[]) =>
	members.filter((member) => member.role === 'owner').length;

const selectableRolesFor = (role: BusinessRole): BusinessRole[] => {
	if (role === 'owner') return ['owner', 'admin', 'reception', 'professional'];
	if (role === 'admin') return ['reception', 'professional'];
	return [];
};

const findAuthUserIdByEmail = async (
	admin: SupabaseClient,
	email: string
): Promise<string | null> => {
	for (let page = 1; page <= 20; page += 1) {
		const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
		if (error) throw error;
		const user = data.users.find((item) => item.email?.trim().toLowerCase() === email);
		if (user) return user.id;
		if (data.users.length < 1000) return null;
	}
	return null;
};

const assertEmailIsAssignable = async ({
	admin,
	businessId,
	email,
	targetUserId
}: {
	admin: SupabaseClient;
	businessId: string;
	email: string;
	targetUserId: string | null;
}) => {
	if (targetUserId) {
		const { data: otherMemberships, error: otherMembershipsError } = await admin
			.from('business_users')
			.select('id')
			.eq('user_id', targetUserId)
			.neq('business_id', businessId)
			.or('status.is.null,status.eq.active')
			.limit(1);
		if (otherMembershipsError) throw otherMembershipsError;
		if ((otherMemberships ?? []).length > 0) {
			throw new Error('EMAIL_ALREADY_ASSIGNED');
		}
	}

	const { data: otherInvites, error: otherInvitesError } = await admin
		.from('business_user_invites')
		.select('id')
		.eq('email', email)
		.eq('status', 'pending')
		.gt('expires_at', new Date().toISOString())
		.neq('business_id', businessId)
		.limit(1);
	if (otherInvitesError) throw otherInvitesError;
	if ((otherInvites ?? []).length > 0) {
		throw new Error('EMAIL_ALREADY_ASSIGNED');
	}
};

const assertBusinessUserLimitAllowsInvite = async ({
	admin,
	businessId,
	email,
	targetUserId
}: {
	admin: SupabaseClient;
	businessId: string;
	email: string;
	targetUserId: string | null;
}) => {
	const [existingMembership, existingInvite, limitRow, activeMembers, pendingInvites] =
		await Promise.all([
			targetUserId
				? admin
						.from('business_users')
						.select('id')
						.eq('business_id', businessId)
						.eq('user_id', targetUserId)
						.or('status.is.null,status.eq.active')
						.limit(1)
				: Promise.resolve({ data: [], error: null }),
			admin
				.from('business_user_invites')
				.select('id')
				.eq('business_id', businessId)
				.eq('email', email)
				.eq('status', 'pending')
				.gt('expires_at', new Date().toISOString())
				.limit(1),
			admin.from('business_limits').select('max_active_users').eq('business_id', businessId).maybeSingle(),
			admin
				.from('business_users')
				.select('user_id')
				.eq('business_id', businessId)
				.or('status.is.null,status.eq.active'),
			admin
				.from('business_user_invites')
				.select('email')
				.eq('business_id', businessId)
				.eq('status', 'pending')
				.gt('expires_at', new Date().toISOString())
		]);

	for (const result of [existingMembership, existingInvite, limitRow, activeMembers, pendingInvites]) {
		if (result.error) throw result.error;
	}

	if ((existingMembership.data ?? []).length > 0 || (existingInvite.data ?? []).length > 0) return;

	const identities = new Set<string>();
	for (const member of activeMembers.data ?? []) {
		if ((member as any).user_id) identities.add(String((member as any).user_id));
	}
	for (const invite of pendingInvites.data ?? []) {
		if ((invite as any).email) identities.add(String((invite as any).email).toLowerCase());
	}

	const limit = Number((limitRow.data as any)?.max_active_users ?? 20);
	if (identities.size >= limit) {
		throw new Error('BUSINESS_USER_LIMIT_REACHED');
	}
};

const prepareProfessionalForRole = async ({
	admin,
	businessId,
	email,
	professionalId,
	createProfessionalProfile
}: {
	admin: SupabaseClient;
	businessId: string;
	email: string;
	professionalId: string | null;
	createProfessionalProfile: boolean;
}): Promise<string> => {
	if (createProfessionalProfile) {
		const { data, error } = await admin
			.from('professionals')
			.insert({
				business_id: businessId,
				name: email,
				email,
				is_public: false,
				is_active: true,
				profile_status: 'incomplete',
				name_source: 'email_placeholder'
			})
			.select('id')
			.single();
		if (error) throw error;
		return String(data.id);
	}

	if (!professionalId) throw new Error('PROFESSIONAL_LINK_REQUIRED');

	const { data, error } = await admin
		.from('professionals')
		.select('id')
		.eq('business_id', businessId)
		.eq('id', professionalId)
		.maybeSingle();
	if (error) throw error;
	if (!data?.id) throw new Error('PROFESSIONAL_NOT_FOUND');
	return professionalId;
};

const enableAllowedEmail = async ({
	admin,
	email,
	actorUserId
}: {
	admin: SupabaseClient;
	email: string;
	actorUserId: string;
}) => {
	const now = new Date().toISOString();
	const { data: updatedRows, error: updateError } = await admin
		.from('allowed_emails')
		.update({
			enabled: true,
			disabled_at: null,
			disabled_reason: null,
			updated_by: actorUserId,
			updated_at: now
		})
		.eq('email', email)
		.select('id');
	if (updateError) throw updateError;
	if ((updatedRows ?? []).length > 0) return;

	const { error: insertError } = await admin.from('allowed_emails').insert({
		email,
		enabled: true,
		created_by: actorUserId,
		updated_by: actorUserId,
		updated_at: now
	});
	if (!insertError) return;
	if (insertError.code !== '23505') throw insertError;

	const { error: retryError } = await admin
		.from('allowed_emails')
		.update({
			enabled: true,
			disabled_at: null,
			disabled_reason: null,
			updated_by: actorUserId,
			updated_at: now
		})
		.eq('email', email);
	if (retryError) throw retryError;
};

const assignBusinessRoleWithServerFallback = async ({
	fetch,
	businessId,
	actorUserId,
	email,
	role,
	professionalId,
	createProfessionalProfile,
	supabaseForAudit
}: {
	fetch: typeof globalThis.fetch;
	businessId: string;
	actorUserId: string;
	email: string;
	role: BusinessRole;
	professionalId: string | null;
	createProfessionalProfile: boolean;
	supabaseForAudit: SupabaseClient;
}) => {
	const admin = await createSupabaseAdminClient('odonto', fetch);
	const targetUserId = await findAuthUserIdByEmail(admin, email);

	await assertEmailIsAssignable({ admin, businessId, email, targetUserId });
	await assertBusinessUserLimitAllowsInvite({ admin, businessId, email, targetUserId });

	const finalProfessionalId =
		role === 'professional'
			? await prepareProfessionalForRole({
					admin,
					businessId,
					email,
					professionalId,
					createProfessionalProfile
				})
			: null;

	await enableAllowedEmail({ admin, email, actorUserId });

	if (!targetUserId) {
		const { data: invite, error: inviteError } = await admin
			.from('business_user_invites')
			.insert({
				business_id: businessId,
				email,
				role,
				professional_id: finalProfessionalId,
				status: 'pending',
				invited_by: actorUserId,
				expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
			})
			.select('id')
			.single();
		if (inviteError) throw inviteError;

		await writeAuditLog(supabaseForAudit, {
			businessId,
			userId: actorUserId,
			action: 'business_user.invited',
			entityType: 'business_user_invite',
			entityId: String(invite.id),
			metadata: { target_role: role, professional_id: finalProfessionalId, via: 'server_fallback' }
		});
		return;
	}

	const { data: existingMembership, error: membershipLookupError } = await admin
		.from('business_users')
		.select('id, role')
		.eq('business_id', businessId)
		.eq('user_id', targetUserId)
		.maybeSingle();
	if (membershipLookupError) throw membershipLookupError;

	let membershipId: string;
	if (existingMembership?.id) {
		const { data, error } = await admin
			.from('business_users')
			.update({
				role,
				status: 'active',
				accepted_at: new Date().toISOString(),
				disabled_at: null,
				disabled_reason: null,
				updated_by: actorUserId,
				updated_at: new Date().toISOString()
			})
			.eq('id', existingMembership.id)
			.select('id')
			.single();
		if (error) throw error;
		membershipId = String(data.id);
	} else {
		const { data, error } = await admin
			.from('business_users')
			.insert({
				business_id: businessId,
				user_id: targetUserId,
				role,
				status: 'active',
				accepted_at: new Date().toISOString(),
				created_by: actorUserId,
				updated_by: actorUserId
			})
			.select('id')
			.single();
		if (error) throw error;
		membershipId = String(data.id);
	}

	if (role === 'professional' && finalProfessionalId) {
		const { error } = await admin.from('professional_users').upsert(
			{
				business_id: businessId,
				professional_id: finalProfessionalId,
				user_id: targetUserId
			},
			{ onConflict: 'business_id,professional_id,user_id' }
		);
		if (error) throw error;
	}

	const { error: acceptedInviteError } = await admin
		.from('business_user_invites')
		.update({
			status: 'accepted',
			accepted_user_id: targetUserId,
			accepted_at: new Date().toISOString(),
			updated_at: new Date().toISOString()
		})
		.eq('business_id', businessId)
		.eq('email', email)
		.eq('status', 'pending');
	if (acceptedInviteError) throw acceptedInviteError;

	await writeAuditLog(supabaseForAudit, {
		businessId,
		userId: actorUserId,
		action: 'business_user.added_or_updated',
		entityType: 'business_user',
		entityId: membershipId,
		metadata: { target_role: role, professional_id: finalProfessionalId, via: 'server_fallback' }
	});
};

export const load: PageServerLoad = async ({ locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');

	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			members: DEMO_MEMBERS,
			pendingInvites: [],
			professionals: [],
			roles: ['owner', 'admin', 'reception', 'professional'] as BusinessRole[],
			currentUserId: 'demo-user',
			demo: true
		};
	}

	const { supabase, context, currentUserId } = await getUsersPageContext({ locals, fetch, cookies });
	if (!context.capabilities.canManageUsers) throw redirect(303, '/odonto/agenda');
	const [members, pendingInvites, professionals] = await Promise.all([
		listMembers(supabase, context.business.id),
		listPendingInvites(supabase, context.business.id),
		listRoleProfessionals(supabase, context.business.id)
	]);

	return {
		context,
		members,
		pendingInvites,
		professionals,
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
		const professionalMode = String(form.get('professional_mode') ?? 'existing');
		const professionalId = String(form.get('professional_id') ?? '').trim();

		if (!EMAIL_FORMAT_REGEX.test(email)) {
			return fail(400, { intent: 'add_user', message: 'Ingresá un correo electrónico válido.', values: Object.fromEntries(form) });
		}
		if (!isBusinessRole(role)) {
			return fail(400, { intent: 'add_user', message: 'El rol seleccionado no es válido.', values: Object.fromEntries(form) });
		}
		if (role === 'readonly') {
			return fail(400, { intent: 'add_user', message: 'Solo lectura no está disponible para nuevos accesos.', values: Object.fromEntries(form) });
		}
		if (role === 'professional' && professionalMode !== 'new' && !professionalId) {
			return fail(400, { intent: 'add_user', message: 'Elegí un profesional o creá uno nuevo para ese email.', values: Object.fromEntries(form) });
		}

		const { supabase, context, currentUserId } = await getUsersPageContext({ locals, fetch, cookies });
		if (!context.capabilities.canManageUsers) {
			return fail(403, { intent: 'add_user', message: 'No tenés permisos para administrar roles.' });
		}
		if (!currentUserId) {
			return fail(403, { intent: 'add_user', message: 'No se pudo identificar tu sesión.' });
		}

		const [members, pendingInvites] = await Promise.all([
			listMembers(supabase, context.business.id),
			listPendingInvites(supabase, context.business.id)
		]);
		const existingMember = members.find((member) => member.email?.toLowerCase() === email);
		if (existingMember) {
			return fail(409, {
				intent: 'add_user',
				message: `Ese correo ya está asignado como ${ROLE_LABELS[existingMember.role]}.`,
				values: Object.fromEntries(form)
			});
		}
		const existingInvite = pendingInvites.find((invite) => invite.email.toLowerCase() === email);
		if (existingInvite) {
			return fail(409, {
				intent: 'add_user',
				message: `Ese correo ya tiene un acceso pendiente como ${ROLE_LABELS[existingInvite.role]}.`,
				values: Object.fromEntries(form)
			});
		}

		const { error } = await supabase.rpc('assign_business_role_to_email_safely', {
			target_business_id: context.business.id,
			target_email: email,
			target_role: role,
			target_professional_id: role === 'professional' && professionalMode !== 'new' ? professionalId : null,
			create_professional_profile: role === 'professional' && professionalMode === 'new'
		});

		if (error && shouldUseRoleAssignmentFallback(error)) {
			try {
				await assignBusinessRoleWithServerFallback({
					fetch,
					businessId: context.business.id,
					actorUserId: currentUserId,
					email,
					role,
					professionalId: role === 'professional' && professionalMode !== 'new' ? professionalId : null,
					createProfessionalProfile: role === 'professional' && professionalMode === 'new',
					supabaseForAudit: supabase
				});
			} catch (fallbackError) {
				console.error('Error agregando rol al negocio con fallback server-side', fallbackError);
				const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : '';
				let message = 'No se pudo agregar el rol.';
				if (fallbackMessage.includes('PROFESSIONAL_LINK_REQUIRED')) {
					message = 'Elegí un profesional o creá uno nuevo para ese email.';
				} else if (fallbackMessage.includes('PROFESSIONAL_NOT_FOUND')) {
					message = 'No se encontró el profesional seleccionado.';
				} else if (fallbackMessage.includes('BUSINESS_USER_LIMIT_REACHED')) {
					message = 'El consultorio alcanzó el límite de accesos activos y pendientes.';
				} else if (fallbackMessage.includes('EMAIL_ALREADY_ASSIGNED')) {
					message = 'Ese email ya está asociado a otro consultorio activo o pendiente.';
				}
				return fail(500, { intent: 'add_user', message, values: Object.fromEntries(form) });
			}

			return { intent: 'add_user', success: true, message: 'Email habilitado y acceso preparado.' };
		}

		if (error) {
			console.error('Error agregando rol al negocio', error);
			let message = 'No se pudo agregar el rol.';
			if (error.message?.includes('PROFESSIONAL_LINK_REQUIRED')) {
				message = 'Elegí un profesional o creá uno nuevo para ese email.';
			} else if (error.message?.includes('PROFESSIONAL_NOT_FOUND')) {
				message = 'No se encontró el profesional seleccionado.';
			} else if (error.message?.includes('ROLE_NOT_AVAILABLE')) {
				message = 'Ese rol no está disponible.';
			} else if (error.message?.includes('BUSINESS_USER_LIMIT_REACHED')) {
				message = 'El consultorio alcanzó el límite de accesos activos y pendientes.';
			} else if (error.message?.includes('INTERNAL_RATE_LIMITED')) {
				message = 'Hubo demasiados cambios de roles. Probá nuevamente en unos minutos.';
			} else if (error.message?.includes('ADMIN_OWNER_ACTION_DENIED')) {
				message = 'Un administrador no puede crear dueños ni otros administradores.';
			} else if (error.message?.includes('EMAIL_ALREADY_ASSIGNED')) {
				message = 'Ese email ya está asociado a otro consultorio activo o pendiente.';
			}
			return fail(500, { intent: 'add_user', message, values: Object.fromEntries(form) });
		}

		return { intent: 'add_user', success: true, message: 'Email habilitado y acceso preparado.' };
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
			return fail(400, { intent: 'update_role', message: 'Acceso inválido.' });
		}
		if (!isBusinessRole(role)) {
			return fail(400, { intent: 'update_role', message: 'El rol seleccionado no es válido.' });
		}

		const { supabase, context } = await getUsersPageContext({ locals, fetch, cookies });
		if (!context.capabilities.canManageUsers) {
			return fail(403, { intent: 'update_role', message: 'No tenés permisos para administrar roles.' });
		}

		const members = await listMembers(supabase, context.business.id);
		const target = members.find((member) => member.id === membershipId);
		if (!target) {
			return fail(404, { intent: 'update_role', message: 'Acceso no encontrado en este consultorio.' });
		}
		if (target.role === 'owner' && role !== 'owner' && countOwners(members) <= 1) {
			return fail(400, { intent: 'update_role', message: 'El consultorio debe conservar al menos un dueño.' });
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
					: error.message?.includes('PROFESSIONAL_LINK_REQUIRED')
						? 'Para cambiar a Profesional, primero vinculá el email a un profesional.'
						: error.message?.includes('ROLE_NOT_AVAILABLE')
							? 'Ese rol no está disponible.'
							: 'No se pudo actualizar el rol.';
			return fail(500, { intent: 'update_role', message });
		}

		return { intent: 'update_role', success: true, message: 'Rol actualizado.' };
	},
	remove_user: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const form = await request.formData();
		const membershipId = String(form.get('membership_id') ?? '').trim();
		if (!membershipId) {
			return fail(400, { intent: 'remove_user', message: 'Acceso inválido.' });
		}

		const { supabase, context, currentUserId } = await getUsersPageContext({ locals, fetch, cookies });
		if (!context.capabilities.canManageUsers) {
			return fail(403, { intent: 'remove_user', message: 'No tenés permisos para administrar roles.' });
		}

		const members = await listMembers(supabase, context.business.id);
		const target = members.find((member) => member.id === membershipId);
		if (!target) {
			return fail(404, { intent: 'remove_user', message: 'Acceso no encontrado en este consultorio.' });
		}
		if (target.user_id === currentUserId) {
			return fail(400, { intent: 'remove_user', message: 'No podés quitar tu propio acceso desde esta pantalla.' });
		}
		if (target.role === 'owner' && countOwners(members) <= 1) {
			return fail(400, { intent: 'remove_user', message: 'El consultorio debe conservar al menos un dueño.' });
		}

		const { error } = await supabase.rpc('disable_business_user_safely', {
			p_membership_id: membershipId,
			p_reason: 'Deshabilitado desde Roles'
		});

		if (error) {
			console.error('Error quitando acceso', error);
			const message = error.message?.includes('LAST_OWNER_BLOCKED')
				? 'El consultorio debe conservar al menos un dueño activo.'
				: error.message?.includes('ADMIN_OWNER_ACTION_DENIED')
					? 'Un administrador no puede deshabilitar dueños ni otros administradores.'
					: 'No se pudo quitar el acceso.';
			return fail(500, { intent: 'remove_user', message });
		}

		return { intent: 'remove_user', success: true, message: 'Acceso deshabilitado del consultorio.' };
	}
};
