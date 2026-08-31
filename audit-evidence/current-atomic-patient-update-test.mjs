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
	auth: { autoRefreshToken: false, persistSession: false },
	realtime: { transport: WebSocket }
});
const marker = `ATOMIC_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const password = `Aa!${randomUUID()}z`;
const actorEmail = `audit-atomic-actor-${marker.toLowerCase()}@example.invalid`;
const outsiderEmail = `audit-atomic-outsider-${marker.toLowerCase()}@example.invalid`;
const checks = [];
const pass = (name, detail = '') => { checks.push(true); console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`); };
const fail = (name, detail = '') => { checks.push(false); console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); };
const insertOne = async (table, row) => {
	const { data, error } = await admin.from(table).insert(row).select().single();
	if (error) throw new Error(`${table}: ${error.message}`);
	return data;
};
const profileArgs = (businessId, patientId, actorId, expectedPatient, expectedProfile, name, allergy) => ({
	p_actor_id: actorId,
	p_business_id: businessId,
	p_patient_id: patientId,
	p_full_name: name,
	p_dni: null,
	p_phone: '+5491100000000',
	p_phone_raw: '+54 9 11 0000-0000',
	p_phone_e164: '+5491100000000',
	p_email: null,
	p_birth_date: '1980-01-02',
	p_address: null,
	p_insurance: null,
	p_insurance_plan: null,
	p_update_clinical_profile: true,
	p_allergies: allergy,
	p_medication: null,
	p_background: null,
	p_expected_patient_updated_at: expectedPatient,
	p_expected_clinical_profile_updated_at: expectedProfile
});
const expectedArgsFor = async (businessId, patientId) => {
	const [{ data: patient, error: patientError }, { data: profile, error: profileError }] = await Promise.all([
		admin.from('patients').select('updated_at').eq('business_id', businessId).eq('id', patientId).single(),
		admin.from('patient_clinical_profiles').select('updated_at').eq('business_id', businessId).eq('patient_id', patientId).maybeSingle()
	]);
	if (patientError) throw patientError;
	if (profileError) throw profileError;
	return { patient: patient.updated_at, profile: profile?.updated_at ?? null };
};

let actorId = null;
let outsiderId = null;
let businessId = null;
let patientId = null;
let secondPatientId = null;
try {
	const actor = await admin.auth.admin.createUser({ email: actorEmail, password, email_confirm: true });
	if (actor.error || !actor.data.user) throw actor.error ?? new Error('actor auth creation failed');
	actorId = actor.data.user.id;
	const outsider = await admin.auth.admin.createUser({ email: outsiderEmail, password, email_confirm: true });
	if (outsider.error || !outsider.data.user) throw outsider.error ?? new Error('outsider auth creation failed');
	outsiderId = outsider.data.user.id;

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
	await insertOne('business_users', {
		business_id: businessId, user_id: actorId, role: 'owner', status: 'active', accepted_at: new Date().toISOString()
	});

	const patient = await insertOne('patients', {
		business_id: businessId, owner_id: actorId, full_name: `${marker} Original`, phone: '+5491100000000',
		phone_raw: '+54 9 11 0000-0000', phone_e164: '+5491100000000'
	});
	patientId = patient.id;
	const profile = await insertOne('patient_clinical_profiles', {
		business_id: businessId, patient_id: patientId, allergies: `${marker} Allergy 0`,
		created_by: actorId, updated_by: actorId
	});

	const baselineExpected = await expectedArgsFor(businessId, patientId);
	const baseline = await admin.rpc('update_patient_with_clinical_profile_safely', profileArgs(
		businessId, patientId, actorId, baselineExpected.patient, baselineExpected.profile,
		`${marker} Baseline`, `${marker} Allergy baseline`
	));
	const baselineRow = Array.isArray(baseline.data) ? baseline.data[0] : baseline.data;
	if (!baseline.error && baselineRow?.patient_id === patientId && baselineRow?.clinical_profile_id === profile.id) {
		pass('RPC atómica actualiza paciente y perfil en una única operación');
	} else {
		fail('RPC atómica actualiza paciente y perfil en una única operación', baseline.error?.message ?? JSON.stringify(baseline.data));
	}

	const raceExpected = await expectedArgsFor(businessId, patientId);
	const racePayloads = [
		{ name: `${marker} Race A`, allergy: `${marker} Allergy A` },
		{ name: `${marker} Race B`, allergy: `${marker} Allergy B` }
	];
	const raceResponses = await Promise.all(racePayloads.map((payload) => admin.rpc(
		'update_patient_with_clinical_profile_safely',
		profileArgs(businessId, patientId, actorId, raceExpected.patient, raceExpected.profile, payload.name, payload.allergy)
	)));
	const raceSuccesses = raceResponses.filter((result) => !result.error && (Array.isArray(result.data) ? result.data[0]?.patient_id : result.data?.patient_id));
	const raceConflicts = raceResponses.filter((result) => result.error?.message?.includes('PATIENT_UPDATE_CONFLICT'));
	const { data: finalPatient, error: finalPatientError } = await admin.from('patients').select('full_name').eq('business_id', businessId).eq('id', patientId).single();
	const { data: finalProfile, error: finalProfileError } = await admin.from('patient_clinical_profiles').select('allergies').eq('business_id', businessId).eq('patient_id', patientId).single();
	const winnerIndex = raceResponses.findIndex((result) => !result.error);
	const winnerPayload = racePayloads[winnerIndex];
	const pairMatches = Boolean(winnerPayload && finalPatient?.full_name === winnerPayload.name && finalProfile?.allergies === winnerPayload.allergy);
	if (raceSuccesses.length === 1 && raceConflicts.length === 1 && pairMatches && !finalPatientError && !finalProfileError) {
		pass('dos ediciones concurrentes: una gana, una entra en conflicto y paciente/perfil quedan emparejados');
	} else {
		fail('dos ediciones concurrentes: una gana, una entra en conflicto y paciente/perfil quedan emparejados', JSON.stringify({ success: raceSuccesses.length, conflicts: raceConflicts.length, pairMatches, finalPatientError: finalPatientError?.message, finalProfileError: finalProfileError?.message }));
	}

	const secondPatient = await insertOne('patients', {
		business_id: businessId, owner_id: actorId, full_name: `${marker} Sin Perfil`, phone: '+5491100000001',
		phone_raw: '+54 9 11 0000-0001', phone_e164: '+5491100000001'
	});
	secondPatientId = secondPatient.id;
	const secondExpected = await expectedArgsFor(businessId, secondPatientId);
	const createProfile = await admin.rpc('update_patient_with_clinical_profile_safely', profileArgs(
		businessId, secondPatientId, actorId, secondExpected.patient, secondExpected.profile,
		`${marker} Perfil Creado`, `${marker} Allergy created`
	));
	const { data: createdProfile, error: createdProfileError } = await admin.from('patient_clinical_profiles').select('patient_id,allergies').eq('business_id', businessId).eq('patient_id', secondPatientId).maybeSingle();
	if (!createProfile.error && !createdProfileError && createdProfile?.patient_id === secondPatientId && createdProfile.allergies === `${marker} Allergy created`) {
		pass('RPC atómica crea el perfil clínico faltante sin dejar ficha a medias');
	} else {
		fail('RPC atómica crea el perfil clínico faltante sin dejar ficha a medias', createProfile.error?.message ?? createdProfileError?.message ?? JSON.stringify(createdProfile));
	}

	const denied = await admin.rpc('update_patient_with_clinical_profile_safely', profileArgs(
		businessId, patientId, outsiderId, null, null, `${marker} Intruso`, `${marker} Intruso`
	));
	if (denied.error?.message?.includes('PATIENT_UPDATE_DENIED')) pass('actor sin membresía no puede invocar la RPC atómica');
	else fail('actor sin membresía no puede invocar la RPC atómica', denied.error?.message ?? 'la llamada fue aceptada');
} catch (error) {
	console.error(`ERROR atomic test: ${error?.message ?? error}`);
	checks.push(false);
} finally {
	if (businessId) {
		try {
			await admin.from('businesses').delete().eq('id', businessId);
		} catch {
			// La limpieza se verifica aparte si el proveedor devuelve un error de red.
		}
	}
	if (actorId) await admin.auth.admin.deleteUser(actorId).catch(() => {});
	if (outsiderId) await admin.auth.admin.deleteUser(outsiderId).catch(() => {});
}

const failed = checks.filter((ok) => !ok).length;
console.log(`SUMMARY passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exitCode = 1;
