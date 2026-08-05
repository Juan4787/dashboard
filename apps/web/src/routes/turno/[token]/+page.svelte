<script lang="ts">
	import { onMount } from 'svelte';
	import { formatDateTime, formatInTimeZone } from '$lib/utils/format';
	import {
		refineDeviceClass,
		samsungAppNotificationToggleStep,
		type DeviceClass,
		type NotificationBrowserProfile,
		type NotificationGuide
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
			notificationBrowser: NotificationBrowserProfile;
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

	// En iOS el flujo es el calendario. En los demás dispositivos, el permiso sólo se
	// solicita con un toque cuando aún está sin decidir; si ya estaba concedido, el
	// alta se recupera automáticamente sin volver a interrumpir.
	type PushState =
		| 'unavailable'
		| 'unsupported'
		| 'idle'
		| 'working'
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
		verified?: boolean;
		delivery?: PushDelivery | null;
		verificationAvailable?: boolean;
	};
	type TestPhase = 'initial' | 'recovery';
	let activeTestDeliveryId = $state<string | null>(null);
	let activeTestPhase: TestPhase | null = null;
	let pushMessage = $state('');
	let pollRun = 0;
	let mounted = false;
	let notificationPermissionStatus: PermissionStatus | null = null;
	let recoveryTripArmed = false;
	let returnCheckQueued = false;
	let showSamsungPhoneGuide = $state(false);
	let androidPlatformVersion = $state<string | null>(null);
	let currentSiteOrigin = $state<string | null>(null);
	type PermissionRecoveryTarget = 'phone' | 'site';
	// Chrome devuelve el mismo `denied` cuando Android bloquea los avisos de la
	// aplicación y cuando la persona bloquea sólo este sitio; la Web API no expone
	// cuál de las dos capas lo produjo. Por eso Chrome empieza por el ajuste del
	// teléfono (el recorrido siempre existe) y permite pasar, sin mezclarlos, al
	// ajuste exacto del sitio cuando el primero ya estaba activo.
	let permissionRecoveryTarget = $state<PermissionRecoveryTarget>('site');
	type DeviceCheckReason = 'test_missing' | 'permission_not_granted';
	let deviceCheckReason = $state<DeviceCheckReason>('test_missing');
	let inMemoryPushSessionId = '';
	const testRetrySequence: Record<TestPhase, number> = { initial: 0, recovery: 0 };

	const base = $derived(appointment ? `/turno/${appointment.token}` : '');
	const siteLabel = $derived.by(() => {
		try {
			// El permiso pertenece al origen que está abierto, no necesariamente al
			// dominio canónico configurado (por ejemplo, una vista previa o un dominio
			// propio). El valor real se completa al hidratar.
			const site = new URL(currentSiteOrigin ?? data.publicSiteUrl);
			// Samsung Browser muestra el origen completo (incluye protocolo y, en
			// desarrollo, puerto) dentro de “Permitir o bloquear sitios web”.
			return data.notificationBrowser.id === 'samsung_browser' ? site.origin : site.hostname;
		} catch {
			return 'este sitio';
		}
	});
	const resolveGuide = (guide: NotificationGuide | null): NotificationGuide | null =>
		guide
			? {
					title: guide.title,
					steps: guide.steps.map((step) =>
						step
							.replaceAll('{{site}}', `“${siteLabel}”`)
							.replaceAll(
								'{{app_notification_toggle}}',
								samsungAppNotificationToggleStep(androidPlatformVersion)
							)
					)
				}
			: null;
	const sitePermissionGuide = $derived(resolveGuide(data.notificationBrowser.sitePermissionGuide));
	const phoneNotificationGuide = $derived(
		resolveGuide(data.notificationBrowser.phoneNotificationGuide)
	);
	const deniedPermissionGuide = $derived(
		permissionRecoveryTarget === 'site'
			? (sitePermissionGuide ?? phoneNotificationGuide)
			: (phoneNotificationGuide ?? sitePermissionGuide)
	);
	const permissionChoiceLabel = $derived(
		data.notificationBrowser.id === 'firefox' ? 'Siempre' : 'Permitir'
	);

	const pushSessionStorageKey = () =>
		appointment ? `cita-suite:push-session:${appointment.token}` : 'cita-suite:push-session';
	const recoveryPendingStorageKey = () => `${pushSessionStorageKey()}:recovery-pending`;
	const permissionRecoveryStorageKey = () =>
		`${pushSessionStorageKey()}:permission-recovery`;
	const recoveryRetryStorageKey = () => `${pushSessionStorageKey()}:recovery-retry`;
	const rememberPermissionRecoveryTarget = (target: PermissionRecoveryTarget) => {
		permissionRecoveryTarget = target;
		try {
			localStorage.setItem(permissionRecoveryStorageKey(), target);
		} catch {
			// El estado reactivo alcanza mientras esta página permanezca abierta.
		}
	};
	const clearPermissionRecoveryTarget = () => {
		try {
			localStorage.removeItem(permissionRecoveryStorageKey());
		} catch {
			// El permiso efectivo sigue siendo la fuente de verdad.
		}
	};
	const stablePushSessionId = () => {
		if (inMemoryPushSessionId) return inMemoryPushSessionId;
		try {
			// localStorage hace que dos pestañas del mismo turno compartan la misma
			// acción lógica. Sin esto, ambas podían volver de un permiso concedido y
			// solicitar dos pruebas distintas para el mismo teléfono.
			const stored = localStorage.getItem(pushSessionStorageKey());
			if (stored && /^[A-Za-z0-9_-]{16,120}$/.test(stored)) {
				inMemoryPushSessionId = stored;
				return stored;
			}
			// Migra sin cortar una activación que hubiese empezado con una versión
			// anterior, cuando el identificador todavía vivía sólo en sessionStorage.
			const legacy = sessionStorage.getItem(pushSessionStorageKey());
			if (legacy && /^[A-Za-z0-9_-]{16,120}$/.test(legacy)) {
				localStorage.setItem(pushSessionStorageKey(), legacy);
				inMemoryPushSessionId = legacy;
				return legacy;
			}
		} catch {
			// El identificador en memoria mantiene la idempotencia durante esta carga.
		}
		const created =
			typeof crypto.randomUUID === 'function'
				? crypto.randomUUID()
				: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
		inMemoryPushSessionId = created;
		try {
			localStorage.setItem(pushSessionStorageKey(), created);
		} catch {
			// localStorage puede estar deshabilitado; el valor en memoria sigue vigente.
		}
		return created;
	};
	const retrySequenceFor = (phase: TestPhase) => {
		if (phase === 'initial') return testRetrySequence.initial;
		try {
			const stored = localStorage.getItem(recoveryRetryStorageKey());
			if (stored && /^\d{1,4}$/.test(stored)) {
				testRetrySequence.recovery = Math.max(testRetrySequence.recovery, Number(stored));
			}
		} catch {
			// El contador en memoria conserva el flujo durante esta visita.
		}
		return testRetrySequence.recovery;
	};
	const advanceTestRetrySequence = (phase: TestPhase) => {
		testRetrySequence[phase] = Math.min(9999, retrySequenceFor(phase) + 1);
		if (phase === 'recovery') {
			try {
				// Sólo las recuperaciones se persisten: evita repetir automáticamente una
				// prueba inicial al recargar, pero permite una nueva salida deliberada a Ajustes.
				localStorage.setItem(recoveryRetryStorageKey(), String(testRetrySequence.recovery));
			} catch {
				// Sin almacenamiento, la deduplicación de base de datos sigue vigente.
			}
		}
	};
	const testRequestKeyFor = (phase: TestPhase, refreshed = false) => {
		const retry = retrySequenceFor(phase);
		return `push:${stablePushSessionId()}:${phase}${refreshed ? ':refresh' : ''}${retry > 0 ? `:retry${retry}` : ''}`;
	};
	const markRecoveryTrip = () => {
		recoveryTripArmed = true;
		try {
			sessionStorage.setItem(recoveryPendingStorageKey(), '1');
		} catch {
			// La marca en memoria basta mientras la página siga abierta.
		}
	};
	const consumeRecoveryTrip = () => {
		let pending = recoveryTripArmed;
		recoveryTripArmed = false;
		try {
			pending ||= sessionStorage.getItem(recoveryPendingStorageKey()) === '1';
			sessionStorage.removeItem(recoveryPendingStorageKey());
		} catch {
			// Sin almacenamiento, se conserva el valor capturado en memoria.
		}
		return pending;
	};

	const savePushSubscriptionForAppointment = async (
		subscription: PushSubscription,
		requestTest: boolean,
		phase: TestPhase,
		refreshed = false
	) => {
		if (!base) return null;
		const response = await fetch(`${base}/push`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				subscription: subscription.toJSON(),
				test: requestTest,
				...(requestTest
					? { testRequestKey: testRequestKeyFor(phase, refreshed) }
					: {})
			})
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
	const readNotificationPermission = (): NotificationPermission =>
		window.Notification.permission;
	// Candado anti-reentrada: requestPermission y visibilitychange pueden disparar el
	// alta a la vez. El upsert del backend es idempotente, pero evitamos subscribe() dobles.
	let syncing = $state(false);

	const runWithPhonePushLock = async (operation: () => Promise<void>): Promise<void> => {
		const locks = navigator.locks;
		if (!locks?.request || !appointment?.id) return operation();
		// PushManager pertenece al origen, no a una pestaña. Serializar este tramo
		// impide que dos vistas desuscriban/reemplacen el mismo endpoint a la vez.
		return locks.request(`cita-suite:push-sync:${appointment.id}`, operation);
	};

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
		if (delivery.state === 'confirmed') {
			activeTestPhase = null;
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
			deviceCheckReason = 'test_missing';
			pushState = 'needs_device_check';
			pushMessage = '';
			return true;
		}
		pushState = 'test_waiting';
		return false;
	};

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
		for (let attempt = 0; attempt < 5; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			if (run !== pollRun || !base) return;
			try {
				const delivery = await readDelivery(deliveryId);
				if (delivery && applyDelivery(delivery)) return;
				// El recibo automático mejora la observabilidad, pero no debe retener a la
				// persona: después de unos segundos le preguntamos directamente si vio la
				// prueba, aunque Android no haya informado el evento "displayed".
				if (attempt === 4 && activeTestDeliveryId === deliveryId) {
					pushState = 'test_question';
					pushMessage = '';
					return;
				}
			} catch {
				// El sondeo es best-effort; el próximo intento puede recuperar la conexión.
			}
		}
	};

	const useSaveResult = (
		result: Awaited<ReturnType<typeof savePushSubscriptionForAppointment>>,
		requestTest: boolean,
		phase: TestPhase
	) => {
		if (!result?.response.ok) {
			// Una respuesta explícita del proveedor prueba que esta tentativa terminó.
			// El próximo toque manual usa otra clave; una pérdida de red conserva la
			// misma clave y recupera el resultado sin arriesgar un envío duplicado.
			if (
				result?.body.code === 'test_not_accepted' ||
				result?.body.code === 'subscription_expired'
			) {
				// Sólo una respuesta explícita habilita una clave nueva. Si se perdió la
				// respuesta de red, conservamos la misma y el backend recupera el intento
				// anterior sin duplicarlo. Esto vale también para una recuperación posterior.
				advanceTestRetrySequence(phase);
			}
			pushMessage = result?.body.message || 'No pudimos activar las notificaciones. Volvé a intentar.';
			return false;
		}
		if (result.body.verified) {
			activeTestDeliveryId = null;
			activeTestPhase = null;
			pushState = 'subscribed';
			pushMessage = '';
			return true;
		}
		if (result.body.delivery) {
			activeTestPhase = phase;
			const terminal = applyDelivery(result.body.delivery);
			if (!terminal) void pollTestDelivery(result.body.delivery.deliveryId);
		} else if (requestTest) {
			pushMessage = 'No pudimos comprobar la notificación de prueba.';
			return false;
		} else {
			activeTestDeliveryId = null;
			pushState = 'idle';
		}
		return true;
	};

	// Requiere el permiso YA concedido: registra el SW, suscribe (o recupera) y guarda el
	// endpoint contra el turno actual.
	const syncPushSubscription = async (
		requestTest: boolean,
		phase: TestPhase = 'initial'
	) => {
		if (!data.vapidPublicKey || syncing) return;
		// Defensa en profundidad: ningún caller puede registrar, suscribir ni pedir una
		// prueba hasta que el navegador refleje el permiso como efectivamente concedido.
		// No alcanza con confiar en el valor devuelto por requestPermission(): algunos
		// Android actualizan Notification.permission un instante después.
		if (typeof window.Notification === 'undefined' || readNotificationPermission() !== 'granted') {
			pushState =
				typeof window.Notification !== 'undefined' && readNotificationPermission() === 'denied'
					? 'denied'
					: 'awaiting_permission';
			pushMessage = '';
			return;
		}
		pollRun += 1;
		syncing = true;
		pushState = 'working';
		pushMessage = '';
		try {
			await runWithPhonePushLock(async () => {
				// El permiso pudo cambiar mientras esta pestaña esperaba a otra. Se
				// comprueba de nuevo antes de tocar la suscripción compartida.
				if (readNotificationPermission() !== 'granted') {
					pushState = readNotificationPermission() === 'denied' ? 'denied' : 'awaiting_permission';
					return;
				}
				const registration = await navigator.serviceWorker.register('/push-sw.js', {
					updateViaCache: 'none'
				});
				try {
					await registration.update();
				} catch {
					// La copia activa todavía puede funcionar. El test inmediato decide el resultado.
				}
				await Promise.all([
					navigator.serviceWorker.ready,
					waitForPushWorkerActivation(registration)
				]);
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
				let result = await savePushSubscriptionForAppointment(
					subscription,
					requestTest,
					phase
				);
				if (requestTest && result?.response.status === 410) {
					await subscription.unsubscribe();
					subscription = await registration.pushManager.subscribe({
						userVisibleOnly: true,
						applicationServerKey: urlBase64ToUint8Array(data.vapidPublicKey)
					});
					result = await savePushSubscriptionForAppointment(subscription, true, phase, true);
				}
				if (!useSaveResult(result, requestTest, phase)) {
					pushState = phase === 'recovery' ? 'needs_device_check' : 'error';
				}
			});
		} catch {
			pushMessage ||= 'El teléfono no pudo completar la activación.';
			pushState = phase === 'recovery' ? 'needs_device_check' : 'error';
		} finally {
			syncing = false;
			if (returnCheckQueued) {
				returnCheckQueued = false;
				queueMicrotask(continueAfterPermissionChange);
			}
		}
	};

	const enablePush = async () => {
		if (!data.vapidPublicKey || syncing) return;
		const phase: TestPhase = pushState === 'needs_device_check' ? 'recovery' : 'initial';
		if (phase === 'recovery') consumeRecoveryTrip();
		pushMessage = '';
		if (readNotificationPermission() === 'granted') {
			await syncPushSubscription(true, phase);
			return;
		}
		if (readNotificationPermission() === 'denied') {
			pushState = 'denied';
			return;
		}
		pushState = 'working';
		try {
			await Notification.requestPermission();
			// La propiedad efectiva es la única fuente de verdad para habilitar el envío.
			// Si todavía figura en default, el botón queda disponible para reintentar y el
			// listener de permisos continúa observando el cambio sin enviar nada antes.
			if (readNotificationPermission() === 'granted') {
				clearPermissionRecoveryTarget();
				await syncPushSubscription(true, phase);
			} else if (readNotificationPermission() === 'denied') {
				// Chrome no informa qué capa rechazó. Su recorrido general va primero y
				// ofrece pasar explícitamente al del sitio si ya estaba habilitado.
				rememberPermissionRecoveryTarget(
					data.notificationBrowser.id === 'chrome' && phoneNotificationGuide ? 'phone' : 'site'
				);
				pushState = 'denied';
			} else {
				// Samsung Browser conserva `default` si sus notificaciones están apagadas
				// en el teléfono, incluso después de tocar “Permitir”. No se envía ninguna
				// prueba: mostramos la ruta exacta del sistema y una acción final con gesto.
				if (data.notificationBrowser.samsungExclusive) {
					deviceCheckReason = 'permission_not_granted';
					pushState = 'needs_device_check';
				} else {
					pushState = 'awaiting_permission';
				}
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
			const feedbackPhase = activeTestPhase;
			applyDelivery(body.delivery);
			if (!visible) {
				if (feedbackPhase === 'recovery') advanceTestRetrySequence('recovery');
				activeTestPhase = null;
			}
		} catch {
			pushMessage = 'No pudimos guardar tu respuesta. Volvé a intentar.';
		} finally {
			syncing = false;
			if (returnCheckQueued) {
				returnCheckQueued = false;
				queueMicrotask(continueAfterPermissionChange);
			}
		}
	};

	const continueAfterPermissionChange = () => {
		if (!pushSupported) return;
		if (syncing) {
			returnCheckQueued = true;
			return;
		}
		if (readNotificationPermission() === 'denied') {
			pushState = 'denied';
			return;
		}
		if (readNotificationPermission() === 'default') {
			clearPermissionRecoveryTarget();
			if (pushState === 'denied') pushState = 'awaiting_permission';
			return;
		}
		clearPermissionRecoveryTarget();
		if (pushState === 'needs_device_check' && consumeRecoveryTrip()) {
			void syncPushSubscription(true, 'recovery');
			return;
		}
		if (pushState === 'awaiting_permission' || pushState === 'denied' || pushState === 'idle') {
			void syncPushSubscription(true, 'initial');
		}
	};

	onMount(() => {
		mounted = true;
		currentSiteOrigin = window.location.origin;
		showSamsungPhoneGuide = data.notificationBrowser.samsungExclusive;
		try {
			const storedRecoveryTarget = localStorage.getItem(permissionRecoveryStorageKey());
			if (storedRecoveryTarget === 'phone' || storedRecoveryTarget === 'site') {
				permissionRecoveryTarget = storedRecoveryTarget;
			} else {
				permissionRecoveryTarget = data.notificationBrowser.id === 'chrome' ? 'phone' : 'site';
			}
		} catch {
			permissionRecoveryTarget = data.notificationBrowser.id === 'chrome' ? 'phone' : 'site';
		}
		type NavigatorWithUserAgentData = Navigator & {
			userAgentData?: {
				getHighEntropyValues: (
					hints: string[]
				) => Promise<{ platformVersion?: string }>;
			};
		};
		const userAgentData = (navigator as NavigatorWithUserAgentData).userAgentData;
		if (userAgentData) {
			void userAgentData
				.getHighEntropyValues(['platformVersion'])
				.then((values) => {
					if (mounted && typeof values.platformVersion === 'string') {
						androidPlatformVersion = values.platformVersion;
					}
				})
				.catch(() => {
					// La guía conserva una instrucción exacta sin adivinar la etiqueta.
				});
		}
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

		if (readNotificationPermission() === 'denied') {
			// No se reutiliza una suscripción histórica cuando el permiso actual está
			// bloqueado: eso volvería a presentar como "verificado" un teléfono incapaz
			// de mostrar avisos.
			pushState = 'denied';
		} else if (readNotificationPermission() === 'default') {
			clearPermissionRecoveryTarget();
			pushState = 'idle';
		} else {
			clearPermissionRecoveryTarget();
			// Si el permiso ya estaba concedido, no se vuelve a pedir ni se espera un
			// toque: se crea o recupera la suscripción y el servidor evita repetir una
			// prueba que ya haya sido confirmada.
			const phase: TestPhase = consumeRecoveryTrip() ? 'recovery' : 'initial';
			void syncPushSubscription(true, phase);
		}

		// Núcleo del fix de UX: al volver a la pantalla (tras conceder el permiso en
		// Configuración) reconsultamos el estado REAL y activamos los avisos. También
		// recupera de un 'denied' previo si el usuario lo desbloqueó.
		const onVisibilityChange = () => {
			if (document.visibilityState === 'hidden') {
				if (
					pushState === 'needs_device_check' &&
					(data.notificationBrowser.samsungExclusive || showSamsungPhoneGuide)
				) {
					markRecoveryTrip();
				}
				return;
			}
			continueAfterPermissionChange();
		};
		const onFocus = () => continueAfterPermissionChange();
		document.addEventListener('visibilitychange', onVisibilityChange);
		window.addEventListener('focus', onFocus);
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
			document.removeEventListener('visibilitychange', onVisibilityChange);
			window.removeEventListener('focus', onFocus);
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
			['unsupported', 'needs_device_check'].includes(renderedPushState) ||
			(renderedPushState === 'denied' && !sitePermissionGuide) ||
			data.googleCalendar.state === 'needs_reconnect' ||
			data.googleCalendar.state === 'failed'
		)
	);
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
						: renderedPushState === 'denied' && deniedPermissionGuide
							? permissionRecoveryTarget === 'phone'
								? `Para enviarte los recordatorios, necesitamos que ${data.notificationBrowser.label ?? 'la aplicación que muestra esta página'} pueda mostrar avisos en el teléfono.`
								: 'Para enviarte los recordatorios, necesitamos que permitas los avisos de este turno.'
						: renderedPushState === 'awaiting_permission'
							? 'Para enviarte los recordatorios, necesitamos que permitas los avisos. Tocá el botón y elegí la opción indicada.'
						: renderedPushState === 'needs_device_check'
								? deviceCheckReason === 'permission_not_granted'
									? `${data.notificationBrowser.label ?? 'La aplicación que muestra esta página'} todavía no pudo habilitar los avisos. Revisá sus notificaciones en el teléfono y completá la activación al volver.`
									: `Los avisos de este turno ya están permitidos. Ahora falta que ${data.notificationBrowser.label ?? 'la aplicación que muestra esta página'} pueda mostrarlos en el teléfono.`
								: showAndroidCalendarFallback
									? renderedPushState === 'unsupported' && data.notificationBrowser.samsungExclusive
										? 'Conservá este enlace: desde acá siempre podés consultar la fecha y la hora del turno.'
										: 'Elegí la opción que corresponde a tu teléfono para terminar de guardar el recordatorio.'
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

{#snippet instructionList(guide: NotificationGuide)}
	<h3 class="text-lg font-extrabold leading-snug text-white">{guide.title}</h3>
	<ol class="mt-4 space-y-3 text-sm leading-relaxed text-white/80">
		{#each guide.steps as step, index}
			<li class="flex gap-3">
				<span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-400/15 text-xs font-extrabold text-violet-200">
					{index + 1}
				</span>
				<span class="pt-0.5">{step}</span>
			</li>
		{/each}
	</ol>
{/snippet}

{#snippet pushBlock(primary: boolean)}
	{#if renderedPushState !== 'unavailable'}
		<div class="mt-5">
			{#if renderedPushState === 'subscribed'}
				<div class="ux-alert ux-alert-success" aria-live="polite">
					<p class="font-extrabold text-white">Recordatorio activado</p>
					<p class="mt-1">Este teléfono va a avisarte {pushWindowsLabel}.</p>
				</div>
			{:else if renderedPushState === 'working'}
				<div class="ux-alert" aria-live="polite">
					<div class="flex items-start gap-3">
						<svg viewBox="0 0 24 24" aria-hidden="true" class="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[#a78bfa]">
							<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
							<path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
						</svg>
						<div>
							<p class="font-bold text-white">Activando el recordatorio</p>
							<p class="mt-1">En un momento vas a recibir la notificación de prueba.</p>
						</div>
					</div>
				</div>
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
					<button type="button" class="ux-btn-primary w-full" disabled={syncing} onclick={() => submitTestFeedback(true)}>
						Sí, la recibí
					</button>
					<button type="button" class="ux-btn-secondary w-full" disabled={syncing} onclick={() => submitTestFeedback(false)}>
						No la recibí
					</button>
				</div>
			{:else if renderedPushState === 'denied' && deniedPermissionGuide}
				<div class="rounded-2xl border border-amber-300/20 bg-amber-300/[0.055] p-5" aria-live="polite">
					{@render instructionList(deniedPermissionGuide)}
					{#if permissionRecoveryTarget === 'phone' && sitePermissionGuide}
						<p class="mt-4 text-sm leading-relaxed text-white/65">
							Si “Permitir notificaciones” ya estaba activado, falta revisar el permiso de este turno.
						</p>
						<button
							type="button"
							class="ux-btn-secondary mt-4 w-full"
							onclick={() => rememberPermissionRecoveryTarget('site')}
						>
							Ya estaba activado
						</button>
					{:else}
						<button type="button" class="ux-btn-secondary mt-5 w-full" onclick={enablePush}>
							Ya lo permití
						</button>
						<p class="mt-3 text-center text-xs leading-relaxed text-white/50">
							Al volver, lo comprobamos automáticamente. El botón queda disponible por si la pantalla no se actualiza sola.
						</p>
					{/if}
				</div>
			{:else if renderedPushState === 'awaiting_permission'}
				<button
					type="button"
					class={primary ? 'ux-btn-primary ux-btn-cta w-full whitespace-nowrap px-3 text-[1.075rem] font-extrabold' : 'ux-btn-secondary w-full whitespace-nowrap px-3 text-[1.075rem] font-extrabold'}
					onclick={enablePush}
				>
					🔔 Activar recordatorio
				</button>
				<p class="mt-3 text-center text-xs leading-relaxed text-white/55">
					Cuando aparezca la pregunta, elegí “{permissionChoiceLabel}”.
				</p>
			{:else if renderedPushState === 'error'}
				{#if pushMessage}
					<p class="ux-alert" aria-live="polite">{pushMessage}</p>
				{/if}
				<button type="button" class="ux-btn-secondary mt-3 w-full" disabled={syncing} onclick={enablePush}>
					Volver a intentar
				</button>
			{:else if ['unsupported', 'needs_device_check', 'denied'].includes(renderedPushState)}
				{#if pushMessage}
					<p class="ux-alert" aria-live="polite">{pushMessage}</p>
				{/if}
			{:else}
				<button
					type="button"
					class={primary ? 'ux-btn-primary ux-btn-cta w-full whitespace-nowrap px-3 text-[1.075rem] font-extrabold' : 'ux-btn-secondary w-full whitespace-nowrap px-3 text-[1.075rem] font-extrabold'}
					onclick={enablePush}
				>
					🔔 Activar recordatorio
				</button>
				<p class="mt-3 text-center text-xs leading-relaxed text-white/45">
					Primero te pedimos permiso y después enviamos una prueba real.
				</p>
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
	{#if showAndroidCalendarFallback && ((renderedPushState === 'needs_device_check' && phoneNotificationGuide) || !data.notificationBrowser.samsungExclusive)}
		<div class="mt-5 space-y-4" aria-live="polite">
			{#if renderedPushState === 'needs_device_check' && phoneNotificationGuide}
				<details
					class="group overflow-hidden rounded-2xl border border-violet-300/30 bg-violet-400/[0.07] shadow-[0_12px_30px_rgba(76,29,149,0.12)]"
					bind:open={showSamsungPhoneGuide}
				>
					<summary class="flex min-h-[5.75rem] cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
						<span>
							<span class="block text-base font-extrabold leading-snug text-white">¿Tu teléfono es Samsung?</span>
							<span class="mt-1.5 block text-sm font-bold text-violet-200">Configurar el recordatorio</span>
						</span>
						<svg viewBox="0 0 20 20" aria-hidden="true" class="h-5 w-5 shrink-0 text-violet-200/75 transition-transform group-open:rotate-180">
							<path d="m5.75 7.75 4.25 4.25 4.25-4.25" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</summary>
					<div class="border-t border-violet-200/15 px-5 pb-5 pt-5">
						{@render instructionList(phoneNotificationGuide)}
						{#if deviceCheckReason === 'permission_not_granted'}
							<p class="mt-4 text-xs leading-relaxed text-white/60">
								Después de activar ese ajuste, usá el botón de abajo y elegí “Permitir”.
							</p>
							<button
								type="button"
								class="ux-btn-primary ux-btn-cta mt-4 w-full whitespace-nowrap px-3 text-[1.075rem] font-extrabold"
								disabled={syncing}
								onclick={enablePush}
							>
								🔔 Activar recordatorio
							</button>
						{:else}
							<p class="mt-4 text-xs leading-relaxed text-white/55">
								Cuando vuelvas, enviamos una sola prueba para comprobar el cambio.
							</p>
						{/if}
					</div>
				</details>
			{/if}

			{#if !data.notificationBrowser.samsungExclusive}
				<a
					href={`${base}/ir/google`}
					class="flex min-h-[5.75rem] items-center justify-between gap-4 rounded-2xl border border-violet-300/30 bg-violet-400/[0.07] px-5 py-4 shadow-[0_12px_30px_rgba(76,29,149,0.12)] transition hover:border-violet-300/45 hover:bg-violet-400/[0.1]"
				>
					<span>
						<span class="block text-base font-extrabold leading-snug text-white">¿Tu teléfono es de otra marca?</span>
						<span class="mt-1.5 block text-sm font-bold text-violet-200">Agregar a Google Calendar</span>
					</span>
					<svg viewBox="0 0 20 20" aria-hidden="true" class="h-5 w-5 shrink-0 text-violet-200/75">
						<path d="m7.75 5.75 4.25 4.25-4.25 4.25" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				</a>
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
