import { createSupabaseAdminClient } from './supabase';

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
	const { data: invites, error } = await admin
		.from('business_user_invites')
		.select('id, business_id, role, invited_by')
		.eq('email', normalizedEmail)
		.eq('status', 'pending')
		.gt('expires_at', new Date().toISOString());
	if (error) throw error;

	let accepted = 0;
	for (const invite of invites ?? []) {
		const now = new Date().toISOString();
		const { data: activeMembership, error: activeMembershipError } = await admin
			.from('business_users')
			.select('id, business_id')
			.eq('user_id', userId)
			.eq('status', 'active')
			.limit(1)
			.maybeSingle();
		if (activeMembershipError) throw activeMembershipError;
		if (activeMembership?.id && activeMembership.business_id !== invite.business_id) continue;

		const { error: membershipError } = await admin.from('business_users').upsert(
			{
				business_id: invite.business_id,
				user_id: userId,
				role: invite.role,
				status: 'active',
				accepted_at: now,
				disabled_at: null,
				disabled_reason: null,
				created_by: invite.invited_by,
				updated_by: invite.invited_by,
				updated_at: now
			},
			{ onConflict: 'business_id,user_id' }
		);
		if (membershipError) throw membershipError;

		const { error: inviteError } = await admin
			.from('business_user_invites')
			.update({
				status: 'accepted',
				accepted_user_id: userId,
				accepted_at: now,
				updated_at: now
			})
			.eq('id', invite.id);
		if (inviteError) throw inviteError;
		accepted += 1;
	}

	return accepted;
};
