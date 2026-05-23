<script lang="ts">
	let { data, form } = $props<{
		data: {
			context: any;
			dispatches: any[];
			inboundMessages: any[];
			filters: { status: string; type: string };
		};
		form?: { success?: boolean; message?: string };
	}>();

	const statusLabels: Record<string, string> = {
		scheduled: 'Programado',
		queued: 'En cola',
		sending: 'Enviando',
		sent: 'Enviado',
		delivered: 'Entregado',
		read: 'Leído',
		failed: 'Falló',
		cancelled: 'Cancelado',
		skipped: 'Omitido'
	};

	const typeLabels: Record<string, string> = {
		appointment_reminder_24h: 'Recordatorio',
		bot_reply: 'Respuesta automática',
		manual_test: 'Prueba'
	};

	const statusTone = (status: string) => {
		if (status === 'delivered' || status === 'read' || status === 'sent') return 'ux-badge ux-badge-success';
		if (status === 'failed') return 'ux-badge ux-badge-danger';
		if (status === 'queued' || status === 'sending') return 'ux-badge ux-badge-warning';
		return 'ux-badge';
	};

	const formatDateTime = (value?: string | null) =>
		value
			? new Intl.DateTimeFormat('es-AR', {
					dateStyle: 'short',
					timeStyle: 'short'
				}).format(new Date(value))
			: '-';
</script>

<section class="ux-page">
	<div class="ux-hero">
		<p class="ux-badge">Mensajes</p>
		<h1 class="ux-title mt-4">Actividad de WhatsApp</h1>
		<p class="ux-subtitle">Mensajes enviados, respuestas recibidas y errores operativos.</p>
	</div>

	{#if form?.message}
		<p class={form.success ? 'ux-alert ux-alert-success' : 'ux-alert'}>{form.message}</p>
	{/if}

	<form method="get" class="ux-card grid gap-3 md:grid-cols-[1fr_1fr_auto]">
		<label>
			<span class="ux-label">Estado</span>
			<select name="status" class="ux-select">
				<option value="">Todos</option>
				{#each Object.entries(statusLabels) as [value, label]}
					<option value={value} selected={data.filters.status === value}>{label}</option>
				{/each}
			</select>
		</label>
		<label>
			<span class="ux-label">Tipo</span>
			<select name="type" class="ux-select">
				<option value="">Todos</option>
				{#each Object.entries(typeLabels) as [value, label]}
					<option value={value} selected={data.filters.type === value}>{label}</option>
				{/each}
			</select>
		</label>
		<button class="ux-btn-primary self-end">Filtrar</button>
	</form>

	<div class="ux-card">
		<div class="flex items-center justify-between gap-4">
			<h2 class="ux-section-title">Salientes</h2>
			<span class="ux-badge">{data.dispatches.length} mensajes</span>
		</div>
		<div class="mt-5 space-y-3">
			{#each data.dispatches as dispatch}
				<div class="ux-soft-card p-4">
					<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
						<div>
							<div class="flex flex-wrap items-center gap-2">
								<span class={statusTone(dispatch.status)}>{statusLabels[dispatch.status] ?? dispatch.status}</span>
								<span class="ux-badge">{typeLabels[dispatch.type] ?? dispatch.type}</span>
							</div>
							<p class="mt-3 text-lg font-bold text-white">{dispatch.patients?.full_name ?? dispatch.to_phone_e164}</p>
							<p class="mt-1 text-sm text-white/55">
								{dispatch.appointments?.service_name_snapshot ?? 'Sin turno'} · {formatDateTime(dispatch.scheduled_for ?? dispatch.created_at)}
							</p>
							{#if dispatch.human_error_message}
								<p class="mt-3 text-sm font-semibold text-red-200">{dispatch.human_error_message}</p>
							{/if}
						</div>
						<div class="flex flex-wrap gap-2">
							{#if dispatch.appointment_id}
								<a href={`/odonto/turnos/${dispatch.appointment_id}`} class="ux-btn-secondary">Abrir turno</a>
							{/if}
							{#if dispatch.patient_id}
								<a href={`/odonto/pacientes/${dispatch.patient_id}`} class="ux-btn-secondary">Abrir paciente</a>
							{/if}
							{#if dispatch.status === 'failed'}
								<form method="post" action="?/retry_dispatch">
									<input type="hidden" name="dispatch_id" value={dispatch.id} />
									<button class="ux-btn-primary">Reintentar</button>
								</form>
							{/if}
							{#if dispatch.provider_message_id}
								<form method="post" action="?/simulate_status" class="flex gap-2">
									<input type="hidden" name="provider_message_id" value={dispatch.provider_message_id} />
									<select name="status" class="ux-select min-w-36">
										<option value="delivered">Entregado</option>
										<option value="read">Leído</option>
										<option value="failed">Falló</option>
									</select>
									<button class="ux-btn-secondary">Simular</button>
								</form>
							{/if}
						</div>
					</div>
				</div>
			{/each}
			{#if data.dispatches.length === 0}
				<p class="ux-empty">Todavía no hay mensajes salientes.</p>
			{/if}
		</div>
	</div>

	<div class="ux-card">
		<div class="flex items-center justify-between gap-4">
			<h2 class="ux-section-title">Entrantes</h2>
			<span class="ux-badge">{data.inboundMessages.length} recibidos</span>
		</div>
		<div class="mt-5 space-y-3">
			{#each data.inboundMessages as message}
				<div class="ux-soft-card p-4">
					<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<p class="text-lg font-bold text-white">{message.from_phone_e164}</p>
							<p class="mt-1 text-sm text-white/65">{message.text || 'Mensaje sin texto'}</p>
						</div>
						<div class="flex flex-wrap gap-2">
							<span class={message.requires_human ? 'ux-badge ux-badge-warning' : 'ux-badge ux-badge-success'}>
								{message.requires_human ? 'Requiere atención' : 'Respondido por bot'}
							</span>
							<span class="ux-badge">{formatDateTime(message.received_at)}</span>
						</div>
					</div>
				</div>
			{/each}
			{#if data.inboundMessages.length === 0}
				<p class="ux-empty">Todavía no hay mensajes entrantes.</p>
			{/if}
		</div>
	</div>
</section>
