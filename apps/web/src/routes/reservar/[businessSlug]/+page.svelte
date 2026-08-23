<script lang="ts">
	import { enhance } from '$app/forms';
	import { afterNavigate } from '$app/navigation';
	import { navigating, page } from '$app/state';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { formatInTimeZone } from '$lib/utils/format';
	import {
		isValidPatientFullName,
		normalizePatientFullName,
		PATIENT_FULL_NAME_ERROR_MESSAGE
	} from '$lib/utils/patient-name';

	type Service = {
		id: string;
		name: string;
		description: string | null;
		duration_minutes: number;
		price_label: string | null;
	};
	type Professional = { id: string; name: string; specialty: string | null; avatar_url?: string | null; next_available_at?: string | null };
	type Slot = {
		date: string;
		time: string;
		starts_at: string;
		ends_at: string;
		professional_id: string;
		professional_name: string;
		professional_ids?: string[];
		professional_names?: string[];
		is_joint?: boolean;
	};
	type Day = { date: string; label: string; count: number };

	let { data, form } = $props<{
		data: {
			state: {
				business: any;
				services: Service[];
				professionals: Professional[];
				slots: Slot[];
				days: Day[];
				issue: string | null;
			};
			selected: {
				serviceId: string;
				bookingMode: 'individual' | 'joint';
				professionalId: string;
				professionalIds: string[];
				date: string;
			};
			mapsLink: string | null;
			turnstileSiteKey: string | null;
			bookingRequestId: string;
			demo: boolean;
		};
		form?: { message?: string; values?: Record<string, unknown> };
	}>();

	const business = $derived(data.state.business);
	const timezone = $derived(business?.timezone ?? 'America/Argentina/Cordoba');
	const bookingPath = $derived(page.url.pathname);

	// ------------------------------------------------------------------
	// Selección efectiva. El `slot` vive SOLO en la URL (el load del server
	// no lo lee, así elegir horario no re-ejecuta el load: es instantáneo).
	// Durante una navegación pendiente se usa la URL destino: los pasos ya
	// resueltos colapsan al instante y el paso nuevo muestra skeleton.
	// ------------------------------------------------------------------
	const selectionFrom = (params: URLSearchParams) => {
		const professionalIds = [
			...new Set(
				params
					.getAll('professional_ids')
					.flatMap((value) => value.split(','))
					.map((value) => value.trim())
					.filter(Boolean)
			)
		];
		const bookingMode =
			params.get('booking_mode') === 'joint' || professionalIds.length > 1
				? ('joint' as const)
				: ('individual' as const);
		return {
			serviceId: params.get('service_id') ?? '',
			bookingMode,
			professionalId: bookingMode === 'individual' ? (params.get('professional_id') ?? '') : '',
			professionalIds: bookingMode === 'joint' ? professionalIds : [],
			date: params.get('date') ?? '',
			slot: params.get('slot') ?? ''
		};
	};
	const pendingSelection = $derived.by(() => {
		const to = navigating.to;
		if (!to || to.url.pathname !== page.url.pathname) return null;
		return selectionFrom(to.url.searchParams);
	});
	const selection = $derived(pendingSelection ?? selectionFrom(page.url.searchParams));

	// Una lista queda "stale" si la selección de la que depende cambió y el load
	// nuevo todavía está en vuelo: ahí va skeleton en lugar de datos viejos.
	const professionalsStale = $derived(
		Boolean(pendingSelection) && selection.serviceId !== data.selected.serviceId
	);
	const daysStale = $derived(
		professionalsStale ||
			(Boolean(pendingSelection) &&
				(selection.bookingMode !== data.selected.bookingMode ||
					selection.professionalId !== data.selected.professionalId ||
					selection.professionalIds.join(',') !== data.selected.professionalIds.join(',')))
	);
	const slotsStale = $derived(
		daysStale || (Boolean(pendingSelection) && selection.date !== data.selected.date)
	);

	const selectedService = $derived(
		data.state.services.find((service: Service) => service.id === selection.serviceId) ?? null
	);
	const selectedProfessional = $derived(
		data.state.professionals.find((professional: Professional) => professional.id === selection.professionalId) ?? null
	);
	const selectedProfessionals = $derived(
		selection.professionalIds
			.map((professionalId: string) =>
				data.state.professionals.find((professional: Professional) => professional.id === professionalId)
			)
			.filter((professional: Professional | undefined): professional is Professional => Boolean(professional))
	);
	const professionalSelectionComplete = $derived(
		selection.bookingMode === 'joint'
			? selection.professionalIds.length >= 2 &&
					selectedProfessionals.length === selection.professionalIds.length
			: Boolean(selectedProfessional)
	);
	const selectedDay = $derived(data.state.days.find((day: Day) => day.date === selection.date) ?? null);
	const selectedSlot = $derived(
		data.state.slots.find((slot: Slot) => slot.starts_at === selection.slot) ?? null
	);

	const step = $derived(
		!selectedService ? 1 : !professionalSelectionComplete ? 2 : !selection.date ? 3 : !selectedSlot ? 4 : 5
	);
	const stepNames = $derived([
		'Servicio',
		selection.bookingMode === 'joint' ? 'Equipo' : 'Profesional',
		'Día',
		'Horario',
		'Tus datos'
	]);

	const queryFor = (
		params: Partial<
			Record<
				'service_id' | 'booking_mode' | 'professional_id' | 'professional_ids' | 'date' | 'slot',
				string
			>
		>
	) => {
		const search = new URLSearchParams();
		const serviceId = params.service_id ?? selection.serviceId;
		const bookingMode = (params.booking_mode ?? selection.bookingMode) as 'individual' | 'joint';
		const professionalId = params.professional_id ?? selection.professionalId;
		const professionalIds = params.professional_ids ?? selection.professionalIds.join(',');
		const date = params.date ?? selection.date;
		const slot = params.slot ?? selection.slot;
		if (serviceId) search.set('service_id', serviceId);
		if (bookingMode === 'joint') {
			search.set('booking_mode', 'joint');
			if (professionalIds) search.set('professional_ids', professionalIds);
		} else if (professionalId) {
			search.set('professional_id', professionalId);
		}
		if (date) search.set('date', date);
		if (slot) search.set('slot', slot);
		const value = search.toString();
		return `${bookingPath}${value ? `?${value}` : ''}`;
	};
	const fatalIssue = $derived(
		data.state.issue && data.state.issue !== 'no_availability' ? data.state.issue : null
	);

	const issueMessages: Record<string, string> = {
		business_not_found: 'El enlace de reserva no está disponible.',
		booking_disabled: 'La reserva online no está disponible en este momento.',
		commercial_unavailable: 'La reserva online no está disponible en este momento. Contactá al consultorio.',
		missing_service_role:
			'La reserva online no está disponible en este momento. Reintentá en unos segundos o comunicate con el consultorio.',
		no_services: 'No hay servicios disponibles para reservar online en este momento.',
		no_professionals: 'No hay profesionales con horarios disponibles para ese servicio.',
		no_availability: 'No hay horarios disponibles para los próximos días.'
	};
	const values = $derived((form?.values ?? {}) as Record<string, unknown>);
	const durationLabel = (minutes: number) => `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
	const initialsFor = (name: string) =>
		name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((word) => word[0]?.toUpperCase() ?? '')
			.join('');
	// Horarios agrupados como los piensa el paciente: mañana / tarde.
	const morningSlots = $derived(data.state.slots.filter((slot: Slot) => slot.time < '13:00'));
	const afternoonSlots = $derived(data.state.slots.filter((slot: Slot) => slot.time >= '13:00'));

	let visibleDayCount = $state(6);
	const visibleDays = $derived(data.state.days.slice(0, visibleDayCount));
	let teamDraftIds = $state<string[]>([]);
	let teamDraftContext = $state('');
	$effect(() => {
		const nextContext = `${selection.serviceId}:${selection.bookingMode}:${selection.professionalIds.join(',')}`;
		if (teamDraftContext !== nextContext) {
			teamDraftContext = nextContext;
			teamDraftIds = [...selection.professionalIds];
		}
	});
	const orderedTeamDraftIds = $derived(
		data.state.professionals
			.filter((professional: Professional) => teamDraftIds.includes(professional.id))
			.map((professional: Professional) => professional.id)
	);
	const toggleTeamProfessional = (professionalId: string) => {
		teamDraftIds = teamDraftIds.includes(professionalId)
			? teamDraftIds.filter((id) => id !== professionalId)
			: [...teamDraftIds, professionalId];
	};
	const professionalSelectionLabel = $derived(
		selection.bookingMode === 'joint'
			? selectedProfessionals.map((professional: Professional) => professional.name).join(', ')
			: (selectedProfessional?.name ?? '')
	);

	// ------------------------------ Turnstile ------------------------------
	// Render explícito: el form aparece tras navegaciones client-side y el modo
	// implícito de Cloudflare solo escanea el DOM al cargar el documento.
	let turnstileContainer = $state<HTMLDivElement | null>(null);
	let turnstileWidgetId: string | null = null;

	$effect(() => {
		const el = turnstileContainer;
		if (!el || !data.turnstileSiteKey) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const tryRender = () => {
			if (cancelled) return;
			const api = (window as unknown as { turnstile?: any }).turnstile;
			if (!api) {
				timer = setTimeout(tryRender, 250);
				return;
			}
			if (el.childElementCount === 0) {
				turnstileWidgetId = api.render(el, { sitekey: data.turnstileSiteKey });
			}
		};
		tryRender();
		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
			turnstileWidgetId = null;
		};
	});

	const resetTurnstile = () => {
		const api = (window as unknown as { turnstile?: any }).turnstile;
		if (api && turnstileWidgetId !== null) {
			try {
				api.reset(turnstileWidgetId);
			} catch {
				/* el widget pudo desmontarse junto con el form */
			}
		}
	};

	let bookingSubmitting = $state(false);
	const validatePatientNameInput = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		input.setCustomValidity(
			input.value.length === 0 || isValidPatientFullName(input.value)
				? ''
				: PATIENT_FULL_NAME_ERROR_MESSAGE
		);
	};
	const normalizePatientNameInput = (event: FocusEvent) => {
		const input = event.currentTarget as HTMLInputElement;
		input.value = normalizePatientFullName(input.value);
		validatePatientNameInput(event);
	};
	const onBookingSubmit: SubmitFunction = () => {
		bookingSubmitting = true;
		return async ({ result, update }) => {
			await update({ reset: false });
			bookingSubmitting = false;
			// El token de Turnstile es de un solo uso: tras un intento fallido hay
			// que regenerarlo o el reintento moriría siempre en el captcha.
			if (result.type === 'failure') resetTurnstile();
			requestAnimationFrame(() => activeStepCard?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
		};
	};

	// Solo hay UNA card de paso activa a la vez: los pasos resueltos colapsan.
	let activeStepCard = $state<HTMLElement | null>(null);
	afterNavigate(({ from, to }) => {
		if (!from || !to || from.url.pathname !== to.url.pathname) return;
		if (from.url.search === to.url.search) return;
		requestAnimationFrame(() => activeStepCard?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
	});
</script>

{#snippet doneStep(label: string, value: string, changeHref: string)}
	<div class="ux-soft-card flex items-center justify-between gap-3 px-4 py-3">
		<div class="min-w-0">
			<p class="text-[11px] font-bold uppercase tracking-wider text-white/40">{label}</p>
			<p class="truncate text-base font-bold text-white">{value}</p>
		</div>
		<a data-sveltekit-noscroll href={changeHref} class="shrink-0 text-sm font-bold text-[#a78bfa] hover:underline">
			Cambiar
		</a>
	</div>
{/snippet}

{#snippet stepSkeleton(title: string, hint: string)}
	<section class="ux-card scroll-mt-5" bind:this={activeStepCard}>
		<h2 class="ux-section-title">{title}</h2>
		<div class="mt-5 grid gap-3 sm:grid-cols-2" aria-hidden="true">
			{#each [0, 1, 2, 3] as placeholder (placeholder)}
				<div class="skeleton-shimmer relative h-16 overflow-hidden rounded-2xl border border-white/5 bg-white/[0.05]"></div>
			{/each}
		</div>
		<p class="mt-4 text-sm text-white/45" role="status">{hint}</p>
	</section>
{/snippet}

<svelte:head>
	<title>{business?.name ? `Reservar turno · ${business.name}` : 'Reserva online'}</title>
	{#if data.turnstileSiteKey}
		<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
	{/if}
</svelte:head>

<main class="min-h-screen bg-[#06111f] px-4 py-5 text-white sm:py-8">
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-4">
		<header class="ux-hero">
			<div class="flex items-start gap-4">
				{#if business?.logo_url}
					<img src={business.logo_url} alt={business.name} class="h-16 w-16 shrink-0 rounded-2xl object-cover" />
				{:else}
					<div class="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-[#7c3aed] text-lg font-bold text-white">
						{business?.name?.slice(0, 2).toUpperCase() ?? 'RS'}
					</div>
				{/if}
				<div class="min-w-0">
					<p class="ux-badge">Reserva online</p>
					<h1 class="mt-3 text-2xl font-bold text-white sm:text-3xl">{business?.name ?? 'Reserva online'}</h1>
					{#if business?.address || business?.phone}
						<p class="mt-2 text-sm text-white/55">
							{business.address ?? ''}{business.address && business.phone ? ' · ' : ''}{business.phone ?? ''}
							{#if data.mapsLink && business.address}
								· <a href={data.mapsLink} target="_blank" rel="noreferrer" class="font-bold text-white/80 underline">Cómo llegar</a>
							{/if}
						</p>
					{/if}
				</div>
			</div>
		</header>

		{#if fatalIssue}
			<section class="ux-card">
				<p class="text-lg font-bold text-white">{issueMessages[fatalIssue] ?? 'No se pudo cargar la reserva online.'}</p>
				{#if business?.phone}
					<p class="mt-2 text-sm text-white/55">Contactá al consultorio: {business.phone}</p>
				{/if}
				<a href={bookingPath} class="ux-btn-secondary mt-5 inline-flex">Volver a empezar</a>
			</section>
		{:else}
			<section class="ux-card py-4">
				<div class="flex items-center justify-between gap-3">
					<p class="text-sm font-bold text-white/70">Paso {step} de 5 · {stepNames[step - 1]}</p>
					{#if step > 1}
						<a data-sveltekit-noscroll href={bookingPath} class="text-xs font-bold text-white/45 hover:text-white/70">
							Empezar de nuevo
						</a>
					{/if}
				</div>
				<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
					<div class="h-full rounded-full bg-[#7c3aed] transition-all duration-300" style={`width:${(step / 5) * 100}%`}></div>
				</div>
			</section>

			<!-- Paso 1 · Servicio -->
			{#if step === 1}
				<section class="ux-card scroll-mt-5" bind:this={activeStepCard}>
					<h2 class="ux-section-title">¿Qué necesitás?</h2>
					<div class="mt-5 grid gap-3 sm:grid-cols-2">
						{#each data.state.services as service (service.id)}
							<a
								data-sveltekit-noscroll
								data-sveltekit-preload-data="hover"
								href={queryFor({
									service_id: service.id,
									booking_mode: 'individual',
									professional_id: '',
									professional_ids: '',
									date: '',
									slot: ''
								})}
								class="ux-choice p-5"
							>
								<p class="text-lg font-bold text-white">{service.name}</p>
								{#if service.description}
									<p class="mt-1 text-sm text-white/55">{service.description}</p>
								{/if}
								<p class="mt-2 text-sm font-semibold text-white/55">
									{durationLabel(service.duration_minutes)}{service.price_label ? ` · ${service.price_label}` : ''}
								</p>
							</a>
						{/each}
					</div>
				</section>
			{:else if selectedService}
				{@render doneStep(
					'Servicio',
					`${selectedService.name} · ${durationLabel(selectedService.duration_minutes)}`,
					queryFor({
						service_id: '',
						booking_mode: 'individual',
						professional_id: '',
						professional_ids: '',
						date: '',
						slot: ''
					})
				)}
			{/if}

			<!-- Paso 2 · Profesional -->
			{#if step === 2}
				{#if professionalsStale}
					{@render stepSkeleton('¿Con quién?', 'Cargando los profesionales que realizan este procedimiento…')}
				{:else}
					<section class="ux-card scroll-mt-5" bind:this={activeStepCard}>
						<h2 class="ux-section-title">¿Con quién?</h2>
						<div class="mt-5 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-1.5">
							<a
								data-sveltekit-noscroll
								href={queryFor({
									booking_mode: 'individual',
									professional_id: '',
									professional_ids: '',
									date: '',
									slot: ''
								})}
								aria-current={selection.bookingMode === 'individual' ? 'true' : undefined}
								class={`rounded-xl px-3 py-3 text-center text-sm font-bold transition ${
									selection.bookingMode === 'individual'
										? 'bg-[#7c3aed] text-white shadow-lg shadow-violet-950/30'
										: 'text-white/60 hover:bg-white/[0.06] hover:text-white'
								}`}
							>
								Un profesional
							</a>
							{#if data.state.professionals.length >= 2}
								<a
									data-sveltekit-noscroll
									href={queryFor({
										booking_mode: 'joint',
										professional_id: '',
										professional_ids: '',
										date: '',
										slot: ''
									})}
									aria-current={selection.bookingMode === 'joint' ? 'true' : undefined}
									class={`rounded-xl px-3 py-3 text-center text-sm font-bold transition ${
										selection.bookingMode === 'joint'
											? 'bg-[#7c3aed] text-white shadow-lg shadow-violet-950/30'
											: 'text-white/60 hover:bg-white/[0.06] hover:text-white'
									}`}
								>
									Equipo de profesionales
								</a>
							{:else}
								<span
									aria-disabled="true"
									class="cursor-not-allowed rounded-xl px-3 py-3 text-center text-sm font-bold text-white/25"
									title="Este procedimiento tiene un solo profesional disponible."
								>
									Equipo de profesionales
								</span>
							{/if}
						</div>

						{#if selection.bookingMode === 'joint'}
							<p class="mt-4 text-sm leading-relaxed text-white/55">
								Seleccioná dos o más integrantes. Sólo te mostraremos días y horarios en los que todo el
								equipo pueda atender al mismo tiempo.
							</p>
							<div class="mt-4 grid gap-3 sm:grid-cols-2">
								{#each data.state.professionals as professional (professional.id)}
									<button
										type="button"
										aria-pressed={teamDraftIds.includes(professional.id)}
										onclick={() => toggleTeamProfessional(professional.id)}
										class={`ux-choice flex min-h-24 items-start gap-4 p-5 text-left ${
											teamDraftIds.includes(professional.id)
												? 'border-[#8b5cf6] bg-[#7c3aed]/20 ring-1 ring-[#8b5cf6]/50'
												: ''
										}`}
									>
										{#if professional.avatar_url}
											<img src={professional.avatar_url} alt="" class="h-12 w-12 shrink-0 rounded-full object-cover" />
										{:else}
											<div class="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-bold text-white/80">
												{initialsFor(professional.name)}
											</div>
										{/if}
										<div class="min-w-0 flex-1">
											<p class="text-lg font-bold text-white">{professional.name}</p>
											<p class="mt-0.5 text-sm text-white/55">{professional.specialty ?? 'Profesional'}</p>
										</div>
										<span
											aria-hidden="true"
											class={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-sm font-black ${
												teamDraftIds.includes(professional.id)
													? 'border-[#a78bfa] bg-[#7c3aed] text-white'
													: 'border-white/20 text-transparent'
											}`}
										>
											✓
										</span>
									</button>
								{/each}
							</div>
							<p class="mt-4 text-sm font-semibold text-white/60" aria-live="polite">
								{orderedTeamDraftIds.length === 0
									? 'Todavía no seleccionaste integrantes.'
									: `${orderedTeamDraftIds.length} ${
											orderedTeamDraftIds.length === 1 ? 'integrante seleccionado' : 'integrantes seleccionados'
										}.`}
							</p>
							{#if orderedTeamDraftIds.length >= 2}
								<a
									data-sveltekit-noscroll
									href={queryFor({
										booking_mode: 'joint',
										professional_id: '',
										professional_ids: orderedTeamDraftIds.join(','),
										date: '',
										slot: ''
									})}
									class="ux-btn-primary mt-4 flex w-full items-center justify-center"
								>
									Buscar horarios para todo el equipo
								</a>
							{:else}
								<button type="button" disabled class="ux-btn-primary mt-4 w-full opacity-45">
									Seleccioná al menos dos profesionales
								</button>
							{/if}
						{:else}
							<p class="mt-4 text-sm text-white/55">Elegí quién realizará el procedimiento.</p>
							<div class="mt-4 grid gap-3 sm:grid-cols-2">
								{#each data.state.professionals as professional (professional.id)}
									<a
										data-sveltekit-noscroll
										data-sveltekit-preload-data="hover"
										href={queryFor({
											booking_mode: 'individual',
											professional_id: professional.id,
											professional_ids: '',
											date: '',
											slot: ''
										})}
										class="ux-choice flex min-h-24 items-start gap-4 p-5"
									>
										{#if professional.avatar_url}
											<img src={professional.avatar_url} alt="" class="h-12 w-12 shrink-0 rounded-full object-cover" />
										{:else}
											<div class="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-bold text-white/80">
												{initialsFor(professional.name)}
											</div>
										{/if}
										<div class="min-w-0">
											<p class="text-lg font-bold text-white">{professional.name}</p>
											<p class="mt-0.5 text-sm text-white/55">{professional.specialty ?? 'Profesional'}</p>
										</div>
									</a>
								{/each}
							</div>
						{/if}
					</section>
				{/if}
			{:else if step > 2 && professionalSelectionComplete}
				{@render doneStep(
					selection.bookingMode === 'joint' ? 'Equipo' : 'Profesional',
					professionalSelectionLabel,
					queryFor({
						booking_mode: selection.bookingMode,
						professional_id: '',
						professional_ids: '',
						date: '',
						slot: ''
					})
				)}
			{/if}

			<!-- Paso 3 · Día -->
			{#if step === 3}
				{#if daysStale}
					{@render stepSkeleton('Elegí un día', 'Buscando días con horarios libres…')}
				{:else}
					<section class="ux-card scroll-mt-5" bind:this={activeStepCard}>
						<h2 class="ux-section-title">Elegí un día</h2>
						<div class="mt-5 grid gap-3 sm:grid-cols-2">
							{#each visibleDays as day (day.date)}
								<a
									data-sveltekit-noscroll
									data-sveltekit-preload-data="hover"
									href={queryFor({ date: day.date, slot: '' })}
									class="ux-choice px-4 py-3"
								>
									<span class="block font-bold text-white">{day.label}</span>
									<span class="mt-0.5 block text-sm text-white/50">
										Horarios disponibles
									</span>
								</a>
							{/each}
						</div>
						{#if visibleDayCount < data.state.days.length}
							<button
								type="button"
								class="ux-btn-secondary mt-4 w-full"
								onclick={() => (visibleDayCount = Math.min(visibleDayCount + 6, data.state.days.length))}
							>
								Ver más días
							</button>
						{/if}
						{#if data.state.days.length === 0}
							<div class="ux-empty mt-4">
								<p class="font-bold text-white/80">
									{selection.bookingMode === 'joint'
										? 'No encontramos un horario común para todo el equipo seleccionado.'
										: 'No encontramos horarios para ese profesional.'}
								</p>
								<p class="mt-2 text-sm text-white/55">
									{selection.bookingMode === 'joint'
										? 'Volvé al paso del equipo, cambiá uno o más integrantes y buscá nuevamente.'
										: 'Volvé al paso anterior y elegí otro profesional.'}
								</p>
								<a
									data-sveltekit-noscroll
									href={queryFor({
										booking_mode: selection.bookingMode,
										professional_id: '',
										professional_ids: '',
										date: '',
										slot: ''
									})}
									class="mt-4 inline-flex font-bold text-[#a78bfa] hover:underline"
								>
									{selection.bookingMode === 'joint' ? 'Cambiar el equipo' : 'Cambiar el profesional'}
								</a>
							</div>
						{/if}
					</section>
				{/if}
			{:else if step > 3}
				{@render doneStep('Día', selectedDay?.label ?? selection.date, queryFor({ date: '', slot: '' }))}
			{/if}

			<!-- Paso 4 · Horario -->
			{#if step === 4}
				{#if slotsStale}
					{@render stepSkeleton('Elegí un horario', 'Buscando horarios libres…')}
				{:else}
					<section class="ux-card scroll-mt-5" bind:this={activeStepCard}>
						<h2 class="ux-section-title">Elegí un horario</h2>
						{#if morningSlots.length > 0}
							<p class="mt-5 text-[11px] font-bold uppercase tracking-wider text-white/40">Mañana</p>
							<div class="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
								{#each morningSlots as slot (slot.starts_at)}
									<a
										data-sveltekit-noscroll
										href={queryFor({ slot: slot.starts_at })}
										class="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-center text-sm font-bold text-white transition hover:border-[#8b5cf6]/70 hover:bg-white/[0.08]"
									>
										{slot.time}
									</a>
								{/each}
							</div>
						{/if}
						{#if afternoonSlots.length > 0}
							<p class="mt-5 text-[11px] font-bold uppercase tracking-wider text-white/40">Tarde</p>
							<div class="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
								{#each afternoonSlots as slot (slot.starts_at)}
									<a
										data-sveltekit-noscroll
										href={queryFor({ slot: slot.starts_at })}
										class="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-center text-sm font-bold text-white transition hover:border-[#8b5cf6]/70 hover:bg-white/[0.08]"
									>
										{slot.time}
									</a>
								{/each}
							</div>
						{/if}
						{#if data.state.slots.length === 0}
							<p class="ux-empty mt-4">No hay horarios para ese día. Probá con otro día.</p>
						{/if}
					</section>
				{/if}
			{:else if step > 4 && selectedSlot}
				{@render doneStep('Horario', `${selectedDay?.label ?? ''} · ${selectedSlot.time} h`, queryFor({ slot: '' }))}
			{/if}

			<!-- Paso 5 · Datos del paciente -->
			{#if step === 5 && selectedService && professionalSelectionComplete && selectedSlot}
				<form
					method="POST"
					action="?/create_booking"
					class="ux-card scroll-mt-5"
					bind:this={activeStepCard}
					use:enhance={onBookingSubmit}
				>
					<h2 class="ux-section-title">Tus datos</h2>
					<div class="ux-soft-card mt-5 p-5">
						<p class="text-[11px] font-bold uppercase tracking-wider text-white/40">Estás reservando</p>
						<p class="mt-2 text-lg font-bold text-white">
							{selectedService.name}
							{selection.bookingMode === 'joint' ? 'con el equipo' : 'con'}
							{professionalSelectionLabel}
						</p>
						<p class="mt-1 text-sm text-white/60">
							{formatInTimeZone(selectedSlot.starts_at, timezone).full} h · {durationLabel(selectedService.duration_minutes)}
						</p>
					</div>

					<input type="hidden" name="service_id" value={selectedService.id} />
					<input type="hidden" name="booking_mode" value={selection.bookingMode} />
					<input
						type="hidden"
						name="professional_id"
						value={selectedProfessional?.id ?? selection.professionalIds[0] ?? ''}
					/>
					{#if selection.bookingMode === 'joint'}
						<input type="hidden" name="professional_ids" value={selection.professionalIds.join(',')} />
					{/if}
					<input type="hidden" name="slot_starts_at" value={selectedSlot.starts_at} />
					<input
						type="hidden"
						name="idempotency_key"
						value={String(values.idempotency_key ?? data.bookingRequestId)}
					/>

					<div class="mt-5 grid gap-4">
						<label>
							<span class="ux-label">Nombre y apellido</span>
							<input
								name="patient_name"
								required
								minlength="5"
								pattern=".*[^ ] +[^ ].*"
								title={PATIENT_FULL_NAME_ERROR_MESSAGE}
								autocomplete="name"
								value={String(values.patient_name ?? '')}
								oninput={validatePatientNameInput}
								onblur={normalizePatientNameInput}
								class="ux-input"
							/>
						</label>
						<label>
							<span class="ux-label">Teléfono (con WhatsApp si tenés)</span>
							<input
								name="patient_phone"
								required
								inputmode="tel"
								autocomplete="tel"
								placeholder="351 555 0101"
								value={String(values.patient_phone ?? '')}
								class="ux-input"
							/>
						</label>
						<label>
							<span class="ux-label">Correo electrónico (opcional)</span>
							<input
								name="patient_email"
								type="email"
								autocomplete="email"
								value={String(values.patient_email ?? '')}
								class="ux-input"
							/>
						</label>
						<label>
							<span class="ux-label">Comentario (opcional)</span>
							<textarea name="note" rows="3" class="ux-textarea">{String(values.note ?? '')}</textarea>
						</label>
					</div>

					{#if data.turnstileSiteKey}
						<div class="mt-5" bind:this={turnstileContainer}></div>
					{/if}
					{#if form?.message}
						<p class="ux-alert mt-5" role="alert">{form.message}</p>
					{/if}

					<button type="submit" disabled={bookingSubmitting} class="ux-btn-primary mt-5 w-full">
						{bookingSubmitting ? 'Confirmando reserva…' : 'Confirmar reserva'}
					</button>
					<p class="mt-3 text-center text-xs text-white/45">
						Al confirmar vas a ver tu turno con la dirección, y un enlace para agregarlo al calendario,
						reprogramarlo o cancelarlo.
					</p>
					{#if business?.cancellation_policy}
						<p class="ux-empty mt-4">{business.cancellation_policy}</p>
					{/if}
				</form>
			{/if}

			{#if data.demo}
				<p class="ux-empty">Modo demo: la reserva no crea turnos reales.</p>
			{/if}
		{/if}
	</div>
</main>
