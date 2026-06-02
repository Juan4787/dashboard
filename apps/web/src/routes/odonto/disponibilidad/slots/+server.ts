import { env } from '$env/dynamic/private';
import { getAvailabilitySlots, groupSlotsByDate } from '$lib/server/availability';
import { getOdontoContext } from '$lib/server/odonto-context';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const localDateFor = (date: Date, timeZone: string) => {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		})
			.formatToParts(date)
			.map((part) => [part.type, part.value])
	);
	return `${parts.year}-${parts.month}-${parts.day}`;
};

export const GET: RequestHandler = async ({ url, locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') return json({ days: {}, slots: [] });

	const { business } = await getOdontoContext({ locals, fetch, cookies });
	const serviceId = url.searchParams.get('service_id') ?? '';
	const professionalId = url.searchParams.get('professional_id') ?? '';
	const fromDate = url.searchParams.get('from') ?? localDateFor(new Date(), business.business.timezone);
	const toDate = url.searchParams.get('to') ?? fromDate;
	const publicOnly = url.searchParams.get('public') === 'true';

	if (!business.capabilities.canCreateAppointment && !business.capabilities.canRescheduleAppointment) {
		return json({ message: 'No tenés permiso para consultar disponibilidad.' }, { status: 403 });
	}

	if (!serviceId) {
		return json({ message: 'service_id es obligatorio.' }, { status: 400 });
	}

	try {
		const admin = await createSupabaseAdminClient('odonto', fetch);
		const slots = await getAvailabilitySlots(admin, {
			business: business.business,
			serviceId,
			professionalId,
			fromDate,
			toDate,
			publicOnly
		});
		return json({ slots, days: groupSlotsByDate(slots) });
	} catch (error) {
		console.error('Error calculando slots', error);
		return json({ message: 'No se pudo calcular disponibilidad.' }, { status: 500 });
	}
};
