import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient, getAuthUserId } from './supabase';
import {
	getBusinessAccessState,
	type BusinessAccessState,
	type BusinessSubscriptionRow
} from './commercial-access';

export const BUSINESS_ROLES = ['owner', 'admin', 'reception', 'professional', 'readonly'] as const;
export type BusinessRole = (typeof BUSINESS_ROLES)[number];

export const BUSINESS_INDUSTRIES = [
	'odontology',
	'aesthetics',
	'kinesiology',
	'nutrition',
	'therapy',
	'other'
] as const;
export type BusinessIndustry = (typeof BUSINESS_INDUSTRIES)[number];

export type Business = {
	id: string;
	name: string;
	slug: string;
	industry: BusinessIndustry;
	phone: string | null;
	email: string | null;
	address: string | null;
	address_instructions: string | null;
	maps_url: string | null;
	logo_url: string | null;
	timezone: string;
	public_booking_enabled: boolean;
	whatsapp_enabled: boolean;
	allow_same_day_booking: boolean;
	min_booking_notice_minutes: number;
	max_booking_days_ahead: number;
	cancellation_policy: string | null;
	is_active: boolean;
	created_at?: string | null;
	updated_at?: string | null;
};

export type BusinessContext = {
	business: Business;
	role: BusinessRole;
	canManage: boolean;
	canOperate: boolean;
	access: BusinessAccessState;
};

const ACTIVE_BUSINESS_COOKIE = 'active-business-id';

const businessSelect = `
	id,
	name,
	slug,
	industry,
	phone,
	email,
	address,
	address_instructions,
	maps_url,
	logo_url,
	timezone,
	public_booking_enabled,
	whatsapp_enabled,
	allow_same_day_booking,
	min_booking_notice_minutes,
	max_booking_days_ahead,
	cancellation_policy,
	is_active,
	created_at,
	updated_at
`;

export const isBusinessRole = (value: string): value is BusinessRole =>
	(BUSINESS_ROLES as readonly string[]).includes(value);

export const isBusinessIndustry = (value: string): value is BusinessIndustry =>
	(BUSINESS_INDUSTRIES as readonly string[]).includes(value);

export const normalizeSlug = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);

const canManageRole = (role: BusinessRole) => role === 'owner' || role === 'admin';
const canOperateRole = (role: BusinessRole) =>
	role === 'owner' || role === 'admin' || role === 'reception';

export const demoBusinessContext = (): BusinessContext => ({
	business: {
		id: 'demo-business',
		name: 'Consultorio demo',
		slug: 'consultorio-demo',
		industry: 'odontology',
		phone: null,
		email: null,
		address: null,
		address_instructions: null,
		maps_url: null,
		logo_url: null,
		timezone: 'America/Argentina/Cordoba',
		public_booking_enabled: true,
		whatsapp_enabled: false,
		allow_same_day_booking: false,
		min_booking_notice_minutes: 0,
		max_booking_days_ahead: 60,
		cancellation_policy: null,
		is_active: true
	},
	role: 'owner',
	canManage: true,
	canOperate: true,
	access: getBusinessAccessState({
		business_id: 'demo-business',
		commercial_access_enabled: true,
		is_permanent: true,
		subscription_status: 'active'
	})
});

type ResolveBusinessOptions = {
	supabase: SupabaseClient;
	accessToken?: string | null;
	cookies?: Cookies;
	ensureDefault?: boolean;
};

const mapMembership = (row: any): BusinessContext | null => {
	const role = String(row?.role ?? '');
	const business = row?.business;
	if (!business || !isBusinessRole(role)) return null;
	const access = getBusinessAccessState(null, { businessCreatedAt: business.created_at });
	return {
		business: business as Business,
		role,
		canManage: canManageRole(role) && access.canUseBusiness,
		canOperate: canOperateRole(role) && access.canUseBusiness,
		access
	};
};

const applySubscription = (
	membership: BusinessContext,
	subscription: BusinessSubscriptionRow | null | undefined,
	options: { legacyFallback?: boolean } = {}
): BusinessContext => {
	const access = getBusinessAccessState(subscription ?? null, {
		businessCreatedAt: membership.business.created_at,
		legacyFallback: options.legacyFallback
	});
	return {
		...membership,
		canManage: canManageRole(membership.role) && access.canUseBusiness,
		canOperate: canOperateRole(membership.role) && access.canUseBusiness,
		access
	};
};

const loadMemberships = async (
	supabase: SupabaseClient,
	userId: string
): Promise<BusinessContext[]> => {
	const { data, error } = await supabase
		.from('business_users')
		.select(`role, business:businesses!inner(${businessSelect})`)
		.eq('user_id', userId)
		.order('created_at', { ascending: true });

	if (error) {
		throw error;
	}

	const memberships = (data ?? []).map(mapMembership).filter((item): item is BusinessContext => Boolean(item));
	if (memberships.length === 0) return [];

	const businessIds = memberships.map((membership) => membership.business.id);
	let subscriptionClient = supabase;
	try {
		subscriptionClient = await createSupabaseAdminClient('odonto');
	} catch {
		subscriptionClient = supabase;
	}

	const { data: subscriptions, error: subscriptionError } = await subscriptionClient
		.from('business_subscriptions')
		.select(
			'id, business_id, commercial_access_enabled, is_permanent, subscription_status, access_starts_at, paid_until, grace_until, restricted_until, archived_at, last_payment_at, last_payment_amount, last_grant_duration_seconds, expiration_notice_enabled, access_source, access_note, updated_by, created_at, updated_at'
		)
		.in('business_id', businessIds);

	if (subscriptionError) {
		// Compatibility-first fallback: if the migration is not present yet, keep
		// legacy access active instead of locking out existing consultorios.
		console.error('Error cargando suscripciones comerciales', subscriptionError);
		return memberships.map((membership) => applySubscription(membership, null, { legacyFallback: true }));
	}

	const subscriptionByBusinessId = new Map(
		((subscriptions ?? []) as BusinessSubscriptionRow[]).map((subscription) => [
			subscription.business_id,
			subscription
		])
	);

	return memberships.map((membership) =>
		applySubscription(membership, subscriptionByBusinessId.get(membership.business.id) ?? null)
	);
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isDefaultBusinessCreationDisabled = (error: unknown) => {
	const message =
		typeof error === 'object' && error !== null && 'message' in error
			? String((error as { message?: unknown }).message ?? '')
			: String(error ?? '');
	return message.includes('DEFAULT_BUSINESS_CREATION_DISABLED');
};

const reloadMembershipsAfterBootstrap = async (
	supabase: SupabaseClient,
	userId: string
): Promise<BusinessContext[]> => {
	for (const delay of [0, 150, 350]) {
		if (delay > 0) await wait(delay);
		const memberships = await loadMemberships(supabase, userId);
		if (memberships.length > 0) return memberships;
	}
	return [];
};

export const resolveActiveBusiness = async ({
	supabase,
	accessToken,
	cookies,
	ensureDefault = true
}: ResolveBusinessOptions): Promise<BusinessContext | null> => {
	if (env.DEMO_MODE === 'true') return demoBusinessContext();

	const userId = await getAuthUserId(supabase, accessToken);
	if (!userId) return null;

	let memberships = await loadMemberships(supabase, userId);

	if (memberships.length === 0 && ensureDefault) {
		const { error } = await supabase.rpc('ensure_user_default_business', {
			p_name: 'Consultorio',
			p_industry: 'odontology'
		});
		if (error) {
			memberships = await reloadMembershipsAfterBootstrap(supabase, userId);
			if (memberships.length === 0 || !isDefaultBusinessCreationDisabled(error)) {
				throw error;
			}
		} else {
			memberships = await reloadMembershipsAfterBootstrap(supabase, userId);
		}
	}

	const activeBusinessId = cookies?.get(ACTIVE_BUSINESS_COOKIE);
	const selected =
		(activeBusinessId
			? memberships.find((membership) => membership.business.id === activeBusinessId)
			: null) ??
		memberships[0] ??
		null;

	if (selected && cookies) {
		cookies.set(ACTIVE_BUSINESS_COOKIE, selected.business.id, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 365
		});
	}

	return selected;
};
