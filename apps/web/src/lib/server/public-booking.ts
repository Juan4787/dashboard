import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Business } from './business';
import { getAvailabilitySlots, type AvailabilitySlot, addMinutes } from './availability';
import { createManualAppointment, getHumanAppointmentErrorMessage } from './appointments';
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
	| 'min_booking_notice_minutes'
	| 'max_booking_days_ahead'
	| 'cancellation_policy'
>;

export type PublicBookingIssue =
	| 'business_not_found'
	| 'booking_disabled'
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
	'id, name, slug, phone, address, logo_url, timezone, public_booking_enabled, is_active, min_booking_notice_minutes, max_booking_days_ahead, cancellation_policy';

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
	const { data, error } = await supabase
		.from('businesses')
		.select(PUBLIC_BUSINESS_SELECT)
		.eq('slug', slug)
		.maybeSingle();
	if (error) throw error;
	return (data as PublicBookingBusiness | null) ?? null;
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
		weekday: 'short',
		day: '2-digit',
		month: 'short'
	});
	return [...counts.entries()].map(([date, count]) => ({
		date,
		count,
		label: formatter.format(new Date(`${date}T12:00:00.000Z`))
	}));
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

	const services = await getReservableServices(supabase, business.id);
	if (services.length === 0) return { business, services, professionals: [], slots: [], days: [], issue: 'no_services' };

	const selectedService = services.find((service) => service.id === input.serviceId) ?? null;
	const professionals = selectedService
		? await getReservableProfessionals(supabase, { businessId: business.id, serviceId: selectedService.id })
		: [];
	if (selectedService && professionals.length === 0) {
		return { business, services, professionals, slots: [], days: [], issue: 'no_professionals' };
	}

	const selectedProfessional = professionals.find((professional) => professional.id === input.professionalId) ?? null;
	if (!selectedService || !selectedProfessional) {
		return { business, services, professionals, slots: [], days: [], issue: null };
	}

	const today = todayForBusiness(business);
	const maxDate = addDaysToDateString(today, Math.min(Math.max(business.max_booking_days_ahead, 1), 90));
	const slots = await getAvailabilitySlots(supabase, {
		business: business as Business,
		serviceId: selectedService.id,
		professionalId: selectedProfessional.id,
		fromDate: input.date ?? today,
		toDate: input.date ?? maxDate,
		publicOnly: true
	});
	const days = summarizeSlotsByDate(
		input.date ? await getAvailabilitySlots(supabase, {
			business: business as Business,
			serviceId: selectedService.id,
			professionalId: selectedProfessional.id,
			fromDate: today,
			toDate: maxDate,
			publicOnly: true
		}) : slots,
		business.timezone
	);

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

	const { count, error } = await supabase
		.from('appointments')
		.select('id', { count: 'exact', head: true })
		.eq('business_id', input.businessId)
		.eq('patient_id', patient.id)
		.in('status', ['reserved', 'confirmed', 'reschedule_requested'])
		.gte('starts_at', now.toISOString());
	if (error) throw error;
	if ((count ?? 0) >= 1) throw new Error('PUBLIC_BOOKING_ACTIVE_LIMIT');
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
	if (raw.includes('PUBLIC_PATIENT_NAME_INVALID')) return 'Ingresá nombre y apellido.';
	if (raw.includes('PUBLIC_PATIENT_PHONE_INVALID')) return 'Ingresá un teléfono válido.';
	if (raw.includes('PUBLIC_SLOT_UNAVAILABLE')) return 'Ese horario ya fue tomado. Elegí otro horario.';
	if (raw.includes('PUBLIC_RATE_LIMIT_IP') || raw.includes('PUBLIC_RATE_LIMIT_PHONE')) {
		return 'Hubo demasiados intentos de reserva. Probá nuevamente en unos minutos.';
	}
	if (raw.includes('PUBLIC_BOOKING_ACTIVE_LIMIT')) {
		return 'Ya existe un turno activo para ese teléfono. Contactá al consultorio si necesitás otro.';
	}
	if (raw.includes('PUBLIC_BOOKING_BLOCKED_PATIENT') || raw.includes('PATIENT_BLOCKED')) {
		return 'No se pudo completar la reserva online. Contactá al consultorio.';
	}
	if (raw.includes('PUBLIC_CAPTCHA_REQUIRED') || raw.includes('PUBLIC_CAPTCHA_FAILED')) {
		return 'No pudimos validar la protección anti-spam. Intentá nuevamente.';
	}
	return getHumanAppointmentErrorMessage(error);
};
