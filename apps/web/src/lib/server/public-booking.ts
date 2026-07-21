import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Business } from './business';
import {
	addMinutes,
	calculateAvailabilitySlots,
	getAvailabilitySlots,
	type AvailabilityAppointmentBlockRow,
	type AvailabilityExceptionRow,
	type AvailabilityProfessionalRow,
	type AvailabilityRuleRow,
	type AvailabilityServiceRow,
	type AvailabilitySlot
} from './availability';
import { createManualAppointment } from './appointments';
import {
	getBusinessAccessState,
	type BusinessSubscriptionRow
} from './commercial-access';
import { isLikelyPhoneE164, normalizePhoneE164, normalizePhoneRaw } from './phone';

export type PublicService = {
	id: string;
	name: string;
	description: string | null;
	duration_minutes: number;
	price_label: string | null;
};

export type PublicProfessional = {
	id: string;
	name: string;
	specialty: string | null;
	avatar_url: string | null;
	next_available_at?: string | null;
};

export type PublicBookingBusiness = Pick<
	Business,
	| 'id'
	| 'name'
	| 'slug'
	| 'phone'
	| 'address'
	| 'address_instructions'
	| 'maps_url'
	| 'logo_url'
	| 'timezone'
	| 'public_booking_enabled'
	| 'is_active'
	| 'created_at'
	| 'min_booking_notice_minutes'
	| 'max_booking_days_ahead'
	| 'cancellation_policy'
>;

export type PublicBookingIssue =
	| 'business_not_found'
	| 'booking_disabled'
	| 'commercial_unavailable'
	| 'missing_service_role'
	| 'no_services'
	| 'no_professionals'
	| 'no_availability';

export type PublicBookingState = {
	business: PublicBookingBusiness | null;
	services: PublicService[];
	professionals: PublicProfessional[];
	slots: AvailabilitySlot[];
	days: Array<{ date: string; label: string; count: number }>;
	issue: PublicBookingIssue | null;
};

type PublicAvailabilityService = AvailabilityServiceRow & {
	description: string | null;
	price_label: string | null;
	sort_order: number;
};

type PublicAvailabilityProfessional = AvailabilityProfessionalRow & {
	specialty: string | null;
	avatar_url: string | null;
	sort_order: number;
};

type PublicAvailabilityRows = {
	services: PublicAvailabilityService[];
	professionals: PublicAvailabilityProfessional[];
	assignments: Array<{ service_id: string; professional_id: string }>;
	rules: AvailabilityRuleRow[];
	exceptions: AvailabilityExceptionRow[];
	blocks: AvailabilityAppointmentBlockRow[];
};

type PublicAvailabilitySnapshot = PublicAvailabilityRows & {
	fromDate: string;
	toDate: string;
};

type BookingAttemptInput = {
	businessId?: string | null;
	phoneE164?: string | null;
	ipHash?: string | null;
	action: 'booking_create' | 'token_confirm' | 'token_cancel' | 'token_reschedule';
	success: boolean;
	errorCode?: string | null;
	userAgent?: string | null;
	metadata?: Record<string, unknown> | null;
};

export const PUBLIC_BUSINESS_SELECT =
	'id, name, slug, phone, address, address_instructions, maps_url, logo_url, timezone, public_booking_enabled, is_active, created_at, min_booking_notice_minutes, max_booking_days_ahead, cancellation_policy';

export const PUBLIC_ACTIVE_FUTURE_APPOINTMENT_LIMIT = 4;

const pad = (value: number) => String(value).padStart(2, '0');

export const localDateParts = (date: Date, timeZone: string) => {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
	return `${parts.year}-${parts.month}-${parts.day}`;
};

export const addDaysToDateString = (date: string, days: number) => {
	const value = new Date(`${date}T00:00:00.000Z`);
	value.setUTCDate(value.getUTCDate() + days);
	return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
};

export const todayForBusiness = (business: Pick<Business, 'timezone'>) =>
	localDateParts(new Date(), business.timezone);

export const publicHash = (value?: string | null) => {
	const normalized = String(value ?? '').trim();
	if (!normalized) return null;
	return crypto.createHash('sha256').update(normalized).digest('hex');
};

const hasVisibleProfessionalName = (professional: { name?: unknown } | null | undefined) =>
	String(professional?.name ?? '').trim().length > 0;

export const recordPublicBookingAttempt = async (
	supabase: SupabaseClient,
	input: BookingAttemptInput
) => {
	const { error } = await supabase.from('public_booking_attempts').insert({
		business_id: input.businessId ?? null,
		phone_e164: input.phoneE164 ?? null,
		ip_hash: input.ipHash ?? null,
		action: input.action,
		success: input.success,
		error_code: input.errorCode ?? null,
		user_agent: input.userAgent?.slice(0, 500) ?? null,
		metadata: input.metadata ?? null
	});

	if (error) {
		console.error('Error registrando intento publico', error);
	}
};

const countPublicAttempts = async (
	supabase: SupabaseClient,
	input: {
		businessId?: string | null;
		phoneE164?: string | null;
		ipHash?: string | null;
		action: BookingAttemptInput['action'];
		since: Date;
	}
) => {
	let query = supabase
		.from('public_booking_attempts')
		.select('id', { count: 'exact', head: true })
		.eq('action', input.action)
		.gte('created_at', input.since.toISOString());

	if (input.businessId) query = query.eq('business_id', input.businessId);
	if (input.phoneE164) query = query.eq('phone_e164', input.phoneE164);
	if (input.ipHash) query = query.eq('ip_hash', input.ipHash);

	const { count, error } = await query;
	if (error) throw error;
	return count ?? 0;
};

export const getPublicBusinessBySlug = async (
	supabase: SupabaseClient,
	slug: string
): Promise<PublicBookingBusiness | null> => {
	const isBusinessId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(slug);
	const { data, error } = await supabase
		.from('businesses')
		.select(PUBLIC_BUSINESS_SELECT)
		.eq(isBusinessId ? 'id' : 'slug', slug)
		.maybeSingle();
	if (error) throw error;
	return (data as PublicBookingBusiness | null) ?? null;
};

export const canUsePublicBusiness = async (
	supabase: SupabaseClient,
	businessId: string,
	businessCreatedAt?: string | null
) => {
	const { data, error } = await supabase
		.from('business_subscriptions')
		.select(
			'id, business_id, commercial_access_enabled, is_permanent, subscription_status, paid_until, grace_until, restricted_until, archived_at, expiration_notice_enabled'
		)
		.eq('business_id', businessId)
		.maybeSingle();

	if (error) {
		// Compatibility-first fallback: if the migration is not applied yet, do
		// not break existing public booking links.
		console.error('Error cargando acceso comercial público', error);
		return true;
	}

	return getBusinessAccessState((data as BusinessSubscriptionRow | null) ?? null, {
		businessCreatedAt
	}).allowedCapabilities.canUsePublicBooking;
};

const getPublicBusinessSubscription = async (
	supabase: SupabaseClient,
	businessId: string
): Promise<{ subscription: BusinessSubscriptionRow | null; lookupFailed: boolean }> => {
	const { data, error } = await supabase
		.from('business_subscriptions')
		.select(
			'id, business_id, commercial_access_enabled, is_permanent, subscription_status, paid_until, grace_until, restricted_until, archived_at, expiration_notice_enabled'
		)
		.eq('business_id', businessId)
		.maybeSingle();
	if (error) {
		// Mismo fallback de compatibilidad que canUsePublicBusiness: una migración
		// comercial pendiente no debe romper links que ya funcionaban.
		console.error('Error cargando acceso comercial público', error);
		return { subscription: null, lookupFailed: true };
	}
	return {
		subscription: (data as BusinessSubscriptionRow | null) ?? null,
		lookupFailed: false
	};
};

export const getReservableServices = async (
	supabase: SupabaseClient,
	businessId: string
): Promise<PublicService[]> => {
	const [{ data: services, error: servicesError }, { data: professionals, error: professionalsError }, { data: assignments, error: assignmentsError }] =
		await Promise.all([
			supabase
				.from('services')
				.select('id, name, description, duration_minutes, price_label, is_active, is_public, sort_order')
				.eq('business_id', businessId)
				.eq('is_active', true)
				.eq('is_public', true)
				.order('sort_order')
				.order('name'),
			supabase
				.from('professionals')
				.select('id, name, is_active, is_public')
				.eq('business_id', businessId)
				.eq('is_active', true)
				.eq('is_public', true),
			supabase.from('professional_services').select('service_id, professional_id').eq('business_id', businessId)
		]);
	if (servicesError) throw servicesError;
	if (professionalsError) throw professionalsError;
	if (assignmentsError) throw assignmentsError;

	const publicProfessionalIds = new Set(
		(professionals ?? [])
			.filter((professional: any) => hasVisibleProfessionalName(professional))
			.map((professional: any) => String(professional.id))
	);
	const reservableServiceIds = new Set(
		(assignments ?? [])
			.filter((assignment: any) => publicProfessionalIds.has(String(assignment.professional_id)))
			.map((assignment: any) => String(assignment.service_id))
	);

	return (services ?? [])
		.filter((service: any) => reservableServiceIds.has(String(service.id)))
		.map((service: any) => ({
			id: String(service.id),
			name: String(service.name),
			description: service.description ?? null,
			duration_minutes: Number(service.duration_minutes),
			price_label: service.price_label ?? null
		}));
};

export const getReservableProfessionals = async (
	supabase: SupabaseClient,
	input: { businessId: string; serviceId: string }
): Promise<PublicProfessional[]> => {
	const { data, error } = await supabase
		.from('professional_services')
		.select('professional_id, professionals!inner(id, name, specialty, avatar_url, is_active, is_public, sort_order)')
		.eq('business_id', input.businessId)
		.eq('service_id', input.serviceId);
	if (error) throw error;

	return (data ?? [])
		.map((row: any) => row.professionals)
		.filter((professional: any) => professional?.is_active && professional?.is_public && hasVisibleProfessionalName(professional))
		.sort((a: any, b: any) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name)))
		.map((professional: any) => ({
			id: String(professional.id),
			name: String(professional.name).trim(),
			specialty: professional.specialty ?? null,
			avatar_url: professional.avatar_url ?? null
		}));
};

export const summarizeSlotsByDate = (
	slots: AvailabilitySlot[],
	timeZone: string
): Array<{ date: string; label: string; count: number }> => {
	const counts = new Map<string, number>();
	for (const slot of slots) counts.set(slot.date, (counts.get(slot.date) ?? 0) + 1);
	const formatter = new Intl.DateTimeFormat('es-AR', {
		timeZone,
		weekday: 'long',
		day: 'numeric',
		month: 'long'
	});
	return [...counts.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, count]) => ({
			date,
			count,
			label: formatter
				.format(new Date(`${date}T12:00:00.000Z`))
				.replace(',', '')
				.replace(/^./, (letter) => letter.toUpperCase())
		}));
};

// El rango público ya está acotado a 90 días. Consultarlo completo en una sola
// tanda evita hasta seis rondas consecutivas a Supabase cuando un profesional
// tiene pocos horarios, sin aumentar la cantidad de turnos finalmente enviados
// al navegador.
const uniqueSlots = (slots: AvailabilitySlot[]) => {
	const seen = new Set<string>();
	const result: AvailabilitySlot[] = [];
	for (const slot of slots) {
		const key = `${slot.professional_id}:${slot.starts_at}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(slot);
	}
	return result;
};

// ---------------------------------------------------------------------------
// Caché en memoria de los escaneos de disponibilidad pública.
//
// El flujo de reserva navega 4-5 veces la misma URL (servicio → profesional →
// día → horario) y cada navegación recomputaba TODOS los escaneos (varios
// round-trips a Supabase). El caché por instancia con TTL corto convierte esos
// pasos en una sola computación.
//
// Staleness acotada y tolerada por diseño: la creación de la reserva SIEMPRE
// revalida el slot contra disponibilidad viva (PUBLIC_SLOT_UNAVAILABLE si otro
// lo tomó), igual que ya pasa entre que el paciente ve el horario y confirma.
// ---------------------------------------------------------------------------

const SLOT_SCAN_CACHE_TTL_MS = 25_000;
const STRUCTURE_SCAN_CACHE_TTL_MS = 60_000;
const SCAN_CACHE_MAX_ENTRIES = 500;

type ScanCacheEntry = {
	value?: unknown;
	promise?: Promise<unknown>;
	expiresAt: number;
};
const scanCache = new Map<string, ScanCacheEntry>();

export const clearPublicBookingScanCache = () => scanCache.clear();

// Tras crear una reserva, los escaneos cacheados del negocio quedan viejos
// (el slot tomado seguiría visible hasta vencer el TTL en esta instancia).
export const invalidatePublicBookingScans = (businessId: string) => {
	for (const key of scanCache.keys()) {
		if (key.includes(`:${businessId}:`) || key.endsWith(`:${businessId}`)) {
			scanCache.delete(key);
		}
	}
};

const cachedScan = async <T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> => {
	const now = Date.now();
	const hit = scanCache.get(key);
	if (hit?.promise) return (await hit.promise) as T;
	if (hit && hit.expiresAt > now && 'value' in hit) return hit.value as T;
	if (scanCache.size >= SCAN_CACHE_MAX_ENTRIES) {
		for (const [entryKey, entry] of scanCache) {
			if (entry.expiresAt <= now) scanCache.delete(entryKey);
		}
		if (scanCache.size >= SCAN_CACHE_MAX_ENTRIES) scanCache.clear();
	}
	const promise = compute();
	scanCache.set(key, { promise, expiresAt: Number.POSITIVE_INFINITY });
	try {
		const value = await promise;
		if (scanCache.get(key)?.promise === promise) {
			scanCache.set(key, { value, expiresAt: Date.now() + ttlMs });
		}
		return value;
	} catch (error) {
		if (scanCache.get(key)?.promise === promise) scanCache.delete(key);
		throw error;
	}
};

const loadPublicAvailabilitySnapshot = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		rangeStart: Date;
		rangeEnd: Date;
	}
): Promise<PublicAvailabilityRows> => {
	// Estas lecturas son independientes. Consultar todas las filas acotadas
	// al negocio en una sola ola evita esperar catálogo → asignaciones → agenda.
	// Los turnos se parten en ventanas mensuales para no truncarse en el límite de
	// 1.000 filas de PostgREST en consultorios de alto volumen.
	const appointmentWindows: Array<{ start: Date; end: Date }> = [];
	for (
		let start = new Date(input.rangeStart);
		start < input.rangeEnd;
		start = addMinutes(start, 31 * 24 * 60)
	) {
		appointmentWindows.push({
			start,
			end: new Date(
				Math.min(addMinutes(start, 31 * 24 * 60).getTime(), input.rangeEnd.getTime())
			)
		});
	}
	const [
		servicesResult,
		professionalsResult,
		assignmentsResult,
		rulesResult,
		exceptionsResult,
		blocksResults
	] = await Promise.all([
		supabase
			.from('services')
			.select(
				'id, business_id, name, description, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_label, is_public, is_active, sort_order'
			)
			.eq('business_id', input.businessId)
			.eq('is_active', true)
			.eq('is_public', true)
			.order('sort_order')
			.order('name'),
		supabase
			.from('professionals')
			.select('id, name, specialty, avatar_url, is_public, is_active, sort_order')
			.eq('business_id', input.businessId)
			.eq('is_active', true)
			.eq('is_public', true)
			.order('sort_order')
			.order('name'),
		supabase
			.from('professional_services')
			.select('service_id, professional_id')
			.eq('business_id', input.businessId),
		supabase
			.from('availability_rules')
			.select('id, professional_id, weekday, start_time, end_time, slot_interval_minutes, is_active')
			.eq('business_id', input.businessId)
			.eq('is_active', true),
		supabase
			.from('availability_exceptions')
			.select('id, professional_id, starts_at, ends_at, type')
			.eq('business_id', input.businessId)
			.lt('starts_at', input.rangeEnd.toISOString())
			.gt('ends_at', input.rangeStart.toISOString()),
		Promise.all(
			appointmentWindows.map(({ start, end }) =>
				supabase
					.from('appointments')
					.select('id, professional_id, blocking_starts_at, blocking_ends_at')
					.eq('business_id', input.businessId)
					.in('status', ['reserved', 'confirmed', 'reschedule_requested'])
					.lt('blocking_starts_at', end.toISOString())
					.gt('blocking_ends_at', start.toISOString())
			)
		)
	]);
	if (servicesResult.error) throw servicesResult.error;
	if (professionalsResult.error) throw professionalsResult.error;
	if (assignmentsResult.error) throw assignmentsResult.error;
	if (rulesResult.error) throw rulesResult.error;
	if (exceptionsResult.error) throw exceptionsResult.error;
	for (const blocksResult of blocksResults) {
		if (blocksResult.error) throw blocksResult.error;
	}

	const services = (servicesResult.data ?? []) as PublicAvailabilityService[];
	const professionals = ((professionalsResult.data ?? []) as PublicAvailabilityProfessional[]).filter(
		hasVisibleProfessionalName
	);
	const serviceIds = new Set(services.map((service) => service.id));
	const professionalIds = new Set(professionals.map((professional) => professional.id));
	const assignments = ((assignmentsResult.data ?? []) as Array<{
		service_id: string;
		professional_id: string;
	}>).filter(
		(assignment) =>
			serviceIds.has(assignment.service_id) && professionalIds.has(assignment.professional_id)
	);

	const assignedProfessionalIds = new Set(
		assignments.map((assignment) => assignment.professional_id)
	);

	return {
		services,
		professionals,
		assignments,
		rules: ((rulesResult.data ?? []) as AvailabilityRuleRow[]).filter((rule) =>
			assignedProfessionalIds.has(rule.professional_id)
		),
		exceptions: ((exceptionsResult.data ?? []) as AvailabilityExceptionRow[]).filter(
			(exception) =>
				exception.professional_id === null ||
				assignedProfessionalIds.has(exception.professional_id)
		),
		blocks: [
			...new Map(
				blocksResults
					.flatMap((result) => (result.data ?? []) as AvailabilityAppointmentBlockRow[])
					.filter((block) => assignedProfessionalIds.has(block.professional_id))
					.map((block) => [block.id, block] as const)
			).values()
		]
	};
};

const slotsFromPublicSnapshot = (
	business: PublicBookingBusiness,
	snapshot: PublicAvailabilitySnapshot,
	input: { serviceId: string; professionalId?: string | null; maxSlots?: number }
) => {
	const service = snapshot.services.find((candidate) => candidate.id === input.serviceId);
	if (!service) return [];
	const assignedProfessionalIds = new Set(
		snapshot.assignments
			.filter((assignment) => assignment.service_id === input.serviceId)
			.map((assignment) => assignment.professional_id)
	);
	const professionals = snapshot.professionals.filter(
		(professional) =>
			assignedProfessionalIds.has(professional.id) &&
			(!input.professionalId || professional.id === input.professionalId)
	);
	const professionalIds = new Set(professionals.map((professional) => professional.id));
	return calculateAvailabilitySlots({
		business: business as Business,
		service,
		professionals,
		rules: snapshot.rules.filter((rule) => professionalIds.has(rule.professional_id)),
		exceptions: snapshot.exceptions.filter(
			(exception) =>
				exception.professional_id === null || professionalIds.has(exception.professional_id)
		),
		blocks: snapshot.blocks.filter((block) => professionalIds.has(block.professional_id)),
		fromDate: snapshot.fromDate,
		toDate: snapshot.toDate,
		publicOnly: true,
		maxSlots: input.maxSlots
	});
};

export const getPublicBookingCdnCacheControl = (input: {
	serviceId?: string | null;
	professionalId?: string | null;
	date?: string | null;
}) => {
	if (input.date) return 'public, durable, s-maxage=5, stale-while-revalidate=10';
	if (input.professionalId) return 'public, durable, s-maxage=10, stale-while-revalidate=30';
	if (input.serviceId) return 'public, durable, s-maxage=10, stale-while-revalidate=30';
	return 'public, durable, s-maxage=60, stale-while-revalidate=300';
};

export const loadPublicBookingState = async (
	supabase: SupabaseClient,
	input: {
		slug: string;
		serviceId?: string | null;
		professionalId?: string | null;
		date?: string | null;
	}
): Promise<PublicBookingState> => {
	const normalizedSlug = input.slug.trim().toLowerCase();
	const businessIdFromSlug = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
		normalizedSlug
	)
		? normalizedSlug
		: null;
	const loadBusiness = () =>
		cachedScan(`business-lookup:${normalizedSlug}`, STRUCTURE_SCAN_CACHE_TTL_MS, () =>
			getPublicBusinessBySlug(supabase, input.slug)
		);
	const loadAccess = (businessId: string) =>
		cachedScan(`commercial-access-row:${businessId}`, STRUCTURE_SCAN_CACHE_TTL_MS, () =>
			getPublicBusinessSubscription(supabase, businessId)
		);
	const availabilityRangeNow = new Date();
	const loadAvailabilityRows = (businessId: string) =>
		cachedScan(`availability-rows:${businessId}`, SLOT_SCAN_CACHE_TTL_MS, () =>
			loadPublicAvailabilitySnapshot(supabase, {
				businessId,
				rangeStart: addMinutes(availabilityRangeNow, -24 * 60),
				rangeEnd: addMinutes(availabilityRangeNow, 92 * 24 * 60)
			})
		);

	let business: PublicBookingBusiness | null;
	let accessLookup: Awaited<ReturnType<typeof getPublicBusinessSubscription>> | null = null;
	let availabilityRows: PublicAvailabilityRows | null = null;
	if (businessIdFromSlug) {
		// Los links generados por Cita Suite usan el UUID. En ese camino todas las
		// lecturas arrancan juntas y la visita fría espera una sola ola de red.
		[business, accessLookup, availabilityRows] = await Promise.all([
			loadBusiness(),
			loadAccess(businessIdFromSlug),
			loadAvailabilityRows(businessIdFromSlug)
		]);
	} else {
		business = await loadBusiness();
		if (business) {
			[accessLookup, availabilityRows] = await Promise.all([
				loadAccess(business.id),
				loadAvailabilityRows(business.id)
			]);
		}
	}
	if (!business) {
		return { business: null, services: [], professionals: [], slots: [], days: [], issue: 'business_not_found' };
	}
	if (!business.is_active || !business.public_booking_enabled) {
		return { business, services: [], professionals: [], slots: [], days: [], issue: 'booking_disabled' };
	}

	const today = todayForBusiness(business);
	const maxDate = addDaysToDateString(
		today,
		Math.min(Math.max(business.max_booking_days_ahead, 1), 90)
	);
	const commerciallyUsable = Boolean(
		accessLookup?.lookupFailed ||
			getBusinessAccessState(accessLookup?.subscription ?? null, {
				businessCreatedAt: business.created_at
			}).allowedCapabilities.canUsePublicBooking
	);
	if (!commerciallyUsable) {
		return { business, services: [], professionals: [], slots: [], days: [], issue: 'commercial_unavailable' };
	}
	if (!availabilityRows) throw new Error('PUBLIC_AVAILABILITY_ROWS_MISSING');
	// La misma foto alimenta todos los pasos y el cálculo conserva exactamente
	// los filtros actuales de servicios/profesionales sin horarios.
	const availabilitySnapshot: PublicAvailabilitySnapshot = {
		...availabilityRows,
		fromDate: today,
		toDate: maxDate
	};

	const structurallyReservableServices = availabilitySnapshot.services.filter((service) =>
		availabilitySnapshot.assignments.some((assignment) => assignment.service_id === service.id)
	);
	if (structurallyReservableServices.length === 0) {
		return { business, services: [], professionals: [], slots: [], days: [], issue: 'no_services' };
	}

	const toPublicService = (service: PublicAvailabilityService): PublicService => ({
		id: service.id,
		name: service.name,
		description: service.description,
		duration_minutes: service.duration_minutes,
		price_label: service.price_label
	});
	const services = input.serviceId
		? structurallyReservableServices.map(toPublicService)
		: (
				await Promise.all(
					structurallyReservableServices.map(async (service) => {
						const hasAvailability = await cachedScan(
							`service-availability:${business.id}:${service.id}:${today}:${maxDate}`,
							SLOT_SCAN_CACHE_TTL_MS,
							async () =>
								slotsFromPublicSnapshot(business, availabilitySnapshot, {
									serviceId: service.id,
									maxSlots: 1
								}).length > 0
						);
						return hasAvailability ? toPublicService(service) : null;
					})
				)
			).filter((service): service is PublicService => service !== null);
	if (services.length === 0) {
		return { business, services, professionals: [], slots: [], days: [], issue: 'no_availability' };
	}

	const selectedService = services.find((service) => service.id === input.serviceId) ?? null;
	const assignedProfessionals = selectedService
		? availabilitySnapshot.professionals.filter((professional) =>
				availabilitySnapshot.assignments.some(
					(assignment) =>
						assignment.service_id === selectedService.id &&
						assignment.professional_id === professional.id
				)
			)
		: [];
	const professionals = selectedService
		? (
				await Promise.all(
					assignedProfessionals.map(async (professional) => {
						const firstSlot = await cachedScan(
							`professional-first:${business.id}:${selectedService.id}:${professional.id}:${today}:${maxDate}`,
							SLOT_SCAN_CACHE_TTL_MS,
							async () =>
								slotsFromPublicSnapshot(business, availabilitySnapshot, {
									serviceId: selectedService.id,
									professionalId: professional.id,
									maxSlots: 1
								})[0] ?? null
						);
						return firstSlot
							? {
									id: professional.id,
									name: professional.name.trim(),
									specialty: professional.specialty,
									avatar_url: professional.avatar_url,
									next_available_at: firstSlot.starts_at
								}
							: null;
					})
				)
			).filter((professional): professional is PublicProfessional => professional !== null)
		: [];
	if (selectedService && professionals.length === 0) {
		return { business, services, professionals, slots: [], days: [], issue: 'no_professionals' };
	}

	const selectedProfessional = professionals.find((professional) => professional.id === input.professionalId) ?? null;
	if (!selectedService || !selectedProfessional) {
		return { business, services, professionals, slots: [], days: [], issue: null };
	}

	const daySlots = await cachedScan(
		`day-scan:${business.id}:${selectedService.id}:${selectedProfessional.id}:${today}:${maxDate}`,
		SLOT_SCAN_CACHE_TTL_MS,
		async () =>
			uniqueSlots(
				slotsFromPublicSnapshot(business, availabilitySnapshot, {
					serviceId: selectedService.id,
					professionalId: selectedProfessional.id
				})
			)
	);
	const dateWithinScan = input.date ? input.date >= today && input.date <= maxDate : false;
	const selectedDateSlots = !input.date
		? []
		: dateWithinScan
			? daySlots.filter((slot) => slot.date === input.date)
			: await getAvailabilitySlots(supabase, {
					business: business as Business,
					serviceId: selectedService.id,
					professionalId: selectedProfessional.id,
					fromDate: input.date,
					toDate: input.date,
					publicOnly: true
				});
	const slots = input.date ? selectedDateSlots : [];
	const days = summarizeSlotsByDate(uniqueSlots([...daySlots, ...selectedDateSlots]), business.timezone);

	return {
		business,
		services,
		professionals,
		slots,
		days,
		issue: selectedService && selectedProfessional && days.length === 0 ? 'no_availability' : null
	};
};

export const verifyTurnstileIfConfigured = async (input: {
	secret?: string | null;
	token?: string | null;
	remoteIp?: string | null;
	fetchImpl?: typeof fetch;
}) => {
	const secret = input.secret?.trim();
	if (!secret) return;
	const token = input.token?.trim();
	if (!token) throw new Error('PUBLIC_CAPTCHA_REQUIRED');

	const body = new URLSearchParams();
	body.set('secret', secret);
	body.set('response', token);
	if (input.remoteIp) body.set('remoteip', input.remoteIp);

	const response = await (input.fetchImpl ?? fetch)('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
		method: 'POST',
		body
	});
	const payload = (await response.json().catch(() => null)) as { success?: boolean } | null;
	if (!response.ok || !payload?.success) throw new Error('PUBLIC_CAPTCHA_FAILED');
};

const assertPublicBookingRateLimits = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		phoneE164: string;
		ipHash: string | null;
		now?: Date;
	}
) => {
	const now = input.now ?? new Date();
	const ipAttempts = input.ipHash
		? await countPublicAttempts(supabase, {
				action: 'booking_create',
				ipHash: input.ipHash,
				since: addMinutes(now, -10)
			})
		: 0;
	if (ipAttempts >= 3) throw new Error('PUBLIC_RATE_LIMIT_IP');

	const phoneAttempts = await countPublicAttempts(supabase, {
		action: 'booking_create',
		businessId: input.businessId,
		phoneE164: input.phoneE164,
		since: addMinutes(now, -30)
	});
	if (phoneAttempts >= 5) throw new Error('PUBLIC_RATE_LIMIT_PHONE');
};

export const assertPublicBookingPatientPolicy = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		patientName: string;
		phoneE164: string;
		now?: Date;
	}
) => {
	const now = input.now ?? new Date();
	const { data: patient, error: patientError } = await supabase
		.from('patients')
		.select('id, blocked')
		.eq('business_id', input.businessId)
		.eq('phone_e164', input.phoneE164)
		.maybeSingle();
	if (patientError) throw patientError;
	if (patient?.blocked) throw new Error('PUBLIC_BOOKING_BLOCKED_PATIENT');

	// El teléfono sólo identifica una ficha explícitamente bloqueada. El cupo
	// se calcula por nombre normalizado en PostgreSQL, sumando todas las fichas
	// con ese nombre aunque tengan números distintos.
	const { data: count, error } = await supabase.rpc(
		'get_public_booking_active_future_count_by_name',
		{
			p_business_id: input.businessId,
			p_patient_name: input.patientName,
			p_now: now.toISOString()
		}
	);
	if (error) throw error;
	if (Number(count ?? 0) >= PUBLIC_ACTIVE_FUTURE_APPOINTMENT_LIMIT) {
		throw new Error('PUBLIC_BOOKING_ACTIVE_LIMIT');
	}
};

export const createPublicBooking = async (
	supabase: SupabaseClient,
	input: {
		slug: string;
		serviceId: string;
		professionalId: string;
		slotStartsAt: string;
		patientName: string;
		patientPhone: string;
		patientEmail?: string | null;
		note?: string | null;
		ipHash?: string | null;
		userAgent?: string | null;
		now?: Date;
	}
) => {
	const now = input.now ?? new Date();
	const business = await getPublicBusinessBySlug(supabase, input.slug);
	let phoneE164: string | null = null;

	try {
		if (!business || !business.is_active || !business.public_booking_enabled) {
			throw new Error('PUBLIC_BOOKING_UNAVAILABLE');
		}
		if (!(await canUsePublicBusiness(supabase, business.id, business.created_at))) {
			throw new Error('PUBLIC_BUSINESS_COMMERCIAL_UNAVAILABLE');
		}

		const patientName = input.patientName.trim();
		const phoneRaw = normalizePhoneRaw(input.patientPhone);
		phoneE164 = normalizePhoneE164(input.patientPhone);
		const email = String(input.patientEmail ?? '').trim();
		if (patientName.length < 3) throw new Error('PUBLIC_PATIENT_NAME_INVALID');
		if (!phoneE164 || !isLikelyPhoneE164(phoneE164)) throw new Error('PUBLIC_PATIENT_PHONE_INVALID');

		// La capacidad del paciente se evalúa antes que los límites temporales de
		// intentos para no ocultar un 4/4 real detrás de un mensaje de rate limit.
		await assertPublicBookingPatientPolicy(supabase, {
			businessId: business.id,
			patientName,
			phoneE164,
			now
		});
		await assertPublicBookingRateLimits(supabase, {
			businessId: business.id,
			phoneE164,
			ipHash: input.ipHash ?? null,
			now
		});

		const slotDate = localDateParts(new Date(input.slotStartsAt), business.timezone);
		const slots = await getAvailabilitySlots(supabase, {
			business: business as Business,
			serviceId: input.serviceId,
			professionalId: input.professionalId,
			fromDate: slotDate,
			toDate: slotDate,
			publicOnly: true
		});
		const selectedSlot = slots.find(
			(slot) => slot.starts_at === input.slotStartsAt && slot.professional_id === input.professionalId
		);
		if (!selectedSlot) throw new Error('PUBLIC_SLOT_UNAVAILABLE');

		const created = await createManualAppointment(supabase, {
			businessId: business.id,
			ownerId: null,
			createdByUserId: null,
			patientName,
			patientPhone: phoneRaw,
			patientEmail: email || null,
			serviceId: input.serviceId,
			professionalId: input.professionalId,
			startsAt: new Date(selectedSlot.starts_at),
			internalNote: input.note?.trim() || null,
			source: 'public_booking'
		});
		invalidatePublicBookingScans(business.id);

		await recordPublicBookingAttempt(supabase, {
			businessId: business.id,
			phoneE164,
			ipHash: input.ipHash ?? null,
			action: 'booking_create',
			success: true,
			userAgent: input.userAgent,
			metadata: {
				appointment_id: created?.id ?? null,
				service_id: input.serviceId,
				professional_id: input.professionalId,
				starts_at: selectedSlot.starts_at
			}
		});

		return { business, appointment: created };
	} catch (error) {
		await recordPublicBookingAttempt(supabase, {
			businessId: business?.id ?? null,
			phoneE164,
			ipHash: input.ipHash ?? null,
			action: 'booking_create',
			success: false,
			errorCode: getPublicBookingErrorCode(error),
			userAgent: input.userAgent,
			metadata: {
				slug: input.slug,
				service_id: input.serviceId,
				professional_id: input.professionalId,
				slot_starts_at: input.slotStartsAt
			}
		});
		throw error;
	}
};

export const PUBLIC_BOOKING_ERROR_MESSAGES = {
	PUBLIC_BOOKING_UNAVAILABLE:
		'El consultorio desactivó las reservas online. Podés contactarlo para pedir el turno por otro medio.',
	PUBLIC_BUSINESS_COMMERCIAL_UNAVAILABLE:
		'El sistema de reservas online del consultorio está temporalmente suspendido. Mientras lo reactivan, pedí el turno por contacto directo.',
	PUBLIC_PATIENT_NAME_INVALID: 'Ingresá tu nombre (al menos 3 caracteres).',
	PUBLIC_PATIENT_PHONE_INVALID:
		'El teléfono no tiene un formato válido. Revisalo e incluí el código de área.',
	PUBLIC_SLOT_UNAVAILABLE:
		'Ese horario acaba de ser ocupado. Elegí otro de los horarios disponibles.',
	PUBLIC_RATE_LIMIT_IP:
		'Se alcanzó el máximo de 3 intentos desde esta conexión en 10 minutos. Esperá unos minutos antes de volver a probar.',
	PUBLIC_RATE_LIMIT_PHONE:
		'Se alcanzó el máximo de 5 intentos para este teléfono en 30 minutos. Esperá unos minutos antes de volver a probar.',
	PUBLIC_BOOKING_ACTIVE_LIMIT:
		'Este nombre ya alcanzó el máximo permitido: 4 turnos activos a futuro. Podés reservar otro cuando uno pase o sea cancelado.',
	PUBLIC_BOOKING_BLOCKED_PATIENT:
		'Las reservas online están deshabilitadas para esta ficha de paciente. Comunicate con el consultorio para que puedan ayudarte.',
	PUBLIC_CAPTCHA_REQUIRED: 'Completá la verificación anti-spam para reservar el turno.',
	PUBLIC_CAPTCHA_FAILED:
		'La verificación anti-spam no pudo validarse. Volvé a completarla e intentá nuevamente.',
	PATIENT_NAME_ALREADY_EXISTS:
		'Encontramos otra ficha con exactamente el mismo nombre. El nombre no debería bloquear una reserva; avisale al consultorio para que pueda corregir esta validación.',
	PATIENT_DNI_ALREADY_EXISTS:
		'La ficha coincide con un DNI ya registrado. Para evitar mezclar personas, el consultorio debe revisar esa ficha antes de continuar.',
	PATIENT_OWNER_REQUIRED:
		'El consultorio todavía no configuró quién administra los pacientes. Avisales para que puedan corregirlo y darte el turno.',
	SERVICE_NOT_FOUND:
		'El servicio que elegiste dejó de estar disponible. Volvé al primer paso y elegí otro.',
	PROFESSIONAL_NOT_FOUND:
		'El profesional que elegiste dejó de estar disponible. Volvé al paso de profesionales y elegí otro.',
	PROFESSIONAL_SERVICE_NOT_ASSIGNED:
		'Ese profesional ya no atiende el servicio elegido. Elegí otro profesional o servicio.',
	PUBLIC_BOOKING_UNEXPECTED:
		'No pudimos confirmar si el turno quedó guardado por un problema interno. Antes de reintentar, comunicate con el consultorio para evitar una reserva duplicada.'
} as const;

export type PublicBookingErrorCode = keyof typeof PUBLIC_BOOKING_ERROR_MESSAGES;

const publicBookingErrorTokenMap: ReadonlyArray<readonly [string, PublicBookingErrorCode]> = [
	['PUBLIC_BOOKING_UNAVAILABLE', 'PUBLIC_BOOKING_UNAVAILABLE'],
	['PUBLIC_BUSINESS_COMMERCIAL_UNAVAILABLE', 'PUBLIC_BUSINESS_COMMERCIAL_UNAVAILABLE'],
	['BUSINESS_ACCESS_RESTRICTED', 'PUBLIC_BUSINESS_COMMERCIAL_UNAVAILABLE'],
	['PUBLIC_PATIENT_NAME_INVALID', 'PUBLIC_PATIENT_NAME_INVALID'],
	['PATIENT_NAME_REQUIRED', 'PUBLIC_PATIENT_NAME_INVALID'],
	['PUBLIC_PATIENT_PHONE_INVALID', 'PUBLIC_PATIENT_PHONE_INVALID'],
	['PUBLIC_SLOT_UNAVAILABLE', 'PUBLIC_SLOT_UNAVAILABLE'],
	['PUBLIC_RATE_LIMIT_IP', 'PUBLIC_RATE_LIMIT_IP'],
	['PUBLIC_RATE_LIMIT_PHONE', 'PUBLIC_RATE_LIMIT_PHONE'],
	['PUBLIC_BOOKING_ACTIVE_LIMIT', 'PUBLIC_BOOKING_ACTIVE_LIMIT'],
	['PUBLIC_BOOKING_BLOCKED_PATIENT', 'PUBLIC_BOOKING_BLOCKED_PATIENT'],
	['PATIENT_BLOCKED', 'PUBLIC_BOOKING_BLOCKED_PATIENT'],
	['PUBLIC_CAPTCHA_REQUIRED', 'PUBLIC_CAPTCHA_REQUIRED'],
	['PUBLIC_CAPTCHA_FAILED', 'PUBLIC_CAPTCHA_FAILED'],
	['PATIENT_NAME_ALREADY_EXISTS', 'PATIENT_NAME_ALREADY_EXISTS'],
	['PATIENT_DNI_ALREADY_EXISTS', 'PATIENT_DNI_ALREADY_EXISTS'],
	['PATIENT_OWNER_REQUIRED', 'PATIENT_OWNER_REQUIRED'],
	['SERVICE_NOT_FOUND', 'SERVICE_NOT_FOUND'],
	['PROFESSIONAL_NOT_FOUND', 'PROFESSIONAL_NOT_FOUND'],
	['PROFESSIONAL_SERVICE_NOT_ASSIGNED', 'PROFESSIONAL_SERVICE_NOT_ASSIGNED']
];

const hasTechnicalErrorToken = (raw: string, token: string) =>
	new RegExp(`(^|[^A-Z0-9_])${token}([^A-Z0-9_]|$)`).test(raw);

export function getPublicBookingErrorCode(error: unknown): PublicBookingErrorCode {
	const value = error as { message?: string; code?: string; details?: string; hint?: string };
	const raw = [value?.message, value?.code, value?.details, value?.hint].filter(Boolean).join(' ');
	if (value?.code === '23P01' || raw.includes('appointments_no_overlapping_active')) {
		return 'PUBLIC_SLOT_UNAVAILABLE';
	}
	for (const [token, code] of publicBookingErrorTokenMap) {
		if (hasTechnicalErrorToken(raw, token)) return code;
	}
	return 'PUBLIC_BOOKING_UNEXPECTED';
}

export const getPublicBookingErrorMessage = (error: unknown) =>
	PUBLIC_BOOKING_ERROR_MESSAGES[getPublicBookingErrorCode(error)];
