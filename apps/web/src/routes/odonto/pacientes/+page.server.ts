import { env } from '$env/dynamic/private';
import { resolveActiveBusiness } from '$lib/server/business';
import { newId, readDemoDb, updateDemoDb } from '$lib/server/demo-store';
import { normalizePhoneE164, normalizePhoneRaw } from '$lib/server/phone';
import { createSupabaseServerClient, getAuthUserId, isJwtExpired } from '$lib/server/supabase';
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
			let createdId: string | null = null;
			let existingId: string | null = null;

			updateDemoDb((db) => {
				if (dni) {
					const existing = db.patients.find((p) => p.dni === dni);
					if (existing) {
						existingId = existing.id;
						return;
					}
				}

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

			if (existingId) {
				return fail(409, {
					message: 'Ya existe un paciente con este DNI',
					existingId,
					full_name,
					dni,
					phone
				});
			}

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
				message: 'La cuenta está suspendida. Regularizá la suscripción para volver a operar.',
				full_name,
				dni,
				phone
			});
		}

		if (dni) {
			const { data: existing, error: existingError } = await supabase
				.from('patients')
				.select('id')
				.eq('dni', dni)
				.eq('business_id', context.business.id)
				.maybeSingle();

			if (existingError && isJwtExpiredError(existingError)) {
				const refreshed = await refreshSessionIfNeeded();
				if (refreshed) {
					const { data: retryExisting, error: retryError } = await supabase
						.from('patients')
						.select('id')
						.eq('dni', dni)
						.eq('business_id', context.business.id)
						.maybeSingle();
					if (!retryError && retryExisting?.id) {
						return fail(409, {
							message: 'Ya existe un paciente con este DNI',
							existingId: retryExisting.id,
							full_name,
							dni,
							phone
						});
					}
				}
			}

			if (!existingError && existing?.id) {
				return fail(409, {
					message: 'Ya existe un paciente con este DNI',
					existingId: existing.id,
					full_name,
					dni,
					phone
				});
			}
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
			console.error('Error creando paciente:', error);
			return fail(getCreatePatientStatus(error ?? {}), {
				message: getCreatePatientErrorMessage(error ?? {}),
				full_name,
				dni,
				phone
			});
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
