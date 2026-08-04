<script lang="ts">
	import { onMount } from 'svelte';
	import { formatDateTime, formatInTimeZone } from '$lib/utils/format';
	import {
		refineDeviceClass,
		type DeviceClass
	} from '$lib/device';

	let { data, form } = $props<{
		data: {
			appointment: any;
			message: string;
			created: boolean;
			suggestedAction: string;
			demo: boolean;
			device: DeviceClass;
			isSoon: boolean;
			vapidPublicKey: string | null;
			publicSiteUrl: string;
			googleCalendar: {
				available: boolean;
				state:
					| 'none'
					| 'preparing'
					| 'active'
					| 'updating'
					| 'removing'
					| 'removed'
					| 'needs_reconnect'
					| 'failed';
				current: boolean;
				reminderLabel: string;
			};
			calendarMessage: string | null;
		};
		form?: { success?: boolean; message?: string };
	}>();

	const appointment = $derived(data.appointment);

	// El server clasifica por User-Agent; acá solo se corrige el iPad que se
	// presenta como Mac (invisible para el UA, detectable por touch).
	let refinedDevice = $state<DeviceClass | null>(null);
	const device = $derived(refinedDevice ?? data.device);

	// Push secundario: solo con soporte real, nunca en iOS (requeriría instalar la web
	// app en el home), y el permiso se pide recién al tocar el botón.
	type PushState =
		| 'unavailable'
		| 'unsupported'
		| 'idle'
		| 'working'
		| 'repairing'
		| 'configured'
		| 'test_waiting'
		| 'test_question'
		| 'subscribed'
		| 'needs_device_check'
		| 'denied'
		| 'awaiting_permission'
		| 'error';
	// El CTA existe desde el primer HTML de Android. Al hidratar, el navegador
	// confirma si Push API está disponible y, si no lo está, pasa al calendario.
	let pushState = $state<PushState>('unavailable');
	const renderedPushState = $derived<PushState>(
		pushState === 'unavailable' && data.device === 'android'
			? data.vapidPublicKey
				? 'idle'
				: 'unsupported'
			: pushState
	);
	type PushDelivery = {
		deliveryId: string;
		state:
			| 'pending'
			| 'accepted'
			| 'received'
			| 'displayed'
			| 'confirmed'
			| 'missing'
			| 'superseded'
			| 'failed'
			| 'expired';
		kind: 'test' | '24h' | '2h' | 'reschedule';
		createdAt: string;
		expiresAt: string;
	};
	type PushResponse = {
		ok?: boolean;
		code?: string;
		message?: string;
		delivery?: PushDelivery | null;
		verificationAvailable?: boolean;
	};
	let activeTestDeliveryId = $state<string | null>(null);
	let activeTestCreatedAt = $state<string | null>(null);
	let pushMessage = $state('');
	let pollRun = 0;
	let recoveryRun = 0;
	let automaticRepairAttempts = 0;
	let mounted = false;
	let notificationPermissionStatus: PermissionStatus | null = null;

	const base = $derived(appointment ? `/turno/${appointment.token}` : '');

	const savePushSubscriptionForAppointment = async (
		subscription: PushSubscription,
		requestTest: boolean
	) => {
		if (!base) return null;
		const response = await fetch(`${base}/push`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ subscription: subscription.toJSON(), test: requestTest })
		});
		let body: PushResponse = {};
		try {
			body = await response.json();
		} catch {
			body = {};
		}
		return { response, body };
	};

	const urlBase64ToUint8Array = (base64: string) => {
		const padding = '='.repeat((4 - (base64.length % 4)) % 4);
		const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
		return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
	};

	const sameApplicationServerKey = (
		actual: ArrayBuffer | null,
		expected: Uint8Array<ArrayBuffer>
	) => {
		if (!actual) return true;
		const current = new Uint8Array(actual);
		return current.length === expected.length && current.every((byte, index) => byte === expected[index]);
	};

	// Soporte real de push (se fija en onMount; nunca en iOS).
	let pushSupported = $state(false);
	// Candado anti-reentrada: requestPermission y visibilitychange pueden disparar el
	// alta a la vez. El upsert del backend es idempotente, pero evitamos subscribe() dobles.
	let syncing = $state(false);

	const waitForPushWorkerActivation = async (registration: ServiceWorkerRegistration) => {
		const worker = registration.installing ?? registration.waiting;
		if (!worker || worker.state === 'activated') return;
		await new Promise<void>((resolve) => {
			let done = false;
			const finish = () => {
				if (done) return;
				done = true;
				clearTimeout(timeout);
				worker.removeEventListener('statechange', onStateChange);
				navigator.serviceWorker.removeEventListener('controllerchange', finish);
				resolve();
			};
			const onStateChange = () => {
				if (worker.state === 'activated' || worker.state === 'redundant') finish();
			};
			const timeout = setTimeout(finish, 5000);
			worker.addEventListener('statechange', onStateChange);
			navigator.serviceWorker.addEventListener('controllerchange', finish);
			onStateChange();
		});
	};

	const applyDelivery = (delivery: PushDelivery) => {
		activeTestDeliveryId = delivery.deliveryId;
		activeTestCreatedAt = delivery.createdAt;
		if (delivery.state === 'confirmed') {
			automaticRepairAttempts = 0;
			pushState = 'subscribed';
			pushMessage = '';
			return true;
		}
		if (delivery.state === 'displayed') {
			pushState = 'test_question';
			pushMessage = '';
			return true;
		}
		if (
			delivery.state === 'missing' ||
			delivery.state === 'superseded' ||
			delivery.state === 'failed' ||
			delivery.state === 'expired'
		) {
			pushState = 'needs_device_check';
			pushMessage = '';
			return true;
		}
		pushState = 'test_waiting';
		return false;
	};

	const deliveryCanRepairAutomatically = (delivery: PushDelivery) =>
		delivery.state === 'failed' ||
		delivery.state === 'expired' ||
		delivery.state === 'superseded';

	const readDelivery = async (deliveryId: string) => {
		if (!base) return null;
		try {
			const response = await fetch(
				`${base}/push?delivery_id=${encodeURIComponent(deliveryId)}`,
				{ cache: 'no-store' }
			);
			if (!response.ok) return null;
			const body = (await response.json()) as PushResponse;
			return body.delivery ?? null;
		} catch {
			return null;
		}
	};

	const pollTestDelivery = async (deliveryId: string) => {
		const run = ++pollRun;
		for (let attempt = 0; attempt < 15; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			if (run !== pollRun || !base) return;
			try {
				const delivery = await readDelivery(deliveryId);
				if (delivery && applyDelivery(delivery)) {
					if (deliveryCanRepairAutomatically(delivery)) {
						void repairPushAutomatically(delivery, false);
					}
					return;
				}
				// El recibo automático mejora la observabilidad, pero no debe retener a la
				// persona: después de unos segundos le preguntamos directamente si vio la
				// prueba, aunque Android no haya informado el evento "displayed".
				if (attempt >= 4 && activeTestDeliveryId === deliveryId) {
					pushState = 'test_question';
					pushMessage = '';
					return;
				}
			} catch {
				// El sondeo es best-effort; el próximo intento puede recuperar la conexión.
			}
		}
		if (run === pollRun && pushState === 'test_waiting') {
			void repairPushAutomatically(
				{
					deliveryId,
					state: 'accepted',
					kind: 'test',
					createdAt: activeTestCreatedAt ?? new Date().toISOString(),
					expiresAt: new Date(Date.now() + 60_000).toISOString()
				},
				true
			);
		}
	};

	const useSaveResult = (result: Awaited<ReturnType<typeof savePushSubscriptionForAppointment>>) => {
		if (!result?.response.ok) {
			pushMessage = result?.body.message || 'No pudimos activar las notificaciones. Volvé a intentar.';
			return false;
		}
		if (result.body.delivery) {
			const terminal = applyDelivery(result.body.delivery);
			if (!terminal) void pollTestDelivery(result.body.delivery.deliveryId);
			else if (deliveryCanRepairAutomatically(result.body.delivery)) {
				void repairPushAutomatically(result.body.delivery, false);
			}
		} else {
			activeTestDeliveryId = null;
			pushState = 'configured';
		}
		return true;
	};

	// Requiere el permiso YA concedido: registra el SW, suscribe (o recupera) y guarda el
	// endpoint contra el turno actual.
	const syncPushSubscription = async (requestTest: boolean, recovering = false) => {
		if (!data.vapidPublicKey || syncing) return;
		pollRun += 1;
		syncing = true;
		pushState = recovering ? 'repairing' : 'working';
		pushMessage = '';
		let retryAutomatically = false;
		try {
			const registration = await navigator.serviceWorker.register('/push-sw.js', {
				updateViaCache: 'none'
			});
			try {
				await registration.update();
			} catch {
				// La copia activa todavía puede funcionar. El test inmediato decide el resultado.
			}
			await Promise.all([navigator.serviceWorker.ready, waitForPushWorkerActivation(registration)]);
			const expectedKey = urlBase64ToUint8Array(data.vapidPublicKey);
			let subscription = await registration.pushManager.getSubscription();
			if (
				subscription &&
				!sameApplicationServerKey(subscription.options.applicationServerKey, expectedKey)
			) {
				// Si el servidor rotó sus claves, la suscripción anterior nunca podrá recibir.
				await subscription.unsubscribe();
				subscription = null;
			}
			subscription ??= await registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: expectedKey
				});
			let result = await savePushSubscriptionForAppointment(subscription, requestTest);
			if (requestTest && result?.response.status === 410) {
				await subscription.unsubscribe();
				subscription = await registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: urlBase64ToUint8Array(data.vapidPublicKey)
				});
				result = await savePushSubscriptionForAppointment(subscription, true);
			}
			if (!useSaveResult(result)) {
				if (requestTest && !recovering && automaticRepairAttempts === 0) {
					retryAutomatically = true;
				} else {
					pushState = recovering ? 'needs_device_check' : 'error';
					if (recovering) pushMessage = '';
				}
			}
		} catch {
			pushMessage ||= 'El teléfono no pudo completar la activación.';
			if (requestTest && !recovering && automaticRepairAttempts === 0) {
				retryAutomatically = true;
			} else {
				pushState = recovering ? 'needs_device_check' : 'error';
				if (recovering) pushMessage = '';
			}
		} finally {
			syncing = false;
			if (retryAutomatically) {
				void repairPushAutomatically(null, false);
			}
		}
	};

	const repairPushAutomatically = async (
		delivery: PushDelivery | null,
		waitForPreviousTest: boolean
	) => {
		if (!mounted || Notification.permission !== 'granted') {
			pushState = Notification.permission === 'denied' ? 'denied' : 'awaiting_permission';
			return;
		}
		if (automaticRepairAttempts >= 1) {
			pushState = 'needs_device_check';
			pushMessage = '';
			return;
		}
		automaticRepairAttempts += 1;
		const run = ++recoveryRun;
		pushState = 'repairing';
		pushMessage = '';

		// El servidor evita pruebas duplicadas durante 30 segundos. Esperamos ese límite
		// sin pedir ninguna acción y comprobamos una vez más antes de reenviar.
		const createdAt = delivery?.createdAt ? new Date(delivery.createdAt).getTime() : Date.now();
		const delay = waitForPreviousTest
			? Math.max(1000, 31_000 - Math.max(0, Date.now() - createdAt))
			: 1500;
		await new Promise((resolve) => setTimeout(resolve, delay));
		if (run !== recoveryRun || !mounted) return;

		if (delivery?.deliveryId) {
			const latest = await readDelivery(delivery.deliveryId);
			if (latest && ['displayed', 'confirmed'].includes(latest.state)) {
				applyDelivery(latest);
				return;
			}
			if (latest?.state === 'missing') {
				applyDelivery(latest);
				return;
			}
		}

		await syncPushSubscription(true, true);
	};

	const enablePush = async () => {
		if (!data.vapidPublicKey || syncing) return;
		automaticRepairAttempts = 0;
		recoveryRun += 1;
		pushState = 'working';
		pushMessage = '';
		try {
			const permission = await Notification.requestPermission();
			if (permission === 'granted') {
				await syncPushSubscription(true);
			} else if (permission === 'denied') {
				// Bloqueo real del navegador. Si lo desbloquea en Configuración y vuelve,
				// el visibilitychange lo detecta y activa los avisos igual.
				pushState = 'denied';
			} else {
				// 'default': no resolvió acá (p. ej. Android lo derivó a Configuración).
				// NO es un bloqueo: esperamos a que vuelva a la pantalla.
				pushState = 'awaiting_permission';
			}
		} catch {
			pushMessage = 'No pudimos pedir el permiso de notificaciones. Volvé a intentar.';
			pushState = 'error';
		}
	};

	const submitTestFeedback = async (visible: boolean) => {
		if (!base || !activeTestDeliveryId || syncing) return;
		syncing = true;
		pushMessage = '';
		try {
			const response = await fetch(`${base}/push`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ deliveryId: activeTestDeliveryId, visible })
			});
			const body = (await response.json().catch(() => ({}))) as PushResponse;
			if (!response.ok || !body.delivery) {
				pushMessage = body.message || 'No pudimos guardar tu respuesta. Volvé a intentar.';
				return;
			}
			applyDelivery(body.delivery);
		} catch {
			pushMessage = 'No pudimos guardar tu respuesta. Volvé a intentar.';
		} finally {
			syncing = false;
		}
	};

	const retryPushTest = async () => {
		automaticRepairAttempts = 0;
		recoveryRun += 1;
		if (Notification.permission === 'granted') {
			await syncPushSubscription(true, true);
			return;
		}
		await enablePush();
	};

	const continueAfterPermissionChange = () => {
		if (!pushSupported || syncing) return;
		if (Notification.permission === 'denied') {
			pushState = 'denied';
			return;
		}
		if (Notification.permission === 'default') {
			if (pushState === 'denied') pushState = 'awaiting_permission';
			return;
		}
		if (
			pushState === 'awaiting_permission' ||
			pushState === 'denied'
		) {
			automaticRepairAttempts = 0;
			void syncPushSubscription(true, true);
		}
	};

	onMount(() => {
		mounted = true;
		refinedDevice = refineDeviceClass(data.device, navigator);
		const effective = refinedDevice ?? data.device;
		pushSupported = Boolean(
			data.vapidPublicKey &&
				effective !== 'ios' &&
				typeof navigator.serviceWorker !== 'undefined' &&
				typeof window.PushManager !== 'undefined' &&
				typeof window.Notification !== 'undefined'
		);
		if (!pushSupported) {
			if (effective === 'android') pushState = 'unsupported';
			return;
		}

		if (Notification.permission === 'denied') {
			// No se reutiliza una suscripción histórica cuando el permiso actual está
			// bloqueado: eso volvería a presentar como "verificado" un teléfono incapaz
			// de mostrar avisos.
			pushState = 'denied';
		} else {
			pushState = 'idle';
			// Recupera una suscripción ya existente del navegador (de un turno anterior) y la
			// asocia a este turno: la tabla es (appointment_id, endpoint).
			void (async () => {
				try {
					const registration = await navigator.serviceWorker.getRegistration('/push-sw.js');
					const subscription = await registration?.pushManager.getSubscription();
					if (subscription && pushState === 'idle' && !syncing) {
						syncing = true;
						const result = await savePushSubscriptionForAppointment(subscription, false);
						if (!useSaveResult(result)) pushState = 'error';
						syncing = false;
					}
				} catch {
					syncing = false;
					// se queda en idle: el botón sigue disponible
				}
			})();
		}

		// Núcleo del fix de UX: al volver a la pantalla (tras conceder el permiso en
		// Configuración) reconsultamos el estado REAL y activamos los avisos. También
		// recupera de un 'denied' previo si el usuario lo desbloqueó.
		const onVisible = () => {
			if (document.visibilityState !== 'visible' || syncing) return;
			continueAfterPermissionChange();
		};
		document.addEventListener('visibilitychange', onVisible);
		void navigator.permissions
			?.query({ name: 'notifications' as PermissionName })
			.then((status) => {
				if (!mounted) return;
				notificationPermissionStatus = status;
				status.addEventListener('change', continueAfterPermissionChange);
			})
			.catch(() => {
				// visibilitychange mantiene el mismo comportamiento en navegadores sin Permissions API.
			});
		return () => {
			mounted = false;
			pollRun += 1;
			recoveryRun += 1;
			document.removeEventListener('visibilitychange', onVisible);
			notificationPermissionStatus?.removeEventListener('change', continueAfterPermissionChange);
		};
	});

	const timezone = $derived(appointment?.business?.timezone ?? 'America/Argentina/Cordoba');
	const whenLabels = $derived(
		appointment ? formatInTimeZone(appointment.starts_at, timezone) : null
	);

	const ACTIVE_STATUSES = ['reserved', 'confirmed', 'reschedule_requested'];
	const isActive = $derived(
		Boolean(appointment) && !appointment.is_past && ACTIVE_STATUSES.includes(appointment.status)
	);
	const isCancelled = $derived(appointment?.status === 'cancelled');
	const hasCalendarAction = $derived(
		Boolean(appointment) &&
			['clicked_google', 'clicked_ics', 'downloaded_ics', 'clicked_outlook', 'clicked_phone_calendar', 'synced_google'].includes(
				appointment.calendar_action_status
			)
	);
	const managedGoogleCalendar = $derived(device === 'android' && data.googleCalendar.available);
	const googleCalendarIsUpdating = $derived(data.googleCalendar.state === 'updating');
	const googleCalendarIsCurrent = $derived(
		data.googleCalendar.state === 'active' && data.googleCalendar.current
	);
	const googleCalendarHasVisibleStatus = $derived(
		managedGoogleCalendar &&
			['active', 'preparing', 'updating', 'removing'].includes(data.googleCalendar.state)
	);
	const pushReminderIsActive = $derived(renderedPushState === 'subscribed');
	const showAndroidCalendarFallback = $derived(
		device === 'android' &&
		(
			['unsupported', 'needs_device_check', 'denied', 'awaiting_permission', 'error'].includes(
				renderedPushState
			) ||
			data.googleCalendar.state === 'needs_reconnect' ||
			data.googleCalendar.state === 'failed'
		)
	);
	const googleCalendarConnectHref = (target: 'samsung' | 'google') => {
		const query = new URLSearchParams({ target });
		if (data.googleCalendar.state === 'needs_reconnect') query.set('reauthorize', '1');
		return `${base}/google-calendar/connect?${query.toString()}`;
	};
	const needsCalendarUpdate = $derived(
		Boolean(appointment?.calendar_update_required_at) &&
		!googleCalendarIsUpdating &&
		!googleCalendarIsCurrent
	);

	// FASE 12 — copy del push por proximidad, espejo de las ventanas reales del job
	// (24h y 2h): no se promete un aviso cuya ventana ya pasó.
	const pushWindowsLabel = $derived.by(() => {
		if (!appointment) return 'antes del turno';
		const hoursUntil = (new Date(appointment.starts_at).getTime() - Date.now()) / 3_600_000;
		if (hoursUntil > 24) return '24 horas y 2 horas antes del turno';
		if (hoursUntil > 2) return 'durante el día previo y 2 horas antes del turno';
		return 'en los próximos minutos';
	});

	const reminderTitle = $derived(
		pushReminderIsActive || googleCalendarIsCurrent
			? 'Recordatorio activado'
			: googleCalendarIsUpdating
				? 'Actualizando tu recordatorio'
				: data.googleCalendar.state === 'preparing'
					? 'Activando tu recordatorio'
					: needsCalendarUpdate
						? 'Actualizá el calendario'
						: 'Último paso: activá el recordatorio'
	);
	const reminderIntro = $derived(
		pushReminderIsActive
			? `Este teléfono ya está listo para avisarte ${pushWindowsLabel}.`
			: googleCalendarIsCurrent
			? `El turno está guardado en tu cuenta Google con avisos ${data.googleCalendar.reminderLabel}. Si cambia el horario, lo actualizamos automáticamente.`
			: googleCalendarIsUpdating
				? 'Ya estamos pasando la nueva fecha y hora al mismo evento. No tenés que volver a agregarlo.'
				: data.googleCalendar.state === 'preparing'
					? 'Estamos creando el evento con su horario y sus avisos. Esta pantalla se actualiza al volver a abrirla.'
					: data.googleCalendar.state === 'needs_reconnect'
						? 'Elegí nuevamente tu cuenta Google para mantener el turno y sus avisos actualizados.'
						: needsCalendarUpdate
							? 'El turno cambió de fecha. Actualizá el calendario para conservar el horario correcto.'
						: showAndroidCalendarFallback
							? 'Elegí el calendario que usa tu teléfono y dejamos el turno guardado con sus avisos.'
							: device === 'android'
								? 'Activá el recordatorio y comprobamos ahora mismo que este teléfono pueda avisarte.'
								: device === 'ios'
									? 'Agregá el turno al calendario del iPhone para recibir el recordatorio.'
									: 'Agregá el turno a tu calendario para recibir avisos antes y tener la dirección a mano.'
	);
	const calendarSummaryClass = $derived.by(() => {
		if (managedGoogleCalendar) return 'ux-btn-secondary';
		// Reprogramación: actualizar el calendario ES la tarea → CTA enfatizado.
		if (needsCalendarUpdate) return 'ux-btn-primary ux-btn-cta';
		// En Android el push es el CTA principal; el calendario queda secundario.
		if (device === 'android') return 'ux-btn-secondary';
		// En iOS no hay push: el calendario es el CTA principal → enfatizado.
		if (device === 'ios') return 'ux-btn-primary ux-btn-cta';
		return 'ux-btn-primary';
	});

	type CalendarOption = { label: string; href: string; hint?: string };
	const calendarOptions = $derived.by((): CalendarOption[] => {
		if (!appointment) return [];
		if (device === 'desktop') {
			return [
				{ label: 'Google Calendar', href: `${base}/ir/google`, hint: 'Recomendado' },
				{ label: 'Outlook', href: `${base}/ir/outlook` },
				{ label: 'Descargar calendario', href: `${base}/calendario-descargar.ics` }
			];
		}
		return [
			{ label: 'Agregar al calendario', href: `${base}/calendario.ics`, hint: 'Recomendado' },
			{ label: 'Google Calendar', href: `${base}/ir/google` }
		];
	});

	const copyDetailsText = $derived.by(() => {
		if (!appointment || !whenLabels) return '';
		const lines = [
			'Tenés un turno reservado.',
			'',
			`Fecha: ${whenLabels.dateLabel}`,
			`Hora local del consultorio: ${whenLabels.timeLabel}`,
			`${appointment.is_joint ? 'Equipo profesional' : 'Profesional'}: ${appointment.professional_name_snapshot}`,
			`Consultorio: ${appointment.business.name}`
		];
		if (appointment.business.address) lines.push(`Dirección: ${appointment.business.address}`);
		if (appointment.business.address_instructions) {
			lines.push(`Indicaciones: ${appointment.business.address_instructions}`);
		}
		if (appointment.business.maps_link) lines.push(`Cómo llegar: ${appointment.business.maps_link}`);
		lines.push(`Ver turno: ${data.publicSiteUrl}${base}`);
		return lines.join('\n');
	});

	let copied = $state(false);
	const copyDetails = async () => {
		try {
			await navigator.clipboard.writeText(copyDetailsText);
			copied = true;
			setTimeout(() => (copied = false), 2500);
		} catch {
			copied = false;
		}
	};
</script>

{#snippet pushBlock(primary: boolean)}
	{#if renderedPushState !== 'unavailable'}
		<div class="mt-5">
			{#if renderedPushState === 'subscribed'}
				<div class="ux-alert ux-alert-success" aria-live="polite">
					<p class="font-extrabold text-white">Notificación confirmada</p>
					<p class="mt-1">La notificación de prueba llegó. Te avisamos {pushWindowsLabel}.</p>
				</div>
			{:else if renderedPushState === 'repairing'}
				<div class="ux-alert" aria-live="polite">
					<div class="flex items-start gap-3">
						<svg viewBox="0 0 24 24" aria-hidden="true" class="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[#a78bfa]">
							<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
							<path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
						</svg>
						<div>
							<p class="font-bold text-white">Estamos preparando tu recordatorio.</p>
							<p class="mt-1">La activación continúa automáticamente. En un momento vas a recibir la prueba.</p>
						</div>
					</div>
				</div>
			{:else if renderedPushState === 'configured'}
				<button
					type="button"
					class={primary ? 'ux-btn-primary ux-btn-cta w-full whitespace-nowrap px-3 text-[1.075rem] font-extrabold' : 'ux-btn-secondary w-full whitespace-nowrap px-3 text-[1.075rem] font-extrabold'}
					onclick={retryPushTest}
				>
					🔔 Activar recordatorio
				</button>
				<p class="mt-3 text-center text-xs leading-relaxed text-white/45">
					Enviamos una prueba real para confirmar que el teléfono pueda avisarte.
				</p>
			{:else if renderedPushState === 'test_waiting'}
				<div class="ux-alert" aria-live="polite">
					<p class="font-bold text-white">Notificación de prueba enviada</p>
					<p class="mt-1">Estamos comprobando que este teléfono pueda mostrarla…</p>
				</div>
			{:else if renderedPushState === 'test_question'}
				<div class="ux-alert ux-alert-success" aria-live="polite">
					<p class="font-extrabold text-white">¿Recibiste la notificación de prueba?</p>
					<p class="mt-1">Revisá las notificaciones del teléfono y confirmalo acá.</p>
				</div>
				<div class="mt-3 grid grid-cols-2 gap-3">
					<button
						type="button"
						class="ux-btn-primary w-full"
						disabled={syncing}
						onclick={() => submitTestFeedback(true)}
					>
						Sí, la recibí
					</button>
					<button
						type="button"
						class="ux-btn-secondary w-full"
						disabled={syncing}
						onclick={() => submitTestFeedback(false)}
					>
						No la recibí
					</button>
				</div>
			{:else if ['unsupported', 'needs_device_check', 'denied', 'awaiting_permission', 'error'].includes(renderedPushState)}
				<p class="sr-only" aria-live="polite">
					La activación continúa con las opciones de calendario disponibles a continuación.
				</p>
			{:else}
				<button
					type="button"
					class={primary ? 'ux-btn-primary ux-btn-cta w-full whitespace-nowrap px-3 text-[1.075rem] font-extrabold' : 'ux-btn-secondary w-full whitespace-nowrap px-3 text-[1.075rem] font-extrabold'}
					disabled={renderedPushState === 'working'}
					onclick={enablePush}
				>
					{renderedPushState === 'working' ? 'Activando…' : '🔔 Activar recordatorio'}
				</button>
				<p class="mt-3 text-center text-xs leading-relaxed text-white/45">
					Enviamos una prueba real antes de dejarlo activado.
				</p>
			{/if}
			{#if pushMessage && !['error', 'denied', 'awaiting_permission'].includes(renderedPushState)}
				<p class="ux-empty mt-2">{pushMessage}</p>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet googleCalendarBlock()}
	{#if managedGoogleCalendar}
		<div class="mt-5" aria-live="polite">
			{#if data.googleCalendar.state === 'active'}
				<div class="ux-alert ux-alert-success">
					<div class="flex items-start gap-3">
						<svg viewBox="0 0 24 24" aria-hidden="true" class="mt-0.5 h-5 w-5 shrink-0 text-emerald-300">
							<rect x="3.5" y="5" width="17" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="1.8" />
							<path d="M7.5 3.5v3M16.5 3.5v3M4 9h16M8 14l2.2 2.2L16 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
						<div>
							<p class="font-bold text-white">Recordatorio guardado en tu calendario</p>
							<p class="mt-1">Avisos {data.googleCalendar.reminderLabel}. Si cambia el horario, actualizamos el mismo evento automáticamente.</p>
						</div>
					</div>
				</div>
				<details class="mt-2 rounded-2xl border border-white/10 bg-white/[0.02]">
					<summary class="cursor-pointer list-none px-4 py-3 text-center text-xs font-bold text-white/55">
						Administrar calendario
					</summary>
					<form method="POST" action="?/remove_google_calendar" class="border-t border-white/10 p-3">
						<button class="ux-btn-secondary w-full text-sm">Quitar de mi cuenta Google</button>
					</form>
				</details>
			{:else if data.googleCalendar.state === 'preparing' || data.googleCalendar.state === 'updating' || data.googleCalendar.state === 'removing'}
				<div class="ux-alert">
					<div class="flex items-start gap-3">
						<svg viewBox="0 0 24 24" aria-hidden="true" class="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[#a78bfa]">
							<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
							<path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
						</svg>
						<div>
							<p class="font-bold text-white">
								{data.googleCalendar.state === 'updating'
									? 'Actualizando fecha y hora'
									: data.googleCalendar.state === 'removing'
										? 'Quitando el evento'
										: 'Guardando el turno'}
							</p>
							<p class="mt-1">El proceso continúa automáticamente; no hace falta repetir la acción.</p>
						</div>
					</div>
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet androidCalendarFallback()}
	{#if showAndroidCalendarFallback}
		<div class="mt-5 space-y-4" aria-live="polite">
			{#if managedGoogleCalendar}
				<div class="rounded-2xl border border-violet-400/25 bg-violet-400/[0.055] p-5">
					<p class="text-base font-extrabold text-white">¿Tu teléfono es Samsung?</p>
					<a
						href={googleCalendarConnectHref('samsung')}
						class="ux-btn-primary mt-4 block w-full px-2 text-center text-sm font-extrabold leading-tight"
					>
						Agregar a Calendario Samsung
					</a>
					<p class="mt-3 text-center text-xs leading-relaxed text-white/50">
						Lo guardamos con avisos en la cuenta Google que Calendario Samsung sincroniza.
					</p>
				</div>

				<div class="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
					<p class="text-base font-extrabold text-white">¿Usás otro teléfono Android?</p>
					<a
						href={googleCalendarConnectHref('google')}
						class="ux-btn-secondary mt-4 block w-full px-2 text-center text-sm font-extrabold leading-tight"
					>
						Agregar a Google Calendar
					</a>
					<p class="mt-3 text-center text-xs leading-relaxed text-white/50">
						Queda guardado con avisos y se actualiza solo si cambia el turno.
					</p>
				</div>
				<p class="text-center text-xs text-white/40">
					<a href="/privacidad" target="_blank" rel="noreferrer" class="underline">Cómo usamos Google Calendar</a>
				</p>
			{:else}
				<div class="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
					<p class="text-base font-extrabold text-white">¿Usás Google Calendar?</p>
					<a
						href={`${base}/ir/google`}
						class="ux-btn-secondary mt-3 block w-full text-center font-extrabold"
					>
						Agregar a Google Calendar
					</a>
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet locationCard()}
	<section class="ux-card">
		{#if data.isSoon}
			<p class="ux-badge ux-badge-warning">Tu turno es pronto</p>
			<h2 class="ux-section-title mt-3">Revisá la dirección ahora</h2>
		{:else}
			<h2 class="ux-section-title">Dónde es</h2>
		{/if}
		<p class="mt-4 text-lg font-bold text-white">📍 {appointment.business.address}</p>
		{#if appointment.business.address_instructions}
			<p class="mt-2 text-sm text-white/70">{appointment.business.address_instructions}</p>
		{/if}
		{#if appointment.business.maps_link}
			<a href={`${base}/ir/maps`} target="_blank" rel="noreferrer" class="ux-btn-primary mt-5 block w-full text-center">
				Cómo llegar
			</a>
		{/if}
	</section>
{/snippet}

{#snippet reminderCard()}
	<section class="ux-card">
		<h2 class="text-2xl font-extrabold leading-tight tracking-tight text-white sm:text-[1.7rem]">
			{reminderTitle}
		</h2>
		<p class="mt-3 text-sm leading-relaxed text-white/70">{reminderIntro}</p>

		{#if device === 'android'}
			{#if googleCalendarHasVisibleStatus}
				{@render googleCalendarBlock()}
			{:else}
				{@render pushBlock(true)}
				{@render androidCalendarFallback()}
			{/if}
		{:else if device === 'ios'}
			<a
				href={`${base}/calendario.ics?p=phone`}
				class="ux-btn-primary ux-btn-cta mt-5 flex w-full whitespace-nowrap px-3 text-center text-[1.075rem] font-extrabold"
			>
				📅 Agregar al calendario
			</a>
			<p class="mt-3 text-center text-xs leading-relaxed text-white/45">
				El evento queda preparado con la fecha, la hora y sus avisos.
			</p>
		{:else}
			<details class="mt-4 rounded-2xl border border-white/10 bg-white/[0.035]">
				<summary class={`${calendarSummaryClass} block w-full cursor-pointer list-none text-center`}>
					{needsCalendarUpdate ? '🔄 Actualizar calendario' : '📅 Agregar al calendario'}
				</summary>
				<div class="border-t border-white/10 p-4">
					{#if hasCalendarAction && !needsCalendarUpdate}
						<p class="ux-alert mb-4">
							Ya registramos una acción de calendario para este turno. Si lo agregás otra vez,
							podrías recibir avisos duplicados.
						</p>
					{/if}
					<div class="grid gap-3">
						{#each calendarOptions as option}
							<a href={option.href} class="ux-choice flex items-center justify-between px-5 py-4">
								<span class="font-bold text-white">{option.label}</span>
								{#if option.hint}
									<span class="ux-badge">{option.hint}</span>
								{/if}
							</a>
						{/each}
					</div>
					<p class="mt-4 text-xs text-white/45">
						El evento incluye avisos sugeridos 24 horas y 2 horas antes, la dirección y este enlace.
						Algunos calendarios usan tus recordatorios habituales.
					</p>
				</div>
			</details>
			{@render pushBlock(false)}
		{/if}

		<details class="mt-4 rounded-2xl border border-white/10 bg-white/[0.02]">
			<summary class="cursor-pointer list-none px-5 py-3 text-sm font-bold text-white/70">
				Copiar detalles del turno
			</summary>
			<div class="border-t border-white/10 p-4">
				<pre class="overflow-x-auto whitespace-pre-wrap text-sm text-white/80">{copyDetailsText}</pre>
				<button type="button" class="ux-btn-secondary mt-3 w-full" onclick={copyDetails}>
					{copied ? 'Copiado ✓' : 'Copiar al portapapeles'}
				</button>
			</div>
		</details>
	</section>
{/snippet}

<main class="min-h-screen bg-[#06111f] px-4 py-6 text-white sm:py-10">
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-5">
		<section class="ux-hero">
			{#if appointment?.business?.logo_url}
				<img src={appointment.business.logo_url} alt={appointment.business.name} class="mb-5 h-16 w-16 rounded-2xl object-cover" />
			{/if}
			<p class="ux-badge">{data.created ? 'Reserva confirmada' : 'Turno'}</p>
			<h1 class="ux-title mt-4">{data.created ? 'Tu turno quedó reservado' : 'Tu turno'}</h1>
			{#if isActive && whenLabels}
				<p class="ux-subtitle">Te esperamos el {whenLabels.full}.</p>
			{:else}
				<p class="ux-subtitle">{data.message}</p>
			{/if}
			{#if form?.message}
				<p class={form.success ? 'ux-alert ux-alert-success mt-5' : 'ux-alert mt-5'}>{form.message}</p>
			{/if}
			{#if data.calendarMessage}
				<p class="ux-alert ux-alert-success mt-5">{data.calendarMessage}</p>
			{/if}
		</section>

		{#if appointment}
			{#if googleCalendarIsUpdating && isActive}
				<div class="ux-alert ux-alert-success">
					La nueva fecha y hora se están actualizando automáticamente en tu cuenta Google.
				</div>
			{:else if needsCalendarUpdate && isActive}
				<div class="ux-alert">
					Tu turno fue reprogramado. Actualizá el calendario para recibir el aviso correcto.
				</div>
			{/if}

			{#if data.isSoon && appointment.business.address}
				{@render locationCard()}
			{/if}

			{#if isActive}
				{@render reminderCard()}
			{/if}

			<section class="ux-card">
				<div class="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<h2 class="text-2xl font-bold text-white">{data.created ? 'Resumen de la reserva' : appointment.business.name}</h2>
						<p class="mt-1 text-sm text-white/55">{appointment.business.name}</p>
					</div>
					<span class="ux-badge">{appointment.public_status_label}</span>
				</div>

				<div class="mt-6 grid gap-4 sm:grid-cols-2">
					<div class="ux-soft-card p-5">
						<p class="text-sm font-bold text-white/55">Servicio</p>
						<p class="mt-2 text-lg font-bold text-white">{appointment.service_name_snapshot}</p>
					</div>
					<div class="ux-soft-card p-5">
						<p class="text-sm font-bold text-white/55">
							{appointment.is_joint ? 'Equipo profesional' : 'Profesional'}
						</p>
						<p class="mt-2 text-lg font-bold text-white">{appointment.professional_name_snapshot}</p>
					</div>
					<div class="ux-soft-card p-5 sm:col-span-2">
						<p class="text-sm font-bold text-white/55">Fecha y hora</p>
						<p class="mt-2 text-lg font-bold text-white">{formatDateTime(appointment.starts_at, timezone)}</p>
					</div>
				</div>

				{#if appointment.business.cancellation_policy}
					<p class="ux-empty mt-5">{appointment.business.cancellation_policy}</p>
				{/if}

				<a
					href={`${base}/comprobante.pdf`}
					download="comprobante-turno.pdf"
					class="ux-btn-secondary mt-6 w-full"
				>
					🧾 Guardar comprobante
				</a>
			</section>

			{#if !data.isSoon && appointment.business.address}
				{@render locationCard()}
			{/if}

			{#if isCancelled}
				<section class="ux-card">
					<h2 class="ux-section-title">Turno cancelado</h2>
					{#if data.googleCalendar.state === 'removed'}
						<p class="mt-3 text-sm text-white/70">También quitamos el evento de tu cuenta Google.</p>
					{:else if data.googleCalendar.state === 'removing'}
						<p class="mt-3 text-sm text-white/70">También estamos quitando el evento de tu cuenta Google.</p>
					{:else}
						<p class="mt-3 text-sm text-white/70">
							Si lo guardaste con otra aplicación de calendario, podés eliminar esa copia desde allí.
						</p>
						<p class="mt-3 text-xs text-white/45">
							<a href={`${base}/calendario.ics`} class="underline">Abrir actualización de calendario</a>
							para calendarios compatibles.
						</p>
					{/if}
				</section>
			{/if}

			<section class="ux-card">
				<h2 class="ux-section-title">Acciones</h2>
				<div class="mt-5 grid gap-3">
					<form method="POST" action="?/confirm">
						<button disabled={!appointment.can_confirm} class="ux-btn-primary w-full">Confirmo que voy</button>
					</form>
					<details class="rounded-2xl border border-white/10 bg-white/[0.035]">
						<summary class="cursor-pointer list-none px-5 py-4 text-base font-bold text-white">Necesito reprogramar</summary>
						<form method="POST" action="?/request_reschedule" class="border-t border-white/10 p-5">
							<label>
								<span class="ux-label">Comentario (opcional)</span>
								<textarea name="note" rows="2" disabled={!appointment.can_request_reschedule} class="ux-textarea"></textarea>
							</label>
							<button disabled={!appointment.can_request_reschedule} class="ux-btn-secondary mt-4 w-full">
								Enviar pedido
							</button>
						</form>
					</details>
					<details class="rounded-2xl border border-red-400/20 bg-red-500/10">
						<summary class="cursor-pointer list-none px-5 py-4 text-base font-bold text-red-100">Cancelar turno</summary>
						<form method="POST" action="?/cancel" class="border-t border-red-400/20 p-5">
							<label>
								<span class="ux-label">Motivo (opcional)</span>
								<textarea name="note" rows="2" disabled={!appointment.can_cancel} class="ux-textarea"></textarea>
							</label>
							<label class="mt-4 flex items-start gap-3 text-sm font-bold text-red-100">
								<input type="checkbox" name="confirm_cancel" value="true" required disabled={!appointment.can_cancel} class="mt-1 h-4 w-4 accent-red-600 disabled:opacity-60" />
								<span>Confirmo que quiero cancelar este turno.</span>
							</label>
							<button disabled={!appointment.can_cancel} class="ux-btn-danger mt-4 w-full">Cancelar turno</button>
						</form>
					</details>
				</div>
				{#if !appointment.can_confirm && !appointment.can_cancel && !appointment.can_request_reschedule}
					<p class="ux-empty mt-5">Este enlace ya no admite acciones online.</p>
				{/if}
			</section>
		{:else}
			<section class="ux-card">No encontramos un turno asociado a este enlace.</section>
		{/if}
	</div>
</main>
