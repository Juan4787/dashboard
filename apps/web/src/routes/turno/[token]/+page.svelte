<script lang="ts">
	import { onMount } from 'svelte';
	import { formatDateTime, formatInTimeZone } from '$lib/utils/format';
	import { refineDeviceClass, type DeviceClass } from '$lib/device';

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
			androidCalendarIntent: { url: string; variant: 'data' | 'type' } | null;
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
		| 'idle'
		| 'working'
		| 'configured'
		| 'test_waiting'
		| 'test_question'
		| 'subscribed'
		| 'needs_device_check'
		| 'denied'
		| 'awaiting_permission'
		| 'error';
	let pushState = $state<PushState>('unavailable');
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
	let pushMessage = $state('');
	let pollRun = 0;

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

	// Soporte real de push (se fija en onMount; nunca en iOS).
	let pushSupported = false;
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
		if (delivery.state === 'confirmed') {
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

	const pollTestDelivery = async (deliveryId: string) => {
		const run = ++pollRun;
		for (let attempt = 0; attempt < 15; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			if (run !== pollRun || !base) return;
			try {
				const response = await fetch(
					`${base}/push?delivery_id=${encodeURIComponent(deliveryId)}`,
					{ cache: 'no-store' }
				);
				if (!response.ok) continue;
				const body = (await response.json()) as PushResponse;
				if (body.delivery && applyDelivery(body.delivery)) return;
			} catch {
				// El sondeo es best-effort; el próximo intento puede recuperar la conexión.
			}
		}
		if (run === pollRun && pushState === 'test_waiting') {
			pushState = 'needs_device_check';
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
		} else {
			activeTestDeliveryId = null;
			pushState = 'configured';
		}
		return true;
	};

	// Requiere el permiso YA concedido: registra el SW, suscribe (o recupera) y guarda el
	// endpoint contra el turno actual.
	const syncPushSubscription = async (requestTest: boolean) => {
		if (!data.vapidPublicKey || syncing) return;
		pollRun += 1;
		syncing = true;
		pushState = 'working';
		pushMessage = '';
		try {
			const registration = await navigator.serviceWorker.register('/push-sw.js', {
				updateViaCache: 'none'
			});
			await Promise.all([navigator.serviceWorker.ready, waitForPushWorkerActivation(registration)]);
			let subscription =
				(await registration.pushManager.getSubscription()) ??
				(await registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: urlBase64ToUint8Array(data.vapidPublicKey)
				}));
			let result = await savePushSubscriptionForAppointment(subscription, requestTest);
			if (requestTest && result?.response.status === 410) {
				await subscription.unsubscribe();
				subscription = await registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: urlBase64ToUint8Array(data.vapidPublicKey)
				});
				result = await savePushSubscriptionForAppointment(subscription, true);
			}
			if (!useSaveResult(result)) pushState = 'error';
		} catch {
			pushMessage ||= 'No pudimos activar las notificaciones. Revisá tu conexión y volvé a intentar.';
			pushState = 'error';
		} finally {
			syncing = false;
		}
	};

	const enablePush = async () => {
		if (!data.vapidPublicKey || syncing) return;
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
		if (Notification.permission === 'granted') {
			await syncPushSubscription(true);
			return;
		}
		await enablePush();
	};

	onMount(() => {
		refinedDevice = refineDeviceClass(data.device, navigator);
		const effective = refinedDevice ?? data.device;
		pushSupported = Boolean(
			data.vapidPublicKey &&
				effective !== 'ios' &&
				'serviceWorker' in navigator &&
				'PushManager' in window &&
				'Notification' in window
		);
		if (!pushSupported) return;

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
			if (Notification.permission === 'denied') {
				pushState = 'denied';
				return;
			}
			if (['subscribed', 'configured', 'test_waiting', 'test_question'].includes(pushState)) return;
			if (
				Notification.permission === 'granted' &&
				(pushState === 'awaiting_permission' || pushState === 'denied')
			) {
				void syncPushSubscription(true);
			}
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			pollRun += 1;
			document.removeEventListener('visibilitychange', onVisible);
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
			['clicked_google', 'clicked_ics', 'downloaded_ics', 'clicked_outlook', 'clicked_phone_calendar'].includes(
				appointment.calendar_action_status
			)
	);
	const needsCalendarUpdate = $derived(Boolean(appointment?.calendar_update_required_at));

	// FASE 12 — copy del push por proximidad, espejo de las ventanas reales del job
	// (24h y 2h): no se promete un aviso cuya ventana ya pasó.
	const pushWindowsLabel = $derived.by(() => {
		if (!appointment) return 'antes del turno';
		const hoursUntil = (new Date(appointment.starts_at).getTime() - Date.now()) / 3_600_000;
		if (hoursUntil > 24) return '24 horas y 2 horas antes del turno';
		if (hoursUntil > 2) return 'durante el día previo y 2 horas antes del turno';
		return 'en los próximos minutos';
	});

	// En Android el aviso fuerte es el push (CTA primario); el calendario pasa a
	// conveniencia secundaria. Salvo cuando hay que ACTUALIZAR el calendario tras una
	// reprogramación: ahí la tarea es de calendario y mantiene el botón primario.
	const reminderIntro = $derived(
		needsCalendarUpdate
			? 'El turno cambió de fecha. Agregalo de nuevo para que tu calendario tenga el horario correcto.'
			: device === 'android'
				? 'Activá los avisos para que el teléfono te recuerde el turno y, si querés, guardalo también en tu calendario.'
				: 'Agregá el turno a tu calendario para recibir avisos antes y tener la dirección a mano.'
	);
	const calendarSummaryClass = $derived.by(() => {
		// Reprogramación: actualizar el calendario ES la tarea → CTA enfatizado.
		if (needsCalendarUpdate) return 'ux-btn-primary ux-btn-cta';
		// En Android el push es el CTA principal; el calendario queda secundario.
		if (device === 'android') return 'ux-btn-secondary';
		// En iOS no hay push: el calendario es el CTA principal → enfatizado.
		if (device === 'ios') return 'ux-btn-primary ux-btn-cta';
		return 'ux-btn-primary';
	});

	type CalendarOption = { label: string; href: string; hint?: string; isIntent?: boolean };
	const calendarOptions = $derived.by((): CalendarOption[] => {
		if (!appointment) return [];
		if (device === 'ios') {
			return [
				{ label: 'Calendario del iPhone', href: `${base}/calendario.ics?p=phone`, hint: 'Recomendado' },
				{ label: 'Google Calendar', href: `${base}/ir/google` }
			];
		}
		if (device === 'android') {
			// Sin .ics en el flujo principal Android (descarga archivo). El intent
			// nativo va primero cuando la FASE 12 está activa; Google queda visible
			// como escape (y es el destino del fallback automático del intent).
			if (data.androidCalendarIntent) {
				return [
					{
						label: 'Calendario del teléfono',
						href: data.androidCalendarIntent.url,
						hint: 'Recomendado',
						isIntent: true
					},
					{ label: 'Google Calendar', href: `${base}/ir/google` }
				];
			}
			return [{ label: 'Google Calendar', href: `${base}/ir/google`, hint: 'Recomendado' }];
		}
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

	// Registro best-effort del intento de intent nativo (audit-only en el server: NO
	// cuenta como cobertura). Jamás bloquea la navegación del <a>.
	const reportIntentAttempt = () => {
		if (!data.androidCalendarIntent || data.demo) return;
		const target = `${base}/calendario-intent`;
		const payload = JSON.stringify({ variant: data.androidCalendarIntent.variant });
		try {
			if (navigator.sendBeacon?.(target, new Blob([payload], { type: 'application/json' }))) {
				return;
			}
		} catch {
			// sigue el fetch
		}
		fetch(target, {
			method: 'POST',
			keepalive: true,
			headers: { 'content-type': 'application/json' },
			body: payload
		}).catch(() => {});
	};

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
	{#if pushState !== 'unavailable'}
		<div class="mt-4">
			{#if pushState === 'subscribed'}
				<p class="ux-alert ux-alert-success">
					🔔 Avisos verificados en este teléfono: te avisamos {pushWindowsLabel}.
				</p>
			{:else if pushState === 'configured'}
				<div class="ux-alert">
					<p class="font-bold text-white">Los avisos quedaron configurados.</p>
					<p class="mt-1">Enviá una prueba para comprobar que este teléfono puede mostrarlos.</p>
				</div>
				<button
					type="button"
					class={primary ? 'ux-btn-primary w-full mt-3' : 'ux-btn-secondary w-full mt-3'}
					onclick={retryPushTest}
				>
					Enviar notificación de prueba
				</button>
			{:else if pushState === 'test_waiting'}
				<div class="ux-alert" aria-live="polite">
					<p class="font-bold text-white">Prueba enviada.</p>
					<p class="mt-1">Estamos comprobando si llegó al navegador de este teléfono…</p>
				</div>
			{:else if pushState === 'test_question'}
				<div class="ux-alert ux-alert-success" aria-live="polite">
					<p class="font-bold text-white">El navegador informó que mostró la prueba.</p>
					<p class="mt-1">¿La viste entre las notificaciones del teléfono?</p>
				</div>
				<div class="mt-3 grid grid-cols-2 gap-3">
					<button
						type="button"
						class="ux-btn-primary w-full"
						disabled={syncing}
						onclick={() => submitTestFeedback(true)}
					>
						Sí, la vi
					</button>
					<button
						type="button"
						class="ux-btn-secondary w-full"
						disabled={syncing}
						onclick={() => submitTestFeedback(false)}
					>
						No apareció
					</button>
				</div>
			{:else if pushState === 'needs_device_check'}
				<div class="ux-empty" aria-live="polite">
					<p class="font-bold text-white">El teléfono no confirmó la notificación.</p>
					<p class="mt-2">
						Revisá en Android los permisos de notificaciones del navegador y del sitio. Si
						sigue sin aparecer, permití que el navegador funcione en segundo plano y sin
						restricciones de batería.
					</p>
				</div>
				<button
					type="button"
					class={primary ? 'ux-btn-primary w-full mt-3' : 'ux-btn-secondary w-full mt-3'}
					disabled={syncing}
					onclick={retryPushTest}
				>
					Probar nuevamente
				</button>
			{:else if pushState === 'awaiting_permission'}
				<p class="ux-alert">
					Concedé el permiso de notificaciones y volvé a esta pantalla: activamos los avisos
					automáticamente.
				</p>
				<button
					type="button"
					class={primary ? 'ux-btn-primary w-full mt-3' : 'ux-btn-secondary w-full mt-3'}
					onclick={enablePush}
				>
					Volver a intentar
				</button>
			{:else if pushState === 'denied'}
				<p class="ux-empty">
					Las notificaciones están bloqueadas. Habilitalas para este sitio y para la app
					del navegador desde los ajustes del teléfono. Mientras tanto, agregá el turno al
					calendario para no olvidarte.
				</p>
			{:else}
				<button
					type="button"
					class={primary ? 'ux-btn-primary ux-btn-cta w-full' : 'ux-btn-secondary w-full'}
					disabled={pushState === 'working'}
					onclick={enablePush}
				>
					{pushState === 'working' ? 'Activando…' : '🔔 Activar avisos en este teléfono'}
				</button>
				<p class="mt-2 text-center text-xs text-white/45">
					Te avisamos {pushWindowsLabel}, sin instalar nada.
				</p>
				{#if pushState === 'error'}
					<p class="ux-empty mt-2">
						{pushMessage || 'No pudimos activar las notificaciones. Agregá el turno al calendario y volvé a intentar.'}
					</p>
				{/if}
			{/if}
			{#if pushMessage && pushState !== 'error'}
				<p class="ux-empty mt-2">{pushMessage}</p>
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
		<h2 class="ux-section-title">{needsCalendarUpdate ? 'Actualizá el calendario' : 'No te lo olvides'}</h2>
		<p class="mt-2 text-sm text-white/70">{reminderIntro}</p>

		{#if device === 'android'}
			{@render pushBlock(true)}
		{/if}

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
						<a
							href={option.href}
							class="ux-choice flex items-center justify-between px-5 py-4"
							onclick={option.isIntent ? reportIntentAttempt : undefined}
						>
							<span class="font-bold text-white">{option.label}</span>
							{#if option.hint}
								<span class="ux-badge">{option.hint}</span>
							{/if}
						</a>
					{/each}
				</div>
				{#if device === 'android'}
					<p class="mt-4 text-xs text-white/45">
						El evento guarda la dirección y este enlace; los avisos dependen de los
						recordatorios habituales de tu calendario.
						{#if pushState !== 'unavailable'}
							Para avisos {pushWindowsLabel}, activá los avisos en este teléfono.
						{/if}
					</p>
					<p class="mt-2 text-xs text-white/35">
						<a href={`${base}/calendario-descargar.ics`} class="underline">
							Descargar archivo de calendario (.ics)
						</a>
					</p>
				{:else}
					<p class="mt-4 text-xs text-white/45">
						El evento incluye avisos sugeridos 24 horas y 2 horas antes, la dirección y este enlace.
						Algunos calendarios usan tus recordatorios habituales.
					</p>
				{/if}
			</div>
		</details>

		{#if device !== 'android'}
			{@render pushBlock(false)}
		{/if}

		<details class="mt-3 rounded-2xl border border-white/10 bg-white/[0.02]">
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
			<h1 class="ux-title mt-4">{data.created ? 'Listo, tu turno quedó reservado' : 'Tu turno'}</h1>
			{#if isActive && whenLabels}
				<p class="ux-subtitle">Te esperamos el {whenLabels.full}.</p>
			{:else}
				<p class="ux-subtitle">{data.message}</p>
			{/if}
			{#if form?.message}
				<p class={form.success ? 'ux-alert ux-alert-success mt-5' : 'ux-alert mt-5'}>{form.message}</p>
			{/if}
		</section>

		{#if appointment}
			{#if needsCalendarUpdate && isActive}
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
					<p class="mt-3 text-sm text-white/70">
						Si lo habías agregado al calendario, eliminá el evento.
					</p>
					<p class="mt-3 text-xs text-white/45">
						<a href={`${base}/calendario.ics`} class="underline">Descargar actualización de calendario</a>
						(marca el evento como cancelado en calendarios compatibles).
					</p>
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
