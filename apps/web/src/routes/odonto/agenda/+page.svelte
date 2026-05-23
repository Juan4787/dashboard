<script lang="ts">
	import ManualAppointmentWizard from '$lib/components/agenda/ManualAppointmentWizard.svelte';

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
		patients?: { full_name: string; phone_e164: string | null } | null;
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

	const statusLabels: Record<string, string> = {
		reserved: 'Reservado',
		confirmed: 'Confirmado',
		cancelled: 'Cancelado',
		reschedule_requested: 'Reprogramar',
		attended: 'Asistió',
		no_show: 'No asistió'
	};

	const sourceLabels: Record<string, string> = {
		public_booking: 'Reserva online',
		manual: 'Manual',
		whatsapp_bot: 'WhatsApp',
		admin: 'Administración interna'
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
		new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));

	const dayLabel = (value: string) =>
		new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: '2-digit', month: 'long' }).format(
			new Date(`${value}T12:00:00`)
		);

	const statCount = (status: string) => data.stats.find((stat: Stat) => stat.status === status)?.count ?? 0;
</script>

<section class="ux-page">
	<div class="ux-hero">
		<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<p class="ux-badge">Agenda diaria</p>
				<h1 class="ux-title mt-4 capitalize">{dayLabel(data.date)}</h1>
				<p class="ux-subtitle">Turnos del día, creación guiada y acciones rápidas.</p>
			</div>
			<a href={`/odonto/agenda/semana?date=${data.date}${data.selectedProfessionalId ? `&professional_id=${data.selectedProfessionalId}` : ''}`} class="ux-btn-secondary">
				Ver semana
			</a>
		</div>
	</div>

	{#if form?.message}
		<p class="ux-alert">{form.message}</p>
	{/if}

	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		<div class="ux-soft-card p-5">
			<p class="ux-muted text-sm font-bold">Total</p>
			<p class="mt-2 text-4xl font-bold text-white">{data.totalAppointments}</p>
		</div>
		<div class="ux-soft-card p-5">
			<p class="ux-muted text-sm font-bold">Confirmados</p>
			<p class="mt-2 text-4xl font-bold text-white">{statCount('confirmed')}</p>
		</div>
		<div class="ux-soft-card p-5">
			<p class="ux-muted text-sm font-bold">Pendientes</p>
			<p class="mt-2 text-4xl font-bold text-white">{statCount('reserved')}</p>
		</div>
		<div class="ux-soft-card p-5">
			<p class="ux-muted text-sm font-bold">Reprogramar</p>
			<p class="mt-2 text-4xl font-bold text-white">{statCount('reschedule_requested')}</p>
		</div>
	</div>

	<div class="ux-card">
		<form method="GET" class="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
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
					{#each Object.entries(statusLabels) as [value, label]}
						<option value={value} selected={value === data.selectedStatus}>{label}</option>
					{/each}
				</select>
			</label>
			<button class="ux-btn-secondary self-end">Filtrar</button>
		</form>
	</div>

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

	<ManualAppointmentWizard
		services={data.services}
		professionals={data.professionals}
		serviceProfessionalIds={data.serviceProfessionalIds}
		patients={data.patients}
		initialDate={data.date}
		{canOperate}
		{form}
	/>

	<div class="ux-card">
		<div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h2 class="ux-section-title">Turnos del día</h2>
				<p class="mt-1 text-sm text-white/55">Abrí cualquier turno para ver detalle y acciones.</p>
			</div>
			<span class="ux-badge">{data.appointments.length} visibles</span>
		</div>

		<div class="mt-5 grid gap-3">
			{#each data.appointments as appointment}
				<article class="ux-soft-card p-4">
					<div class="grid gap-4 lg:grid-cols-[110px_1fr_auto] lg:items-center">
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
						<div class="flex flex-wrap gap-2 lg:justify-end">
							<a href={`/odonto/turnos/${appointment.id}?from_date=${data.date}`} class="ux-btn-primary">
								Abrir
							</a>
							<form method="POST" action="?/update_status">
								<input type="hidden" name="appointment_id" value={appointment.id} />
								<input type="hidden" name="status" value="confirmed" />
								<input type="hidden" name="date" value={data.date} />
								<input type="hidden" name="professional_id" value={data.selectedProfessionalId} />
								<input type="hidden" name="selected_status" value={data.selectedStatus} />
								<input type="hidden" name="service_id" value={data.selectedServiceId} />
								<button type="submit" disabled={!canOperate || appointment.status !== 'reserved'} class="ux-btn-secondary">
									Confirmar
								</button>
							</form>
						</div>
					</div>
				</article>
			{/each}
			{#if data.appointments.length === 0}
				<div class="ux-empty">No hay turnos para este filtro.</div>
			{/if}
		</div>
	</div>
</section>
