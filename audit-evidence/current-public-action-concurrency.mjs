import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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

const admin = createClient(env.ODONTO_SUPABASE_URL, env.ODONTO_SUPABASE_SERVICE_ROLE_KEY, {
	auth: { autoRefreshToken: false, persistSession: false },
	realtime: { transport: WebSocket }
});
const baseUrl = 'https://app.cita-suite.workers.dev';
const marker = `PCA_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const email = `audit-public-actions-${marker.toLowerCase()}@example.invalid`;
const password = `Pp!${randomUUID()}z`;
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
const futureSlot = (days, hour = 15) => {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, hour, 0, 0));
};
const createAppointment = async (suffix, startsAt) => {
	const result = await admin.rpc('create_appointment_with_patient_identity', {
		p_business_id: businessId,
		p_patient_mode: 'public',
		p_patient_id: null,
		p_patient_name: `${marker} Paciente ${suffix}`,
		p_patient_phone_raw: `+54 9 11 6666${String(suffix).padStart(4, '0')}`,
		p_patient_phone_e164: `+549116666${String(suffix).padStart(4, '0')}`,
		p_patient_email: `${marker.toLowerCase()}-${suffix}@example.invalid`,
		p_update_existing_phone: false,
		p_owner_id: userId,
		p_service_id: serviceId,
		p_professional_ids: [professionalId],
		p_starts_at: startsAt.toISOString(),
		p_internal_note: `${marker} public action race`,
		p_created_by_user_id: null,
		p_ignore_break: false,
		p_source: 'public_booking',
		p_phone_communication_status: 'valid',
		p_phone_warning_acknowledged: false,
		p_idempotency_key: randomUUID(),
		p_replay_only: false
	});
	if (result.error || !result.data?.[0]?.id) throw result.error ?? new Error(`appointment ${suffix} failed`);
	const { data, error } = await admin.from('appointments').select('id, confirmation_token, status').eq('id', result.data[0].id).single();
	if (error || !data?.confirmation_token) throw error ?? new Error(`appointment ${suffix} token missing`);
	return data;
};
const postAction = async (token, action, fields = {}) => {
	const body = new URLSearchParams(fields);
	const response = await fetch(`${baseUrl}/turno/${encodeURIComponent(token)}?/${action}`, {
		method: 'POST',
		body,
		redirect: 'manual',
		headers: {
			accept: 'application/json',
			'user-agent': 'CitaSuiteAudit/1.0',
			origin: baseUrl,
			referer: `${baseUrl}/turno/${encodeURIComponent(token)}`
		}
	});
	const text = await response.text();
	let parsed = null;
	try { parsed = JSON.parse(text); } catch { /* captured below without exposing body */ }
	return { status: response.status, type: parsed?.type ?? null, text: text.slice(0, 280) };
};
const race = async (appointment, action, fields = {}) => {
	const responses = await Promise.all(Array.from({ length: 8 }, () => postAction(appointment.confirmation_token, action, fields)));
	const serverErrors = responses.filter((response) => response.status >= 500);
	const successes = responses.filter((response) => response.type === 'success');
	console.log(`RACE_${action.toUpperCase()} ${JSON.stringify({ statuses: responses.map((response) => response.status), types: responses.map((response) => response.type), successCount: successes.length, sample: responses[0]?.text })}`);
	return { responses, serverErrors, successes };
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
	await insertOne('business_users', { business_id: businessId, user_id: userId, role: 'owner', status: 'active', accepted_at: new Date().toISOString() });
	const professional = await insertOne('professionals', { business_id: businessId, name: `${marker} Profesional`, is_public: true, is_active: true });
	professionalId = professional.id;
	const service = await insertOne('services', { business_id: businessId, name: `${marker} Consulta`, duration_minutes: 30, is_public: true, is_active: true });
	serviceId = service.id;
	await insertOne('professional_services', { business_id: businessId, professional_id: professionalId, service_id: serviceId });
	for (const weekday of [0, 1, 2, 3, 4, 5, 6]) await insertOne('availability_rules', { business_id: businessId, professional_id: professionalId, weekday, start_time: '08:00', end_time: '20:00', slot_interval_minutes: 30, break_minutes: 0, is_active: true });

	const cancelAppointment = await createAppointment('CANCEL', futureSlot(12, 15));
	const cancelRace = await race(cancelAppointment, 'cancel', { confirm_cancel: 'true', note: `${marker} cancel race` });
	if (cancelRace.serverErrors.length === 0 && cancelRace.successes.length === 1) pass('cancelación pública concurrente: un solo éxito y cero HTTP 5xx'); else fail('cancelación pública concurrente', JSON.stringify({ serverErrors: cancelRace.serverErrors.length, successes: cancelRace.successes.length }));
	const { data: cancelled, error: cancelledError } = await admin.from('appointments').select('status, cancelled_at, cancelled_reason').eq('id', cancelAppointment.id).single();
	if (!cancelledError && cancelled?.status === 'cancelled' && cancelled.cancelled_at && String(cancelled.cancelled_reason).includes(marker)) pass('cancelación pública: estado y motivo coherentes'); else fail('cancelación pública: estado final', cancelledError?.message ?? JSON.stringify(cancelled));
	const { count: cancelAuditCount } = await admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('entity_id', cancelAppointment.id).eq('action', 'appointment.public_cancelled');
	if (cancelAuditCount === 1) pass('cancelación pública: un único audit log de éxito'); else fail('cancelación pública: audit log único', `count=${cancelAuditCount}`);
	const closedCancel = await postAction(cancelAppointment.confirmation_token, 'request_reschedule', { note: `${marker} closed` });
	if (closedCancel.status < 500 && closedCancel.type === 'failure') pass('cancelación pública: reprogramación posterior rechazada sin 5xx'); else fail('cancelación pública: acción posterior', JSON.stringify(closedCancel));

	const rescheduleAppointment = await createAppointment('RESCHEDULE', futureSlot(13, 16));
	const rescheduleRace = await race(rescheduleAppointment, 'request_reschedule', { note: `${marker} reschedule race` });
	if (rescheduleRace.serverErrors.length === 0 && rescheduleRace.successes.length === 1) pass('pedido de reprogramación público concurrente: un solo éxito y cero HTTP 5xx'); else fail('pedido de reprogramación público concurrente', JSON.stringify({ serverErrors: rescheduleRace.serverErrors.length, successes: rescheduleRace.successes.length }));
	const { data: requested, error: requestedError } = await admin.from('appointments').select('status, reschedule_requested_at').eq('id', rescheduleAppointment.id).single();
	if (!requestedError && requested?.status === 'reschedule_requested' && requested.reschedule_requested_at) pass('reprogramación pública: estado final coherente'); else fail('reprogramación pública: estado final', requestedError?.message ?? JSON.stringify(requested));
	const { count: rescheduleAuditCount } = await admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('entity_id', rescheduleAppointment.id).eq('action', 'appointment.public_reschedule_requested');
	if (rescheduleAuditCount === 1) pass('reprogramación pública: un único audit log de éxito'); else fail('reprogramación pública: audit log único', `count=${rescheduleAuditCount}`);
	const closedReschedule = await postAction(rescheduleAppointment.confirmation_token, 'request_reschedule', { note: `${marker} duplicate` });
	if (closedReschedule.status < 500 && closedReschedule.type === 'failure') pass('reprogramación pública: segundo pedido rechazado sin 5xx'); else fail('reprogramación pública: segundo pedido', JSON.stringify(closedReschedule));

	const confirmAppointment = await createAppointment('CONFIRM', futureSlot(14, 17));
	const confirmRace = await race(confirmAppointment, 'confirm');
	if (confirmRace.serverErrors.length === 0 && confirmRace.successes.length >= 1) pass('confirmación pública concurrente: al menos un éxito y cero HTTP 5xx', `successes=${confirmRace.successes.length}`); else fail('confirmación pública concurrente', JSON.stringify({ serverErrors: confirmRace.serverErrors.length, successes: confirmRace.successes.length }));
	const { data: confirmed, error: confirmedError } = await admin.from('appointments').select('status, confirmed_at').eq('id', confirmAppointment.id).single();
	if (!confirmedError && confirmed?.status === 'confirmed' && confirmed.confirmed_at) pass('confirmación pública: estado final coherente'); else fail('confirmación pública: estado final', confirmedError?.message ?? JSON.stringify(confirmed));
	const { count: confirmAuditCount } = await admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('entity_id', confirmAppointment.id).eq('action', 'appointment.public_confirmed');
	if (confirmAuditCount === 1) pass('confirmación pública: un único audit log aunque haya replay'); else fail('confirmación pública: audit log único', `count=${confirmAuditCount}`);
} finally {
	if (businessId) await admin.from('businesses').delete().eq('id', businessId);
	if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
}
const failed = checks.filter((ok) => !ok).length;
console.log(`SUMMARY passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exitCode = 1;
