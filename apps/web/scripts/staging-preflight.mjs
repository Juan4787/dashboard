#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REQUIRED_ENV = [
	'ODONTO_SUPABASE_URL',
	'ODONTO_SUPABASE_ANON_KEY',
	'ODONTO_SUPABASE_SERVICE_ROLE_KEY',
	'PUBLIC_ODONTO_SUPABASE_URL',
	'PUBLIC_ODONTO_SUPABASE_ANON_KEY',
	'PUBLIC_SITE_URL',
	'INTERNAL_JOB_SECRET',
	'WHATSAPP_VERIFY_TOKEN',
	'DEMO_MODE',
	'MASTER_EMAIL'
];

const RECOMMENDED_ENV = [
	'ADMIN_SUPABASE_URL',
	'ADMIN_SUPABASE_ANON_KEY',
	'ADMIN_SUPABASE_SERVICE_ROLE_KEY',
	'PUBLIC_TURNSTILE_SITE_KEY',
	'TURNSTILE_SECRET_KEY',
	'WHATSAPP_APP_SECRET',
	'WHATSAPP_ACCESS_TOKEN',
	'WHATSAPP_GRAPH_API_VERSION'
];

const SECRET_KEYS = new Set([
	'ODONTO_SUPABASE_ANON_KEY',
	'ODONTO_SUPABASE_SERVICE_ROLE_KEY',
	'ADMIN_SUPABASE_ANON_KEY',
	'ADMIN_SUPABASE_SERVICE_ROLE_KEY',
	'PUBLIC_ODONTO_SUPABASE_ANON_KEY',
	'TURNSTILE_SECRET_KEY',
	'PUBLIC_TURNSTILE_SITE_KEY',
	'INTERNAL_JOB_SECRET',
	'WHATSAPP_VERIFY_TOKEN',
	'WHATSAPP_APP_SECRET',
	'WHATSAPP_ACCESS_TOKEN'
]);

const PLACEHOLDER_PARTS = ['your-', 'xxxxx', 'odonto-anon-key', 'odonto-service-role-key', 'admin-anon-key', 'admin-service-role-key'];

const REQUIRED_FILES = [
	'supabase/migrations/20251231000000_existing_odonto_base.sql',
	'supabase/migrations/20260513000000_multi_tenant_base.sql',
	'supabase/migrations/20260513010000_agenda_core.sql',
	'supabase/migrations/20260513020000_panel_operational_hardening.sql',
	'supabase/migrations/20260513030000_public_booking.sql',
	'supabase/migrations/20260513040000_whatsapp_messaging.sql',
	'apps/web/src/routes/reservar/[businessSlug]/+page.server.ts',
	'apps/web/src/routes/reservar/[businessSlug]/+page.svelte',
	'apps/web/src/routes/turno/[token]/+page.server.ts',
	'apps/web/src/routes/turno/[token]/+page.svelte',
	'apps/web/src/routes/confirmar/[token]/+page.server.ts',
	'apps/web/src/routes/cancelar/[token]/+page.server.ts',
	'apps/web/src/routes/reprogramar/[token]/+page.server.ts',
	'apps/web/src/routes/api/whatsapp/webhook/+server.ts',
	'apps/web/src/routes/internal/jobs/generate-reminder-dispatches/+server.ts',
	'apps/web/src/routes/internal/jobs/process-message-dispatches/+server.ts',
	'apps/web/src/routes/odonto/configuracion/whatsapp/+page.server.ts',
	'apps/web/src/routes/odonto/configuracion/whatsapp/+page.svelte',
	'apps/web/src/routes/odonto/mensajes/+page.server.ts',
	'apps/web/src/routes/odonto/mensajes/+page.svelte',
	'apps/web/src/routes/odonto/recordatorios/+page.server.ts',
	'apps/web/src/routes/odonto/recordatorios/+page.svelte',
	'apps/web/src/lib/server/public-booking.ts',
	'apps/web/src/lib/server/public-appointments.ts',
	'apps/web/src/lib/server/messaging.ts',
	'apps/web/src/lib/server/internal-jobs.ts'
];

const REQUIRED_REMOTE_TABLES = [
	'allowed_emails',
	'businesses',
	'business_users',
	'professionals',
	'professional_users',
	'services',
	'professional_services',
	'availability_rules',
	'availability_exceptions',
	'patients',
	'appointments',
	'audit_logs',
	'public_booking_attempts',
	'messaging_accounts',
	'message_templates',
	'message_dispatches',
	'inbound_messages',
	'whatsapp_webhook_events'
];

const args = new Set(process.argv.slice(2));
const shouldCheckRemote = args.has('--remote');

const log = (message = '') => console.log(message);
const ok = (message) => log(`[OK] ${message}`);
const warn = (message) => log(`[WARN] ${message}`);
const failLine = (message) => log(`[FAIL] ${message}`);

const findRepoRoot = (start) => {
	let current = path.resolve(start);
	while (current !== path.dirname(current)) {
		if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
		current = path.dirname(current);
	}
	return path.resolve(start);
};

const parseEnvFile = (filePath) => {
	if (!fs.existsSync(filePath)) return {};
	const result = {};
	const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const index = trimmed.indexOf('=');
		if (index === -1) continue;
		const key = trimmed.slice(0, index).trim();
		let value = trimmed.slice(index + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		result[key] = value;
	}
	return result;
};

const repoRoot = findRepoRoot(process.cwd());
const envPath = path.join(repoRoot, '.env');
const envFile = parseEnvFile(envPath);
const env = { ...envFile, ...process.env };

const valueOf = (key) => String(env[key] ?? '').trim();
const isMissing = (key) => valueOf(key).length === 0;
const isPlaceholder = (key) => {
	const value = valueOf(key).toLowerCase();
	return Boolean(value && PLACEHOLDER_PARTS.some((part) => value.includes(part)));
};

const describeValue = (key) => {
	const value = valueOf(key);
	if (!value) return 'missing';
	if (key.endsWith('_URL') || key === 'PUBLIC_SITE_URL') {
		try {
			return new URL(value).origin;
		} catch {
			return 'invalid-url';
		}
	}
	if (key === 'DEMO_MODE' || key === 'MASTER_EMAIL') return value;
	if (SECRET_KEYS.has(key)) return `set (${value.length} chars)`;
	return 'set';
};

const validateUrl = (key, failures) => {
	const value = valueOf(key);
	if (!value) return;
	try {
		new URL(value);
	} catch {
		failures.push(`${key} is not a valid URL`);
	}
};

const main = async () => {
	const failures = [];
	const warnings = [];

	log('Staging preflight for Bloque 3.5 / Bloque 4');
	log(`Repo root: ${repoRoot}`);
	log(`Env file: ${fs.existsSync(envPath) ? envPath : 'missing .env'}`);
	log(`Remote DB check: ${shouldCheckRemote ? 'enabled' : 'disabled (use --remote)'}`);
	log('');

	log('Required files');
	for (const relative of REQUIRED_FILES) {
		const exists = fs.existsSync(path.join(repoRoot, relative));
		if (exists) ok(relative);
		else {
			failLine(relative);
			failures.push(`Missing file: ${relative}`);
		}
	}

	log('');
	log('Required env');
	for (const key of REQUIRED_ENV) {
		if (isMissing(key)) {
			failLine(`${key}: missing`);
			failures.push(`${key} is missing`);
			continue;
		}
		if (isPlaceholder(key)) {
			failLine(`${key}: placeholder value`);
			failures.push(`${key} still has a placeholder value`);
			continue;
		}
		ok(`${key}: ${describeValue(key)}`);
	}

	log('');
	log('Recommended env');
	for (const key of RECOMMENDED_ENV) {
		if (isMissing(key)) {
			warn(`${key}: missing`);
			warnings.push(`${key} is missing`);
			continue;
		}
		if (isPlaceholder(key)) {
			warn(`${key}: placeholder value`);
			warnings.push(`${key} still has a placeholder value`);
			continue;
		}
		ok(`${key}: ${describeValue(key)}`);
	}

	validateUrl('ODONTO_SUPABASE_URL', failures);
	validateUrl('PUBLIC_ODONTO_SUPABASE_URL', failures);
	validateUrl('PUBLIC_SITE_URL', failures);

	if (valueOf('DEMO_MODE') !== 'false') {
		failures.push('DEMO_MODE must be false for staging');
		failLine('DEMO_MODE must be false for staging');
	}

	if (valueOf('ODONTO_SUPABASE_URL') && valueOf('PUBLIC_ODONTO_SUPABASE_URL') && valueOf('ODONTO_SUPABASE_URL') !== valueOf('PUBLIC_ODONTO_SUPABASE_URL')) {
		warnings.push('ODONTO_SUPABASE_URL and PUBLIC_ODONTO_SUPABASE_URL do not match');
		warn('ODONTO_SUPABASE_URL and PUBLIC_ODONTO_SUPABASE_URL do not match');
	}

	if (valueOf('ODONTO_SUPABASE_ANON_KEY') && valueOf('PUBLIC_ODONTO_SUPABASE_ANON_KEY') && valueOf('ODONTO_SUPABASE_ANON_KEY') !== valueOf('PUBLIC_ODONTO_SUPABASE_ANON_KEY')) {
		warnings.push('ODONTO_SUPABASE_ANON_KEY and PUBLIC_ODONTO_SUPABASE_ANON_KEY do not match');
		warn('ODONTO_SUPABASE_ANON_KEY and PUBLIC_ODONTO_SUPABASE_ANON_KEY do not match');
	}

	if (valueOf('ODONTO_SUPABASE_ANON_KEY') && valueOf('ODONTO_SUPABASE_ANON_KEY') === valueOf('ODONTO_SUPABASE_SERVICE_ROLE_KEY')) {
		failures.push('Anon key and service role key must not be the same');
		failLine('Anon key and service role key must not be the same');
	}

	if (valueOf('PUBLIC_SITE_URL').includes('localhost') || valueOf('PUBLIC_SITE_URL').includes('127.0.0.1')) {
		warnings.push('PUBLIC_SITE_URL points to localhost; OK for local, not OK for deployed staging');
		warn('PUBLIC_SITE_URL points to localhost; OK for local, not OK for deployed staging');
	}

	const hasTurnstileSite = Boolean(valueOf('PUBLIC_TURNSTILE_SITE_KEY'));
	const hasTurnstileSecret = Boolean(valueOf('TURNSTILE_SECRET_KEY'));
	if (hasTurnstileSite !== hasTurnstileSecret) {
		failures.push('Turnstile must set both PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY, or neither');
		failLine('Turnstile must set both PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY, or neither');
	}

	if (shouldCheckRemote && failures.length === 0) {
		log('');
		log('Remote Supabase schema');
		const restBaseUrl = `${valueOf('ODONTO_SUPABASE_URL').replace(/\/$/, '')}/rest/v1`;
		const serviceRoleKey = valueOf('ODONTO_SUPABASE_SERVICE_ROLE_KEY');
		for (const table of REQUIRED_REMOTE_TABLES) {
			const response = await fetch(`${restBaseUrl}/${table}?select=id&limit=1`, {
				headers: {
					apikey: serviceRoleKey,
					Authorization: `Bearer ${serviceRoleKey}`,
					Accept: 'application/json'
				}
			});
			if (!response.ok) {
				const detail = await response.text().catch(() => '');
				failLine(`${table}: HTTP ${response.status}${detail ? ` - ${detail.slice(0, 180)}` : ''}`);
				failures.push(`Remote table check failed for ${table}: HTTP ${response.status}`);
			} else {
				ok(`${table}`);
			}
		}
	} else if (shouldCheckRemote) {
		warn('Skipping remote Supabase schema check because env/file checks failed first');
	}

	log('');
	log('Summary');
	log(`Failures: ${failures.length}`);
	log(`Warnings: ${warnings.length}`);
	if (warnings.length > 0) {
		for (const item of warnings) warn(item);
	}
	if (failures.length > 0) {
		for (const item of failures) failLine(item);
		process.exitCode = 1;
		return;
	}
	ok('Preflight passed');
};

main().catch((error) => {
	failLine(error?.message ?? String(error));
	process.exitCode = 1;
});
