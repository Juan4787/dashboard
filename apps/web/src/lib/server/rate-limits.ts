import { env } from '$env/dynamic/private';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from './supabase';

export const RATE_LIMIT_ACTIONS = [
	'signup_email_by_email',
	'signup_email_by_ip',
	'signup_google_by_ip',
	'login_password_by_email',
	'login_password_by_ip',
	'pending_business_creation_by_user',
	'pending_business_creation_by_ip',
	'mp_subscription_create_by_business'
] as const;

export type RateLimitAction = (typeof RATE_LIMIT_ACTIONS)[number];

type RateLimitRule = {
	action: RateLimitAction;
	subject: string | null | undefined;
	limit: number;
	windowSeconds: number;
	message: string;
};

type RateLimitRpcRow = {
	allowed: boolean;
	used: number;
	retry_after_seconds: number;
};

export class RateLimitExceededError extends Error {
	status = 429;
	retryAfterSeconds: number;
	userMessage: string;

	constructor(message: string, retryAfterSeconds: number) {
		super(message);
		this.name = 'RateLimitExceededError';
		this.userMessage = message;
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

const normalizeSubject = (value: string | null | undefined) => {
	const normalized = String(value ?? '').trim().toLowerCase();
	return normalized || 'unknown';
};

export const hashRateLimitSubject = (value: string | null | undefined) => {
	const salt =
		env.RATE_LIMIT_SALT?.trim() ||
		env.ODONTO_SUPABASE_SERVICE_ROLE_KEY?.trim() ||
		'cita-suite-rate-limit-v1';
	return crypto.createHash('sha256').update(`${salt}:${normalizeSubject(value)}`).digest('hex');
};

const formatRetry = (seconds: number) => {
	if (seconds <= 60) return 'menos de un minuto';
	const minutes = Math.ceil(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.ceil(minutes / 60);
	return `${hours} h`;
};

const consumeRateLimit = async (
	admin: SupabaseClient,
	group: {
		action: RateLimitAction;
		subject: string | null | undefined;
		rules: RateLimitRule[];
	}
): Promise<RateLimitRpcRow> => {
	const { data, error } = await admin.rpc('consume_server_rate_limits' as never, {
		p_action: group.action,
		p_subject_hash: hashRateLimitSubject(group.subject),
		p_windows: group.rules.map((rule) => ({
			limit_count: rule.limit,
			window_seconds: rule.windowSeconds
		}))
	} as never);

	if (error) {
		throw error;
	}

	const row = Array.isArray(data) ? (data[0] as RateLimitRpcRow | undefined) : (data as RateLimitRpcRow | null);
	if (!row || typeof row.allowed !== 'boolean') {
		throw new Error('RATE_LIMIT_INVALID_RESPONSE');
	}
	return row;
};

export const enforceRateLimits = async (
	rules: RateLimitRule[],
	fetchImpl?: typeof fetch
): Promise<void> => {
	if (rules.length === 0 || env.DEMO_MODE === 'true') return;

	const admin = await createSupabaseAdminClient('odonto', fetchImpl);
	const groups = new Map<
		string,
		{ action: RateLimitAction; subject: string | null | undefined; rules: RateLimitRule[] }
	>();
	for (const rule of rules) {
		const key = `${rule.action}:${hashRateLimitSubject(rule.subject)}`;
		const group = groups.get(key) ?? { action: rule.action, subject: rule.subject, rules: [] };
		group.rules.push(rule);
		groups.set(key, group);
	}

	for (const group of groups.values()) {
		const result = await consumeRateLimit(admin, group);
		if (!result.allowed) {
			const rule = group.rules[0];
			throw new RateLimitExceededError(
				`${rule.message} Volvé a intentar en ${formatRetry(result.retry_after_seconds)}.`,
				result.retry_after_seconds
			);
		}
	}
};

const FIFTEEN_MINUTES = 15 * 60;
const ONE_HOUR = 60 * 60;
const ONE_DAY = 24 * ONE_HOUR;

export const signupEmailRateLimitRules = (email: string, ip: string): RateLimitRule[] => [
	{
		action: 'signup_email_by_email',
		subject: email,
		limit: 3,
		windowSeconds: ONE_HOUR,
		message: 'Hay demasiados intentos de registro para este correo.'
	},
	{
		action: 'signup_email_by_email',
		subject: email,
		limit: 8,
		windowSeconds: ONE_DAY,
		message: 'Hay demasiados intentos de registro para este correo.'
	},
	{
		action: 'signup_email_by_ip',
		subject: ip,
		limit: 30,
		windowSeconds: ONE_HOUR,
		message: 'Hay demasiados intentos de registro desde esta conexión.'
	},
	{
		action: 'signup_email_by_ip',
		subject: ip,
		limit: 80,
		windowSeconds: ONE_DAY,
		message: 'Hay demasiados intentos de registro desde esta conexión.'
	}
];

export const googleAuthRateLimitRules = (ip: string): RateLimitRule[] => [
	{
		action: 'signup_google_by_ip',
		subject: ip,
		limit: 50,
		windowSeconds: ONE_HOUR,
		message: 'Hay demasiados intentos con Google desde esta conexión.'
	},
	{
		action: 'signup_google_by_ip',
		subject: ip,
		limit: 120,
		windowSeconds: ONE_DAY,
		message: 'Hay demasiados intentos con Google desde esta conexión.'
	}
];

export const loginPasswordRateLimitRules = (email: string, ip: string): RateLimitRule[] => [
	{
		action: 'login_password_by_email',
		subject: email,
		limit: 5,
		windowSeconds: FIFTEEN_MINUTES,
		message: 'Hay demasiados intentos de ingreso para este correo.'
	},
	{
		action: 'login_password_by_ip',
		subject: ip,
		limit: 40,
		windowSeconds: FIFTEEN_MINUTES,
		message: 'Hay demasiados intentos de ingreso desde esta conexión.'
	}
];

export const pendingBusinessIpRateLimitRules = (ip: string): RateLimitRule[] => [
	{
		action: 'pending_business_creation_by_ip',
		subject: ip,
		limit: 20,
		windowSeconds: ONE_DAY,
		message: 'Hay demasiadas altas pendientes desde esta conexión.'
	}
];

export const mpSubscriptionRateLimitRules = (businessId: string): RateLimitRule[] => [
	{
		action: 'mp_subscription_create_by_business',
		subject: businessId,
		limit: 3,
		windowSeconds: 10 * 60,
		message: 'Hay demasiados intentos de activar la suscripción.'
	},
	{
		action: 'mp_subscription_create_by_business',
		subject: businessId,
		limit: 10,
		windowSeconds: ONE_DAY,
		message: 'Hay demasiados intentos de activar la suscripción.'
	}
];

export const rateLimitFail = (error: unknown, fallbackMessage: string) => {
	if (error instanceof RateLimitExceededError) {
		return { status: error.status, message: error.userMessage };
	}
	console.error(fallbackMessage, error);
	return {
		status: 500,
		message: 'No pudimos validar los límites de seguridad. Probá de nuevo en unos minutos.'
	};
};
