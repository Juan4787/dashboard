import { createSupabaseAdminClient } from './supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const shouldUseInviteFallback = (error: { code?: string; message?: string }) =>
	error.code === '42P10' ||
	Boolean(error.message?.includes('there is no unique or exclusion constraint matching'));

const enableAllowedEmail = async ({
	admin,
	email,
	actorUserId
}: {
	admin: SupabaseClient;
	email: string;
	actorUserId: string | null;
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

const ensureProfessionalUserLink = async ({
	admin,
	businessId,
	professionalId,
	userId
}: {
	admin: SupabaseClient;
	businessId: string;
	professionalId: string;
	userId: string;
}) => {
	const { data: existing, error: lookupError } = await admin
		.from('professional_users')
		.select('id')
		.eq('business_id', businessId)
		.eq('professional_id', professionalId)
		.eq('user_id', userId)
		.limit(1);
	if (lookupError) throw lookupError;
	if ((existing ?? []).length > 0) return;

	const { error: insertError } = await admin.from('professional_users').insert({
		business_id: businessId,
		professional_id: professionalId,
		user_id: userId
	});
	if (insertError && insertError.code !== '23505') throw insertError;
};

const consumePendingBusinessInvitesWithFallback = async ({
	admin,
	email,
	userId
}: {
	admin: SupabaseClient;
	email: string;
	userId: string;
}) => {
	const { data: authUser, error: authError } = await admin.auth.admin.getUserById(userId);
	if (authError) throw authError;
	if (authUser.user?.email?.trim().toLowerCase() !== email) {
		throw new Error('AUTH_USER_EMAIL_MISMATCH');
	}

	const { data: invites, error: invitesError } = await admin
		.from('business_user_invites')
		.select('id, business_id, role, professional_id, invited_by, created_at')
		.eq('email', email)
		.eq('status', 'pending')
		.gt('expires_at', new Date().toISOString())
		.order('created_at', { ascending: true });
	if (invitesError) throw invitesError;

	let consumed = 0;
	for (const invite of invites ?? []) {
		const businessId = String(invite.business_id);
		const { data: otherMemberships, error: otherMembershipsError } = await admin
			.from('business_users')
			.select('id')
			.eq('user_id', userId)
			.neq('business_id', businessId)
			.or('status.is.null,status.eq.active')
			.limit(1);
		if (otherMembershipsError) throw otherMembershipsError;
		if ((otherMemberships ?? []).length > 0) continue;

		await enableAllowedEmail({
			admin,
			email,
			actorUserId: invite.invited_by ? String(invite.invited_by) : null
		});

		const { data: existingMembership, error: membershipLookupError } = await admin
			.from('business_users')
			.select('id')
			.eq('business_id', businessId)
			.eq('user_id', userId)
			.maybeSingle();
		if (membershipLookupError) throw membershipLookupError;

		if (existingMembership?.id) {
			const { error: updateError } = await admin
				.from('business_users')
				.update({
					role: invite.role,
					status: 'active',
					accepted_at: new Date().toISOString(),
					disabled_at: null,
					disabled_reason: null,
					updated_by: invite.invited_by ?? null,
					updated_at: new Date().toISOString()
				})
				.eq('id', existingMembership.id);
			if (updateError) throw updateError;
		} else {
			const { error: insertError } = await admin.from('business_users').insert({
				business_id: businessId,
				user_id: userId,
				role: invite.role,
				status: 'active',
				accepted_at: new Date().toISOString(),
				created_by: invite.invited_by ?? null,
				updated_by: invite.invited_by ?? null
			});
			if (insertError && insertError.code !== '23505') throw insertError;
		}

		if (invite.role === 'professional' && invite.professional_id) {
			await ensureProfessionalUserLink({
				admin,
				businessId,
				professionalId: String(invite.professional_id),
				userId
			});
		}

		const { error: inviteUpdateError } = await admin
			.from('business_user_invites')
			.update({
				status: 'accepted',
				accepted_user_id: userId,
				accepted_at: new Date().toISOString(),
				updated_at: new Date().toISOString()
			})
			.eq('id', invite.id)
			.eq('status', 'pending');
		if (inviteUpdateError) throw inviteUpdateError;
		consumed += 1;
	}

	return consumed;
};

export const consumePendingBusinessInvites = async ({
	email,
	userId,
	fetch
}: {
	email: string;
	userId: string;
	fetch?: typeof globalThis.fetch;
}) => {
	const normalizedEmail = email.trim().toLowerCase();
	if (!EMAIL_FORMAT_REGEX.test(normalizedEmail)) return 0;

	const admin = await createSupabaseAdminClient('odonto', fetch);
	const { data, error } = await admin.rpc('accept_pending_business_invites_for_user', {
		p_email: normalizedEmail,
		p_user_id: userId
	});
	if (error) {
		if (!shouldUseInviteFallback(error)) throw error;
		return consumePendingBusinessInvitesWithFallback({
			admin,
			email: normalizedEmail,
			userId
		});
	}
	return Number(data ?? 0);
};
