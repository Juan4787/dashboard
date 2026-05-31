import { env } from '$env/dynamic/private';
import { demoBusinessContext } from '$lib/server/business';
import { writeAuditLog } from '$lib/server/audit';
import { zonedDateTimeToUtc } from '$lib/server/availability';
import { getOdontoContext } from '$lib/server/odonto-context';
import { idsFromForm, setProfessionalServices } from '$lib/server/professional-services';
import { formatPriceLabel } from '$lib/utils/money-input';
import { parseTimeRanges } from '$lib/utils/time-ranges';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const boolFromForm = (form: FormData, key: string) => form.get(key) === 'true';
const MIN_SERVICE_DURATION_MINUTES = 5;
const MAX_SERVICE_DURATION_MINUTES = 480;
const MIN_SLOT_INTERVAL_MINUTES = 5;
const MAX_SLOT_INTERVAL_MINUTES = 120;

const parsePositiveInt = (value: FormDataEntryValue | null, fallback = 0) => {
	const parsed = Number(value ?? fallback);
	return Number.isInteger(parsed) ? parsed : fallback;
};

const normalizeLocalDate = (date: string) => {
	const trimmed = date.trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
	const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	if (!match) return '';
	const [, rawDay, rawMonth, rawYear] = match;
	return `${rawYear}-${rawMonth.padStart(2, '0')}-${rawDay.padStart(2, '0')}`;
};

const parseLocalDateTime = (date: string, time: string, timeZone: string) => {
	if (!date || !time) return null;
	const normalizedDate = normalizeLocalDate(date);
	if (!normalizedDate) return null;
	const value = zonedDateTimeToUtc(normalizedDate, time, timeZone);
	return Number.isNaN(value.getTime()) ? null : value;
};

const rangesOverlap = (ranges: Array<{ start: string; end: string }>) => {
	const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
	return sorted.some((range, index) => index > 0 && range.start < sorted[index - 1].end);
};

const isMissingAvailabilityRpc = (error: { code?: string; message?: string } | null | undefined) =>
	error?.code === 'PGRST202' ||
	error?.code === '42883' ||
	/error.*replace_professional_availability_rules|function.*replace_professional_availability_rules|could not find/i.test(
		error?.message ?? ''
	);

const redirectToProfessional = (professionalId: string, tab = 'perfil') => {
	throw redirect(303, `/odonto/profesionales/${professionalId}?tab=${tab}`);
};

export const load: PageServerLoad = async ({ params, locals, fetch, cookies, url }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			professional: null,
			services: [],
			assignedServiceIds: [],
			rules: [],
			exceptions: [],
			tab: url.searchParams.get('tab') ?? 'perfil',
			demo: true
		};
	}

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	if (!business.canOperate) throw redirect(303, business.role === 'professional' ? '/odonto/mis-turnos' : '/odonto/agenda');
	const businessId = business.business.id;

	const [{ data: professional, error: professionalError }, { data: services }, { data: assignments }, { data: rules }, { data: exceptions }] =
		await Promise.all([
			supabase
				.from('professionals')
				.select('id, name, specialty, phone, email, is_active, is_public')
				.eq('business_id', businessId)
				.eq('id', params.professionalId)
				.maybeSingle(),
			supabase
				.from('services')
				.select('id, name, description, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_label, is_active, is_public, sort_order')
				.eq('business_id', businessId)
				.order('sort_order')
				.order('name'),
			supabase
				.from('professional_services')
				.select('service_id')
				.eq('business_id', businessId)
				.eq('professional_id', params.professionalId),
			supabase
				.from('availability_rules')
				.select('id, weekday, start_time, end_time, slot_interval_minutes, is_active')
				.eq('business_id', businessId)
				.eq('professional_id', params.professionalId)
				.order('weekday')
				.order('start_time'),
			supabase
				.from('availability_exceptions')
				.select('id, professional_id, starts_at, ends_at, type, reason')
				.eq('business_id', businessId)
				.or(`professional_id.eq.${params.professionalId},professional_id.is.null`)
				.order('starts_at', { ascending: false })
				.limit(80)
		]);

	if (professionalError || !professional) throw kitError(404, 'Profesional no encontrado');

	return {
		context: business,
		professional,
		services: services ?? [],
		assignedServiceIds: (assignments ?? []).map((item: any) => String(item.service_id)),
		rules: rules ?? [],
		exceptions: exceptions ?? [],
		tab: url.searchParams.get('tab') ?? 'perfil',
		demo: false
	};
};

export const actions: Actions = {
	update_profile: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para editar profesionales.' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'El nombre es obligatorio.' });
		const isAvailable = boolFromForm(form, 'is_available');

		const { error } = await supabase
			.from('professionals')
			.update({
				name,
				specialty: String(form.get('specialty') ?? '').trim() || null,
				phone: String(form.get('phone') ?? '').trim() || null,
				email: String(form.get('email') ?? '').trim() || null,
				is_public: isAvailable,
				is_active: isAvailable,
				updated_at: new Date().toISOString()
			})
			.eq('business_id', business.business.id)
			.eq('id', params.professionalId);

		if (error) {
			console.error('Error actualizando profesional', error);
			return fail(500, { message: 'No se pudo actualizar el profesional.' });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'professional.updated',
			entityType: 'professional',
			entityId: params.professionalId
		});

		redirectToProfessional(params.professionalId, 'perfil');
	},

	save_services: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para asignar servicios.' });

		const form = await request.formData();
		const serviceIds = idsFromForm(form, 'service_id');

		try {
			await setProfessionalServices(supabase, business.business.id, params.professionalId, serviceIds);
		} catch (assignmentError) {
			console.error('Error asignando servicios al profesional', assignmentError);
			const message =
				assignmentError instanceof Error && assignmentError.message === 'INVALID_SERVICE_ASSIGNMENT'
					? 'Algún servicio seleccionado no pertenece a este consultorio.'
					: 'No se pudieron actualizar los servicios de este profesional.';
			return fail(500, { message });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'professional.services_updated',
			entityType: 'professional',
			entityId: params.professionalId,
			metadata: { service_ids: serviceIds }
		});

		redirectToProfessional(params.professionalId, 'servicios');
	},

	create_service: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para crear servicios.' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const duration = parsePositiveInt(form.get('duration_minutes'), 30);
		const priceLabel = formatPriceLabel(String(form.get('price_label') ?? ''));
		if (!name) return fail(400, { message: 'El nombre del servicio es obligatorio.' });
		if (duration < MIN_SERVICE_DURATION_MINUTES || duration > MAX_SERVICE_DURATION_MINUTES) {
			return fail(400, { message: 'La duración debe estar entre 5 y 480 minutos.' });
		}

		const { data, error } = await supabase
			.from('services')
			.insert({
				business_id: business.business.id,
				name,
				duration_minutes: duration,
				price_label: priceLabel || null,
				description: null,
				buffer_before_minutes: 0,
				buffer_after_minutes: 0,
				is_public: true,
				is_active: true
			})
			.select('id')
			.single();

		if (error || !data) {
			console.error('Error creando servicio desde profesional', error);
			return fail(500, { message: 'No se pudo crear el servicio.' });
		}

		const { error: assignmentError } = await supabase.from('professional_services').upsert(
			{
				business_id: business.business.id,
				professional_id: params.professionalId,
				service_id: data.id
			},
			{ onConflict: 'business_id,professional_id,service_id' }
		);
		if (assignmentError) {
			console.error('Error asignando servicio creado', assignmentError);
			return fail(500, { message: 'El servicio se creó, pero no se pudo asignar al profesional.' });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'service.created_from_professional',
			entityType: 'service',
			entityId: data.id,
			metadata: { professional_id: params.professionalId, name, duration_minutes: duration }
		});

		redirectToProfessional(params.professionalId, 'servicios');
	},

	save_weekly_rules: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para editar horarios.' });

		const form = await request.formData();
		const weekdays = form
			.getAll('weekdays')
			.map((value) => Number(value))
			.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
		const uniqueWeekdays = [...new Set(weekdays)];
		const interval = Number(form.get('slot_interval_minutes') ?? 15);
		const parsedRanges = parseTimeRanges(String(form.get('time_ranges') ?? ''));
		if (uniqueWeekdays.length === 0) return fail(400, { message: 'Elegí al menos un día.' });
		if (!parsedRanges || parsedRanges.length === 0) {
			return fail(400, { message: 'Escribí los horarios como 9 a 13 o 09:00-13:00.' });
		}
		const ranges = parsedRanges;
		if (rangesOverlap(ranges)) {
			return fail(400, { message: 'Los horarios no pueden superponerse.' });
		}
		if (!Number.isInteger(interval) || interval < MIN_SLOT_INTERVAL_MINUTES || interval > MAX_SLOT_INTERVAL_MINUTES) {
			return fail(400, { message: 'El intervalo debe estar entre 5 y 120 minutos.' });
		}
		const slotInterval = interval;

		const { error: replaceError } = await supabase.rpc('replace_professional_availability_rules', {
			p_business_id: business.business.id,
			p_professional_id: params.professionalId,
			p_weekdays: uniqueWeekdays,
			p_ranges: ranges.map((range) => ({ start_time: range.start, end_time: range.end })),
			p_slot_interval_minutes: slotInterval
		});
		if (replaceError) {
			if (!isMissingAvailabilityRpc(replaceError)) {
				console.error('Error guardando horarios', replaceError);
				return fail(500, { message: 'No se pudieron guardar los horarios.' });
			}

			console.warn('RPC replace_professional_availability_rules no disponible; usando fallback compatible.');
			const { error: deleteError } = await supabase
				.from('availability_rules')
				.delete()
				.eq('business_id', business.business.id)
				.eq('professional_id', params.professionalId)
				.in('weekday', uniqueWeekdays);
			if (deleteError) {
				console.error('Error reemplazando horarios: no se pudieron limpiar reglas previas', deleteError);
				return fail(500, { message: 'No se pudieron guardar los horarios.' });
			}

			const rows = uniqueWeekdays.flatMap((weekday) =>
				ranges.map((range) => ({
					business_id: business.business.id,
					professional_id: params.professionalId,
					weekday,
					start_time: range.start,
					end_time: range.end,
					slot_interval_minutes: slotInterval,
					is_active: true
				}))
			);
			const { error: insertError } = await supabase.from('availability_rules').insert(rows);
			if (insertError) {
				console.error('Error reemplazando horarios: no se pudieron insertar reglas nuevas', insertError);
				return fail(500, { message: 'No se pudieron guardar los horarios.' });
			}
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'availability_rules.replaced',
			entityType: 'professional',
			entityId: params.professionalId,
			metadata: { weekdays: uniqueWeekdays, ranges, slot_interval_minutes: slotInterval }
		});

		redirectToProfessional(params.professionalId, 'horarios');
	},

	delete_rule: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para editar horarios.' });

		const form = await request.formData();
		const ruleId = String(form.get('rule_id') ?? '').trim();
		if (!ruleId) return fail(400, { message: 'Horario inválido.' });

		const { error } = await supabase
			.from('availability_rules')
			.delete()
			.eq('business_id', business.business.id)
			.eq('professional_id', params.professionalId)
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

		redirectToProfessional(params.professionalId, 'horarios');
	},

	create_exception: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para crear excepciones.' });

		const form = await request.formData();
		const appliesTo = String(form.get('applies_to') ?? 'professional');
		const professionalId = appliesTo === 'business' ? null : params.professionalId;
		const type = String(form.get('type') ?? '').trim();
		const date = String(form.get('date') ?? '').trim();
		const timeRange = String(form.get('time_range') ?? '').trim();
		const parsedRanges = timeRange ? parseTimeRanges(timeRange) : null;
		if (parsedRanges && parsedRanges.length > 1) {
			return fail(400, { message: 'Para un cambio puntual cargá una sola franja horaria.' });
		}
		const parsedRange = parsedRanges?.[0] ?? null;
		const startTime = parsedRange ? parsedRange.start : '';
		const endTime = parsedRange ? parsedRange.end : '';
		const startsAt = parseLocalDateTime(date, startTime, business.business.timezone);
		const endsAt = parseLocalDateTime(date, endTime, business.business.timezone);
		if (!startsAt || !endsAt || startsAt >= endsAt) return fail(400, { message: 'La franja es inválida.' });
		if (type !== 'blocked' && type !== 'extra_available') return fail(400, { message: 'Tipo de cambio inválido.' });

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
			return fail(500, { message: 'No se pudo guardar el cambio puntual.' });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'availability_exception.created',
			entityType: 'availability_exception',
			entityId: data?.id ?? null,
			metadata: { professional_id: professionalId, type }
		});

		redirectToProfessional(params.professionalId, 'horarios');
	},

	delete_exception: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para eliminar excepciones.' });

		const form = await request.formData();
		const exceptionId = String(form.get('exception_id') ?? '').trim();
		if (!exceptionId) return fail(400, { message: 'Cambio inválido.' });

		const { error } = await supabase
			.from('availability_exceptions')
			.delete()
			.eq('business_id', business.business.id)
			.eq('id', exceptionId);
		if (error) {
			console.error('Error eliminando excepción', error);
			return fail(500, { message: 'No se pudo eliminar el cambio.' });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'availability_exception.deleted',
			entityType: 'availability_exception',
			entityId: exceptionId
		});

		redirectToProfessional(params.professionalId, 'horarios');
	}
};
