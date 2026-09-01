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
	auth: { autoRefreshToken: false, persistSession: false },
	realtime: { transport: WebSocket }
});
const baseUrl = process.env.CITA_SUITE_E2E_BASE_URL?.trim() || 'https://cita.suite.workers.dev';
const marker = `FUC_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const email = `audit-followup-${marker.toLowerCase()}@example.invalid`;
const password = `Ss!${randomUUID()}z`;
let userId = null;
let businessId = null;
let patientId = null;
let professionalId = null;
let browser;
const checks = [];
const pass = (name, detail = '') => { checks.push(true); console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`); };
const fail = (name, detail = '') => { checks.push(false); console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); };
const insertOne = async (table, row) => {
	const { data, error } = await admin.from(table).insert(row).select().single();
	if (error) throw new Error(`${table}: ${error.message}`);
	return data;
};
const post = (page, pathName, body = {}) => page.evaluate(async ({ pathName, body }) => {
		const response = await fetch(pathName, {
			method: 'POST',
			headers: { accept: 'application/json', 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		return { status: response.status, body: (await response.text()).slice(0, 500) };
	}, { pathName, body });
const todayUTC = new Date().toISOString().slice(0, 10);

try {
	const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
	if (created.error || !created.data.user) throw created.error ?? new Error('auth user creation failed');
	userId = created.data.user.id;
	const business = await insertOne('businesses', {
		name: `${marker} Consultorio`, slug: `${marker.toLowerCase()}-business`, industry: 'odontology',
		timezone: 'UTC', public_booking_enabled: false, allow_same_day_booking: true,
		min_booking_notice_minutes: 0, max_booking_days_ahead: 90
	});
	businessId = business.id;
	const { error: subscriptionError } = await admin.from('business_subscriptions').update({
		commercial_access_enabled: true, is_permanent: true, subscription_status: 'active',
		paid_until: null, grace_until: null, restricted_until: null, archived_at: null
	}).eq('business_id', businessId);
	if (subscriptionError) throw subscriptionError;
	await insertOne('business_users', { business_id: businessId, user_id: userId, role: 'owner', status: 'active', accepted_at: new Date().toISOString() });
	const patient = await insertOne('patients', {
		owner_id: userId, business_id: businessId, full_name: `${marker} Paciente`,
		phone: '+5491177770001', phone_raw: '+54 9 11 7777 0001', phone_e164: '+5491177770001', origin: 'manual'
	});
	patientId = patient.id;
	const professional = await insertOne('professionals', { business_id: businessId, name: `${marker} Profesional`, is_public: false, is_active: true });
	professionalId = professional.id;
	await insertOne('professional_users', { business_id: businessId, professional_id: professionalId, user_id: userId });

	const makeFollowUp = async (remindOn, suffix) => {
		const row = await insertOne('follow_ups', {
			business_id: businessId, patient_id: patientId, assigned_professional_id: professionalId,
			remind_on: remindOn, message: `${marker} ${suffix}`, status: 'pending', created_by: userId
		});
		return row.id;
	};
	const doneId = await makeFollowUp(todayUTC, 'done');
	const snoozeId = await makeFollowUp(todayUTC, 'snooze');

	const authClient = createClient(env.ODONTO_SUPABASE_URL, env.ODONTO_SUPABASE_ANON_KEY, {
		auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: WebSocket }
	});
	const signIn = await authClient.auth.signInWithPassword({ email, password });
	if (signIn.error || !signIn.data.session) throw signIn.error ?? new Error('auth sign-in failed');
	browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ baseURL: baseUrl });
	await context.addCookies([
		{ name: 'sb-module', value: 'odonto', domain: new URL(baseUrl).hostname, path: '/', secure: true, httpOnly: true },
		{ name: 'sb-access-token', value: signIn.data.session.access_token, domain: new URL(baseUrl).hostname, path: '/', secure: true, httpOnly: true },
		{ name: 'sb-refresh-token', value: signIn.data.session.refresh_token, domain: new URL(baseUrl).hostname, path: '/', secure: true, httpOnly: true }
	]);
	const page = await context.newPage();
	await page.goto('/odonto/seguimientos', { waitUntil: 'domcontentloaded' });
	if (page.url().includes('/odonto/seguimientos')) pass('sesión autenticada y Seguimientos cargado en el Worker');
	else throw new Error(`session bootstrap failed: ${page.url()}`);

	const { data: doneBefore, error: doneBeforeError } = await admin
		.from('follow_ups')
		.select('updated_at')
		.eq('id', doneId)
		.single();
	if (doneBeforeError || !doneBefore?.updated_at) throw doneBeforeError ?? new Error('done version missing');
	const doneExpectedUpdatedAt = String(doneBefore.updated_at);
	const doneResponses = await Promise.all(
		Array.from({ length: 8 }, () =>
			post(page, `/odonto/seguimientos/${doneId}/gestionar`, {
				expected_updated_at: doneExpectedUpdatedAt
			})
		)
	);
	const doneSuccesses = doneResponses.filter((result) => result.status === 200);
	const done5xx = doneResponses.filter((result) => result.status >= 500);
	const { data: doneRow, error: doneError } = await admin.from('follow_ups').select('status,done_at,updated_at').eq('id', doneId).single();
	if (!done5xx.length && doneSuccesses.length === 1) pass('completar seguimiento concurrente: un solo éxito y cero 5xx');
	else fail('completar seguimiento concurrente', JSON.stringify({ statuses: doneResponses.map((r) => r.status), successCount: doneSuccesses.length }));
	if (!doneError && doneRow?.status === 'done' && doneRow.done_at) pass('completar seguimiento: estado persistido sin falso éxito');
	else fail('completar seguimiento: estado final', doneError?.message ?? JSON.stringify(doneRow));

	const snoozeDates = ['2099-01-01', '2099-01-02', '2099-01-03', '2099-01-04', '2099-01-05', '2099-01-06', '2099-01-07', '2099-01-08'];
	const { data: snoozeBefore, error: snoozeBeforeError } = await admin
		.from('follow_ups')
		.select('updated_at')
		.eq('id', snoozeId)
		.single();
	if (snoozeBeforeError || !snoozeBefore?.updated_at) throw snoozeBeforeError ?? new Error('snooze version missing');
	const expectedUpdatedAt = String(snoozeBefore.updated_at);
	const snoozeResponses = await Promise.all(
		snoozeDates.map((date) =>
			post(page, `/odonto/seguimientos/${snoozeId}/posponer`, {
				date,
				expected_updated_at: expectedUpdatedAt
			})
		)
	);
	const snoozeSuccesses = snoozeResponses.filter((result) => result.status === 200);
	const snooze5xx = snoozeResponses.filter((result) => result.status >= 500);
	const { data: snoozeRow, error: snoozeError } = await admin.from('follow_ups').select('status,remind_on,updated_at').eq('id', snoozeId).single();
	if (!snooze5xx.length && snoozeSuccesses.length === 1) pass('posponer seguimiento concurrente: un solo éxito y cero 5xx');
	else fail('posponer seguimiento concurrente', JSON.stringify({ statuses: snoozeResponses.map((r) => r.status), successCount: snoozeSuccesses.length }));
	if (!snoozeError && snoozeRow?.status === 'pending' && /^2099-01-0[1-8]$/.test(String(snoozeRow.remind_on))) pass('posponer seguimiento: fecha final válida y conflicto humano');
	else fail('posponer seguimiento: estado final', snoozeError?.message ?? JSON.stringify(snoozeRow));

	await context.close();
} finally {
	if (browser) await browser.close().catch(() => {});
	if (businessId) {
		try {
			await admin.from('businesses').delete().eq('id', businessId);
		} catch {
			console.error('cleanup business failed');
		}
	}
	if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
}
const failed = checks.filter((ok) => !ok).length;
console.log(`SUMMARY passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exitCode = 1;
