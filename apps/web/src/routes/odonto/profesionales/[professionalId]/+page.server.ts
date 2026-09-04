import { env } from '$env/dynamic/private';
import { demoBusinessContext } from '$lib/server/business';
import { writeAuditLog } from '$lib/server/audit';
import { parseAvailabilityExceptionInterval } from '$lib/server/availability-exceptions';
import { getOdontoContext } from '$lib/server/odonto-context';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import { professionalHasFollowUps } from '$lib/server/follow-ups';
import { idsFromForm, setProfessionalServices } from '$lib/server/professional-services';
import { ensureDefaultServices, isDefaultServiceName } from '$lib/server/default-services';
import { replaceProfessionalScheduleBlocks } from '$lib/server/availability-rules';
import {
	findProfessionalByEmail,
	humanProfessionalEmailConflict,
	normalizeProfessionalEmail
} from '$lib/server/professionals';
import { formatPriceLabel } from '$lib/utils/money-input';
import {
	parseScheduleBlocksJson,
	validateScheduleBlocks,
	type NormalizedScheduleBlock,
	type ScheduleBlockDraft
} from '$lib/utils/schedule-blocks';
import type { SupabaseClient } from '@supabase/supabase-js';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const boolFromForm = (form: FormData, key: string) => form.get(key) === 'true';
const MIN_SERVICE_DURATION_MINUTES = 5;
const MAX_SERVICE_DURATION_MINUTES = 480;

const parsePositiveInt = (value: FormDataEntryValue | null, fallback = 0) => {
	const parsed = Number(value ?? fallback);
	return Number.isInteger(parsed) ? parsed : fallback;
};

const scheduleBlocksFromForm = (
	form: FormData
):
	| { ok: true; blocks: NormalizedScheduleBlock[] }
	| { ok: false; status: 400; message: string } => {
	const rawBlocks = String(form.get('schedule_blocks') ?? '').trim();
	let draftBlocks: ScheduleBlockDraft[] | null = rawBlocks ? parseScheduleBlocksJson(rawBlocks) : null;
	if (rawBlocks && !draftBlocks) {
		return { ok: false, status: 400, message: 'Los bloques horarios no son válidos.' };
	}
	if (!draftBlocks) {
		draftBlocks = [
			{
				weekdays: form
					.getAll('weekdays')
					.map((value) => Number(value))
					.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6),
				timeRanges: String(form.get('time_ranges') ?? ''),
				slotInterval: String(form.get('break_minutes') ?? 15),
				gridInterval: String(form.get('slot_interval_minutes') ?? 15)
			}
		];
	}

	const result = validateScheduleBlocks(draftBlocks);
	if (!result.ok) return { ok: false, status: 400, message: result.message };
	return { ok: true, blocks: result.blocks };
};

const redirectToProfessional = (professionalId: string, tab = 'perfil') => {
	throw redirect(303, `/odonto/profesionales/${professionalId}?tab=${tab}`);
};

type SaveResult<T = unknown> =
	| { ok: true; data?: T }
	| { ok: false; status: 400 | 403 | 404 | 409 | 500; message: string };

const failSave = (result: Extract<SaveResult, { ok: false }>) =>
	fail(result.status, { message: result.message });

type OdontoSupabase = SupabaseClient<any, any, any>;

const getPendingProfessionalAccountEmail = async (
	supabase: OdontoSupabase,
	businessId: string,
	professionalId: string
) => {
	const { data, error } = await supabase.rpc('list_business_role_access', {
		target_business_id: businessId
	});
	if (error) throw error;
	const pending = (data ?? []).find(
		(item: any) =>
			String(item?.status ?? '') === 'pending' &&
			String(item?.professional_id ?? '') === professionalId
	);
	return pending?.email ? String(pending.email).trim().toLowerCase() : null;
};

const saveProfessionalProfile = async (
	supabase: OdontoSupabase,
	businessId: string,
	professionalId: string,
	form: FormData,
	options: { accountLinkPending?: boolean } = {}
): Promise<SaveResult<{ email: string | null }>> => {
	const name = String(form.get('name') ?? '').trim();
	if (!name) return { ok: false, status: 400, message: 'El nombre es obligatorio.' };
	const isAvailable = boolFromForm(form, 'is_available');
	const email = normalizeProfessionalEmail(form.get('email'));
	const existingProfessional = await findProfessionalByEmail(supabase, businessId, email, professionalId);
	if (existingProfessional) {
		return { ok: false, status: 400, message: humanProfessionalEmailConflict(existingProfessional) };
	}

	const { data: updatedProfessional, error } = await supabase
		.from('professionals')
		.update({
			name,
			specialty: String(form.get('specialty') ?? '').trim() || null,
			phone: String(form.get('phone') ?? '').trim() || null,
			email,
			...(options.accountLinkPending
				? { is_public: false }
				: { is_public: isAvailable, is_active: isAvailable }),
			updated_at: new Date().toISOString()
		})
		.eq('business_id', businessId)
		.eq('id', professionalId)
		.select('id')
		.maybeSingle();

	if (error) {
		console.error('Error actualizando profesional', error);
		return {
			ok: false,
			status: 500,
			message: error.message?.includes('PROFESSIONAL_EMAIL_ALREADY_EXISTS')
				? 'Ese correo ya está cargado en otro profesional.'
				: 'No se pudo actualizar el profesional.'
		};
	}
	if (!updatedProfessional) {
		return {
			ok: false,
			status: 409,
			message: 'El perfil profesional cambió o ya no está disponible. Recargá la página y volvé a intentar.'
		};
	}

	return { ok: true, data: { email } };
};

const saveProfessionalServices = async (
	supabase: OdontoSupabase,
	businessId: string,
	professionalId: string,
	form: FormData
): Promise<SaveResult<{ serviceIds: string[] }>> => {
	const serviceIds = idsFromForm(form, 'service_id');

	let defaultServiceIds: string[] = [];
	try {
		defaultServiceIds = await ensureDefaultServices(supabase, businessId);
	} catch (defaultsError) {
		console.error('No se pudieron asegurar los servicios predeterminados', defaultsError);
	}

	try {
		await setProfessionalServices(supabase, businessId, professionalId, [
			...defaultServiceIds,
			...serviceIds
		]);
	} catch (assignmentError) {
		console.error('Error asignando servicios al profesional', assignmentError);
		const message =
			assignmentError instanceof Error && assignmentError.message === 'INVALID_SERVICE_ASSIGNMENT'
				? 'Algún servicio seleccionado no pertenece a este consultorio.'
				: 'No se pudieron actualizar los servicios de este profesional.';
		return { ok: false, status: 500, message };
	}

	return { ok: true, data: { serviceIds } };
};

const saveProfessionalWeeklyRules = async (
	supabase: OdontoSupabase,
	businessId: string,
	professionalId: string,
	form: FormData
): Promise<SaveResult<{ blocks: NormalizedScheduleBlock[] }>> => {
	const scheduleBlocks = scheduleBlocksFromForm(form);
	if (!scheduleBlocks.ok) return scheduleBlocks;

	try {
		await replaceProfessionalScheduleBlocks(supabase, {
			businessId,
			professionalId,
			blocks: scheduleBlocks.blocks
		});
	} catch (replaceError) {
		console.error('Error guardando horarios', replaceError);
		return { ok: false, status: 500, message: 'No se pudieron guardar los horarios.' };
	}

	return { ok: true, data: { blocks: scheduleBlocks.blocks } };
};

const createAvailabilityException = async (
	supabase: OdontoSupabase,
	businessId: string,
	professionalId: string,
	timeZone: string,
	form: FormData
): Promise<
	SaveResult<{
		id: string | null;
		professionalId: string | null;
		type: string;
		periodMode: 'single' | 'range';
		startDate: string;
		endDate: string;
	}>
> => {
	const appliesTo = String(form.get('applies_to') ?? 'professional');
	const targetProfessionalId = appliesTo === 'business' ? null : professionalId;
	const type = String(form.get('type') ?? '').trim();
	const interval = parseAvailabilityExceptionInterval({
		type,
		periodMode: String(form.get('period_mode') ?? 'single').trim(),
		date: String(form.get('date') ?? '').trim(),
		dateFrom: String(form.get('date_from') ?? '').trim(),
		dateTo: String(form.get('date_to') ?? '').trim(),
		timeRange: String(form.get('time_range') ?? '').trim(),
		timeZone
	});
	if (!interval.ok) return { ok: false, status: 400, message: interval.message };

	const exceptionId = crypto.randomUUID();
	const { error } = await supabase
		.from('availability_exceptions')
		.insert({
			id: exceptionId,
			business_id: businessId,
			professional_id: targetProfessionalId,
			type,
			starts_at: interval.startsAt.toISOString(),
			ends_at: interval.endsAt.toISOString(),
			reason: String(form.get('reason') ?? '').trim() || null
		});
	if (error) {
		console.error('Error creando excepción', error);
		return { ok: false, status: 500, message: 'No se pudo guardar el cambio puntual.' };
	}

	return {
		ok: true,
		data: {
			id: exceptionId,
			professionalId: targetProfessionalId,
			type,
			periodMode: interval.periodMode,
			startDate: interval.startDate,
			endDate: interval.endDate
		}
	};
};

export const load: PageServerLoad = async ({ params, locals, fetch, cookies, url, depends }) => {
	depends(`app:professional:${params.professionalId}`);
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			professional: null,
			services: [],
			assignedServiceIds: [],
			defaultServiceIds: [],
			rules: [],
			exceptions: [],
			tab: url.searchParams.get('tab') ?? 'perfil',
			userId: null,
			pendingAccountEmail: null,
			demo: true
		};
	}

	const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
	if (!business.canManage) throw redirect(303, business.role === 'professional' ? '/odonto/mis-turnos' : '/odonto/agenda');
	const businessId = business.business.id;

	const { data: professional, error: professionalError } = await supabase
		.from('professionals')
		.select('id, name, specialty, phone, email, is_active, is_public')
		.eq('business_id', businessId)
		.eq('id', params.professionalId)
		.maybeSingle();
	if (professionalError || !professional) throw kitError(404, 'Profesional no encontrado');

	const [
		{ data: services },
		{ data: assignments },
		{ data: rules },
		{ data: exceptions },
		pendingAccountEmail
	] = await Promise.all([
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
			.select(
				'id, weekday, start_time, end_time, slot_interval_minutes, break_minutes, is_active, created_at'
			)
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
			.limit(80),
		getPendingProfessionalAccountEmail(supabase, businessId, params.professionalId)
	]);
	const defaultServiceIds = (services ?? [])
		.filter((service: any) => isDefaultServiceName(String(service.name ?? '')))
		.map((service: any) => String(service.id));

	return {
		context: business,
		professional,
		services: services ?? [],
		assignedServiceIds: (assignments ?? []).map((item: any) => String(item.service_id)),
		defaultServiceIds,
		rules: rules ?? [],
		exceptions: exceptions ?? [],
		appointmentCount: null,
		clinicalEntryCount: null,
		followUpCount: null,
		dependencyCountsDeferred: true,
		tab: url.searchParams.get('tab') ?? 'perfil',
		userId,
		pendingAccountEmail,
		demo: false
	};
};

export const actions: Actions = {
	update_profile: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage) return fail(403, { message: 'No tenés permisos para editar profesionales.' });

		const form = await request.formData();
		const pendingAccountEmail = await getPendingProfessionalAccountEmail(
			supabase,
			business.business.id,
			params.professionalId
		);
		const profileResult = await saveProfessionalProfile(
			supabase,
			business.business.id,
			params.professionalId,
			form,
			{ accountLinkPending: Boolean(pendingAccountEmail) }
		);
		if (!profileResult.ok) return failSave(profileResult);

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'professional.updated',
			entityType: 'professional',
			entityId: params.professionalId
		});

		return { success: true, message: 'Perfil guardado.' };
	},

	save_services: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage) return fail(403, { message: 'No tenés permisos para asignar servicios.' });

		const form = await request.formData();
		const servicesResult = await saveProfessionalServices(supabase, business.business.id, params.professionalId, form);
		if (!servicesResult.ok) return failSave(servicesResult);

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'professional.services_updated',
			entityType: 'professional',
			entityId: params.professionalId,
			metadata: { service_ids: servicesResult.data?.serviceIds ?? [] }
		});

		return { success: true, message: 'Servicios guardados.' };
	},

	create_service: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage) return fail(403, { message: 'No tenés permisos para crear servicios.' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const duration = parsePositiveInt(form.get('duration_minutes'), 30);
		const priceLabel = formatPriceLabel(String(form.get('price_label') ?? ''));
		if (!name) return fail(400, { message: 'El nombre del servicio es obligatorio.' });
		if (duration < MIN_SERVICE_DURATION_MINUTES || duration > MAX_SERVICE_DURATION_MINUTES) {
			return fail(400, { message: 'La duración debe estar entre 5 y 480 minutos.' });
		}

		const serviceId = crypto.randomUUID();
		const { error } = await supabase
			.from('services')
			.insert({
				id: serviceId,
				business_id: business.business.id,
				name,
				duration_minutes: duration,
				price_label: priceLabel || null,
				description: null,
				buffer_before_minutes: 0,
				buffer_after_minutes: 0,
				is_public: true,
				is_active: true
			});

		if (error) {
			console.error('Error creando servicio desde profesional', error);
			return fail(500, { message: 'No se pudo crear el servicio.' });
		}

		const { error: assignmentError } = await supabase.from('professional_services').upsert(
			{
				business_id: business.business.id,
				professional_id: params.professionalId,
				service_id: serviceId
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
			entityId: serviceId,
			metadata: { professional_id: params.professionalId, name, duration_minutes: duration }
		});

		return { success: true, message: 'Servicio creado y asignado.', serviceId };
	},

	update_service: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage) return fail(403, { message: 'No tenés permisos para editar servicios.' });

		const form = await request.formData();
		const serviceId = String(form.get('service_id') ?? '').trim();
		if (!serviceId) return fail(400, { message: 'No pudimos identificar el servicio. Cerrá el editor y volvé a abrirlo.' });

		const { data: currentService, error: serviceError } = await supabase
			.from('services')
			.select('id, name')
			.eq('business_id', business.business.id)
			.eq('id', serviceId)
			.maybeSingle();
		if (serviceError || !currentService) {
			console.error('Error buscando servicio para editar', serviceError);
			return fail(404, { message: 'Ese servicio ya no está disponible. Cerrá el editor y recargá la página.' });
		}

		const isDefault = isDefaultServiceName(String(currentService.name ?? ''));
		const name = isDefault
			? String(currentService.name)
			: String(form.get('name') ?? '').trim();
		const duration = parsePositiveInt(form.get('duration_minutes'));
		const bufferBefore = parsePositiveInt(form.get('buffer_before_minutes'));
		const bufferAfter = parsePositiveInt(form.get('buffer_after_minutes'));
		const priceLabel = formatPriceLabel(String(form.get('price_label') ?? ''));
		if (!name) return fail(400, { message: 'El nombre del servicio es obligatorio.' });
		if (duration < MIN_SERVICE_DURATION_MINUTES || duration > MAX_SERVICE_DURATION_MINUTES) {
			return fail(400, { message: 'La duración debe estar entre 5 y 480 minutos.' });
		}
		if (bufferBefore < 0 || bufferBefore > 480 || bufferAfter < 0 || bufferAfter > 480) {
			return fail(400, { message: 'Los márgenes deben estar entre 0 y 480 minutos.' });
		}

		const { data: updatedService, error } = await supabase
			.from('services')
			.update({
				name,
				description: String(form.get('description') ?? '').trim() || null,
				duration_minutes: duration,
				buffer_before_minutes: bufferBefore,
				buffer_after_minutes: bufferAfter,
				price_label: priceLabel || null,
				is_public: isDefault || form.get('is_public') === 'true',
				is_active: isDefault || form.get('is_active') === 'true',
				updated_at: new Date().toISOString()
			})
			.eq('business_id', business.business.id)
			.eq('id', serviceId)
			.select('id')
			.maybeSingle();
		if (error || !updatedService) {
			console.error('Error actualizando servicio', error);
			return fail(500, { message: 'No pudimos guardar el servicio. Revisá los datos e intentá nuevamente.' });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'service.updated_from_professional',
			entityType: 'service',
			entityId: serviceId,
			metadata: { name, duration_minutes: duration }
		});

		return { success: true, message: 'Servicio guardado.' };
	},

	save_weekly_rules: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage) return fail(403, { message: 'No tenés permisos para editar horarios.' });

		const form = await request.formData();
		const scheduleResult = await saveProfessionalWeeklyRules(supabase, business.business.id, params.professionalId, form);
		if (!scheduleResult.ok) return failSave(scheduleResult);

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'availability_rules.replaced',
			entityType: 'professional',
			entityId: params.professionalId,
			metadata: { schedule_blocks: scheduleResult.data?.blocks ?? [] }
		});

		return { success: true, message: 'Horarios guardados.' };
	},

	delete_rule: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage) return fail(403, { message: 'No tenés permisos para editar horarios.' });

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

		return { success: true, message: 'Horario eliminado.' };
	},

	create_exception: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage) return fail(403, { message: 'No tenés permisos para crear excepciones.' });

		const form = await request.formData();
		const exceptionResult = await createAvailabilityException(
			supabase,
			business.business.id,
			params.professionalId,
			business.business.timezone,
			form
		);
		if (!exceptionResult.ok) return failSave(exceptionResult);

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'availability_exception.created',
			entityType: 'availability_exception',
			entityId: exceptionResult.data?.id ?? null,
			metadata: {
				professional_id: exceptionResult.data?.professionalId ?? null,
				type: exceptionResult.data?.type,
				period_mode: exceptionResult.data?.periodMode,
				start_date: exceptionResult.data?.startDate,
				end_date: exceptionResult.data?.endDate
			}
		});

		return {
			success: true,
			message:
				exceptionResult.data?.periodMode === 'range'
					? 'Rango de bloqueo guardado.'
					: 'Cambio puntual guardado.'
		};
	},

	delete_exception: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage) return fail(403, { message: 'No tenés permisos para eliminar excepciones.' });

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

		return { success: true, message: 'Cambio puntual eliminado.' };
	},

	save_all: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage) return fail(403, { message: 'No tenés permisos para editar profesionales.' });

		const form = await request.formData();
		const savedSections: string[] = [];

		if (boolFromForm(form, 'save_profile')) {
			const pendingAccountEmail = await getPendingProfessionalAccountEmail(
				supabase,
				business.business.id,
				params.professionalId
			);
			const profileResult = await saveProfessionalProfile(
				supabase,
				business.business.id,
				params.professionalId,
				form,
				{ accountLinkPending: Boolean(pendingAccountEmail) }
			);
			if (!profileResult.ok) return failSave(profileResult);
			await writeAuditLog(supabase, {
				businessId: business.business.id,
				userId,
				action: 'professional.updated',
				entityType: 'professional',
				entityId: params.professionalId,
				metadata: { via: 'save_all' }
			});
			savedSections.push('perfil');
		}

		if (boolFromForm(form, 'save_services')) {
			const servicesResult = await saveProfessionalServices(supabase, business.business.id, params.professionalId, form);
			if (!servicesResult.ok) return failSave(servicesResult);
			await writeAuditLog(supabase, {
				businessId: business.business.id,
				userId,
				action: 'professional.services_updated',
				entityType: 'professional',
				entityId: params.professionalId,
				metadata: { via: 'save_all', service_ids: servicesResult.data?.serviceIds ?? [] }
			});
			savedSections.push('servicios');
		}

		if (boolFromForm(form, 'save_schedule')) {
			const scheduleResult = await saveProfessionalWeeklyRules(supabase, business.business.id, params.professionalId, form);
			if (!scheduleResult.ok) return failSave(scheduleResult);
			await writeAuditLog(supabase, {
				businessId: business.business.id,
				userId,
				action: 'availability_rules.replaced',
				entityType: 'professional',
				entityId: params.professionalId,
				metadata: {
					via: 'save_all',
					schedule_blocks: scheduleResult.data?.blocks ?? []
				}
			});
			savedSections.push('horarios');
		}

		if (boolFromForm(form, 'save_exception')) {
			const exceptionResult = await createAvailabilityException(
				supabase,
				business.business.id,
				params.professionalId,
				business.business.timezone,
				form
			);
			if (!exceptionResult.ok) return failSave(exceptionResult);
			await writeAuditLog(supabase, {
				businessId: business.business.id,
				userId,
				action: 'availability_exception.created',
				entityType: 'availability_exception',
				entityId: exceptionResult.data?.id ?? null,
				metadata: {
					via: 'save_all',
					professional_id: exceptionResult.data?.professionalId ?? null,
					type: exceptionResult.data?.type,
					period_mode: exceptionResult.data?.periodMode,
					start_date: exceptionResult.data?.startDate,
					end_date: exceptionResult.data?.endDate
				}
			});
			savedSections.push('disponibilidad');
		}

		return {
			success: true,
			message: savedSections.length > 0 ? `Guardado: ${savedSections.join(', ')}.` : 'No había cambios pendientes.'
		};
	},

	archive_professional: async ({ params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage) {
			return fail(403, { message: 'Solo el dueño o un administrador puede archivar profesionales.' });
		}

		const { data: updatedProfessional, error } = await supabase
			.from('professionals')
			.update({ is_active: false, is_public: false, updated_at: new Date().toISOString() })
			.eq('business_id', business.business.id)
			.eq('id', params.professionalId)
			.select('id')
			.maybeSingle();
		if (error) {
			console.error('Error archivando profesional', error);
			return fail(500, { message: 'No se pudo archivar el profesional.' });
		}
		if (!updatedProfessional) {
			return fail(404, { message: 'El profesional ya no está disponible. Recargá la página.' });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'professional.archived',
			entityType: 'professional',
			entityId: params.professionalId
		});

		redirectToProfessional(params.professionalId, 'perfil');
	},

	restore_professional: async ({ params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage) {
			return fail(403, { message: 'Solo el dueño o un administrador puede restaurar profesionales.' });
		}
		const pendingAccountEmail = await getPendingProfessionalAccountEmail(
			supabase,
			business.business.id,
			params.professionalId
		);

		const { data: updatedProfessional, error } = await supabase
			.from('professionals')
			.update({
				is_active: true,
				is_public: !pendingAccountEmail,
				updated_at: new Date().toISOString()
			})
			.eq('business_id', business.business.id)
			.eq('id', params.professionalId)
			.select('id')
			.maybeSingle();
		if (error) {
			console.error('Error restaurando profesional', error);
			return fail(500, { message: 'No se pudo restaurar el profesional.' });
		}
		if (!updatedProfessional) {
			return fail(404, { message: 'El profesional ya no está disponible. Recargá la página.' });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'professional.restored',
			entityType: 'professional',
			entityId: params.professionalId
		});

		redirectToProfessional(params.professionalId, 'perfil');
	},

	delete_professional: async ({ params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage) {
			return fail(403, { message: 'Solo el dueño o un administrador puede eliminar profesionales.' });
		}

		const admin = await createSupabaseAdminClient('odonto', fetch);
		const businessId = business.business.id;
		const profId = params.professionalId;

		// No se puede eliminar un profesional con HISTORIAL (turnos o consultas clínicas):
		// son registros de la agenda y de los pacientes que hay que conservar. Se archiva.
		const [apptResult, entryResult, followUpCount] = await Promise.all([
			admin.from('appointment_professionals').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('professional_id', profId),
			admin.from('clinical_entries').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('created_by_professional_id', profId),
			professionalHasFollowUps(admin, businessId, profId)
		]);
		const apptCount = apptResult.count ?? 0;
		const entryCount = entryResult.count ?? 0;
		if (apptCount > 0 || entryCount > 0 || followUpCount > 0) {
			const parts: string[] = [];
			if (apptCount > 0) parts.push(`${apptCount} turno${apptCount === 1 ? '' : 's'}`);
			if (entryCount > 0) parts.push(`${entryCount} consulta${entryCount === 1 ? '' : 's'} clínica${entryCount === 1 ? '' : 's'}`);
			if (followUpCount > 0) parts.push(`${followUpCount} seguimiento${followUpCount === 1 ? '' : 's'}`);
			return fail(400, {
				message: `No se puede eliminar a este profesional: tiene ${parts.join(' y ')} en su historial. Archivalo para conservar esos registros.`
			});
		}

		// Limpiar los dependientes que NO son historial (se pueden borrar): invitaciones,
		// vínculo de usuario, servicios, vínculos con pacientes, reglas y excepciones.
		// Chequeamos cada paso: si algo falla, mostramos el motivo real, no un genérico.
		const steps = [
			await admin
				.from('patient_profile_change_events')
				.update({ changed_by_professional_id: null })
				.eq('business_id', businessId)
				.eq('changed_by_professional_id', profId),
			await admin.from('business_user_invites').delete().eq('business_id', businessId).eq('professional_id', profId),
			await admin.from('professional_users').delete().eq('business_id', businessId).eq('professional_id', profId),
			await admin.from('professional_services').delete().eq('business_id', businessId).eq('professional_id', profId),
			await admin.from('professional_patient_links').delete().eq('business_id', businessId).eq('professional_id', profId),
			await admin.from('availability_rules').delete().eq('business_id', businessId).eq('professional_id', profId),
			await admin.from('availability_exceptions').delete().eq('business_id', businessId).eq('professional_id', profId)
		];
		const prepError = steps.find((step) => step.error)?.error;
		if (prepError) {
			console.error('Error preparando el borrado del profesional', prepError);
			return fail(400, {
				message:
					'No se pudo eliminar el profesional en este momento. Reintentá en unos segundos o archivalo para conservar sus registros.'
			});
		}

		const { error } = await admin
			.from('professionals')
			.delete()
			.eq('business_id', businessId)
			.eq('id', profId);
		if (error) {
			console.error('Error eliminando profesional', error);
			// 23503 = FK: aún tiene registros asociados → guiar a archivar (nunca exponer el código al usuario).
			const message =
				error.code === '23503'
					? 'No se puede eliminar a este profesional porque tiene registros asociados. Archivalo para conservarlos.'
					: 'No se pudo eliminar el profesional en este momento. Reintentá en unos segundos o archivalo para conservar sus registros.';
			return fail(400, { message });
		}

		await writeAuditLog(admin, {
			businessId: business.business.id,
			userId,
			action: 'professional.deleted',
			entityType: 'professional',
			entityId: params.professionalId
		});

		throw redirect(303, '/odonto/configuracion/usuarios');
	}
};
