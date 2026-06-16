<script lang="ts">
	import type { ReminderCandidate, ReminderDay } from '$lib/server/reminders';

	let { data, form } = $props<{
		data: {
			demo: boolean;
			day: ReminderDay;
			candidates: ReminderCandidate[];
			restricted: boolean;
		};
		form?: { success?: boolean; message?: string };
	}>();

	const pendingUpdate = $derived(
		data.candidates.filter((candidate: ReminderCandidate) => candidate.coverage === 'pendiente_actualizar')
	);
	const uncovered = $derived(
		data.candidates.filter((candidate: ReminderCandidate) => candidate.coverage === 'sin_calendario')
	);

	const dayLabel = $derived(data.day === 'hoy' ? 'hoy' : 'mañana');

	const relativeTime = (iso: string) => {
		const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
		if (minutes < 1) return 'recién';
		if (minutes < 60) return `hace ${minutes} min`;
		const hours = Math.round(minutes / 60);
		return `hace ${hours} h`;
	};

	const openHref = (candidate: ReminderCandidate, confirm = false) =>
		`/odonto/recordatorios/abrir/${candidate.appointment_id}?dia=${data.day}${confirm ? '&confirmar=1' : ''}`;
</script>

{#snippet reminderRow(candidate: ReminderCandidate)}
	<div class="ux-soft-card p-5">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
			<div class="min-w-0">
				<p class="text-lg font-bold text-white">{candidate.time_label} · {candidate.patient_name}</p>
				<p class="mt-1 text-sm text-white/55">{candidate.service_name} · {candidate.professional_name}</p>
				<p class="mt-2 text-sm font-bold {candidate.coverage === 'pendiente_actualizar' ? 'text-amber-300' : 'text-white/70'}">
					{candidate.coverage === 'pendiente_actualizar'
						? '⚠ Calendario pendiente de actualizar'
						: '○ Sin calendario registrado'}
				</p>
				{#if candidate.whatsapp_marked_sent_at}
					<p class="mt-2 text-sm font-bold text-emerald-300">✓ Enviado {relativeTime(candidate.whatsapp_marked_sent_at)}</p>
				{:else if candidate.whatsapp_opened_at}
					<p class="mt-2 text-sm text-white/55">WhatsApp abierto {relativeTime(candidate.whatsapp_opened_at)}</p>
				{/if}
			</div>
			<div class="flex shrink-0 flex-col gap-2 sm:items-end">
				{#if !candidate.phone_e164}
					<span class="ux-badge ux-badge-warning">Sin teléfono válido</span>
				{:else if candidate.whatsapp_marked_sent_at}
					<a href={openHref(candidate, true)} target="_blank" rel="noreferrer" class="ux-btn-secondary">
						Abrir de nuevo
					</a>
				{:else if candidate.whatsapp_opened_at}
					<p class="max-w-60 text-right text-xs text-white/45">
						Ya se abrió un recordatorio para este turno. ¿Abrirlo otra vez?
					</p>
					<a href={openHref(candidate, true)} target="_blank" rel="noreferrer" class="ux-btn-secondary">
						Abrir de todos modos
					</a>
					<form method="POST" action="?/mark_sent">
						<input type="hidden" name="appointment_id" value={candidate.appointment_id} />
						<button class="ux-btn-primary w-full" disabled={data.demo}>Marcar como enviado</button>
					</form>
				{:else}
					<a href={openHref(candidate)} target="_blank" rel="noreferrer" class="ux-btn-primary">
						Enviar WhatsApp
					</a>
				{/if}
			</div>
		</div>
	</div>
{/snippet}

<section class="ux-page">
	<div class="ux-hero">
		<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<h1 class="ux-title">Turnos para recordar</h1>
				<p class="ux-subtitle">
					Pacientes con turno {dayLabel} que no registraron el turno en su calendario.
					Reforzá el recordatorio por WhatsApp: el mensaje ya sale escrito, solo revisás y enviás.
				</p>
			</div>
			<div class="flex gap-2">
				<a href="?dia=manana" class={data.day === 'manana' ? 'ux-btn-primary' : 'ux-btn-secondary'}>Mañana</a>
				<a href="?dia=hoy" class={data.day === 'hoy' ? 'ux-btn-primary' : 'ux-btn-secondary'}>Hoy</a>
			</div>
		</div>
	</div>

	{#if form?.message}
		<p class="ux-alert">{form.message}</p>
	{/if}

	{#if data.restricted}
		<div class="ux-card">
			<p class="ux-empty">
				El acceso comercial del consultorio está restringido: los recordatorios operativos
				están pausados.
			</p>
		</div>
	{:else if data.candidates.length === 0}
		<div class="ux-card">
			<p class="ux-empty">
				No hay recordatorios pendientes para {dayLabel}. Todos los turnos tienen calendario
				registrado o cobertura de recordatorio.
			</p>
		</div>
	{:else}
		{#if pendingUpdate.length > 0}
			<div class="ux-card">
				<h2 class="ux-section-title">Calendario pendiente de actualizar</h2>
				<p class="mt-2 text-sm text-white/55">
					Estos turnos se reprogramaron después de que el paciente registró el calendario:
					puede tener guardada la fecha vieja.
				</p>
				<div class="mt-5 grid gap-3">
					{#each pendingUpdate as candidate (candidate.appointment_id)}
						{@render reminderRow(candidate)}
					{/each}
				</div>
			</div>
		{/if}

		{#if uncovered.length > 0}
			<div class="ux-card">
				<h2 class="ux-section-title">Sin calendario registrado</h2>
				<div class="mt-5 grid gap-3">
					{#each uncovered as candidate (candidate.appointment_id)}
						{@render reminderRow(candidate)}
					{/each}
				</div>
			</div>
		{/if}
	{/if}

	{#if data.demo}
		<p class="ux-empty">Modo demo: los botones no abren WhatsApp real.</p>
	{/if}
</section>
