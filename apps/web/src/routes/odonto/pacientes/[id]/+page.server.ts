import { env } from '$env/dynamic/private';
import { resolveActiveBusiness } from '$lib/server/business';
import { newId, readDemoDb, updateDemoDb } from '$lib/server/demo-store';
import { normalizePhoneE164, normalizePhoneRaw } from '$lib/server/phone';
import { createSupabaseServerClient, getAuthUserId } from '$lib/server/supabase';
import { normalizePhone } from '$lib/utils/format';
import { parseMoneyInteger } from '$lib/utils/money-input';
import { fail, redirect, error as kitError } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { ClinicalEntry } from '$lib/types';

const getLatestEntryDate = (patientId: string, entries: { patient_id: string; created_at: string }[]) =>
	entries
		.filter((e) => e.patient_id === patientId)
		.reduce<string | null>((latest, entry) => (entry.created_at > (latest ?? '') ? entry.created_at : latest), null);

const normalizeFilename = (value?: string | null) => {
	const cleaned = String(value ?? '')
		.replace(/[\\/]/g, '')
		.trim();
	if (!cleaned) return null;
	return cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned;
};

const ENTRIES_PAGE_SIZE = 30;
const RADIOGRAPHS_PAGE_SIZE = 24;
const COMMERCIAL_RESTRICTED_MESSAGE =
	'Suscripción pendiente de regularización. Para volver a operar el consultorio, regularizá la suscripción.';

const resolveBusinessActionContext = async ({
	locals,
	fetch,
	cookies
}: {
	locals: App.Locals;
	fetch: typeof globalThis.fetch;
	cookies: import('@sveltejs/kit').Cookies;
}) => {
	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const ownerId = await getAuthUserId(supabase, locals.auth?.access_token);
	const context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth?.access_token,
		cookies
	});

	if (!ownerId || !context) {
		return null;
	}

	return { supabase, ownerId, context };
};

type BusinessActionSession = NonNullable<Awaited<ReturnType<typeof resolveBusinessActionContext>>>;

const resolvePatientPermissions = (context: BusinessActionSession['context']) => {
	const role = context.role;
	const capabilities = context.access.allowedCapabilities;
	const isOwnerOrAdmin = role === 'owner' || role === 'admin';
	const canOperatePatients = role === 'owner' || role === 'admin' || role === 'reception';
	const canWriteClinical = role === 'owner' || role === 'admin' || role === 'professional';
	const canManageRadiographs = role === 'owner' || role === 'admin' || role === 'professional';

	return {
		canReadClinicalProfile:
			(role === 'owner' || role === 'admin' || role === 'professional') &&
			capabilities.canViewExistingClinicalNotes,
		canEditClinicalProfile: isOwnerOrAdmin && capabilities.canEditPatient,
		canViewCosts: isOwnerOrAdmin && capabilities.canViewExistingCosts,
		canEditPatient: canOperatePatients && capabilities.canEditPatient,
		canArchivePatient: isOwnerOrAdmin && capabilities.canEditPatient,
		canCreateClinicalEntry: canWriteClinical && capabilities.canCreateClinicalEntry,
		canEditClinicalEntry: canWriteClinical && capabilities.canEditClinicalEntry,
		canCreateAppointment: canOperatePatients && capabilities.canCreateAppointment,
		canManageDriveFolders: isOwnerOrAdmin && capabilities.canLinkExternalFiles,
		canManageRadiographs: canManageRadiographs && capabilities.canLinkExternalFiles
	};
};

const clinicalEntryRpcError = (error: { message?: string; code?: string } | null | undefined) => {
	const message = `${error?.message ?? ''} ${error?.code ?? ''}`;

	if (message.includes('BUSINESS_ACCESS_RESTRICTED')) {
		return { status: 403, message: COMMERCIAL_RESTRICTED_MESSAGE };
	}
	if (message.includes('PATIENT_NOT_FOUND')) {
		return { status: 404, message: 'Paciente no encontrado en este consultorio.' };
	}
	if (message.includes('ENTRY_TYPE_REQUIRED') || message.includes('DESCRIPTION_REQUIRED')) {
		return { status: 400, message: 'Tipo y descripcion son obligatorios.' };
	}
	if (message.includes('INVALID_CLINICAL_ENTRY_DATE')) {
		return { status: 400, message: 'La fecha de la consulta no puede estar en el futuro.' };
	}
	if (message.includes('CLINICAL_COST_DENIED')) {
		return { status: 403, message: 'Tu rol no permite registrar importes.' };
	}
	if (
		message.includes('CLINICAL_ENTRY_DENIED') ||
		message.includes('CLINICAL_ENTRY_EDIT_DENIED') ||
		message.includes('PATIENT_ACCESS_DENIED') ||
		message.includes('PROFESSIONAL_LINK_REQUIRED')
	) {
		return { status: 403, message: 'Tu rol no permite modificar la historia clinica de este paciente.' };
	}
	if (message.includes('CLINICAL_ENTRY_LOCKED')) {
		return { status: 403, message: 'Esta entrada ya no se puede editar.' };
	}
	if (message.includes('CLINICAL_ENTRY_NOT_FOUND')) {
		return { status: 404, message: 'Entrada no encontrada o sin permiso de edicion.' };
	}

	return { status: 500, message: 'No se pudo guardar la entrada.' };
};

export const load: PageServerLoad = async ({ params, locals, fetch, cookies }) => {
	if (!locals.auth) {
		throw redirect(303, '/login');
	}

	if (env.DEMO_MODE === 'true') {
		const db = readDemoDb();
		const patient = db.patients.find((p) => p.id === params.id);
		if (!patient) throw kitError(404, 'Paciente no encontrado');
		const entries = db.clinicalEntries
			.filter((e) => e.patient_id === params.id)
			.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
		const radiographs = db.radiographs
			.filter((r) => r.patient_id === params.id)
			.sort((a, b) => (a.created_at ?? '') < (b.created_at ?? '') ? 1 : -1);
		return {
			patient,
			entries,
			radiographs,
			appointments: [],
			hasMoreEntries: false,
			hasMoreRadiographs: false,
			driveConnection: null,
			permissions: {
				canReadClinicalProfile: true,
				canEditClinicalProfile: true,
				canViewCosts: true,
				canEditPatient: true,
				canArchivePatient: true,
				canCreateClinicalEntry: true,
				canEditClinicalEntry: true,
				canCreateAppointment: true,
				canManageDriveFolders: true,
				canManageRadiographs: true
			},
			demo: true
		};
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const ownerId = await getAuthUserId(supabase, locals.auth.access_token);
	const context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth.access_token,
		cookies
	});
	if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');
	const permissions = resolvePatientPermissions(context);

	const [
		{ data: patient, error: patientError },
		{ data: clinicalProfile, error: clinicalProfileError },
		{ data: entries, error: entriesError },
		{ data: costs, error: costsError },
		{ data: radiographs, error: radiographsError },
		{ data: appointments, error: appointmentsError },
		{ data: driveConnection, error: driveError },
		{ data: driveFolderId, error: driveFolderError }
	] = await Promise.all([
		supabase
			.from('patients')
			.select(
				'id, full_name, dni, phone, email, birth_date, address, insurance, insurance_plan, archived_at, created_at, updated_at'
			)
			.eq('id', params.id)
			.eq('business_id', context.business.id)
			.maybeSingle(),
		permissions.canReadClinicalProfile
			? supabase
					.from('patient_clinical_profiles')
					.select('allergies, medication, background, custom_fields')
					.eq('patient_id', params.id)
					.eq('business_id', context.business.id)
					.maybeSingle()
			: Promise.resolve({ data: null, error: null }),
		supabase
			.from('clinical_entries')
			.select('id, created_at, entry_type, description, teeth, internal_note')
			.eq('patient_id', params.id)
			.eq('business_id', context.business.id)
			.is('archived_at', null)
			.order('created_at', { ascending: false })
			.order('id', { ascending: false })
			.limit(ENTRIES_PAGE_SIZE + 1),
		permissions.canViewCosts
			? supabase
					.from('clinical_entry_costs')
					.select('clinical_entry_id, amount')
					.eq('business_id', context.business.id)
			: Promise.resolve({ data: [], error: null }),
		supabase
			.from('patient_radiographs')
			.select(
				'id, patient_id, status, drive_file_id, original_filename, mime_type, bytes, taken_at, note, created_at'
			)
			.eq('patient_id', params.id)
			.eq('business_id', context.business.id)
			.is('deleted_at', null)
			.order('created_at', { ascending: false })
			.order('id', { ascending: false })
			.limit(RADIOGRAPHS_PAGE_SIZE + 1),
		supabase
			.from('appointments')
			.select('id, starts_at, ends_at, status, source, service_name_snapshot, professional_name_snapshot')
			.eq('patient_id', params.id)
			.eq('business_id', context.business.id)
			.order('starts_at', { ascending: false })
			.limit(12),
		ownerId
			? supabase
					.from('drive_connections')
					.select('connected_email, root_folder_id, updated_at')
					.eq('owner_id', ownerId)
					.maybeSingle()
			: Promise.resolve({ data: null, error: null }),
		permissions.canManageDriveFolders
			? supabase.rpc('get_patient_drive_folder_safely', {
					p_business_id: context.business.id,
					p_patient_id: params.id
				})
			: Promise.resolve({ data: null, error: null })
	]);

	if (patientError) {
		console.error('Error cargando paciente', patientError);
		throw kitError(500, 'No se pudo cargar el paciente');
	}
	if (!patient) {
		throw kitError(404, 'Paciente no encontrado');
	}

	if (clinicalProfileError) {
		console.error('Error cargando perfil clinico', clinicalProfileError);
	}
	if (entriesError) {
		console.error('Error cargando entradas', entriesError);
	}
	if (costsError) {
		console.error('Error cargando costos clinicos', costsError);
	}
	if (radiographsError) {
		console.error('Error cargando radiografias', radiographsError);
	}
	if (appointmentsError) {
		console.error('Error cargando turnos del paciente', appointmentsError);
	}
	if (driveError) {
		console.error('Error cargando conexion Drive', driveError);
	}
	if (driveFolderError) {
		console.error('Error cargando carpeta Drive del paciente', driveFolderError);
	}

	const safeEntries = entries ?? [];
	const costByEntryId = new Map((costs ?? []).map((item: any) => [String(item.clinical_entry_id), item.amount]));
	const entriesWithCosts = safeEntries.map((entry: any) => ({
		...entry,
		amount: permissions.canViewCosts
			? (costByEntryId.get(String(entry.id)) ?? null)
			: null
	}));
	const safeRadiographs = radiographs ?? [];
	const hasMoreEntries = entriesWithCosts.length > ENTRIES_PAGE_SIZE;
	const hasMoreRadiographs = safeRadiographs.length > RADIOGRAPHS_PAGE_SIZE;

	return {
		patient: {
			...patient,
			allergies: clinicalProfile?.allergies ?? null,
			medication: clinicalProfile?.medication ?? null,
			background: clinicalProfile?.background ?? null,
			custom_fields: clinicalProfile?.custom_fields ?? null,
			drive_folder_id: typeof driveFolderId === 'string' ? driveFolderId : null
		},
		entries: hasMoreEntries ? entriesWithCosts.slice(0, ENTRIES_PAGE_SIZE) : entriesWithCosts,
		appointments: appointments ?? [],
		radiographs: hasMoreRadiographs
			? safeRadiographs.slice(0, RADIOGRAPHS_PAGE_SIZE)
			: safeRadiographs,
		hasMoreEntries,
		hasMoreRadiographs,
		driveConnection: driveConnection ?? null,
		permissions,
		demo: false
	};
};

export const actions: Actions = {
	save_drive_connection: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const form = await request.formData();
		const connected_email = String(form.get('connected_email') ?? '').trim();
		const root_folder_id = String(form.get('root_folder_id') ?? '').trim();

		if (!connected_email || !root_folder_id) {
			return fail(400, { message: 'Faltan datos para guardar la conexión.' });
		}

		const session = await resolveBusinessActionContext({ locals, fetch, cookies });
		if (!session) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		if (!resolvePatientPermissions(session.context).canManageDriveFolders) {
			return fail(403, { message: 'Tu rol no permite administrar Google Drive de pacientes.' });
		}
		const { supabase, ownerId } = session;
		const { error } = await supabase
			.from('drive_connections')
			.upsert(
				{
					owner_id: ownerId,
					connected_email,
					root_folder_id,
					updated_at: new Date().toISOString()
				},
				{ onConflict: 'owner_id' }
			);

		if (error) {
			console.error('Error guardando Drive connection', error);
			return fail(500, { message: 'No se pudo guardar la conexión con Drive.' });
		}

		return { success: true };
	},
	disconnect_drive: async ({ locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const session = await resolveBusinessActionContext({ locals, fetch, cookies });
		if (!session) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		if (!resolvePatientPermissions(session.context).canManageDriveFolders) {
			return fail(403, { message: 'Tu rol no permite administrar Google Drive de pacientes.' });
		}
		const { supabase, ownerId, context } = session;
		const { error } = await supabase.from('drive_connections').delete().eq('owner_id', ownerId);
		const { error: resetError } = await supabase.rpc('clear_patient_drive_folders_safely', {
			p_business_id: context.business.id
		});

		if (error) {
			console.error('Error desconectando Drive', error);
			return fail(500, { message: 'No se pudo desconectar Drive.' });
		}
		if (resetError) {
			console.error('Error limpiando carpetas Drive en pacientes', resetError);
		}

		return { success: true };
	},
	set_drive_folder: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}
		const form = await request.formData();
		const drive_folder_id = String(form.get('drive_folder_id') ?? '').trim();
		if (!drive_folder_id) {
			return fail(400, { message: 'Carpeta invalida.' });
		}

		const session = await resolveBusinessActionContext({ locals, fetch, cookies });
		if (!session) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		if (!resolvePatientPermissions(session.context).canManageDriveFolders) {
			return fail(403, { message: 'Tu rol no permite administrar Google Drive de pacientes.' });
		}
		const { supabase, context } = session;
		const { error } = await supabase.rpc('set_patient_drive_folder_safely', {
			p_business_id: context.business.id,
			p_patient_id: params.id,
			p_drive_folder_id: drive_folder_id
		});

		if (error) {
			console.error('Error guardando carpeta Drive', error);
			return fail(500, { message: 'No se pudo guardar la carpeta de Drive.' });
		}

		return { success: true };
	},
	start_radiograph: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const form = await request.formData();
		const original_filename = normalizeFilename(form.get('original_filename') as string);
		const mime_type = String(form.get('mime_type') ?? '').trim();
		const bytesRaw = String(form.get('bytes') ?? '').trim();
		const parsedBytes = bytesRaw ? Number(bytesRaw) : null;
		const bytes = typeof parsedBytes === 'number' && Number.isFinite(parsedBytes) ? parsedBytes : null;

		const session = await resolveBusinessActionContext({ locals, fetch, cookies });
		if (!session) {
			return fail(401, { message: 'Sesion invalida. Volve a iniciar sesion.' });
		}
		if (!resolvePatientPermissions(session.context).canManageRadiographs) {
			return fail(403, { message: 'Tu rol no permite administrar radiografías de este paciente.' });
		}
		const { supabase, ownerId, context } = session;
		const { data, error } = await supabase
			.from('patient_radiographs')
			.insert({
				owner_id: ownerId,
				business_id: context.business.id,
				patient_id: params.id,
				status: 'uploading',
				original_filename,
				mime_type: mime_type || null,
				bytes,
				created_by: ownerId
			})
			.select(
				'id, patient_id, status, original_filename, mime_type, bytes, taken_at, note, created_at'
			)
			.single();

		if (error || !data) {
			console.error('Error creando radiografia', error);
			return fail(500, { message: 'No se pudo iniciar la carga.' });
		}

		return { success: true, radiograph: data };
	},
	reset_radiograph: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const form = await request.formData();
		const radiograph_id = String(form.get('radiograph_id') ?? '').trim();
		const original_filename = normalizeFilename(form.get('original_filename') as string);
		const mime_type = String(form.get('mime_type') ?? '').trim();
		const bytesRaw = String(form.get('bytes') ?? '').trim();
		const parsedBytes = bytesRaw ? Number(bytesRaw) : null;
		const bytes = typeof parsedBytes === 'number' && Number.isFinite(parsedBytes) ? parsedBytes : null;

		if (!radiograph_id) {
			return fail(400, { message: 'Radiografia invalida.' });
		}

		const session = await resolveBusinessActionContext({ locals, fetch, cookies });
		if (!session) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		if (!resolvePatientPermissions(session.context).canManageRadiographs) {
			return fail(403, { message: 'Tu rol no permite administrar radiografías de este paciente.' });
		}
		const { supabase, context } = session;
		const { data, error } = await supabase
			.from('patient_radiographs')
			.update({
				status: 'uploading',
				drive_file_id: null,
				original_filename,
				mime_type: mime_type || null,
				bytes
			})
			.eq('id', radiograph_id)
			.eq('patient_id', params.id)
			.eq('business_id', context.business.id)
			.select(
				'id, patient_id, status, drive_file_id, original_filename, mime_type, bytes, taken_at, note, created_at'
			)
			.single();

		if (error || !data) {
			console.error('Error reintentando radiografia', error);
			return fail(500, { message: 'No se pudo reintentar la carga.' });
		}

		return { success: true, radiograph: data };
	},
	finalize_radiograph: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const form = await request.formData();
		const radiograph_id = String(form.get('radiograph_id') ?? '').trim();
		const drive_file_id = String(form.get('drive_file_id') ?? '').trim();
		const noteRaw = String(form.get('note') ?? '').trim();
		const note = noteRaw.length > 500 ? noteRaw.slice(0, 500) : noteRaw;
		const taken_at_raw = String(form.get('taken_at') ?? '').trim();
		let taken_at: string | null = null;
		if (taken_at_raw) {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(taken_at_raw)) {
				return fail(400, { message: 'Fecha invalida. Formato esperado: AAAA-MM-DD.' });
			}
			taken_at = taken_at_raw;
		}

		if (!radiograph_id || !drive_file_id) {
			return fail(400, { message: 'Faltan datos para finalizar la carga.' });
		}

		const session = await resolveBusinessActionContext({ locals, fetch, cookies });
		if (!session) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		if (!resolvePatientPermissions(session.context).canManageRadiographs) {
			return fail(403, { message: 'Tu rol no permite administrar radiografías de este paciente.' });
		}
		const { supabase, context } = session;
		const { data, error } = await supabase
			.from('patient_radiographs')
			.update({
				drive_file_id,
				status: 'ready',
				note: note || null,
				taken_at
			})
			.eq('id', radiograph_id)
			.eq('patient_id', params.id)
			.eq('business_id', context.business.id)
			.select(
				'id, patient_id, status, drive_file_id, original_filename, mime_type, bytes, taken_at, note, created_at'
			)
			.single();

		if (error || !data) {
			console.error('Error finalizando radiografia', error);
			return fail(500, { message: 'No se pudo guardar la radiografia.' });
		}

		return { success: true, radiograph: data };
	},
	mark_radiograph_failed: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const form = await request.formData();
		const radiograph_id = String(form.get('radiograph_id') ?? '').trim();
		if (!radiograph_id) {
			return fail(400, { message: 'Radiografia invalida.' });
		}

		const session = await resolveBusinessActionContext({ locals, fetch, cookies });
		if (!session) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		if (!resolvePatientPermissions(session.context).canManageRadiographs) {
			return fail(403, { message: 'Tu rol no permite administrar radiografías de este paciente.' });
		}
		const { supabase, context } = session;
		const { data, error } = await supabase
			.from('patient_radiographs')
			.update({ status: 'failed' })
			.eq('id', radiograph_id)
			.eq('patient_id', params.id)
			.eq('business_id', context.business.id)
			.select(
				'id, patient_id, status, drive_file_id, original_filename, mime_type, bytes, taken_at, note, created_at'
			)
			.single();

		if (error || !data) {
			console.error('Error marcando radiografia fallida', error);
			return fail(500, { message: 'No se pudo actualizar la radiografia.' });
		}

		return { success: true, radiograph: data };
	},
	delete_radiograph: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const form = await request.formData();
		const radiograph_id = String(form.get('radiograph_id') ?? '').trim();
		if (!radiograph_id) {
			return fail(400, { message: 'Radiografia invalida.' });
		}

		const session = await resolveBusinessActionContext({ locals, fetch, cookies });
		if (!session) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		if (!resolvePatientPermissions(session.context).canManageRadiographs) {
			return fail(403, { message: 'Tu rol no permite administrar radiografías de este paciente.' });
		}
		const { supabase, context } = session;
		const { error } = await supabase
			.from('patient_radiographs')
			.delete()
			.eq('id', radiograph_id)
			.eq('patient_id', params.id)
			.eq('business_id', context.business.id);

		if (error) {
			console.error('Error eliminando radiografia', error);
			return fail(500, { message: 'No se pudo eliminar la radiografia.' });
		}

		return { success: true };
	},
	add_entry: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		const form = await request.formData();
		const entry_type = String(form.get('entry_type') ?? '').trim() as ClinicalEntry['entry_type'];
		const description = String(form.get('description') ?? '').trim();
		const createdAtRaw = String(form.get('created_at') ?? '').trim();
		if (!createdAtRaw) {
			return fail(400, { message: 'Completá la fecha y hora.' });
		}

		const createdAtMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(createdAtRaw);
		if (!createdAtMatch) {
			return fail(400, { message: 'Revisá la fecha y hora. Formato esperado: Año/Mes/Día y Hora.' });
		}

		const y = Number(createdAtMatch[1]);
		const m = Number(createdAtMatch[2]);
		const d = Number(createdAtMatch[3]);
		const hh = Number(createdAtMatch[4]);
		const mm = Number(createdAtMatch[5]);

		if (!Number.isInteger(y) || y < 2000 || y > 2045) {
			return fail(400, { message: 'Revisá el año: debe estar entre 2000 y 2045.' });
		}
		if (!Number.isInteger(m) || m < 1 || m > 12) {
			return fail(400, { message: 'Revisá el mes: debe ir del 1 al 12.' });
		}
		const maxDay = new Date(y, m, 0).getDate();
		if (!Number.isInteger(d) || d < 1 || d > maxDay) {
			return fail(400, { message: `Revisá el día: para ese mes debe ir del 1 al ${maxDay}.` });
		}
		if (!Number.isInteger(hh) || hh < 0 || hh > 23 || !Number.isInteger(mm) || mm < 0 || mm > 59) {
			return fail(400, { message: 'Revisá la hora: debe estar entre 00:00 y 23:59.' });
		}

		const created_at = new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();
		const teeth = String(form.get('teeth') ?? '').trim();
		const amountRaw = String(form.get('amount') ?? '').trim();
		const internal_note = String(form.get('internal_note') ?? '').trim();

		if (!entry_type || !description) {
			return fail(400, { message: 'Tipo y descripción son obligatorios' });
		}

		const amount = parseMoneyInteger(amountRaw);

		if (env.DEMO_MODE === 'true') {
			let saved = false;
			updateDemoDb((db) => {
				const patient = db.patients.find((p) => p.id === params.id);
				if (!patient) return;

				db.clinicalEntries.unshift({
					id: newId('e'),
					patient_id: params.id,
					entry_type,
					description,
					created_at,
					teeth: teeth || null,
					amount,
					internal_note: internal_note || null
				});
				patient.last_entry_at = getLatestEntryDate(params.id, db.clinicalEntries);
				patient.updated_at = new Date().toISOString();
				saved = true;
			});

			if (!saved) {
				return fail(404, { message: 'Paciente no encontrado' });
			}

			throw redirect(303, `/odonto/pacientes/${params.id}`);
		}

		const session = await resolveBusinessActionContext({ locals, fetch, cookies });
		if (!session) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		const permissions = resolvePatientPermissions(session.context);
		if (!permissions.canCreateClinicalEntry) {
			return fail(403, {
				message: session.context.access.allowedCapabilities.canCreateClinicalEntry
					? 'Tu rol no permite registrar consultas clínicas.'
					: COMMERCIAL_RESTRICTED_MESSAGE
			});
		}
		if (amount != null && !permissions.canViewCosts) {
			return fail(403, { message: 'Tu rol no permite registrar importes.' });
		}
		const { supabase, context } = session;

		const { error } = await supabase.rpc('create_clinical_entry_safely', {
			p_business_id: context.business.id,
			p_patient_id: params.id,
			p_entry_type: entry_type,
			p_description: description,
			p_created_at: created_at,
			p_teeth: teeth || null,
			p_internal_note: internal_note || null,
			p_amount: amount
		});

		if (error) {
			console.error('Error guardando entrada', error);
			const mapped = clinicalEntryRpcError(error);
			return fail(mapped.status, { message: mapped.message });
		}

		throw redirect(303, `/odonto/pacientes/${params.id}`);
	},
	update_entry: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');

		const form = await request.formData();
		const entry_id = String(form.get('entry_id') ?? '').trim();
		const entry_type = String(form.get('entry_type') ?? '').trim() as ClinicalEntry['entry_type'];
		const description = String(form.get('description') ?? '').trim();
		const createdAtRaw = String(form.get('created_at') ?? '').trim();
		const teeth = String(form.get('teeth') ?? '').trim();
		const amountRaw = String(form.get('amount') ?? '').trim();
		const internal_note = String(form.get('internal_note') ?? '').trim();

		if (!entry_id) return fail(400, { message: 'Entrada inválida.' });
		if (!entry_type || !description) {
			return fail(400, { message: 'Tipo y descripción son obligatorios' });
		}
		if (!createdAtRaw) {
			return fail(400, { message: 'Completá la fecha y hora.' });
		}

		const createdAtMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(createdAtRaw);
		if (!createdAtMatch) {
			return fail(400, { message: 'Revisá la fecha y hora. Formato esperado: Año/Mes/Día y Hora.' });
		}

		const y = Number(createdAtMatch[1]);
		const m = Number(createdAtMatch[2]);
		const d = Number(createdAtMatch[3]);
		const hh = Number(createdAtMatch[4]);
		const mm = Number(createdAtMatch[5]);

		if (!Number.isInteger(y) || y < 2000 || y > 2045) {
			return fail(400, { message: 'Revisá el año: debe estar entre 2000 y 2045.' });
		}
		if (!Number.isInteger(m) || m < 1 || m > 12) {
			return fail(400, { message: 'Revisá el mes: debe ir del 1 al 12.' });
		}
		const maxDay = new Date(y, m, 0).getDate();
		if (!Number.isInteger(d) || d < 1 || d > maxDay) {
			return fail(400, { message: `Revisá el día: para ese mes debe ir del 1 al ${maxDay}.` });
		}
		if (!Number.isInteger(hh) || hh < 0 || hh > 23 || !Number.isInteger(mm) || mm < 0 || mm > 59) {
			return fail(400, { message: 'Revisá la hora: debe estar entre 00:00 y 23:59.' });
		}

		const created_at = new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();
		const amount = parseMoneyInteger(amountRaw);

		if (env.DEMO_MODE === 'true') {
			let updated = false;
			updateDemoDb((db) => {
				const entry = db.clinicalEntries.find((e) => e.id === entry_id && e.patient_id === params.id);
				const patient = db.patients.find((p) => p.id === params.id);
				if (!entry || !patient) return;

				entry.entry_type = entry_type;
				entry.description = description;
				entry.created_at = created_at;
				entry.teeth = teeth || null;
				entry.amount = amount;
				entry.internal_note = internal_note || null;
				patient.last_entry_at = getLatestEntryDate(params.id, db.clinicalEntries);
				patient.updated_at = new Date().toISOString();
				updated = true;
			});

			if (!updated) {
				return fail(404, { message: 'Entrada no encontrada' });
			}

			throw redirect(303, `/odonto/pacientes/${params.id}`);
		}

		const session = await resolveBusinessActionContext({ locals, fetch, cookies });
		if (!session) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		const permissions = resolvePatientPermissions(session.context);
		if (!permissions.canEditClinicalEntry) {
			return fail(403, {
				message: session.context.access.allowedCapabilities.canEditClinicalEntry
					? 'Tu rol no permite editar consultas clínicas.'
					: COMMERCIAL_RESTRICTED_MESSAGE
			});
		}
		if (amount != null && !permissions.canViewCosts) {
			return fail(403, { message: 'Tu rol no permite registrar importes.' });
		}
		const { supabase, context } = session;

		const { error } = await supabase.rpc('update_clinical_entry_safely', {
			p_business_id: context.business.id,
			p_patient_id: params.id,
			p_entry_id: entry_id,
			p_entry_type: entry_type,
			p_description: description,
			p_teeth: teeth || null,
			p_internal_note: internal_note || null,
			p_amount: amount
		});

		if (error) {
			console.error('Error actualizando entrada', error);
			const mapped = clinicalEntryRpcError(error);
			return fail(mapped.status, { message: mapped.message });
		}

		throw redirect(303, `/odonto/pacientes/${params.id}`);
	},
	update_patient: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');

		const form = await request.formData();
		const dni = String(form.get('dni') ?? '').trim();
		const phoneInput = String(form.get('phone') ?? '');
		const phone = normalizePhone(phoneInput);
		const birthDateRaw = String(form.get('birth_date') ?? '').trim();

		let birth_date: string | null = null;
		if (birthDateRaw) {
			const birthMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDateRaw);
			if (!birthMatch) {
				return fail(400, { message: 'Revisá la fecha de nacimiento. Formato esperado: Año/Mes/Día.' });
			}

			const y = Number(birthMatch[1]);
			const m = Number(birthMatch[2]);
			const d = Number(birthMatch[3]);
			const currentYear = new Date().getFullYear();

			if (!Number.isInteger(y) || y < 1900 || y > currentYear) {
				return fail(400, { message: `Revisá el año: debe estar entre 1900 y ${currentYear}.` });
			}
			if (!Number.isInteger(m) || m < 1 || m > 12) {
				return fail(400, { message: 'Revisá el mes: debe ir del 1 al 12.' });
			}
			const maxDay = new Date(y, m, 0).getDate();
			if (!Number.isInteger(d) || d < 1 || d > maxDay) {
				return fail(400, { message: `Revisá el día: para ese mes debe ir del 1 al ${maxDay}.` });
			}

			birth_date = birthDateRaw;
		}

		const clinicalUpdates = {
			allergies: String(form.get('allergies') ?? '') || null,
			medication: String(form.get('medication') ?? '') || null,
			background: String(form.get('background') ?? '') || null
		};
		const updates = {
			email: String(form.get('email') ?? '') || null,
			dni: dni || null,
			birth_date,
			address: String(form.get('address') ?? '') || null,
			insurance: String(form.get('insurance') ?? '') || null,
			insurance_plan: String(form.get('insurance_plan') ?? '') || null,
			phone: phone || null,
			phone_raw: normalizePhoneRaw(phoneInput),
			phone_e164: normalizePhoneE164(phoneInput),
			updated_at: new Date().toISOString()
		};

		if (env.DEMO_MODE === 'true') {
			let updated = false;
			updateDemoDb((db) => {
				const patient = db.patients.find((p) => p.id === params.id);
				if (!patient) return;
				Object.assign(patient, updates, clinicalUpdates);
				updated = true;
			});

			if (!updated) {
				return fail(404, { message: 'Paciente no encontrado' });
			}

			throw redirect(303, `/odonto/pacientes/${params.id}`);
		}

		const session = await resolveBusinessActionContext({ locals, fetch, cookies });
		if (!session) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		const permissions = resolvePatientPermissions(session.context);
		if (!permissions.canEditPatient) {
			return fail(403, {
				message: session.context.access.allowedCapabilities.canEditPatient
					? 'Tu rol no permite editar datos de pacientes.'
					: COMMERCIAL_RESTRICTED_MESSAGE
			});
		}
		const { supabase, context } = session;

		const { error } = await supabase
			.from('patients')
			.update(updates)
			.eq('id', params.id)
			.eq('business_id', context.business.id);

		if (error) {
			console.error('Error actualizando paciente', error);
			return fail(500, { message: 'No se pudo actualizar la ficha' });
		}

		if (context.role === 'owner' || context.role === 'admin') {
			const { error: profileError } = await supabase.rpc('upsert_patient_clinical_profile_safely', {
				p_business_id: context.business.id,
				p_patient_id: params.id,
				p_allergies: clinicalUpdates.allergies,
				p_medication: clinicalUpdates.medication,
				p_background: clinicalUpdates.background,
				p_clinical_alert_note: null,
				p_notes: null,
				p_custom_fields: null
			});

			if (profileError) {
				console.error('Error actualizando perfil clinico del paciente', profileError);
				return fail(500, { message: 'No se pudo actualizar la información clínica' });
			}
		}

		throw redirect(303, `/odonto/pacientes/${params.id}`);
	},
	archive_patient: async ({ params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			let archived = false;
			updateDemoDb((db) => {
				const patient = db.patients.find((p) => p.id === params.id);
				if (!patient) return;
				const now = new Date().toISOString();
				patient.archived_at = now;
				patient.updated_at = now;
				archived = true;
			});

			if (!archived) {
				return fail(404, { message: 'Paciente no encontrado' });
			}

			throw redirect(303, '/odonto/pacientes?estado=archivados');
		}
		const session = await resolveBusinessActionContext({ locals, fetch, cookies });
		if (!session) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		const permissions = resolvePatientPermissions(session.context);
		if (!permissions.canArchivePatient) {
			return fail(403, {
				message: session.context.access.allowedCapabilities.canEditPatient
					? 'Solo dueño o administrador puede archivar pacientes.'
					: COMMERCIAL_RESTRICTED_MESSAGE
			});
		}
		const { supabase, context } = session;

		const { error } = await supabase.rpc('set_patient_archive_state_safely', {
			p_business_id: context.business.id,
			p_patient_id: params.id,
			p_archived: true
		});

		if (error) {
			console.error('Error archivando paciente', error);
			return fail(500, { message: 'No se pudo archivar el paciente' });
		}

		throw redirect(303, '/odonto/pacientes?estado=archivados');
	},
	unarchive_patient: async ({ params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			let unarchived = false;
			updateDemoDb((db) => {
				const patient = db.patients.find((p) => p.id === params.id);
				if (!patient) return;
				patient.archived_at = null;
				patient.updated_at = new Date().toISOString();
				unarchived = true;
			});

			if (!unarchived) {
				return fail(404, { message: 'Paciente no encontrado' });
			}

			throw redirect(303, '/odonto/pacientes');
		}
		const session = await resolveBusinessActionContext({ locals, fetch, cookies });
		if (!session) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		const permissions = resolvePatientPermissions(session.context);
		if (!permissions.canArchivePatient) {
			return fail(403, {
				message: session.context.access.allowedCapabilities.canEditPatient
					? 'Solo dueño o administrador puede desarchivar pacientes.'
					: COMMERCIAL_RESTRICTED_MESSAGE
			});
		}
		const { supabase, context } = session;

		const { error } = await supabase.rpc('set_patient_archive_state_safely', {
			p_business_id: context.business.id,
			p_patient_id: params.id,
			p_archived: false
		});

		if (error) {
			console.error('Error desarchivando paciente', error);
			return fail(500, { message: 'No se pudo desarchivar el paciente' });
		}

		throw redirect(303, '/odonto/pacientes');
	},
	delete_patient: async ({ params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			let deleted = false;
			updateDemoDb((db) => {
				const patientIndex = db.patients.findIndex((p) => p.id === params.id);
				if (patientIndex === -1) return;
				db.clinicalEntries = db.clinicalEntries.filter((e) => e.patient_id !== params.id);
				db.patients.splice(patientIndex, 1);
				deleted = true;
			});

			if (!deleted) {
				return fail(404, { message: 'Paciente no encontrado' });
			}

			throw redirect(303, '/odonto/pacientes');
		}
		const session = await resolveBusinessActionContext({ locals, fetch, cookies });
		if (!session) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		const permissions = resolvePatientPermissions(session.context);
		if (!permissions.canArchivePatient) {
			return fail(403, {
				message: session.context.access.allowedCapabilities.canEditPatient
					? 'Los pacientes no se eliminan directamente. Archivá el paciente para ocultarlo.'
					: COMMERCIAL_RESTRICTED_MESSAGE
			});
		}
		return fail(403, {
			message: 'Por seguridad, los pacientes no se eliminan directamente. Archivá el paciente para ocultarlo.'
		});
	}
};
