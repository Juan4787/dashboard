import type { SupabaseClient } from '@supabase/supabase-js';
import type { Business } from './business';
import {
	calculateAvailabilitySlots,
	clampRangeToBusinessRules,
	hasVisibleProfessionalName,
	zonedDateTimeToUtc,
	type AvailabilityAppointmentBlockRow,
	type AvailabilityExceptionRow,
	type AvailabilityProfessionalRow,
	type AvailabilityRuleRow,
	type AvailabilityServiceRow,
	type AvailabilitySlot
} from '$lib/availability/calculate';

export * from '$lib/availability/calculate';

const BLOCKING_STATUSES = ['reserved', 'confirmed', 'reschedule_requested'] as const;

export type AvailabilityInput = {
	business: Business;
	serviceId: string;
	professionalId?: string | null;
	professionalIds?: string[] | null;
	fromDate: string;
	toDate: string;
	publicOnly?: boolean;
	excludeAppointmentId?: string | null;
	ignoreBreak?: boolean;
	maxSlots?: number;
	maxSlotsPerDate?: number;
};

export const getAvailabilitySlots = async (
	supabase: SupabaseClient,
	input: AvailabilityInput
): Promise<AvailabilitySlot[]> => {
	const {
		business,
		serviceId,
		professionalId,
		publicOnly = false,
		ignoreBreak = false
	} = input;
	const requiredProfessionalIds = [
		...new Set(
			(input.professionalIds ?? [])
				.map((candidate) => String(candidate).trim())
				.filter(Boolean)
		)
	];

	if (publicOnly && (!business.is_active || !business.public_booking_enabled)) return [];

	const { data: service, error: serviceError } = await supabase
		.from('services')
		.select(
			'id, business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, is_public, is_active'
		)
		.eq('business_id', business.id)
		.eq('id', serviceId)
		.maybeSingle<AvailabilityServiceRow>();
	if (serviceError || !service || !service.is_active || (publicOnly && !service.is_public)) return [];

	let assignmentQuery = supabase
		.from('professional_services')
		.select('professional_id, professionals!inner(id, name, is_public, is_active)')
		.eq('business_id', business.id)
		.eq('service_id', service.id);
	if (requiredProfessionalIds.length > 0) {
		assignmentQuery = assignmentQuery.in('professional_id', requiredProfessionalIds);
	} else if (professionalId) {
		assignmentQuery = assignmentQuery.eq('professional_id', professionalId);
	}

	const { data: assignments, error: assignmentError } = await assignmentQuery;
	if (assignmentError) throw assignmentError;

	let professionals = (assignments ?? [])
		.map((row: any) => row.professionals as AvailabilityProfessionalRow)
		.filter(
			(professional) =>
				professional?.is_active && (!publicOnly || (professional.is_public && hasVisibleProfessionalName(professional)))
		);

	if (professionals.length === 0) return [];
	if (requiredProfessionalIds.length > 0) {
		const byId = new Map(professionals.map((professional) => [professional.id, professional]));
		professionals = requiredProfessionalIds
			.map((requiredId) => byId.get(requiredId))
			.filter((professional): professional is AvailabilityProfessionalRow => Boolean(professional));
		if (professionals.length !== requiredProfessionalIds.length) return [];
	}
	const professionalIds = professionals.map((professional) => professional.id);

	const calculationNow = new Date();
	const dates = clampRangeToBusinessRules(business, input.fromDate, input.toDate, calculationNow);
	if (dates.length === 0) return [];

	const rangeStart = zonedDateTimeToUtc(dates[0], '00:00', business.timezone);
	const rangeEnd = zonedDateTimeToUtc(dates[dates.length - 1], '23:59', business.timezone);

	let blocksQuery = supabase
		.from('appointment_professionals')
		.select(
			'id, appointment_id, professional_id, starts_at, ends_at, base_blocking_starts_at, base_blocking_ends_at, blocking_starts_at, blocking_ends_at'
		)
		.eq('business_id', business.id)
		.in('professional_id', professionalIds)
		.in('status', [...BLOCKING_STATUSES]);
	if (ignoreBreak) {
		blocksQuery = blocksQuery
			.lt('base_blocking_starts_at', rangeEnd.toISOString())
			.gt('base_blocking_ends_at', rangeStart.toISOString());
	} else {
		blocksQuery = blocksQuery
			.lt('blocking_starts_at', rangeEnd.toISOString())
			.gt('blocking_ends_at', rangeStart.toISOString());
	}
	if (input.excludeAppointmentId) {
		blocksQuery = blocksQuery.neq('appointment_id', input.excludeAppointmentId);
	}

	const [{ data: rules, error: rulesError }, { data: exceptions, error: exceptionsError }, { data: blocks, error: blocksError }] =
		await Promise.all([
			supabase
				.from('availability_rules')
				.select(
					'id, professional_id, weekday, start_time, end_time, slot_interval_minutes, break_minutes, is_active'
				)
				.eq('business_id', business.id)
				.in('professional_id', professionalIds)
				.eq('is_active', true),
			supabase
				.from('availability_exceptions')
				.select('id, professional_id, starts_at, ends_at, type')
				.eq('business_id', business.id)
				.lt('starts_at', rangeEnd.toISOString())
				.gt('ends_at', rangeStart.toISOString()),
			blocksQuery
		]);

	if (rulesError) throw rulesError;
	if (exceptionsError) throw exceptionsError;
	if (blocksError) throw blocksError;

	return calculateAvailabilitySlots({
		business,
		service,
		professionals,
		rules: (rules ?? []) as AvailabilityRuleRow[],
		exceptions: (exceptions ?? []) as AvailabilityExceptionRow[],
		blocks: (blocks ?? []) as AvailabilityAppointmentBlockRow[],
		fromDate: dates[0],
		toDate: dates[dates.length - 1],
		publicOnly,
		requiredProfessionalIds,
		ignoreBreak,
		maxSlots: input.maxSlots,
		maxSlotsPerDate: input.maxSlotsPerDate,
		now: calculationNow
	});
};
