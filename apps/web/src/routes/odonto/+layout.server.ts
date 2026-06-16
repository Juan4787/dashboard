import { demoBusinessContext, resolveActiveBusiness } from '$lib/server/business';
import {
	createSupabaseAdminClient,
	createSupabaseServerClient,
	getAuthUserId,
	getEmailFromAccessToken,
	isMasterEmail
} from '$lib/server/supabase';
import {
	buildFollowUpScope,
	businessTodayISO,
	getNoticeSummary,
	roleParticipatesInFollowUps,
	type FollowUpNotice
} from '$lib/server/follow-ups';
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { env } from '$env/dynamic/private';

export const load: LayoutServerLoad = async ({ locals, fetch, cookies }) => {
	if (!locals.auth) {
		throw redirect(303, '/login');
	}
	if (locals.auth.module !== 'odonto') {
		// Administrativo deshabilitado por ahora.
		throw redirect(303, '/odonto/pacientes');
	}
	const email = getEmailFromAccessToken(locals.auth.access_token);
	let activeBusiness = null;
	let businessError: string | null = null;
	// Aviso interno de seguimientos ejecutándose (centro-arriba). Scopeado por rol.
	let followUps: FollowUpNotice = { count: 0, single: null };
	let followUpsTodayISO = '';

	if (env.DEMO_MODE === 'true') {
		activeBusiness = demoBusinessContext();
	} else {
		try {
			const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
			activeBusiness = await resolveActiveBusiness({
				supabase,
				accessToken: locals.auth.access_token,
				cookies
			});

			// Lectura no participa. Profesional/Dueño/Admin/Recepción sí (con scope).
			if (activeBusiness && roleParticipatesInFollowUps(activeBusiness.role)) {
				try {
					const admin = await createSupabaseAdminClient('odonto', fetch);
					const userId =
						activeBusiness.role === 'professional'
							? (await getAuthUserId(supabase, locals.auth.access_token)) ?? ''
							: '';
					const scope = await buildFollowUpScope(admin, activeBusiness, userId);
					followUps = await getNoticeSummary(admin, scope);
					followUpsTodayISO = businessTodayISO(activeBusiness.business.timezone);
				} catch (noticeErr) {
					// Degradación elegante: si la tabla aún no existe en remoto, no rompemos el layout.
					console.error('Error cargando aviso de seguimientos', noticeErr);
				}
			}
		} catch (err) {
			console.error('Error resolviendo negocio activo', err);
			businessError =
				'No se pudo cargar el negocio activo. Revisá que la migración multi-tenant esté aplicada.';
		}
	}

	return {
		module: 'odonto' as const,
		isMaster: isMasterEmail(email),
		activeBusiness,
		businessError,
		followUps,
		followUpsTodayISO
	};
};
