import { env } from '$env/dynamic/private';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { normalizePhone } from '$lib/utils/format';
import { fail, redirect, error as kitError } from '@sveltejs/kit';
import { demoClinicalEntries, demoPatients } from '$lib/server/demo-data';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, fetch }) => {
	if (!locals.auth) {
		throw redirect(303, '/login');
	}

	if (env.DEMO_MODE === 'true') {
		const patient = demoPatients.find((p) => p.id === params.id);
		if (!patient) throw kitError(404, 'Paciente no encontrado');
		const entries = demoClinicalEntries
			.filter((e) => e.patient_id === params.id)
			.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
		return { patient, entries, demo: true };
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);

	const [{ data: patient, error: patientError }, { data: entries, error: entriesError }] =
		await Promise.all([
			supabase
				.from('patients')
				.select(
					'id, full_name, dni, phone, email, birth_date, address, allergies, medication, background, insurance, custom_fields, archived_at, created_at, updated_at'
				)
				.eq('id', params.id)
				.maybeSingle(),
			supabase
				.from('clinical_entries')
				.select('id, created_at, entry_type, description, teeth, amount, internal_note')
				.eq('patient_id', params.id)
				.is('archived_at', null)
				.order('created_at', { ascending: false })
		]);

	if (patientError || !patient) {
		throw kitError(404, 'Paciente no encontrado');
	}

	if (entriesError) {
		console.error('Error cargando entradas', entriesError);
	}

	return {
		patient,
		entries: entries ?? []
	};
};

export const actions: Actions = {
	add_entry: async ({ request, params, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'Modo demo: no se guardan cambios' });
		}
		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);

		const form = await request.formData();
		const entry_type = String(form.get('entry_type') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		const created_at = form.get('created_at')
			? new Date(String(form.get('created_at'))).toISOString()
			: new Date().toISOString();
		const teeth = String(form.get('teeth') ?? '').trim();
		const amountRaw = String(form.get('amount') ?? '').trim();
		const internal_note = String(form.get('internal_note') ?? '').trim();

		if (!entry_type || !description) {
			return fail(400, { message: 'Tipo y descripción son obligatorios' });
		}

		const amount = amountRaw ? Number(amountRaw) : null;

		const { error } = await supabase.from('clinical_entries').insert({
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
	update_patient: async ({ request, params, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'Modo demo: no se guardan cambios' });
		}
		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);

		const form = await request.formData();
		const phone = normalizePhone(String(form.get('phone') ?? ''));

		const updates = {
			email: String(form.get('email') ?? '') || null,
			birth_date: String(form.get('birth_date') ?? '') || null,
			address: String(form.get('address') ?? '') || null,
			allergies: String(form.get('allergies') ?? '') || null,
			medication: String(form.get('medication') ?? '') || null,
			background: String(form.get('background') ?? '') || null,
			insurance: String(form.get('insurance') ?? '') || null,
			phone: phone || null,
			updated_at: new Date().toISOString()
		};

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
			return fail(400, { message: 'Modo demo: no se guardan cambios' });
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
	}
};
