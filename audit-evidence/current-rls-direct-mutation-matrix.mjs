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
const anon = () => createClient(env.ODONTO_SUPABASE_URL, env.ODONTO_SUPABASE_ANON_KEY, {
	auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: WebSocket }
});
const marker = `RLSM_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const emailA = `audit-rls-a-${marker.toLowerCase()}@example.invalid`;
const emailB = `audit-rls-b-${marker.toLowerCase()}@example.invalid`;
const passwordA = `Aa!${randomUUID()}z`;
const passwordB = `Bb!${randomUUID()}z`;
let userA = null;
let userB = null;
let userC = null;
let businessA = null;
let businessB = null;
let patientB = null;
let profileB = null;
let entryB = null;
let appointmentB = null;
let serviceB = null;
let professionalB = null;
let exceptionB = null;
let ruleB = null;
let membershipC = null;
let professionalUserLinkB = null;
let targetRoleEmail = null;
const checks = [];
const pass = (name, detail = '') => { checks.push(true); console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`); };
const fail = (name, detail = '') => { checks.push(false); console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); };
const insertOne = async (table, row) => {
	const { data, error } = await admin.from(table).insert(row).select().single();
	if (error) throw new Error(`${table}: ${error.message}`);
	return data;
};
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

try {
	const [createdA, createdB, createdC] = await Promise.all([
		admin.auth.admin.createUser({ email: emailA, password: passwordA, email_confirm: true }),
		admin.auth.admin.createUser({ email: emailB, password: passwordB, email_confirm: true }),
		admin.auth.admin.createUser({ email: `audit-rls-c-${marker.toLowerCase()}@example.invalid`, password: `Cc!${randomUUID()}z`, email_confirm: true })
	]);
	if (createdA.error || !createdA.data.user?.id) throw createdA.error ?? new Error('user A creation failed');
	if (createdB.error || !createdB.data.user?.id) throw createdB.error ?? new Error('user B creation failed');
	if (createdC.error || !createdC.data.user?.id) throw createdC.error ?? new Error('user C creation failed');
	userA = createdA.data.user.id;
	userB = createdB.data.user.id;
	userC = createdC.data.user.id;
	targetRoleEmail = `audit-rls-target-${marker.toLowerCase()}@example.invalid`;
	businessA = (await insertOne('businesses', { name: `${marker} A`, slug: `${marker.toLowerCase()}-a`, industry: 'odontology', timezone: 'America/Argentina/Cordoba', public_booking_enabled: true, allow_same_day_booking: true, min_booking_notice_minutes: 0, max_booking_days_ahead: 90 })).id;
	businessB = (await insertOne('businesses', { name: `${marker} B`, slug: `${marker.toLowerCase()}-b`, industry: 'odontology', timezone: 'America/Argentina/Cordoba', public_booking_enabled: true, allow_same_day_booking: true, min_booking_notice_minutes: 0, max_booking_days_ahead: 90 })).id;
	for (const businessId of [businessA, businessB]) {
		const { error } = await admin.from('business_subscriptions').update({ commercial_access_enabled: true, is_permanent: true, subscription_status: 'active', paid_until: null, grace_until: null, restricted_until: null, archived_at: null }).eq('business_id', businessId);
		if (error) throw error;
	}
	await insertOne('business_users', { business_id: businessA, user_id: userA, role: 'owner', status: 'active', accepted_at: new Date().toISOString() });
	await insertOne('business_users', { business_id: businessB, user_id: userB, role: 'owner', status: 'active', accepted_at: new Date().toISOString() });
	membershipC = (await insertOne('business_users', { business_id: businessB, user_id: userC, role: 'reception', status: 'active', accepted_at: new Date().toISOString() })).id;
	const professional = await insertOne('professionals', { business_id: businessB, name: `${marker} Profesional B`, is_public: true, is_active: true });
	professionalB = professional.id;
	professionalUserLinkB = (await insertOne('professional_users', { business_id: businessB, professional_id: professionalB, user_id: userC })).id;
	const service = await insertOne('services', { business_id: businessB, name: `${marker} Servicio B`, duration_minutes: 30, is_public: true, is_active: true });
	serviceB = service.id;
	await insertOne('professional_services', { business_id: businessB, professional_id: professionalB, service_id: serviceB });
	for (const weekday of [0, 1, 2, 3, 4, 5, 6]) await insertOne('availability_rules', { business_id: businessB, professional_id: professionalB, weekday, start_time: '08:00', end_time: '20:00', slot_interval_minutes: 30, is_active: true });
	ruleB = (await admin.from('availability_rules').select('id').eq('business_id', businessB).eq('professional_id', professionalB).limit(1).single()).data.id;
	exceptionB = (await insertOne('availability_exceptions', { business_id: businessB, professional_id: professionalB, starts_at: new Date(Date.now() + 20 * 86400000).toISOString(), ends_at: new Date(Date.now() + 20 * 86400000 + 3600000).toISOString(), type: 'extra_available', reason: `${marker} exception` })).id;
	patientB = (await insertOne('patients', { business_id: businessB, owner_id: userB, full_name: `${marker} Paciente B`, dni: `${Date.now()}8`, phone_raw: '+54 9 11 2222-2222', phone_e164: '+5491122222222' })).id;
	profileB = (await insertOne('patient_clinical_profiles', { business_id: businessB, patient_id: patientB, allergies: `${marker} allergy`, medication: `${marker} medication`, background: `${marker} background`, created_by: userB, updated_by: userB })).id;
	entryB = (await insertOne('clinical_entries', { business_id: businessB, owner_id: userB, patient_id: patientB, entry_type: 'Consulta', description: `${marker} entry`, created_at: new Date().toISOString() })).id;
	const appointmentResult = await admin.rpc('create_appointment_with_patient_identity', {
		p_business_id: businessB, p_patient_mode: 'existing', p_patient_id: patientB, p_patient_name: null,
		p_patient_phone_raw: '+54 9 11 2222-2222', p_patient_phone_e164: '+5491122222222', p_patient_email: null,
		p_update_existing_phone: false, p_owner_id: userB, p_service_id: serviceB, p_professional_ids: [professionalB],
		p_starts_at: new Date(Date.now() + 10 * 86400000).toISOString(), p_internal_note: `${marker} appointment`,
		p_created_by_user_id: userB, p_ignore_break: false, p_source: 'manual', p_phone_communication_status: 'valid',
		p_phone_warning_acknowledged: false, p_idempotency_key: randomUUID(), p_replay_only: false
	});
	if (appointmentResult.error || !appointmentResult.data?.[0]?.id) throw appointmentResult.error ?? new Error('appointment B creation failed');
	appointmentB = appointmentResult.data[0].id;

	const userClient = anon();
	const signIn = await userClient.auth.signInWithPassword({ email: emailA, password: passwordA });
	if (signIn.error) throw signIn.error;
	const directContext = await userClient.rpc('list_user_business_contexts');
	const contextBusinessIds = (directContext.data ?? []).map((row) => String(row?.business?.id ?? ''));
	if (!directContext.error && contextBusinessIds.length === 1 && contextBusinessIds[0] === businessA) pass('RPC de contexto entrega sólo tenant A al usuario A'); else fail('RPC de contexto aislado', directContext.error?.message ?? JSON.stringify({ contextBusinessIds }));
	const role = await userClient.rpc('user_business_role', { target_business_id: businessB });
	const access = await userClient.rpc('user_has_business_access', { target_business_id: businessB });
	const allows = await userClient.rpc('business_allows_operation', { target_business_id: businessB });
	const canManageUsers = await userClient.rpc('user_can_manage_users', { target_business_id: businessB });
	if (!role.error && role.data === null && !access.error && access.data === false && !canManageUsers.error && canManageUsers.data === false && !allows.error && allows.data === true) pass('RPC de autorización B: rol/acceso/gestión false y estado comercial true'); else fail('RPC de autorización B', JSON.stringify({ role: role.data, roleError: role.error?.message, access: access.data, accessError: access.error?.message, allows: allows.data, allowsError: allows.error?.message, canManageUsers: canManageUsers.data, canManageError: canManageUsers.error?.message }));
	const listMembers = await userClient.rpc('list_business_users', { target_business_id: businessB });
	if (listMembers.error && /denied|denegad|permission|permiso/i.test(listMembers.error.message ?? '')) pass('RPC list_business_users B rechazado'); else fail('RPC list_business_users B', JSON.stringify({ data: listMembers.data, error: listMembers.error?.message }));
	const listRoleAccess = await userClient.rpc('list_business_role_access', { target_business_id: businessB });
	if (listRoleAccess.error && /denied|denegad|permission|permiso/i.test(listRoleAccess.error.message ?? '')) pass('RPC list_business_role_access B rechazado'); else fail('RPC list_business_role_access B', JSON.stringify({ data: listRoleAccess.data, error: listRoleAccess.error?.message }));

	const patientBeforeSensitive = (await admin.from('patients').select('id,archived_at,drive_folder_id').eq('id', patientB).single()).data;
	const memberCBeforeSensitive = (await admin.from('business_users').select('id,role,status,accepted_at,disabled_at,disabled_reason').eq('id', membershipC).single()).data;
	const profileBeforeSensitive = (await admin.from('patient_clinical_profiles').select('id,allergies,medication,background,clinical_alert_note,notes,custom_fields').eq('id', profileB).single()).data;
	const expectRpcDeniedUnchanged = async (name, args, table, idColumn, id, select, before, restore) => {
		const result = await userClient.rpc(name, args);
		const after = (await admin.from(table).select(select).eq(idColumn, id).maybeSingle()).data;
		const denied = Boolean(result.error) || result.data == null || (Array.isArray(result.data) && result.data.length === 0);
		const unchanged = sameJson(after, before);
		if (denied && unchanged) pass(`RPC ${name} B rechazado sin mutación`);
		else {
			if (restore) await restore();
			fail(`RPC ${name} B`, JSON.stringify({ data: result.data, error: result.error?.message ?? null, unchanged }));
		}
	};
	await expectRpcDeniedUnchanged('set_patient_archive_state_safely', { p_business_id: businessB, p_patient_id: patientB, p_archived: true }, 'patients', 'id', patientB, 'id,archived_at,drive_folder_id', patientBeforeSensitive, async () => { await admin.from('patients').update(patientBeforeSensitive).eq('id', patientB); });
	await expectRpcDeniedUnchanged('set_patient_drive_folder_safely', { p_business_id: businessB, p_patient_id: patientB, p_drive_folder_id: `${marker}-unauthorized-folder` }, 'patients', 'id', patientB, 'id,archived_at,drive_folder_id', patientBeforeSensitive, async () => { await admin.from('patients').update(patientBeforeSensitive).eq('id', patientB); });
	await expectRpcDeniedUnchanged('upsert_patient_clinical_profile_safely', { p_business_id: businessB, p_patient_id: patientB, p_allergies: `${marker}-unauthorized-allergy` }, 'patient_clinical_profiles', 'id', profileB, 'id,allergies,medication,background,clinical_alert_note,notes,custom_fields', profileBeforeSensitive, async () => { await admin.from('patient_clinical_profiles').update(profileBeforeSensitive).eq('id', profileB); });

	const driveFolderSet = await admin.from('patients').update({ drive_folder_id: `${marker}-secret-folder` }).eq('id', patientB);
	if (driveFolderSet.error) throw driveFolderSet.error;
	const driveFolderRead = await userClient.rpc('get_patient_drive_folder_safely', { p_business_id: businessB, p_patient_id: patientB });
	if (driveFolderRead.error && /denied|denegad|permission|permiso/i.test(driveFolderRead.error.message ?? '')) pass('RPC get_patient_drive_folder_safely B rechazado'); else fail('RPC get_patient_drive_folder_safely B', JSON.stringify({ data: driveFolderRead.data, error: driveFolderRead.error?.message ?? null }));
	const driveFolderClear = await userClient.rpc('clear_patient_drive_folders_safely', { p_business_id: businessB });
	const driveAfterClear = (await admin.from('patients').select('id,archived_at,drive_folder_id').eq('id', patientB).single()).data;
	if (driveFolderClear.error && sameJson(driveAfterClear, { ...patientBeforeSensitive, drive_folder_id: `${marker}-secret-folder` })) pass('RPC clear_patient_drive_folders_safely B rechazado sin mutación'); else {
		await admin.from('patients').update({ drive_folder_id: patientBeforeSensitive.drive_folder_id }).eq('id', patientB);
		fail('RPC clear_patient_drive_folders_safely B', JSON.stringify({ data: driveFolderClear.data, error: driveFolderClear.error?.message ?? null, after: driveAfterClear }));
	}
	await admin.from('patients').update({ drive_folder_id: patientBeforeSensitive.drive_folder_id }).eq('id', patientB);

	const linkBefore = (await admin.from('professional_patient_links').select('id,is_active,source,source_entity_id').eq('business_id', businessB).eq('professional_id', professionalB).eq('patient_id', patientB).maybeSingle()).data;
	const manualLink = await userClient.rpc('link_patient_to_professional_safely', { p_business_id: businessB, p_professional_id: professionalB, p_patient_id: patientB, p_reason: `${marker} unauthorized` });
	const linkAfter = (await admin.from('professional_patient_links').select('id,is_active,source,source_entity_id').eq('business_id', businessB).eq('professional_id', professionalB).eq('patient_id', patientB).maybeSingle()).data;
	if (manualLink.error && sameJson(linkAfter, linkBefore)) pass('RPC link_patient_to_professional_safely B rechazado sin mutación'); else {
		if (linkAfter?.id && !linkBefore) await admin.from('professional_patient_links').delete().eq('id', linkAfter.id);
		fail('RPC link_patient_to_professional_safely B', JSON.stringify({ data: manualLink.data, error: manualLink.error?.message ?? null, unchanged: sameJson(linkAfter, linkBefore) }));
	}

	if (professionalUserLinkB) {
		const removeFixtureLink = await admin.from('professional_users').delete().eq('id', professionalUserLinkB);
		if (removeFixtureLink.error) throw removeFixtureLink.error;
	}
	const professionalLinkCall = await userClient.rpc('link_professional_user_safely', { p_business_id: businessB, p_professional_id: professionalB, p_user_id: userC });
	const professionalLinkAfter = (await admin.from('professional_users').select('id,professional_id,user_id').eq('business_id', businessB).eq('professional_id', professionalB).eq('user_id', userC).maybeSingle()).data;
	if (professionalLinkCall.error && !professionalLinkAfter) pass('RPC link_professional_user_safely B rechazado sin mutación'); else {
		if (professionalLinkAfter?.id) await admin.from('professional_users').delete().eq('id', professionalLinkAfter.id);
		if (professionalUserLinkB) await admin.from('professional_users').insert({ id: professionalUserLinkB, business_id: businessB, professional_id: professionalB, user_id: userC });
		fail('RPC link_professional_user_safely B', JSON.stringify({ data: professionalLinkCall.data, error: professionalLinkCall.error?.message ?? null, linkId: professionalLinkAfter?.id }));
	}
	if (!professionalLinkAfter && professionalUserLinkB) {
		const restoreFixtureLink = await admin.from('professional_users').insert({ id: professionalUserLinkB, business_id: businessB, professional_id: professionalB, user_id: userC });
		if (restoreFixtureLink.error) throw restoreFixtureLink.error;
	}

	const roleChange = await userClient.rpc('change_business_user_role_safely', { p_membership_id: membershipC, p_role: 'admin' });
	const roleAfterChange = (await admin.from('business_users').select('id,role,status,accepted_at').eq('id', membershipC).single()).data;
	if (roleChange.error && roleAfterChange?.role === memberCBeforeSensitive.role && roleAfterChange?.status === memberCBeforeSensitive.status) pass('RPC change_business_user_role_safely B rechazado'); else {
		await admin.from('business_users').update({ role: memberCBeforeSensitive.role, status: memberCBeforeSensitive.status, accepted_at: memberCBeforeSensitive.accepted_at, disabled_at: memberCBeforeSensitive.disabled_at, disabled_reason: memberCBeforeSensitive.disabled_reason }).eq('id', membershipC);
		fail('RPC change_business_user_role_safely B', JSON.stringify({ data: roleChange.data, error: roleChange.error?.message ?? null, roleAfter: roleAfterChange }));
	}
	const disableMember = await userClient.rpc('disable_business_user_safely', { p_membership_id: membershipC, p_reason: `${marker} unauthorized` });
	const memberAfterDisable = (await admin.from('business_users').select('id,role,status,accepted_at').eq('id', membershipC).single()).data;
	if (disableMember.error && memberAfterDisable?.status === memberCBeforeSensitive.status) pass('RPC disable_business_user_safely B rechazado'); else {
		await admin.from('business_users').update({ role: memberCBeforeSensitive.role, status: memberCBeforeSensitive.status, accepted_at: memberCBeforeSensitive.accepted_at, disabled_at: memberCBeforeSensitive.disabled_at, disabled_reason: memberCBeforeSensitive.disabled_reason }).eq('id', membershipC);
		fail('RPC disable_business_user_safely B', JSON.stringify({ data: disableMember.data, error: disableMember.error?.message ?? null, memberAfter: memberAfterDisable }));
	}
	await admin.from('business_users').update({ role: memberCBeforeSensitive.role, status: memberCBeforeSensitive.status, accepted_at: memberCBeforeSensitive.accepted_at, disabled_at: memberCBeforeSensitive.disabled_at, disabled_reason: memberCBeforeSensitive.disabled_reason }).eq('id', membershipC);
	const removeMember = await userClient.rpc('remove_business_role_access', { target_access_id: membershipC });
	const memberAfterRemove = (await admin.from('business_users').select('id,role,status,accepted_at').eq('id', membershipC).maybeSingle()).data;
	if (removeMember.error && memberAfterRemove?.status === memberCBeforeSensitive.status) pass('RPC remove_business_role_access B rechazado'); else {
		await admin.from('business_users').update({ role: memberCBeforeSensitive.role, status: memberCBeforeSensitive.status, accepted_at: memberCBeforeSensitive.accepted_at, disabled_at: memberCBeforeSensitive.disabled_at, disabled_reason: memberCBeforeSensitive.disabled_reason }).eq('id', membershipC);
		fail('RPC remove_business_role_access B', JSON.stringify({ data: removeMember.data, error: removeMember.error?.message ?? null, memberAfter: memberAfterRemove }));
	}
	await admin.from('business_users').update({ role: memberCBeforeSensitive.role, status: memberCBeforeSensitive.status, accepted_at: memberCBeforeSensitive.accepted_at, disabled_at: memberCBeforeSensitive.disabled_at, disabled_reason: memberCBeforeSensitive.disabled_reason }).eq('id', membershipC);
	const updateRole = await userClient.rpc('update_business_role_access', { target_access_id: membershipC, target_role: 'admin' });
	const roleAfterUpdate = (await admin.from('business_users').select('id,role,status,accepted_at').eq('id', membershipC).single()).data;
	if (updateRole.error && roleAfterUpdate?.role === memberCBeforeSensitive.role) pass('RPC update_business_role_access B rechazado'); else {
		await admin.from('business_users').update({ role: memberCBeforeSensitive.role, status: memberCBeforeSensitive.status, accepted_at: memberCBeforeSensitive.accepted_at, disabled_at: memberCBeforeSensitive.disabled_at, disabled_reason: memberCBeforeSensitive.disabled_reason }).eq('id', membershipC);
		fail('RPC update_business_role_access B', JSON.stringify({ data: updateRole.data, error: updateRole.error?.message ?? null, roleAfter: roleAfterUpdate }));
	}
	await admin.from('business_users').update({ role: memberCBeforeSensitive.role, status: memberCBeforeSensitive.status, accepted_at: memberCBeforeSensitive.accepted_at, disabled_at: memberCBeforeSensitive.disabled_at, disabled_reason: memberCBeforeSensitive.disabled_reason }).eq('id', membershipC);
	const upsertRole = await userClient.rpc('upsert_business_role_access', { target_business_id: businessB, target_email: targetRoleEmail, target_role: 'reception', target_professional_id: null });
	const inviteAfterUpsert = (await admin.from('business_user_invites').select('id,business_id,email,status').eq('business_id', businessB).eq('email', targetRoleEmail).maybeSingle()).data;
	const allowedAfterUpsert = (await admin.from('allowed_emails').select('id,email,enabled').eq('email', targetRoleEmail).maybeSingle()).data;
	if (upsertRole.error && !inviteAfterUpsert && !allowedAfterUpsert) pass('RPC upsert_business_role_access B rechazado sin invitación'); else {
		if (inviteAfterUpsert?.id) await admin.from('business_user_invites').delete().eq('id', inviteAfterUpsert.id);
		if (allowedAfterUpsert?.id) await admin.from('allowed_emails').delete().eq('id', allowedAfterUpsert.id);
		fail('RPC upsert_business_role_access B', JSON.stringify({ data: upsertRole.data, error: upsertRole.error?.message ?? null, invite: inviteAfterUpsert, allowed: allowedAfterUpsert }));
	}
	const assignRole = await userClient.rpc('assign_business_role_to_email_safely', { target_business_id: businessB, target_email: targetRoleEmail, target_role: 'reception', target_professional_id: null, create_professional_profile: false });
	const inviteAfterAssign = (await admin.from('business_user_invites').select('id,business_id,email,status').eq('business_id', businessB).eq('email', targetRoleEmail).maybeSingle()).data;
	const allowedAfterAssign = (await admin.from('allowed_emails').select('id,email,enabled').eq('email', targetRoleEmail).maybeSingle()).data;
	if (assignRole.error && !inviteAfterAssign && !allowedAfterAssign) pass('RPC assign_business_role_to_email_safely B rechazado sin invitación'); else {
		if (inviteAfterAssign?.id) await admin.from('business_user_invites').delete().eq('id', inviteAfterAssign.id);
		if (allowedAfterAssign?.id) await admin.from('allowed_emails').delete().eq('id', allowedAfterAssign.id);
		fail('RPC assign_business_role_to_email_safely B', JSON.stringify({ data: assignRole.data, error: assignRole.error?.message ?? null, invite: inviteAfterAssign, allowed: allowedAfterAssign }));
	}

	const readTables = [
		['businesses', { id: businessB }], ['business_users', { business_id: businessB }], ['business_subscriptions', { business_id: businessB }],
		['professionals', { business_id: businessB }], ['services', { business_id: businessB }], ['professional_services', { business_id: businessB }],
		['availability_rules', { business_id: businessB }], ['availability_exceptions', { business_id: businessB }], ['patients', { business_id: businessB }],
		['patient_clinical_profiles', { business_id: businessB }], ['clinical_entries', { business_id: businessB }], ['appointments', { business_id: businessB }],
		['appointment_professionals', { business_id: businessB }], ['audit_logs', { business_id: businessB }], ['public_booking_attempts', { business_id: businessB }]
	];
	let readPasses = 0;
	for (const [table, filter] of readTables) {
		const column = Object.keys(filter)[0];
		const { data, error } = await userClient.from(table).select('*').eq(column, filter[column]).limit(5);
		const isolated = !error && (data ?? []).length === 0;
		if (isolated || (error && /permission|denied|forbidden|permiso|relation.*does not exist/i.test(error.message ?? ''))) readPasses += 1;
		else console.log(`READ_LEAK ${table} ${JSON.stringify({ dataCount: data?.length ?? null, error: error?.message ?? null })}`);
	}
	if (readPasses === readTables.length) pass(`lecturas RLS B aisladas (${readPasses}/${readTables.length})`); else fail(`lecturas RLS B aisladas (${readPasses}/${readTables.length})`);

	const snapshots = {
		business: (await admin.from('businesses').select('id,name').eq('id', businessB).single()).data,
		member: (await admin.from('business_users').select('id,role,status,accepted_at').eq('business_id', businessB).eq('user_id', userB).single()).data,
		professional: (await admin.from('professionals').select('id,name,is_active,is_public').eq('id', professionalB).single()).data,
		service: (await admin.from('services').select('id,name,duration_minutes,is_active,is_public').eq('id', serviceB).single()).data,
		rule: (await admin.from('availability_rules').select('id,start_time,end_time').eq('id', ruleB).single()).data,
		exception: (await admin.from('availability_exceptions').select('id,reason,type').eq('id', exceptionB).single()).data,
		patient: (await admin.from('patients').select('id,full_name,dni,phone_e164,archived_at').eq('id', patientB).single()).data,
		profile: (await admin.from('patient_clinical_profiles').select('id,allergies,medication,background').eq('id', profileB).single()).data,
		entry: (await admin.from('clinical_entries').select('id,description,entry_type').eq('id', entryB).single()).data,
		appointment: (await admin.from('appointments').select('id,status,starts_at,internal_note').eq('id', appointmentB).single()).data
	};
	const snapshotSelect = {
		business: 'id,name', member: 'id,role,status,accepted_at', professional: 'id,name,is_active,is_public',
		service: 'id,name,duration_minutes,is_active,is_public', rule: 'id,start_time,end_time',
		exception: 'id,reason,type', patient: 'id,full_name,dni,phone_e164,archived_at',
		profile: 'id,allergies,medication,background', entry: 'id,description,entry_type',
		appointment: 'id,status,starts_at,internal_note'
	};
	const updateCases = [
		['businesses', 'id', businessB, { name: `${marker} hacked business` }, 'business'],
		['professionals', 'id', professionalB, { name: `${marker} hacked professional` }, 'professional'],
		['services', 'id', serviceB, { name: `${marker} hacked service` }, 'service'],
		['availability_rules', 'id', ruleB, { start_time: '01:00' }, 'rule'],
		['availability_exceptions', 'id', exceptionB, { reason: `${marker} hacked exception` }, 'exception'],
		['patients', 'id', patientB, { full_name: `${marker} hacked patient` }, 'patient'],
		['patient_clinical_profiles', 'id', profileB, { allergies: `${marker} hacked allergy` }, 'profile'],
		['clinical_entries', 'id', entryB, { description: `${marker} hacked entry` }, 'entry'],
		['appointments', 'id', appointmentB, { internal_note: `${marker} hacked appointment` }, 'appointment']
	];
	let mutationPasses = 0;
	for (const [table, column, id, changes, snapshotKey] of updateCases) {
		const { data, error } = await userClient.from(table).update(changes).eq(column, id).select('*').maybeSingle();
		const after = (await admin.from(table).select(snapshotSelect[snapshotKey]).eq(column, id).maybeSingle()).data;
		const denied = !data && (Boolean(error) || data === null);
		if (denied && sameJson(after, snapshots[snapshotKey])) mutationPasses += 1;
		else {
			if (data) await admin.from(table).update(snapshots[snapshotKey]).eq(column, id);
			console.log(`MUTATION_LEAK ${table} ${JSON.stringify({ returned: Boolean(data), error: error?.message ?? null, unchanged: sameJson(after, snapshots[snapshotKey]) })}`);
		}
	}
	if (mutationPasses === updateCases.length) pass(`updates RLS B rechazados sin alterar filas (${mutationPasses}/${updateCases.length})`); else fail(`updates RLS B rechazados (${mutationPasses}/${updateCases.length})`);
	const memberUpdate = await userClient.from('business_users').update({ role: 'admin' }).eq('id', membershipC).select('id,role,status,accepted_at').maybeSingle();
	const memberAfterDirectUpdate = (await admin.from('business_users').select('id,role,status,accepted_at').eq('id', membershipC).single()).data;
	if (!memberUpdate.data && memberCBeforeSensitive && memberAfterDirectUpdate?.role === memberCBeforeSensitive.role && memberAfterDirectUpdate?.status === memberCBeforeSensitive.status) pass('update RLS de business_users B rechazado sin alterar fila'); else {
		await admin.from('business_users').update({ role: memberCBeforeSensitive.role, status: memberCBeforeSensitive.status, accepted_at: memberCBeforeSensitive.accepted_at, disabled_at: memberCBeforeSensitive.disabled_at, disabled_reason: memberCBeforeSensitive.disabled_reason }).eq('id', membershipC);
		fail('update RLS de business_users B', JSON.stringify({ data: memberUpdate.data, error: memberUpdate.error?.message ?? null, after: memberAfterDirectUpdate }));
	}

	const insertService = await userClient.from('services').insert({ business_id: businessB, name: `${marker} unauthorized service`, duration_minutes: 30, is_public: false, is_active: true }).select('id').maybeSingle();
	if (!insertService.data && (insertService.error || insertService.data === null)) pass('insert RLS de servicio en B rechazado'); else {
		if (insertService.data?.id) await admin.from('services').delete().eq('id', insertService.data.id);
		fail('insert RLS de servicio en B', insertService.error?.message ?? 'insert unexpectedly succeeded');
	}
	const deleteService = await userClient.from('services').delete().eq('id', serviceB).select('id').maybeSingle();
	const serviceAfterDelete = (await admin.from('services').select('id,name,duration_minutes,is_active,is_public').eq('id', serviceB).maybeSingle()).data;
	const deleteReturnedRows = Array.isArray(deleteService.data) ? deleteService.data.length > 0 : Boolean(deleteService.data);
	if (!deleteReturnedRows && sameJson(serviceAfterDelete, snapshots.service)) pass('delete RLS de servicio B rechazado sin pérdida'); else {
		if (!serviceAfterDelete) await admin.from('services').insert({ ...snapshots.service, business_id: businessB });
		fail('delete RLS de servicio B', deleteService.error?.message ?? JSON.stringify(deleteService.data));
	}
} finally {
	if (businessA) await admin.from('businesses').delete().eq('id', businessA);
	if (businessB) await admin.from('businesses').delete().eq('id', businessB);
	if (userA) await admin.auth.admin.deleteUser(userA).catch(() => {});
	if (userB) await admin.auth.admin.deleteUser(userB).catch(() => {});
	if (userC) await admin.auth.admin.deleteUser(userC).catch(() => {});
}
const failed = checks.filter((ok) => !ok).length;
console.log(`SUMMARY passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exitCode = 1;
