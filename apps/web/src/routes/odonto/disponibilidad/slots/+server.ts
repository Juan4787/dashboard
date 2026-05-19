import { env } from '$env/dynamic/private';
import { getAvailabilitySlots, groupSlotsByDate } from '$lib/server/availability';
import { getOdontoContext } from '$lib/server/odonto-context';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export const GET: RequestHandler = async ({ url, locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') return json({ days: {}, slots: [] });

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	const serviceId = url.searchParams.get('service_id') ?? '';
	const professionalId = url.searchParams.get('professional_id') ?? '';
	const fromDate = url.searchParams.get('from') ?? isoDate(new Date());
	const toDate = url.searchParams.get('to') ?? fromDate;
	const publicOnly = url.searchParams.get('public') === 'true';

	if (!serviceId) {
		return json({ message: 'service_id es obligatorio.' }, { status: 400 });
	}

	try {
		const slots = await getAvailabilitySlots(supabase, {
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
