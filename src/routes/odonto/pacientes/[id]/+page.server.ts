import { env } from '$env/dynamic/private';
import { newId, readDemoDb, updateDemoDb } from '$lib/server/demo-store';
import { createSupabaseServerClient, getUserIdFromAccessToken } from '$lib/server/supabase';
import { normalizePhone } from '$lib/utils/format';
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

export const load: PageServerLoad = async ({ params, locals, fetch }) => {
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
		return { patient, entries, radiographs, driveConnection: null, demo: true };
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const ownerId = getUserIdFromAccessToken(locals.auth.access_token);

	const [
		{ data: patient, error: patientError },
		{ data: entries, error: entriesError },
		{ data: radiographs, error: radiographsError },
		{ data: driveConnection, error: driveError }
	] = await Promise.all([
		supabase
			.from('patients')
			.select(
				'id, full_name, dni, phone, email, birth_date, address, allergies, medication, background, insurance, insurance_plan, custom_fields, archived_at, created_at, updated_at, drive_folder_id'
			)
			.eq('id', params.id)
			.maybeSingle(),
		supabase
			.from('clinical_entries')
			.select('id, created_at, entry_type, description, teeth, amount, internal_note')
			.eq('patient_id', params.id)
			.is('archived_at', null)
			.order('created_at', { ascending: false }),
		supabase
			.from('patient_radiographs')
			.select(
				'id, patient_id, status, drive_file_id, original_filename, mime_type, bytes, taken_at, note, created_at'
			)
			.eq('patient_id', params.id)
			.is('deleted_at', null)
			.order('created_at', { ascending: false }),
		ownerId
			? supabase
					.from('drive_connections')
					.select('connected_email, root_folder_id, updated_at')
					.eq('owner_id', ownerId)
					.maybeSingle()
			: Promise.resolve({ data: null, error: null })
	]);

	if (patientError || !patient) {
		throw kitError(404, 'Paciente no encontrado');
	}

	if (entriesError) {
		console.error('Error cargando entradas', entriesError);
	}
	if (radiographsError) {
		console.error('Error cargando radiografias', radiographsError);
	}
	if (driveError) {
		console.error('Error cargando conexion Drive', driveError);
	}

	return {
		patient,
		entries: entries ?? [],
		radiographs: radiographs ?? [],
		driveConnection: driveConnection ?? null,
		demo: false
	};
};

export const actions: Actions = {
	set_drive_folder: async ({ request, params, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}
		const form = await request.formData();
		const drive_folder_id = String(form.get('drive_folder_id') ?? '').trim();
		if (!drive_folder_id) {
			return fail(400, { message: 'Carpeta invalida.' });
		}

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const { error } = await supabase
			.from('patients')
			.update({ drive_folder_id })
			.eq('id', params.id);

		if (error) {
			console.error('Error guardando carpeta Drive', error);
			return fail(500, { message: 'No se pudo guardar la carpeta de Drive.' });
		}

		return { success: true };
	},
	start_radiograph: async ({ request, params, locals, fetch }) => {
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

		const ownerId = getUserIdFromAccessToken(locals.auth.access_token);
		if (!ownerId) {
			return fail(401, { message: 'Sesion invalida. Volve a iniciar sesion.' });
		}

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const { data, error } = await supabase
			.from('patient_radiographs')
			.insert({
				owner_id: ownerId,
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
	reset_radiograph: async ({ request, params, locals, fetch }) => {
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

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
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
	finalize_radiograph: async ({ request, params, locals, fetch }) => {
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

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
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
	mark_radiograph_failed: async ({ request, params, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const form = await request.formData();
		const radiograph_id = String(form.get('radiograph_id') ?? '').trim();
		if (!radiograph_id) {
			return fail(400, { message: 'Radiografia invalida.' });
		}

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const { data, error } = await supabase
			.from('patient_radiographs')
			.update({ status: 'failed' })
			.eq('id', radiograph_id)
			.eq('patient_id', params.id)
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
	delete_radiograph: async ({ request, params, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'No disponible en modo demo.' });
		}

		const form = await request.formData();
		const radiograph_id = String(form.get('radiograph_id') ?? '').trim();
		if (!radiograph_id) {
			return fail(400, { message: 'Radiografia invalida.' });
		}

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const { error } = await supabase
			.from('patient_radiographs')
			.delete()
			.eq('id', radiograph_id)
			.eq('patient_id', params.id);

		if (error) {
			console.error('Error eliminando radiografia', error);
			return fail(500, { message: 'No se pudo eliminar la radiografia.' });
		}

		return { success: true };
	},
	add_entry: async ({ request, params, locals, fetch }) => {
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

		const amount = amountRaw ? Number(amountRaw) : null;

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

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const ownerId = getUserIdFromAccessToken(locals.auth.access_token);
		if (!ownerId) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}

		const { error } = await supabase.from('clinical_entries').insert({
			owner_id: ownerId,
			patient_id: params.id,
			entry_type,
			description,
			created_at,
			teeth: teeth || null,
			amount,
			internal_note: internal_note || null
		});

		if (error) {
			console.error('Error guardando entrada', error);
			return fail(500, { message: 'No se pudo guardar la entrada' });
		}

		throw redirect(303, `/odonto/pacientes/${params.id}`);
	},
	update_entry: async ({ request, params, locals, fetch }) => {
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
		const amount = amountRaw ? Number(amountRaw) : null;

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

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);

		const { error } = await supabase
			.from('clinical_entries')
			.update({
				entry_type,
				description,
				created_at,
				teeth: teeth || null,
				amount,
				internal_note: internal_note || null
			})
			.eq('id', entry_id)
			.eq('patient_id', params.id);

		if (error) {
			console.error('Error actualizando entrada', error);
			return fail(500, { message: 'No se pudo actualizar la entrada' });
		}

		throw redirect(303, `/odonto/pacientes/${params.id}`);
	},
	update_patient: async ({ request, params, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');

		const form = await request.formData();
		const dni = String(form.get('dni') ?? '').trim();
		const phone = normalizePhone(String(form.get('phone') ?? ''));
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

		const updates = {
			email: String(form.get('email') ?? '') || null,
			dni: dni || null,
			birth_date,
			address: String(form.get('address') ?? '') || null,
			allergies: String(form.get('allergies') ?? '') || null,
			medication: String(form.get('medication') ?? '') || null,
			background: String(form.get('background') ?? '') || null,
			insurance: String(form.get('insurance') ?? '') || null,
			insurance_plan: String(form.get('insurance_plan') ?? '') || null,
			phone: phone || null,
			updated_at: new Date().toISOString()
		};

		if (env.DEMO_MODE === 'true') {
			let updated = false;
			updateDemoDb((db) => {
				const patient = db.patients.find((p) => p.id === params.id);
				if (!patient) return;
				Object.assign(patient, updates);
				updated = true;
			});

			if (!updated) {
				return fail(404, { message: 'Paciente no encontrado' });
			}

			throw redirect(303, `/odonto/pacientes/${params.id}`);
		}

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);

		const { error } = await supabase.from('patients').update(updates).eq('id', params.id);

		if (error) {
			console.error('Error actualizando paciente', error);
			return fail(500, { message: 'No se pudo actualizar la ficha' });
		}

		throw redirect(303, `/odonto/pacientes/${params.id}`);
	},
	archive_patient: async ({ params, locals, fetch }) => {
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
		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);

		const { error } = await supabase
			.from('patients')
			.update({ archived_at: new Date().toISOString() })
			.eq('id', params.id);

		if (error) {
			console.error('Error archivando paciente', error);
			return fail(500, { message: 'No se pudo archivar el paciente' });
		}

		throw redirect(303, '/odonto/pacientes?estado=archivados');
	},
	unarchive_patient: async ({ params, locals, fetch }) => {
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
		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);

		const { error } = await supabase.from('patients').update({ archived_at: null }).eq('id', params.id);

		if (error) {
			console.error('Error desarchivando paciente', error);
			return fail(500, { message: 'No se pudo desarchivar el paciente' });
		}

		throw redirect(303, '/odonto/pacientes');
	},
	delete_patient: async ({ params, locals, fetch }) => {
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
		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);

		// Primero borrar entradas clínicas para evitar errores de FK.
		const { error: entriesError } = await supabase.from('clinical_entries').delete().eq('patient_id', params.id);
		if (entriesError) {
			console.error('Error eliminando entradas', entriesError);
			return fail(500, { message: 'No se pudieron eliminar las entradas del paciente' });
		}

		const { error: patientError } = await supabase.from('patients').delete().eq('id', params.id);
		if (patientError) {
			console.error('Error eliminando paciente', patientError);
			return fail(500, { message: 'No se pudo eliminar el paciente' });
		}

		throw redirect(303, '/odonto/pacientes');
	}
};
