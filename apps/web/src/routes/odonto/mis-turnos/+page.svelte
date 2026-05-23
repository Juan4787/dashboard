<script lang="ts">
	import { formatDateTime } from '$lib/utils/format';

	type ProfessionalLink = {
		professional_id: string;
		professionals: { id: string; name: string; specialty: string | null; is_active: boolean };
	};
	type Appointment = {
		id: string;
		starts_at: string;
		ends_at: string;
		status: string;
		source: string;
		service_name_snapshot: string;
		professional_name_snapshot: string;
		patients?: { id: string; full_name: string; phone_e164: string | null } | null;
	};

	let { data, form } = $props<{
		data: {
			professionalLinks: ProfessionalLink[];
			selectedProfessionalId: string;
			todayAppointments: Appointment[];
			upcomingAppointments: Appointment[];
			demo: boolean;
		};
		form?: { success?: boolean; message?: string };
	}>();

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
		new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));

	const selectedProfile = $derived(
		data.professionalLinks.find((link: ProfessionalLink) => link.professional_id === data.selectedProfessionalId)?.professionals ??
			null
	);
</script>

<section class="ux-page">
	<div class="ux-hero">
		<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<p class="ux-badge">Profesional</p>
				<h1 class="ux-title mt-4">Mis turnos</h1>
				<p class="ux-subtitle">
					{selectedProfile ? selectedProfile.name : 'Tu agenda de hoy y próximos turnos.'}
				</p>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div class="ux-soft-card min-w-32 p-4 text-center">
					<p class="text-sm font-bold text-white/55">Hoy</p>
					<p class="mt-1 text-3xl font-bold text-white">{data.todayAppointments.length}</p>
				</div>
				<div class="ux-soft-card min-w-32 p-4 text-center">
					<p class="text-sm font-bold text-white/55">Próximos</p>
					<p class="mt-1 text-3xl font-bold text-white">{data.upcomingAppointments.length}</p>
				</div>
			</div>
		</div>
	</div>

	{#if form?.message}
		<p class={form.success ? 'ux-alert ux-alert-success' : 'ux-alert'}>{form.message}</p>
	{/if}

	{#if data.professionalLinks.length === 0}
		<div class="ux-empty">Tu usuario no está asociado a ningún profesional.</div>
	{:else}
		<div class="ux-card">
			<form method="GET" class="grid gap-4 md:grid-cols-[1fr_auto]">
				<label>
					<span class="ux-label">Perfil</span>
					<select name="professional_id" class="ux-select">
						<option value="">Todos mis perfiles</option>
						{#each data.professionalLinks as link}
							<option value={link.professional_id} selected={link.professional_id === data.selectedProfessionalId}>
								{link.professionals.name}{link.professionals.specialty ? ` · ${link.professionals.specialty}` : ''}
							</option>
						{/each}
					</select>
				</label>
				<button class="ux-btn-primary self-end">Ver</button>
			</form>
		</div>

		<div class="ux-card">
			<h2 class="ux-section-title">Hoy</h2>
			<div class="mt-5 grid gap-3">
				{#each data.todayAppointments as appointment}
					<article class="ux-soft-card p-4">
						<div class="grid gap-4 lg:grid-cols-[110px_1fr_auto] lg:items-center">
							<div>
								<p class="text-2xl font-bold text-white">{timeOnly(appointment.starts_at)}</p>
								<p class="text-sm text-white/45">{timeOnly(appointment.ends_at)}</p>
							</div>
							<div>
								<p class="text-lg font-bold text-white">{appointment.service_name_snapshot}</p>
								<p class="mt-1 text-sm text-white/58">
									{appointment.patients?.full_name ?? 'Paciente'}{appointment.patients?.phone_e164 ? ` · ${appointment.patients.phone_e164}` : ''}
								</p>
								<span class={`mt-3 ${statusTone[appointment.status] ?? 'ux-badge'}`}>{statusLabels[appointment.status] ?? appointment.status}</span>
							</div>
							<div class="flex flex-wrap gap-2 lg:justify-end">
								<a href={`/odonto/turnos/${appointment.id}`} class="ux-btn-primary">Abrir</a>
								{#each ['attended', 'no_show'] as status}
									<form method="POST" action="?/update_status">
										<input type="hidden" name="appointment_id" value={appointment.id} />
										<button name="status" value={status} disabled={['cancelled', 'attended', 'no_show'].includes(appointment.status)} class="ux-btn-secondary">
											{statusLabels[status]}
										</button>
									</form>
								{/each}
							</div>
						</div>
					</article>
				{/each}
				{#if data.todayAppointments.length === 0}
					<p class="ux-empty">No tenés turnos asignados para hoy.</p>
				{/if}
			</div>
		</div>

		<div class="ux-card">
			<h2 class="ux-section-title">Próximos</h2>
			<div class="mt-5 grid gap-3">
				{#each data.upcomingAppointments as appointment}
					<a href={`/odonto/turnos/${appointment.id}`} class="ux-choice p-4">
						<span class="block text-base font-bold text-white">{formatDateTime(appointment.starts_at)}</span>
						<span class="mt-1 block text-sm text-white/58">{appointment.service_name_snapshot}</span>
						<span class="mt-3 inline-flex {statusTone[appointment.status] ?? 'ux-badge'}">{statusLabels[appointment.status] ?? appointment.status}</span>
					</a>
				{/each}
				{#if data.upcomingAppointments.length === 0}
					<p class="ux-empty">Todavía no hay turnos futuros asignados.</p>
				{/if}
			</div>
		</div>
	{/if}
</section>
