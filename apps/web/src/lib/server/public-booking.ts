import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Business } from './business';
import { getAvailabilitySlots, type AvailabilitySlot, addMinutes } from './availability';
import { createManualAppointment, getHumanAppointmentErrorMessage } from './appointments';
import {
	getBusinessAccessState,
	publicBusinessUnavailableMessage,
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
				.select('id, is_active, is_public')
				.eq('business_id', businessId)
				.eq('is_active', true)
				.eq('is_public', true),
			supabase.from('professional_services').select('service_id, professional_id').eq('business_id', businessId)
		]);
	if (servicesError) throw servicesError;
	if (professionalsError) throw professionalsError;
	if (assignmentsError) throw assignmentsError;

	const publicProfessionalIds = new Set((professionals ?? []).map((professional: any) => String(professional.id)));
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
		.filter((professional: any) => professional?.is_active && professional?.is_public)
		.sort((a: any, b: any) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name)))
		.map((professional: any) => ({
			id: String(professional.id),
			name: String(professional.name),
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

const PUBLIC_DAY_BATCH_DAYS = 14;
const PUBLIC_DAY_TARGET = 12;

const dateLTE = (a: string, b: string) => a <= b;
const minDateString = (a: string, b: string) => (a <= b ? a : b);

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
// round-trips a Supabase por lote de 14 días). El caché por instancia con TTL
// corto convierte esos pasos en una sola computación.
//
// Staleness acotada y tolerada por diseño: la creación de la reserva SIEMPRE
// revalida el slot contra disponibilidad viva (PUBLIC_SLOT_UNAVAILABLE si otro
// lo tomó), igual que ya pasa entre que el paciente ve el horario y confirma.
// ---------------------------------------------------------------------------

const SLOT_SCAN_CACHE_TTL_MS = 25_000;
const STRUCTURE_SCAN_CACHE_TTL_MS = 60_000;
const SCAN_CACHE_MAX_ENTRIES = 500;

type ScanCacheEntry = { value: unknown; expiresAt: number };
const scanCache = new Map<string, ScanCacheEntry>();

export const clearPublicBookingScanCache = () => scanCache.clear();

// Tras crear una reserva, los escaneos cacheados del negocio quedan viejos
// (el slot tomado seguiría visible hasta vencer el TTL en esta instancia).
export const invalidatePublicBookingScans = (businessId: string) => {
	for (const key of scanCache.keys()) {
		if (key.includes(`:${businessId}:`)) scanCache.delete(key);
	}
};

const cachedScan = async <T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> => {
	const now = Date.now();
	const hit = scanCache.get(key);
	if (hit && hit.expiresAt > now) return hit.value as T;
	const value = await compute();
	if (scanCache.size >= SCAN_CACHE_MAX_ENTRIES) {
		for (const [entryKey, entry] of scanCache) {
			if (entry.expiresAt <= now) scanCache.delete(entryKey);
		}
		if (scanCache.size >= SCAN_CACHE_MAX_ENTRIES) scanCache.clear();
	}
	scanCache.set(key, { value, expiresAt: now + ttlMs });
	return value;
};

type DaySlotScan = {
	slots: AvailabilitySlot[];
	// Última fecha local efectivamente escaneada: si la fecha pedida cae dentro,
	// sus slots ya están en `slots` y no hace falta otra query.
	scannedThrough: string;
};

const collectPublicDaySlots = async (
	supabase: SupabaseClient,
	input: {
		business: Business;
		serviceId: string;
		professionalId?: string | null;
		fromDate: string;
		maxDate: string;
		targetDays?: number;
		targetProfessionalIds?: string[];
	}
): Promise<DaySlotScan> => {
	let cursor = input.fromDate;
	let collected: AvailabilitySlot[] = [];
	let scannedThrough = input.fromDate;
	const requiredProfessionals = new Set(input.targetProfessionalIds ?? []);
	while (dateLTE(cursor, input.maxDate)) {
		const windowEnd = minDateString(addDaysToDateString(cursor, PUBLIC_DAY_BATCH_DAYS - 1), input.maxDate);
		const batch = await getAvailabilitySlots(supabase, {
			business: input.business,
			serviceId: input.serviceId,
			professionalId: input.professionalId ?? null,
			fromDate: cursor,
			toDate: windowEnd,
			publicOnly: true
		});
		collected = uniqueSlots([...collected, ...batch]);
		scannedThrough = windowEnd;
		const collectedDates = new Set(collected.map((slot) => slot.date)).size;
		const collectedProfessionals = new Set(collected.map((slot) => slot.professional_id));
		const hasAllRequiredProfessionals =
			requiredProfessionals.size === 0 ||
			[...requiredProfessionals].every((professionalId) => collectedProfessionals.has(professionalId));
		if (collectedDates >= (input.targetDays ?? PUBLIC_DAY_TARGET) && hasAllRequiredProfessionals) break;
		cursor = addDaysToDateString(windowEnd, 1);
	}
	return { slots: collected, scannedThrough };
};

const getProfessionalsWithPublicAvailability = async (
	supabase: SupabaseClient,
	input: {
		business: PublicBookingBusiness;
		serviceId: string;
		professionals: PublicProfessional[];
		fromDate: string;
		maxDate: string;
	}
) => {
	if (input.professionals.length === 0) return [];
	const professionalIds = input.professionals
		.map((professional) => professional.id)
		.sort()
		.join(',');
	const { slots } = await cachedScan(
		`prof-scan:${input.business.id}:${input.serviceId}:${input.fromDate}:${input.maxDate}:${professionalIds}`,
		STRUCTURE_SCAN_CACHE_TTL_MS,
		() =>
			collectPublicDaySlots(supabase, {
				business: input.business as Business,
				serviceId: input.serviceId,
				professionalId: null,
				fromDate: input.fromDate,
				maxDate: input.maxDate,
				targetDays: 1,
				targetProfessionalIds: input.professionals.map((professional) => professional.id)
			})
	);

	const firstAvailableByProfessional = new Map<string, string>();
	for (const slot of slots) {
		const current = firstAvailableByProfessional.get(slot.professional_id);
		if (!current || slot.starts_at < current) firstAvailableByProfessional.set(slot.professional_id, slot.starts_at);
	}

	return input.professionals
		.filter((professional) => firstAvailableByProfessional.has(professional.id))
		.map((professional) => ({
			...professional,
			next_available_at: firstAvailableByProfessional.get(professional.id) ?? null
		}));
};

const serviceHasPublicAvailability = async (
	supabase: SupabaseClient,
	input: {
		business: PublicBookingBusiness;
		serviceId: string;
		fromDate: string;
		maxDate: string;
	}
) => {
	const { slots } = await cachedScan(
		`service-scan:${input.business.id}:${input.serviceId}:${input.fromDate}:${input.maxDate}`,
		STRUCTURE_SCAN_CACHE_TTL_MS,
		() =>
			collectPublicDaySlots(supabase, {
				business: input.business as Business,
				serviceId: input.serviceId,
				professionalId: null,
				fromDate: input.fromDate,
				maxDate: input.maxDate,
				targetDays: 1
			})
	);
	return slots.length > 0;
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
	const business = await getPublicBusinessBySlug(supabase, input.slug);
	if (!business) {
		return { business: null, services: [], professionals: [], slots: [], days: [], issue: 'business_not_found' };
	}
	if (!business.is_active || !business.public_booking_enabled) {
		return { business, services: [], professionals: [], slots: [], days: [], issue: 'booking_disabled' };
	}

	// Un solo round-trip de latencia para el gate comercial, el catálogo y las
	// asignaciones del servicio elegido: son independientes entre sí.
	const [commerciallyUsable, structurallyReservableServices, assignedProfessionalsForService] =
		await Promise.all([
			canUsePublicBusiness(supabase, business.id, business.created_at),
			getReservableServices(supabase, business.id),
			input.serviceId
				? getReservableProfessionals(supabase, { businessId: business.id, serviceId: input.serviceId })
				: Promise.resolve([] as PublicProfessional[])
		]);
	if (!commerciallyUsable) {
		return { business, services: [], professionals: [], slots: [], days: [], issue: 'commercial_unavailable' };
	}
	if (structurallyReservableServices.length === 0) {
		return { business, services: [], professionals: [], slots: [], days: [], issue: 'no_services' };
	}

	const today = todayForBusiness(business);
	const maxDate = addDaysToDateString(today, Math.min(Math.max(business.max_booking_days_ahead, 1), 90));
	const requestedServiceId = input.serviceId ?? null;
	const services = requestedServiceId
		? structurallyReservableServices
		: (
				await Promise.all(
					structurallyReservableServices.map(async (service) => {
						const hasAvailability = await serviceHasPublicAvailability(supabase, {
							business,
							serviceId: service.id,
							fromDate: today,
							maxDate
						});
						return hasAvailability ? service : null;
					})
				)
			).filter((service): service is PublicService => service !== null);
	if (services.length === 0) {
		return { business, services, professionals: [], slots: [], days: [], issue: 'no_availability' };
	}

	const selectedService = services.find((service) => service.id === input.serviceId) ?? null;
	const professionals = selectedService
		? await getProfessionalsWithPublicAvailability(supabase, {
				business,
				serviceId: selectedService.id,
				professionals: assignedProfessionalsForService,
				fromDate: today,
				maxDate
			})
		: [];
	if (selectedService && professionals.length === 0) {
		return { business, services, professionals, slots: [], days: [], issue: 'no_professionals' };
	}

	const selectedProfessional = professionals.find((professional) => professional.id === input.professionalId) ?? null;
	if (!selectedService || !selectedProfessional) {
		return { business, services, professionals, slots: [], days: [], issue: null };
	}

	const dayScan = await cachedScan(
		`day-scan:${business.id}:${selectedService.id}:${selectedProfessional.id}:${today}:${maxDate}`,
		SLOT_SCAN_CACHE_TTL_MS,
		() =>
			collectPublicDaySlots(supabase, {
				business: business as Business,
				serviceId: selectedService.id,
				professionalId: selectedProfessional.id,
				fromDate: today,
				maxDate
			})
	);
	// La fecha elegida casi siempre cae dentro del rango ya escaneado: filtrar es
	// gratis. Solo se consulta aparte si quedó fuera (link viejo o "ver más días").
	const dateWithinScan = input.date ? input.date >= today && input.date <= dayScan.scannedThrough : false;
	const selectedDateSlots = !input.date
		? []
		: dateWithinScan
			? dayScan.slots.filter((slot) => slot.date === input.date)
			: await getAvailabilitySlots(supabase, {
					business: business as Business,
					serviceId: selectedService.id,
					professionalId: selectedProfessional.id,
					fromDate: input.date,
					toDate: input.date,
					publicOnly: true
				});
	const slots = input.date ? selectedDateSlots : [];
	const days = summarizeSlotsByDate(uniqueSlots([...dayScan.slots, ...selectedDateSlots]), business.timezone);

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

	const { data: patient, error: patientError } = await supabase
		.from('patients')
		.select('id, blocked')
		.eq('business_id', input.businessId)
		.eq('phone_e164', input.phoneE164)
		.maybeSingle();
	if (patientError) throw patientError;
	if (patient?.blocked) throw new Error('PUBLIC_BOOKING_BLOCKED_PATIENT');
	if (!patient?.id) return;

	// Anti-abuso: solo contamos turnos PENDIENTES Y FUTUROS (reserved/confirmed/reschedule_requested
	// con starts_at >= ahora). Los pasados, cancelados, atendidos y no asistidos NO cuentan, así que
	// un paciente puede seguir sacando turnos a lo largo de su tratamiento. Se restringe únicamente
	// cuando ya tiene 2 o más turnos pendientes futuros sin resolver.
	const { count, error } = await supabase
		.from('appointments')
		.select('id', { count: 'exact', head: true })
		.eq('business_id', input.businessId)
		.eq('patient_id', patient.id)
		.in('status', ['reserved', 'confirmed', 'reschedule_requested'])
		.gte('starts_at', now.toISOString());
	if (error) throw error;
	if ((count ?? 0) >= 2) throw new Error('PUBLIC_BOOKING_ACTIVE_LIMIT');
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

		const { data: appointment, error } = await supabase
			.from('appointments')
			.select('id, confirmation_token, starts_at, ends_at, service_name_snapshot, professional_name_snapshot, patients(full_name, phone_e164)')
			.eq('business_id', business.id)
			.eq('id', created?.id)
			.single();
		if (error) throw error;
		return { business, appointment };
	} catch (error) {
		await recordPublicBookingAttempt(supabase, {
			businessId: business?.id ?? null,
			phoneE164,
			ipHash: input.ipHash ?? null,
			action: 'booking_create',
			success: false,
			errorCode: (error as Error)?.message ?? 'UNKNOWN',
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

export const getPublicBookingErrorMessage = (error: unknown) => {
	const raw = `${(error as { message?: string; code?: string; details?: string })?.message ?? ''} ${(error as { details?: string })?.details ?? ''}`;
	if (raw.includes('PUBLIC_BOOKING_UNAVAILABLE')) return 'La reserva online no está disponible en este momento.';
	if (raw.includes('PUBLIC_BUSINESS_COMMERCIAL_UNAVAILABLE')) return publicBusinessUnavailableMessage;
	if (raw.includes('PUBLIC_PATIENT_NAME_INVALID')) return 'Ingresá nombre y apellido.';
	if (raw.includes('PUBLIC_PATIENT_PHONE_INVALID')) return 'Ingresá un teléfono válido.';
	if (raw.includes('PUBLIC_SLOT_UNAVAILABLE')) return 'Ese horario ya fue reservado. Elegí otro horario disponible.';
	if (raw.includes('PUBLIC_RATE_LIMIT_IP') || raw.includes('PUBLIC_RATE_LIMIT_PHONE')) {
		return 'Hubo demasiados intentos de reserva. Probá nuevamente en unos minutos.';
	}
	if (raw.includes('PUBLIC_BOOKING_ACTIVE_LIMIT')) {
		return 'Ya tenés 2 turnos pendientes con ese teléfono. Esperá a que pase alguno o comunicate con el consultorio para coordinar otro.';
	}
	if (raw.includes('PUBLIC_BOOKING_BLOCKED_PATIENT') || raw.includes('PATIENT_BLOCKED')) {
		return 'No se pudo completar la reserva online. Contactá al consultorio.';
	}
	if (raw.includes('PUBLIC_CAPTCHA_REQUIRED') || raw.includes('PUBLIC_CAPTCHA_FAILED')) {
		return 'No pudimos validar la protección anti-spam. Intentá nuevamente.';
	}
	if (raw.includes('PATIENT_NAME_ALREADY_EXISTS')) {
		return 'Ya figura un paciente con ese nombre en el consultorio. Si ya sos paciente, comunicate con ellos para coordinar tu turno.';
	}
	if (raw.includes('PATIENT_DNI_ALREADY_EXISTS')) {
		return 'Ya figura un paciente con ese DNI en el consultorio. Comunicate con ellos para coordinar tu turno.';
	}
	const human = getHumanAppointmentErrorMessage(error);
	if (human !== 'No se pudo completar la acción.') return human;
	// Diagnóstico temporal: si el error no está mapeado, mostramos el motivo real
	// para poder darle un mensaje amigable. Reemplazar por texto amigable una vez identificado.
	const reason = raw.trim();
	return reason
		? `No pudimos guardar tu reserva (motivo: ${reason}). Probá de nuevo o comunicate con el consultorio.`
		: 'No pudimos guardar tu reserva. Probá de nuevo o comunicate con el consultorio.';
};
