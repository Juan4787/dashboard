import { env } from '$env/dynamic/private';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type Module = 'odonto' | 'administrativo';

export type AuthTokens = {
	access_token: string;
	refresh_token: string;
};

export const MASTER_EMAIL =
	(env.MASTER_EMAIL ?? 'juanpabloaltamira@protonmail.com').trim().toLowerCase();

const moduleEmails: Record<Module, string | undefined> = {
	odonto: env.SABRINA_EMAIL,
	// administrativo: env.ADMIN_EMAIL
	administrativo: undefined
};

const moduleConfig: Record<
	Module,
	{
		url?: string;
		key?: string;
	}
> = {
	odonto: {
		url: env.ODONTO_SUPABASE_URL,
		key: env.ODONTO_SUPABASE_ANON_KEY
	},
	administrativo: {
		url: env.ADMIN_SUPABASE_URL,
		key: env.ADMIN_SUPABASE_ANON_KEY
	}
};

export const resolveModuleByEmail = (email: string): Module | null => {
	const normalized = email.trim().toLowerCase();
	return (Object.entries(moduleEmails).find(([, value]) => value?.toLowerCase() === normalized)?.[0] ??
		null) as Module | null;
};

export const getModuleEntryRoute = (module: Module) =>
	// Administrativo deshabilitado por ahora.
	// module === 'odonto' ? '/odonto/pacientes' : '/administrativo/expedientes';
	'/odonto/pacientes';

export const isMasterEmail = (email?: string | null) =>
	Boolean(email && email.trim().toLowerCase() === MASTER_EMAIL);

export const createSupabaseServerClient = async (
	module: Module,
	tokens?: AuthTokens | null,
	fetchImpl?: typeof fetch
): Promise<SupabaseClient> => {
	if (env.DEMO_MODE === 'true') {
		throw new Error('Demo mode: Supabase deshabilitado');
	}
	const config = moduleConfig[module];
	if (!config.url || !config.key) {
		throw new Error(`Faltan variables de entorno de Supabase para el módulo ${module}`);
	}

	const supabase = createClient(config.url, config.key, {
		auth: {
			persistSession: false,
			autoRefreshToken: true
		},
		global: {
			headers: { 'X-App-Module': module },
			fetch: fetchImpl
		}
	});

	if (tokens?.access_token && tokens?.refresh_token) {
		await supabase.auth.setSession({
			access_token: tokens.access_token,
			refresh_token: tokens.refresh_token
		});
	}

	return supabase;
};

export const getUserIdFromAccessToken = (accessToken?: string | null): string | null => {
	if (!accessToken) return null;
	const parts = accessToken.split('.');
	if (parts.length < 2) return null;
	const payload = parts[1];
	const normalized = payload
		.replace(/-/g, '+')
		.replace(/_/g, '/')
		.padEnd(Math.ceil(payload.length / 4) * 4, '=');
	try {
		const decoded = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8')) as { sub?: unknown };
		return typeof decoded.sub === 'string' ? decoded.sub : null;
	} catch {
		return null;
	}
};

export const getEmailFromAccessToken = (accessToken?: string | null): string | null => {
	if (!accessToken) return null;
	const parts = accessToken.split('.');
	if (parts.length < 2) return null;
	const payload = parts[1];
	const normalized = payload
		.replace(/-/g, '+')
		.replace(/_/g, '/')
		.padEnd(Math.ceil(payload.length / 4) * 4, '=');
	try {
		const decoded = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8')) as {
			email?: unknown;
		};
		return typeof decoded.email === 'string' ? decoded.email : null;
	} catch {
		return null;
	}
};
