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
Object.assign(env, process.env);

const admin = createClient(env.ODONTO_SUPABASE_URL, env.ODONTO_SUPABASE_SERVICE_ROLE_KEY, {
	auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: WebSocket }
});
const marker = `FUTAB_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const password = `Ff!${randomUUID()}z`;
const ownerEmail = `audit-follow-owner-${marker.toLowerCase()}@example.invalid`;
const readonlyEmail = `audit-follow-readonly-${marker.toLowerCase()}@example.invalid`;
const checks = [];
const pass = (name, detail = '') => { checks.push(true); console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`); };
const fail = (name, detail = '') => { checks.push(false); console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); };
const insertOne = async (table, row) => {
	const { data, error } = await admin.from(table).insert(row).select().single();
	if (error) throw new Error(`${table}: ${error.message}`);
	return data;
};
const is2xx = (status) => status >= 200 && status < 300;
const apiRequest = async (accessToken, method, url, body) => {
	const response = await fetch(`${env.ODONTO_SUPABASE_URL}/rest/v1/${url}`, {
		method,
		headers: {
			apikey: env.ODONTO_SUPABASE_ANON_KEY,
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
			Prefer: 'return=representation'
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	return { status: response.status, body: (await response.text()).slice(0, 300) };
};

let ownerId = null;
let readonlyId = null;
let businessId = null;
let patientId = null;
let followUpId = null;
try {
	const owner = await admin.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true });
	if (owner.error || !owner.data.user) throw owner.error ?? new Error('owner creation failed');
	ownerId = owner.data.user.id;
	const readonly = await admin.auth.admin.createUser({ email: readonlyEmail, password, email_confirm: true });
	if (readonly.error || !readonly.data.user) throw readonly.error ?? new Error('readonly creation failed');
	readonlyId = readonly.data.user.id;
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
	await insertOne('business_users', { business_id: businessId, user_id: readonlyId, role: 'readonly', status: 'active', accepted_at: new Date().toISOString() });
	const patient = await insertOne('patients', {
		business_id: businessId, owner_id: ownerId, full_name: `${marker} Paciente`, phone: '+5491100000000',
		phone_raw: '+54 9 11 0000-0000', phone_e164: '+5491100000000'
	});
	patientId = patient.id;
	const followUp = await insertOne('follow_ups', {
		business_id: businessId, patient_id: patientId, assigned_professional_id: null,
		remind_on: '2099-01-02', message: `${marker} Mensaje privado`, status: 'pending', created_by: ownerId
	});
	followUpId = followUp.id;
	const userClient = createClient(env.ODONTO_SUPABASE_URL, env.ODONTO_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: WebSocket } });
	const signIn = await userClient.auth.signInWithPassword({ email: readonlyEmail, password });
	if (signIn.error || !signIn.data.session) throw signIn.error ?? new Error('readonly sign-in failed');
	const token = signIn.data.session.access_token;

	const read = await apiRequest(token, 'GET', `follow_ups?business_id=eq.${businessId}&select=id,patient_id,message`);
	const insert = await apiRequest(token, 'POST', 'follow_ups', {
		business_id: businessId, patient_id: patientId, assigned_professional_id: null,
		remind_on: '2099-01-03', message: `${marker} Escritura no autorizada`, status: 'pending', created_by: readonlyId
	});
	const patch = await apiRequest(token, 'PATCH', `follow_ups?id=eq.${followUpId}`, { message: `${marker} Modificado por readonly` });
	const remove = await apiRequest(token, 'DELETE', `follow_ups?id=eq.${followUpId}`);
	console.log(`FOLLOWUP_DIRECT_RLS ${JSON.stringify({ read: read.status, insert: insert.status, patch: patch.status, remove: remove.status })}`);
	const readDenied = !is2xx(read.status) && !read.body.includes(marker);
	if (readDenied) pass('estado actual: readonly no puede leer seguimientos por REST');
	else fail('estado actual: readonly no puede leer seguimientos por REST', `${read.status} ${read.body}`);
	if (!is2xx(insert.status) && !is2xx(patch.status) && !is2xx(remove.status)) pass('estado actual: readonly no puede insertar, modificar ni borrar por REST');
	else fail('estado actual: readonly no puede insertar, modificar ni borrar por REST', JSON.stringify({ insert, patch, remove }));
} catch (error) {
	console.error(`ERROR follow-up RLS test: ${error?.message ?? error}`);
	checks.push(false);
} finally {
	if (businessId) {
		try { await admin.from('businesses').delete().eq('id', businessId); } catch {}
	}
	if (ownerId) await admin.auth.admin.deleteUser(ownerId).catch(() => {});
	if (readonlyId) await admin.auth.admin.deleteUser(readonlyId).catch(() => {});
}
const failed = checks.filter((ok) => !ok).length;
console.log(`SUMMARY passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exitCode = 1;
