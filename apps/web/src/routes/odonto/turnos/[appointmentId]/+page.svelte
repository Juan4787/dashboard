<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import { formatDateTime } from '$lib/utils/format';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';

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
			messageDispatches: any[];
			userLabels: Record<string, string>;
			reprogramDate: string;
			minReprogramDate: string;
			reprogramSlots: Slot[];
			fromDate: string;
			justRescheduled: boolean;
			rescheduleWhatsAppUrl: string | null;
			reschedulePublicUrl: string | null;
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
		new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));

	const dateOnly = (value: string) =>
		new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }).format(
			new Date(value)
		);

	const durationText = (appointment: any) => {
		const minutes =
			Number(appointment?.duration_minutes_snapshot) ||
			Math.round((new Date(appointment?.ends_at).getTime() - new Date(appointment?.starts_at).getTime()) / 60_000);
		return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
	};

	const metadataValue = (log: AuditLog, key: string) => {
		const value = log.metadata?.[key];
		return typeof value === 'string' ? value : null;
	};

	const auditLabel = (log: AuditLog) => {
		const user = log.user_id ? (data.userLabels[log.user_id] ?? log.user_id.slice(0, 8)) : 'Sistema';
		if (log.action === 'appointment.created') return `${user} creó el turno`;
		if (log.action === 'appointment.public_created') return 'El paciente reservó el turno online';
		if (log.action === 'appointment.public_confirmed') return 'El paciente confirmó el turno desde el enlace';
		if (log.action === 'appointment.public_cancelled') return 'El paciente canceló el turno desde el enlace';
		if (log.action === 'appointment.public_reschedule_requested') {
			return 'El paciente pidió reprogramar desde el enlace';
		}
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

	// --- Reprogramar: calendario inline + chips de horario ---
	const parseIso = (iso: string) => {
		const [y, m, d] = iso.split('-').map(Number);
		return { y, m, d };
	};

	const initialReprogramState = (initialData: {
		reprogramDate: string;
		minReprogramDate: string;
		reprogramSlots: Slot[];
	}) => ({
		todayIso: initialData.minReprogramDate,
		reprogramDate: initialData.reprogramDate,
		reprogramSlots: initialData.reprogramSlots,
		initParts: parseIso(initialData.reprogramDate)
	});

	// svelte-ignore state_referenced_locally
	const reprogramInitial = initialReprogramState(data);
	const todayIso = reprogramInitial.todayIso;
	const initParts = reprogramInitial.initParts;

	let selectedDate = $state(reprogramInitial.reprogramDate);
	let viewYear = $state(initParts.y);
	let viewMonth = $state(initParts.m - 1);
	let slotsCache = $state<Record<string, Slot[]>>({
		[reprogramInitial.reprogramDate]: reprogramInitial.reprogramSlots ?? []
	});
	let loadingSlots = $state(false);
	let slotsError = $state<string | null>(null);
	let selectedSlot = $state('');
	let submitting = $state(false);

	$effect(() => {
		const nextParts = parseIso(data.reprogramDate);
		selectedDate = data.reprogramDate;
		viewYear = nextParts.y;
		viewMonth = nextParts.m - 1;
		slotsCache = { [data.reprogramDate]: data.reprogramSlots ?? [] };
		selectedSlot = '';
		slotsError = null;
		loadingSlots = false;
	});

	const weekdayLabels = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

	const currentSlots = $derived(slotsCache[selectedDate] ?? []);
	const selectedSlotTime = $derived(currentSlots.find((s) => s.starts_at === selectedSlot)?.time ?? '');

	const monthLabel = $derived(
		new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(new Date(viewYear, viewMonth, 1))
	);

	const canGoPrev = $derived(`${viewYear}-${String(viewMonth + 1).padStart(2, '0')}` > todayIso.slice(0, 7));

	const monthDays = $derived.by(() => {
		const startOffset = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
		const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
		const cells: ({ day: number; iso: string } | null)[] = [];
		for (let i = 0; i < startOffset; i++) cells.push(null);
		for (let d = 1; d <= daysInMonth; d++) {
			const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
			cells.push({ day: d, iso });
		}
		return cells;
	});

	const selectedDayLabel = $derived.by(() => {
		const { y, m, d } = parseIso(selectedDate);
		return new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).format(
			new Date(y, m - 1, d)
		);
	});

	const isPast = (iso: string) => iso < todayIso;
	const isToday = (iso: string) => iso === todayIso;
	const isSelected = (iso: string) => iso === selectedDate;

	const loadSlots = async (date: string) => {
		if (slotsCache[date]) return;
		loadingSlots = true;
		slotsError = null;
		try {
			const res = await fetch(`/odonto/turnos/${data.appointment.id}/slots?date=${date}`);
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				slotsError = body?.message ?? 'No se pudieron cargar los horarios.';
				slotsCache = { ...slotsCache, [date]: [] };
			} else {
				slotsCache = { ...slotsCache, [date]: (body.slots ?? []) as Slot[] };
			}
		} catch {
			slotsError = 'No se pudieron cargar los horarios. Revisá tu conexión.';
			slotsCache = { ...slotsCache, [date]: [] };
		} finally {
			loadingSlots = false;
		}
	};

	const selectDay = (iso: string) => {
		if (isPast(iso) || selectedDate === iso) return;
		selectedDate = iso;
		selectedSlot = '';
		slotsError = null;
		loadSlots(iso);
	};

	const prevMonth = () => {
		if (!canGoPrev) return;
		if (viewMonth === 0) {
			viewMonth = 11;
			viewYear -= 1;
		} else {
			viewMonth -= 1;
		}
	};

	const nextMonth = () => {
		if (viewMonth === 11) {
			viewMonth = 0;
			viewYear += 1;
		} else {
			viewMonth += 1;
		}
	};

	const onReschedule: SubmitFunction = ({ cancel }) => {
		if (!selectedSlot || submitting) {
			cancel();
			return;
		}
		submitting = true;
		return async ({ update }) => {
			await update();
			submitting = false;
		};
	};
</script>

<section class="flex flex-col gap-5">
	<div class="flex flex-col items-start gap-4">
		<BackLink href={`/odonto/agenda?date=${data.fromDate}`} label="Volver" />
		<div class="flex items-center gap-3 text-sm font-semibold text-neutral-500 dark:text-white/55">
			<span>Agenda</span>
			<span class="text-white/25">/</span>
			<span>Turno</span>
			<span class="text-white/25">/</span>
			<span class="text-[#a78bfa]">Detalle</span>
		</div>
	</div>

	{#if form?.message}
		<p class={`rounded-2xl px-4 py-3 text-sm font-semibold ${form.success ? 'bg-emerald-400/15 text-emerald-100' : 'bg-red-500/15 text-red-100'}`}>
			{form.message}
		</p>
	{/if}

	{#if data.justRescheduled && data.appointment}
		<div class="rounded-3xl border border-emerald-400/30 bg-emerald-400/10 p-5">
			<h2 class="text-lg font-semibold text-emerald-50">Turno reprogramado</h2>
			<p class="mt-2 text-sm text-emerald-100/80">
				Los avisos del horario anterior se invalidaron y los recordatorios se recalcularon para
				la nueva fecha. Avisale al paciente del cambio.
			</p>
			{#if data.rescheduleWhatsAppUrl}
				<div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
					<a
						href={data.rescheduleWhatsAppUrl}
						target="_blank"
						rel="noreferrer"
						class="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-400"
					>
						Enviar actualización por WhatsApp
					</a>
					{#if data.reschedulePublicUrl}
						<a
							href={data.reschedulePublicUrl}
							target="_blank"
							rel="noreferrer"
							class="text-sm font-semibold text-emerald-100/80 underline"
						>
							Ver lo que verá el paciente
						</a>
					{/if}
				</div>
			{:else}
				<p class="mt-4 text-sm font-semibold text-amber-100">
					Este paciente no tiene un teléfono válido cargado: avisale del cambio por otro medio.
				</p>
			{/if}
		</div>
	{/if}

	{#if data.appointment}
		<article class="rounded-3xl border border-[#244062] bg-[#071626] p-5 shadow-2xl shadow-black/20 sm:p-7 lg:p-9">
			<div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
				<div class="flex items-start gap-5">
					<div class="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-[#7c3aed]/35 text-2xl font-bold uppercase text-white ring-1 ring-[#8b5cf6]/40">
						{(data.appointment.patients?.full_name || data.appointment.service_name_snapshot || '·').trim().charAt(0)}
					</div>
					<div>
						<h1 class="text-3xl font-semibold tracking-tight text-white md:text-4xl">
							{data.appointment.service_name_snapshot}
						</h1>
						<p class="mt-2 text-lg font-semibold text-white/55">
							<span class="text-white/40">Profesional:</span> {data.appointment.professional_name_snapshot}
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
				{#if data.appointment.internal_note}
					<div class="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
						<p class="text-sm font-semibold text-white/55">Nota interna</p>
						<p class="mt-2 text-base font-semibold text-white">{data.appointment.internal_note}</p>
					</div>
				{/if}
				{#if data.appointment.cancelled_reason}
					<div class="rounded-2xl border border-red-400/20 bg-red-500/10 p-5">
						<p class="text-sm font-semibold text-red-100/70">Motivo de cancelación</p>
						<p class="mt-2 text-base font-semibold text-white">{data.appointment.cancelled_reason}</p>
					</div>
				{/if}
			</div>

			<div class="mt-7">
				<details class="rounded-2xl border border-red-400/20 bg-red-500/10">
					<summary class="cursor-pointer list-none px-5 py-5 text-lg font-bold text-red-100">Cancelar turno</summary>
					<form method="POST" action="?/update_status" class="border-t border-red-400/20 p-5">
						<input type="hidden" name="status" value="cancelled" />
						<label>
							<span class="ux-label">Motivo (opcional)</span>
							<textarea name="reason" rows="2" disabled={!canUseStatusAction('cancelled')} class="ux-textarea"></textarea>
						</label>
						<label class="mt-4 flex items-start gap-3 text-sm font-bold text-red-100">
							<input type="checkbox" required disabled={!canUseStatusAction('cancelled')} class="mt-1 h-4 w-4 accent-red-600 disabled:opacity-60" />
							<span>Confirmo que quiero cancelar este turno.</span>
						</label>
						<button disabled={!canUseStatusAction('cancelled')} class="ux-btn-danger mt-4 w-full">Cancelar turno</button>
					</form>
				</details>
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
				<span>Reprogramar</span>
				<span class="text-[#a78bfa] transition group-open:rotate-180">v</span>
			</summary>
			<div class="border-t border-white/10 px-5 py-6 sm:px-7">
				<div>
					<div class="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
						<h2 class="text-lg font-semibold text-white">Reprogramar</h2>
						{#if !canOperate || isClosed}
							<p class="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/55">
								{isClosed
									? 'Este turno está cerrado, no se puede reprogramar.'
									: 'No tenés permiso para reprogramar este turno.'}
							</p>
						{:else}
							<div class="mt-4 rounded-2xl border border-white/10 bg-[#0a1b2e] p-4">
								<div class="flex items-center justify-between">
									<button type="button" onclick={prevMonth} disabled={!canGoPrev} aria-label="Mes anterior" class="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-lg text-white/80 transition hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent">‹</button>
									<span class="text-sm font-semibold capitalize text-white">{monthLabel}</span>
									<button type="button" onclick={nextMonth} aria-label="Mes siguiente" class="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-lg text-white/80 transition hover:bg-white/10">›</button>
								</div>
								<div class="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-white/35">
									{#each weekdayLabels as wd}
										<span class="py-1">{wd}</span>
									{/each}
								</div>
								<div class="mt-1 grid grid-cols-7 gap-1">
									{#each monthDays as cell}
										{#if cell === null}
											<span></span>
										{:else}
											<button
												type="button"
												onclick={() => selectDay(cell.iso)}
												disabled={isPast(cell.iso)}
												class={`grid h-10 place-items-center rounded-xl text-sm font-semibold transition ${
													isSelected(cell.iso)
														? 'bg-[#7c3aed] text-white shadow-lg shadow-[#7c3aed]/30'
														: isPast(cell.iso)
															? 'cursor-not-allowed text-white/20'
															: 'text-white/80 hover:bg-white/10'
												} ${isToday(cell.iso) && !isSelected(cell.iso) ? 'ring-1 ring-[#8b5cf6]/60' : ''}`}
											>
												{cell.day}
											</button>
										{/if}
									{/each}
								</div>
							</div>

							<div class="mt-4">
								<div class="flex items-center justify-between gap-2">
									<span class="text-sm font-semibold text-white/65">
										Horarios · <span class="capitalize text-white">{selectedDayLabel}</span>
									</span>
									{#if loadingSlots}
										<span class="text-xs font-semibold text-[#a78bfa]">Buscando…</span>
									{/if}
								</div>

								{#if slotsError}
									<p class="mt-3 rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-100">{slotsError}</p>
								{:else if loadingSlots && currentSlots.length === 0}
									<div class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
										{#each Array(8) as _}
											<div class="h-10 animate-pulse rounded-xl bg-white/5"></div>
										{/each}
									</div>
								{:else if currentSlots.length === 0}
									<p class="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white/55">
										No hay horarios disponibles ese día. Probá con otra fecha.
									</p>
								{:else}
									<div class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
										{#each currentSlots as slot}
											<button
												type="button"
												onclick={() => (selectedSlot = slot.starts_at)}
												class={`rounded-xl border px-2 py-2.5 text-sm font-semibold tabular-nums transition ${
													selectedSlot === slot.starts_at
														? 'border-[#7c3aed] bg-[#7c3aed] text-white shadow-lg shadow-[#7c3aed]/30'
														: 'border-white/10 bg-white/[0.04] text-white/85 hover:border-[#8b5cf6]/60 hover:bg-white/10'
												}`}
											>
												{slot.time}
											</button>
										{/each}
									</div>
								{/if}
							</div>

							<form method="POST" action="?/reschedule" class="mt-5" use:enhance={onReschedule}>
								<input type="hidden" name="slot_starts_at" value={selectedSlot} />
								<input type="hidden" name="reprogram_date" value={selectedDate} />
								<button
									type="submit"
									disabled={!selectedSlot || submitting}
									class="w-full rounded-2xl bg-[#7c3aed] px-5 py-4 text-sm font-semibold text-white transition hover:bg-[#6d28d9] disabled:cursor-not-allowed disabled:opacity-40"
								>
									{submitting
										? 'Reprogramando…'
										: selectedSlot
											? `Reprogramar a las ${selectedSlotTime}`
											: 'Elegí un horario'}
								</button>
							</form>
						{/if}
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
