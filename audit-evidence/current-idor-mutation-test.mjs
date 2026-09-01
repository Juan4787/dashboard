import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { chromium } from '../apps/web/node_modules/@playwright/test/index.mjs';
import WebSocket from '../apps/web/node_modules/ws/index.js';

const root = process.cwd();
const envPath = path.join(root, '.env');
const env = {};
for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
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

const supabaseUrl = env.ODONTO_SUPABASE_URL;
const serviceKey = env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
// El .env local conserva PUBLIC_SITE_URL=http://localhost:5173 de una corrida histórica;
// esta certificación apunta explícitamente al Worker que el usuario fijó como producción.
const baseUrl = 'https://app.cita-suite.workers.dev';
if (!supabaseUrl || !serviceKey || !env.E2E_MASTER_EMAIL || !env.E2E_MASTER_PASSWORD) {
	throw new Error('Missing required audit environment keys');
}

const admin = createClient(supabaseUrl, serviceKey, {
	auth: { autoRefreshToken: false, persistSession: false },
	realtime: { transport: WebSocket }
});
const marker = `IDOR_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const emailA = `audit-idor-a-${marker.toLowerCase()}@example.invalid`;
const emailB = `audit-idor-b-${marker.toLowerCase()}@example.invalid`;
const passwordA = `Aa!${randomUUID()}z`;
const passwordB = `Bb!${randomUUID()}z`;
const ids = { businessA: null, businessB: null, userA: null, userB: null, patientA: null, patientB: null, entryB: null, appointmentB: null };
const results = [];

const record = (name, pass, detail) => {
	results.push({ name, pass, detail });
	console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const assert = (name, condition, detail) => record(name, Boolean(condition), detail);

const insertOne = async (table, row) => {
	const { data, error } = await admin.from(table).insert(row).select().single();
	if (error) throw new Error(`${table}: ${error.message}`);
	return data;
};

const dateParts = (offsetDays) => {
	const now = new Date();
	const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays, 14, 0, 0));
	return { date, localDate: date.toISOString().slice(0, 10), localTime: '11:00' };
};

const getRow = async (table, id, columns = '*') => {
	const { data, error } = await admin.from(table).select(columns).eq('id', id).maybeSingle();
	if (error) throw new Error(`${table} read: ${error.message}`);
	return data;
};

let browser;
try {
	const userA = await admin.auth.admin.createUser({ email: emailA, password: passwordA, email_confirm: true });
	if (userA.error || !userA.data.user) throw userA.error || new Error('user A not created');
	ids.userA = userA.data.user.id;
	const userB = await admin.auth.admin.createUser({ email: emailB, password: passwordB, email_confirm: true });
	if (userB.error || !userB.data.user) throw userB.error || new Error('user B not created');
	ids.userB = userB.data.user.id;

	const businessA = await insertOne('businesses', {
		name: `${marker} A`, slug: `${marker.toLowerCase()}-a`, industry: 'odontology', timezone: 'America/Argentina/Cordoba', public_booking_enabled: true
	});
	ids.businessA = businessA.id;
	const businessB = await insertOne('businesses', {
		name: `${marker} B`, slug: `${marker.toLowerCase()}-b`, industry: 'odontology', timezone: 'America/Argentina/Cordoba', public_booking_enabled: true
	});
	ids.businessB = businessB.id;
	const { data: subscriptionRows, error: subscriptionError } = await admin
		.from('business_subscriptions')
		.select('business_id, commercial_access_enabled, is_permanent, subscription_status, paid_until, grace_until, restricted_until, archived_at')
		.in('business_id', [ids.businessA, ids.businessB]);
	if (subscriptionError) throw subscriptionError;
	console.log(`SUBSCRIPTIONS ${JSON.stringify(subscriptionRows)}`);
	const { error: activateError } = await admin
		.from('business_subscriptions')
		.update({ commercial_access_enabled: true, is_permanent: true, subscription_status: 'active', paid_until: null, grace_until: null, restricted_until: null, archived_at: null })
		.in('business_id', [ids.businessA, ids.businessB]);
	if (activateError) throw activateError;
	await insertOne('business_users', { business_id: ids.businessA, user_id: ids.userA, role: 'owner', status: 'active', accepted_at: new Date().toISOString() });
	await insertOne('business_users', { business_id: ids.businessB, user_id: ids.userB, role: 'owner', status: 'active', accepted_at: new Date().toISOString() });

	const profA = await insertOne('professionals', { business_id: ids.businessA, name: `${marker} Profesional A`, is_public: true, is_active: true });
	const profB = await insertOne('professionals', { business_id: ids.businessB, name: `${marker} Profesional B`, is_public: true, is_active: true });
	const serviceA = await insertOne('services', { business_id: ids.businessA, name: `${marker} Servicio A`, duration_minutes: 30, is_public: true, is_active: true });
	const serviceB = await insertOne('services', { business_id: ids.businessB, name: `${marker} Servicio B`, duration_minutes: 30, is_public: true, is_active: true });
	await insertOne('professional_services', { business_id: ids.businessA, professional_id: profA.id, service_id: serviceA.id });
	await insertOne('professional_services', { business_id: ids.businessB, professional_id: profB.id, service_id: serviceB.id });
	for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
		await insertOne('availability_rules', { business_id: ids.businessA, professional_id: profA.id, weekday, start_time: '08:00', end_time: '20:00', slot_interval_minutes: 30, is_active: true });
		await insertOne('availability_rules', { business_id: ids.businessB, professional_id: profB.id, weekday, start_time: '08:00', end_time: '20:00', slot_interval_minutes: 30, is_active: true });
	}
	const patientA = await insertOne('patients', { business_id: ids.businessA, owner_id: ids.userA, full_name: `${marker} Paciente A`, dni: `${Date.now()}1`, phone: '5491111111111', phone_raw: '+54 9 11 1111-1111', phone_e164: '+5491111111111' });
	const patientB = await insertOne('patients', { business_id: ids.businessB, owner_id: ids.userB, full_name: `${marker} Paciente B`, dni: `${Date.now()}2`, phone: '5491111111112', phone_raw: '+54 9 11 1111-1112', phone_e164: '+5491111111112' });
	ids.patientA = patientA.id;
	ids.patientB = patientB.id;
	await insertOne('patient_clinical_profiles', { business_id: ids.businessB, patient_id: ids.patientB, allergies: `${marker} allergy`, medication: `${marker} medication`, background: `${marker} background`, created_by: ids.userB, updated_by: ids.userB });
	const entryB = await insertOne('clinical_entries', { business_id: ids.businessB, owner_id: ids.userB, patient_id: ids.patientB, entry_type: 'Consulta', description: `${marker} clinical entry`, created_at: new Date().toISOString() });
	ids.entryB = entryB.id;
	const { date: appointmentDate, localDate, localTime } = dateParts(8);
	const appointmentRpc = await admin.rpc('create_appointment_with_patient_identity', {
		p_business_id: ids.businessB,
		p_patient_mode: 'existing', p_patient_id: ids.patientB, p_patient_name: null,
		p_patient_phone_raw: '+54 9 11 1111-1112', p_patient_phone_e164: '+5491111111112', p_patient_email: null,
		p_update_existing_phone: false, p_owner_id: ids.userB, p_service_id: serviceB.id, p_professional_ids: [profB.id],
		p_starts_at: appointmentDate.toISOString(), p_internal_note: `${marker} appointment`, p_created_by_user_id: ids.userB,
		p_ignore_break: false, p_source: 'manual', p_phone_communication_status: 'valid', p_phone_warning_acknowledged: false,
		p_idempotency_key: randomUUID(), p_replay_only: false
	});
	if (appointmentRpc.error || !appointmentRpc.data?.[0]?.id) throw appointmentRpc.error || new Error('appointment B not created');
	ids.appointmentB = appointmentRpc.data[0].id;

	browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ baseURL: baseUrl });
	const page = await context.newPage();
	await page.goto('/login', { waitUntil: 'domcontentloaded' });
	await page.getByLabel('Correo electrónico').fill(emailA);
	await page.getByLabel('Contraseña').fill(passwordA);
	await page.locator('form').getByRole('button', { name: 'Ingresar', exact: true }).click();
	await page.waitForURL(/\/odonto(?:\/agenda)?(?:\?|$)/, { timeout: 20_000 });
	await page.goto('/odonto/agenda', { waitUntil: 'domcontentloaded' });
	assert('IDOR setup owner A session', page.url().includes('/odonto/agenda'), page.url());

	const postAction = async (pathName, action, fields = {}) => {
		return await page.evaluate(async ({ pathName, action, fields }) => {
			const body = new URLSearchParams();
			for (const [key, value] of Object.entries(fields)) body.set(key, String(value));
			const response = await fetch(`${pathName}?/${action}`, {
				method: 'POST', body, redirect: 'manual',
				headers: { accept: 'application/json' }
			});
			return { status: response.status, location: response.headers.get('location'), body: (await response.text()).slice(0, 500) };
		}, { pathName, action, fields });
	};
	const actionRejected = (response) => {
		if (response.status >= 400 && response.status < 500) return true;
		try {
			const parsed = JSON.parse(response.body);
			return parsed?.type === 'failure' || parsed?.type === 'error';
		} catch {
			return /No encontramos|no pudimos|no pudo|no tenés|no permite|por seguridad|inválid|no se pudo/i.test(response.body);
		}
	};
	const actionDetail = (response) => `HTTP ${response.status}; ${response.body.replace(/\s+/g, ' ').slice(0, 220)}`;

	const beforePatientB = await getRow('patients', ids.patientB, 'id, business_id, full_name, dni, phone, archived_at, updated_at');
	const beforeProfileB = await getRow('patient_clinical_profiles', ids.patientB, 'id, allergies, medication, background, updated_at');
	const beforeEntryB = await getRow('clinical_entries', ids.entryB, 'id, business_id, description, entry_type, created_at');
	const beforeAppointmentB = await getRow('appointments', ids.appointmentB, 'id, business_id, status, starts_at, ends_at, cancelled_at, reschedule_requested_at');

	const updatePatient = await postAction(`/odonto/pacientes/${ids.patientB}`, 'update_patient', {
		full_name: `${marker} HACKED`, dni: '99999999', phone: '+5491199999999', birth_date: '', email: 'idor@example.invalid',
		allergies: `${marker} changed`, medication: `${marker} changed`, background: `${marker} changed`, address: 'changed', insurance: 'changed', insurance_plan: 'changed'
	});
	assert('IDOR update patient B rejected', actionRejected(updatePatient), actionDetail(updatePatient));
	const addEntry = await postAction(`/odonto/pacientes/${ids.patientB}`, 'add_entry', { entry_type: 'Consulta', description: `${marker} unauthorized`, created_at: `${localDate}T11:00`, teeth: '11' });
	assert('IDOR add clinical entry B rejected', actionRejected(addEntry), actionDetail(addEntry));
	const updateEntry = await postAction(`/odonto/pacientes/${ids.patientB}`, 'update_entry', { entry_id: ids.entryB, entry_type: 'Consulta', description: `${marker} unauthorized update`, created_at: `${localDate}T11:00`, teeth: '12' });
	assert('IDOR update clinical entry B rejected', actionRejected(updateEntry), actionDetail(updateEntry));
	const archive = await postAction(`/odonto/pacientes/${ids.patientB}`, 'archive_patient');
	assert('IDOR archive patient B rejected', actionRejected(archive), actionDetail(archive));
	const unarchive = await postAction(`/odonto/pacientes/${ids.patientB}`, 'unarchive_patient');
	assert('IDOR unarchive patient B rejected', actionRejected(unarchive), actionDetail(unarchive));
	const deletePatient = await postAction(`/odonto/pacientes/${ids.patientB}`, 'delete_patient');
	assert('IDOR delete patient B rejected', actionRejected(deletePatient), actionDetail(deletePatient));

	const createAppointment = await postAction('/odonto/agenda', 'create_appointment', {
		service_id: serviceB.id, professional_id: profB.id, professional_ids: profB.id, booking_mode: 'individual', date: localDate, time: localTime,
		patient_mode: 'existing', patient_id: ids.patientB, patient_name: '', patient_phone: '', patient_email: '', patient_phone_changed: 'false',
		idempotency_key: randomUUID(), internal_note: `${marker} unauthorized appointment`
	});
	assert('IDOR create appointment with B resources rejected', actionRejected(createAppointment), actionDetail(createAppointment));
	const updateStatus = await postAction(`/odonto/turnos/${ids.appointmentB}`, 'update_status', { status: 'cancelled', reason: `${marker} unauthorized` });
	assert('IDOR update appointment B rejected', actionRejected(updateStatus), actionDetail(updateStatus));
	const reschedule = await postAction(`/odonto/turnos/${ids.appointmentB}`, 'reschedule', { reprogram_date: localDate, slot_starts_at: appointmentDate.toISOString(), ignore_break: 'false' });
	assert('IDOR reschedule appointment B rejected', actionRejected(reschedule), actionDetail(reschedule));

	const afterPatientB = await getRow('patients', ids.patientB, 'id, business_id, full_name, dni, phone, archived_at, updated_at');
	const afterProfileB = await getRow('patient_clinical_profiles', ids.patientB, 'id, allergies, medication, background, updated_at');
	const afterEntryB = await getRow('clinical_entries', ids.entryB, 'id, business_id, description, entry_type, created_at');
	const afterAppointmentB = await getRow('appointments', ids.appointmentB, 'id, business_id, status, starts_at, ends_at, cancelled_at, reschedule_requested_at');
	assert('IDOR patient B unchanged', JSON.stringify(afterPatientB) === JSON.stringify(beforePatientB), 'before/after exact row comparison');
	assert('IDOR clinical profile B unchanged', JSON.stringify(afterProfileB) === JSON.stringify(beforeProfileB), 'before/after exact row comparison');
	assert('IDOR clinical entry B unchanged', JSON.stringify(afterEntryB) === JSON.stringify(beforeEntryB), 'before/after exact row comparison');
	assert('IDOR appointment B unchanged', JSON.stringify(afterAppointmentB) === JSON.stringify(beforeAppointmentB), 'before/after exact row comparison');

	await context.close();
} finally {
	if (browser) await browser.close().catch(() => {});
	if (ids.businessA) await admin.from('businesses').delete().eq('id', ids.businessA);
	if (ids.businessB) await admin.from('businesses').delete().eq('id', ids.businessB);
	if (ids.userA) await admin.auth.admin.deleteUser(ids.userA).catch(() => {});
	if (ids.userB) await admin.auth.admin.deleteUser(ids.userB).catch(() => {});
}

const failed = results.filter((result) => !result.pass);
console.log(`SUMMARY passed=${results.length - failed.length} failed=${failed.length} total=${results.length}`);
if (failed.length) process.exitCode = 1;
