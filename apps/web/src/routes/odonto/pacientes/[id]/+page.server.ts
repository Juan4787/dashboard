import { env } from '$env/dynamic/private';
import { resolveActiveBusiness } from '$lib/server/business';
import { newId, readDemoDb, updateDemoDb } from '$lib/server/demo-store';
import { normalizePhoneE164, normalizePhoneRaw } from '$lib/server/phone';
import {
	createSupabaseAdminClient,
	createSupabaseServerClient,
	getAuthUserId
} from '$lib/server/supabase';
import { normalizePhone } from '$lib/utils/format';
import {
	getPatientUniqueConflictField,
	getPatientWriteConflictMessage,
	PATIENT_UNIQUE_CONFLICT_MESSAGES,
	type PatientUniqueField
} from '$lib/server/patient-identity';
import { parseMoneyInteger } from '$lib/utils/money-input';
import { fail, redirect, error as kitError } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { ClinicalEntry } from '$lib/types';
import {
	businessTodayISO,
	roleParticipatesInFollowUps,
	roleSeesAllFollowUps
} from '$lib/server/follow-ups';
import { resolvePatientPermissions } from '$lib/server/patient-permissions';
import { ACTIVE_APPOINTMENT_STATUSES } from '$lib/utils/appointment-visibility';

const getLatestEntryDate = (patientId: string, entries: { patient_id: string; created_at: string }[]) =>
	entries
		.filter((e) => e.patient_id === patientId)
		.reduce<string | null>((latest, entry) => (entry.created_at > (latest ?? '') ? entry.created_at : latest), null);

const ENTRIES_PAGE_SIZE = 30;
const COMMERCIAL_RESTRICTED_MESSAGE =
	'Tu acceso a Cita Suite venció. Activá tu suscripción para volver a usar la plataforma.';
const PROFESSIONAL_DELETE_PATIENT_MESSAGE =
	'Para eliminar un paciente, consultá al dueño del consultorio.';

const cleanText = (value: unknown) => {
	const text = String(value ?? '').trim();
	return text ? text : null;
};

const sentenceJoin = (items: string[]) => {
	if (items.length <= 1) return items[0] ?? '';
	return `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`;
};

const patientFieldLabels: Record<string, string> = {
	full_name: 'nombre',
	dni: 'DNI',
	phone: 'teléfono',
	email: 'correo electrónico',
	birth_date: 'fecha de nacimiento',
	address: 'dirección',
	insurance: 'obra social',
	insurance_plan: 'plan de la obra social',
	allergies: 'alergias',
	medication: 'medicación',
	background: 'antecedentes'
};

const currentValue = (value: unknown) => {
	const text = String(value ?? '').trim();
	return text ? text : null;
};

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
		cookies,
		membershipCache: 'short'
	});

	if (!ownerId || !context) {
		return null;
	}

	return { supabase, ownerId, context };
};

type BusinessActionSession = NonNullable<Awaited<ReturnType<typeof resolveBusinessActionContext>>>;

const getCurrentProfessional = async ({
	admin,
	businessId,
	userId
}: {
	admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>;
	businessId: string;
	userId: string;
}) => {
	const { data, error } = await admin
		.from('professional_users')
		.select('professional_id, professionals(name)')
		.eq('business_id', businessId)
		.eq('user_id', userId)
		.order('created_at', { ascending: true })
		.limit(1)
		.maybeSingle();

	if (error) throw error;
	const professional = (data as any)?.professionals;
	const professionalId = (data as any)?.professional_id ? String((data as any).professional_id) : null;
	if (!professionalId) return null;

	return {
		id: professionalId,
		name: cleanText(professional?.name) ?? 'Profesional'
	};
};

const ensureProfessionalCanAccessPatient = async ({
	admin,
	businessId,
	patientId,
	professionalId
}: {
	admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>;
	businessId: string;
	patientId: string;
	professionalId: string;
}) => {
	const { data, error } = await admin
		.from('professional_patient_links')
		.select('id, archived_at')
		.eq('business_id', businessId)
		.eq('patient_id', patientId)
		.eq('professional_id', professionalId)
		.eq('is_active', true)
		.limit(1)
		.maybeSingle();

	if (error) throw error;
	return data ? { id: String((data as any).id), archived_at: (data as any).archived_at ?? null } : null;
};

const findPatientDuplicateDniForUpdate = async ({
	admin,
	businessId,
	patientId,
	dni
}: {
	admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>;
	businessId: string;
	patientId: string;
	dni: string;
}): Promise<{ id: string; field: PatientUniqueField } | null> => {
	if (dni) {
		const { data, error } = await admin
			.from('patients')
			.select('id')
			.eq('business_id', businessId)
			.eq('dni', dni)
			.neq('id', patientId)
			.limit(1)
			.maybeSingle();
		if (error) throw error;
		if ((data as any)?.id) return { id: String((data as any).id), field: 'dni' };
	}

	return null;
};

const duplicatePatientActionResult = (existing: { id: string; field: PatientUniqueField }) =>
	fail(409, {
		message: PATIENT_UNIQUE_CONFLICT_MESSAGES[existing.field],
		duplicate: true,
		duplicateField: existing.field,
		existingId: existing.id
	});

const mapDuplicatePatientError = async ({
	error,
	admin,
	businessId,
	patientId,
	dni
}: {
	error:
		| { code?: string | null; message?: string | null; details?: string | null; hint?: string | null }
		| null
		| undefined;
	admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>;
	businessId: string;
	patientId: string;
	dni: string;
}) => {
	const conflictField = getPatientUniqueConflictField(error);
	if (conflictField) {
		try {
			const duplicate = await findPatientDuplicateDniForUpdate({
				admin,
				businessId,
				patientId,
				dni
			});
			if (duplicate) return duplicatePatientActionResult(duplicate);
		} catch (lookupError) {
			console.error('Error recuperando ficha en conflicto al editar paciente', lookupError);
		}
	}

	const conflictMessage = getPatientWriteConflictMessage(error);
	return conflictMessage ? fail(409, { message: conflictMessage }) : null;
};

const getActorName = (role: BusinessActionSession['context']['role'], professionalName?: string | null) => {
	if (professionalName) return professionalName;
	if (role === 'owner') return 'Dueño';
	if (role === 'admin') return 'Administrador';
	if (role === 'reception') return 'Recepción';
	return 'Usuario del consultorio';
};

const changedFieldsForPatientUpdate = ({
	currentPatient,
	currentProfile,
	updates,
	clinicalUpdates
}: {
	currentPatient: Record<string, unknown> | null | undefined;
	currentProfile: Record<string, unknown> | null | undefined;
	updates: Record<string, unknown>;
	clinicalUpdates: Record<string, unknown>;
}) => {
	const changed: string[] = [];
	for (const key of ['full_name', 'dni', 'phone', 'email', 'birth_date', 'address', 'insurance', 'insurance_plan']) {
		if (currentValue(currentPatient?.[key]) !== currentValue(updates[key])) {
			changed.push(patientFieldLabels[key]);
		}
	}
	for (const key of ['allergies', 'medication', 'background']) {
		if (currentValue(currentProfile?.[key]) !== currentValue(clinicalUpdates[key])) {
			changed.push(patientFieldLabels[key]);
		}
	}
	return changed;
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

export const load: PageServerLoad = async ({ params, locals, fetch, cookies, depends }) => {
	depends(`app:patient:${params.id}`);
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
			permissions: {
				canReadClinicalProfile: true,
				canEditClinicalProfile: true,
				canViewCosts: true,
				canEditPatient: true,
				canArchivePatient: true,
				canCreateClinicalEntry: true,
				canEditClinicalEntry: true,
				canCreateAppointment: true,
				canViewRadiographs: true,
				canUploadRadiographs: true,
				canViewRadiographTrash: true,
				canTrashRadiographs: true
			},
			followUpParticipates: false,
			followUpCanAssign: false,
			followUpTodayISO: '',
			clinicalTodayISO: businessTodayISO('America/Argentina/Buenos_Aires'),
			demo: true
		};
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const ownerId = await getAuthUserId(supabase, locals.auth.access_token);
	const context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth.access_token,
		cookies,
		membershipCache: 'short'
	});
	if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');
	const permissions = resolvePatientPermissions(context);
	const nowIso = new Date().toISOString();
	const admin = await createSupabaseAdminClient('odonto', fetch);
	const currentProfessional =
		context.role === 'professional'
			? await getCurrentProfessional({
					admin,
					businessId: context.business.id,
					userId: ownerId ?? ''
				}).catch((err) => {
					console.error('Error resolviendo profesional actual', err);
					return null;
				})
			: null;

	const [
		{ data: patient, error: patientError },
		{ data: clinicalProfile, error: clinicalProfileError },
		{ data: entries, error: entriesError },
		{ data: appointments, error: appointmentsError },
		{ data: professionalLink, error: professionalLinkError }
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
			.select(
				'id, created_at, entry_type, description, teeth, internal_note, created_by_user_id, locked_after, clinical_entry_costs(amount)'
			)
			.eq('patient_id', params.id)
			.eq('business_id', context.business.id)
			.is('archived_at', null)
			.order('created_at', { ascending: false })
			.order('id', { ascending: false })
			.limit(ENTRIES_PAGE_SIZE + 1),
			supabase
				.from('appointments')
				.select('id, starts_at, ends_at, status, source, service_name_snapshot, professional_name_snapshot')
				.eq('patient_id', params.id)
				.eq('business_id', context.business.id)
				.in('status', [...ACTIVE_APPOINTMENT_STATUSES])
				.gte('starts_at', nowIso)
				.order('starts_at', { ascending: true })
				.limit(12),
		context.role === 'professional' && currentProfessional
			? admin
					.from('professional_patient_links')
					.select('id, archived_at')
					.eq('business_id', context.business.id)
					.eq('patient_id', params.id)
					.eq('professional_id', currentProfessional.id)
					.eq('is_active', true)
					.limit(1)
					.maybeSingle()
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
	if (appointmentsError) {
		console.error('Error cargando turnos del paciente', appointmentsError);
	}
	if (professionalLinkError) {
		console.error('Error cargando archivo personal del profesional', professionalLinkError);
	}

	const safeEntries = entries ?? [];
	const entriesWithCosts = safeEntries.map((entry: any) => ({
		...entry,
		amount: permissions.canViewCosts
			? (Array.isArray(entry.clinical_entry_costs)
					? (entry.clinical_entry_costs[0]?.amount ?? null)
					: null)
			: null,
		clinical_entry_costs: undefined
	}));
	const hasMoreEntries = entriesWithCosts.length > ENTRIES_PAGE_SIZE;

	return {
		patient: {
			...patient,
			allergies: clinicalProfile?.allergies ?? null,
			medication: clinicalProfile?.medication ?? null,
			background: clinicalProfile?.background ?? null,
			custom_fields: clinicalProfile?.custom_fields ?? null,
			professional_archived_at:
				context.role === 'professional' ? ((professionalLink as any)?.archived_at ?? null) : null
		},
		entries: hasMoreEntries ? entriesWithCosts.slice(0, ENTRIES_PAGE_SIZE) : entriesWithCosts,
		appointments: appointments ?? [],
		radiographs: [],
		hasMoreEntries,
		changeEvents: [],
		changeEventsDeferred: true,
		role: context.role,
		currentUserId: ownerId,
		permissions,
		followUpParticipates: roleParticipatesInFollowUps(context.role),
		followUpCanAssign: roleSeesAllFollowUps(context.role),
		followUpTodayISO: businessTodayISO(context.business.timezone),
		clinicalTodayISO: businessTodayISO(context.business.timezone),
		demo: false
	};
};

export const actions: Actions = {
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
		const full_name = String(form.get('full_name') ?? '').trim().replace(/\s+/g, ' ');
		const dni = String(form.get('dni') ?? '').trim();
		const phoneInput = String(form.get('phone') ?? '');
		const phone = normalizePhone(phoneInput);
		const birthDateRaw = String(form.get('birth_date') ?? '').trim();

		if (!full_name) {
			return fail(400, { message: 'Ingresá el nombre del paciente.' });
		}

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
			allergies: cleanText(form.get('allergies')),
			medication: cleanText(form.get('medication')),
			background: cleanText(form.get('background'))
		};
		const updates = {
			full_name,
			email: cleanText(form.get('email')),
			dni: dni || null,
			birth_date,
			address: cleanText(form.get('address')),
			insurance: cleanText(form.get('insurance')),
			insurance_plan: cleanText(form.get('insurance_plan')),
			phone: phone || null,
			phone_raw: normalizePhoneRaw(phoneInput),
			phone_e164: normalizePhoneE164(phoneInput),
			updated_at: new Date().toISOString()
		};

		if (env.DEMO_MODE === 'true') {
			const demoPatients = readDemoDb().patients;
			const duplicateByDni = dni
				? demoPatients.find((patient) => patient.id !== params.id && patient.dni === dni)
				: null;
			if (duplicateByDni) {
				return duplicatePatientActionResult({ id: duplicateByDni.id, field: 'dni' });
			}

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
		const { context, ownerId } = session;
		const admin = await createSupabaseAdminClient('odonto', fetch);
		const currentProfessional =
			context.role === 'professional'
				? await getCurrentProfessional({
						admin,
						businessId: context.business.id,
						userId: ownerId
					})
				: null;

		if (context.role === 'professional') {
			if (!currentProfessional) {
				return fail(403, { message: 'Tu usuario no está vinculado a un profesional del consultorio.' });
			}
			const link = await ensureProfessionalCanAccessPatient({
				admin,
				businessId: context.business.id,
				patientId: params.id,
				professionalId: currentProfessional.id
			});
			if (!link) {
				return fail(403, { message: 'Este paciente no está asignado a tu perfil profesional.' });
			}
		}

		try {
			const duplicate = await findPatientDuplicateDniForUpdate({
				admin,
				businessId: context.business.id,
				patientId: params.id,
				dni
			});
			if (duplicate) return duplicatePatientActionResult(duplicate);
		} catch (duplicateError) {
			console.error('Error verificando duplicados al editar paciente', duplicateError);
			return fail(500, {
				message:
					'No pudimos comprobar si el DNI ya está asociado a otra ficha. Intentá de nuevo antes de guardar.'
			});
		}

		const [{ data: currentPatient, error: currentPatientError }, { data: currentProfile, error: currentProfileError }] =
			await Promise.all([
				admin
					.from('patients')
					.select(
						'full_name, dni, phone, email, birth_date, address, insurance, insurance_plan'
					)
					.eq('id', params.id)
					.eq('business_id', context.business.id)
					.maybeSingle(),
				admin
					.from('patient_clinical_profiles')
					.select('allergies, medication, background')
					.eq('patient_id', params.id)
					.eq('business_id', context.business.id)
					.maybeSingle()
			]);

		if (currentPatientError) {
			console.error('Error cargando paciente antes de editar', currentPatientError);
			return fail(500, { message: 'No se pudo cargar la ficha antes de guardar.' });
		}
		if (!currentPatient) {
			return fail(404, { message: 'Paciente no encontrado.' });
		}
		if (currentProfileError) {
			console.error('Error cargando perfil clínico antes de editar', currentProfileError);
		}

		const { error } = await admin
			.from('patients')
			.update(updates)
			.eq('id', params.id)
			.eq('business_id', context.business.id);

		if (error) {
			console.error('Error actualizando paciente', error);
			const duplicateResult = await mapDuplicatePatientError({
				error,
				admin,
				businessId: context.business.id,
				patientId: params.id,
				dni
			});
			if (duplicateResult) return duplicateResult;
			return fail(500, { message: 'No se pudo actualizar la ficha.' });
		}

		if (permissions.canEditClinicalProfile) {
			const { error: profileError } = await admin
				.from('patient_clinical_profiles')
				.upsert(
					{
						business_id: context.business.id,
						patient_id: params.id,
						allergies: clinicalUpdates.allergies,
						medication: clinicalUpdates.medication,
						background: clinicalUpdates.background,
						updated_by: ownerId,
						updated_at: new Date().toISOString()
					},
					{ onConflict: 'business_id,patient_id' }
				);

			if (profileError) {
				console.error('Error actualizando perfil clinico del paciente', profileError);
				return fail(500, { message: 'No se pudo actualizar la información clínica.' });
			}
		}

		const changedFields = changedFieldsForPatientUpdate({
			currentPatient: currentPatient as Record<string, unknown>,
			currentProfile: permissions.canEditClinicalProfile
				? (currentProfile as Record<string, unknown> | null)
				: null,
			updates,
			clinicalUpdates: permissions.canEditClinicalProfile ? clinicalUpdates : {}
		});

		if (changedFields.length > 0) {
			const summary = `Se modificó: ${sentenceJoin(changedFields)}.`;
			const { error: changeLogError } = await admin.from('patient_profile_change_events').insert({
				business_id: context.business.id,
				patient_id: params.id,
				changed_by_user_id: ownerId,
				changed_by_professional_id: currentProfessional?.id ?? null,
				changed_by_name: getActorName(context.role, currentProfessional?.name),
				changed_fields: changedFields,
				summary
			});
			if (changeLogError) {
				console.error('Error registrando cambios visibles del paciente', changeLogError);
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
					? 'Tu rol no permite archivar este paciente.'
					: COMMERCIAL_RESTRICTED_MESSAGE
			});
		}
		const { supabase, context, ownerId } = session;

		if (context.role === 'professional') {
			const admin = await createSupabaseAdminClient('odonto', fetch);
			const professional = await getCurrentProfessional({
				admin,
				businessId: context.business.id,
				userId: ownerId
			});
			if (!professional) {
				return fail(403, { message: 'Tu usuario no está vinculado a un profesional del consultorio.' });
			}
			const link = await ensureProfessionalCanAccessPatient({
				admin,
				businessId: context.business.id,
				patientId: params.id,
				professionalId: professional.id
			});
			if (!link) {
				return fail(403, { message: 'Este paciente no está asignado a tu perfil profesional.' });
			}
			const { error } = await admin
				.from('professional_patient_links')
				.update({
					archived_at: new Date().toISOString(),
					archived_by: ownerId,
					updated_at: new Date().toISOString()
				})
				.eq('id', link.id);

			if (error) {
				console.error('Error archivando paciente para profesional', error);
				return fail(500, { message: 'No se pudo archivar el paciente.' });
			}

			throw redirect(303, '/odonto/pacientes?estado=archivados');
		}

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
					? 'Tu rol no permite desarchivar este paciente.'
					: COMMERCIAL_RESTRICTED_MESSAGE
			});
		}
		const { supabase, context, ownerId } = session;

		if (context.role === 'professional') {
			const admin = await createSupabaseAdminClient('odonto', fetch);
			const professional = await getCurrentProfessional({
				admin,
				businessId: context.business.id,
				userId: ownerId
			});
			if (!professional) {
				return fail(403, { message: 'Tu usuario no está vinculado a un profesional del consultorio.' });
			}
			const link = await ensureProfessionalCanAccessPatient({
				admin,
				businessId: context.business.id,
				patientId: params.id,
				professionalId: professional.id
			});
			if (!link) {
				return fail(403, { message: 'Este paciente no está asignado a tu perfil profesional.' });
			}
			const { error } = await admin
				.from('professional_patient_links')
				.update({
					archived_at: null,
					archived_by: null,
					updated_at: new Date().toISOString()
				})
				.eq('id', link.id);

			if (error) {
				console.error('Error desarchivando paciente para profesional', error);
				return fail(500, { message: 'No se pudo desarchivar el paciente.' });
			}

			throw redirect(303, '/odonto/pacientes');
		}

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
		if (session.context.role === 'professional') {
			return fail(403, { message: PROFESSIONAL_DELETE_PATIENT_MESSAGE });
		}
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
