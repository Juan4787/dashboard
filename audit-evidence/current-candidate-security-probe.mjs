import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import WebSocket from '../apps/web/node_modules/ws/index.js';

const root = process.cwd();
const env = {};
for (const raw of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
	const line = raw.trim();
	if (!line || line.startsWith('#')) continue;
	const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
	if (!match) continue;
	let value = match[2].trim();
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
	env[match[1]] = value;
}
Object.assign(env, process.env);

const baseUrl = 'https://app.cita-suite.workers.dev';
const expectedWorkerVersion = process.env.AUDIT_EXPECTED_WORKER_VERSION?.trim() || '985feee';
const supabaseUrl = env.ODONTO_SUPABASE_URL;
const anonKey = env.ODONTO_SUPABASE_ANON_KEY;
if (!supabaseUrl || !anonKey || !env.CITA_SUITE_TEST_EMAIL || !env.CITA_SUITE_TEST_PASSWORD || !env.E2E_MASTER_EMAIL || !env.E2E_MASTER_PASSWORD)
	throw new Error('faltan variables de auditoría requeridas');

const makeClient = () => createClient(supabaseUrl, anonKey, {
	auth: { autoRefreshToken: false, persistSession: false },
	realtime: { transport: WebSocket }
});
const checks = [];
const pass = (name, detail = '') => { checks.push(true); console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`); };
const fail = (name, detail = '') => { checks.push(false); console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); };

const signIn = async (email, password) => {
	const client = makeClient();
	const result = await client.auth.signInWithPassword({ email, password });
	if (result.error || !result.data.session) throw result.error ?? new Error('login de sonda falló');
	return result.data.session.access_token;
};

const rest = async (pathname, token, body) => {
	const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
		method: 'POST',
		headers: {
			apikey: anonKey,
			Authorization: `Bearer ${token ?? anonKey}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify(body ?? {})
	});
	return { status: response.status, text: (await response.text()).slice(0, 240) };
};

const anonymous = makeClient();
const anonymousRows = await anonymous.from('allowed_emails').select('id').limit(1);
if (anonymousRows.error && [401, 403].includes(Number(anonymousRows.error.code)) || (anonymousRows.error && /permission|denied|not authorized/i.test(anonymousRows.error.message ?? '')))
	pass('allowed_emails anónimo rechazado');
else if (!anonymousRows.error && (anonymousRows.data ?? []).length === 0)
	pass('allowed_emails anónimo sin filas');
else fail('allowed_emails anónimo', anonymousRows.error?.message ?? `rowCount=${anonymousRows.data?.length ?? null}`);

const testToken = await signIn(env.CITA_SUITE_TEST_EMAIL, env.CITA_SUITE_TEST_PASSWORD);
const testClient = makeClient();
await testClient.auth.setSession({ access_token: testToken, refresh_token: 'audit-unused-refresh-token' });
const testRows = await testClient.from('allowed_emails').select('id').limit(5);
if (!testRows.error && (testRows.data ?? []).length === 0) pass('allowed_emails usuario autenticado sin filas');
else fail('allowed_emails usuario autenticado', testRows.error?.message ?? `rowCount=${testRows.data?.length ?? null}`);

const masterToken = await signIn(env.E2E_MASTER_EMAIL, env.E2E_MASTER_PASSWORD);
const masterClient = makeClient();
await masterClient.auth.setSession({ access_token: masterToken, refresh_token: 'audit-unused-refresh-token' });
const masterRows = await masterClient.from('allowed_emails').select('id').limit(5);
if (!masterRows.error && (masterRows.data ?? []).length > 0) pass('allowed_emails maestro conserva lectura autorizada', `rows=${masterRows.data.length}`);
else fail('allowed_emails maestro', masterRows.error?.message ?? `rowCount=${masterRows.data?.length ?? null}`);

const expiredAnonymous = await rest('rpc/expire_public_booking_holds', null);
if (expiredAnonymous.status === 401 || expiredAnonymous.status === 403) pass('RPC legado anónimo rechazado', `HTTP ${expiredAnonymous.status}`);
else fail('RPC legado anónimo', `HTTP ${expiredAnonymous.status}`);
const expiredTest = await rest('rpc/expire_public_booking_holds', testToken);
if (expiredTest.status === 401 || expiredTest.status === 403) pass('RPC legado autenticado rechazado', `HTTP ${expiredTest.status}`);
else fail('RPC legado autenticado', `HTTP ${expiredTest.status}`);

const versionResponse = await fetch(`${baseUrl}/_app/version.json`, { headers: { 'cache-control': 'no-cache' } });
const versionBody = await versionResponse.json().catch(() => ({}));
if (versionResponse.status === 200 && versionBody.version === expectedWorkerVersion) pass('Worker atiende el candidato esperado', `version=${versionBody.version}`);
else fail('Worker versión candidata', `HTTP ${versionResponse.status} version=${String(versionBody.version ?? '')}`);

const failed = checks.filter((ok) => !ok).length;
console.log(`SUMMARY passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exitCode = 1;
