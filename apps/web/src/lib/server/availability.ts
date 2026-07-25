import type { SupabaseClient } from '@supabase/supabase-js';
import type { Business } from './business';

const BLOCKING_STATUSES = ['reserved', 'confirmed', 'reschedule_requested'] as const;

export type AvailabilitySlot = {
	date: string;
	time: string;
	starts_at: string;
	ends_at: string;
	professional_id: string;
	professional_name: string;
	professional_ids?: string[];
	professional_names?: string[];
	is_joint?: boolean;
};

export type AvailabilityServiceRow = {
	id: string;
	business_id: string;
	name: string;
	duration_minutes: number;
	buffer_before_minutes: number;
	buffer_after_minutes: number;
	is_public: boolean;
	is_active: boolean;
};

export type AvailabilityProfessionalRow = {
	id: string;
	name: string;
	is_public: boolean;
	is_active: boolean;
};

export type AvailabilityRuleRow = {
	id: string;
	professional_id: string;
	weekday: number;
	start_time: string;
	end_time: string;
	slot_interval_minutes: number;
	break_minutes?: number;
	is_active: boolean;
};

export type AvailabilityExceptionRow = {
	id: string;
	professional_id: string | null;
	starts_at: string;
	ends_at: string;
	type: 'blocked' | 'extra_available';
};

export type AvailabilityAppointmentBlockRow = {
	id: string;
	appointment_id?: string;
	professional_id: string;
	starts_at?: string;
	ends_at?: string;
	base_blocking_starts_at?: string;
	base_blocking_ends_at?: string;
	blocking_starts_at: string;
	blocking_ends_at: string;
};

type Interval = {
	start: Date;
	end: Date;
	stepMinutes: number;
	breakMinutes: number;
};

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

const pad = (value: number) => String(value).padStart(2, '0');
const hasVisibleProfessionalName = (professional: Pick<AvailabilityProfessionalRow, 'name'>) =>
	String(professional.name ?? '').trim().length > 0;

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
	now = new Date()
) => {
	const dates = dateRange(fromDate, toDate);
	const maxDate = addMinutes(now, business.max_booking_days_ahead * 24 * 60);
	return dates.filter((date) => zonedDateTimeToUtc(date, '00:00', business.timezone) <= maxDate);
};

export const calculateAvailabilitySlots = (input: {
	business: Business;
	service: AvailabilityServiceRow;
	professionals: AvailabilityProfessionalRow[];
	rules: AvailabilityRuleRow[];
	exceptions: AvailabilityExceptionRow[];
	blocks: AvailabilityAppointmentBlockRow[];
	fromDate: string;
	toDate: string;
	publicOnly?: boolean;
	requiredProfessionalIds?: string[];
	ignoreBreak?: boolean;
	now?: Date;
	maxSlots?: number;
	maxSlotsPerDate?: number;
}): AvailabilitySlot[] => {
	const {
		business,
		service,
		publicOnly = false,
		ignoreBreak = false,
		now = new Date(),
		maxSlots = Number.POSITIVE_INFINITY,
		maxSlotsPerDate = Number.POSITIVE_INFINITY
	} = input;
	if (publicOnly && (!business.is_active || !business.public_booking_enabled)) return [];
	if (!service.is_active || (publicOnly && !service.is_public)) return [];

	let professionals = input.professionals.filter(
		(professional) =>
			professional?.is_active &&
			(!publicOnly || (professional.is_public && hasVisibleProfessionalName(professional)))
	);
	const requiredProfessionalIds = [
		...new Set(
			(input.requiredProfessionalIds ?? [])
				.map((professionalId) => String(professionalId).trim())
				.filter(Boolean)
		)
	];
	if (requiredProfessionalIds.length > 0) {
		const byId = new Map(professionals.map((professional) => [professional.id, professional]));
		professionals = requiredProfessionalIds
			.map((professionalId) => byId.get(professionalId))
			.filter((professional): professional is AvailabilityProfessionalRow => Boolean(professional));
		if (professionals.length !== requiredProfessionalIds.length) return [];
	}
	if (professionals.length === 0 || maxSlots <= 0 || maxSlotsPerDate <= 0) return [];

	const dates = clampRangeToBusinessRules(business, input.fromDate, input.toDate, now);
	if (dates.length === 0) return [];

	const minStartsAt = publicOnly
		? addMinutes(now, Math.max(0, Number(business.min_booking_notice_minutes ?? 0)))
		: now;
	const allSlots: AvailabilitySlot[] = [];

	type ProfessionalDayContext = {
		professional: AvailabilityProfessionalRow;
		intervals: Interval[];
		blockingExceptions: AvailabilityExceptionRow[];
		appointmentBlocks: AvailabilityAppointmentBlockRow[];
	};

	const appointmentBlockRange = (block: AvailabilityAppointmentBlockRow) => ({
		start: new Date(
			ignoreBreak
				? (block.base_blocking_starts_at ?? block.starts_at ?? block.blocking_starts_at)
				: block.blocking_starts_at
		),
		end: new Date(
			ignoreBreak
				? (block.base_blocking_ends_at ?? block.ends_at ?? block.blocking_ends_at)
				: block.blocking_ends_at
		)
	});

	const candidateFits = (context: ProfessionalDayContext, startsAt: Date) => {
		const endsAt = addMinutes(startsAt, service.duration_minutes);
		if (startsAt < minStartsAt) return false;

		for (const interval of context.intervals) {
			const baseBlockingStart = addMinutes(startsAt, -service.buffer_before_minutes);
			const baseBlockingEnd = addMinutes(endsAt, service.buffer_after_minutes);
			const blockingEnd = addMinutes(
				endsAt,
				service.buffer_after_minutes + (ignoreBreak ? 0 : interval.breakMinutes)
			);
			// La atención y los buffers clínicos deben caber en la jornada. El
			// descanso posterior sólo condiciona el próximo turno: no impide que
			// la última atención termine justo al cierre.
			if (baseBlockingStart < interval.start || baseBlockingEnd > interval.end) continue;

			const blockedByException = context.blockingExceptions.some((exception) =>
				overlaps(
					baseBlockingStart,
					baseBlockingEnd,
					new Date(exception.starts_at),
					new Date(exception.ends_at)
				)
			);
			if (blockedByException) continue;

			const blockedByAppointment = context.appointmentBlocks.some((block) => {
				const range = appointmentBlockRange(block);
				return overlaps(baseBlockingStart, blockingEnd, range.start, range.end);
			});
			if (blockedByAppointment) continue;

			return true;
		}
		return false;
	};

	const candidatesFor = (context: ProfessionalDayContext) => {
		const candidates = new Map<number, Date>();
		const remember = (candidate: Date) => candidates.set(candidate.getTime(), candidate);

		for (const interval of context.intervals) {
			const firstStart = addMinutes(interval.start, service.buffer_before_minutes);
			for (
				let startsAt = firstStart;
				addMinutes(startsAt, service.duration_minutes) <= interval.end;
				startsAt = addMinutes(startsAt, interval.stepMinutes)
			) {
				remember(new Date(startsAt));
			}

			// El final real del bloqueo puede caer fuera de la grilla cuando el
			// descanso es, por ejemplo, de 2 o 23 minutos. Se agrega como candidato
			// para ofrecer exactamente la primera hora posible.
			for (const block of context.appointmentBlocks) {
				const range = appointmentBlockRange(block);
				remember(addMinutes(range.end, service.buffer_before_minutes));
			}
			for (const exception of context.blockingExceptions) {
				remember(addMinutes(new Date(exception.ends_at), service.buffer_before_minutes));
			}
		}
		return [...candidates.values()].sort((a, b) => a.getTime() - b.getTime());
	};

	dateLoop: for (const date of dates) {
		const slotsBeforeDate = allSlots.length;
		const weekday = weekdayForDate(date, business.timezone);
		const contexts: ProfessionalDayContext[] = [];
		for (const professional of professionals) {
			const professionalRules = input.rules.filter(
				(rule) => rule.professional_id === professional.id
			);
			if (publicOnly && professionalRules.length === 0) continue;
			const professionalStepOptions = professionalRules
				.map((rule) => rule.slot_interval_minutes)
				.filter((value) => value > 0);
			const defaultStepMinutes =
				professionalStepOptions.length > 0 ? Math.min(...professionalStepOptions) : 15;
			const intervals: Interval[] = professionalRules
				.filter((rule) => rule.weekday === weekday)
				.map((rule) => ({
					start: zonedDateTimeToUtc(date, rule.start_time.slice(0, 5), business.timezone),
					end: zonedDateTimeToUtc(date, rule.end_time.slice(0, 5), business.timezone),
					stepMinutes: Math.max(1, rule.slot_interval_minutes),
					breakMinutes: Math.max(0, Number(rule.break_minutes ?? 0))
				}));

			for (const exception of input.exceptions) {
				if (exception.type !== 'extra_available') continue;
				if (exception.professional_id !== professional.id) continue;
				const start = new Date(exception.starts_at);
				const end = new Date(exception.ends_at);
				const localDate = zonedDateParts(start, business.timezone).date;
				if (localDate === date) {
					intervals.push({ start, end, stepMinutes: defaultStepMinutes, breakMinutes: 0 });
				}
			}
			intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
			if (intervals.length === 0) continue;

			const blockingExceptions = input.exceptions.filter(
				(exception) =>
					exception.type === 'blocked' &&
					(exception.professional_id === null || exception.professional_id === professional.id)
			);
			const appointmentBlocks = input.blocks.filter(
				(block) => block.professional_id === professional.id
			);
			contexts.push({ professional, intervals, blockingExceptions, appointmentBlocks });
		}

		if (requiredProfessionalIds.length > 0) {
			if (contexts.length !== requiredProfessionalIds.length) continue;
			const candidates = new Map<number, Date>();
			for (const context of contexts) {
				for (const candidate of candidatesFor(context)) {
					candidates.set(candidate.getTime(), candidate);
				}
			}
			for (const startsAt of [...candidates.values()].sort(
				(a, b) => a.getTime() - b.getTime()
			)) {
				if (!contexts.every((context) => candidateFits(context, startsAt))) continue;
				const endsAt = addMinutes(startsAt, service.duration_minutes);
				const local = zonedDateParts(startsAt, business.timezone);
				const professionalNames = contexts.map((context) =>
					publicOnly ? context.professional.name.trim() : context.professional.name
				);
				allSlots.push({
					date: local.date,
					time: local.time,
					starts_at: startsAt.toISOString(),
					ends_at: endsAt.toISOString(),
					professional_id: contexts[0].professional.id,
					professional_name: professionalNames.join(', '),
					professional_ids: contexts.map((context) => context.professional.id),
					professional_names: professionalNames,
					is_joint: contexts.length > 1
				});
				if (allSlots.length - slotsBeforeDate >= maxSlotsPerDate) break;
			}
			if (allSlots.length >= maxSlots) break dateLoop;
			continue;
		}

		const dateSlots: AvailabilitySlot[] = [];
		for (const context of contexts) {
			for (const startsAt of candidatesFor(context)) {
				if (!candidateFits(context, startsAt)) continue;
				const endsAt = addMinutes(startsAt, service.duration_minutes);
				const local = zonedDateParts(startsAt, business.timezone);
				dateSlots.push({
					date: local.date,
					time: local.time,
					starts_at: startsAt.toISOString(),
					ends_at: endsAt.toISOString(),
					professional_id: context.professional.id,
					professional_name: publicOnly
						? context.professional.name.trim()
						: context.professional.name
				});
			}
		}
		// Si se consultan varios profesionales, primero se comparan todos los
		// horarios del día. Limitar durante el primer profesional podría ocultar
		// un horario más temprano de otro integrante.
		dateSlots.sort(
			(a, b) =>
				a.starts_at.localeCompare(b.starts_at) ||
				a.professional_name.localeCompare(b.professional_name)
		);
		allSlots.push(...dateSlots.slice(0, maxSlotsPerDate));
		if (allSlots.length >= maxSlots) break dateLoop;
	}

	const uniqueSlots = [
		...new Map(
			allSlots.map((slot) => [
				`${slot.professional_ids?.join(',') ?? slot.professional_id}:${slot.starts_at}`,
				slot
			])
		).values()
	].sort(
		(a, b) =>
			a.starts_at.localeCompare(b.starts_at) ||
			a.professional_name.localeCompare(b.professional_name)
	);
	return uniqueSlots.slice(0, maxSlots);
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

export const groupSlotsByDate = (slots: AvailabilitySlot[]) =>
	slots.reduce<Record<string, AvailabilitySlot[]>>((acc, slot) => {
		acc[slot.date] = acc[slot.date] ?? [];
		acc[slot.date].push(slot);
		return acc;
	}, {});
