import { env } from '$env/dynamic/private';
import { CASE_STATUS } from '$lib/constants';
import { createSupabaseServerClient, getUserIdFromAccessToken } from '$lib/server/supabase';
import { normalizePhone } from '$lib/utils/format';
import { fail, redirect, error as kitError } from '@sveltejs/kit';
import { demoCases } from '$lib/server/demo-data';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url, fetch }) => {
	if (!locals.auth) throw redirect(303, '/login');
	const isDemo = env.DEMO_MODE === 'true';

	const statusFilter = url.searchParams.get('estado') ?? 'todos';

	if (isDemo) {
		const filtered = demoCases.filter((c) => (statusFilter === 'todos' ? true : c.status === statusFilter));
		return { cases: filtered, query: '', statusFilter, statuses: CASE_STATUS, demo: true };
	}

	const supabase = await createSupabaseServerClient('administrativo', locals.auth, fetch);

	let builder = supabase
		.from('cases')
		.select(
			'id, title, status, next_action, next_action_date, updated_at, archived_at, person_id, person_name, person_dni'
		)
		.order('updated_at', { ascending: false })
		.limit(200);
	if (statusFilter !== 'todos') {
		builder = builder.eq('status', statusFilter);
	}

	const { data, error } = await builder;
	if (error) {
		console.error('Error cargando expedientes', error);
		throw kitError(500, 'No se pudieron cargar los expedientes');
	}

	return { cases: data ?? [], query: '', statusFilter, statuses: CASE_STATUS, demo: false };
};

export const actions: Actions = {
	default: async ({ request, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			return fail(400, { message: 'Modo demo: no se guardan cambios' });
		}
		const supabase = await createSupabaseServerClient('administrativo', locals.auth, fetch);
		const ownerId = getUserIdFromAccessToken(locals.auth.access_token);
		if (!ownerId) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}

		const form = await request.formData();
		const person_name = String(form.get('person_name') ?? '').trim();
		const person_dni = String(form.get('person_dni') ?? '').trim();
		const person_phone = normalizePhone(String(form.get('person_phone') ?? ''));
		const person_email = String(form.get('person_email') ?? '').trim();
		const title = String(form.get('title') ?? '').trim();
		const status = (String(form.get('status') ?? '') || 'Nuevo') as (typeof CASE_STATUS)[number];
		const next_action = String(form.get('next_action') ?? '').trim();
		const next_action_date = String(form.get('next_action_date') ?? '').trim();

		if (!person_name || !title) {
			return fail(400, { message: 'Nombre y carátula son obligatorios', person_name, person_dni, title });
		}

		// Reutilizar persona si coincide DNI
		let personId: string | null = null;
		if (person_dni) {
			const { data: existing } = await supabase
				.from('people')
				.select('id')
				.eq('dni', person_dni)
				.maybeSingle();
			if (existing?.id) {
				personId = existing.id;
			}
		}

		if (!personId) {
			const { data: personInsert, error: personError } = await supabase
				.from('people')
				.insert({
					owner_id: ownerId,
					full_name: person_name,
					dni: person_dni || null,
					phone: person_phone || null,
					email: person_email || null
				})
				.select('id')
				.single();

			if (personError || !personInsert) {
				console.error('Error creando persona', personError);
				return fail(500, { message: 'No se pudo crear la persona', person_name, person_dni, title });
			}
			personId = personInsert.id;
		}

		const { data: caseInsert, error } = await supabase
			.from('cases')
			.insert({
				owner_id: ownerId,
				person_id: personId,
				person_name,
				person_dni: person_dni || null,
				title,
				status,
				next_action: next_action || null,
				next_action_date: next_action_date || null
			})
			.select('id')
			.single();

		if (error || !caseInsert) {
			console.error('Error creando expediente', error);
			return fail(500, { message: 'No se pudo crear el expediente', person_name, person_dni, title });
		}

		throw redirect(303, `/administrativo/expedientes/${caseInsert.id}`);
	}
};
