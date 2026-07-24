import type { SupabaseClient } from '@supabase/supabase-js';
import type { TimeRange } from '$lib/utils/time-ranges';
import { timeRangesOverlap, type NormalizedScheduleBlock } from '$lib/utils/schedule-blocks';

export const MIN_SLOT_INTERVAL_MINUTES = 5;
export const MAX_SLOT_INTERVAL_MINUTES = 120;

export { timeRangesOverlap };

const isMissingAvailabilityRpc = (error: { code?: string; message?: string } | null | undefined) =>
	error?.code === 'PGRST202' ||
	error?.code === '42883' ||
	/error.*replace_professional_availability_rules|function.*replace_professional_availability_rules|could not find/i.test(
		error?.message ?? ''
	);

export const replaceProfessionalWeeklyRules = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		professionalId: string;
		weekdays: number[];
		ranges: TimeRange[];
		slotIntervalMinutes: number;
	}
) => {
	const { businessId, professionalId, weekdays, ranges, slotIntervalMinutes } = input;
	const { error: replaceError } = await supabase.rpc('replace_professional_availability_rules', {
		p_business_id: businessId,
		p_professional_id: professionalId,
		p_weekdays: weekdays,
		p_ranges: ranges.map((range) => ({ start_time: range.start, end_time: range.end })),
		p_slot_interval_minutes: slotIntervalMinutes
	});
	if (!replaceError) return;
	if (!isMissingAvailabilityRpc(replaceError)) throw replaceError;

	console.warn('RPC replace_professional_availability_rules no disponible; usando fallback compatible.');
	const { error: deleteError } = await supabase
		.from('availability_rules')
		.delete()
		.eq('business_id', businessId)
		.eq('professional_id', professionalId)
		.in('weekday', weekdays);
	if (deleteError) throw deleteError;

	const rows = weekdays.flatMap((weekday) =>
		ranges.map((range) => ({
			business_id: businessId,
			professional_id: professionalId,
			weekday,
			start_time: range.start,
			end_time: range.end,
			slot_interval_minutes: slotIntervalMinutes,
			is_active: true
		}))
	);
	const { error: insertError } = await supabase.from('availability_rules').insert(rows);
	if (insertError) throw insertError;
};

export const replaceProfessionalScheduleBlocks = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		professionalId: string;
		blocks: NormalizedScheduleBlock[];
	}
) => {
	const { businessId, professionalId, blocks } = input;
	const { error: deleteError } = await supabase
		.from('availability_rules')
		.delete()
		.eq('business_id', businessId)
		.eq('professional_id', professionalId);
	if (deleteError) throw deleteError;

	const rows = blocks.flatMap((block) =>
		block.weekdays.flatMap((weekday) =>
			block.ranges.map((range) => ({
				business_id: businessId,
				professional_id: professionalId,
				weekday,
				start_time: range.start,
				end_time: range.end,
				slot_interval_minutes: block.slotIntervalMinutes,
				break_minutes: block.breakMinutes,
				is_active: true
			}))
		)
	);

	if (rows.length === 0) return;
	const { error: insertError } = await supabase.from('availability_rules').insert(rows);
	if (insertError) throw insertError;
};
