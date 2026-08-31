import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import WebSocket from '../apps/web/node_modules/ws/index.js';

const env = {};
for (const raw of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
	const line = raw.trim();
	if (!line || line.startsWith('#')) continue;
	const separator = line.indexOf('=');
	if (separator < 0) continue;
	let value = line.slice(separator + 1).trim();
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		value = value.slice(1, -1);
	}
	env[line.slice(0, separator).trim()] = value;
}
Object.assign(env, process.env);

const admin = createClient(env.ODONTO_SUPABASE_URL, env.ODONTO_SUPABASE_SERVICE_ROLE_KEY, {
	auth: { autoRefreshToken: false, persistSession: false },
	realtime: { transport: WebSocket }
});
const anonymousClient = () =>
	createClient(env.ODONTO_SUPABASE_URL, env.ODONTO_SUPABASE_ANON_KEY, {
		auth: { autoRefreshToken: false, persistSession: false },
		realtime: { transport: WebSocket }
	});

const marker = `OWNERPOL_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const email = `audit-owner-policy-${marker.toLowerCase()}@example.invalid`;
const password = `Oo!${randomUUID()}z`;
let userId = null;
let businessA = null;
let businessB = null;
let patientB = null;
const checks = [];
const record = (name, ok, detail = '') => {
	checks.push(ok);
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const insertOne = async (table, row) => {
	const result = await admin.from(table).insert(row).select().single();
	if (result.error) throw result.error;
	return result.data;
};

try {
	const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
	if (created.error || !created.data.user?.id) throw created.error ?? new Error('test user creation failed');
	userId = created.data.user.id;
	businessA = (
		await insertOne('businesses', {
			name: `${marker} A`,
			slug: `${marker.toLowerCase()}-a`,
			industry: 'odontology',
			timezone: 'UTC'
		})
	).id;
	businessB = (
		await insertOne('businesses', {
			name: `${marker} B`,
			slug: `${marker.toLowerCase()}-b`,
			industry: 'odontology',
			timezone: 'UTC'
		})
	).id;
	for (const businessId of [businessA, businessB]) {
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
	}
	await insertOne('business_users', {
		business_id: businessA,
		user_id: userId,
		role: 'owner',
		status: 'active',
		accepted_at: new Date().toISOString()
	});
	const client = anonymousClient();
	const signIn = await client.auth.signInWithPassword({ email, password });
	if (signIn.error) throw signIn.error;

	const patientInsert = await client
		.from('patients')
		.insert({
			business_id: businessB,
			owner_id: userId,
			full_name: `${marker} cross tenant`,
			dni: `${Date.now()}77`,
			phone_raw: '+5491100000077',
			phone_e164: '+5491100000077'
		})
		.select('id')
		.maybeSingle();
	record('paciente de otro consultorio no se puede insertar', Boolean(patientInsert.error) && !patientInsert.data, patientInsert.error?.code ?? 'unexpected success');

	const foreignPatient = await insertOne('patients', {
		business_id: businessB,
		owner_id: userId,
		full_name: `${marker} fixture`,
		dni: `${Date.now()}88`,
		phone_raw: '+5491100000088',
		phone_e164: '+5491100000088'
	});
	patientB = foreignPatient.id;
	const patientRead = await client.from('patients').select('id').eq('id', patientB).maybeSingle();
	record('paciente de otro consultorio no se puede leer', !patientRead.error && !patientRead.data, patientRead.error?.code ?? 'rowCount=0');

	const entryInsert = await client
		.from('clinical_entries')
		.insert({
			business_id: businessB,
			patient_id: patientB,
			owner_id: userId,
			created_by_user_id: userId,
			entry_type: 'Consulta',
			description: `${marker} unauthorized`,
			created_at: new Date().toISOString()
		})
		.select('id')
		.maybeSingle();
	record('ficha clínica de otro consultorio no se puede insertar', Boolean(entryInsert.error) && !entryInsert.data, entryInsert.error?.code ?? 'unexpected success');
} finally {
	if (businessA) await admin.from('businesses').delete().eq('id', businessA);
	if (businessB) await admin.from('businesses').delete().eq('id', businessB);
	if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
}

const failed = checks.filter((ok) => !ok).length;
console.log(`SUMMARY passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exitCode = 1;
