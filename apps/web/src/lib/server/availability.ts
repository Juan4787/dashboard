import type { SupabaseClient } from '@supabase/supabase-js';
import type { Business } from './business';

const BLOCKING_STATUSES = ['pending_confirmation', 'reserved', 'confirmed', 'reschedule_requested'] as const;

export type AvailabilitySlot = {
	date: string;
	time: string;
	starts_at: string;
	ends_at: string;
	professional_id: string;
	professional_name: string;
};

type ServiceRow = {
	id: string;
	business_id: string;
	name: string;
	duration_minutes: number;
	buffer_before_minutes: number;
	buffer_after_minutes: number;
	is_public: boolean;
	is_active: boolean;
};

type ProfessionalRow = {
	id: string;
	name: string;
	is_public: boolean;
	is_active: boolean;
	profile_status?: string | null;
	name_source?: string | null;
};

type RuleRow = {
	id: string;
	professional_id: string;
	weekday: number;
	start_time: string;
	end_time: string;
	slot_interval_minutes: number;
	is_active: boolean;
};

type ExceptionRow = {
	id: string;
	professional_id: string | null;
	starts_at: string;
	ends_at: string;
	type: 'blocked' | 'extra_available';
};

type AppointmentBlockRow = {
	id: string;
	professional_id: string;
	blocking_starts_at: string;
	blocking_ends_at: string;
};

type Interval = {
	start: Date;
	end: Date;
	stepMinutes: number;
};

export type AvailabilityInput = {
	business: Business;
	serviceId: string;
	professionalId?: string | null;
	fromDate: string;
	toDate: string;
	publicOnly?: boolean;
	excludeAppointmentId?: string | null;
};

const pad = (value: number) => String(value).padStart(2, '0');

export const addMinutes = (date: Date, minutes: number) =>
	new Date(date.getTime() + minutes * 60_000);

export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
	aStart < bEnd && aEnd > bStart;

const dateRange = (fromDate: string, toDate: string) => {
	const start = new Date(`${fromDate}T00:00:00.000Z`);
	const end = new Date(`${toDate}T00:00:00.000Z`);
	const dates: string[] = [];
	for (let cursor = start; cursor <= end; cursor = addMinutes(cursor, 24 * 60)) {
		dates.push(`${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`);
	}
	return dates;
};

const getTimeZoneOffsetMs = (date: Date, timeZone: string) => {
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	});
	const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
	const asUtc = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		Number(parts.hour === '24' ? '0' : parts.hour),
		Number(parts.minute),
		Number(parts.second)
	);
	return asUtc - date.getTime();
};

export const zonedDateTimeToUtc = (date: string, time: string, timeZone: string) => {
	const [year, month, day] = date.split('-').map(Number);
	const [hour, minute] = time.split(':').map(Number);
	const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
	const offset = getTimeZoneOffsetMs(utcGuess, timeZone);
	return new Date(utcGuess.getTime() - offset);
};

const zonedDateParts = (date: Date, timeZone: string) => {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
	const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
	return {
		date: `${parts.year}-${parts.month}-${parts.day}`,
		time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`
	};
};

const weekdayForDate = (date: string, timeZone: string) => {
	const noon = zonedDateTimeToUtc(date, '12:00', timeZone);
	const value = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
		.formatToParts(noon)
		.find((part) => part.type === 'weekday')?.value;
	const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
	return map[value ?? 'Sun'];
};

const clampRangeToBusinessRules = (
	business: Business,
	fromDate: string,
	toDate: string,
	publicOnly: boolean
) => {
	const dates = dateRange(fromDate, toDate);
	const maxDate = addMinutes(new Date(), business.max_booking_days_ahead * 24 * 60);
	const today = zonedDateParts(new Date(), business.timezone).date;
	return dates.filter((date) => {
		if (publicOnly && !business.allow_same_day_booking && date === today) return false;
		return zonedDateTimeToUtc(date, '00:00', business.timezone) <= maxDate;
	});
};

export const getAvailabilitySlots = async (
	supabase: SupabaseClient,
	input: AvailabilityInput
): Promise<AvailabilitySlot[]> => {
	const { business, serviceId, professionalId, publicOnly = false } = input;

	try {
		await supabase.rpc('expire_public_booking_holds');
	} catch {
		// La expiracion es best-effort para compatibilidad con entornos sin la migracion aplicada.
	}

	if (publicOnly && (!business.is_active || !business.public_booking_enabled)) return [];

	const { data: service, error: serviceError } = await supabase
		.from('services')
		.select(
			'id, business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, is_public, is_active'
		)
		.eq('business_id', business.id)
		.eq('id', serviceId)
		.maybeSingle<ServiceRow>();
	if (serviceError || !service || !service.is_active || (publicOnly && !service.is_public)) return [];

	let assignmentQuery = supabase
		.from('professional_services')
		.select('professional_id, professionals!inner(id, name, is_public, is_active, profile_status, name_source)')
		.eq('business_id', business.id)
		.eq('service_id', service.id);
	if (professionalId) assignmentQuery = assignmentQuery.eq('professional_id', professionalId);

	const { data: assignments, error: assignmentError } = await assignmentQuery;
	if (assignmentError) throw assignmentError;

	const professionals = (assignments ?? [])
		.map((row: any) => row.professionals as ProfessionalRow)
		.filter(
			(professional) =>
				professional?.is_active &&
				(!publicOnly ||
					(professional.is_public &&
						(professional.profile_status ?? 'complete') === 'complete' &&
						(professional.name_source ?? 'manual') === 'manual'))
		);

	if (professionals.length === 0) return [];
	const professionalIds = professionals.map((professional) => professional.id);

	const dates = clampRangeToBusinessRules(business, input.fromDate, input.toDate, publicOnly);
	if (dates.length === 0) return [];

	const rangeStart = zonedDateTimeToUtc(dates[0], '00:00', business.timezone);
	const rangeEnd = zonedDateTimeToUtc(dates[dates.length - 1], '23:59', business.timezone);

	let blocksQuery = supabase
		.from('appointments')
		.select('id, professional_id, blocking_starts_at, blocking_ends_at')
		.eq('business_id', business.id)
		.in('professional_id', professionalIds)
		.in('status', [...BLOCKING_STATUSES])
		.lt('blocking_starts_at', rangeEnd.toISOString())
		.gt('blocking_ends_at', rangeStart.toISOString());
	if (input.excludeAppointmentId) {
		blocksQuery = blocksQuery.neq('id', input.excludeAppointmentId);
	}

	const [{ data: rules, error: rulesError }, { data: exceptions, error: exceptionsError }, { data: blocks, error: blocksError }] =
		await Promise.all([
			supabase
				.from('availability_rules')
				.select('id, professional_id, weekday, start_time, end_time, slot_interval_minutes, is_active')
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

	const minNoticeAt = addMinutes(new Date(), business.min_booking_notice_minutes);
	const allSlots: AvailabilitySlot[] = [];

	for (const date of dates) {
		const weekday = weekdayForDate(date, business.timezone);
		for (const professional of professionals) {
			const professionalRules = ((rules ?? []) as RuleRow[]).filter((rule) => rule.professional_id === professional.id);
			const professionalStepOptions = professionalRules
				.map((rule) => rule.slot_interval_minutes)
				.filter((value) => value > 0);
			const defaultStepMinutes = professionalStepOptions.length > 0 ? Math.min(...professionalStepOptions) : 15;
			const intervals: Interval[] = professionalRules
				.filter((rule: RuleRow) => rule.weekday === weekday)
				.map((rule: RuleRow) => ({
					start: zonedDateTimeToUtc(date, rule.start_time.slice(0, 5), business.timezone),
					end: zonedDateTimeToUtc(date, rule.end_time.slice(0, 5), business.timezone),
					stepMinutes: rule.slot_interval_minutes
				}));

			for (const exception of (exceptions ?? []) as ExceptionRow[]) {
				if (exception.type !== 'extra_available') continue;
				if (exception.professional_id !== professional.id) continue;
				const start = new Date(exception.starts_at);
				const end = new Date(exception.ends_at);
				const localDate = zonedDateParts(start, business.timezone).date;
				if (localDate === date) intervals.push({ start, end, stepMinutes: defaultStepMinutes });
			}

			const blockingExceptions = ((exceptions ?? []) as ExceptionRow[]).filter(
				(exception) =>
					exception.type === 'blocked' &&
					(exception.professional_id === null || exception.professional_id === professional.id)
			);
			const appointmentBlocks = ((blocks ?? []) as AppointmentBlockRow[]).filter(
				(block) => block.professional_id === professional.id
			);

			for (const interval of intervals) {
				for (
					let startsAt = new Date(interval.start);
					addMinutes(startsAt, service.duration_minutes) <= interval.end;
					startsAt = addMinutes(startsAt, interval.stepMinutes)
				) {
					const endsAt = addMinutes(startsAt, service.duration_minutes);
					const blockingStart = addMinutes(startsAt, -service.buffer_before_minutes);
					const blockingEnd = addMinutes(endsAt, service.buffer_after_minutes);
					if (startsAt < minNoticeAt) continue;
					if (blockingStart < interval.start || blockingEnd > interval.end) continue;

					const blockedByException = blockingExceptions.some((exception) =>
						overlaps(blockingStart, blockingEnd, new Date(exception.starts_at), new Date(exception.ends_at))
					);
					if (blockedByException) continue;

					const blockedByAppointment = appointmentBlocks.some((block) =>
						overlaps(blockingStart, blockingEnd, new Date(block.blocking_starts_at), new Date(block.blocking_ends_at))
					);
					if (blockedByAppointment) continue;

					const local = zonedDateParts(startsAt, business.timezone);
					allSlots.push({
						date: local.date,
						time: local.time,
						starts_at: startsAt.toISOString(),
						ends_at: endsAt.toISOString(),
						professional_id: professional.id,
						professional_name: professional.name
					});
				}
			}
		}
	}

	return allSlots.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
};

export const groupSlotsByDate = (slots: AvailabilitySlot[]) =>
	slots.reduce<Record<string, AvailabilitySlot[]>>((acc, slot) => {
		acc[slot.date] = acc[slot.date] ?? [];
		acc[slot.date].push(slot);
		return acc;
	}, {});
