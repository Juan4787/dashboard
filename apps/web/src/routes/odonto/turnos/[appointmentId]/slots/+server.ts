import { env } from '$env/dynamic/private';
import { getAvailabilitySlots } from '$lib/server/availability';
import { getOdontoContext } from '$lib/server/odonto-context';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const todayForTimezone = (timeZone: string) => {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
			.formatToParts(new Date())
			.map((part) => [part.type, part.value])
	);
	return `${parts.year}-${parts.month}-${parts.day}`;
};

// Horarios reales disponibles del profesional del turno para una fecha, excluyendo
// el propio turno del cálculo (si no, el turno se bloquearía a sí mismo).
export const GET: RequestHandler = async ({ params, url, locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') return json({ slots: [] });

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	if (!business.canOperate) {
		return json({ message: 'No tenés permiso para reprogramar turnos.', slots: [] }, { status: 403 });
	}

	const date = url.searchParams.get('date') ?? '';
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		return json({ message: 'Fecha inválida.', slots: [] }, { status: 400 });
	}
	if (date < todayForTimezone(business.business.timezone)) {
		return json({ slots: [] });
	}

	const { data: appointment, error } = await supabase
		.from('appointments')
		.select('id, service_id, professional_id, status')
		.eq('business_id', business.business.id)
		.eq('id', params.appointmentId)
		.maybeSingle();

	if (error) {
		console.error('Error cargando turno para slots de reprogramación', error);
		return json({ message: 'No se pudo cargar el turno.', slots: [] }, { status: 500 });
	}
	if (!appointment) return json({ message: 'Turno no encontrado.', slots: [] }, { status: 404 });
	if (['cancelled', 'attended', 'no_show'].includes(appointment.status)) {
		return json({ slots: [] });
	}

	try {
		const slots = await getAvailabilitySlots(supabase, {
			business: business.business,
			serviceId: appointment.service_id,
			professionalId: appointment.professional_id,
			fromDate: date,
			toDate: date,
			publicOnly: false,
			excludeAppointmentId: appointment.id
		});
		return json({ slots });
	} catch (err) {
		console.error('Error calculando slots de reprogramación', err);
		return json({ message: 'No se pudo calcular la disponibilidad.', slots: [] }, { status: 500 });
	}
};
