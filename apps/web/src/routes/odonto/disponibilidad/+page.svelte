<script lang="ts">
	import { goto } from '$app/navigation';
	import { formatDateTime } from '$lib/utils/format';

	const weekdays = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

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
	const selectedProfessionalId = $derived(pendingProfessionalId ?? data.selectedProfessionalId);
	const selectedProfessional = $derived(
		professionals.find((professional) => professional.id === selectedProfessionalId)
	);
	const isChangingProfessional = $derived(
		pendingProfessionalId !== null && pendingProfessionalId !== data.selectedProfessionalId
	);
	const professionalName = (id: string | null) =>
		id ? professionals.find((professional) => professional.id === id)?.name ?? 'Profesional' : 'Todo el consultorio';

	$effect(() => {
		if (pendingProfessionalId === data.selectedProfessionalId) pendingProfessionalId = null;
	});

	const handleProfessionalChange = (event: Event) => {
		const professionalId = (event.currentTarget as HTMLSelectElement).value;
		pendingProfessionalId = professionalId;
		const search = new URLSearchParams();
		if (professionalId) search.set('professional_id', professionalId);
		goto(`/odonto/disponibilidad${search.toString() ? `?${search.toString()}` : ''}`, {
			keepFocus: true,
			noScroll: true
		});
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
		<label>
			<span class="ux-label">Profesional</span>
			<select onchange={handleProfessionalChange} class="ux-select">
				{#each data.professionals as professional}
					<option value={professional.id} selected={professional.id === selectedProfessionalId}>
						{professional.name}{professional.is_active ? '' : ' · inactivo'}
					</option>
				{/each}
			</select>
		</label>
	</div>

	<div class="grid gap-5 lg:grid-cols-2">
		<form method="POST" action="?/create_rule" class="ux-card">
			<h2 class="ux-section-title">Horario semanal</h2>
			<input type="hidden" name="professional_id" value={selectedProfessionalId} />
			<div class="mt-5 grid gap-4 sm:grid-cols-2">
				<label class="sm:col-span-2">
					<span class="ux-label">Profesional</span>
					<input value={selectedProfessional?.name ?? 'Sin profesional'} disabled class="ux-input" />
				</label>
				<label>
					<span class="ux-label">Día</span>
					<select name="weekday" disabled={!canOperate || !selectedProfessionalId || isChangingProfessional} class="ux-select">
						{#each weekdays as day, index}
							<option value={index}>{day}</option>
						{/each}
					</select>
				</label>
				<label>
					<span class="ux-label">Frecuencia opcional</span>
					<input name="slot_interval_minutes" type="number" min="5" value="15" disabled={!canOperate || isChangingProfessional} class="ux-input" />
				</label>
				<label>
					<span class="ux-label">Inicio</span>
					<input name="start_time" type="time" required disabled={!canOperate || isChangingProfessional} class="ux-input" />
				</label>
				<label>
					<span class="ux-label">Fin</span>
					<input name="end_time" type="time" required disabled={!canOperate || isChangingProfessional} class="ux-input" />
				</label>
			</div>
			<button type="submit" disabled={!canOperate || !selectedProfessionalId || isChangingProfessional} class="ux-btn-primary mt-5 w-full">
				Agregar horario
			</button>
		</form>

		<form method="POST" action="?/create_exception" class="ux-card">
			<h2 class="ux-section-title">Excepción</h2>
			<div class="mt-5 grid gap-4 sm:grid-cols-2">
				<label class="sm:col-span-2">
					<span class="ux-label">Afecta a</span>
					<select name="professional_id" disabled={!canOperate} class="ux-select">
						<option value="">Todo el consultorio</option>
						{#each data.professionals as professional}
							<option value={professional.id} selected={professional.id === selectedProfessionalId}>{professional.name}</option>
						{/each}
					</select>
				</label>
				<label>
					<span class="ux-label">Tipo</span>
					<select name="type" disabled={!canOperate} class="ux-select">
						<option value="blocked">Bloqueo</option>
						<option value="extra_available">Horario extra</option>
					</select>
				</label>
				<label>
					<span class="ux-label">Fecha</span>
					<input name="date" type="date" required disabled={!canOperate} class="ux-input" />
				</label>
				<label>
					<span class="ux-label">Inicio</span>
					<input name="start_time" type="time" required disabled={!canOperate} class="ux-input" />
				</label>
				<label>
					<span class="ux-label">Fin</span>
					<input name="end_time" type="time" required disabled={!canOperate} class="ux-input" />
				</label>
				<label class="sm:col-span-2">
					<span class="ux-label">Motivo opcional</span>
					<input name="reason" disabled={!canOperate} class="ux-input" />
				</label>
			</div>
			<button type="submit" disabled={!canOperate} class="ux-btn-secondary mt-5 w-full">
				Agregar excepción
			</button>
		</form>
	</div>

	<div class="grid gap-5 lg:grid-cols-2">
		<div class="ux-card">
			<h2 class="ux-section-title">Horarios de {selectedProfessional?.name ?? 'profesional'}</h2>
			<div class="mt-5 grid gap-3">
				{#if isChangingProfessional}
					<p class="ux-empty">Cargando horarios...</p>
				{:else}
					{#each data.rules as rule}
						<form method="POST" action="?/delete_rule" class="ux-soft-card flex items-center justify-between gap-3 p-4">
							<input type="hidden" name="rule_id" value={rule.id} />
							<input type="hidden" name="professional_id" value={selectedProfessionalId} />
							<span class="text-sm text-white">
								<span class="font-bold">{weekdays[rule.weekday]}</span>
								{rule.start_time.slice(0, 5)} - {rule.end_time.slice(0, 5)}
							</span>
							<button type="submit" disabled={!canOperate} class="text-sm font-bold text-red-200 disabled:opacity-50">Eliminar</button>
						</form>
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
