<script lang="ts">
	import { formatDateTime } from '$lib/utils/format';

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
	type Professional = { id: string; name: string; is_active: boolean };
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
		reschedule_requested: 'Quiere reprogramar',
		attended: 'Asistió',
		no_show: 'No asistió'
	};

	const sourceLabels: Record<string, string> = {
		public_booking: 'Reserva pública',
		manual: 'Manual',
		whatsapp_bot: 'WhatsApp',
		admin: 'Admin'
	};

	const timeOnly = (value: string) =>
		new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));

	const statLabel = (status: string) => statusLabels[status] ?? status;
</script>

<section class="flex flex-col gap-6">
	<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
			<div>
				<h1 class="text-2xl font-semibold text-neutral-900 dark:text-white">Agenda diaria</h1>
				<p class="mt-2 max-w-3xl text-sm text-neutral-600 dark:text-neutral-200">
					Operá el día, filtrá turnos y creá nuevas reservas usando disponibilidad real.
				</p>
			</div>
			<a href={`/odonto/agenda/semana?date=${data.date}${data.selectedProfessionalId ? `&professional_id=${data.selectedProfessionalId}` : ''}`} class="rounded-xl border border-neutral-200 px-4 py-3 text-sm font-semibold transition hover:bg-neutral-50 dark:border-[#1f3554] dark:hover:bg-[#0f1f36]">
				Ver semana
			</a>
		</div>
	</div>

	{#if form?.message}
		<p class="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{form.message}</p>
	{/if}

	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
		<div class="rounded-2xl border border-neutral-100 bg-white/90 p-4 shadow-card dark:border-[#1f3554] dark:bg-[#152642]">
			<p class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">Total</p>
			<p class="mt-2 text-2xl font-semibold text-neutral-900 dark:text-white">{data.totalAppointments}</p>
		</div>
		{#each data.stats as stat}
			<div class="rounded-2xl border border-neutral-100 bg-white/90 p-4 shadow-card dark:border-[#1f3554] dark:bg-[#152642]">
				<p class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">{statLabel(stat.status)}</p>
				<p class="mt-2 text-2xl font-semibold text-neutral-900 dark:text-white">{stat.count}</p>
			</div>
		{/each}
	</div>

	<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<form method="GET" class="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
			<label class="space-y-1">
				<span class="text-sm font-semibold">Fecha</span>
				<input type="date" name="date" value={data.date} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
			<label class="space-y-1">
				<span class="text-sm font-semibold">Profesional</span>
				<select name="professional_id" class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<option value="">Todos</option>
					{#each data.professionals as professional}
						<option value={professional.id} selected={professional.id === data.selectedProfessionalId}>{professional.name}</option>
					{/each}
				</select>
			</label>
			<label class="space-y-1">
				<span class="text-sm font-semibold">Servicio</span>
				<select name="service_id" class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<option value="">Todos</option>
					{#each data.services as service}
						<option value={service.id} selected={service.id === data.selectedServiceId}>{service.name}</option>
					{/each}
				</select>
			</label>
			<label class="space-y-1">
				<span class="text-sm font-semibold">Estado</span>
				<select name="status" class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<option value="">Todos</option>
					{#each Object.entries(statusLabels) as [value, label]}
						<option value={value} selected={value === data.selectedStatus}>{label}</option>
					{/each}
				</select>
			</label>
			<button class="self-end rounded-xl border border-neutral-200 px-5 py-3 text-sm font-semibold transition hover:bg-neutral-50 dark:border-[#1f3554] dark:hover:bg-[#0f1f36]">
				Filtrar
			</button>
		</form>
	</div>

	{#if data.professionals.length === 0 || data.services.length === 0}
		<div class="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
			{#if data.professionals.length === 0}
				<p>Primero creá al menos un profesional para poder operar la agenda.</p>
			{/if}
			{#if data.services.length === 0}
				<p>Primero creá al menos un servicio activo para poder crear turnos.</p>
			{/if}
		</div>
	{/if}

	<form method="POST" action="?/create_appointment" class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Nuevo turno manual</h2>
				<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-200">La hora elegida se valida contra el motor de disponibilidad antes de guardar.</p>
			</div>
		</div>
		<div class="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			<label class="space-y-1">
				<span class="text-sm font-semibold">Fecha</span>
				<input name="date" type="date" value={String(form?.values?.date ?? data.date)} required disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
			<label class="space-y-1">
				<span class="text-sm font-semibold">Hora disponible</span>
				<input name="time" type="time" required disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
			<label class="space-y-1">
				<span class="text-sm font-semibold">Servicio</span>
				<select name="service_id" required disabled={!canOperate || data.services.length === 0} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<option value="">Seleccionar</option>
					{#each data.services as service}
						<option value={service.id} selected={String(form?.values?.service_id ?? '') === service.id}>{service.name} · {service.duration_minutes} min</option>
					{/each}
				</select>
			</label>
			<label class="space-y-1">
				<span class="text-sm font-semibold">Profesional</span>
				<select name="professional_id" required disabled={!canOperate || data.professionals.length === 0} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<option value="">Seleccionar</option>
					{#each data.professionals as professional}
						<option value={professional.id} selected={String(form?.values?.professional_id ?? '') === professional.id}>{professional.name}</option>
					{/each}
				</select>
			</label>
			<label class="space-y-1 md:col-span-2">
				<span class="text-sm font-semibold">Paciente existente</span>
				<select name="patient_id" disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<option value="">Crear rápido o elegir existente</option>
					{#each data.patients as patient}
						<option value={patient.id} disabled={patient.blocked} selected={String(form?.values?.patient_id ?? '') === patient.id}>{patient.full_name}{patient.phone_e164 ? ` · ${patient.phone_e164}` : ''}{patient.blocked ? ' · bloqueado' : ''}</option>
					{/each}
				</select>
			</label>
			<label class="space-y-1">
				<span class="text-sm font-semibold">Nombre nuevo</span>
				<input name="patient_name" value={String(form?.values?.patient_name ?? '')} disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
			<label class="space-y-1">
				<span class="text-sm font-semibold">Teléfono nuevo</span>
				<input name="patient_phone" value={String(form?.values?.patient_phone ?? '')} disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
			<label class="space-y-1 md:col-span-2">
				<span class="text-sm font-semibold">Email nuevo</span>
				<input name="patient_email" type="email" value={String(form?.values?.patient_email ?? '')} disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
			<label class="space-y-1 md:col-span-2">
				<span class="text-sm font-semibold">Nota interna</span>
				<input name="internal_note" value={String(form?.values?.internal_note ?? '')} disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
		</div>
		<div class="mt-5 flex justify-end">
			<button type="submit" disabled={!canOperate || data.professionals.length === 0 || data.services.length === 0} class="rounded-xl bg-[#7c3aed] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">
				Crear turno
			</button>
		</div>
	</form>

	<div class="grid gap-4">
		{#each data.appointments as appointment}
			<article class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642]">
				<div class="grid gap-4 lg:grid-cols-[140px_1fr_auto] lg:items-start">
					<div>
						<p class="text-xl font-semibold text-neutral-900 dark:text-white">{timeOnly(appointment.starts_at)}</p>
						<p class="mt-1 text-sm text-neutral-500 dark:text-neutral-300">hasta {timeOnly(appointment.ends_at)}</p>
					</div>
					<div>
						<p class="text-base font-semibold text-neutral-900 dark:text-white">{appointment.patients?.full_name ?? 'Paciente'}</p>
						<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-200">
							{appointment.patients?.phone_e164 ?? 'Sin teléfono'} · {appointment.service_name_snapshot} · {appointment.professional_name_snapshot}
						</p>
						<p class="mt-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">
							{statusLabels[appointment.status] ?? appointment.status} · {sourceLabels[appointment.source] ?? appointment.source}
						</p>
						{#if appointment.internal_note}
							<p class="mt-3 rounded-xl bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:bg-[#0f1f36] dark:text-neutral-200">{appointment.internal_note}</p>
						{/if}
					</div>
					<div class="flex flex-wrap gap-2 lg:justify-end">
						<a href={`/odonto/turnos/${appointment.id}?from_date=${data.date}`} class="rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold transition hover:bg-neutral-50 dark:border-[#1f3554] dark:hover:bg-[#0f1f36]">
							Abrir
						</a>
						{#each ['confirmed', 'reschedule_requested', 'attended', 'no_show', 'cancelled'] as status}
							<form method="POST" action="?/update_status">
								<input type="hidden" name="appointment_id" value={appointment.id} />
								<input type="hidden" name="status" value={status} />
								<input type="hidden" name="date" value={data.date} />
								<input type="hidden" name="professional_id" value={data.selectedProfessionalId} />
								<input type="hidden" name="selected_status" value={data.selectedStatus} />
								<input type="hidden" name="service_id" value={data.selectedServiceId} />
								<button type="submit" disabled={!canOperate || appointment.status === status || appointment.status === 'cancelled' || appointment.status === 'attended' || appointment.status === 'no_show'} class="rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold transition hover:bg-neutral-50 disabled:opacity-50 dark:border-[#1f3554] dark:hover:bg-[#0f1f36]">
									{statusLabels[status]}
								</button>
							</form>
						{/each}
					</div>
				</div>
			</article>
		{/each}
		{#if data.appointments.length === 0}
			<div class="rounded-2xl border border-dashed border-neutral-300 bg-white/70 p-6 text-sm text-neutral-600 dark:border-[#1f3554] dark:bg-[#152642] dark:text-neutral-200">
				No hay turnos para este filtro. Cambiá la fecha o revisá si hay profesionales, servicios y disponibilidad cargada.
			</div>
		{/if}
	</div>
</section>
