import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import WebSocket from '../apps/web/node_modules/ws/index.js';
import { chromium } from '../apps/web/node_modules/@playwright/test/index.mjs';

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

const admin = createClient(env.ODONTO_SUPABASE_URL, env.ODONTO_SUPABASE_SERVICE_ROLE_KEY, {
	auth: { autoRefreshToken: false, persistSession: false },
	realtime: { transport: WebSocket }
});
const baseUrl = process.env.CITA_SUITE_E2E_BASE_URL?.trim() || 'https://cita.suite.workers.dev';
const marker = `NACM_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const email = `audit-null-accepted-${marker.toLowerCase()}@example.invalid`;
const password = `Nn!${randomUUID()}z`;
let userId = null;
let businessId = null;
let browser;
const checks = [];
const pass = (name, detail = '') => { checks.push(true); console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`); };
const fail = (name, detail = '') => { checks.push(false); console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); };
const insertOne = async (table, row) => {
	const { data, error } = await admin.from(table).insert(row).select().single();
	if (error) throw new Error(`${table}: ${error.message}`);
	return data;
};

try {
	const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
	if (created.error || !created.data.user) throw created.error || new Error('auth user creation failed');
	userId = created.data.user.id;
	const business = await insertOne('businesses', {
		name: `${marker} Consultorio`, slug: `${marker.toLowerCase()}-business`, industry: 'odontology', timezone: 'America/Argentina/Cordoba', public_booking_enabled: true,
		allow_same_day_booking: true, min_booking_notice_minutes: 0, max_booking_days_ahead: 90
	});
	businessId = business.id;
	const { error: subscriptionError } = await admin.from('business_subscriptions').update({ commercial_access_enabled: true, is_permanent: true, subscription_status: 'active', paid_until: null, grace_until: null, restricted_until: null, archived_at: null }).eq('business_id', businessId);
	if (subscriptionError) throw subscriptionError;
	// Deliberately attempt the former unsafe shape. The current database must
	// reject it; this is synthetic test data only.
	let rejectedNullMembership = null;
	try {
		await insertOne('business_users', { business_id: businessId, user_id: userId, role: 'owner', status: 'active', accepted_at: null });
	} catch (error) {
		rejectedNullMembership = String(error?.message ?? error);
	}
	console.log(`NULL_MEMBERSHIP_REJECTION ${JSON.stringify({ rejected: Boolean(rejectedNullMembership), constraint: rejectedNullMembership?.includes('business_users_active_requires_accepted_at') ?? false })}`);
	if (rejectedNullMembership?.includes('business_users_active_requires_accepted_at')) pass('La base rechaza membresías active sin accepted_at'); else fail('La base rechaza membresías active sin accepted_at', rejectedNullMembership ?? 'insert unexpectedly succeeded');
	await insertOne('business_users', { business_id: businessId, user_id: userId, role: 'owner', status: 'active', accepted_at: new Date().toISOString() });
	const service = await insertOne('services', { business_id: businessId, name: `${marker} Servicio`, duration_minutes: 30, is_public: true, is_active: true });
	const userClient = createClient(env.ODONTO_SUPABASE_URL, env.ODONTO_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: WebSocket } });
	const signIn = await userClient.auth.signInWithPassword({ email, password });
	if (signIn.error) throw signIn.error;
	const { data: contexts, error: contextError } = await userClient.rpc('list_user_business_contexts');
	console.log(`CONTEXT_RPC ${JSON.stringify({ count: contexts?.length ?? null, contextHasMarker: JSON.stringify(contexts ?? []).includes(marker), error: contextError?.message ?? null })}`);
	if (!contextError && (contexts ?? []).length === 1 && JSON.stringify(contexts).includes(marker)) pass('RPC de contexto sólo expone membresía aceptada'); else fail('RPC de contexto sólo expone membresía aceptada', contextError?.message ?? JSON.stringify(contexts));
	const { data: visibleServices, error: serviceError } = await userClient.from('services').select('id,name').eq('business_id', businessId);
	console.log(`RLS_SERVICE_QUERY ${JSON.stringify({ count: visibleServices?.length ?? null, names: visibleServices?.map((row) => row.name) ?? [], error: serviceError?.message ?? null })}`);
	if (!serviceError && (visibleServices ?? []).length === 1 && visibleServices[0]?.name?.includes(marker)) pass('RLS permite los datos al owner aceptado'); else fail('RLS permite los datos al owner aceptado', serviceError?.message ?? JSON.stringify(visibleServices));
	browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ baseURL: baseUrl });
	const page = await context.newPage();
	await page.goto('/login', { waitUntil: 'domcontentloaded' });
	await page.getByLabel('Correo electrónico').fill(email);
	await page.getByLabel('Contraseña').fill(password);
	await page.locator('form').getByRole('button', { name: 'Ingresar', exact: true }).click();
	await page.waitForURL(/\/odonto(?:\/agenda)?(?:\?|$)/, { timeout: 20_000 });
	await page.goto('/odonto/agenda', { waitUntil: 'domcontentloaded' });
	const body = await page.locator('body').innerText().catch(() => '');
	console.log(`AGENDA_SHELL ${JSON.stringify({ url: page.url(), hasMarker: body.includes(marker), body: body.slice(0, 700).replace(/\s+/g, ' ') })}`);
	if (body.includes(marker) && page.url().includes('/odonto/agenda')) pass('Worker muestra shell coherente para owner aceptado'); else fail('Worker muestra shell coherente para owner aceptado', page.url());
	await context.close();
} finally {
	if (browser) await browser.close().catch(() => {});
	if (businessId) await admin.from('businesses').delete().eq('id', businessId);
	if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
}
const failed = checks.filter((ok) => !ok).length;
console.log(`SUMMARY passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exitCode = 1;
