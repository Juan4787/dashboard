<script lang="ts">
	import { goto } from '$app/navigation';
	import { formatDateTime } from '$lib/utils/format';

	const weekdays = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
	const weekdayShort = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

	type Professional = { id: string; name: string; is_active: boolean };
	type Rule = {
		id: string;
		weekday: number;
		start_time: string;
		end_time: string;
		slot_interval_minutes: number;
		is_active: boolean;
	};
	type Exception = {
		id: string;
		professional_id: string | null;
		starts_at: string;
		ends_at: string;
		type: 'blocked' | 'extra_available';
		reason: string | null;
	};

	let { data, form } = $props<{
		data: {
			context: { canOperate: boolean };
			professionals: Professional[];
			rules: Rule[];
			exceptions: Exception[];
			selectedProfessionalId: string;
			demo: boolean;
		};
		form?: { message?: string };
	}>();

	const canOperate = $derived(data.context.canOperate && !data.demo);
	const professionals = $derived(data.professionals as Professional[]);
	let pendingProfessionalId = $state<string | null>(null);
	let selectedWeekdays = $state<number[]>([1, 2, 3, 4, 5]);
	const selectedProfessionalId = $derived(pendingProfessionalId ?? data.selectedProfessionalId);
	const selectedProfessional = $derived(
		professionals.find((professional) => professional.id === selectedProfessionalId)
	);
	const isChangingProfessional = $derived(
		pendingProfessionalId !== null && pendingProfessionalId !== data.selectedProfessionalId
	);
	const professionalName = (id: string | null) =>
		id ? professionals.find((professional) => professional.id === id)?.name ?? 'Profesional' : 'Todo el consultorio';
	const rulesByWeekday = $derived.by(() =>
		weekdays.map((day, weekday) => ({
			day,
			weekday,
			rules: (data.rules as Rule[]).filter((rule) => rule.weekday === weekday)
		}))
	);

	$effect(() => {
		if (pendingProfessionalId === data.selectedProfessionalId) pendingProfessionalId = null;
	});

	const selectProfessional = (professionalId: string) => {
		pendingProfessionalId = professionalId;
		const search = new URLSearchParams();
		if (professionalId) search.set('professional_id', professionalId);
		goto(`/odonto/disponibilidad${search.toString() ? `?${search.toString()}` : ''}`, {
			keepFocus: true,
			noScroll: true
		});
	};

	const toggleWeekday = (weekday: number) => {
		selectedWeekdays = selectedWeekdays.includes(weekday)
			? selectedWeekdays.filter((item) => item !== weekday)
			: [...selectedWeekdays, weekday].sort((a, b) => a - b);
	};

	const setWeekdays = (weekdays: number[]) => {
		selectedWeekdays = weekdays;
	};
</script>

<section class="ux-page">
	<div class="ux-hero">
		<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<p class="ux-badge">Horarios</p>
				<h1 class="ux-title mt-4">Disponibilidad</h1>
				<p class="ux-subtitle">Definí cuándo atiende cada profesional y qué días se bloquean.</p>
			</div>
			<div class="ux-soft-card min-w-40 p-5">
				<p class="text-sm font-bold text-white/55">Profesional</p>
				<p class="mt-1 text-xl font-bold text-white">{selectedProfessional?.name ?? 'Sin seleccionar'}</p>
			</div>
		</div>
	</div>

	{#if form?.message}
		<p class="ux-alert">{form.message}</p>
	{/if}

	<div class="ux-card">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
			<div>
				<h2 class="ux-section-title">Elegí profesional</h2>
				<p class="mt-2 text-sm text-white/55">La disponibilidad que guardes se aplica al profesional activo.</p>
			</div>
			{#if isChangingProfessional}
				<span class="rounded-full border border-white/10 px-4 py-2 text-sm font-bold text-white/60">Cargando...</span>
			{/if}
		</div>
		<div class="mt-5 flex flex-wrap gap-3">
			{#each data.professionals as professional}
				<button
					type="button"
					class={`rounded-2xl border px-5 py-4 text-left transition ${
						professional.id === selectedProfessionalId
							? 'border-[#8b5cf6] bg-[#7c3aed]/25 text-white shadow-lg shadow-[#7c3aed]/10'
							: 'border-white/10 bg-white/[0.03] text-white/72 hover:border-[#8b5cf6]/60 hover:bg-white/[0.06]'
					}`}
					onclick={() => selectProfessional(professional.id)}
				>
					<span class="block text-sm font-black">{professional.name}</span>
					<span class="mt-1 block text-xs text-white/45">{professional.is_active ? 'Activo' : 'Inactivo'}</span>
				</button>
			{/each}
		</div>
	</div>

	<div class="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
		<form method="POST" action="?/save_weekly_rules" class="ux-card">
			<div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
				<div>
					<h2 class="ux-section-title">Horario habitual</h2>
					<p class="mt-2 max-w-2xl text-sm text-white/55">
						Marcá varios días y escribí los bloques horarios. Al guardar se reemplazan los horarios de esos días.
					</p>
				</div>
				<div class="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white/70">
					{selectedProfessional?.name ?? 'Sin profesional'}
				</div>
			</div>
			<input type="hidden" name="professional_id" value={selectedProfessionalId} />
			{#each selectedWeekdays as weekday}
				<input type="hidden" name="weekdays" value={weekday} />
			{/each}

			<div class="mt-6">
				<span class="ux-label">Días</span>
				<div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
					{#each weekdayShort as day, index}
						<button
							type="button"
							disabled={!canOperate || !selectedProfessionalId || isChangingProfessional}
							class={`rounded-2xl border px-4 py-4 text-center text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${
								selectedWeekdays.includes(index)
									? 'border-[#8b5cf6] bg-[#7c3aed] text-white shadow-lg shadow-[#7c3aed]/20'
									: 'border-white/10 bg-white/[0.03] text-white/65 hover:border-[#8b5cf6]/60 hover:bg-white/[0.06]'
							}`}
							onclick={() => toggleWeekday(index)}
						>
							{day}
						</button>
					{/each}
				</div>
				<div class="mt-3 flex flex-wrap gap-2">
					<button type="button" class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/65 hover:bg-white/[0.06]" onclick={() => setWeekdays([1, 2, 3, 4, 5])}>Lunes a viernes</button>
					<button type="button" class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/65 hover:bg-white/[0.06]" onclick={() => setWeekdays([1, 2, 3, 4, 5, 6])}>Lunes a sábado</button>
					<button type="button" class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/65 hover:bg-white/[0.06]" onclick={() => setWeekdays([])}>Limpiar</button>
				</div>
			</div>

			<div class="mt-6 grid gap-4 lg:grid-cols-[1fr_180px]">
				<label>
					<span class="ux-label">Horarios</span>
					<input
						name="time_ranges"
						type="text"
						required
						placeholder="09:00-13:00, 15:00-19:00"
						disabled={!canOperate || !selectedProfessionalId || isChangingProfessional}
						class="ux-input text-lg font-bold"
					/>
				</label>
				<label>
					<span class="ux-label">Cada cuántos minutos</span>
					<input
						name="slot_interval_minutes"
						type="text"
						inputmode="numeric"
						value="15"
						disabled={!canOperate || isChangingProfessional}
						class="ux-input text-lg font-bold"
					/>
				</label>
			</div>
			<button
				type="submit"
				disabled={!canOperate || !selectedProfessionalId || isChangingProfessional || selectedWeekdays.length === 0}
				class="ux-btn-primary mt-6 w-full"
			>
				Guardar disponibilidad
			</button>
		</form>

		<form method="POST" action="?/create_exception" class="ux-card">
			<h2 class="ux-section-title">Cambio puntual</h2>
			<p class="mt-2 text-sm text-white/55">Usalo para vacaciones, feriados, bloqueos u horarios extra.</p>
			<div class="mt-5 grid gap-4">
				<div>
					<span class="ux-label">Afecta a</span>
					<div class="mt-3 grid gap-2 sm:grid-cols-2">
						<label class="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-white/80">
							<input type="radio" name="professional_id" value={selectedProfessionalId} checked class="mr-2 accent-[#7c3aed]" />
							{selectedProfessional?.name ?? 'Profesional'}
						</label>
						<label class="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-white/80">
							<input type="radio" name="professional_id" value="" class="mr-2 accent-[#7c3aed]" />
							Todo el consultorio
						</label>
					</div>
				</div>
				<div>
					<span class="ux-label">Tipo</span>
					<div class="mt-3 grid gap-2 sm:grid-cols-2">
						<label class="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-white/80">
							<input type="radio" name="type" value="blocked" checked class="mr-2 accent-[#7c3aed]" />
							Bloquear
						</label>
						<label class="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-white/80">
							<input type="radio" name="type" value="extra_available" class="mr-2 accent-[#7c3aed]" />
							Sumar horario
						</label>
					</div>
				</div>
				<label>
					<span class="ux-label">Fecha</span>
					<input name="date" type="text" inputmode="numeric" placeholder="24/05/2026" required disabled={!canOperate} class="ux-input" />
				</label>
				<label>
					<span class="ux-label">Horario</span>
					<input name="time_range" type="text" placeholder="10:00-12:00" required disabled={!canOperate} class="ux-input" />
				</label>
				<label>
					<span class="ux-label">Motivo opcional</span>
					<input name="reason" placeholder="Vacaciones, feriado, trámite..." disabled={!canOperate} class="ux-input" />
				</label>
			</div>
			<button type="submit" disabled={!canOperate} class="ux-btn-secondary mt-5 w-full">
				Guardar cambio puntual
			</button>
		</form>
	</div>

	<div class="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
		<div class="ux-card">
			<div class="flex items-center justify-between gap-4">
				<h2 class="ux-section-title">Semana de {selectedProfessional?.name ?? 'profesional'}</h2>
				<span class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/55">
					{data.rules.length} bloques
				</span>
			</div>
			<div class="mt-5 grid gap-3">
				{#if isChangingProfessional}
					<p class="ux-empty">Cargando horarios...</p>
				{:else}
					{#each rulesByWeekday as day}
						<div class="ux-soft-card p-4">
							<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
								<p class="min-w-28 text-sm font-black text-white">{day.day}</p>
								<div class="flex flex-1 flex-wrap gap-2">
									{#if day.rules.length > 0}
										{#each day.rules as rule}
											<form method="POST" action="?/delete_rule" class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2">
												<input type="hidden" name="rule_id" value={rule.id} />
												<input type="hidden" name="professional_id" value={selectedProfessionalId} />
												<span class="text-sm font-bold text-white">{rule.start_time.slice(0, 5)} - {rule.end_time.slice(0, 5)}</span>
												<button type="submit" disabled={!canOperate} class="text-xs font-black text-red-200 disabled:opacity-50">Quitar</button>
											</form>
										{/each}
									{:else}
										<span class="rounded-full border border-dashed border-white/10 px-3 py-2 text-sm font-bold text-white/35">Sin atención</span>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				{/if}
				{#if !isChangingProfessional && data.rules.length === 0}
					<p class="ux-empty">No hay horarios semanales para este profesional.</p>
				{/if}
			</div>
		</div>

		<div class="ux-card">
			<h2 class="ux-section-title">Excepciones</h2>
			<div class="mt-5 grid gap-3">
				{#each data.exceptions as item}
					<form method="POST" action="?/delete_exception" class="ux-soft-card p-4">
						<input type="hidden" name="exception_id" value={item.id} />
						<input type="hidden" name="professional_id" value={item.professional_id ?? ''} />
						<div class="flex items-start justify-between gap-3">
							<div class="text-sm">
								<p class="font-bold text-white">{item.type === 'blocked' ? 'Bloqueo' : 'Horario extra'} · {professionalName(item.professional_id)}</p>
								<p class="mt-1 text-white/55">{formatDateTime(item.starts_at)} - {formatDateTime(item.ends_at)}</p>
								{#if item.reason}<p class="mt-1 text-xs text-white/42">{item.reason}</p>{/if}
							</div>
							<button type="submit" disabled={!canOperate} class="text-sm font-bold text-red-200 disabled:opacity-50">Eliminar</button>
						</div>
					</form>
				{/each}
				{#if data.exceptions.length === 0}
					<p class="ux-empty">Sin excepciones cargadas.</p>
				{/if}
			</div>
		</div>
	</div>
</section>
