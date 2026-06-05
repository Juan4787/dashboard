import crypto from 'crypto';
import { env } from '$env/dynamic/private';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Business } from './business';
import { getAvailabilitySlots, type AvailabilitySlot, addMinutes } from './availability';
import { getHumanAppointmentErrorMessage } from './appointments';
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
	emailHash?: string | null;
	deviceHash?: string | null;
	identityBundleHash?: string | null;
	action: 'booking_create' | 'token_confirm' | 'token_cancel' | 'token_reschedule';
	success: boolean;
	errorCode?: string | null;
	userAgent?: string | null;
	idempotencyKey?: string | null;
	appointmentId?: string | null;
	riskScore?: number | null;
	riskFlags?: string[] | null;
	metadata?: Record<string, unknown> | null;
};

export const PUBLIC_BUSINESS_SELECT =
	'id, name, slug, phone, address, logo_url, timezone, public_booking_enabled, is_active, created_at, min_booking_notice_minutes, max_booking_days_ahead, cancellation_policy';

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

const hashSecret = () =>
	env.PUBLIC_BOOKING_HASH_SECRET ??
	env.RATE_LIMIT_HASH_SECRET ??
	env.ODONTO_PUBLIC_HASH_SECRET ??
	env.ODONTO_SUPABASE_SERVICE_ROLE_KEY ??
	'public-booking-development-secret';

export const publicHash = (value?: string | null) => {
	const normalized = String(value ?? '').trim();
	if (!normalized) return null;
	return crypto.createHmac('sha256', hashSecret()).update(normalized).digest('hex');
};

export const expirePublicBookingHolds = async (supabase: SupabaseClient) => {
	const { error } = await supabase.rpc('expire_public_booking_holds');
	if (error) {
		console.error('Error expirando holds publicos', error);
	}
};

export const recordPublicBookingAttempt = async (
	supabase: SupabaseClient,
	input: BookingAttemptInput
) => {
	const { error } = await supabase.from('public_booking_attempts').insert({
		business_id: input.businessId ?? null,
		phone_e164: input.phoneE164 ?? null,
		ip_hash: input.ipHash ?? null,
		email_hash: input.emailHash ?? null,
		device_hash: input.deviceHash ?? null,
		identity_bundle_hash: input.identityBundleHash ?? null,
		action: input.action,
		success: input.success,
		error_code: input.errorCode ?? null,
		user_agent: input.userAgent?.slice(0, 500) ?? null,
		idempotency_key: input.idempotencyKey ?? null,
		appointment_id: input.appointmentId ?? null,
		risk_score: input.riskScore ?? 0,
		risk_flags: input.riskFlags ?? [],
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
	const { data, error } = await supabase
		.from('businesses')
		.select(PUBLIC_BUSINESS_SELECT)
		.eq('slug', slug)
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
			'id, business_id, commercial_access_enabled, is_permanent, subscription_status, paid_until, grace_until, restricted_until, archived_at, last_grant_duration_seconds, expiration_notice_enabled'
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
				.select('id, is_active, is_public, profile_status, name_source')
				.eq('business_id', businessId)
				.eq('is_active', true)
				.eq('is_public', true)
				.eq('profile_status', 'complete')
				.eq('name_source', 'manual'),
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
		.select('professional_id, professionals!inner(id, name, specialty, avatar_url, is_active, is_public, sort_order, profile_status, name_source)')
		.eq('business_id', input.businessId)
		.eq('service_id', input.serviceId);
	if (error) throw error;

	return (data ?? [])
		.map((row: any) => row.professionals)
		.filter(
			(professional: any) =>
				professional?.is_active &&
				professional?.is_public &&
				(professional.profile_status ?? 'complete') === 'complete' &&
				(professional.name_source ?? 'manual') === 'manual'
		)
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
	return [...counts.entries()].map(([date, count]) => ({
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
) => {
	let cursor = input.fromDate;
	let collected: AvailabilitySlot[] = [];
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
		const collectedDates = new Set(collected.map((slot) => slot.date)).size;
		const collectedProfessionals = new Set(collected.map((slot) => slot.professional_id));
		const hasAllRequiredProfessionals =
			requiredProfessionals.size === 0 ||
			[...requiredProfessionals].every((professionalId) => collectedProfessionals.has(professionalId));
		if (collectedDates >= (input.targetDays ?? PUBLIC_DAY_TARGET) && hasAllRequiredProfessionals) break;
		cursor = addDaysToDateString(windowEnd, 1);
	}
	return collected;
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
	const slots = await collectPublicDaySlots(supabase, {
		business: input.business as Business,
		serviceId: input.serviceId,
		professionalId: null,
		fromDate: input.fromDate,
		maxDate: input.maxDate,
		targetDays: 1,
		targetProfessionalIds: input.professionals.map((professional) => professional.id)
	});

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
	const slots = await collectPublicDaySlots(supabase, {
		business: input.business as Business,
		serviceId: input.serviceId,
		professionalId: null,
		fromDate: input.fromDate,
		maxDate: input.maxDate,
		targetDays: 1
	});
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
	await expirePublicBookingHolds(supabase);
	const business = await getPublicBusinessBySlug(supabase, input.slug);
	if (!business) {
		return { business: null, services: [], professionals: [], slots: [], days: [], issue: 'business_not_found' };
	}
	if (!business.is_active || !business.public_booking_enabled) {
		return { business, services: [], professionals: [], slots: [], days: [], issue: 'booking_disabled' };
	}
	if (!(await canUsePublicBusiness(supabase, business.id, business.created_at))) {
		return { business, services: [], professionals: [], slots: [], days: [], issue: 'commercial_unavailable' };
	}

	const structurallyReservableServices = await getReservableServices(supabase, business.id);
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
	const assignedProfessionals = selectedService
		? await getReservableProfessionals(supabase, { businessId: business.id, serviceId: selectedService.id })
		: [];
	const professionals = selectedService
		? await getProfessionalsWithPublicAvailability(supabase, {
				business,
				serviceId: selectedService.id,
				professionals: assignedProfessionals,
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

	const daySlots = await collectPublicDaySlots(supabase, {
		business: business as Business,
		serviceId: selectedService.id,
		professionalId: selectedProfessional.id,
		fromDate: today,
		maxDate
	});
	const selectedDateSlots = input.date
		? await getAvailabilitySlots(supabase, {
			business: business as Business,
			serviceId: selectedService.id,
			professionalId: selectedProfessional.id,
			fromDate: input.date,
			toDate: input.date,
			publicOnly: true
		})
		: [];
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
	const { data: patient, error: patientError } = await supabase
		.from('patients')
		.select('id, blocked')
		.eq('business_id', input.businessId)
		.eq('phone_e164', input.phoneE164)
		.maybeSingle();
	if (patientError) throw patientError;
	if (patient?.blocked) throw new Error('PUBLIC_BOOKING_BLOCKED_PATIENT');
	if (!patient?.id) return;

	const { count, error } = await supabase
		.from('appointments')
		.select('id', { count: 'exact', head: true })
		.eq('business_id', input.businessId)
		.eq('patient_id', patient.id)
		.in('status', ['pending_confirmation', 'reserved', 'confirmed', 'reschedule_requested'])
		.gte('starts_at', now.toISOString());
	if (error) throw error;
	if ((count ?? 0) >= 2) throw new Error('PUBLIC_BOOKING_ACTIVE_LIMIT');
};

export type PublicBookingRisk = {
	score: number;
	flags: string[];
	requiresStepUp: boolean;
};

export const assessPublicBookingRisk = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		phoneE164: string;
		ipHash?: string | null;
		deviceHash?: string | null;
		userAgent?: string | null;
		now?: Date;
	}
): Promise<PublicBookingRisk> => {
	const now = input.now ?? new Date();
	const flags: string[] = [];
	let score = 0;

	if (!input.deviceHash) {
		flags.push('missing_device');
		score += 15;
	}
	if (!input.userAgent || input.userAgent.length < 12) {
		flags.push('thin_user_agent');
		score += 20;
	}

	const ipAttempts = input.ipHash
		? await countPublicAttempts(supabase, {
				action: 'booking_create',
				ipHash: input.ipHash,
				since: addMinutes(now, -60)
			})
		: 0;
	if (ipAttempts >= 3) {
		flags.push('ip_velocity');
		score += 45;
	} else if (ipAttempts >= 2) {
		flags.push('ip_reuse');
		score += 25;
	}

	const phoneAttempts = await countPublicAttempts(supabase, {
		action: 'booking_create',
		businessId: input.businessId,
		phoneE164: input.phoneE164,
		since: addMinutes(now, -24 * 60)
	});
	if (phoneAttempts >= 2) {
		flags.push('phone_daily_velocity');
		score += 35;
	}

	return { score, flags, requiresStepUp: score >= 45 };
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
		deviceHash?: string | null;
		userAgent?: string | null;
		now?: Date;
		idempotencyKey?: string | null;
	}
) => {
	const now = input.now ?? new Date();
	const business = await getPublicBusinessBySlug(supabase, input.slug);
	let phoneE164: string | null = null;
	let emailHash: string | null = null;
	let phoneHash: string | null = null;
	let identityBundleHash: string | null = null;
	let risk: PublicBookingRisk = { score: 0, flags: [], requiresStepUp: false };

	try {
		if (!business || !business.is_active || !business.public_booking_enabled) {
			throw new Error('PUBLIC_BOOKING_UNAVAILABLE');
		}
		const idempotencyKey = String(input.idempotencyKey ?? '').trim();
		if (!/^[a-zA-Z0-9_-]{12,160}$/.test(idempotencyKey)) {
			throw new Error('PUBLIC_IDEMPOTENCY_REQUIRED');
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
		phoneHash = publicHash(phoneE164);
		emailHash = publicHash(email.toLowerCase());
		identityBundleHash = publicHash([phoneE164, email.toLowerCase(), input.deviceHash ?? ''].join('|'));

		const { data: duplicateAttempt, error: duplicateAttemptError } = await supabase
			.from('public_booking_attempts')
			.select('appointment_id, phone_e164')
			.eq('business_id', business.id)
			.eq('action', 'booking_create')
			.eq('success', true)
			.eq('idempotency_key', idempotencyKey)
			.maybeSingle();
		if (duplicateAttemptError) throw duplicateAttemptError;
		if (duplicateAttempt?.appointment_id) {
			if (duplicateAttempt.phone_e164 !== phoneE164) throw new Error('PUBLIC_DUPLICATE_SUBMIT');
			const { data: existingAppointment, error: existingAppointmentError } = await supabase
				.from('appointments')
				.select('id, confirmation_token, starts_at, ends_at, service_name_snapshot, professional_name_snapshot, patients(full_name, phone_e164)')
				.eq('business_id', business.id)
				.eq('id', duplicateAttempt.appointment_id)
				.maybeSingle();
			if (existingAppointmentError) throw existingAppointmentError;
			if (existingAppointment?.id) return { business, appointment: existingAppointment };
		}

		risk = await assessPublicBookingRisk(supabase, {
			businessId: business.id,
			phoneE164,
			ipHash: input.ipHash ?? null,
			deviceHash: input.deviceHash ?? null,
			userAgent: input.userAgent,
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

		const { data: holdRows, error: holdError } = await supabase.rpc('reserve_public_booking_hold_safely', {
			p_business_id: business.id,
			p_service_id: input.serviceId,
			p_professional_id: input.professionalId,
			p_slot_starts_at: selectedSlot.starts_at,
			p_patient_name: patientName,
			p_phone_raw: phoneRaw,
			p_phone_e164: phoneE164,
			p_patient_email: email || null,
			p_note: input.note?.trim() || null,
			p_ip_hash: input.ipHash ?? null,
			p_phone_hash: phoneHash,
			p_email_hash: emailHash,
			p_device_hash: input.deviceHash ?? null,
			p_identity_bundle_hash: identityBundleHash,
			p_risk_score: risk.score,
			p_risk_flags: risk.flags,
			p_idempotency_key: idempotencyKey,
			p_now: now.toISOString()
		});
		if (holdError) throw holdError;
		const created = Array.isArray(holdRows) ? holdRows[0] : holdRows;
		if (!created?.appointment_id) throw new Error('PUBLIC_BOOKING_CREATE_FAILED');

		const { data: appointment, error } = await supabase
			.from('appointments')
			.select('id, confirmation_token, starts_at, ends_at, service_name_snapshot, professional_name_snapshot, patients(full_name, phone_e164)')
			.eq('business_id', business.id)
			.eq('id', created.appointment_id)
			.single();
		if (error) throw error;
		return { business, appointment };
	} catch (error) {
		await recordPublicBookingAttempt(supabase, {
			businessId: business?.id ?? null,
			phoneE164,
			ipHash: input.ipHash ?? null,
			emailHash,
			deviceHash: input.deviceHash ?? null,
			identityBundleHash,
			action: 'booking_create',
			success: false,
			errorCode: (error as Error)?.message ?? 'UNKNOWN',
			userAgent: input.userAgent,
			idempotencyKey: input.idempotencyKey ?? null,
			riskScore: risk.score,
			riskFlags: risk.flags,
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
	if (raw.includes('PUBLIC_IDEMPOTENCY_REQUIRED') || raw.includes('PUBLIC_DUPLICATE_SUBMIT')) {
		return 'No pudimos validar esta solicitud. Actualizá la página e intentá nuevamente.';
	}
	if (raw.includes('PUBLIC_SLOT_UNAVAILABLE')) return 'Ese horario ya fue reservado. Elegí otro horario disponible.';
	if (raw.includes('PUBLIC_RATE_LIMIT_IP') || raw.includes('PUBLIC_RATE_LIMIT_PHONE')) {
		return 'Hubo demasiados intentos de reserva. Probá nuevamente en unos minutos.';
	}
	if (raw.includes('PUBLIC_BOOKING_ACTIVE_LIMIT')) {
		return 'Ya tenés turnos activos en este consultorio. Si necesitás cambiar uno, comunicate con el consultorio.';
	}
	if (raw.includes('PUBLIC_BOOKING_BLOCKED_PATIENT') || raw.includes('PATIENT_BLOCKED')) {
		return 'No se pudo completar la reserva online. Contactá al consultorio.';
	}
	if (raw.includes('PUBLIC_CAPTCHA_REQUIRED') || raw.includes('PUBLIC_CAPTCHA_FAILED')) {
		return 'No pudimos validar la protección anti-spam. Intentá nuevamente.';
	}
	return getHumanAppointmentErrorMessage(error);
};
