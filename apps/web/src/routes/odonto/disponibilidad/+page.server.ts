import { env } from '$env/dynamic/private';
import { demoBusinessContext } from '$lib/server/business';
import { writeAuditLog } from '$lib/server/audit';
import { zonedDateTimeToUtc } from '$lib/server/availability';
import { getOdontoContext } from '$lib/server/odonto-context';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const normalizeLocalDate = (date: string) => {
	const trimmed = date.trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
	const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	if (!match) return '';
	const [, rawDay, rawMonth, rawYear] = match;
	const day = rawDay.padStart(2, '0');
	const month = rawMonth.padStart(2, '0');
	return `${rawYear}-${month}-${day}`;
};

const normalizeTime = (value: string) => {
	const cleaned = value
		.trim()
		.toLowerCase()
		.replace(/\s*(hs?|horas?)\.?$/i, '')
		.replace('.', ':')
		.replace(/\s+/g, '');
	if (!cleaned) return null;

	let hour = '';
	let minute = '00';
	const colonMatch = cleaned.match(/^(\d{1,2}):(\d{1,2})$/);
	if (colonMatch) {
		hour = colonMatch[1];
		minute = colonMatch[2];
	} else if (/^\d{1,2}$/.test(cleaned)) {
		hour = cleaned;
	} else if (/^\d{3,4}$/.test(cleaned)) {
		hour = cleaned.slice(0, cleaned.length - 2);
		minute = cleaned.slice(-2);
	} else {
		return null;
	}

	const hourNumber = Number(hour);
	const minuteNumber = Number(minute);
	if (!Number.isInteger(hourNumber) || !Number.isInteger(minuteNumber)) return null;
	if (hourNumber < 0 || hourNumber > 23 || minuteNumber < 0 || minuteNumber > 59) return null;
	return `${String(hourNumber).padStart(2, '0')}:${String(minuteNumber).padStart(2, '0')}`;
};

const parseTimeRanges = (value: string) => {
	const rawRanges = value
		.split(/[,;\n]+/)
		.map((item) => item.trim())
		.filter(Boolean);

	return rawRanges.map((range) => {
		const parts = range.split(/\s+(?:a|hasta)\s+|\s*-\s*/i).map((item) => item.trim());
		if (parts.length !== 2) return null;
		const start = normalizeTime(parts[0]);
		const end = normalizeTime(parts[1]);
		if (!start || !end || start >= end) return null;
		return { start, end };
	});
};

const parseLocalDateTime = (date: string, time: string, timeZone: string) => {
	if (!date || !time) return null;
	const normalizedDate = normalizeLocalDate(date);
	if (!normalizedDate) return null;
	const value = zonedDateTimeToUtc(normalizedDate, time, timeZone);
	return Number.isNaN(value.getTime()) ? null : value;
};

export const load: PageServerLoad = async ({ locals, fetch, cookies, url }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			professionals: [],
			rules: [],
			exceptions: [],
			selectedProfessionalId: '',
			demo: true
		};
	}

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	if (!business.canOperate) throw redirect(303, business.role === 'professional' ? '/odonto/mis-turnos' : '/odonto/agenda');
	const businessId = business.business.id;
	const selectedProfessionalId = url.searchParams.get('professional_id') ?? '';

	const { data: professionals } = await supabase
		.from('professionals')
		.select('id, name, is_active')
		.eq('business_id', businessId)
		.order('sort_order')
		.order('name');
	const effectiveProfessionalId = selectedProfessionalId || professionals?.[0]?.id || '';

	const [{ data: rules }, { data: exceptions }] = await Promise.all([
		effectiveProfessionalId
			? supabase
					.from('availability_rules')
					.select('id, weekday, start_time, end_time, slot_interval_minutes, is_active')
					.eq('business_id', businessId)
					.eq('professional_id', effectiveProfessionalId)
					.order('weekday')
					.order('start_time')
			: Promise.resolve({ data: [] }),
		supabase
			.from('availability_exceptions')
			.select('id, professional_id, starts_at, ends_at, type, reason')
			.eq('business_id', businessId)
			.order('starts_at', { ascending: false })
			.limit(80)
	]);

	return {
		context: business,
		professionals: professionals ?? [],
		rules: rules ?? [],
		exceptions: exceptions ?? [],
		selectedProfessionalId: effectiveProfessionalId,
		demo: false
	};
};

export const actions: Actions = {
	save_weekly_rules: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para editar disponibilidad.' });

		const form = await request.formData();
		const professionalId = String(form.get('professional_id') ?? '').trim();
		const weekdays = form
			.getAll('weekdays')
			.map((value) => Number(value))
			.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
		const uniqueWeekdays = [...new Set(weekdays)];
		const interval = Number(form.get('slot_interval_minutes') ?? 15);
		const parsedRanges = parseTimeRanges(String(form.get('time_ranges') ?? ''));
		if (!professionalId || uniqueWeekdays.length === 0) {
			return fail(400, { message: 'Elegí profesional y al menos un día.' });
		}
		if (parsedRanges.length === 0 || parsedRanges.some((range) => !range)) {
			return fail(400, { message: 'Escribí los horarios con formato 09:00-13:00.' });
		}
		const ranges = parsedRanges.filter((range): range is { start: string; end: string } => Boolean(range));
		const slotInterval = Number.isInteger(interval) && interval > 0 ? interval : 15;

		const { error: deleteError } = await supabase
			.from('availability_rules')
			.delete()
			.eq('business_id', business.business.id)
			.eq('professional_id', professionalId)
			.in('weekday', uniqueWeekdays);
		if (deleteError) {
			console.error('Error reemplazando horarios', deleteError);
			return fail(500, { message: 'No se pudieron actualizar los horarios.' });
		}

		const rows = uniqueWeekdays.flatMap((weekday) =>
			ranges.map((range) => ({
				business_id: business.business.id,
				professional_id: professionalId,
				weekday,
				start_time: range.start,
				end_time: range.end,
				slot_interval_minutes: slotInterval,
				is_active: true
			}))
		);

		const { error: insertError } = await supabase.from('availability_rules').insert(rows);
		if (insertError) {
			console.error('Error guardando horarios', insertError);
			return fail(500, { message: 'No se pudieron guardar los horarios.' });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'availability_rules.replaced',
			entityType: 'professional',
			entityId: professionalId,
			metadata: { weekdays: uniqueWeekdays, ranges, slot_interval_minutes: slotInterval }
		});

		throw redirect(303, `/odonto/disponibilidad?professional_id=${professionalId}`);
	},
	create_rule: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para editar disponibilidad.' });

		const form = await request.formData();
		const professionalId = String(form.get('professional_id') ?? '').trim();
		const weekday = Number(form.get('weekday') ?? -1);
		const startTime = String(form.get('start_time') ?? '').trim();
		const endTime = String(form.get('end_time') ?? '').trim();
		const interval = Number(form.get('slot_interval_minutes') ?? 15);
		if (!professionalId || weekday < 0 || weekday > 6 || !startTime || !endTime) {
			return fail(400, { message: 'Completá profesional, día y horarios.' });
		}
		if (startTime >= endTime) return fail(400, { message: 'La hora de inicio debe ser menor a la de fin.' });

		const { data, error } = await supabase
			.from('availability_rules')
			.insert({
				business_id: business.business.id,
				professional_id: professionalId,
				weekday,
				start_time: startTime,
				end_time: endTime,
				slot_interval_minutes: Number.isInteger(interval) && interval > 0 ? interval : 15,
				is_active: true
			})
			.select('id')
			.single();
		if (error) {
			console.error('Error creando horario', error);
			return fail(500, { message: 'No se pudo crear el horario.' });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'availability_rule.created',
			entityType: 'availability_rule',
			entityId: data?.id ?? null,
			metadata: { professional_id: professionalId, weekday, start_time: startTime, end_time: endTime }
		});

		throw redirect(303, `/odonto/disponibilidad?professional_id=${professionalId}`);
	},
	delete_rule: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para editar disponibilidad.' });

		const form = await request.formData();
		const ruleId = String(form.get('rule_id') ?? '').trim();
		const professionalId = String(form.get('professional_id') ?? '').trim();
		if (!ruleId) return fail(400, { message: 'Horario inválido.' });

		const { error } = await supabase
			.from('availability_rules')
			.delete()
			.eq('business_id', business.business.id)
			.eq('id', ruleId);
		if (error) {
			console.error('Error eliminando horario', error);
			return fail(500, { message: 'No se pudo eliminar el horario.' });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'availability_rule.deleted',
			entityType: 'availability_rule',
			entityId: ruleId
		});

		throw redirect(303, `/odonto/disponibilidad?professional_id=${professionalId}`);
	},
	create_exception: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para crear excepciones.' });

		const form = await request.formData();
		const professionalId = String(form.get('professional_id') ?? '').trim() || null;
		const type = String(form.get('type') ?? '').trim();
		const date = String(form.get('date') ?? '').trim();
		const timeRange = String(form.get('time_range') ?? '').trim();
		const parsedRange = timeRange ? parseTimeRanges(timeRange)[0] : null;
		const startTime = parsedRange
			? parsedRange.start
			: normalizeTime(String(form.get('start_time') ?? '').trim()) ?? '';
		const endTime = parsedRange
			? parsedRange.end
			: normalizeTime(String(form.get('end_time') ?? '').trim()) ?? '';
		const startsAt = parseLocalDateTime(date, startTime, business.business.timezone);
		const endsAt = parseLocalDateTime(date, endTime, business.business.timezone);
		if (!startsAt || !endsAt || startsAt >= endsAt) return fail(400, { message: 'La franja es inválida.' });
		if (type !== 'blocked' && type !== 'extra_available') return fail(400, { message: 'Tipo de excepción inválido.' });

		const { data, error } = await supabase
			.from('availability_exceptions')
			.insert({
				business_id: business.business.id,
				professional_id: professionalId,
				type,
				starts_at: startsAt.toISOString(),
				ends_at: endsAt.toISOString(),
				reason: String(form.get('reason') ?? '').trim() || null
			})
			.select('id')
			.single();
		if (error) {
			console.error('Error creando excepción', error);
			return fail(500, { message: 'No se pudo crear la excepción.' });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'availability_exception.created',
			entityType: 'availability_exception',
			entityId: data?.id ?? null,
			metadata: { professional_id: professionalId, type }
		});

		throw redirect(303, `/odonto/disponibilidad${professionalId ? `?professional_id=${professionalId}` : ''}`);
	},
	delete_exception: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para eliminar excepciones.' });

		const form = await request.formData();
		const exceptionId = String(form.get('exception_id') ?? '').trim();
		const professionalId = String(form.get('professional_id') ?? '').trim();
		if (!exceptionId) return fail(400, { message: 'Excepción inválida.' });

		const { error } = await supabase
			.from('availability_exceptions')
			.delete()
			.eq('business_id', business.business.id)
			.eq('id', exceptionId);
		if (error) {
			console.error('Error eliminando excepción', error);
			return fail(500, { message: 'No se pudo eliminar la excepción.' });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'availability_exception.deleted',
			entityType: 'availability_exception',
			entityId: exceptionId
		});

		throw redirect(303, `/odonto/disponibilidad${professionalId ? `?professional_id=${professionalId}` : ''}`);
	}
};
