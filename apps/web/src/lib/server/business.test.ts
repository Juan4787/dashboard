import { describe, expect, it, vi } from 'vitest';
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
		order: vi.fn(() => Promise.resolve(result)),
		in: vi.fn(() => Promise.resolve(result))
	};
	return query;
};

describe('resolveActiveBusiness', () => {
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
});
