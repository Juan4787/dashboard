import { env } from '$env/dynamic/private';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { normalizePhone } from '$lib/utils/format';
import { fail, redirect, error as kitError } from '@sveltejs/kit';
import { demoPatients } from '$lib/server/demo-data';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url, fetch }) => {
	if (!locals.auth) {
		throw redirect(303, '/login');
	}
	const isDemo = env.DEMO_MODE === 'true';

	const showArchived = url.searchParams.get('estado') === 'archivados';

	if (isDemo) {
		const filtered = demoPatients.filter((p) => (showArchived ? true : p.archived_at === null));
		return { patients: filtered, query: '', showArchived, demo: true };
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);

	let builder = supabase
		.from('patients')
		.select('id, full_name, dni, phone, archived_at, last_entry_at, updated_at, created_at')
		.order('updated_at', { ascending: false })
		.limit(200);
	if (!showArchived) {
		builder = builder.is('archived_at', null);
	}

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
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'Modo demo: no se guardan cambios' });
		}
		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);

		const form = await request.formData();
		const full_name = String(form.get('full_name') ?? '').trim();
		const dni = String(form.get('dni') ?? '').trim();
		const phone = normalizePhone(String(form.get('phone') ?? '')).trim();

		if (!full_name) {
			return fail(400, { message: 'Nombre y apellido son obligatorios' });
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
				full_name,
				dni: dni || null,
				phone: phone || null
			})
			.select('id')
			.single();

		if (error || !data) {
			console.error('Error creando paciente', error);
			return fail(500, { message: 'No se pudo crear el paciente', full_name, dni, phone });
		}

		throw redirect(303, `/odonto/pacientes/${data.id}`);
	}
};
