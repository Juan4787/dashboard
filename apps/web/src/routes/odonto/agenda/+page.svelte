<script lang="ts">
	import ManualAppointmentWizard from '$lib/components/agenda/ManualAppointmentWizard.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { tick } from 'svelte';
	import { slide } from 'svelte/transition';

	type Appointment = {
		id: string;
		patient_id: string;
		service_id: string;
		professional_id: string;
		starts_at: string;
		ends_at: string;
		status: string;
		source: string;
		service_name_snapshot: string;
		professional_name_snapshot: string;
		internal_note: string | null;
		patients?: { full_name: string; phone_e164: string | null; dni?: string | null; email?: string | null } | null;
	};
	type Professional = { id: string; name: string; specialty?: string | null; is_active: boolean };
	type Service = { id: string; name: string; duration_minutes: number };
	type Patient = { id: string; full_name: string; phone_e164: string | null; blocked: boolean };
	type Stat = { status: string; count: number };

	let { data, form } = $props<{
		data: {
			context: { canOperate: boolean };
			date: string;
			selectedProfessionalId: string;
			selectedStatus: string;
			selectedServiceId: string;
			selectedQuery: string;
			selectedPatientId: string;
			searchApplied: boolean;
			appointments: Appointment[];
			stats: Stat[];
			totalAppointments: number;
			professionals: Professional[];
			services: Service[];
			serviceProfessionalIds: Record<string, string[]>;
			patients: Patient[];
			demo: boolean;
		};
		form?: { message?: string; values?: Record<string, unknown> };
	}>();

	const canOperate = $derived(data.context.canOperate && !data.demo);
	let showCreate = $state(false);
	let showSearch = $state(false);
	let initialized = $state(false);
	let createSection = $state<HTMLElement | null>(null);
	let searchSection = $state<HTMLElement | null>(null);

	const statusLabels: Record<string, string> = {
		reserved: 'Reservado',
		confirmed: 'Confirmado',
		cancelled: 'Cancelado',
		reschedule_requested: 'Reprogramar',
		attended: 'Asistió',
		no_show: 'No asistió'
	};

	const statusTone: Record<string, string> = {
		reserved: 'ux-badge',
		confirmed: 'ux-badge ux-badge-success',
		cancelled: 'ux-badge ux-badge-danger',
		reschedule_requested: 'ux-badge ux-badge-warning',
		attended: 'ux-badge ux-badge-success',
		no_show: 'ux-badge ux-badge-danger'
	};

	const timeOnly = (value: string) =>
		new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));

	const dayLabel = (value: string) => {
		const label = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(
			new Date(`${value}T12:00:00`)
		);
		return label.charAt(0).toUpperCase() + label.slice(1);
	};

	const statCount = (status: string) => data.stats.find((stat: Stat) => stat.status === status)?.count ?? 0;
	const statusFilterEntries = $derived(Object.entries(statusLabels));
	const hasActiveSearch = $derived(
		Boolean(data.selectedProfessionalId || data.selectedStatus || data.selectedServiceId || data.selectedQuery)
	);
	const resultLabel = $derived(
		`${data.appointments.length} ${data.appointments.length === 1 ? 'turno' : 'turnos'}`
	);
	const searchSummary = $derived.by(() => {
		const parts: string[] = [];
		if (data.selectedQuery) parts.push(`"${data.selectedQuery}"`);
		const professional = data.professionals.find((item: Professional) => item.id === data.selectedProfessionalId);
		if (professional) parts.push(professional.name);
		const service = data.services.find((item: Service) => item.id === data.selectedServiceId);
		if (service) parts.push(service.name);
		if (data.selectedStatus) parts.push(statusLabels[data.selectedStatus] ?? data.selectedStatus);
		return parts.join(' · ');
	});

	// Navegación por día (preserva los filtros activos).
	const shiftDate = (value: string, days: number) => {
		const d = new Date(`${value}T12:00:00`);
		d.setDate(d.getDate() + days);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	};
	const today = new Date();
	const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
	const prevDate = $derived(shiftDate(data.date, -1));
	const nextDate = $derived(shiftDate(data.date, 1));
	const isToday = $derived(data.date === todayStr);
	const buildAgendaHref = (date: string) => {
		const params = new URLSearchParams();
		params.set('date', date);
		if (data.selectedProfessionalId) params.set('professional_id', data.selectedProfessionalId);
		if (data.selectedServiceId) params.set('service_id', data.selectedServiceId);
		if (data.selectedStatus) params.set('status', data.selectedStatus);
		if (data.selectedQuery) params.set('q', data.selectedQuery);
		return `/odonto/agenda?${params.toString()}`;
	};
	const weekHref = $derived(
		`/odonto/agenda/semana?date=${data.date}${data.selectedProfessionalId ? `&professional_id=${data.selectedProfessionalId}` : ''}`
	);

	const needsSetup = $derived(data.professionals.length === 0 || data.services.length === 0);

	const scrollToElement = async (element: HTMLElement | null) => {
		await tick();
		if (!element) return;
		requestAnimationFrame(() => element.scrollIntoView({ behavior: 'smooth', block: 'start' }));
	};

	const toggleCreate = async () => {
		showCreate = !showCreate;
		if (showCreate) await scrollToElement(createSection);
	};

	const toggleSearch = async () => {
		showSearch = !showSearch;
		if (showSearch) await scrollToElement(searchSection);
	};

	$effect(() => {
		if (initialized) return;
		showCreate = Boolean(form?.message || data.selectedPatientId);
		showSearch = Boolean(hasActiveSearch || form?.message);
		initialized = true;
	});
</script>

<section class="ux-page">
	<div class="ux-hero">
		<div class="flex items-center gap-2">
			<a
				href={buildAgendaHref(prevDate)}
				class="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/80 transition hover:bg-white/10"
				aria-label="Día anterior"
			>
				<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6" /></svg>
			</a>
			<div class="min-w-0 flex-1 text-center">
				<h1 class="text-lg font-bold leading-tight tracking-tight text-white sm:text-2xl lg:text-4xl">{dayLabel(data.date)}</h1>
			</div>
			<a
				href={buildAgendaHref(nextDate)}
				class="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/80 transition hover:bg-white/10"
				aria-label="Día siguiente"
			>
				<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m10 6 6 6-6 6" /></svg>
			</a>
		</div>

		<div class="mt-5 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
			{#if canOperate}
				<button type="button" class="ux-btn-primary w-full sm:w-auto" onclick={toggleCreate}>
					{showCreate ? 'Cerrar' : '+ Nuevo turno'}
				</button>
			{/if}
			{#if !isToday}
				<a href={buildAgendaHref(todayStr)} class="ux-btn-secondary">Hoy</a>
			{/if}
			<button type="button" class="ux-btn-secondary" onclick={toggleSearch}>
				{showSearch ? 'Ocultar búsqueda' : 'Buscar'}
			</button>
			<a href={weekHref} class="ux-btn-secondary">Semana</a>
		</div>
	</div>

	{#if form?.message}
		<p class="ux-alert">{form.message}</p>
	{/if}

	{#if statCount('reschedule_requested') > 0}
		<div class="ux-alert ux-alert-warning">
			{statCount('reschedule_requested')} {statCount('reschedule_requested') === 1 ? 'turno pidió' : 'turnos pidieron'} reprogramación.
		</div>
	{/if}

	{#if needsSetup}
		<div class="ux-card">
			<h2 class="ux-section-title">Antes de tomar turnos</h2>
			<p class="mt-1 text-sm text-white/55">Completá lo básico para poder agendar.</p>
			<div class="mt-4 flex flex-wrap gap-2">
				{#if data.professionals.length === 0}
					<a href="/odonto/profesionales" class="ux-btn-primary">Cargar profesional</a>
				{/if}
				{#if data.services.length === 0}
					<a href="/odonto/profesionales" class="ux-btn-secondary">Cargar servicio</a>
				{/if}
			</div>
		</div>
	{/if}

	{#if showSearch}
		<div transition:slide={{ duration: 180 }} class="ux-card scroll-mt-5" bind:this={searchSection}>
			<form method="GET" class="grid gap-4 lg:grid-cols-[1.25fr_1fr_1fr_1fr_1fr_auto]">
				<label>
					<span class="ux-label">Paciente, teléfono o servicio</span>
					<input name="q" value={data.selectedQuery} placeholder="Buscar turno" class="ux-input" />
				</label>
				<label>
					<span class="ux-label">Día</span>
					<input type="date" name="date" value={data.date} class="ux-input" />
				</label>
				<label>
					<span class="ux-label">Profesional</span>
					<select name="professional_id" class="ux-select">
						<option value="">Todos</option>
						{#each data.professionals as professional}
							<option value={professional.id} selected={professional.id === data.selectedProfessionalId}>{professional.name}</option>
						{/each}
					</select>
				</label>
				<label>
					<span class="ux-label">Servicio</span>
					<select name="service_id" class="ux-select">
						<option value="">Todos</option>
						{#each data.services as service}
							<option value={service.id} selected={service.id === data.selectedServiceId}>{service.name}</option>
						{/each}
					</select>
				</label>
				<label>
					<span class="ux-label">Estado</span>
					<select name="status" class="ux-select">
						<option value="">Todos</option>
						{#each statusFilterEntries as [value, label]}
							<option value={value} selected={value === data.selectedStatus}>{label}</option>
						{/each}
					</select>
				</label>
				<button class="ux-btn-primary self-end">Buscar</button>
			</form>
			{#if hasActiveSearch}
				<a href={`/odonto/agenda?date=${data.date}`} class="mt-3 inline-block text-sm font-semibold text-[#c4b5fd] hover:underline">
					Limpiar filtros
				</a>
			{/if}
		</div>
	{/if}

	{#if showCreate}
		<div transition:slide={{ duration: 180 }} class="scroll-mt-5" bind:this={createSection}>
			<ManualAppointmentWizard
				services={data.services}
				professionals={data.professionals}
				serviceProfessionalIds={data.serviceProfessionalIds}
				patients={data.patients}
				initialDate={data.date}
				initialPatientId={data.selectedPatientId}
				{canOperate}
				{form}
			/>
		</div>
	{/if}

	<div class="ux-card">
		<div class="flex items-center justify-between gap-3">
			<div class="min-w-0">
				<h2 class="ux-section-title">{hasActiveSearch ? 'Resultado de búsqueda' : 'Turnos del día'}</h2>
				{#if searchSummary}
					<p class="mt-1 truncate text-sm font-semibold text-white/50">{searchSummary}</p>
				{/if}
			</div>
			<span class="ux-badge shrink-0">{resultLabel}</span>
		</div>

		{#if data.appointments.length === 0}
			<div class="mt-5">
				{#if hasActiveSearch}
					<EmptyState
						title="Sin resultados"
						description="No encontramos turnos con esa búsqueda. Probá con otros filtros."
					/>
				{:else}
					<EmptyState
						title="No hay turnos para este día"
						description={canOperate ? 'Agendá el primero o revisá otro día.' : 'Revisá otro día.'}
					>
						{#snippet actions()}
							{#if canOperate && !needsSetup}
								<button type="button" class="ux-btn-primary" onclick={toggleCreate}>+ Nuevo turno</button>
							{/if}
							<a href={buildAgendaHref(nextDate)} class="ux-btn-secondary">Día siguiente</a>
						{/snippet}
					</EmptyState>
				{/if}
			</div>
		{:else}
			<div class="mt-5 grid gap-3">
				{#each data.appointments as appointment}
					<a
						href={`/odonto/turnos/${appointment.id}?from_date=${data.date}`}
						class="ux-choice flex items-center gap-3 p-3 sm:gap-4 sm:p-4"
					>
						<div class="w-14 shrink-0 text-center sm:w-20">
							<p class="text-xl font-bold text-white sm:text-2xl">{timeOnly(appointment.starts_at)}</p>
							<p class="mt-0.5 text-xs text-white/40">{timeOnly(appointment.ends_at)}</p>
						</div>
						<div class="min-w-0 flex-1">
							<p class="truncate text-base font-bold text-white sm:text-lg">{appointment.patients?.full_name ?? 'Paciente'}</p>
							<p class="mt-0.5 truncate text-sm text-white/55">
								{appointment.service_name_snapshot} · {appointment.professional_name_snapshot}
							</p>
							<div class="mt-2 flex flex-wrap gap-2">
								<span class={statusTone[appointment.status] ?? 'ux-badge'}>{statusLabels[appointment.status] ?? appointment.status}</span>
								{#if appointment.source === 'public_booking'}<span class="ux-badge">Online</span>{/if}
							</div>
						</div>
						<svg class="h-5 w-5 shrink-0 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg>
					</a>
				{/each}
			</div>
		{/if}
	</div>
</section>
