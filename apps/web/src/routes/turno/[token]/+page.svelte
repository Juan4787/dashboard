<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
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
	type PushState = 'unavailable' | 'idle' | 'working' | 'subscribed' | 'denied' | 'error';
	let pushState = $state<PushState>('unavailable');

	onMount(async () => {
		refinedDevice = refineDeviceClass(data.device, navigator);
		const effective = refinedDevice ?? data.device;
		if (
			data.vapidPublicKey &&
			effective !== 'ios' &&
			'serviceWorker' in navigator &&
			'PushManager' in window &&
			'Notification' in window
		) {
			pushState = 'idle';
			try {
				const registration = await navigator.serviceWorker.getRegistration('/push-sw.js');
				if (await registration?.pushManager.getSubscription()) pushState = 'subscribed';
			} catch {
				pushState = 'idle';
			}
		}
	});

	const urlBase64ToUint8Array = (base64: string) => {
		const padding = '='.repeat((4 - (base64.length % 4)) % 4);
		const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
		return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
	};

	const enablePush = async () => {
		if (!data.vapidPublicKey) return;
		pushState = 'working';
		try {
			const permission = await Notification.requestPermission();
			if (permission !== 'granted') {
				pushState = 'denied';
				return;
			}
			const registration = await navigator.serviceWorker.register('/push-sw.js');
			await navigator.serviceWorker.ready;
			const subscription =
				(await registration.pushManager.getSubscription()) ??
				(await registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: urlBase64ToUint8Array(data.vapidPublicKey)
				}));
			const response = await fetch(`${base}/push`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(subscription.toJSON())
			});
			pushState = response.ok ? 'subscribed' : 'error';
		} catch {
			pushState = 'error';
		}
	};

	const base = $derived(appointment ? `/turno/${appointment.token}` : '');
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

	type CalendarOption = { label: string; href: string; hint?: string };
	const calendarOptions = $derived.by((): CalendarOption[] => {
		if (!appointment) return [];
		if (device === 'ios') {
			return [
				{ label: 'Calendario del iPhone', href: `${base}/calendario.ics?p=phone`, hint: 'Recomendado' },
				{ label: 'Google Calendar', href: `${base}/ir/google` }
			];
		}
		if (device === 'android') {
			return [
				{ label: 'Google Calendar', href: `${base}/ir/google`, hint: 'Recomendado' },
				{ label: 'Calendario del teléfono', href: `${base}/calendario.ics?p=phone` }
			];
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

	const copyDetailsText = $derived.by(() => {
		if (!appointment || !whenLabels) return '';
		const lines = [
			'Tenés un turno reservado.',
			'',
			`Fecha: ${whenLabels.dateLabel}`,
			`Hora local del consultorio: ${whenLabels.timeLabel}`,
			`Profesional: ${appointment.professional_name_snapshot}`,
			`Consultorio: ${appointment.business.name}`
		];
		if (appointment.business.address) lines.push(`Dirección: ${appointment.business.address}`);
		if (appointment.business.address_instructions) {
			lines.push(`Indicaciones: ${appointment.business.address_instructions}`);
		}
		if (appointment.business.maps_link) lines.push(`Cómo llegar: ${appointment.business.maps_link}`);
		lines.push(`Ver turno: ${page.url.origin}${base}`);
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
						<p class="text-sm font-bold text-white/55">Profesional</p>
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
			</section>

			{#if !data.isSoon && appointment.business.address}
				{@render locationCard()}
			{/if}

			{#if isActive}
				<section class="ux-card">
					<h2 class="ux-section-title">{needsCalendarUpdate ? 'Actualizá el calendario' : 'No te lo olvides'}</h2>
					<p class="mt-2 text-sm text-white/70">
						{needsCalendarUpdate
							? 'El turno cambió de fecha. Agregalo de nuevo para que tu calendario tenga el horario correcto.'
							: 'Agregá el turno a tu calendario para recibir avisos antes y tener la dirección a mano.'}
					</p>

					<details class="mt-5 rounded-2xl border border-white/10 bg-white/[0.035]">
						<summary class="ux-btn-primary block w-full cursor-pointer list-none text-center">
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

					{#if pushState !== 'unavailable'}
						<div class="mt-3">
							{#if pushState === 'subscribed'}
								<p class="ux-alert ux-alert-success">
									🔔 Recordatorio activado en este dispositivo. Igual te recomendamos guardar el
									turno en tu calendario.
								</p>
							{:else if pushState === 'denied'}
								<p class="ux-empty">
									Las notificaciones están bloqueadas en este navegador. El calendario sigue
									siendo la mejor opción.
								</p>
							{:else}
								<button
									type="button"
									class="ux-btn-secondary w-full"
									disabled={pushState === 'working'}
									onclick={enablePush}
								>
									{pushState === 'working' ? 'Activando…' : '🔔 Recibir recordatorio en este dispositivo'}
								</button>
								{#if pushState === 'error'}
									<p class="ux-empty mt-2">No se pudo activar el recordatorio. Usá el calendario.</p>
								{/if}
							{/if}
						</div>
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
