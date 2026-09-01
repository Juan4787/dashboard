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
	auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: WebSocket }
});
const baseUrl = process.env.CITA_SUITE_E2E_BASE_URL?.trim() || 'https://cita.suite.workers.dev';
const marker = `ACTC_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const email = `audit-action-concurrency-${marker.toLowerCase()}@example.invalid`;
const password = `Dd!${randomUUID()}z`;
let userId = null;
let businessId = null;
let serviceId = null;
let professionalId = null;
const checks = [];
const pass = (name, detail = '') => { checks.push(true); console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`); };
const fail = (name, detail = '') => { checks.push(false); console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); };
const insertOne = async (table, row) => {
	const { data, error } = await admin.from(table).insert(row).select().single();
	if (error) throw new Error(`${table}: ${error.message}`);
	return data;
};
const localSlot = (days) => {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, 14, 0, 0));
};

let browser;
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
	await insertOne('business_users', { business_id: businessId, user_id: userId, role: 'owner', status: 'active', accepted_at: new Date().toISOString() });
	const professional = await insertOne('professionals', { business_id: businessId, name: `${marker} Profesional`, is_public: true, is_active: true });
	professionalId = professional.id;
	const service = await insertOne('services', { business_id: businessId, name: `${marker} Consulta`, duration_minutes: 30, is_public: true, is_active: true });
	serviceId = service.id;
	await insertOne('professional_services', { business_id: businessId, professional_id: professionalId, service_id: serviceId });
	for (const weekday of [0, 1, 2, 3, 4, 5, 6]) await insertOne('availability_rules', { business_id: businessId, professional_id: professionalId, weekday, start_time: '08:00', end_time: '20:00', slot_interval_minutes: 30, break_minutes: 0, is_active: true });

	const startsAt = localSlot(10);
	const extraAvailableStart = new Date(startsAt.getTime() - 60 * 60_000);
	const extraAvailableEnd = new Date(startsAt.getTime() + 60 * 60_000);
	await insertOne('availability_exceptions', { business_id: businessId, professional_id: professionalId, starts_at: extraAvailableStart.toISOString(), ends_at: extraAvailableEnd.toISOString(), type: 'extra_available', reason: `${marker} diagnostic slot` });
	const userClient = createClient(env.ODONTO_SUPABASE_URL, env.ODONTO_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: WebSocket } });
	const signIn = await userClient.auth.signInWithPassword({ email, password });
	if (signIn.error) throw signIn.error;
	const { data: userServices, error: userServicesError } = await userClient.from('services').select('id,business_id,name,duration_minutes,is_active').eq('business_id', businessId).eq('id', serviceId).maybeSingle();
	const { data: userAssignments, error: userAssignmentsError } = await userClient.from('professional_services').select('professional_id,service_id,professionals!inner(id,name,is_active,is_public)').eq('business_id', businessId).eq('service_id', serviceId);
	const { data: userRules, error: userRulesError } = await userClient.from('availability_rules').select('weekday,start_time,end_time,slot_interval_minutes,break_minutes,is_active').eq('business_id', businessId).eq('professional_id', professionalId);
	console.log(`USER_DATA_CHECK ${JSON.stringify({ service: userServices, serviceError: userServicesError?.message ?? null, assignments: userAssignments, assignmentError: userAssignmentsError?.message ?? null, rulesCount: userRules?.length ?? null, ruleError: userRulesError?.message ?? null })}`);
	browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ baseURL: baseUrl });
	const page = await context.newPage();
	await page.goto('/login', { waitUntil: 'domcontentloaded' });
	await page.getByLabel('Correo electrónico').fill(email);
	await page.getByLabel('Contraseña').fill(password);
	await page.locator('form').getByRole('button', { name: 'Ingresar', exact: true }).click();
	await page.waitForURL(/\/odonto(?:\/agenda)?(?:\?|$)/, { timeout: 20_000 });
	await page.goto('/odonto/agenda', { waitUntil: 'domcontentloaded' });
	const contextText = await page.locator('body').innerText().catch(() => '');
	console.log(`CONTEXT_MARKER ${contextText.includes(marker)} body=${contextText.slice(0, 280).replace(/\s+/g, ' ')}`);
	if (page.url().includes('/odonto/agenda') && contextText.includes(marker)) pass('acción autenticada: sesión A lista'); else fail('acción autenticada: sesión A lista', page.url());
	const { data: businessCheck } = await admin.from('businesses').select('timezone, max_booking_days_ahead, min_booking_notice_minutes, allow_same_day_booking, is_active, public_booking_enabled').eq('id', businessId).maybeSingle();
	const { data: serviceCheck } = await admin.from('services').select('id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, is_active, is_public').eq('id', serviceId).maybeSingle();
	const { data: professionalCheck } = await admin.from('professionals').select('id, name, is_active, is_public').eq('id', professionalId).maybeSingle();
	const { data: rulesCheck } = await admin.from('availability_rules').select('weekday, start_time, end_time, slot_interval_minutes, break_minutes, is_active').eq('business_id', businessId).eq('professional_id', professionalId).order('weekday');
	const { data: assignmentsCheck } = await admin.from('professional_services').select('professional_id, service_id').eq('business_id', businessId);
	console.log(`FIXTURE_CHECK ${JSON.stringify({ business: businessCheck, service: serviceCheck, professional: professionalCheck, rules: rulesCheck, assignments: assignmentsCheck, startsAt: startsAt.toISOString() })}`);
	const key = randomUUID();
	const availabilityProbe = await page.evaluate(async ({ serviceId, professionalId, date, fromDate }) => {
		const response = await fetch(`/odonto/disponibilidad/slots?service_id=${encodeURIComponent(serviceId)}&professional_id=${encodeURIComponent(professionalId)}&from=${date}&to=${date}`, { cache: 'no-store' });
		const rangeResponse = await fetch(`/odonto/disponibilidad/slots?service_id=${encodeURIComponent(serviceId)}&professional_id=${encodeURIComponent(professionalId)}&from=${fromDate}&to=${date}`, { cache: 'no-store' });
		return { status: response.status, body: (await response.text()).slice(0, 1200), rangeStatus: rangeResponse.status, rangeBody: (await rangeResponse.text()).slice(0, 1200) };
	}, { serviceId, professionalId, date: startsAt.toISOString().slice(0, 10), fromDate: localSlot(1).toISOString().slice(0, 10) });
	console.log(`AVAILABILITY_PROBE ${JSON.stringify(availabilityProbe)}`);
	const fields = {
		service_id: serviceId, professional_id: professionalId, professional_ids: professionalId, booking_mode: 'individual', date: startsAt.toISOString().slice(0, 10), time: '11:00',
		patient_mode: 'new', patient_id: '', patient_name: `${marker} Paciente`, patient_phone: '+54 9 11 8888-0001', patient_email: `${marker.toLowerCase()}@example.invalid`,
		patient_phone_changed: 'false', phone_warning_override: '', idempotency_key: key, internal_note: `${marker} action race`, ignore_break: 'false'
	};
	const responses = await page.evaluate(async ({ fields }) => {
		const send = async () => {
			const body = new URLSearchParams();
			for (const [key, value] of Object.entries(fields)) body.set(key, String(value));
			const response = await fetch('/odonto/agenda?/create_appointment', { method: 'POST', body, redirect: 'manual', headers: { accept: 'application/json' } });
			return { status: response.status, location: response.headers.get('location'), body: (await response.text()).slice(0, 200) };
		};
		return await Promise.all(Array.from({ length: 10 }, send));
	}, { fields });
	const serverErrors = responses.filter((response) => response.status >= 500);
	if (serverErrors.length === 0) pass('10 acciones autenticadas concurrentes sin HTTP 5xx'); else fail('10 acciones autenticadas concurrentes sin HTTP 5xx', JSON.stringify(serverErrors));
	const responseTypes = responses.map((response) => response.body.match(/"type":"([^"]+)/)?.[1] ?? (response.status === 303 ? 'redirect' : `http-${response.status}`));
	console.log(`ACTION_RESPONSES ${JSON.stringify(responseTypes)}`);
	console.log(`ACTION_SAMPLE ${JSON.stringify(responses[0])}`);
	const { count: appointments, error: appointmentsError } = await admin.from('appointments').select('id', { count: 'exact', head: true }).eq('business_id', businessId);
	const { count: patients, error: patientsError } = await admin.from('patients').select('id', { count: 'exact', head: true }).eq('business_id', businessId);
	if (!appointmentsError && appointments === 1) pass('10 acciones autenticadas: un solo turno persistido'); else fail('10 acciones autenticadas: un solo turno persistido', appointmentsError?.message || `appointments=${appointments}`);
	if (!patientsError && patients === 1) pass('10 acciones autenticadas: un solo paciente persistido'); else fail('10 acciones autenticadas: un solo paciente persistido', patientsError?.message || `patients=${patients}`);
	const { data: rows, error: rowError } = await admin.from('appointments').select('status, starts_at, patient_name_at_booking, creation_request_key').eq('business_id', businessId);
	if (!rowError && rows?.[0]?.status === 'reserved' && new Date(rows[0].starts_at).getTime() === startsAt.getTime() && rows[0].creation_request_key === key && rows[0].patient_name_at_booking === `${marker} Paciente`) pass('10 acciones autenticadas: turno, paciente, horario y clave coherentes'); else fail('10 acciones autenticadas: datos coherentes', rowError?.message || JSON.stringify(rows));
	await context.close();
} finally {
	if (browser) await browser.close().catch(() => {});
	if (businessId) {
		try { await admin.from('businesses').delete().eq('id', businessId); } catch (error) { console.error('cleanup business failed', error?.message ?? 'unknown'); }
	}
	if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
}
const failed = checks.filter((ok) => !ok).length;
console.log(`SUMMARY passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exitCode = 1;
