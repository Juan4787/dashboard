import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { createSupabaseAdminClient, getAuthUserId } from './supabase';
import {
	getBusinessAccessState,
	type BusinessAccessState,
	type BusinessSubscriptionRow
} from './commercial-access';
import { enforceRateLimits, pendingBusinessIpRateLimitRules } from './rate-limits';
import { isEmailAlreadyAssociatedWithOtherBusinessError } from './business-email-association';

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
	assistance?: BusinessAssistanceContext | null;
};

export type BusinessAssistanceContext = {
	grantId: string;
	requestedByUserId: string;
	supportUserId: string;
	startsAt: string;
	expiresAt: string;
};

export const ACTIVE_BUSINESS_COOKIE = 'active-business-id';

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
	defaultBusinessCreationIp?: string | null;
	fetch?: typeof fetch;
	membershipCache?: 'fresh' | 'short';
};

type BusinessContextRpcRow = {
	business?: Business | null;
	role?: string | null;
	assistance?: BusinessAssistanceContext | null;
	subscription?: BusinessSubscriptionRow | null;
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
		access,
		assistance: null
	};
};

const mapAssistanceMembership = (row: any): BusinessContext | null => {
	const business = row?.business;
	if (!business || !row?.id || !row?.support_user_id || !row?.requested_by_user_id) return null;
	const access = getBusinessAccessState(null, { businessCreatedAt: business.created_at });
	return {
		business: business as Business,
		role: 'admin',
		canManage: access.canUseBusiness,
		canOperate: access.canUseBusiness,
		access,
		assistance: {
			grantId: String(row.id),
			requestedByUserId: String(row.requested_by_user_id),
			supportUserId: String(row.support_user_id),
			startsAt: String(row.starts_at ?? ''),
			expiresAt: String(row.expires_at ?? '')
		}
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

const mapRpcMembership = (row: BusinessContextRpcRow): BusinessContext | null => {
	const business = row.business;
	const role = String(row.role ?? '');
	if (!business || !isBusinessRole(role)) return null;
	const assistance = row.assistance ?? null;
	const base = assistance
		? mapAssistanceMembership({
				id: assistance.grantId,
				requested_by_user_id: assistance.requestedByUserId,
				support_user_id: assistance.supportUserId,
				starts_at: assistance.startsAt,
				expires_at: assistance.expiresAt,
				business
			})
		: mapMembership({ role, business });
	return base ? applySubscription(base, row.subscription ?? null) : null;
};

const isMissingAssistanceSchemaError = (error: unknown) => {
	const message = errorMessage(error).toLowerCase();
	const code =
		typeof error === 'object' && error !== null && 'code' in error
			? String((error as { code?: unknown }).code ?? '')
			: '';
	return (
		code === '42P01' ||
		code === 'PGRST205' ||
		message.includes('account_assistance_grants') ||
		message.includes('could not find the table')
	);
};

const loadAssistanceMemberships = async (
	supabase: SupabaseClient,
	userId: string,
	directBusinessIds: Set<string>
): Promise<BusinessContext[]> => {
	try {
		const { data, error } = await supabase
			.from('account_assistance_grants')
			.select(
				`id, business_id, requested_by_user_id, support_user_id, status, starts_at, expires_at, business:businesses!inner(${businessSelect})`
			)
			.eq('support_user_id', userId)
			.eq('status', 'active')
			.is('revoked_at', null)
			.gt('expires_at', new Date().toISOString())
			.order('expires_at', { ascending: false });

		if (error) {
			if (!isMissingAssistanceSchemaError(error)) {
				console.error('Error cargando ayuda para configurar', error);
			}
			return [];
		}

			const activeRows = [];
			for (const row of data ?? []) {
				const businessId = String(row?.business_id ?? '');
				if (!businessId || directBusinessIds.has(businessId)) continue;
				const { data: hasActiveGrant, error: activeGrantError } = await supabase.rpc(
					'user_has_active_account_assistance',
					{ target_business_id: businessId }
				);
				if (activeGrantError) {
					console.error('Error validando ayuda para configurar', activeGrantError);
					continue;
				}
				if (hasActiveGrant === true) activeRows.push(row);
			}

			return activeRows
				.map(mapAssistanceMembership)
				.filter((item): item is BusinessContext => Boolean(item));
	} catch (error) {
		if (!isMissingAssistanceSchemaError(error)) {
			console.error('Error cargando ayuda para configurar', error);
		}
		return [];
	}
};

const loadMembershipsLegacy = async (
	supabase: SupabaseClient,
	userId: string
): Promise<BusinessContext[]> => {
	const { data, error } = await supabase
		.from('business_users')
		.select(`role, business:businesses!inner(${businessSelect})`)
		.eq('user_id', userId)
		.eq('status', 'active')
		.order('created_at', { ascending: true });

	if (error) {
		throw error;
	}

	const directMemberships = (data ?? [])
		.map(mapMembership)
		.filter((item): item is BusinessContext => Boolean(item));
	const assistanceMemberships = await loadAssistanceMemberships(
		supabase,
		userId,
		new Set(directMemberships.map((membership) => membership.business.id))
	);
	const memberships = [...directMemberships, ...assistanceMemberships];
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

const isMissingBusinessContextsRpcError = (error: unknown) => {
	const message = errorMessage(error).toLowerCase();
	const code =
		typeof error === 'object' && error !== null && 'code' in error
			? String((error as { code?: unknown }).code ?? '')
			: '';
	return (
		code === '42883' ||
		code === 'PGRST202' ||
		message.includes('list_user_business_contexts') ||
		message.includes('could not find the function')
	);
};

const loadMemberships = async (
	supabase: SupabaseClient,
	userId: string
): Promise<BusinessContext[]> => {
	const { data, error } = await supabase.rpc('list_user_business_contexts');
	if (!error) {
		return ((data ?? []) as BusinessContextRpcRow[])
			.map(mapRpcMembership)
			.filter((item): item is BusinessContext => Boolean(item));
	}
	if (!isMissingBusinessContextsRpcError(error)) throw error;
	return loadMembershipsLegacy(supabase, userId);
};

type MembershipsByRequestEntry = {
	pending: Promise<BusinessContext[]>;
	// A shared short read can be up to 12 seconds old. A security-sensitive
	// child load in the same SvelteKit request must still be able to bypass it.
	source: 'fresh' | 'shared-short';
};
const membershipsByRequest = new WeakMap<object, MembershipsByRequestEntry>();

const MEMBERSHIP_READ_CACHE_TTL_MS = 12_000;
const MEMBERSHIP_READ_CACHE_MAX_ENTRIES = 500;
type MembershipReadCacheEntry = {
	expiresAt: number;
	pending: Promise<BusinessContext[]>;
};
const membershipReadCache = new Map<string, MembershipReadCacheEntry>();

const membershipReadCacheKey = (userId: string, accessToken?: string | null) =>
	createHash('sha256')
		.update(`${userId}:${accessToken ?? ''}`)
		.digest('base64url');

const removeOldestMembershipReadCacheEntry = () => {
	const oldestKey = membershipReadCache.keys().next().value;
	if (typeof oldestKey === 'string') membershipReadCache.delete(oldestKey);
};

const rememberMembershipRead = (
	key: string,
	pending: Promise<BusinessContext[]>,
	now = Date.now()
) => {
	if (membershipReadCache.size >= MEMBERSHIP_READ_CACHE_MAX_ENTRIES && !membershipReadCache.has(key)) {
		removeOldestMembershipReadCacheEntry();
	}

	const guarded = pending.then(
		(memberships) => {
			// Una lista vacía puede activar el alta inicial y no debe sobrevivir entre requests.
			if (
				memberships.length === 0 &&
				membershipReadCache.get(key)?.pending === guarded
			) {
				membershipReadCache.delete(key);
			}
			return memberships;
		},
		(error) => {
			if (membershipReadCache.get(key)?.pending === guarded) membershipReadCache.delete(key);
			throw error;
		}
	);
	membershipReadCache.set(key, {
		expiresAt: now + MEMBERSHIP_READ_CACHE_TTL_MS,
		pending: guarded
	});
	return guarded;
};

const getFreshMembershipRead = (key: string, now = Date.now()) => {
	const cached = membershipReadCache.get(key);
	if (!cached) return null;
	if (cached.expiresAt <= now) {
		membershipReadCache.delete(key);
		return null;
	}
	// Reinsertar mantiene un límite LRU sencillo sin conservar datos más allá del TTL original.
	membershipReadCache.delete(key);
	membershipReadCache.set(key, cached);
	return cached.pending;
};

export const clearBusinessMembershipReadCache = () => membershipReadCache.clear();

const loadMembershipsForRequest = (
	supabase: SupabaseClient,
	userId: string,
	requestKey?: object,
	readCacheKey?: string
) => {
	if (readCacheKey) {
		const shared = getFreshMembershipRead(readCacheKey);
		if (shared) {
			if (requestKey) {
				membershipsByRequest.set(requestKey, { pending: shared, source: 'shared-short' });
			}
			return shared;
		}
	}

	const cached = requestKey ? membershipsByRequest.get(requestKey) : null;
	if (cached && (readCacheKey || cached.source === 'fresh')) {
		return readCacheKey
			? rememberMembershipRead(readCacheKey, cached.pending)
			: cached.pending;
	}

	const loaded = loadMemberships(supabase, userId);
	const pending = readCacheKey ? rememberMembershipRead(readCacheKey, loaded) : loaded;
	const guarded = pending.catch((error) => {
		if (requestKey && membershipsByRequest.get(requestKey)?.pending === guarded) {
			membershipsByRequest.delete(requestKey);
		}
		throw error;
	});
	if (requestKey) membershipsByRequest.set(requestKey, { pending: guarded, source: 'fresh' });
	return guarded;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const errorMessage = (error: unknown) =>
	typeof error === 'object' && error !== null && 'message' in error
		? String((error as { message?: unknown }).message ?? '')
		: String(error ?? '');

export const isDefaultBusinessCreationDisabledError = (error: unknown) =>
	errorMessage(error).includes('DEFAULT_BUSINESS_CREATION_DISABLED');

export const isDefaultBusinessPendingManualSetupError = (error: unknown) =>
	errorMessage(error).includes('DEFAULT_BUSINESS_PENDING_MANUAL_SETUP');

const isRecoverableDefaultBusinessBootstrapRace = (error: unknown) =>
	isDefaultBusinessCreationDisabledError(error) ||
	isDefaultBusinessPendingManualSetupError(error) ||
	isEmailAlreadyAssociatedWithOtherBusinessError(error);

const reloadMembershipsAfterBootstrap = async (
	supabase: SupabaseClient,
	userId: string,
	requestKey?: object
): Promise<BusinessContext[]> => {
	if (requestKey) membershipsByRequest.delete(requestKey);
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
	ensureDefault = true,
	defaultBusinessCreationIp,
	fetch,
	membershipCache = 'fresh'
}: ResolveBusinessOptions): Promise<BusinessContext | null> => {
	if (env.DEMO_MODE === 'true') return demoBusinessContext();

	const userId = await getAuthUserId(supabase, accessToken);
	if (!userId) return null;

	const requestKey = cookies as unknown as object | undefined;
	const readCacheKey =
		membershipCache === 'short' ? membershipReadCacheKey(userId, accessToken) : undefined;
	let memberships = await loadMembershipsForRequest(supabase, userId, requestKey, readCacheKey);
	const now = Date.now();
	memberships = memberships.filter((membership) => {
		if (!membership.assistance) return true;
		const startsAt = Date.parse(membership.assistance.startsAt);
		const expiresAt = Date.parse(membership.assistance.expiresAt);
		return Number.isFinite(startsAt) && Number.isFinite(expiresAt) && startsAt <= now && expiresAt > now;
	});

	if (memberships.length === 0 && ensureDefault) {
		if (defaultBusinessCreationIp) {
			await enforceRateLimits(pendingBusinessIpRateLimitRules(defaultBusinessCreationIp), fetch);
		}
		const { error } = await supabase.rpc('ensure_user_default_business', {
			p_name: 'Consultorio',
			p_industry: 'odontology'
		});
		if (error) {
			memberships = await reloadMembershipsAfterBootstrap(supabase, userId, requestKey);
			if (memberships.length === 0 || !isRecoverableDefaultBusinessBootstrapRace(error)) {
				throw error;
			}
		} else {
			memberships = await reloadMembershipsAfterBootstrap(supabase, userId, requestKey);
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
