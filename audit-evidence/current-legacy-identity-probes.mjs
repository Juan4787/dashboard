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
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		value = value.slice(1, -1);
	}
	env[match[1]] = value;
}
Object.assign(env, process.env);

const clientOptions = {
	auth: { autoRefreshToken: false, persistSession: false },
	realtime: { transport: WebSocket }
};
const admin = createClient(env.ODONTO_SUPABASE_URL, env.ODONTO_SUPABASE_SERVICE_ROLE_KEY, clientOptions);
const makeAnon = () => createClient(env.ODONTO_SUPABASE_URL, env.ODONTO_SUPABASE_ANON_KEY, clientOptions);
const marker = `LEGACYPROBE_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`.toLowerCase();
const password = `Aa!${randomUUID()}z`;
const attackerEmail = `${marker}-attacker@example.invalid`;
const ownerEmail = `${marker}-owner@example.invalid`;
const victimEmail = `${marker}-victim@example.invalid`;
const checks = [];
const pass = (name, detail = '') => {
	checks.push(true);
	console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
};
const fail = (name, detail = '') => {
	checks.push(false);
	console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
};
const insertOne = async (table, row) => {
	const result = await admin.from(table).insert(row).select().single();
	if (result.error) throw new Error(`${table}: ${result.error.message}`);
	return result.data;
};
const denied = (result) => Boolean(result.error) || result.data == null || (Array.isArray(result.data) && result.data.length === 0);

let attackerId = null;
let ownerId = null;
let victimId = null;
let businessA = null;
let businessB = null;
let inviteId = null;
try {
	for (const [email, label] of [[attackerEmail, 'attacker'], [ownerEmail, 'owner'], [victimEmail, 'victim']]) {
		const result = await admin.auth.admin.createUser({ email, password, email_confirm: true });
		if (result.error || !result.data.user?.id) throw result.error ?? new Error(`${label} creation failed`);
		if (label === 'attacker') attackerId = result.data.user.id;
		if (label === 'owner') ownerId = result.data.user.id;
		if (label === 'victim') victimId = result.data.user.id;
	}
	const baseBusiness = (suffix) => ({
		name: `${marker} ${suffix}`,
		slug: `${marker}-${suffix}`,
		industry: 'odontology',
		timezone: 'America/Argentina/Cordoba',
		public_booking_enabled: true,
		allow_same_day_booking: true,
		min_booking_notice_minutes: 0,
		max_booking_days_ahead: 90
	});
	businessA = (await insertOne('businesses', baseBusiness('a'))).id;
	businessB = (await insertOne('businesses', baseBusiness('b'))).id;
	for (const id of [businessA, businessB]) {
		const subscription = await admin.from('business_subscriptions').update({
			commercial_access_enabled: true,
			is_permanent: true,
			subscription_status: 'active',
			paid_until: null,
			grace_until: null,
			restricted_until: null,
			archived_at: null
		}).eq('business_id', id);
		if (subscription.error) throw subscription.error;
	}
	await insertOne('business_users', { business_id: businessA, user_id: attackerId, role: 'owner', status: 'active', accepted_at: new Date().toISOString() });
	await insertOne('business_users', { business_id: businessB, user_id: ownerId, role: 'owner', status: 'active', accepted_at: new Date().toISOString() });
	await insertOne('allowed_emails', { email: ownerEmail, enabled: true, created_by: attackerId, updated_by: attackerId });
	await insertOne('patients', { business_id: businessB, owner_id: ownerId, full_name: `${marker} patient`, phone_e164: '+5491100000000' });
	const invite = await insertOne('business_user_invites', {
		business_id: businessB,
		email: victimEmail,
		role: 'reception',
		status: 'pending',
		invited_by: ownerId,
		expires_at: new Date(Date.now() + 86_400_000).toISOString()
	});
	inviteId = invite.id;

	const attacker = makeAnon();
	const login = await attacker.auth.signInWithPassword({ email: attackerEmail, password });
	if (login.error) throw login.error;

	const countsBusiness = await attacker.rpc('patients_counts_by_business', { p_business: businessB });
	const countsOwner = await attacker.rpc('patients_counts_by_owner', { p_owner: ownerId });
	const countValues = [countsBusiness.data?.[0], countsOwner.data?.[0]].filter(Boolean);
	const countLeak = countValues.some((row) => Number(row.total_count ?? 0) > 0 || Number(row.active_count ?? 0) > 0 || Number(row.archived_count ?? 0) > 0);
	if (!countLeak && (countsBusiness.error || countsOwner.error || countValues.length === 2)) {
		pass('contadores heredados no revelan pacientes de otro consultorio');
	} else {
		fail('contadores heredados', JSON.stringify({ businessError: countsBusiness.error?.code ?? null, ownerError: countsOwner.error?.code ?? null, countValues }));
	}

	const commercial = await attacker.rpc('business_commercial_status', { target_business_id: businessB });
	const ownerProbe = await attacker.rpc('user_is_active_owner', { target_business_id: businessB, target_user_id: ownerId });
	const ownerCount = await attacker.rpc('count_active_business_owners', { target_business_id: businessB });
	if (denied(commercial) && denied(ownerProbe) && denied(ownerCount)) {
		pass('sondas heredadas de estado comercial/dueño revocadas');
	} else {
		fail('sondas heredadas de estado comercial/dueño', JSON.stringify({ commercial: commercial.error?.code ?? null, ownerProbe: ownerProbe.error?.code ?? null, ownerCount: ownerCount.error?.code ?? null }));
	}

	const acceptance = await attacker.rpc('accept_pending_business_invites_for_user', {
		p_email: victimEmail,
		p_user_id: victimId
	});
	const inviteAfter = await admin.from('business_user_invites').select('status,accepted_user_id').eq('id', inviteId).maybeSingle();
	if (denied(acceptance) && inviteAfter.data?.status === 'pending' && inviteAfter.data?.accepted_user_id == null) {
		pass('unauthorized caller no puede aceptar una invitación ajena');
	} else {
		fail('aceptación de invitación ajena', JSON.stringify({ denied: denied(acceptance), inviteStatus: inviteAfter.data?.status ?? null }));
	}
} catch (error) {
	console.error(`ERROR legacy identity probes: ${error?.message ?? error}`);
	checks.push(false);
} finally {
	for (const id of [businessA, businessB].filter(Boolean)) {
		const result = await admin.from('businesses').delete().eq('id', id);
		if (result.error) console.error(`cleanup business failed: ${result.error.message}`);
	}
	// allowed_emails conserva referencias de auditoría con ON DELETE NO ACTION;
	// se elimina por los correos sintéticos antes de borrar usuarios de Auth.
	const allowed = await admin.from('allowed_emails').delete().in('email', [attackerEmail, ownerEmail, victimEmail]);
	if (allowed.error) console.error(`cleanup allowed_emails failed: ${allowed.error.message}`);
	for (const id of [attackerId, ownerId, victimId].filter(Boolean)) {
		const result = await admin.auth.admin.deleteUser(id);
		if (result.error) console.error(`cleanup auth user failed: ${result.error.message}`);
	}
}

const failed = checks.filter((value) => !value).length;
console.log(`SUMMARY passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exitCode = 1;
