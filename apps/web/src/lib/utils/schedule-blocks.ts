import { formatTimeRanges, parseTimeRanges, type TimeRange } from './time-ranges';

export type ScheduleBlockDraft = {
	id?: string;
	weekdays: number[];
	timeRanges: string;
	/**
	 * Descanso real entre consultas. El nombre se conserva para que los
	 * borradores antiguos sigan pudiendo recuperarse sin perder información.
	 */
	slotInterval: string;
	/** Separación interna de la grilla de horarios; no se muestra como descanso. */
	gridInterval?: string;
};

export type NormalizedScheduleBlock = {
	weekdays: number[];
	ranges: TimeRange[];
	slotIntervalMinutes: number;
	breakMinutes: number;
};

type RuleLike = {
	weekday: number;
	start_time: string;
	end_time: string;
	slot_interval_minutes: number;
	break_minutes?: number | null;
};

export const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];

export const createEmptyScheduleBlock = (id?: string): ScheduleBlockDraft => ({
	id,
	weekdays: [],
	timeRanges: '',
	slotInterval: '15',
	gridInterval: '15'
});

export const createDefaultScheduleBlock = (id?: string): ScheduleBlockDraft => ({
	id,
	weekdays: [...DEFAULT_WEEKDAYS],
	timeRanges: '',
	slotInterval: '15',
	gridInterval: '15'
});

export const normalizeScheduleWeekdays = (weekdays: unknown) => {
	if (!Array.isArray(weekdays)) return [];
	return [...new Set(weekdays.map(Number).filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))].sort(
		(a, b) => a - b
	);
};

export const timeRangesOverlap = (ranges: TimeRange[]) => {
	const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
	return sorted.some((range, index) => index > 0 && range.start < sorted[index - 1].end);
};

export const validateScheduleBlocks = (
	blocks: ScheduleBlockDraft[]
):
	| { ok: true; blocks: NormalizedScheduleBlock[] }
	| { ok: false; message: string; blockIndex?: number } => {
	const normalized: NormalizedScheduleBlock[] = [];
	const usedWeekdays = new Map<number, number>();

	for (const [index, block] of blocks.entries()) {
		const label = `bloque ${index + 1}`;
		const weekdays = normalizeScheduleWeekdays(block.weekdays);
		if (weekdays.length === 0) {
			return { ok: false, message: `Elegí al menos un día en el ${label}.`, blockIndex: index };
		}

		for (const weekday of weekdays) {
			const previousIndex = usedWeekdays.get(weekday);
			if (previousIndex !== undefined) {
				return {
					ok: false,
					message: `Un día no puede estar en dos bloques. Revisá los bloques ${previousIndex + 1} y ${index + 1}.`,
					blockIndex: index
				};
			}
			usedWeekdays.set(weekday, index);
		}

		const ranges = parseTimeRanges(block.timeRanges);
		if (!ranges || ranges.length === 0) {
			return { ok: false, message: `Horario inválido en el ${label}.`, blockIndex: index };
		}
		if (timeRangesOverlap(ranges)) {
			return { ok: false, message: `Los horarios del ${label} no pueden superponerse.`, blockIndex: index };
		}

		const rawBreakMinutes = String(block.slotInterval ?? '').trim();
		const breakMinutes = rawBreakMinutes === '' ? Number.NaN : Number(rawBreakMinutes);
		if (!Number.isInteger(breakMinutes) || breakMinutes < 0) {
			return {
				ok: false,
				message: `El descanso entre consultas del ${label} debe ser una cantidad entera de minutos igual o superior a 0. Podés usar, por ejemplo, 0, 2, 23 o 60.`,
				blockIndex: index
			};
		}
		const slotIntervalMinutes = Number(block.gridInterval || 15);
		if (
			!Number.isInteger(slotIntervalMinutes) ||
			slotIntervalMinutes < 1 ||
			slotIntervalMinutes > 120
		) {
			return {
				ok: false,
				message: `No pudimos conservar la grilla horaria del ${label}. Volvé a cargar ese bloque y guardalo otra vez.`,
				blockIndex: index
			};
		}

		normalized.push({ weekdays, ranges, slotIntervalMinutes, breakMinutes });
	}

	if (normalized.length === 0) {
		return { ok: false, message: 'Elegí al menos un bloque horario.' };
	}

	return { ok: true, blocks: normalized };
};

const rangeKey = (ranges: TimeRange[]) => ranges.map((range) => `${range.start}-${range.end}`).join(',');

export const canonicalScheduleBlocks = (blocks: ScheduleBlockDraft[]) => {
	const result = validateScheduleBlocks(blocks);
	if (!result.ok) return JSON.stringify(blocks);
	return JSON.stringify(
		result.blocks
			.map((block) => ({
				weekdays: block.weekdays,
				ranges: rangeKey(block.ranges),
				slotIntervalMinutes: block.slotIntervalMinutes,
				breakMinutes: block.breakMinutes
			}))
			.sort((a, b) => a.weekdays.join(',').localeCompare(b.weekdays.join(',')))
	);
};

export const serializeScheduleBlocks = (blocks: ScheduleBlockDraft[]) =>
	JSON.stringify(
		blocks.map((block) => ({
			weekdays: normalizeScheduleWeekdays(block.weekdays),
			timeRanges: block.timeRanges,
			slotInterval: String(block.slotInterval),
			gridInterval: String(block.gridInterval || '15')
		}))
	);

export const parseScheduleBlocksJson = (raw: string): ScheduleBlockDraft[] | null => {
	if (!raw.trim()) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!Array.isArray(parsed)) return null;
	return parsed.map((item: any) => ({
		weekdays: normalizeScheduleWeekdays(item?.weekdays),
		timeRanges: String(item?.timeRanges ?? item?.time_ranges ?? ''),
		slotInterval: String(item?.breakMinutes ?? item?.break_minutes ?? item?.slotInterval ?? '15'),
		gridInterval: String(item?.gridInterval ?? item?.slot_interval_minutes ?? '15')
	}));
};

export const scheduleBlocksFromRules = (rules: RuleLike[], idPrefix = 'block'): ScheduleBlockDraft[] => {
	if (rules.length === 0) return [createDefaultScheduleBlock(`${idPrefix}-1`)];

	const byWeekday = new Map<number, RuleLike[]>();
	for (const rule of rules) {
		const weekday = Number(rule.weekday);
		if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
		byWeekday.set(weekday, [...(byWeekday.get(weekday) ?? []), rule]);
	}

	const groups = new Map<string, ScheduleBlockDraft>();
	for (const [weekday, weekdayRules] of [...byWeekday.entries()].sort((a, b) => a[0] - b[0])) {
		const sortedRules = [...weekdayRules].sort(
			(a, b) => a.start_time.localeCompare(b.start_time) || a.end_time.localeCompare(b.end_time)
		);
		const ranges = sortedRules.map((rule) => ({
			start: String(rule.start_time).slice(0, 5),
			end: String(rule.end_time).slice(0, 5)
		}));
		const intervalCounts = new Map<number, number>();
		for (const rule of sortedRules) {
			intervalCounts.set(rule.slot_interval_minutes, (intervalCounts.get(rule.slot_interval_minutes) ?? 0) + 1);
		}
		const [slotInterval] = [...intervalCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] ?? [15];
		const breakCounts = new Map<number, number>();
		for (const rule of sortedRules) {
			const breakMinutes = Math.max(
				0,
				Number(rule.break_minutes ?? rule.slot_interval_minutes ?? 15)
			);
			breakCounts.set(breakMinutes, (breakCounts.get(breakMinutes) ?? 0) + 1);
		}
		const [breakMinutes] = [...breakCounts.entries()].sort(
			(a, b) => b[1] - a[1] || a[0] - b[0]
		)[0] ?? [15];
		const key = `${rangeKey(ranges)}|${slotInterval}|${breakMinutes}`;
		const existing = groups.get(key);
		if (existing) {
			existing.weekdays = [...existing.weekdays, weekday].sort((a, b) => a - b);
			continue;
		}
		groups.set(key, {
			id: `${idPrefix}-${groups.size + 1}`,
			weekdays: [weekday],
			timeRanges: formatTimeRanges(ranges),
			slotInterval: String(breakMinutes),
			gridInterval: String(slotInterval)
		});
	}

	return [...groups.values()];
};
