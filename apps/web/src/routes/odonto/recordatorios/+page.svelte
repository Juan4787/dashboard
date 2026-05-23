<script lang="ts">
	let { data, form } = $props<{
		data: {
			date: string;
			context: any;
			appointments: any[];
			dispatches: any[];
			account: any;
		};
		form?: { success?: boolean; message?: string };
	}>();

	const statusLabels: Record<string, string> = {
		reserved: 'Reservado',
		confirmed: 'Confirmado',
		cancelled: 'Cancelado',
		reschedule_requested: 'Quiere reprogramar',
		attended: 'Asistió',
		no_show: 'No asistió',
		scheduled: 'Programado',
		queued: 'En cola',
		sending: 'Enviando',
		sent: 'Enviado',
		delivered: 'Entregado',
		read: 'Leído',
		failed: 'Falló',
		skipped: 'Omitido'
	};

	const dispatchByAppointment = $derived.by(() => {
		const map = new Map<string, any>();
		for (const dispatch of data.dispatches) {
			if (dispatch.appointment_id && !map.has(dispatch.appointment_id)) {
				map.set(dispatch.appointment_id, dispatch);
			}
		}
		return map;
	});

	const stats = $derived.by(() => {
		const dayDispatches = data.appointments
			.map((appointment: any) => dispatchByAppointment.get(appointment.id))
			.filter(Boolean) as any[];
		return {
			total: data.appointments.length,
			sent: dayDispatches.filter((dispatch: any) => ['sent', 'delivered', 'read'].includes(dispatch.status)).length,
			delivered: dayDispatches.filter((dispatch: any) => ['delivered', 'read'].includes(dispatch.status)).length,
			failed: dayDispatches.filter((dispatch: any) => dispatch.status === 'failed').length,
			confirmed: data.appointments.filter((appointment: any) => appointment.status === 'confirmed').length
		};
	});

	const formatTime = (value?: string | null) =>
		value
			? new Intl.DateTimeFormat('es-AR', {
					hour: '2-digit',
					minute: '2-digit'
				}).format(new Date(value))
			: '-';

	const statusTone = (status: string) => {
		if (['confirmed', 'sent', 'delivered', 'read'].includes(status)) return 'ux-badge ux-badge-success';
		if (status === 'failed' || status === 'cancelled') return 'ux-badge ux-badge-danger';
		if (status === 'queued' || status === 'sending' || status === 'reschedule_requested') return 'ux-badge ux-badge-warning';
		return 'ux-badge';
	};
</script>

<section class="ux-page">
	<div class="ux-hero">
		<p class="ux-badge">Recordatorios</p>
		<h1 class="ux-title mt-4">Control del día siguiente</h1>
		<p class="ux-subtitle">Supervisá qué turnos tienen recordatorio, cuáles llegaron y quién confirmó.</p>
	</div>

	{#if form?.message}
		<p class={form.success ? 'ux-alert ux-alert-success' : 'ux-alert'}>{form.message}</p>
	{/if}

	<div class="grid gap-4 md:grid-cols-5">
		<div class="ux-soft-card p-5">
			<p class="text-sm text-white/55">Turnos</p>
			<p class="mt-2 text-3xl font-bold text-white">{stats.total}</p>
		</div>
		<div class="ux-soft-card p-5">
			<p class="text-sm text-white/55">Enviados</p>
			<p class="mt-2 text-3xl font-bold text-white">{stats.sent}</p>
		</div>
		<div class="ux-soft-card p-5">
			<p class="text-sm text-white/55">Entregados</p>
			<p class="mt-2 text-3xl font-bold text-white">{stats.delivered}</p>
		</div>
		<div class="ux-soft-card p-5">
			<p class="text-sm text-white/55">Confirmados</p>
			<p class="mt-2 text-3xl font-bold text-white">{stats.confirmed}</p>
		</div>
		<div class="ux-soft-card p-5">
			<p class="text-sm text-white/55">Fallidos</p>
			<p class="mt-2 text-3xl font-bold text-white">{stats.failed}</p>
		</div>
	</div>

	<div class="ux-card">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
			<form method="get" class="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
				<label class="flex-1">
					<span class="ux-label">Día</span>
					<input type="date" name="date" value={data.date} class="ux-input" />
				</label>
				<button class="ux-btn-primary">Ver día</button>
			</form>
			<div class="flex flex-wrap gap-2">
				<form method="post" action="?/generate">
					<button class="ux-btn-secondary" disabled={!data.context?.canOperate || data.account?.status !== 'active'}>
						Generar pendientes
					</button>
				</form>
				<form method="post" action="?/process">
					<button class="ux-btn-primary" disabled={!data.context?.canOperate || data.account?.status !== 'active'}>
						Procesar cola
					</button>
				</form>
			</div>
		</div>
		{#if data.account?.status !== 'active'}
			<p class="ux-alert mt-4">WhatsApp todavía no está activo para este consultorio.</p>
		{/if}
	</div>

	<div class="ux-card">
		<div class="flex items-center justify-between gap-4">
			<h2 class="ux-section-title">Turnos del día</h2>
			<span class="ux-badge">{data.appointments.length} turnos</span>
		</div>
		<div class="mt-5 space-y-3">
			{#each data.appointments as appointment}
				{@const dispatch = dispatchByAppointment.get(appointment.id)}
				<div class="ux-soft-card p-4">
					<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
						<div>
							<div class="flex flex-wrap items-center gap-2">
								<span class={statusTone(appointment.status)}>{statusLabels[appointment.status] ?? appointment.status}</span>
								{#if dispatch}
									<span class={statusTone(dispatch.status)}>{statusLabels[dispatch.status] ?? dispatch.status}</span>
								{:else}
									<span class="ux-badge">Sin recordatorio</span>
								{/if}
							</div>
							<p class="mt-3 text-xl font-bold text-white">{formatTime(appointment.starts_at)} · {appointment.patients?.full_name ?? 'Paciente'}</p>
							<p class="mt-1 text-sm text-white/55">
								{appointment.service_name_snapshot} · {appointment.professional_name_snapshot}
							</p>
							{#if dispatch?.human_error_message}
								<p class="mt-3 text-sm font-semibold text-red-200">{dispatch.human_error_message}</p>
							{/if}
						</div>
						<div class="flex flex-wrap gap-2">
							<a href={`/odonto/turnos/${appointment.id}`} class="ux-btn-primary">Abrir turno</a>
							{#if appointment.patient_id}
								<a href={`/odonto/pacientes/${appointment.patient_id}`} class="ux-btn-secondary">Abrir paciente</a>
							{/if}
						</div>
					</div>
				</div>
			{/each}
			{#if data.appointments.length === 0}
				<p class="ux-empty">No hay turnos para este día.</p>
			{/if}
		</div>
	</div>
</section>
