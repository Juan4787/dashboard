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
	auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: WebSocket }
});
const marker = `CONC_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const email = `audit-concurrency-${marker.toLowerCase()}@example.invalid`;
const password = `Cc!${randomUUID()}z`;
let userId = null;
let businessId = null;
let serviceId = null;
let professionalId = null;
const results = [];
const pass = (name, detail = '') => { results.push({ name, pass: true }); console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`); };
const fail = (name, detail = '') => { results.push({ name, pass: false }); console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); };
const insertOne = async (table, row) => {
	const { data, error } = await admin.from(table).insert(row).select().single();
	if (error) throw new Error(`${table}: ${error.message}`);
	return data;
};
const readCount = async (table, column, value) => {
	const { count, error } = await admin.from(table).select('id', { count: 'exact', head: true }).eq(column, value);
	if (error) throw error;
	return count ?? 0;
};
const localSlot = (days) => {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, 14, 0, 0));
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
	for (const weekday of [0, 1, 2, 3, 4, 5, 6]) await insertOne('availability_rules', { business_id: businessId, professional_id: professionalId, weekday, start_time: '08:00', end_time: '20:00', slot_interval_minutes: 30, is_active: true });

	const startsAt = localSlot(10);
	const makeInput = (suffix, key, mode = 'public', slotStartsAt = startsAt) => ({
		p_business_id: businessId, p_patient_mode: mode, p_patient_id: null, p_patient_name: `${marker} Paciente ${suffix}`,
		p_patient_phone_raw: `+54 9 11 7777${String(suffix).padStart(4, '0')}`, p_patient_phone_e164: `+549117777${String(suffix).padStart(4, '0')}`,
		p_patient_email: `${marker.toLowerCase()}-${suffix}@example.invalid`, p_update_existing_phone: false, p_owner_id: userId,
		p_service_id: serviceId, p_professional_ids: [professionalId], p_starts_at: slotStartsAt.toISOString(), p_internal_note: `${marker} concurrency`,
		p_created_by_user_id: null, p_ignore_break: false, p_source: 'public_booking', p_phone_communication_status: 'valid', p_phone_warning_acknowledged: false,
		p_idempotency_key: key, p_replay_only: false
	});

	const fifty = await Promise.all(Array.from({ length: 50 }, (_, index) => admin.rpc('create_appointment_with_patient_identity', makeInput(index + 1, randomUUID()))));
	const successes = fifty.filter((item) => !item.error && Array.isArray(item.data) && item.data.length === 1 && item.data[0]?.id);
	const conflicts = fifty.filter((item) => item.error && (item.error.code === '23P01' || /conflict|ocupad|exclusion|available|disponib/i.test(item.error.message ?? '')));
	if (successes.length === 1) pass('50 reservas concurrentes: exactamente una ganadora'); else fail('50 reservas concurrentes: exactamente una ganadora', `successes=${successes.length}`);
	if (conflicts.length === 49) pass('50 reservas concurrentes: 49 conflictos de horario', `conflicts=${conflicts.length}`); else fail('50 reservas concurrentes: conflictos esperados', `conflicts=${conflicts.length}; otrosErrores=${50 - successes.length - conflicts.length}`);
	const appointmentCount = await readCount('appointments', 'business_id', businessId);
	const patientCount = await readCount('patients', 'business_id', businessId);
	if (appointmentCount === 1) pass('50 reservas concurrentes: un solo turno persistido'); else fail('50 reservas concurrentes: un solo turno persistido', `appointments=${appointmentCount}`);
	if (patientCount === 1) pass('50 reservas concurrentes: un solo paciente persistido'); else fail('50 reservas concurrentes: rollback de pacientes perdedores', `patients=${patientCount}`);
	const { data: winners, error: winnerError } = await admin.from('appointments').select('id, status, starts_at, patient_id, business_id, confirmation_token').eq('business_id', businessId);
	if (!winnerError && winners?.[0]?.status === 'reserved' && new Date(winners[0].starts_at).getTime() === startsAt.getTime()) pass('50 reservas concurrentes: ganador coherente y reservado'); else fail('50 reservas concurrentes: ganador coherente', winnerError?.message || JSON.stringify(winners));

	const idempotencyKey = randomUUID();
	const idempotencySlot = localSlot(11);
	const sameInput = makeInput('IDEMPOTENT', idempotencyKey, 'public', idempotencySlot);
	const doubleSend = await Promise.all(Array.from({ length: 10 }, () => admin.rpc('create_appointment_with_patient_identity', sameInput)));
	const doubleSuccess = doubleSend.filter((item) => !item.error && item.data?.length === 1 && item.data[0]?.id);
	const replayFlags = doubleSend.filter((item) => item.data?.[0]?.idempotent_replay === true);
	const doubleIds = new Set(doubleSend.flatMap((item) => (item.data ?? []).map((row) => row.id)));
	if (doubleSuccess.length === 10 && doubleIds.size === 1) pass('10 dobles envíos con la misma idempotency key: una sola respuesta lógica', `id=${[...doubleIds][0].slice(0, 8)}`); else fail('10 dobles envíos con la misma idempotency key', `success=${doubleSuccess.length}; ids=${doubleIds.size}`);
	if (replayFlags.length >= 9) pass('10 dobles envíos: reintentos marcados como replay', `replays=${replayFlags.length}`); else fail('10 dobles envíos: reintentos marcados como replay', `replays=${replayFlags.length}`);
	const appointmentCountAfterIdempotency = await readCount('appointments', 'business_id', businessId);
	const patientCountAfterIdempotency = await readCount('patients', 'business_id', businessId);
	if (appointmentCountAfterIdempotency === 2 && patientCountAfterIdempotency === 2) pass('Idempotencia: no duplica turnos ni pacientes'); else fail('Idempotencia: no duplica turnos ni pacientes', `appointments=${appointmentCountAfterIdempotency}; patients=${patientCountAfterIdempotency}`);
} finally {
	if (businessId) {
		try { await admin.from('businesses').delete().eq('id', businessId); } catch (error) { console.error('cleanup business failed', error?.message ?? 'unknown'); }
	}
	if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
}
const failed = results.filter((item) => !item.pass);
console.log(`SUMMARY passed=${results.length - failed.length} failed=${failed.length} total=${results.length}`);
if (failed.length) process.exitCode = 1;
