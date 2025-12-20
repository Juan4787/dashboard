import { env } from '$env/dynamic/private';
import { newId, readDemoDb, updateDemoDb } from '$lib/server/demo-store';
import { createSupabaseServerClient, getUserIdFromAccessToken } from '$lib/server/supabase';
import { normalizePhone } from '$lib/utils/format';
import { fail, redirect, error as kitError } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const getCreatePatientErrorMessage = (error: { code?: string | null; message?: string | null }) => {
	const message = (error?.message ?? '').toLowerCase();
	if (error?.code === '42501' || message.includes('row-level security')) {
		return 'No se pudo crear el paciente porque tu sesión no tiene permisos. Cerrá sesión y volvé a ingresar.';
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

export const load: PageServerLoad = async ({ locals, url, fetch }) => {
	if (!locals.auth) {
		throw redirect(303, '/login');
	}
	const isDemo = env.DEMO_MODE === 'true';

	const showArchived = url.searchParams.get('estado') === 'archivados';

	if (isDemo) {
		const patients = readDemoDb().patients
			.filter((p) => (showArchived ? p.archived_at !== null : p.archived_at === null))
			.sort((a, b) => {
				const aDate = a.updated_at ?? a.last_entry_at ?? a.created_at ?? '';
				const bDate = b.updated_at ?? b.last_entry_at ?? b.created_at ?? '';
				return aDate < bDate ? 1 : -1;
			});
		return { patients, query: '', showArchived, demo: true };
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);

	let builder = supabase
		.from('patients')
		.select('id, full_name, dni, phone, archived_at, last_entry_at, updated_at, created_at')
		.order('updated_at', { ascending: false })
		.limit(200);

	builder = showArchived ? builder.not('archived_at', 'is', null) : builder.is('archived_at', null);

	const { data, error } = await builder;
	if (error) {
		console.error('Error cargando pacientes', error);
		throw kitError(500, 'No se pudieron cargar los pacientes');
	}

	return { patients: data ?? [], query: '', showArchived, demo: false };
};

export const actions: Actions = {
	default: async ({ request, locals, fetch }) => {
		if (!locals.auth) {
			throw redirect(303, '/login');
		}
		const form = await request.formData();
		const full_name = String(form.get('full_name') ?? '').trim();
		const dni = String(form.get('dni') ?? '').trim();
		const phone = normalizePhone(String(form.get('phone') ?? '')).trim();

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

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const ownerId = getUserIdFromAccessToken(locals.auth.access_token);
		if (!ownerId) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}

		if (dni) {
			const { data: existing, error: existingError } = await supabase
				.from('patients')
				.select('id')
				.eq('dni', dni)
				.maybeSingle();

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

		const { data, error } = await supabase
			.from('patients')
			.insert({
				owner_id: ownerId,
				full_name,
				dni: dni || null,
				phone: phone || null
			})
			.select('id')
			.single();

		if (error || !data) {
			console.error('Error creando paciente', error);
			return fail(500, { message: getCreatePatientErrorMessage(error ?? {}), full_name, dni, phone });
		}

		throw redirect(303, `/odonto/pacientes/${data.id}`);
	}
};
