<script lang="ts">
	import { formatDateTime } from '$lib/utils/format';

	type Slot = { date: string; time: string; starts_at: string; professional_name: string };
	type AuditLog = {
		id: string;
		user_id: string | null;
		action: string;
		metadata: Record<string, unknown> | null;
		created_at: string;
	};

	let { data, form } = $props<{
		data: {
			context: { canOperate: boolean; role: string };
			appointment: any;
			auditLogs: AuditLog[];
			userLabels: Record<string, string>;
			reprogramDate: string;
			reprogramSlots: Slot[];
			fromDate: string;
			demo: boolean;
		};
		form?: { success?: boolean; message?: string };
	}>();

	const canOperate = $derived(data.context.canOperate && !data.demo);
	const canProfessionalClose = $derived(data.context.role === 'professional' && !data.demo);
	const isClosed = $derived(['cancelled', 'attended', 'no_show'].includes(data.appointment?.status));

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

	const metadataValue = (log: AuditLog, key: string) => {
		const value = log.metadata?.[key];
		return typeof value === 'string' ? value : null;
	};

	const auditLabel = (log: AuditLog) => {
		const user = log.user_id ? (data.userLabels[log.user_id] ?? log.user_id.slice(0, 8)) : 'Sistema';
		if (log.action === 'appointment.created') return `${user} creó el turno`;
		if (log.action === 'appointment.rescheduled') return `${user} reprogramó el turno`;
		if (log.action === 'appointment.cancelled') return `${user} canceló el turno`;
		if (log.action === 'appointment.confirmed') return `${user} confirmó el turno`;
		if (log.action === 'appointment.reschedule_requested') return `${user} marcó pedido de reprogramación`;
		if (log.action === 'appointment.attended') return `${user} marcó asistió`;
		if (log.action === 'appointment.no_show') return `${user} marcó no asistió`;
		return `${user} registró ${log.action}`;
	};

	const auditDetail = (log: AuditLog) => {
		if (log.action === 'appointment.rescheduled') {
			const from = metadataValue(log, 'from_starts_at');
			const to = metadataValue(log, 'to_starts_at');
			if (from && to) return `${formatDateTime(from)} → ${formatDateTime(to)}`;
		}
		const reason = metadataValue(log, 'reason');
		if (reason) return reason;
		const fromStatus = metadataValue(log, 'from_status');
		const toStatus = metadataValue(log, 'to_status');
		if (fromStatus && toStatus) return `${statusLabels[fromStatus] ?? fromStatus} → ${statusLabels[toStatus] ?? toStatus}`;
		return '';
	};
</script>

<section class="flex flex-col gap-6">
	<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<a href={`/odonto/agenda?date=${data.fromDate}`} class="text-xs font-semibold uppercase tracking-wide text-[#7c3aed] hover:underline">
			Volver a agenda
		</a>
		<div class="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<h1 class="text-2xl font-semibold text-neutral-900 dark:text-white">Turno</h1>
				<p class="mt-2 text-sm text-neutral-600 dark:text-neutral-200">
					Detalle operativo, reprogramación, estado y auditoría.
				</p>
			</div>
			{#if data.appointment?.patients?.id}
				<a href={`/odonto/pacientes/${data.appointment.patients.id}`} class="rounded-xl border border-neutral-200 px-4 py-3 text-sm font-semibold transition hover:bg-neutral-50 dark:border-[#1f3554] dark:hover:bg-[#0f1f36]">
					Abrir paciente
				</a>
			{/if}
		</div>
	</div>

	{#if form?.message}
		<p class={`rounded-xl px-4 py-3 text-sm font-semibold ${form.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
			{form.message}
		</p>
	{/if}

	{#if data.appointment}
		<div class="grid gap-6 xl:grid-cols-[1fr_380px]">
			<div class="flex flex-col gap-6">
				<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
					<div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
						<div>
							<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">
								{data.appointment.service_name_snapshot}
							</h2>
							<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-200">
								{data.appointment.professional_name_snapshot}
							</p>
						</div>
						<span class="w-fit rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-700 dark:bg-[#0f1f36] dark:text-neutral-200">
							{statusLabels[data.appointment.status] ?? data.appointment.status}
						</span>
					</div>

					<dl class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
						<div>
							<dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Paciente</dt>
							<dd class="mt-1 text-sm font-semibold">{data.appointment.patients?.full_name ?? 'Sin paciente'}</dd>
						</div>
						<div>
							<dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Teléfono</dt>
							<dd class="mt-1 text-sm">{data.appointment.patients?.phone_e164 ?? 'Sin teléfono'}</dd>
						</div>
						<div>
							<dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Email</dt>
							<dd class="mt-1 text-sm">{data.appointment.patients?.email ?? 'Sin email'}</dd>
						</div>
						<div>
							<dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Turno visible</dt>
							<dd class="mt-1 text-sm">{timeOnly(data.appointment.starts_at)} a {timeOnly(data.appointment.ends_at)}</dd>
						</div>
						<div>
							<dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Fecha</dt>
							<dd class="mt-1 text-sm">{formatDateTime(data.appointment.starts_at)}</dd>
						</div>
						<div>
							<dt class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Origen</dt>
							<dd class="mt-1 text-sm">{sourceLabels[data.appointment.source] ?? data.appointment.source}</dd>
						</div>
					</dl>

					<div class="mt-6 grid gap-3 md:grid-cols-2">
						<div class="rounded-xl bg-neutral-50 p-4 text-sm text-neutral-700 dark:bg-[#0f1f36] dark:text-neutral-200">
							<p class="font-semibold text-neutral-900 dark:text-white">Rango del turno</p>
							<p class="mt-1">{formatDateTime(data.appointment.starts_at)} a {timeOnly(data.appointment.ends_at)}</p>
						</div>
						<div class="rounded-xl bg-neutral-50 p-4 text-sm text-neutral-700 dark:bg-[#0f1f36] dark:text-neutral-200">
							<p class="font-semibold text-neutral-900 dark:text-white">Rango bloqueante</p>
							<p class="mt-1">{formatDateTime(data.appointment.blocking_starts_at)} a {timeOnly(data.appointment.blocking_ends_at)}</p>
						</div>
					</div>

					<div class="mt-6 rounded-xl border border-neutral-200 p-4 dark:border-[#1f3554]">
						<h3 class="text-sm font-semibold text-neutral-900 dark:text-white">Snapshots del turno</h3>
						<dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
							<div>
								<dt class="text-neutral-500">Servicio original</dt>
								<dd class="font-semibold">{data.appointment.service_name_snapshot}</dd>
							</div>
							<div>
								<dt class="text-neutral-500">Profesional original</dt>
								<dd class="font-semibold">{data.appointment.professional_name_snapshot}</dd>
							</div>
							<div>
								<dt class="text-neutral-500">Duración</dt>
								<dd class="font-semibold">{data.appointment.duration_minutes_snapshot} min</dd>
							</div>
							<div>
								<dt class="text-neutral-500">Buffers</dt>
								<dd class="font-semibold">{data.appointment.buffer_before_minutes_snapshot} min antes · {data.appointment.buffer_after_minutes_snapshot} min después</dd>
							</div>
						</dl>
					</div>

					{#if data.appointment.internal_note}
						<div class="mt-6 rounded-xl bg-neutral-50 p-4 text-sm text-neutral-700 dark:bg-[#0f1f36] dark:text-neutral-200">
							<p class="font-semibold text-neutral-900 dark:text-white">Nota interna</p>
							<p class="mt-1">{data.appointment.internal_note}</p>
						</div>
					{/if}
				</div>

				<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
					<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Historial</h2>
					<div class="mt-4 grid gap-3">
						{#each data.auditLogs as log}
							<div class="rounded-xl border border-neutral-200 px-4 py-3 text-sm dark:border-[#1f3554]">
								<p class="font-semibold text-neutral-900 dark:text-white">{auditLabel(log)}</p>
								<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-300">{formatDateTime(log.created_at)}</p>
								{#if auditDetail(log)}
									<p class="mt-2 text-neutral-600 dark:text-neutral-200">{auditDetail(log)}</p>
								{/if}
							</div>
						{/each}
						{#if data.auditLogs.length === 0}
							<p class="rounded-xl border border-dashed border-neutral-300 px-4 py-3 text-sm text-neutral-600 dark:border-[#1f3554] dark:text-neutral-200">
								Todavía no hay eventos de auditoría para este turno.
							</p>
						{/if}
					</div>
				</div>
			</div>

			<aside class="flex flex-col gap-6">
				<form method="POST" action="?/update_status" class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
					<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Acciones de estado</h2>
					<div class="mt-4 grid gap-2">
						{#each ['confirmed', 'reschedule_requested', 'attended', 'no_show'] as status}
							<button name="status" value={status} disabled={isClosed || data.appointment.status === status || (!canOperate && !(canProfessionalClose && (status === 'attended' || status === 'no_show')))} class="rounded-xl border border-neutral-200 px-4 py-3 text-left text-sm font-semibold transition hover:bg-neutral-50 disabled:opacity-50 dark:border-[#1f3554] dark:hover:bg-[#0f1f36]">
								{statusLabels[status]}
							</button>
						{/each}
					</div>
				</form>

				<form method="POST" action="?/update_status" class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
					<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Cancelar turno</h2>
					<label class="mt-4 block space-y-1">
						<span class="text-sm font-semibold">Motivo opcional</span>
						<textarea name="reason" rows="3" disabled={!canOperate || isClosed} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]">{data.appointment.cancelled_reason ?? ''}</textarea>
					</label>
					<button name="status" value="cancelled" type="submit" disabled={!canOperate || isClosed} class="mt-4 w-full rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">
						Cancelar
					</button>
				</form>

				<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
					<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Reprogramar</h2>
					<form method="GET" class="mt-4 flex gap-2">
						<input type="hidden" name="from_date" value={data.fromDate} />
						<label class="flex-1 space-y-1">
							<span class="text-sm font-semibold">Día</span>
							<input type="date" name="reprogram_date" value={data.reprogramDate} disabled={!canOperate || isClosed} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
						</label>
						<button disabled={!canOperate || isClosed} class="self-end rounded-xl border border-neutral-200 px-4 py-3 text-sm font-semibold disabled:opacity-60 dark:border-[#1f3554]">
							Ver
						</button>
					</form>

					<form method="POST" action="?/reschedule" class="mt-4">
						<input type="hidden" name="reprogram_date" value={data.reprogramDate} />
						<label class="space-y-1">
							<span class="text-sm font-semibold">Horario disponible</span>
							<select name="slot_starts_at" disabled={!canOperate || isClosed || data.reprogramSlots.length === 0} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]">
								<option value="">Seleccionar</option>
								{#each data.reprogramSlots as slot}
									<option value={slot.starts_at}>{slot.time} · {slot.professional_name}</option>
								{/each}
							</select>
						</label>
						{#if data.reprogramSlots.length === 0}
							<p class="mt-3 text-xs text-neutral-500 dark:text-neutral-300">No hay disponibilidad para ese día con el mismo servicio y profesional.</p>
						{/if}
						<button type="submit" disabled={!canOperate || isClosed || data.reprogramSlots.length === 0} class="mt-4 w-full rounded-xl bg-[#7c3aed] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">
							Reprogramar
						</button>
					</form>
				</div>
			</aside>
		</div>
	{/if}
</section>
