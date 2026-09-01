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
Object.assign(env, process.env);

const admin = createClient(env.ODONTO_SUPABASE_URL, env.ODONTO_SUPABASE_SERVICE_ROLE_KEY, {
	auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: WebSocket }
});
const marker = `FULINK_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const password = `Ll!${randomUUID()}z`;
const ownerEmail = `audit-follow-link-owner-${marker.toLowerCase()}@example.invalid`;
const professionalEmail = `audit-follow-link-prof-${marker.toLowerCase()}@example.invalid`;
const baseUrl = process.env.CITA_SUITE_E2E_BASE_URL?.trim() || 'https://cita.suite.workers.dev';
const followUpMessage = `${marker} Seguimiento`;
const checks = [];
const pass = (name, detail = '') => { checks.push(true); console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`); };
const fail = (name, detail = '') => { checks.push(false); console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); };
const insertOne = async (table, row) => {
	const { data, error } = await admin.from(table).insert(row).select().single();
	if (error) throw new Error(`${table}: ${error.message}`);
	return data;
};

let ownerId = null;
let professionalUserId = null;
let businessId = null;
let professionalId = null;
let patientId = null;
let followUpId = null;
let browser;
try {
	const owner = await admin.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true });
	if (owner.error || !owner.data.user) throw owner.error ?? new Error('owner creation failed');
	ownerId = owner.data.user.id;
	const professional = await admin.auth.admin.createUser({ email: professionalEmail, password, email_confirm: true });
	if (professional.error || !professional.data.user) throw professional.error ?? new Error('professional creation failed');
	professionalUserId = professional.data.user.id;
	const business = await insertOne('businesses', {
		name: `${marker} Consultorio`, slug: `${marker.toLowerCase()}-business`, industry: 'odontology',
		timezone: 'America/Argentina/Cordoba', public_booking_enabled: true, allow_same_day_booking: true,
		min_booking_notice_minutes: 0, max_booking_days_ahead: 90
	});
	businessId = business.id;
	const { error: subscriptionError } = await admin.from('business_subscriptions').update({
		commercial_access_enabled: true, is_permanent: true, subscription_status: 'active',
		paid_until: null, grace_until: null, restricted_until: null, archived_at: null
	}).eq('business_id', businessId);
	if (subscriptionError) throw subscriptionError;
	await insertOne('business_users', { business_id: businessId, user_id: ownerId, role: 'owner', status: 'active', accepted_at: new Date().toISOString() });
	await insertOne('business_users', { business_id: businessId, user_id: professionalUserId, role: 'professional', status: 'active', accepted_at: new Date().toISOString() });
	const prof = await insertOne('professionals', { business_id: businessId, name: `${marker} Profesional`, email: professionalEmail, is_public: true, is_active: true });
	professionalId = prof.id;
	await insertOne('professional_users', { business_id: businessId, professional_id: professionalId, user_id: professionalUserId });
	const patient = await insertOne('patients', { business_id: businessId, owner_id: ownerId, full_name: `${marker} Paciente`, phone: '+5491100000000', phone_raw: '+54 9 11 0000-0000', phone_e164: '+5491100000000' });
	patientId = patient.id;
	await insertOne('professional_patient_links', { business_id: businessId, professional_id: professionalId, patient_id: patientId, source: 'manual', is_active: true, created_by: ownerId });
	const followUp = await insertOne('follow_ups', { business_id: businessId, patient_id: patientId, assigned_professional_id: professionalId, remind_on: '2099-01-02', message: followUpMessage, status: 'pending', created_by: ownerId });
	followUpId = followUp.id;

	const userClient = createClient(env.ODONTO_SUPABASE_URL, env.ODONTO_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: WebSocket } });
	const signIn = await userClient.auth.signInWithPassword({ email: professionalEmail, password });
	if (signIn.error || !signIn.data.session) throw signIn.error ?? new Error('professional sign-in failed');
	browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ baseURL: baseUrl });
	await context.addCookies([
		{ name: 'sb-module', value: 'odonto', domain: new URL(baseUrl).hostname, path: '/', secure: true, httpOnly: true },
		{ name: 'sb-access-token', value: signIn.data.session.access_token, domain: new URL(baseUrl).hostname, path: '/', secure: true, httpOnly: true },
		{ name: 'sb-refresh-token', value: signIn.data.session.refresh_token, domain: new URL(baseUrl).hostname, path: '/', secure: true, httpOnly: true }
	]);
	const page = await context.newPage();
	await page.goto('/odonto/seguimientos', { waitUntil: 'domcontentloaded' });
	const initialBody = await page.locator('body').innerText();
	if (initialBody.includes(followUpMessage)) pass('profesional ve el seguimiento mientras el vínculo está activo');
	else fail('profesional ve el seguimiento mientras el vínculo está activo', page.url());

	const { data: deactivated, error: deactivateError } = await admin.from('professional_patient_links').update({ is_active: false, archived_at: new Date().toISOString() }).eq('business_id', businessId).eq('professional_id', professionalId).eq('patient_id', patientId).select('id').maybeSingle();
	if (deactivateError || !deactivated) throw deactivateError ?? new Error('link deactivation did not affect a row');
	await page.reload({ waitUntil: 'domcontentloaded' });
	const revokedBody = await page.locator('body').innerText();
	if (!revokedBody.includes(followUpMessage) && page.url().includes('/odonto/seguimientos')) pass('tras revocar el vínculo, el seguimiento deja de aparecer');
	else fail('tras revocar el vínculo, el seguimiento deja de aparecer', `${page.url()} ${revokedBody.slice(0, 600)}`);
	const latest = await admin.from('follow_ups').select('updated_at').eq('id', followUpId).single();
	const response = await page.evaluate(async ({ id, updatedAt }) => {
		const result = await fetch(`/odonto/seguimientos/${id}/gestionar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expected_updated_at: updatedAt }) });
		return { status: result.status, body: await result.text() };
	}, { id: followUpId, updatedAt: latest.data?.updated_at ?? null });
	if (response.status === 403 || response.status === 404) pass('tras revocar el vínculo, tampoco puede gestionar el seguimiento');
	else fail('tras revocar el vínculo, tampoco puede gestionar el seguimiento', JSON.stringify(response));
	await context.close();
} catch (error) {
	console.error(`ERROR follow-up link revocation test: ${error?.message ?? error}`);
	checks.push(false);
} finally {
	if (browser) await browser.close().catch(() => {});
	if (businessId) {
		try { await admin.from('businesses').delete().eq('id', businessId); } catch {}
	}
	if (ownerId) await admin.auth.admin.deleteUser(ownerId).catch(() => {});
	if (professionalUserId) await admin.auth.admin.deleteUser(professionalUserId).catch(() => {});
}
const failed = checks.filter((ok) => !ok).length;
console.log(`SUMMARY passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exitCode = 1;
