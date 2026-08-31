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
const baseUrl = 'https://app.cita-suite.workers.dev';
const marker = `STC_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const email = `audit-status-concurrency-${marker.toLowerCase()}@example.invalid`;
const password = `Ss!${randomUUID()}z`;
let userId = null;
let businessId = null;
let serviceId = null;
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
const futureSlot = (days, hour) => {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, hour, 0, 0));
};
const createAppointment = async (startsAt, suffix) => {
	const result = await admin.rpc('create_appointment_with_patient_identity', {
		p_business_id: businessId,
		p_patient_mode: 'new',
		p_patient_id: null,
		p_patient_name: `${marker} Paciente ${suffix}`,
		p_patient_phone_raw: '+54 9 11 7777-0001',
		p_patient_phone_e164: '+5491177770001',
		p_patient_email: `${marker.toLowerCase()}-${suffix}@example.invalid`,
		p_update_existing_phone: false,
		p_owner_id: userId,
		p_service_id: serviceId,
		p_professional_ids: [professionalId],
		p_starts_at: startsAt.toISOString(),
		p_internal_note: `${marker} status race`,
		p_created_by_user_id: userId,
		p_ignore_break: false,
		p_source: 'manual',
		p_phone_communication_status: 'valid',
		p_phone_warning_acknowledged: false,
		p_idempotency_key: randomUUID(),
		p_replay_only: false
	});
	if (result.error || !result.data?.[0]?.id) throw result.error ?? new Error(`appointment ${suffix} failed`);
	return result.data[0].id;
};
const isSuccess = (response) => response.status === 303 || /"type"\s*:\s*"success"|"success"\s*:\s*true/.test(response.body);

try {
	const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
	if (created.error || !created.data.user) throw created.error ?? new Error('auth user creation failed');
	userId = created.data.user.id;
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
	await insertOne('business_users', { business_id: businessId, user_id: userId, role: 'owner', status: 'active', accepted_at: new Date().toISOString() });
	const professional = await insertOne('professionals', { business_id: businessId, name: `${marker} Profesional`, is_public: true, is_active: true });
	professionalId = professional.id;
	const service = await insertOne('services', { business_id: businessId, name: `${marker} Consulta`, duration_minutes: 30, is_public: true, is_active: true });
	serviceId = service.id;
	await insertOne('professional_services', { business_id: businessId, professional_id: professionalId, service_id: serviceId });
	for (let weekday = 0; weekday <= 6; weekday += 1) {
		await insertOne('availability_rules', {
			business_id: businessId, professional_id: professionalId, weekday,
			start_time: '08:00', end_time: '20:00', slot_interval_minutes: 30,
			break_minutes: 0, is_active: true
		});
	}
	const authClient = createClient(env.ODONTO_SUPABASE_URL, env.ODONTO_SUPABASE_ANON_KEY, {
		auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: WebSocket }
	});
	const signIn = await authClient.auth.signInWithPassword({ email, password });
	if (signIn.error || !signIn.data.session) throw signIn.error ?? new Error('auth sign-in failed');

	browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ baseURL: baseUrl });
	await context.addCookies([
		{ name: 'sb-module', value: 'odonto', domain: 'app.cita-suite.workers.dev', path: '/', secure: true, httpOnly: true },
		{ name: 'sb-access-token', value: signIn.data.session.access_token, domain: 'app.cita-suite.workers.dev', path: '/', secure: true, httpOnly: true },
		{ name: 'sb-refresh-token', value: signIn.data.session.refresh_token, domain: 'app.cita-suite.workers.dev', path: '/', secure: true, httpOnly: true }
	]);
	const page = await context.newPage();
	await page.goto('/odonto/agenda', { waitUntil: 'domcontentloaded' });
	const body = await page.locator('body').innerText();
	if (page.url().includes('/odonto/agenda') && body.includes(marker)) pass('sesión sintética autenticada en agenda del Worker');
	else throw new Error(`session bootstrap failed: ${page.url()}`);

	const send = (appointmentId, action, fields) => page.evaluate(async ({ appointmentId, action, fields }) => {
		const body = new URLSearchParams(fields);
		const response = await fetch(`/odonto/turnos/${appointmentId}?/${action}`, {
			method: 'POST', body, redirect: 'manual', headers: { accept: 'application/json' }
		});
		return { status: response.status, location: response.headers.get('location'), body: (await response.text()).slice(0, 400) };
	}, { appointmentId, action, fields });

	const cancelAppointment = await createAppointment(futureSlot(12, 15), 'cancel');
	const cancelResponses = await Promise.all(Array.from({ length: 8 }, () => send(cancelAppointment, 'update_status', { status: 'cancelled', reason: `${marker} cancel` })));
	const cancelSuccesses = cancelResponses.filter(isSuccess);
	console.log(`AUTH_STATUS_CANCEL_RACE ${JSON.stringify({ statuses: cancelResponses.map((r) => r.status), successCount: cancelSuccesses.length, sample: cancelResponses[0] })}`);
	const { data: cancelled, error: cancelledError } = await admin.from('appointments').select('status, cancelled_at, cancelled_reason, starts_at').eq('id', cancelAppointment).single();
	const { count: cancelAuditCount } = await admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('entity_id', cancelAppointment).eq('action', 'appointment.cancelled');
	if (!cancelResponses.some((r) => r.status >= 500) && cancelSuccesses.length === 1) pass('cancelación interna concurrente: un solo éxito y cero 5xx');
	else fail('cancelación interna concurrente', JSON.stringify({ statuses: cancelResponses.map((r) => r.status), successCount: cancelSuccesses.length }));
	if (!cancelledError && cancelled?.status === 'cancelled' && cancelled.cancelled_at && String(cancelled.cancelled_reason).includes(marker) && cancelAuditCount === 1) pass('cancelación interna: estado y auditoría únicos');
	else fail('cancelación interna: estado/auditoría', cancelledError?.message ?? JSON.stringify({ cancelled, cancelAuditCount }));

	const mixedStart = futureSlot(13, 15);
	const mixedTarget = futureSlot(13, 16);
	const mixedAppointment = await createAppointment(mixedStart, 'mixed');
	const mixedActions = await Promise.all([
		...Array.from({ length: 4 }, () => send(mixedAppointment, 'update_status', { status: 'cancelled', reason: `${marker} mixed cancel` })),
		...Array.from({ length: 4 }, () => send(mixedAppointment, 'reschedule', {
			slot_starts_at: mixedTarget.toISOString(), reprogram_date: mixedTarget.toISOString().slice(0, 10), ignore_break: 'false'
		}))
	]);
	const mixedSuccesses = mixedActions.filter(isSuccess);
	console.log(`AUTH_STATUS_MIXED_RACE ${JSON.stringify({ statuses: mixedActions.map((r) => r.status), successCount: mixedSuccesses.length, samples: mixedActions.slice(0, 2) })}`);
	const { data: mixedFinal, error: mixedError } = await admin.from('appointments').select('status, starts_at, cancelled_at').eq('id', mixedAppointment).single();
	const { count: mixedCancelAudits } = await admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('entity_id', mixedAppointment).eq('action', 'appointment.cancelled');
	const { count: mixedRescheduleAudits } = await admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('entity_id', mixedAppointment).eq('action', 'appointment.rescheduled');
	const finalIsCancelled = mixedFinal?.status === 'cancelled';
	const finalIsRescheduled = mixedFinal?.status === 'reserved' && new Date(mixedFinal.starts_at).getTime() === mixedTarget.getTime();
	if (!mixedActions.some((r) => r.status >= 500) && mixedSuccesses.length === 1 && (finalIsCancelled || finalIsRescheduled)) pass('cancelación/reprogramación interna concurrente: una transición gana sin 5xx');
	else fail('cancelación/reprogramación interna concurrente', JSON.stringify({ statuses: mixedActions.map((r) => r.status), successCount: mixedSuccesses.length, mixedFinal }));
	if (!mixedError && ((finalIsCancelled && mixedCancelAudits === 1 && mixedRescheduleAudits === 0) || (finalIsRescheduled && mixedCancelAudits === 0 && mixedRescheduleAudits === 1))) pass('carrera mixta: estado final y auditoría no se contradicen');
	else fail('carrera mixta: auditoría/estado', JSON.stringify({ mixedFinal, mixedCancelAudits, mixedRescheduleAudits }));
	await context.close();
} finally {
	if (browser) await browser.close().catch(() => {});
	if (businessId) await admin.from('businesses').delete().eq('id', businessId).catch(() => {});
	if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
}
const failed = checks.filter((ok) => !ok).length;
console.log(`SUMMARY passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exitCode = 1;
