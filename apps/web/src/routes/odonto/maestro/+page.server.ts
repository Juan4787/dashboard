import {
	COMMERCIAL_STATUSES,
	getBusinessAccessState,
	type BusinessSubscriptionRow
} from '$lib/server/commercial-access';
import { normalizeSlug } from '$lib/server/business';
import {
	createSupabaseAdminClient,
	getEmailFromAccessToken,
	getUserIdFromAccessToken,
	isMasterEmail
} from '$lib/server/supabase';
import { parseMoneyInteger } from '$lib/utils/money-input';
import { fail, redirect } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';

const ensureMaster = (accessToken?: string | null) => {
	const email = getEmailFromAccessToken(accessToken);
	if (!email || !isMasterEmail(email)) {
		throw redirect(303, '/odonto/pacientes');
	}
	return {
		email,
		userId: getUserIdFromAccessToken(accessToken)
	};
};

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DURATION_SECONDS: Record<string, { seconds: number | null; unit: string; label: string }> = {
	hour_1: { seconds: 60 * 60, unit: 'hour', label: '1 hora' },
	day_1: { seconds: 24 * 60 * 60, unit: 'day', label: '1 día' },
	month_1: { seconds: 30 * 24 * 60 * 60, unit: 'month', label: '1 mes' },
	month_2: { seconds: 2 * 30 * 24 * 60 * 60, unit: 'month', label: '2 meses' },
	month_3: { seconds: 3 * 30 * 24 * 60 * 60, unit: 'month', label: '3 meses' },
	month_4: { seconds: 4 * 30 * 24 * 60 * 60, unit: 'month', label: '4 meses' },
	month_5: { seconds: 5 * 30 * 24 * 60 * 60, unit: 'month', label: '5 meses' },
	month_6: { seconds: 6 * 30 * 24 * 60 * 60, unit: 'month', label: '6 meses' },
	month_7: { seconds: 7 * 30 * 24 * 60 * 60, unit: 'month', label: '7 meses' },
	month_8: { seconds: 8 * 30 * 24 * 60 * 60, unit: 'month', label: '8 meses' },
	month_9: { seconds: 9 * 30 * 24 * 60 * 60, unit: 'month', label: '9 meses' },
	month_10: { seconds: 10 * 30 * 24 * 60 * 60, unit: 'month', label: '10 meses' },
	month_11: { seconds: 11 * 30 * 24 * 60 * 60, unit: 'month', label: '11 meses' },
	month_12: { seconds: 12 * 30 * 24 * 60 * 60, unit: 'month', label: '12 meses' },
	permanent: { seconds: null, unit: 'permanent', label: 'permanente' }
};

const BUSINESS_ACCESS_OPERATIONS = [
	'grant_access',
	'extend_access',
	'reduce_access',
	'set_permanent',
	'unset_permanent',
	'disable_business_access',
	'enable_business_access',
	'archive_business',
	'reactivate_business',
	'manual_correction',
	'payment_registered',
	'payment_cancelled'
] as const;

const normalizeEmail = (value: FormDataEntryValue | string | null | undefined) =>
	String(value ?? '')
		.trim()
		.toLowerCase();

const uniqueBusinessSlug = async (
	admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
	baseValue: string
) => {
	const base = normalizeSlug(baseValue) || 'consultorio';
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const suffix = attempt === 0 ? '' : `-${randomUUID().slice(0, 6)}`;
		const slug = `${base}${suffix}`.slice(0, 80);
		const { data, error } = await admin.from('businesses').select('id').eq('slug', slug).maybeSingle();
		if (error) throw error;
		if (!data) return slug;
	}
	return `${base}-${randomUUID().slice(0, 8)}`.slice(0, 80);
};

const findAuthUserIdByEmail = async (
	admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
	email: string
) => {
	const normalizedEmail = email.trim().toLowerCase();
	const perPage = 200;
	let page = 1;
	while (true) {
		const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
		if (error) throw error;
		const users = data?.users ?? [];
		const match = users.find((user) => (user.email ?? '').trim().toLowerCase() === normalizedEmail);
		if (match?.id) return match.id;
		if (users.length < perPage) return null;
		page += 1;
	}
};

const ensureAllowedEmail = async ({
	admin,
	email,
	note,
	actorId
}: {
	admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>;
	email: string;
	note: string | null;
	actorId: string | null;
}) => {
	const { data: existingEmail, error: existingError } = await admin
		.from('allowed_emails')
		.select('id')
		.eq('email', email)
		.maybeSingle();
	if (existingError) throw existingError;

	const write = existingEmail
		? await admin
				.from('allowed_emails')
				.update({
					enabled: true,
					note,
					disabled_at: null,
					disabled_reason: null,
					updated_by: actorId
				})
				.eq('id', existingEmail.id)
		: await admin.from('allowed_emails').insert({
				email,
				enabled: true,
				note,
				disabled_at: null,
				disabled_reason: null,
				updated_by: actorId,
				created_by: actorId
			});
	if (write.error) throw write.error;
};

const ensureOwnerMembershipOrInvite = async ({
	admin,
	businessId,
	email,
	userId,
	actorId
}: {
	admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>;
	businessId: string;
	email: string;
	userId: string | null;
	actorId: string | null;
}) => {
	const now = new Date().toISOString();
	const { data: existingPending, error: pendingError } = await admin
		.from('business_user_invites')
		.select('id, business_id')
		.eq('email', email)
		.eq('status', 'pending')
		.limit(1)
		.maybeSingle();
	if (pendingError) throw pendingError;
	if (existingPending?.id && existingPending.business_id !== businessId) {
		throw new Error('EMAIL_ALREADY_INVITED');
	}

	if (userId) {
		const { data: activeMembership, error: activeMembershipError } = await admin
			.from('business_users')
			.select('id, business_id')
			.eq('user_id', userId)
			.eq('status', 'active')
			.limit(1)
			.maybeSingle();
		if (activeMembershipError) throw activeMembershipError;
		if (activeMembership?.id && activeMembership.business_id !== businessId) {
			throw new Error('EMAIL_ALREADY_ASSIGNED');
		}

		const { error } = await admin.from('business_users').upsert(
			{
				business_id: businessId,
				user_id: userId,
				role: 'owner',
				status: 'active',
				accepted_at: now,
				disabled_at: null,
				disabled_reason: null,
				created_by: actorId,
				updated_by: actorId,
				updated_at: now
			},
			{ onConflict: 'business_id,user_id' }
		);
		if (error) throw error;

		await admin
			.from('business_user_invites')
			.update({
				status: 'accepted',
				accepted_user_id: userId,
				accepted_at: now,
				updated_at: now
			})
			.eq('email', email)
			.eq('business_id', businessId)
			.eq('status', 'pending');
		return 'assigned' as const;
	}

	if (existingPending?.id) {
		const { error } = await admin
			.from('business_user_invites')
			.update({
				business_id: businessId,
				role: 'owner',
				invited_by: actorId,
				expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
				updated_at: now
			})
			.eq('id', existingPending.id);
		if (error) throw error;
		return 'invited' as const;
	}

	const { error } = await admin.from('business_user_invites').insert({
		business_id: businessId,
		email,
		role: 'owner',
		status: 'pending',
		invited_by: actorId,
		expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
	});
	if (error) throw error;
	return 'invited' as const;
};

const listAuthEmailsById = async (admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>) => {
	const result = new Map<string, string>();
	const perPage = 200;
	let page = 1;

	while (true) {
		const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
		if (error) {
			console.error('Error listando usuarios Auth para panel maestro', error);
			break;
		}
		const users = data?.users ?? [];
		for (const user of users) {
			if (user.id && user.email) result.set(user.id, user.email);
		}
		if (users.length < perPage) break;
		page += 1;
	}

	return result;
};

const businessHasMasterOwner = async (
	admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
	businessId: string,
	masterUserId: string | null,
	masterEmail: string
) => {
	const { data, error } = await admin
		.from('business_users')
		.select('user_id')
		.eq('business_id', businessId)
		.eq('role', 'owner');
	if (error) throw error;
	const ownerIds = (data ?? [])
		.map((membership) => String(membership.user_id ?? ''))
		.filter(Boolean);
	if (masterUserId && ownerIds.includes(masterUserId)) return true;

	const emailsByUserId = await listAuthEmailsById(admin);
	const normalizedMasterEmail = masterEmail.trim().toLowerCase();
	return ownerIds.some((userId) => {
		const email = String(emailsByUserId.get(userId) ?? '').toLowerCase();
		return email === normalizedMasterEmail || isMasterEmail(email);
	});
};

const buildMasterData = async (
	admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
	masterEmail: string
) => {
	const emailsRes = await admin
		.from('allowed_emails')
		.select('id, email, enabled, note, disabled_at, disabled_reason, created_at, updated_at')
		.order('email', { ascending: true });
	const businessesRes = await admin
		.from('businesses')
		.select('id, name, slug, email, is_active, created_at, updated_at')
		.order('created_at', { ascending: false });
	const subscriptionsRes = await admin
		.from('business_subscriptions')
		.select(
			'id, business_id, commercial_access_enabled, is_permanent, subscription_status, access_starts_at, paid_until, grace_until, restricted_until, archived_at, last_payment_at, last_payment_amount, last_grant_duration_seconds, expiration_notice_enabled, access_source, access_note, updated_by, created_at, updated_at'
		);
	const membershipsRes = await admin.from('business_users').select('id, business_id, user_id, role, created_at');
	const invitesRes = await admin
		.from('business_user_invites')
		.select('id, business_id, email, role, status, expires_at, created_at')
		.eq('status', 'pending')
		.order('created_at', { ascending: false });
	const grantsRes = await admin
		.from('access_grants')
		.select('id, business_id, operation, duration_unit, duration_seconds, amount, source, note, admin_email, paid_until_before, paid_until_after, status_before, status_after, created_at')
		.order('created_at', { ascending: false })
		.limit(200);

	if (emailsRes.error) throw emailsRes.error;
	if (businessesRes.error) throw businessesRes.error;
	if (subscriptionsRes.error) {
		// Compatibility: before migration, keep page readable.
		console.error('Error cargando business_subscriptions', subscriptionsRes.error);
	}
	if (membershipsRes.error) throw membershipsRes.error;
	if (invitesRes.error) throw invitesRes.error;
	if (grantsRes.error) {
		console.error('Error cargando access_grants', grantsRes.error);
	}

	const emailsByUserId = await listAuthEmailsById(admin);
	const subscriptionsByBusinessId = new Map(
		((subscriptionsRes.data ?? []) as BusinessSubscriptionRow[]).map((subscription) => [
			subscription.business_id,
			subscription
		])
	);
	const membershipsByBusinessId = new Map<string, any[]>();
	for (const membership of membershipsRes.data ?? []) {
		const businessId = String(membership.business_id);
		const list = membershipsByBusinessId.get(businessId) ?? [];
		list.push({
			...membership,
			email: emailsByUserId.get(String(membership.user_id)) ?? null
		});
		membershipsByBusinessId.set(businessId, list);
	}

	const grantsByBusinessId = new Map<string, any[]>();
	for (const grant of grantsRes.data ?? []) {
		const businessId = String(grant.business_id);
		const list = grantsByBusinessId.get(businessId) ?? [];
		list.push(grant);
		grantsByBusinessId.set(businessId, list);
	}

	const normalizedMasterEmail = masterEmail.trim().toLowerCase();
	const isProtectedEmail = (value?: string | null) => {
		const email = String(value ?? '').trim().toLowerCase();
		return Boolean(email && (email === normalizedMasterEmail || isMasterEmail(email)));
	};
	const authEmails = Array.from(
		new Set(
			Array.from(emailsByUserId.values())
				.map((email) => String(email ?? '').trim().toLowerCase())
				.filter((email) => email && !isProtectedEmail(email))
		)
	).sort();

	const businesses = (businessesRes.data ?? []).map((business: any) => {
		const subscription = subscriptionsByBusinessId.get(String(business.id)) ?? null;
		const access = getBusinessAccessState(subscription, { businessCreatedAt: business.created_at });
		const members = membershipsByBusinessId.get(String(business.id)) ?? [];
		const owners = members.filter((member) => member.role === 'owner');
		return {
			...business,
			subscription,
			access,
			members,
			owners,
			primaryOwnerEmail: owners[0]?.email ?? members[0]?.email ?? null,
			recentGrants: grantsByBusinessId.get(String(business.id)) ?? []
		};
	}).filter((business: any) => {
		const ownerEmails = (business.owners ?? [])
			.map((owner: any) => String(owner.email ?? '').toLowerCase())
			.filter(Boolean);
		if (isProtectedEmail(business.email)) return false;
		return !ownerEmails.some((email: string) => isProtectedEmail(email));
	});

	return {
		emails: (emailsRes.data ?? []).filter((item: any) => !isProtectedEmail(String(item.email ?? ''))),
		authEmails,
		pendingInvites: (invitesRes.data ?? []).filter((item: any) => !isProtectedEmail(String(item.email ?? ''))),
		businesses,
		statuses: COMMERCIAL_STATUSES
	};
};

export const load: PageServerLoad = async ({ locals, fetch }) => {
	if (!locals.auth) throw redirect(303, '/login');
	const master = ensureMaster(locals.auth.access_token);
	const admin = await createSupabaseAdminClient('odonto', fetch);

	try {
		return {
			...(await buildMasterData(admin, master.email)),
			masterEmail: master.email,
			loadError: null
		};
	} catch (error) {
		console.error('Error cargando panel maestro', error);
		return {
			emails: [],
			authEmails: [],
			pendingInvites: [],
			businesses: [],
			statuses: COMMERCIAL_STATUSES,
			masterEmail: master.email,
			loadError: 'No se pudo cargar el panel maestro. Revisá la conexión y las migraciones.'
		};
	}
};

export const actions: Actions = {
	provision_owner_access: async ({ request, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		const master = ensureMaster(locals.auth.access_token);
		const form = await request.formData();
		const email = normalizeEmail(form.get('email'));
		const destination = String(form.get('destination') ?? '').trim();
		const businessIdInput = String(form.get('business_id') ?? '').trim();
		const businessName = String(form.get('business_name') ?? '').trim();
		const durationKey = String(form.get('duration') ?? '').trim();
		const note = String(form.get('note') ?? '').trim() || null;

		if (!EMAIL_FORMAT_REGEX.test(email)) {
			return fail(400, { message: 'Ingresá un correo electrónico válido.', email });
		}
		if (isMasterEmail(email)) {
			return fail(403, { message: 'El email maestro no se gestiona desde este panel.', email });
		}
		if (destination !== 'existing' && destination !== 'new') {
			return fail(400, { message: 'Elegí si va a un consultorio existente o nuevo.', email });
		}

		const admin = await createSupabaseAdminClient('odonto', fetch);
		let ownerUserId: string | null = null;
		try {
			ownerUserId = await findAuthUserIdByEmail(admin, email);
		} catch (error) {
			console.error('Error buscando usuario auth para alta guiada', error);
			return fail(500, { message: 'No pudimos validar si la cuenta ya existe.', email });
		}

		let businessId = businessIdInput;
		let createdBusinessId: string | null = null;
		let duration: (typeof DURATION_SECONDS)[string] | null = null;

		if (destination === 'existing') {
			if (!businessId) return fail(400, { message: 'Elegí un consultorio.', email });
			const { data: business, error } = await admin
				.from('businesses')
				.select('id')
				.eq('id', businessId)
				.maybeSingle();
			if (error) {
				console.error('Error validando consultorio existente', error);
				return fail(500, { message: 'No pudimos validar el consultorio.', email });
			}
			if (!business?.id) return fail(404, { message: 'Consultorio no encontrado.', email });
			if (await businessHasMasterOwner(admin, businessId, master.userId, master.email)) {
				return fail(403, { message: 'El consultorio interno del email maestro no se gestiona desde este panel.', email });
			}
		} else {
			if (!businessName) return fail(400, { message: 'Ingresá el nombre del consultorio.', email });
			duration = DURATION_SECONDS[durationKey] ?? null;
			if (!duration) return fail(400, { message: 'Elegí la duración inicial.', email });

			const slug = await uniqueBusinessSlug(admin, businessName);
			const { data: business, error } = await admin
				.from('businesses')
				.insert({
					name: businessName,
					slug,
					industry: 'odontology',
					email
				})
				.select('id')
				.single();
			if (error || !business?.id) {
				console.error('Error creando consultorio desde alta guiada', error);
				return fail(500, { message: 'No pudimos crear el consultorio.', email });
			}
			businessId = business.id;
			createdBusinessId = business.id;
		}

		try {
			await ensureAllowedEmail({
				admin,
				email,
				note,
				actorId: master.userId
			});

			const assignment = await ensureOwnerMembershipOrInvite({
				admin,
				businessId,
				email,
				userId: ownerUserId,
				actorId: master.userId
			});

			if (destination === 'new' && duration) {
				const operation = durationKey === 'permanent' ? 'set_permanent' : 'grant_access';
				const { error: grantError } = await admin.rpc('grant_business_access', {
					p_business_id: businessId,
					p_operation: operation,
					p_duration_seconds: duration.seconds,
					p_duration_unit: duration.unit,
					p_is_permanent: durationKey === 'permanent',
					p_amount: null,
					p_source: 'internal',
					p_note: note ?? `Alta guiada con acceso inicial: ${duration.label}.`,
					p_admin_id: master.userId,
					p_admin_email: master.email,
					p_idempotency_key: randomUUID()
				});
				if (grantError) throw grantError;
			}

			const target = destination === 'new' ? 'Consultorio creado' : 'Consultorio vinculado';
			const suffix =
				assignment === 'assigned'
					? 'La cuenta ya existe y quedó asignada.'
					: 'La cuenta queda asignada automáticamente cuando se registre.';
			return { success: true, message: `${target}. Email habilitado. ${suffix}` };
		} catch (error) {
			if (createdBusinessId) {
				await admin.from('businesses').delete().eq('id', createdBusinessId);
			}
			console.error('Error en alta guiada de acceso', error);
			const raw = error instanceof Error ? error.message : '';
			if (raw.includes('EMAIL_ALREADY_ASSIGNED')) {
				return fail(409, { message: 'Ese email ya está asociado a otro consultorio activo.', email });
			}
			if (raw.includes('EMAIL_ALREADY_INVITED')) {
				return fail(409, { message: 'Ese email ya tiene una asignación pendiente en otro consultorio.', email });
			}
			return fail(500, { message: 'No pudimos completar el alta guiada.', email });
		}
	},
	create_business: async ({ request, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		const master = ensureMaster(locals.auth.access_token);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const ownerEmail = normalizeEmail(form.get('owner_email'));
		const durationKey = String(form.get('duration') ?? '').trim();
		const note = String(form.get('note') ?? '').trim() || null;
		const duration = DURATION_SECONDS[durationKey] ?? null;

		if (!name) return fail(400, { message: 'Ingresá el nombre del consultorio.' });
		if (!EMAIL_FORMAT_REGEX.test(ownerEmail)) {
			return fail(400, { message: 'Ingresá un correo owner válido.' });
		}
		if (isMasterEmail(ownerEmail)) {
			return fail(403, { message: 'El email maestro no se puede usar como owner operativo.' });
		}
		if (!duration) {
			return fail(400, { message: 'Elegí la duración inicial del consultorio.' });
		}

		const admin = await createSupabaseAdminClient('odonto', fetch);
		let ownerUserId: string | null = null;
		const perPage = 200;
		let page = 1;
		while (!ownerUserId) {
			const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
			if (error) {
				console.error('Error buscando usuario owner', error);
				return fail(500, { message: 'No pudimos validar el usuario owner.' });
			}
			const users = data?.users ?? [];
			const match = users.find((user) => (user.email ?? '').toLowerCase() === ownerEmail);
			if (match?.id) ownerUserId = match.id;
			if (users.length < perPage) break;
			page += 1;
		}

		if (!ownerUserId) {
			return fail(400, {
				message:
					'El owner todavía no tiene cuenta creada. Primero habilitá el email y pedile que se registre; después creá el consultorio.'
			});
		}

		const { data: activeMembership, error: activeMembershipError } = await admin
			.from('business_users')
			.select('id, business_id')
			.eq('user_id', ownerUserId)
			.eq('status', 'active')
			.limit(1)
			.maybeSingle();
		if (activeMembershipError) {
			console.error('Error validando membresía existente del owner', activeMembershipError);
			return fail(500, { message: 'No pudimos validar si el owner ya pertenece a otro consultorio.' });
		}
		if (activeMembership?.id) {
			return fail(409, { message: 'Ese email ya está asociado a otro consultorio activo.' });
		}

		const { data: pendingInvite, error: pendingInviteError } = await admin
			.from('business_user_invites')
			.select('id')
			.eq('email', ownerEmail)
			.eq('status', 'pending')
			.limit(1)
			.maybeSingle();
		if (pendingInviteError) {
			console.error('Error validando invitación pendiente del owner', pendingInviteError);
			return fail(500, { message: 'No pudimos validar invitaciones pendientes para ese email.' });
		}
		if (pendingInvite?.id) {
			return fail(409, { message: 'Ese email ya tiene una invitación pendiente en otro consultorio.' });
		}

		const { data: existingEmail, error: existingEmailError } = await admin
			.from('allowed_emails')
			.select('id')
			.eq('email', ownerEmail)
			.maybeSingle();
		if (existingEmailError) {
			console.error('Error validando email owner', existingEmailError);
			return fail(500, { message: 'No pudimos validar el email owner.' });
		}

		const emailWrite = existingEmail
			? await admin
					.from('allowed_emails')
					.update({
						enabled: true,
						disabled_at: null,
						disabled_reason: null,
						updated_by: master.userId,
						note: note ?? 'Owner de consultorio creado desde panel maestro.'
					})
					.eq('id', existingEmail.id)
			: await admin.from('allowed_emails').insert({
					email: ownerEmail,
					enabled: true,
					note: note ?? 'Owner de consultorio creado desde panel maestro.',
					updated_by: master.userId,
					created_by: master.userId
				});
		if (emailWrite.error) {
			console.error('Error habilitando email owner', emailWrite.error);
			return fail(500, { message: 'No pudimos habilitar el email owner.' });
		}

		const slug = await uniqueBusinessSlug(admin, name);
		const { data: business, error: businessError } = await admin
			.from('businesses')
			.insert({
				name,
				slug,
				industry: 'odontology',
				email: ownerEmail
			})
			.select('id')
			.single();

		if (businessError || !business?.id) {
			console.error('Error creando consultorio', businessError);
			return fail(500, { message: 'No pudimos crear el consultorio.' });
		}

		const { error: membershipError } = await admin.from('business_users').insert({
			business_id: business.id,
			user_id: ownerUserId,
			role: 'owner',
			status: 'active',
			accepted_at: new Date().toISOString(),
			created_by: master.userId,
			updated_by: master.userId
		});

		if (membershipError) {
			console.error('Error vinculando owner al consultorio', membershipError);
			await admin.from('businesses').delete().eq('id', business.id);
			return fail(500, { message: 'No pudimos vincular el owner al consultorio.' });
		}

		const operation = durationKey === 'permanent' ? 'set_permanent' : 'grant_access';
		const { error: grantError } = await admin.rpc('grant_business_access', {
			p_business_id: business.id,
			p_operation: operation,
			p_duration_seconds: duration.seconds,
			p_duration_unit: duration.unit,
			p_is_permanent: durationKey === 'permanent',
			p_amount: null,
			p_source: 'internal',
			p_note: note ?? `Consultorio creado con acceso inicial: ${duration.label}.`,
			p_admin_id: master.userId,
			p_admin_email: master.email,
			p_idempotency_key: randomUUID()
		});
		if (grantError) {
			console.error('Error asignando acceso inicial al consultorio', grantError);
			await admin.from('businesses').delete().eq('id', business.id);
			return fail(500, { message: 'No pudimos asignar el acceso inicial del consultorio.' });
		}

		return { success: true, message: 'Consultorio creado, owner vinculado y acceso inicial configurado.' };
	},
	add_email: async ({ request, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		const master = ensureMaster(locals.auth.access_token);
		const form = await request.formData();
		const email = normalizeEmail(form.get('email'));
		const note = String(form.get('note') ?? '').trim() || null;

		if (!EMAIL_FORMAT_REGEX.test(email)) {
			return fail(400, { message: 'Ingresá un correo electrónico válido.', email });
		}
		if (isMasterEmail(email)) {
			return fail(403, { message: 'El email maestro no se gestiona desde este panel.' });
		}

		const admin = await createSupabaseAdminClient('odonto', fetch);
		const { data: existingEmail, error: existingError } = await admin
			.from('allowed_emails')
			.select('id')
			.eq('email', email)
			.maybeSingle();

		if (existingError) {
			console.error('Error buscando email habilitado', existingError);
			return fail(500, { message: 'No pudimos validar el correo electrónico.', email });
		}

		const { error } = existingEmail
			? await admin
					.from('allowed_emails')
					.update({
						enabled: true,
						note,
						disabled_at: null,
						disabled_reason: null,
						updated_by: master.userId
					})
					.eq('id', existingEmail.id)
			: await admin.from('allowed_emails').insert({
					email,
					enabled: true,
					note,
					disabled_at: null,
					disabled_reason: null,
					updated_by: master.userId,
					created_by: master.userId
				});

		if (error) {
			console.error('Error guardando email habilitado', error);
			return fail(500, { message: 'No pudimos guardar el correo electrónico.', email });
		}

		return { success: true, message: 'Correo habilitado.' };
	},
	toggle_email: async ({ request, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		const master = ensureMaster(locals.auth.access_token);
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		const enabled = String(form.get('enabled') ?? '') === 'true';
		const reason = String(form.get('reason') ?? '').trim() || null;

		if (!id) return fail(400, { message: 'Correo electrónico inválido.' });

		const admin = await createSupabaseAdminClient('odonto', fetch);
		const { data: existingEmail, error: existingError } = await admin
			.from('allowed_emails')
			.select('email')
			.eq('id', id)
			.maybeSingle();
		if (existingError) {
			console.error('Error validando email para cambio de estado', existingError);
			return fail(500, { message: 'No pudimos validar el correo electrónico.' });
		}
		if (!existingEmail) return fail(404, { message: 'Correo electrónico no encontrado.' });
		if (isMasterEmail(String(existingEmail.email ?? ''))) {
			return fail(403, { message: 'El email maestro no puede deshabilitarse.' });
		}

		const { error } = enabled
			? await admin
					.from('allowed_emails')
					.update({
						enabled: true,
						disabled_at: null,
						disabled_reason: null,
						updated_by: master.userId
					})
					.eq('id', id)
			: await admin.rpc('disable_allowed_email_as_master_safely', {
					p_email: String(existingEmail.email ?? ''),
					p_actor_id: master.userId,
					p_actor_email: master.email,
					p_reason: reason
				});

		if (error) {
			console.error('Error actualizando email', error);
			const raw = `${error.message ?? ''} ${error.details ?? ''}`;
			if (raw.includes('LAST_OWNER_BLOCKED')) {
				return fail(403, {
					message: 'No podés deshabilitar este email porque es el único dueño activo de un consultorio.'
				});
			}
			return fail(500, { message: 'No pudimos actualizar el correo electrónico.' });
		}

		return { success: true, message: enabled ? 'Correo habilitado.' : 'Correo deshabilitado.' };
	},
	adjust_business_access: async ({ request, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		const master = ensureMaster(locals.auth.access_token);
		const form = await request.formData();
		const businessId = String(form.get('business_id') ?? '').trim();
		const operation = String(form.get('operation') ?? '').trim();
		const durationKey = String(form.get('duration') ?? '').trim();
		const source = String(form.get('source') ?? 'manual').trim() || 'manual';
		const note = String(form.get('note') ?? '').trim() || null;
		const amountRaw = String(form.get('amount') ?? '').trim();
		const amount = parseMoneyInteger(amountRaw);
		const duration = DURATION_SECONDS[durationKey] ?? null;
		const idempotencyKey = String(form.get('idempotency_key') ?? '').trim() || randomUUID();

		if (!businessId) return fail(400, { message: 'Consultorio inválido.' });
		if (!BUSINESS_ACCESS_OPERATIONS.includes(operation as any)) {
			return fail(400, { message: 'Operación inválida.' });
		}
		if (!duration && !['disable_business_access', 'enable_business_access', 'archive_business', 'payment_cancelled', 'unset_permanent'].includes(operation)) {
			return fail(400, { message: 'Duración inválida.' });
		}
		if (amountRaw && amount === null) {
			return fail(400, { message: 'Monto inválido.' });
		}

		const admin = await createSupabaseAdminClient('odonto', fetch);
		if (await businessHasMasterOwner(admin, businessId, master.userId, master.email)) {
			return fail(403, { message: 'El consultorio interno del email maestro no se gestiona desde este panel.' });
		}

		const { error } = await admin.rpc('grant_business_access', {
			p_business_id: businessId,
			p_operation: operation,
			p_duration_seconds: duration?.seconds ?? null,
			p_duration_unit: duration?.unit ?? null,
			p_is_permanent: durationKey === 'permanent' || operation === 'set_permanent',
			p_amount: amount,
			p_source: source,
			p_note: note,
			p_admin_id: master.userId,
			p_admin_email: master.email,
			p_idempotency_key: idempotencyKey
		});

		if (error) {
			console.error('Error ajustando acceso comercial', error);
			const raw = error.message?.toLowerCase() ?? '';
			if (raw.includes('permanent')) {
				return fail(400, { message: 'La operación no es válida para una cuenta permanente.' });
			}
			if (raw.includes('idempotency')) {
				return fail(409, { message: 'La operación ya fue procesada o la clave se reutilizó con otros datos.' });
			}
			return fail(500, { message: 'No pudimos ajustar el acceso comercial.' });
		}

		return { success: true, message: 'Acceso comercial actualizado.' };
	},
	revoke_business_sessions: async ({ request, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		const master = ensureMaster(locals.auth.access_token);
		const form = await request.formData();
		const businessId = String(form.get('business_id') ?? '').trim();
		if (!businessId) return fail(400, { message: 'Consultorio inválido.' });

		const admin = await createSupabaseAdminClient('odonto', fetch);
		if (await businessHasMasterOwner(admin, businessId, master.userId, master.email)) {
			return fail(403, { message: 'No se pueden cerrar sesiones del email maestro desde este panel.' });
		}

		const { data: members, error: membersError } = await admin
			.from('business_users')
			.select('user_id')
			.eq('business_id', businessId);
		if (membersError) {
			console.error('Error cargando usuarios para cerrar sesiones', membersError);
			return fail(500, { message: 'No pudimos cargar los usuarios del consultorio.' });
		}

		let revoked = 0;
		for (const member of members ?? []) {
			if (!member.user_id) continue;
			const { error } = await admin.auth.admin.signOut(member.user_id);
			if (error) {
				console.error('Error cerrando sesión de usuario', member.user_id, error);
				continue;
			}
			revoked += 1;
		}

		await admin.from('access_grants').insert({
			business_id: businessId,
			operation: 'sessions_revoked',
			source: 'internal',
			note: `Sesiones cerradas: ${revoked}`,
			admin_id: master.userId,
			admin_email: master.email,
			idempotency_key: randomUUID()
		});

		return { success: true, message: `Sesiones cerradas: ${revoked}.` };
	}
};
