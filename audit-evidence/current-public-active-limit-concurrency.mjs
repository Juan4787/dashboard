import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import WebSocket from '../apps/web/node_modules/ws/index.js';

const env = {};
for (const raw of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
	const line = raw.trim();
	if (!line || line.startsWith('#')) continue;
	const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
	if (!match) continue;
	let value = match[2].trim();
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		value = value.slice(1, -1);
	}
	env[match[1]] = value;
}
Object.assign(env, process.env);

const options = {
	auth: { autoRefreshToken: false, persistSession: false },
	realtime: { transport: WebSocket }
};
const admin = createClient(env.ODONTO_SUPABASE_URL, env.ODONTO_SUPABASE_SERVICE_ROLE_KEY, options);
const marker = `PALIM_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const phone = `+54911${String(Date.now()).slice(-8)}`;
const patientName = `${marker} paciente`;
let userId;
let businessId;
let serviceId;
let professionalId;
const checks = [];
const record = (name, ok, detail = '') => {
	checks.push(Boolean(ok));
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const insert = async (table, row) => {
	const { data, error } = await admin.from(table).insert(row).select().single();
	if (error) throw error;
	return data;
};
const slot = (days, hour) => {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, hour, 0, 0));
};
const rpcInput = (startsAt) => ({
	p_business_id: businessId,
	p_patient_mode: 'public',
	p_patient_id: null,
	p_patient_name: patientName,
	p_patient_phone_raw: phone,
	p_patient_phone_e164: phone,
	p_patient_email: null,
	p_update_existing_phone: false,
	p_owner_id: null,
	p_service_id: serviceId,
	p_professional_ids: [professionalId],
	p_starts_at: startsAt.toISOString(),
	p_internal_note: marker,
	p_created_by_user_id: null,
	p_ignore_break: false,
	p_source: 'public_booking',
	p_phone_communication_status: 'valid',
	p_phone_warning_acknowledged: false,
	p_idempotency_key: randomUUID(),
	p_replay_only: false
});

try {
	const created = await admin.auth.admin.createUser({
		email: `${marker.toLowerCase()}@example.invalid`,
		password: `Aa!${randomUUID()}z`,
		email_confirm: true
	});
	if (created.error || !created.data.user) throw created.error ?? new Error('user creation failed');
	userId = created.data.user.id;
	businessId = (await insert('businesses', {
		name: marker,
		slug: marker.toLowerCase(),
		industry: 'odontology',
		timezone: 'America/Argentina/Cordoba',
		public_booking_enabled: true,
		allow_same_day_booking: true,
		min_booking_notice_minutes: 0,
		max_booking_days_ahead: 90
	})).id;
	const subscription = await admin
		.from('business_subscriptions')
		.update({
			commercial_access_enabled: true,
			is_permanent: true,
			subscription_status: 'active',
			paid_until: null,
			grace_until: null,
			restricted_until: null,
			archived_at: null
		})
		.eq('business_id', businessId);
	if (subscription.error) throw subscription.error;
	await insert('business_users', {
		business_id: businessId,
		user_id: userId,
		role: 'owner',
		status: 'active',
		accepted_at: new Date().toISOString()
	});
	professionalId = (await insert('professionals', {
		business_id: businessId,
		name: `${marker} profesional`,
		is_public: true,
		is_active: true
	})).id;
	serviceId = (await insert('services', {
		business_id: businessId,
		name: `${marker} consulta`,
		duration_minutes: 30,
		is_public: true,
		is_active: true
	})).id;
	await insert('professional_services', { business_id: businessId, professional_id: professionalId, service_id: serviceId });

	for (let index = 0; index < 3; index += 1) {
		const result = await admin.rpc('create_appointment_with_patient_identity', rpcInput(slot(10 + index, 10 + index)));
		if (result.error || !result.data?.[0]?.id) throw result.error ?? new Error('seed booking failed');
	}
	const concurrent = await Promise.all([
		admin.rpc('create_appointment_with_patient_identity', rpcInput(slot(20, 10))),
		admin.rpc('create_appointment_with_patient_identity', rpcInput(slot(21, 10)))
	]);
	const successes = concurrent.filter((result) => !result.error && result.data?.[0]?.id);
	const limitErrors = concurrent.filter((result) => result.error && /PUBLIC_BOOKING_ACTIVE_LIMIT/.test(result.error.message ?? ''));
	record('cupo público 4/4: exactamente una solicitud concurrente gana', successes.length === 1, `successes=${successes.length}`);
	record('cupo público 4/4: una solicitud concurrente es rechazada por límite', limitErrors.length === 1, `limitErrors=${limitErrors.length}`);
	const count = await admin
		.from('appointments')
		.select('id', { count: 'exact', head: true })
		.eq('business_id', businessId)
		.eq('source', 'public_booking')
		.eq('status', 'reserved');
	record('cupo público 4/4: quedan exactamente cuatro turnos activos', !count.error && count.count === 4, `count=${count.count ?? 'null'}`);
} finally {
	if (businessId) await admin.from('businesses').delete().eq('id', businessId);
	if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
}

const failed = checks.filter((ok) => !ok).length;
console.log(`SUMMARY passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exitCode = 1;
