import { env } from '$env/dynamic/private';
import { resolveActiveBusiness } from '$lib/server/business';
import { newId, readDemoDb, updateDemoDb } from '$lib/server/demo-store';
import { normalizePhoneE164, normalizePhoneRaw } from '$lib/server/phone';
import {
	createSupabaseAdminClient,
	createSupabaseServerClient,
	getAuthUserId,
	isJwtExpired
} from '$lib/server/supabase';
import { normalizePhone } from '$lib/utils/format';
import { fail, redirect, error as kitError } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { Actions, PageServerLoad } from './$types';

const getCreatePatientErrorMessage = (error: { code?: string | null; message?: string | null }) => {
	const message = (error?.message ?? '').toLowerCase();
	if (error?.code === '42501' || message.includes('row-level security')) {
		return 'No se pudo crear el paciente porque tu sesión no tiene permisos. Cerrá sesión y volvé a ingresar.';
	}
	if (error?.code === 'PGRST303' || message.includes('jwt expired')) {
		return 'Tu sesión expiró. Volvé a iniciar sesión.';
	}
	if (error?.code === '23505') {
		return 'Ya existe un paciente con este DNI.';
	}
	if (error?.code === '23502') {
		return 'Faltan datos obligatorios para crear el paciente.';
	}
	if (error?.code === '22P02') {
		return 'El DNI o el teléfono tienen un formato inválido.';
	}
	return 'No se pudo crear el paciente. Intentá de nuevo.';
};

const getCreatePatientStatus = (error: { code?: string | null; message?: string | null }) => {
	const message = (error?.message ?? '').toLowerCase();
	if (error?.code === '42501' || message.includes('row-level security')) return 403;
	if (error?.code === 'PGRST303' || message.includes('jwt expired')) return 401;
	if (error?.code === '23505') return 409;
	if (error?.code === '23502' || error?.code === '22P02') return 400;
	return 500;
};

const isJwtExpiredError = (error: { code?: string | null; message?: string | null }) => {
	const message = (error?.message ?? '').toLowerCase();
	return error?.code === 'PGRST303' || message.includes('jwt expired');
};

type CountsSource = 'rpc' | 'fallback_planned';

type DuplicatePatientField = 'dni' | 'name';

const normalizePatientName = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

const duplicatePatientMessage = (field: DuplicatePatientField) =>
	field === 'dni'
		? 'Ya hay un paciente creado con ese DNI. Abrí su ficha para continuar.'
		: 'Ya hay un paciente creado con ese nombre. Abrí su ficha para continuar.';

const duplicatePatientResult = ({
	field,
	existingId,
	full_name,
	dni,
	phone
}: {
	field: DuplicatePatientField;
	existingId: string;
	full_name: string;
	dni: string;
	phone: string;
}) => ({
	duplicate: true,
	duplicateField: field,
	message: duplicatePatientMessage(field),
	existingId,
	full_name,
	dni,
	phone
});

const findExistingPatientIdentity = async ({
	admin,
	businessId,
	fullName,
	dni
}: {
	admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>;
	businessId: string;
	fullName: string;
	dni: string;
}): Promise<{ id: string; field: DuplicatePatientField } | null> => {
	const normalizedName = normalizePatientName(fullName);

	if (dni) {
		const { data, error } = await admin
			.from('patients')
			.select('id')
			.eq('business_id', businessId)
			.eq('dni', dni)
			.limit(1)
			.maybeSingle();
		if (error) throw error;
		if (data?.id) return { id: String(data.id), field: 'dni' };
	}

	const { data, error } = await admin
		.from('patients')
		.select('id, full_name')
		.eq('business_id', businessId)
		.range(0, 9999);
	if (error) throw error;

	const existingByName = (data ?? []).find(
		(patient: any) => normalizePatientName(String(patient.full_name ?? '')) === normalizedName
	);
	if (existingByName?.id) return { id: String(existingByName.id), field: 'name' };

	return null;
};

const ensureProfessionalPatientLink = async ({
	fetch,
	businessId,
	userId,
	patientId
}: {
	fetch: typeof globalThis.fetch;
	businessId: string;
	userId: string;
	patientId: string;
}) => {
	const admin = await createSupabaseAdminClient('odonto', fetch);
	const { data: professionalUser, error: professionalUserError } = await admin
		.from('professional_users')
		.select('professional_id')
		.eq('business_id', businessId)
		.eq('user_id', userId)
		.order('created_at', { ascending: true })
		.limit(1)
		.maybeSingle();

	if (professionalUserError) throw professionalUserError;
	const professionalId = professionalUser?.professional_id ? String(professionalUser.professional_id) : null;
	if (!professionalId) throw new Error('PROFESSIONAL_LINK_REQUIRED');

	const { data: existingLink, error: existingLinkError } = await admin
		.from('professional_patient_links')
		.select('id, is_active')
		.eq('business_id', businessId)
		.eq('professional_id', professionalId)
		.eq('patient_id', patientId)
		.order('is_active', { ascending: false })
		.order('created_at', { ascending: true })
		.limit(1)
		.maybeSingle();

	if (existingLinkError) throw existingLinkError;

	if (existingLink?.id) {
		const { error } = await admin
			.from('professional_patient_links')
			.update({
				is_active: true,
				source: 'manual',
				disabled_by: null,
				disabled_at: null,
				disabled_reason: null,
				updated_at: new Date().toISOString()
			})
			.eq('id', existingLink.id);
		if (error) throw error;
		return;
	}

	const { error: insertError } = await admin.from('professional_patient_links').insert({
		business_id: businessId,
		professional_id: professionalId,
		patient_id: patientId,
		source: 'manual',
		created_by: userId
	});

	if (!insertError) return;
	if (insertError.code !== '23505') throw insertError;

	const { error: activateError } = await admin
		.from('professional_patient_links')
		.update({
			is_active: true,
			source: 'manual',
			disabled_by: null,
			disabled_at: null,
			disabled_reason: null,
			updated_at: new Date().toISOString()
		})
		.eq('business_id', businessId)
		.eq('professional_id', professionalId)
		.eq('patient_id', patientId);
	if (activateError) throw activateError;
};

export const load: PageServerLoad = async ({ locals, url, fetch, cookies }) => {
	if (!locals.auth) {
		throw redirect(303, '/login');
	}
	const isDemo = env.DEMO_MODE === 'true';

	const showArchived = url.searchParams.get('estado') === 'archivados';

	if (isDemo) {
		const demoPatients = readDemoDb().patients;
		const activeCount = demoPatients.filter((p) => !p.archived_at).length;
		const archivedCount = demoPatients.filter((p) => p.archived_at).length;
		const patients = demoPatients
			.filter((p) => (showArchived ? p.archived_at !== null : p.archived_at === null))
			.sort((a, b) => {
				const aDate = a.updated_at ?? a.last_entry_at ?? a.created_at ?? '';
				const bDate = b.updated_at ?? b.last_entry_at ?? b.created_at ?? '';
				return aDate < bDate ? 1 : -1;
			});
		return {
			patients,
			query: '',
			showArchived,
			demo: true,
			canCreatePatient: true,
			totalCount: demoPatients.length,
			activeCount,
			archivedCount,
			countsSource: 'fallback_planned' as const
		};
	}

	let supabase;
	try {
		supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	} catch (err) {
		console.error('Error creando cliente Supabase:', err);
		throw kitError(500, 'Error de conexión con la base de datos');
	}

	const ownerId = await getAuthUserId(supabase, locals.auth.access_token);
	if (!ownerId) {
		throw redirect(303, '/login');
	}
	const context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth.access_token,
		cookies
	});
	if (!context) {
		throw kitError(500, 'No se pudo resolver el negocio activo');
	}

	if (context.role === 'professional') {
		const admin = await createSupabaseAdminClient('odonto', fetch);
		const { data: professionalUser, error: professionalUserError } = await admin
			.from('professional_users')
			.select('professional_id')
			.eq('business_id', context.business.id)
			.eq('user_id', ownerId)
			.order('created_at', { ascending: true })
			.limit(1)
			.maybeSingle();

		if (professionalUserError) {
			console.error('Error resolviendo profesional para listar pacientes', professionalUserError);
			throw kitError(500, 'No se pudieron cargar los pacientes');
		}

		const professionalId = (professionalUser as any)?.professional_id
			? String((professionalUser as any).professional_id)
			: null;
		if (!professionalId) {
			return {
				patients: [],
				query: '',
				showArchived,
				demo: false,
				canCreatePatient: context.access.allowedCapabilities.canCreatePatient,
				totalCount: 0,
				activeCount: 0,
				archivedCount: 0,
				countsSource: 'fallback_planned' as const
			};
		}

		const { data: links, error: linksError } = await admin
			.from('professional_patient_links')
			.select('patient_id, archived_at')
			.eq('business_id', context.business.id)
			.eq('professional_id', professionalId)
			.eq('is_active', true);

		if (linksError) {
			console.error('Error cargando vínculos profesional-paciente', linksError);
			throw kitError(500, 'No se pudieron cargar los pacientes');
		}

		const linkRows = links ?? [];
		const linkArchivedByPatientId = new Map(
			linkRows.map((link: any) => [String(link.patient_id), link.archived_at ?? null])
		);
		const patientIds = [...linkArchivedByPatientId.keys()];

		if (patientIds.length === 0) {
			return {
				patients: [],
				query: '',
				showArchived,
				demo: false,
				canCreatePatient: context.access.allowedCapabilities.canCreatePatient,
				totalCount: 0,
				activeCount: 0,
				archivedCount: 0,
				countsSource: 'fallback_planned' as const
			};
		}

		const { data: linkedPatients, error: linkedPatientsError } = await admin
			.from('patients')
			.select('id, full_name, dni, phone, archived_at, last_entry_at, updated_at, created_at')
			.eq('business_id', context.business.id)
			.in('id', patientIds)
			.is('archived_at', null)
			.order('updated_at', { ascending: false })
			.limit(200);

		if (linkedPatientsError) {
			console.error('Error cargando pacientes vinculados al profesional', linkedPatientsError);
			throw kitError(500, 'No se pudieron cargar los pacientes');
		}

		const decoratedPatients = (linkedPatients ?? []).map((patient: any) => {
			const professionalArchivedAt = linkArchivedByPatientId.get(String(patient.id)) ?? null;
			return {
				...patient,
				archived_at: professionalArchivedAt,
				professional_archived_at: professionalArchivedAt
			};
		});
		const activeCount = decoratedPatients.filter((patient: any) => !patient.professional_archived_at).length;
		const archivedCount = decoratedPatients.filter((patient: any) => patient.professional_archived_at).length;
		const patients = decoratedPatients.filter((patient: any) =>
			showArchived ? patient.professional_archived_at : !patient.professional_archived_at
		);

		return {
			patients,
			query: '',
			showArchived,
			demo: false,
			canCreatePatient: context.access.allowedCapabilities.canCreatePatient,
			totalCount: decoratedPatients.length,
			activeCount,
			archivedCount,
			countsSource: 'fallback_planned' as const
		};
	}

	let patientsBuilder = supabase
		.from('patients')
		.select('id, full_name, dni, phone, archived_at, last_entry_at, updated_at, created_at')
		.eq('business_id', context.business.id)
		.order('updated_at', { ascending: false })
		.limit(200);

	patientsBuilder = showArchived
		? patientsBuilder.not('archived_at', 'is', null)
		: patientsBuilder.is('archived_at', null);

	const [patientsRes, countsRpcRes] = await Promise.all([
		patientsBuilder,
		supabase.rpc('patients_counts_by_business', { p_business: context.business.id }).maybeSingle()
	]);
	const { data, error } = patientsRes;
	if (error) {
		console.error('Error cargando pacientes', error);
		throw kitError(500, 'No se pudieron cargar los pacientes');
	}

	let totalCount = data?.length ?? 0;
	let activeCount = showArchived ? 0 : totalCount;
	let archivedCount = showArchived ? totalCount : 0;
	let countsSource: CountsSource = 'rpc';

	const { data: countsRaw, error: countsError } = countsRpcRes;
	const counts = countsRaw as
		| { total_count?: number | null; active_count?: number | null; archived_count?: number | null }
		| null;
	if (!countsError && counts) {
		totalCount = Number(counts.total_count ?? totalCount);
		activeCount = Number(counts.active_count ?? activeCount);
		archivedCount = Number(counts.archived_count ?? archivedCount);
	} else {
		countsSource = 'fallback_planned';
		if (countsError) {
			console.error('Error contando pacientes por RPC, se usa fallback planned', countsError);
		}
		const [totalRes, activeRes, archivedRes] = await Promise.all([
			supabase
				.from('patients')
				.select('id', { count: 'planned', head: true })
				.eq('business_id', context.business.id),
			supabase
				.from('patients')
				.select('id', { count: 'planned', head: true })
				.eq('business_id', context.business.id)
				.is('archived_at', null),
			supabase
				.from('patients')
				.select('id', { count: 'planned', head: true })
				.eq('business_id', context.business.id)
				.not('archived_at', 'is', null)
		]);

		if (totalRes.error) {
			console.error('Error contando pacientes (planned)', totalRes.error);
		} else if (typeof totalRes.count === 'number') {
			totalCount = totalRes.count;
		}
		if (activeRes.error) {
			console.error('Error contando pacientes activos (planned)', activeRes.error);
		} else if (typeof activeRes.count === 'number') {
			activeCount = activeRes.count;
		}
		if (archivedRes.error) {
			console.error('Error contando pacientes archivados (planned)', archivedRes.error);
		} else if (typeof archivedRes.count === 'number') {
			archivedCount = archivedRes.count;
		}
	}

	return {
		patients: data ?? [],
		query: '',
		showArchived,
		demo: false,
		canCreatePatient: context.access.allowedCapabilities.canCreatePatient,
		totalCount,
		activeCount,
		archivedCount,
		countsSource
	};
};


const handleCreatePatient = async ({
	request,
	locals,
	fetch,
	cookies
}: {
	request: Request;
	locals: App.Locals;
	fetch: typeof globalThis.fetch;
	cookies: import('@sveltejs/kit').Cookies;
}) => {
	try {
		if (!locals.auth) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		const form = await request.formData();
		const full_name = String(form.get('full_name') ?? '').trim();
		const dni = String(form.get('dni') ?? '').trim();
		const phoneInput = String(form.get('phone') ?? '');
		const phone = normalizePhone(phoneInput).trim();
		const phone_raw = normalizePhoneRaw(phoneInput);
		const phone_e164 = normalizePhoneE164(phoneInput);

		if (!full_name) {
			return fail(400, { message: 'Nombre y apellido son obligatorios' });
		}

		if (env.DEMO_MODE === 'true') {
			const demoPatients = readDemoDb().patients;
			const existingByDni = dni ? demoPatients.find((patient) => patient.dni === dni) : null;
			if (existingByDni) {
				return duplicatePatientResult({
					field: 'dni',
					existingId: existingByDni.id,
					full_name,
					dni,
					phone
				});
			}

			const existingByName = demoPatients.find(
				(patient) => normalizePatientName(patient.full_name) === normalizePatientName(full_name)
			);
			if (existingByName) {
				return duplicatePatientResult({
					field: 'name',
					existingId: existingByName.id,
					full_name,
					dni,
					phone
				});
			}

			let createdId: string | null = null;

			updateDemoDb((db) => {
				const now = new Date().toISOString();
				const id = newId('p');
				db.patients.unshift({
					id,
					full_name,
					dni: dni || null,
					phone: phone || null,
					email: null,
					birth_date: null,
					address: null,
					allergies: null,
					medication: null,
					background: null,
					insurance: null,
					custom_fields: null,
					archived_at: null,
					last_entry_at: null,
					created_at: now,
					updated_at: now
				});
				createdId = id;
			});

			if (!createdId) {
				return fail(500, {
					message: 'No se pudo crear el paciente. Intentá de nuevo.',
					full_name,
					dni,
					phone
				});
			}

			throw redirect(303, `/odonto/pacientes/${createdId}`);
		}

		let supabase;
		try {
			supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		} catch (err) {
			console.error('Error creando cliente Supabase:', err);
			return fail(500, {
				message: 'Error de conexión con la base de datos. Intentá de nuevo.',
				full_name,
				dni,
				phone
			});
		}

		const refreshSessionIfNeeded = async () => {
			if (!locals.auth) return false;
			if (!isJwtExpired(locals.auth.access_token)) return true;
			const { data, error } = await supabase.auth.refreshSession({
				refresh_token: locals.auth.refresh_token
			});
			if (error || !data.session) {
				return false;
			}
			const session = data.session;
			const cookieOptions = {
				path: '/',
				httpOnly: true,
				secure: !dev,
				sameSite: 'lax' as const,
				maxAge: 60 * 60 * 24 * 7
			};
			cookies.set('sb-module', locals.auth.module, cookieOptions);
			cookies.set('sb-access-token', session.access_token, cookieOptions);
			cookies.set('sb-refresh-token', session.refresh_token, cookieOptions);
			locals.auth = {
				module: locals.auth.module,
				access_token: session.access_token,
				refresh_token: session.refresh_token
			};
			return true;
		};

		const refreshed = await refreshSessionIfNeeded();
		if (!refreshed) {
			return fail(401, {
				message: 'Tu sesión expiró. Volvé a iniciar sesión.',
				full_name,
				dni,
				phone
			});
		}

		const ownerId = await getAuthUserId(supabase, locals.auth.access_token);
		if (!ownerId) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		const context = await resolveActiveBusiness({
			supabase,
			accessToken: locals.auth.access_token,
			cookies
		});
		if (!context) {
			return fail(500, { message: 'No se pudo resolver el negocio activo.', full_name, dni, phone });
		}
		if (!context.access.allowedCapabilities.canCreatePatient) {
			return fail(403, {
				message: 'Suscripción pendiente de regularización. Para volver a operar el consultorio, regularizá la suscripción.',
				full_name,
				dni,
				phone
			});
		}

		let admin;
		const returnDuplicatePatient = async (existingPatient: { id: string; field: DuplicatePatientField }) => {
			if (context.role === 'professional') {
				try {
					await ensureProfessionalPatientLink({
						fetch,
						businessId: context.business.id,
						userId: ownerId,
						patientId: existingPatient.id
					});
				} catch (linkError) {
					console.error('Error vinculando paciente duplicado al profesional', linkError);
					return fail(500, {
						message: 'Ya hay un paciente creado con esos datos, pero no se pudo vincular al profesional. Intentá de nuevo.',
						existingId: existingPatient.id,
						full_name,
						dni,
						phone
					});
				}
			}

			return duplicatePatientResult({
				field: existingPatient.field,
				existingId: existingPatient.id,
				full_name,
				dni,
				phone
			});
		};

		try {
			admin = await createSupabaseAdminClient('odonto', fetch);
			const existingPatient = await findExistingPatientIdentity({
				admin,
				businessId: context.business.id,
				fullName: full_name,
				dni
			});
			if (existingPatient) {
				return returnDuplicatePatient(existingPatient);
			}
		} catch (duplicateLookupError) {
			console.error('Error verificando duplicados de paciente', duplicateLookupError);
			return fail(500, {
				message: 'No se pudo verificar si el paciente ya existe. Intentá de nuevo.',
				full_name,
				dni,
				phone
			});
		}

		let { data, error } = await supabase
			.from('patients')
			.insert({
				owner_id: ownerId,
				business_id: context.business.id,
				full_name,
				dni: dni || null,
				phone: phone || null,
				phone_raw,
				phone_e164
			})
			.select('id')
			.single();

		if (error && isJwtExpiredError(error)) {
			const refreshed = await refreshSessionIfNeeded();
			if (refreshed) {
				const retry = await supabase
					.from('patients')
					.insert({
						owner_id: ownerId,
						business_id: context.business.id,
						full_name,
						dni: dni || null,
						phone: phone || null,
						phone_raw,
						phone_e164
					})
					.select('id')
					.single();
				data = retry.data;
				error = retry.error;
			}
		}

		if (error || !data) {
			const message = String(error?.message ?? '');
			if (message.includes('PATIENT_DNI_ALREADY_EXISTS') || message.includes('PATIENT_NAME_ALREADY_EXISTS')) {
				const existingPatient = await findExistingPatientIdentity({
					admin,
					businessId: context.business.id,
					fullName: full_name,
					dni
				});
				if (existingPatient) {
					return returnDuplicatePatient(existingPatient);
				}
			}
			console.error('Error creando paciente:', error);
			return fail(getCreatePatientStatus(error ?? {}), {
				message: getCreatePatientErrorMessage(error ?? {}),
				full_name,
				dni,
				phone
			});
		}

		if (context.role === 'professional') {
			try {
				await ensureProfessionalPatientLink({
					fetch,
					businessId: context.business.id,
					userId: ownerId,
					patientId: data.id
				});
			} catch (linkError) {
				console.error('Error vinculando paciente al profesional', linkError);
				try {
					await admin
						.from('patients')
						.delete()
						.eq('business_id', context.business.id)
						.eq('id', data.id);
				} catch (cleanupError) {
					console.error('Error limpiando paciente sin vinculo profesional', cleanupError);
				}
				return fail(500, {
					message: 'No se pudo vincular el paciente al profesional. Intentá de nuevo.',
					full_name,
					dni,
					phone
				});
			}
		}

		throw redirect(303, `/odonto/pacientes/${data.id}`);
	} catch (err) {
		// Re-throw redirects (they use throw in SvelteKit)
		if (err && typeof err === 'object' && 'status' in err && 'location' in err) {
			throw err;
		}
		console.error('Error inesperado en create_patient:', err);
		return fail(500, {
			message: 'Error interno del servidor. Intentá de nuevo.',
			full_name: '',
			dni: '',
			phone: ''
		});
	}
};

export const actions: Actions = {
	create_patient: handleCreatePatient
};
