import { env } from '$env/dynamic/private';
import { patientMatchesAgendaQuery } from '$lib/server/agenda-search';
import { getOdontoContext } from '$lib/server/odonto-context';
import { ACTIVE_APPOINTMENT_STATUSES } from '$lib/utils/appointment-visibility';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const APPOINTMENT_COLUMNS =
	'id, patient_id, service_id, professional_id, starts_at, ends_at, status, source, service_name_snapshot, professional_name_snapshot, internal_note, patients(full_name, phone_e164)';

// Tope de pacientes coincidentes que pasan al filtro de turnos: evita URLs
// gigantes en el `in(...)` cuando la consulta tiene una sola letra.
const MAX_MATCHED_PATIENTS = 150;
const MAX_RESULTS_PER_GROUP = 60;
const PATIENT_SCAN_LIMIT = 1000;

const empty = () => json({ upcoming: [], past: [] });

export const GET: RequestHandler = async ({ url, locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') return empty();

	const query = String(url.searchParams.get('q') ?? '').trim();
	if (!query) return empty();

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	if (business.role === 'professional') {
		return json({ message: 'No tenés permisos para buscar en la agenda.' }, { status: 403 });
	}

	// El matching por nombre se hace en JS para ignorar acentos (un ilike de
	// Postgres no encuentra "María" al tipear "maria"). Se buscan también
	// pacientes archivados: sus turnos siguen visibles en la agenda diaria.
	const { data: patients, error: patientsError } = await supabase
		.from('patients')
		.select('id, full_name, phone_e164')
		.eq('business_id', business.business.id)
		.order('updated_at', { ascending: false })
		.limit(PATIENT_SCAN_LIMIT);
	if (patientsError) {
		console.error('Error buscando pacientes para la agenda', patientsError);
		return json({ message: 'No se pudo buscar. Probá de nuevo.' }, { status: 500 });
	}

	const matchedIds = (patients ?? [])
		.filter((patient: { full_name: string | null; phone_e164: string | null }) =>
			patientMatchesAgendaQuery(patient, query)
		)
		.slice(0, MAX_MATCHED_PATIENTS)
		.map((patient: { id: string }) => patient.id);
	if (matchedIds.length === 0) return empty();

	const nowIso = new Date().toISOString();
	const baseQuery = () =>
		supabase
			.from('appointments')
			.select(APPOINTMENT_COLUMNS)
			.eq('business_id', business.business.id)
			.in('patient_id', matchedIds);
	const upcomingResult = await baseQuery()
		.in('status', [...ACTIVE_APPOINTMENT_STATUSES])
		.gte('starts_at', nowIso)
		.order('starts_at', { ascending: true })
		.limit(MAX_RESULTS_PER_GROUP);
	const appointmentsError = upcomingResult.error;
	if (appointmentsError) {
		console.error('Error buscando turnos en la agenda', appointmentsError);
		return json({ message: 'No se pudo buscar. Probá de nuevo.' }, { status: 500 });
	}

	return json({ upcoming: upcomingResult.data ?? [], past: [] });
};
