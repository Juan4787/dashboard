import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuthUserId } from './supabase';

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
		logo_url: null,
		timezone: 'America/Argentina/Cordoba',
		public_booking_enabled: true,
		whatsapp_enabled: false,
		allow_same_day_booking: false,
		min_booking_notice_minutes: 1440,
		max_booking_days_ahead: 60,
		cancellation_policy: null,
		is_active: true
	},
	role: 'owner',
	canManage: true,
	canOperate: true
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
	return {
		business: business as Business,
		role,
		canManage: canManageRole(role),
		canOperate: canOperateRole(role)
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

	return (data ?? []).map(mapMembership).filter((item): item is BusinessContext => Boolean(item));
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
			throw error;
		}
		memberships = await loadMemberships(supabase, userId);
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
