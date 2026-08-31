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
const marker = `PLPOL_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const email = `${marker.toLowerCase()}@example.invalid`;
const password = `Aa!${randomUUID()}z`;
let userId;
let businessId;
let professionalId;
let patientId;
let linkId;
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

try {
	const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
	if (created.error || !created.data.user) throw created.error ?? new Error('professional user creation failed');
	userId = created.data.user.id;
	businessId = (await insert('businesses', {
		name: marker,
		slug: marker.toLowerCase(),
		industry: 'odontology',
		timezone: 'America/Argentina/Cordoba',
		public_booking_enabled: true
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
		role: 'professional',
		status: 'active',
		accepted_at: new Date().toISOString()
	});
	professionalId = (await insert('professionals', {
		business_id: businessId,
		name: marker,
		is_active: true,
		is_public: true
	})).id;
	await insert('professional_users', { business_id: businessId, professional_id: professionalId, user_id: userId });
	patientId = (await insert('patients', {
		business_id: businessId,
		owner_id: userId,
		full_name: `${marker} paciente`,
		phone_e164: '+5491111111111'
	})).id;
	linkId = (await insert('professional_patient_links', {
		business_id: businessId,
		professional_id: professionalId,
		patient_id: patientId,
		source: 'manual',
		is_active: true
	})).id;

	const userClient = createClient(env.ODONTO_SUPABASE_URL, env.ODONTO_SUPABASE_ANON_KEY, options);
	const session = await userClient.auth.signInWithPassword({ email, password });
	if (session.error) throw session.error;
	const activeRead = await userClient
		.from('professional_patient_links')
		.select('id,patient_id,is_active')
		.eq('business_id', businessId);
	record('profesional lee su vínculo activo', !activeRead.error && activeRead.data?.length === 1);

	const archived = await admin
		.from('professional_patient_links')
		.update({ is_active: false, archived_at: new Date().toISOString() })
		.eq('id', linkId);
	if (archived.error) throw archived.error;
	const archivedRead = await userClient
		.from('professional_patient_links')
		.select('id,patient_id,is_active')
		.eq('business_id', businessId);
	record('profesional no enumera vínculos archivados', !archivedRead.error && archivedRead.data?.length === 0);

	const before = (await admin.from('professional_patient_links').select('id,is_active').eq('id', linkId).single()).data;
	const directUpdate = await userClient
		.from('professional_patient_links')
		.update({ is_active: true })
		.eq('id', linkId)
		.select('id')
		.maybeSingle();
	const afterUpdate = (await admin.from('professional_patient_links').select('id,is_active').eq('id', linkId).single()).data;
	// PostgREST puede responder 200 con cero filas cuando RLS filtra una
	// mutación; la condición relevante es que no devuelva ni cambie la fila.
	record('profesional no puede reactivar vínculo por PostgREST', !directUpdate.data && JSON.stringify(afterUpdate) === JSON.stringify(before));

	const restored = await admin
		.from('professional_patient_links')
		.update({ is_active: true, archived_at: null })
		.eq('id', linkId);
	if (restored.error) throw restored.error;
	const restricted = await admin
		.from('business_subscriptions')
		.update({ is_permanent: false, commercial_access_enabled: false, subscription_status: 'restricted' })
		.eq('business_id', businessId);
	if (restricted.error) throw restricted.error;
	const restrictedRead = await userClient
		.from('professional_patient_links')
		.select('id')
		.eq('business_id', businessId);
	record('profesional no lee vínculos con acceso comercial restringido', !restrictedRead.error && restrictedRead.data?.length === 0);
} finally {
	if (businessId) await admin.from('businesses').delete().eq('id', businessId);
	if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
}

const failed = checks.filter((ok) => !ok).length;
console.log(`SUMMARY passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exitCode = 1;
