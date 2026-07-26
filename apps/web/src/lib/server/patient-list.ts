import { env } from '$env/dynamic/private';
import { resolveActiveBusiness } from '$lib/server/business';
import { readDemoDb } from '$lib/server/demo-store';
import {
	getPatientDataRevision,
	patientDataCacheScope,
	type PatientDataRevision
} from '$lib/server/patient-data-revision';
import {
	createSupabaseAdminClient,
	createSupabaseServerClient,
	getAuthUserId
} from '$lib/server/supabase';
import { error as kitError, redirect, type Cookies } from '@sveltejs/kit';

type CountsSource = 'rpc' | 'fallback_planned';

export type PatientListData = {
	businessId: string | null;
	patients: any[];
	query: '';
	showArchived: boolean;
	demo: boolean;
	canCreatePatient: boolean;
	totalCount: number;
	activeCount: number;
	archivedCount: number;
	countsSource: CountsSource;
	cacheable: boolean;
	revision: string | null;
	cacheScope: string | null;
	loadedAt: string;
};

type LoadPatientListOptions = {
	locals: App.Locals;
	url: URL;
	fetch: typeof globalThis.fetch;
	cookies: Cookies;
};

type ListWithoutCacheMetadata = Omit<
	PatientListData,
	'businessId' | 'cacheable' | 'revision' | 'cacheScope' | 'loadedAt'
>;

const withCacheMetadata = (
	data: ListWithoutCacheMetadata,
	{
		businessId,
		revision,
		cacheScope
	}: {
		businessId: string;
		revision: PatientDataRevision;
		cacheScope: string;
	}
): PatientListData => ({
	...data,
	businessId,
	cacheable: revision.cacheable,
	revision: revision.revision,
	cacheScope: revision.cacheable ? cacheScope : null,
	loadedAt: new Date().toISOString()
});

export const loadStablePatientListRevision = async ({
	readRevision,
	loadRows,
	cacheScope,
	businessId
}: {
	readRevision: () => Promise<PatientDataRevision>;
	loadRows: () => Promise<ListWithoutCacheMetadata>;
	cacheScope: string;
	businessId: string;
}): Promise<PatientListData> => {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const before = await readRevision();
		const rows = await loadRows();
		if (!before.cacheable) {
			return withCacheMetadata(rows, { businessId, revision: before, cacheScope });
		}

		const after = await readRevision();
		if (after.cacheable && before.revision === after.revision) {
			return withCacheMetadata(rows, { businessId, revision: after, cacheScope });
		}
	}

	throw kitError(
		503,
		'La lista de pacientes cambió mientras se estaba cargando. Esperá un momento y volvé a intentar.'
	);
};

export const loadPatientList = async ({
	locals,
	url,
	fetch,
	cookies
}: LoadPatientListOptions): Promise<PatientListData> => {
	if (!locals.auth) throw redirect(303, '/login');
	const showArchived = url.searchParams.get('estado') === 'archivados';

	if (env.DEMO_MODE === 'true') {
		const demoPatients = readDemoDb().patients;
		const activeCount = demoPatients.filter((patient) => !patient.archived_at).length;
		const archivedCount = demoPatients.filter((patient) => patient.archived_at).length;
		const patients = demoPatients
			.filter((patient) => (showArchived ? patient.archived_at !== null : patient.archived_at === null))
			.sort((a, b) => {
				const aDate = a.updated_at ?? a.last_entry_at ?? a.created_at ?? '';
				const bDate = b.updated_at ?? b.last_entry_at ?? b.created_at ?? '';
				return aDate < bDate ? 1 : -1;
			});
		return {
			businessId: null,
			patients,
			query: '',
			showArchived,
			demo: true,
			canCreatePatient: true,
			totalCount: demoPatients.length,
			activeCount,
			archivedCount,
			countsSource: 'fallback_planned',
			cacheable: false,
			revision: null,
			cacheScope: null,
			loadedAt: new Date().toISOString()
		};
	}

	let supabase;
	try {
		supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	} catch (error) {
		console.error('Error creando cliente Supabase para listar pacientes', error);
		throw kitError(500, 'No se pudo conectar para cargar los pacientes. Intentá de nuevo.');
	}

	const [userId, context] = await Promise.all([
		getAuthUserId(supabase, locals.auth.access_token),
		resolveActiveBusiness({
			supabase,
			accessToken: locals.auth.access_token,
			cookies,
			membershipCache: 'short'
		})
	]);
	if (!userId) throw redirect(303, '/login');
	if (!context) throw kitError(500, 'No se pudo resolver el consultorio activo.');

	const admin = await createSupabaseAdminClient('odonto', fetch);
	const cacheScope = patientDataCacheScope({
		userId,
		businessId: context.business.id,
		role: context.role,
		canCreatePatient: context.access.allowedCapabilities.canCreatePatient
	});
	const readRevision = () => getPatientDataRevision(admin, context.business.id);

	const loadRows = async (): Promise<ListWithoutCacheMetadata> => {
		if (context.role === 'professional') {
			const { data: professionalUser, error: professionalUserError } = await admin
				.from('professional_users')
				.select('professional_id')
				.eq('business_id', context.business.id)
				.eq('user_id', userId)
				.order('created_at', { ascending: true })
				.limit(1)
				.maybeSingle();

			if (professionalUserError) {
				console.error('Error resolviendo profesional para listar pacientes', professionalUserError);
				throw kitError(500, 'No se pudieron cargar los pacientes.');
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
					countsSource: 'fallback_planned'
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
				throw kitError(500, 'No se pudieron cargar los pacientes.');
			}

			const linkArchivedByPatientId = new Map(
				(links ?? []).map((link: any) => [String(link.patient_id), link.archived_at ?? null])
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
					countsSource: 'fallback_planned'
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
				throw kitError(500, 'No se pudieron cargar los pacientes.');
			}

			const decoratedPatients = (linkedPatients ?? []).map((patient: any) => {
				const professionalArchivedAt = linkArchivedByPatientId.get(String(patient.id)) ?? null;
				return {
					...patient,
					archived_at: professionalArchivedAt,
					professional_archived_at: professionalArchivedAt
				};
			});
			const activeCount = decoratedPatients.filter(
				(patient: any) => !patient.professional_archived_at
			).length;
			const archivedCount = decoratedPatients.filter(
				(patient: any) => patient.professional_archived_at
			).length;

			return {
				patients: decoratedPatients.filter((patient: any) =>
					showArchived ? patient.professional_archived_at : !patient.professional_archived_at
				),
				query: '',
				showArchived,
				demo: false,
				canCreatePatient: context.access.allowedCapabilities.canCreatePatient,
				totalCount: decoratedPatients.length,
				activeCount,
				archivedCount,
				countsSource: 'fallback_planned'
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

		const [patientsResult, countsResult] = await Promise.all([
			patientsBuilder,
			supabase.rpc('patients_counts_by_business', { p_business: context.business.id }).maybeSingle()
		]);
		if (patientsResult.error) {
			console.error('Error cargando pacientes', patientsResult.error);
			throw kitError(500, 'No se pudieron cargar los pacientes.');
		}

		const patients = patientsResult.data ?? [];
		let totalCount = patients.length;
		let activeCount = showArchived ? 0 : totalCount;
		let archivedCount = showArchived ? totalCount : 0;
		let countsSource: CountsSource = 'rpc';
		const counts = countsResult.data as
			| { total_count?: number | null; active_count?: number | null; archived_count?: number | null }
			| null;

		if (!countsResult.error && counts) {
			totalCount = Number(counts.total_count ?? totalCount);
			activeCount = Number(counts.active_count ?? activeCount);
			archivedCount = Number(counts.archived_count ?? archivedCount);
		} else {
			countsSource = 'fallback_planned';
			if (countsResult.error) {
				console.error('Error contando pacientes por RPC, se usa fallback planned', countsResult.error);
			}
			const [totalResult, activeResult, archivedResult] = await Promise.all([
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

			if (!totalResult.error && typeof totalResult.count === 'number') {
				totalCount = totalResult.count;
			} else if (totalResult.error) {
				console.error('Error contando pacientes (planned)', totalResult.error);
			}
			if (!activeResult.error && typeof activeResult.count === 'number') {
				activeCount = activeResult.count;
			} else if (activeResult.error) {
				console.error('Error contando pacientes activos (planned)', activeResult.error);
			}
			if (!archivedResult.error && typeof archivedResult.count === 'number') {
				archivedCount = archivedResult.count;
			} else if (archivedResult.error) {
				console.error('Error contando pacientes archivados (planned)', archivedResult.error);
			}
		}

		return {
			patients,
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

	return loadStablePatientListRevision({
		readRevision,
		loadRows,
		cacheScope,
		businessId: context.business.id
	});
};
