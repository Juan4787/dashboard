import {
	demoBusinessContext,
	isDefaultBusinessPendingManualSetupError,
	resolveActiveBusiness
} from '$lib/server/business';
import {
	createSupabaseAdminClient,
	createSupabaseServerClient,
	getAuthUserId,
	getEmailFromAccessToken,
	isMasterEmail
} from '$lib/server/supabase';
import { RateLimitExceededError } from '$lib/server/rate-limits';
import {
	buildFollowUpScope,
	businessTodayISO,
	getNoticeSummary,
	roleParticipatesInFollowUps,
	type FollowUpNotice
} from '$lib/server/follow-ups';
import {
	loadAccountAssistanceView,
	loadActiveMasterAccountAssistanceRequests,
	type AccountAssistanceView,
	type MasterAccountAssistanceRequest
} from '$lib/server/account-assistance';
import { getSubscriptionAmountArs } from '$lib/server/mercadopago';
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { env } from '$env/dynamic/private';

export const load: LayoutServerLoad = async ({
	locals,
	fetch,
	cookies,
	getClientAddress,
	url,
	depends,
	untrack
}) => {
	depends('app:odonto-shell');
	depends('app:follow-ups');
	// El shell tiene invalidaciones propias para negocio y seguimientos. Leer la
	// ruta sin registrarla evita repetir todo el layout al cambiar sólo de sección.
	const pathname = untrack(() => url.pathname);
	const auth = locals.auth;
	if (!auth) {
		throw redirect(303, '/login');
	}
	if (auth.module !== 'odonto') {
		// Administrativo deshabilitado por ahora.
		throw redirect(303, '/odonto/pacientes');
	}
	const email = getEmailFromAccessToken(auth.access_token);
	const isMaster = isMasterEmail(email);
	let activeBusiness = null;
	let businessError: string | null = null;
	let pendingManualSetup = false;
	// Aviso interno de seguimientos ejecutándose (centro-arriba). Scopeado por rol.
	let followUps: FollowUpNotice = { count: 0, single: null, dismissalKey: '0' };
	let followUpsTodayISO = '';
	let accountAssistance: AccountAssistanceView | null = null;
	let masterAssistanceRequests: MasterAccountAssistanceRequest[] = [];

	if (env.DEMO_MODE === 'true') {
		activeBusiness = demoBusinessContext();
	} else {
		try {
			const supabase = await createSupabaseServerClient('odonto', auth, fetch);
			let adminClientPromise: ReturnType<typeof createSupabaseAdminClient> | null = null;
			const getAdminClient = () =>
				(adminClientPromise ??= createSupabaseAdminClient('odonto', fetch));
			const isMasterDashboard = isMaster && pathname.startsWith('/odonto/maestro');

			// El panel maestro no consume un consultorio activo. Evitar resolverlo acá
			// elimina trabajo duplicado antes de cargar su propia vista global.
			if (!isMasterDashboard) {
				const useShortMembershipCache = [
					'/odonto/agenda',
					'/odonto/mis-turnos',
					'/odonto/pacientes',
					'/odonto/recordatorios',
					'/odonto/seguimientos',
					'/odonto/mensajes',
					'/odonto/turnos'
				].some((prefix) => pathname.startsWith(prefix));
				activeBusiness = await resolveActiveBusiness({
					supabase,
					accessToken: auth.access_token,
					cookies,
					defaultBusinessCreationIp: getClientAddress(),
					fetch,
					membershipCache: useShortMembershipCache ? 'short' : 'fresh'
				});
			}

			const [nextAccountAssistance, nextMasterRequests, nextFollowUps] = await Promise.all([
				(async (): Promise<AccountAssistanceView | null> => {
					if (
						!activeBusiness ||
						(activeBusiness.role !== 'owner' && !activeBusiness.assistance) ||
						!activeBusiness.access.canUseBusiness
					) {
						return null;
					}
					return loadAccountAssistanceView({
						supabase,
						businessId: activeBusiness.business.id,
						role: activeBusiness.role,
						timeZone: activeBusiness.business.timezone,
						canUseBusiness: activeBusiness.access.canUseBusiness,
						isAssisting: Boolean(activeBusiness.assistance)
					});
				})(),
				(async (): Promise<MasterAccountAssistanceRequest[]> => {
					if (!isMaster) return [];
					try {
						const supportUserId = await getAuthUserId(supabase, auth.access_token);
						if (supportUserId) {
							return loadActiveMasterAccountAssistanceRequests({
								admin: await getAdminClient(),
								supportUserId
							});
						}
					} catch (assistanceError) {
						console.error('Error cargando solicitudes globales de ayuda', assistanceError);
					}
					return [];
				})(),
				(async (): Promise<{ notice: FollowUpNotice; todayISO: string }> => {
					// Lectura no participa. Profesional/Dueño/Admin/Recepción sí (con scope).
					if (!activeBusiness || !roleParticipatesInFollowUps(activeBusiness.role)) {
						return { notice: { count: 0, single: null, dismissalKey: '0' }, todayISO: '' };
					}
					try {
						const admin = await getAdminClient();
						const userId =
							activeBusiness.role === 'professional'
								? (await getAuthUserId(supabase, auth.access_token)) ?? ''
								: '';
						const scope = await buildFollowUpScope(admin, activeBusiness, userId);
						return {
							notice: await getNoticeSummary(admin, scope),
							todayISO: businessTodayISO(activeBusiness.business.timezone)
						};
					} catch (noticeErr) {
						// Degradación elegante: si la tabla aún no existe en remoto, no rompemos el layout.
						console.error('Error cargando aviso de seguimientos', noticeErr);
						return { notice: { count: 0, single: null, dismissalKey: '0' }, todayISO: '' };
					}
				})()
			]);
			accountAssistance = nextAccountAssistance;
			masterAssistanceRequests = nextMasterRequests;
			followUps = nextFollowUps.notice;
			followUpsTodayISO = nextFollowUps.todayISO;
		} catch (err) {
			if (isDefaultBusinessPendingManualSetupError(err)) {
				pendingManualSetup = true;
			} else if (err instanceof RateLimitExceededError) {
				businessError = err.userMessage;
			} else {
				console.error('Error resolviendo negocio activo', err);
				businessError =
					'No pudimos cargar el consultorio activo. Recargá la página; si continúa, contactá a soporte.';
			}
		}
	}

	return {
		module: 'odonto' as const,
		isMaster,
		email,
		activeBusiness,
		businessError,
		pendingManualSetup,
		accountAssistance,
		masterAssistanceRequests,
		followUps,
		followUpsTodayISO,
		mpAmount: getSubscriptionAmountArs()
	};
};
