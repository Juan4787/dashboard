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
		reschedule_requested: 'Quiere reprogramar',
		attended: 'Asistió',
		no_show: 'No asistió'
	};

	const timeOnly = (value: string) =>
		new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
</script>

<section class="flex flex-col gap-6">
	<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<h1 class="text-2xl font-semibold text-neutral-900 dark:text-white">Mis turnos</h1>
		<p class="mt-2 max-w-3xl text-sm text-neutral-600 dark:text-neutral-200">
			Vista operativa del profesional vinculado al usuario actual.
		</p>
	</div>

	{#if form?.message}
		<p class={`rounded-xl px-4 py-3 text-sm font-semibold ${form.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
			{form.message}
		</p>
	{/if}

	{#if data.professionalLinks.length === 0}
		<div class="rounded-2xl border border-dashed border-neutral-300 bg-white/70 p-6 text-sm text-neutral-600 dark:border-[#1f3554] dark:bg-[#152642] dark:text-neutral-200">
			Tu usuario no está asociado a ningún profesional. Pedile a administración que te vincule desde Profesionales.
		</div>
	{:else}
		<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
			<form method="GET" class="grid gap-4 md:grid-cols-[1fr_auto]">
				<label class="space-y-1">
					<span class="text-sm font-semibold">Perfil profesional</span>
					<select name="professional_id" class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm dark:border-[#1f3554] dark:bg-[#0f1f36]">
						<option value="">Todos mis perfiles</option>
						{#each data.professionalLinks as link}
							<option value={link.professional_id} selected={link.professional_id === data.selectedProfessionalId}>
								{link.professionals.name}{link.professionals.specialty ? ` · ${link.professionals.specialty}` : ''}
							</option>
						{/each}
					</select>
				</label>
				<button class="self-end rounded-xl border border-neutral-200 px-5 py-3 text-sm font-semibold transition hover:bg-neutral-50 dark:border-[#1f3554] dark:hover:bg-[#0f1f36]">
					Filtrar
				</button>
			</form>
		</div>

		<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
			<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Hoy</h2>
			<div class="mt-4 grid gap-3">
				{#each data.todayAppointments as appointment}
					<article class="rounded-xl border border-neutral-200 p-4 dark:border-[#1f3554]">
						<div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
							<div>
								<p class="font-semibold text-neutral-900 dark:text-white">
									{timeOnly(appointment.starts_at)} a {timeOnly(appointment.ends_at)} · {appointment.service_name_snapshot}
								</p>
								<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-200">
									{appointment.patients?.full_name ?? 'Paciente'}{appointment.patients?.phone_e164 ? ` · ${appointment.patients.phone_e164}` : ''} · {appointment.professional_name_snapshot}
								</p>
								<p class="mt-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">
									{statusLabels[appointment.status] ?? appointment.status}
								</p>
							</div>
							<div class="flex flex-wrap gap-2">
								<a href={`/odonto/turnos/${appointment.id}`} class="rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold transition hover:bg-neutral-50 dark:border-[#1f3554] dark:hover:bg-[#0f1f36]">
									Abrir
								</a>
								{#each ['attended', 'no_show'] as status}
									<form method="POST" action="?/update_status">
										<input type="hidden" name="appointment_id" value={appointment.id} />
										<button name="status" value={status} disabled={['cancelled', 'attended', 'no_show'].includes(appointment.status)} class="rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold transition hover:bg-neutral-50 disabled:opacity-50 dark:border-[#1f3554] dark:hover:bg-[#0f1f36]">
											{statusLabels[status]}
										</button>
									</form>
								{/each}
							</div>
						</div>
					</article>
				{/each}
				{#if data.todayAppointments.length === 0}
					<p class="rounded-xl border border-dashed border-neutral-300 px-4 py-3 text-sm text-neutral-600 dark:border-[#1f3554] dark:text-neutral-200">
						No tenés turnos asignados para hoy.
					</p>
				{/if}
			</div>
		</div>

		<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
			<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Próximos turnos</h2>
			<div class="mt-4 grid gap-3">
				{#each data.upcomingAppointments as appointment}
					<a href={`/odonto/turnos/${appointment.id}`} class="rounded-xl border border-neutral-200 px-4 py-3 text-sm transition hover:bg-neutral-50 dark:border-[#1f3554] dark:hover:bg-[#0f1f36]">
						<span class="block font-semibold text-neutral-900 dark:text-white">{formatDateTime(appointment.starts_at)} · {appointment.service_name_snapshot}</span>
						<span class="text-neutral-600 dark:text-neutral-200">{appointment.patients?.full_name ?? 'Paciente'} · {statusLabels[appointment.status] ?? appointment.status}</span>
					</a>
				{/each}
				{#if data.upcomingAppointments.length === 0}
					<p class="rounded-xl border border-dashed border-neutral-300 px-4 py-3 text-sm text-neutral-600 dark:border-[#1f3554] dark:text-neutral-200">
						Todavía no hay turnos futuros asignados.
					</p>
				{/if}
			</div>
		</div>
	{/if}
</section>
