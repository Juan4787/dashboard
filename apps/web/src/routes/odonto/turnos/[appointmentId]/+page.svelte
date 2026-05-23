<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
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
		public_booking: 'Reserva online',
		manual: 'Manual',
		whatsapp_bot: 'WhatsApp',
		admin: 'Administración interna'
	};

	const statusTone: Record<string, string> = {
		reserved: 'bg-[#7c3aed]/25 text-[#c4b5fd]',
		confirmed: 'bg-emerald-400/15 text-emerald-200',
		cancelled: 'bg-red-500/15 text-red-200',
		reschedule_requested: 'bg-amber-400/15 text-amber-100',
		attended: 'bg-sky-400/15 text-sky-100',
		no_show: 'bg-zinc-400/15 text-zinc-200'
	};

	const timeOnly = (value: string) =>
		new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));

	const dateOnly = (value: string) =>
		new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }).format(
			new Date(value)
		);

	const durationText = (appointment: any) => {
		const minutes =
			Number(appointment?.duration_minutes_snapshot) ||
			Math.round((new Date(appointment?.ends_at).getTime() - new Date(appointment?.starts_at).getTime()) / 60_000);
		return `${minutes} min`;
	};

	const serviceMark = (name: string) =>
		name
			.split(' ')
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase())
			.join('');

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
			if (from && to) return `${formatDateTime(from)} -> ${formatDateTime(to)}`;
		}
		const reason = metadataValue(log, 'reason');
		if (reason) return reason;
		const fromStatus = metadataValue(log, 'from_status');
		const toStatus = metadataValue(log, 'to_status');
		if (fromStatus && toStatus) return `${statusLabels[fromStatus] ?? fromStatus} -> ${statusLabels[toStatus] ?? toStatus}`;
		return '';
	};

	const canUseStatusAction = (status: string) => {
		if (isClosed || data.appointment.status === status) return false;
		if (canOperate) return true;
		return canProfessionalClose && (status === 'attended' || status === 'no_show');
	};

	const mainActions = [
		{ status: 'confirmed', label: 'Confirmar', tone: 'text-emerald-200', mark: 'OK' },
		{ status: 'attended', label: 'Asistió', tone: 'text-sky-200', mark: 'A' },
		{ status: 'no_show', label: 'No asistió', tone: 'text-amber-100', mark: 'N' },
		{ status: 'cancelled', label: 'Cancelar', tone: 'text-red-200', mark: 'X' }
	];
</script>

<section class="flex flex-col gap-5">
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-3 text-sm font-semibold text-neutral-500 dark:text-white/55">
			<div class="grid h-11 w-11 place-items-center rounded-2xl border border-[#8b5cf6]/35 bg-[#7c3aed]/15 text-sm font-bold text-[#c4b5fd]">
				{data.appointment ? serviceMark(data.appointment.service_name_snapshot) : 'T'}
			</div>
			<span>Agenda</span>
			<span class="text-white/25">/</span>
			<span>Turno</span>
			<span class="text-white/25">/</span>
			<span class="text-[#a78bfa]">Detalle</span>
		</div>
		<BackLink href={`/odonto/agenda?date=${data.fromDate}`} label="Volver" />
	</div>

	{#if form?.message}
		<p class={`rounded-2xl px-4 py-3 text-sm font-semibold ${form.success ? 'bg-emerald-400/15 text-emerald-100' : 'bg-red-500/15 text-red-100'}`}>
			{form.message}
		</p>
	{/if}

	{#if data.appointment}
		<article class="rounded-3xl border border-[#244062] bg-[#071626] p-5 shadow-2xl shadow-black/20 sm:p-7 lg:p-9">
			<div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
				<div class="flex items-start gap-5">
					<div class="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-[#7c3aed]/35 text-2xl font-bold text-white ring-1 ring-[#8b5cf6]/40">
						{serviceMark(data.appointment.service_name_snapshot)}
					</div>
					<div>
						<h1 class="text-3xl font-semibold tracking-tight text-white md:text-4xl">
							{data.appointment.service_name_snapshot}
						</h1>
						<p class="mt-2 text-lg font-semibold text-white/55">
							{data.appointment.professional_name_snapshot}
						</p>
					</div>
				</div>
				<span class={`w-fit rounded-full px-5 py-3 text-sm font-bold ${statusTone[data.appointment.status] ?? 'bg-white/10 text-white'}`}>
					{statusLabels[data.appointment.status] ?? data.appointment.status}
				</span>
			</div>

			<div class="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				<div class="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
					<p class="text-sm font-semibold text-white/55">Paciente</p>
					<p class="mt-2 text-lg font-semibold text-white">{data.appointment.patients?.full_name ?? 'Sin paciente'}</p>
				</div>
				<div class="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
					<p class="text-sm font-semibold text-white/55">Fecha</p>
					<p class="mt-2 text-lg font-semibold capitalize text-white">{dateOnly(data.appointment.starts_at)}</p>
				</div>
				<div class="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
					<p class="text-sm font-semibold text-white/55">Hora</p>
					<p class="mt-2 text-lg font-semibold text-white">
						{timeOnly(data.appointment.starts_at)} - {timeOnly(data.appointment.ends_at)}
					</p>
				</div>
				<div class="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
					<p class="text-sm font-semibold text-white/55">Duración</p>
					<p class="mt-2 text-lg font-semibold text-white">{durationText(data.appointment)}</p>
				</div>
			</div>

			<div class="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				{#each mainActions as action}
					<form method="POST" action="?/update_status">
						<button
							name="status"
							value={action.status}
							disabled={!canUseStatusAction(action.status)}
							class="flex w-full items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-5 text-lg font-bold text-white transition hover:border-[#8b5cf6]/60 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-35"
						>
							<span class={`grid h-9 w-9 place-items-center rounded-full bg-white/10 text-sm ${action.tone}`}>{action.mark}</span>
							{action.label}
						</button>
					</form>
				{/each}
			</div>

			<div class="mt-7 grid gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-5 lg:grid-cols-3">
				<div>
					<p class="text-sm font-semibold text-white/45">Teléfono</p>
					<p class="mt-1 text-base font-semibold text-white">{data.appointment.patients?.phone_e164 ?? 'Sin teléfono'}</p>
				</div>
				<div>
					<p class="text-sm font-semibold text-white/45">Correo</p>
					<p class="mt-1 text-base font-semibold text-white">{data.appointment.patients?.email ?? 'Sin correo electrónico'}</p>
				</div>
				<div>
					<p class="text-sm font-semibold text-white/45">Origen</p>
					<p class="mt-1 text-base font-semibold text-white">{sourceLabels[data.appointment.source] ?? data.appointment.source}</p>
				</div>
			</div>
		</article>

		<details id="reprogramar" class="group rounded-3xl border border-[#244062] bg-[#071626] shadow-xl shadow-black/10">
			<summary class="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 text-lg font-semibold text-white sm:px-7">
				<span>Más detalles</span>
				<span class="text-[#a78bfa] transition group-open:rotate-180">v</span>
			</summary>
			<div class="border-t border-white/10 px-5 py-6 sm:px-7">
				<div class="grid gap-5 lg:grid-cols-2">
					<div class="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
						<h2 class="text-lg font-semibold text-white">Reprogramar</h2>
						<form method="GET" class="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
							<input type="hidden" name="from_date" value={data.fromDate} />
							<label class="space-y-1">
								<span class="text-sm font-semibold text-white/65">Día</span>
								<input type="date" name="reprogram_date" value={data.reprogramDate} disabled={!canOperate || isClosed} class="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white disabled:opacity-50" />
							</label>
							<button disabled={!canOperate || isClosed} class="self-end rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50">
								Ver horarios
							</button>
						</form>

						<form method="POST" action="?/reschedule" class="mt-4">
							<input type="hidden" name="reprogram_date" value={data.reprogramDate} />
							<label class="space-y-1">
								<span class="text-sm font-semibold text-white/65">Horario</span>
								<select name="slot_starts_at" disabled={!canOperate || isClosed || data.reprogramSlots.length === 0} class="w-full rounded-2xl border border-white/10 bg-[#0b1d32] px-4 py-3 text-sm text-white disabled:opacity-50">
									<option value="">Seleccionar horario</option>
									{#each data.reprogramSlots as slot}
										<option value={slot.starts_at}>{slot.time}</option>
									{/each}
								</select>
							</label>
							{#if data.reprogramSlots.length === 0}
								<p class="mt-3 text-sm text-white/45">No hay horarios para ese día.</p>
							{/if}
							<button type="submit" disabled={!canOperate || isClosed || data.reprogramSlots.length === 0} class="mt-4 w-full rounded-2xl bg-[#7c3aed] px-5 py-4 text-sm font-semibold text-white transition hover:bg-[#6d28d9] disabled:opacity-45">
								Reprogramar
							</button>
						</form>
					</div>

					<div class="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
						<h2 class="text-lg font-semibold text-white">Información</h2>
						<div class="mt-4 grid gap-4 text-sm">
							<div>
								<p class="font-semibold text-white/45">Horario del turno</p>
								<p class="mt-1 font-semibold text-white">{formatDateTime(data.appointment.starts_at)} - {timeOnly(data.appointment.ends_at)}</p>
							</div>
							<div>
								<p class="font-semibold text-white/45">Tiempo separado en agenda</p>
								<p class="mt-1 font-semibold text-white">{formatDateTime(data.appointment.blocking_starts_at)} - {timeOnly(data.appointment.blocking_ends_at)}</p>
							</div>
							{#if data.appointment.cancelled_reason}
								<div>
									<p class="font-semibold text-white/45">Motivo de cancelación</p>
									<p class="mt-1 font-semibold text-white">{data.appointment.cancelled_reason}</p>
								</div>
							{/if}
							{#if data.appointment.internal_note}
								<div>
									<p class="font-semibold text-white/45">Nota interna</p>
									<p class="mt-1 font-semibold text-white">{data.appointment.internal_note}</p>
								</div>
							{/if}
						</div>
					</div>
				</div>
			</div>
		</details>

		<details class="group rounded-3xl border border-[#244062] bg-[#071626] shadow-xl shadow-black/10">
			<summary class="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 text-lg font-semibold text-white sm:px-7">
				<span>Historial</span>
				<span class="text-[#a78bfa] transition group-open:rotate-180">v</span>
			</summary>
			<div class="border-t border-white/10 px-5 py-6 sm:px-7">
				<div class="grid gap-3">
					{#each data.auditLogs as log}
						<div class="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-4 text-sm">
							<p class="font-semibold text-white">{auditLabel(log)}</p>
							<p class="mt-1 text-xs font-semibold text-white/45">{formatDateTime(log.created_at)}</p>
							{#if auditDetail(log)}
								<p class="mt-2 text-white/70">{auditDetail(log)}</p>
							{/if}
						</div>
					{/each}
					{#if data.auditLogs.length === 0}
						<p class="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-4 text-sm text-white/60">
							Todavía no hay movimientos registrados.
						</p>
					{/if}
				</div>
			</div>
		</details>
	{/if}
</section>
