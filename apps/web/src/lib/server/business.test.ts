import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', async () => {
	const actual = await vi.importActual<typeof import('./supabase')>('./supabase');
	return {
		...actual,
		createSupabaseAdminClient: vi.fn(async () => {
			throw new Error('admin no disponible en test unitario');
		})
	};
});

import { resolveActiveBusiness } from './business';

const accessTokenFor = (userId: string) => {
	const payload = Buffer.from(JSON.stringify({ sub: userId })).toString('base64url');
	return `test.${payload}.signature`;
};

const businessRow = {
	id: 'business-1',
	name: 'Consultorio test',
	slug: 'consultorio-test',
	industry: 'odontology',
	phone: null,
	email: null,
	address: null,
	logo_url: null,
	timezone: 'America/Argentina/Cordoba',
	public_booking_enabled: true,
	whatsapp_enabled: false,
	allow_same_day_booking: false,
	min_booking_notice_minutes: 1440,
	max_booking_days_ahead: 60,
	cancellation_policy: null,
	is_active: true,
	created_at: '2026-06-01T00:00:00.000Z',
	updated_at: '2026-06-01T00:00:00.000Z'
};

const subscriptionRow = {
	id: 'subscription-1',
	business_id: 'business-1',
	commercial_access_enabled: true,
	is_permanent: true,
	subscription_status: 'active',
	access_starts_at: null,
	paid_until: null,
	grace_until: null,
	restricted_until: null,
	archived_at: null,
	last_payment_at: null,
	last_payment_amount: null,
	last_grant_duration_seconds: null,
	expiration_notice_enabled: false,
	access_source: null,
	access_note: null,
	updated_by: null,
	created_at: '2026-06-01T00:00:00.000Z',
	updated_at: '2026-06-01T00:00:00.000Z'
};

const queryReturning = (result: unknown) => {
	const query = {
		select: vi.fn(() => query),
		eq: vi.fn(() => query),
		is: vi.fn(() => query),
		gt: vi.fn(() => query),
		order: vi.fn(() => Promise.resolve(result)),
		in: vi.fn(() => Promise.resolve(result))
	};
	return query;
};

describe('resolveActiveBusiness', () => {
	it('loads the auto-created owner business after allowed-email bootstrap', async () => {
		const userId = 'user-allowed';
		const firstMembershipRead = queryReturning({ data: [], error: null });
		const recoveredMembershipRead = queryReturning({
			data: [{ role: 'owner', business: businessRow }],
			error: null
		});
		const subscriptionsRead = queryReturning({
			data: [
				{
					...subscriptionRow,
					commercial_access_enabled: true,
					is_permanent: false,
					subscription_status: 'restricted',
					paid_until: null,
					grace_until: null,
					restricted_until: '2099-07-30T00:00:00.000Z',
					access_note: 'Cuenta pendiente de activación de suscripción.'
				}
			],
			error: null
		});

		const supabase = {
			from: vi.fn((table: string) => {
				if (table === 'business_users') {
					const count = supabase.from.mock.calls.filter(([name]: [string]) => name === 'business_users').length;
					return count === 1 ? firstMembershipRead : recoveredMembershipRead;
				}
				if (table === 'account_assistance_grants') return queryReturning({ data: [], error: null });
				if (table === 'business_subscriptions') return subscriptionsRead;
				throw new Error(`Unexpected table ${table}`);
			}),
			rpc: vi.fn(() => Promise.resolve({ data: [{ business_id: 'business-1', role: 'owner' }], error: null }))
		} as any;

		const context = await resolveActiveBusiness({
			supabase,
			accessToken: accessTokenFor(userId)
		});

		expect(context?.business.id).toBe('business-1');
		expect(context?.role).toBe('owner');
		expect(context?.access.commercialAccessEnabled).toBe(true);
		expect(context?.access.commercialStatus).toBe('restricted');
		expect(context?.access.canUseBusiness).toBe(false);
		expect(supabase.rpc).toHaveBeenCalledWith('ensure_user_default_business', {
			p_name: 'Consultorio',
			p_industry: 'odontology'
		});
	});

	it('recovers an accepted invite membership after bootstrap race', async () => {
		const userId = 'user-1';
		const firstMembershipRead = queryReturning({ data: [], error: null });
		const recoveredMembershipRead = queryReturning({
			data: [{ role: 'professional', business: businessRow }],
			error: null
		});
		const subscriptionsRead = queryReturning({ data: [subscriptionRow], error: null });

		const supabase = {
			from: vi.fn((table: string) => {
				if (table === 'business_users') {
					const count = supabase.from.mock.calls.filter(([name]: [string]) => name === 'business_users').length;
					return count === 1 ? firstMembershipRead : recoveredMembershipRead;
				}
				if (table === 'account_assistance_grants') return queryReturning({ data: [], error: null });
				if (table === 'business_subscriptions') return subscriptionsRead;
				throw new Error(`Unexpected table ${table}`);
			}),
			rpc: vi.fn(() =>
				Promise.resolve({
					data: null,
					error: { message: 'DEFAULT_BUSINESS_CREATION_DISABLED' }
				})
			)
		} as any;

		const context = await resolveActiveBusiness({
			supabase,
			accessToken: accessTokenFor(userId)
		});

		expect(context?.business.id).toBe('business-1');
		expect(context?.role).toBe('professional');
		expect(context?.access.commercialStatus).toBe('active');
		expect(supabase.rpc).toHaveBeenCalledWith('ensure_user_default_business', {
			p_name: 'Consultorio',
			p_industry: 'odontology'
		});
	});

		it('resolves an active account assistance grant as an admin context for support', async () => {
		const userId = 'master-user';
		const membershipsRead = queryReturning({ data: [], error: null });
		const assistanceRead = queryReturning({
			data: [
				{
					id: 'assist-1',
					business_id: 'business-1',
					requested_by_user_id: 'owner-1',
					support_user_id: userId,
					status: 'active',
					starts_at: '2026-07-08T20:45:00.000Z',
					expires_at: '2026-07-08T21:45:00.000Z',
					business: businessRow
				}
			],
			error: null
		});
		const subscriptionsRead = queryReturning({ data: [subscriptionRow], error: null });

			const supabase = {
				from: vi.fn((table: string) => {
					if (table === 'business_users') return membershipsRead;
					if (table === 'account_assistance_grants') return assistanceRead;
					if (table === 'business_subscriptions') return subscriptionsRead;
					throw new Error(`Unexpected table ${table}`);
				}),
				rpc: vi.fn((name: string) => {
					if (name === 'user_has_active_account_assistance') {
						return Promise.resolve({ data: true, error: null });
					}
					return Promise.resolve({ data: null, error: null });
				})
			} as any;

		const context = await resolveActiveBusiness({
			supabase,
			accessToken: accessTokenFor(userId)
		});

		expect(context?.business.id).toBe('business-1');
		expect(context?.role).toBe('admin');
		expect(context?.canManage).toBe(true);
		expect(context?.assistance).toMatchObject({
			grantId: 'assist-1',
			requestedByUserId: 'owner-1',
			supportUserId: userId
		});
			expect(supabase.rpc).toHaveBeenCalledWith('user_has_active_account_assistance', {
				target_business_id: 'business-1'
			});
		});

		it('does not grant admin context when the SQL active-assistance check denies it', async () => {
			const userId = 'master-user';
			const membershipsRead = queryReturning({ data: [], error: null });
			const assistanceRead = queryReturning({
				data: [
					{
						id: 'assist-1',
						business_id: 'business-1',
						requested_by_user_id: 'owner-1',
						support_user_id: userId,
						status: 'active',
						starts_at: '2026-07-08T20:45:00.000Z',
						expires_at: '2026-07-08T21:45:00.000Z',
						business: businessRow
					}
				],
				error: null
			});

			const supabase = {
				from: vi.fn((table: string) => {
					if (table === 'business_users') return membershipsRead;
					if (table === 'account_assistance_grants') return assistanceRead;
					throw new Error(`Unexpected table ${table}`);
				}),
				rpc: vi.fn((name: string) => {
					if (name === 'user_has_active_account_assistance') {
						return Promise.resolve({ data: false, error: null });
					}
					return Promise.resolve({ data: null, error: null });
				})
			} as any;

			const context = await resolveActiveBusiness({
				supabase,
				accessToken: accessTokenFor(userId),
				ensureDefault: false
			});

			expect(context).toBeNull();
			expect(supabase.from).not.toHaveBeenCalledWith('business_subscriptions');
			expect(supabase.rpc).toHaveBeenCalledWith('user_has_active_account_assistance', {
				target_business_id: 'business-1'
			});
		});
	});
