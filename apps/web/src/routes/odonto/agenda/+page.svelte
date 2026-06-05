<script lang="ts">
	import ManualAppointmentWizard from '$lib/components/agenda/ManualAppointmentWizard.svelte';
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
			context: { capabilities?: Record<string, boolean> };
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

	const canCreateAppointment = $derived(Boolean((data.context as any).capabilities?.canCreateAppointment) && !data.demo);
	let showCreate = $state(false);
	let showSearch = $state(false);
	let showDayAppointments = $state(false);
	let initialized = $state(false);
	let createSection = $state<HTMLElement | null>(null);
	let searchSection = $state<HTMLElement | null>(null);
	let dayAppointmentsSection = $state<HTMLElement | null>(null);

	const statusLabels: Record<string, string> = {
		pending_confirmation: 'Pendiente',
		reserved: 'Reservado',
		confirmed: 'Confirmado',
		cancelled: 'Cancelado',
		reschedule_requested: 'Reprogramar',
		attended: 'Asistió',
		no_show: 'No asistió',
		expired: 'Expirado'
	};

	const sourceLabels: Record<string, string> = {
		public_booking: 'Reserva online',
		manual: 'Manual',
		whatsapp_bot: 'WhatsApp',
		admin: 'Administración interna'
	};

	const statusTone: Record<string, string> = {
		pending_confirmation: 'ux-badge ux-badge-warning',
		reserved: 'ux-badge',
		confirmed: 'ux-badge ux-badge-success',
		cancelled: 'ux-badge ux-badge-danger',
		reschedule_requested: 'ux-badge ux-badge-warning',
		attended: 'ux-badge ux-badge-success',
		no_show: 'ux-badge ux-badge-danger',
		expired: 'ux-badge ux-badge-danger'
	};

	const timeOnly = (value: string) =>
		new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));

	const dayLabel = (value: string) =>
		new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: '2-digit', month: 'long' }).format(
			new Date(`${value}T12:00:00`)
		);

	const statCount = (status: string) => data.stats.find((stat: Stat) => stat.status === status)?.count ?? 0;
	const statusFilterEntries = $derived(Object.entries(statusLabels));
	const hasActiveSearch = $derived(
		Boolean(data.selectedProfessionalId || data.selectedStatus || data.selectedServiceId || data.selectedQuery)
	);
	const resultLabel = $derived(
		hasActiveSearch
			? `${data.appointments.length} ${data.appointments.length === 1 ? 'turno encontrado' : 'turnos encontrados'}`
			: `${data.appointments.length} ${data.appointments.length === 1 ? 'turno del día' : 'turnos del día'}`
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

	const scrollToElement = async (element: HTMLElement | null) => {
		await tick();
		if (!element) return;
		requestAnimationFrame(() => {
			element.scrollIntoView({ behavior: 'smooth', block: 'start' });
		});
	};

	const toggleCreate = async () => {
		showCreate = !showCreate;
		if (showCreate) await scrollToElement(createSection);
	};

	const toggleSearch = async () => {
		showSearch = !showSearch;
		if (showSearch) await scrollToElement(searchSection);
	};

	const toggleDayAppointments = async () => {
		showDayAppointments = !showDayAppointments;
		if (showDayAppointments) await scrollToElement(dayAppointmentsSection);
	};

	$effect(() => {
		if (initialized) return;
		showCreate = Boolean(form?.message || data.selectedPatientId);
		showSearch = Boolean(hasActiveSearch || form?.message);
		showDayAppointments = Boolean(data.searchApplied || form?.message);
		initialized = true;
	});
</script>

<section class="ux-page">
	<div class="ux-hero">
		<div class="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
			<div>
				<h1 class="ux-title capitalize">{dayLabel(data.date)}</h1>
				<p class="ux-subtitle">
					{data.totalAppointments} {data.totalAppointments === 1 ? 'turno hoy' : 'turnos hoy'}
				</p>
			</div>
			<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
				<button type="button" class="ux-btn-primary" onclick={toggleCreate}>
					{showCreate ? 'Cerrar' : 'Nuevo turno'}
				</button>
				<button type="button" class="ux-btn-secondary" onclick={toggleSearch}>
					{showSearch ? 'Ocultar búsqueda' : 'Buscar turno'}
				</button>
				<button type="button" class="ux-btn-secondary" onclick={toggleDayAppointments}>
					{showDayAppointments ? 'Ocultar turnos' : 'Ver turnos del día'}
				</button>
				<a href={`/odonto/agenda/semana?date=${data.date}${data.selectedProfessionalId ? `&professional_id=${data.selectedProfessionalId}` : ''}`} class="ux-btn-secondary text-center">
					Ver semana
				</a>
			</div>
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

	{#if showSearch}
		<div transition:slide={{ duration: 180 }} class="ux-card scroll-mt-5" bind:this={searchSection}>
			<form method="GET" class="grid gap-4 lg:grid-cols-[1.25fr_1fr_1fr_1fr_auto]">
				<label>
					<span class="ux-label">Paciente, teléfono o servicio</span>
					<input
						name="q"
						value={data.selectedQuery}
						placeholder="Buscar turno"
						class="ux-input"
					/>
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
		</div>
	{/if}

	{#if data.professionals.length === 0 || data.services.length === 0}
		<div class="ux-empty">
			{#if data.professionals.length === 0}
				<p>Primero cargá al menos un profesional.</p>
			{/if}
			{#if data.services.length === 0}
				<p>Primero cargá al menos un servicio.</p>
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
				{canCreateAppointment}
				{form}
			/>
		</div>
	{/if}

	{#if showDayAppointments}
		<div transition:slide={{ duration: 180 }} class="ux-card scroll-mt-5" bind:this={dayAppointmentsSection}>
			<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h2 class="ux-section-title">{hasActiveSearch ? 'Resultado de búsqueda' : 'Turnos del día'}</h2>
					{#if searchSummary}
						<p class="mt-1 text-sm font-semibold text-white/50">{searchSummary}</p>
					{/if}
				</div>
				<span class="ux-badge">{resultLabel}</span>
			</div>

			<div class="mt-5 grid gap-3">
				{#each data.appointments as appointment}
					<details class="group ux-soft-card overflow-hidden">
						<summary class="grid cursor-pointer list-none gap-4 p-4 lg:grid-cols-[110px_1fr_auto] lg:items-center">
							<div>
								<p class="text-2xl font-bold text-white">{timeOnly(appointment.starts_at)}</p>
								<p class="mt-1 text-sm text-white/45">{timeOnly(appointment.ends_at)}</p>
							</div>
							<div class="min-w-0">
								<p class="truncate text-lg font-bold text-white">{appointment.patients?.full_name ?? 'Paciente'}</p>
								<p class="mt-1 text-sm text-white/58">
									{appointment.service_name_snapshot} · {appointment.professional_name_snapshot}
								</p>
								<div class="mt-3 flex flex-wrap gap-2">
									<span class={statusTone[appointment.status] ?? 'ux-badge'}>{statusLabels[appointment.status] ?? appointment.status}</span>
									<span class="ux-badge">{sourceLabels[appointment.source] ?? appointment.source}</span>
								</div>
							</div>
							<div class="flex flex-wrap items-center gap-2 lg:justify-end">
								<span class="text-sm font-bold text-[#c4b5fd] group-open:hidden">Ver detalle</span>
								<span class="hidden text-sm font-bold text-white/55 group-open:inline">Ocultar</span>
							</div>
						</summary>
						<div class="border-t border-white/10 p-4">
							<div class="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
								<div>
									<p class="font-bold text-white/45">Teléfono</p>
									<p class="mt-1 font-bold text-white">{appointment.patients?.phone_e164 ?? 'Sin teléfono'}</p>
								</div>
								<div>
									<p class="font-bold text-white/45">Correo</p>
									<p class="mt-1 font-bold text-white">{appointment.patients?.email ?? 'Sin correo electrónico'}</p>
								</div>
								<div>
									<p class="font-bold text-white/45">Inicio</p>
									<p class="mt-1 font-bold text-white">{timeOnly(appointment.starts_at)}</p>
								</div>
								<div>
									<p class="font-bold text-white/45">Fin</p>
									<p class="mt-1 font-bold text-white">{timeOnly(appointment.ends_at)}</p>
								</div>
							</div>
							{#if appointment.internal_note}
								<p class="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm font-semibold text-white/70">
									{appointment.internal_note}
								</p>
							{/if}
							<a href={`/odonto/turnos/${appointment.id}?from_date=${data.date}`} class="ux-btn-primary mt-4 w-full sm:w-fit">
								Abrir turno
							</a>
						</div>
					</details>
				{/each}
				{#if data.appointments.length === 0}
					<div class="ux-empty">
						{hasActiveSearch ? 'No encontramos turnos con esa búsqueda.' : 'No hay turnos para este día.'}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</section>
