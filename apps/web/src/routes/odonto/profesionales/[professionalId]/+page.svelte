<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import { formatDateTime } from '$lib/utils/format';
	import { formatPriceLabel } from '$lib/utils/money-input';
	import { normalizeTimeRangesInput, parseTimeRanges } from '$lib/utils/time-ranges';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { persistDraft, clearDraft } from '$lib/actions/persist-draft';

	const weekdays = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
	const tabs = [
		{ id: 'perfil', label: 'Perfil' },
		{ id: 'servicios', label: 'Servicios' },
		{ id: 'horarios', label: 'Horarios' }
	] as const;

	type TabId = (typeof tabs)[number]['id'];
	type Service = {
		id: string;
		name: string;
		duration_minutes: number;
		price_label: string | null;
		is_active: boolean;
		is_public: boolean;
	};
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
			context: { canOperate: boolean; canManage: boolean };
			professional: {
				id: string;
				name: string;
				specialty: string | null;
				phone: string | null;
				email: string | null;
				is_active: boolean;
				is_public: boolean;
			} | null;
			services: Service[];
			assignedServiceIds: string[];
			rules: Rule[];
			exceptions: Exception[];
			tab: string;
			demo: boolean;
		};
		form?: { success?: boolean; message?: string };
	}>();

	const canOperate = $derived(data.context.canOperate && !data.demo);
	const canManage = $derived(data.context.canManage && !data.demo);
	const professional = $derived(data.professional);

	// Borrador del Perfil: se conserva al cambiar de pestaña o navegar, y se limpia al guardar bien.
	const profileDraftKey = $derived(`prof-perfil:${data.professional?.id ?? ''}`);
	const profileEnhance: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'redirect' || result.type === 'success') clearDraft(profileDraftKey);
			await update();
		};
	};
	let activeTab = $state<TabId>('perfil');
	let selectedServiceIds = $state<string[]>([]);
	let selectedWeekdays = $state<number[]>([1, 2, 3, 4, 5]);
	let showNewService = $state(false);
	let weeklyTimeRanges = $state('');
	let exceptionDate = $state('');
	let exceptionTimeRange = $state('');

	$effect(() => {
		activeTab = tabs.some((tab) => tab.id === data.tab) ? (data.tab as TabId) : 'perfil';
		selectedServiceIds = [...data.assignedServiceIds];
		if (data.services.length === 0) showNewService = true;
	});

	const toggleService = (serviceId: string) => {
		selectedServiceIds = selectedServiceIds.includes(serviceId)
			? selectedServiceIds.filter((id) => id !== serviceId)
			: [...selectedServiceIds, serviceId];
	};

	const toggleWeekday = (weekday: number) => {
		selectedWeekdays = selectedWeekdays.includes(weekday)
			? selectedWeekdays.filter((item) => item !== weekday)
			: [...selectedWeekdays, weekday].sort((a, b) => a - b);
	};

	const setWeekdays = (items: number[]) => {
		selectedWeekdays = items;
	};

	const rulesByWeekday = $derived.by(() =>
		weekdays.map((day, weekday) => ({
			day,
			weekday,
			rules: (data.rules as Rule[]).filter((rule) => rule.weekday === weekday)
		}))
	);

	const exceptionTarget = (item: Exception) =>
		item.professional_id ? professional?.name ?? 'Profesional' : 'Todo el consultorio';

	const durationLabel = (minutes: number) => `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
	const handlePriceInput = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		input.value = formatPriceLabel(input.value);
	};

	const normalizeScheduleInput = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		input.value = normalizeTimeRangesInput(input.value);
		weeklyTimeRanges = input.value;
	};

	const handleScheduleTyping = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		const digits = input.value.replace(/\D/g, '');
		if (/^[\d\s]+$/.test(input.value) && digits.length >= 8 && digits.length % 8 === 0) {
			input.value = normalizeTimeRangesInput(input.value);
			weeklyTimeRanges = input.value;
		}
	};

	const normalizeScheduleBeforeSubmit = (event: SubmitEvent) => {
		const form = event.currentTarget as HTMLFormElement;
		const input = form.elements.namedItem('time_ranges') as HTMLInputElement | null;
		if (input) input.value = normalizeTimeRangesInput(input.value);
	};

	const weeklyPreview = $derived(parseTimeRanges(weeklyTimeRanges) ?? []);
	const normalizeExceptionDate = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		const value = input.value.trim();
		const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
		if (match) {
			exceptionDate = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
			return;
		}
		exceptionDate = value;
	};
	const normalizeExceptionTime = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		exceptionTimeRange = normalizeTimeRangesInput(input.value);
	};
</script>

<section class="ux-page">
	<div class="ux-hero">
		<BackLink href="/odonto/profesionales" label="Volver" class="mb-5" />
		<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<p class="ux-badge">Profesional</p>
				<h1 class="ux-title mt-4">{professional?.name ?? 'Profesional'}</h1>
				<p class="ux-subtitle">{professional?.specialty ?? 'Definí qué atiende y cuándo.'}</p>
			</div>
			<span class={professional?.is_active && professional?.is_public ? 'ux-badge ux-badge-success' : 'ux-badge'}>
				{professional?.is_active && professional?.is_public ? 'Disponible' : 'No disponible'}
			</span>
		</div>
	</div>

	{#if form?.message}
		<p class={form.success ? 'ux-alert ux-alert-success' : 'ux-alert'}>{form.message}</p>
	{/if}

	<div class="ux-card p-2">
		<div class="grid gap-2 sm:grid-cols-3">
			{#each tabs as tab}
				<button
					type="button"
					class={`rounded-2xl px-4 py-3 text-sm font-black transition ${
						activeTab === tab.id
							? 'bg-[#7c3aed] text-white shadow-lg shadow-[#7c3aed]/20'
							: 'bg-white/[0.03] text-white/62 hover:bg-white/[0.07] hover:text-white'
					}`}
					onclick={() => (activeTab = tab.id)}
				>
					{tab.label}
				</button>
			{/each}
		</div>
	</div>

	{#if activeTab === 'perfil'}
		<form method="POST" action="?/update_profile" class="ux-card" use:enhance={profileEnhance} use:persistDraft={profileDraftKey}>
			<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h2 class="ux-section-title">Perfil</h2>
					<p class="mt-1 text-sm text-white/55">Datos básicos del profesional.</p>
				</div>
				<button type="submit" disabled={!canOperate} class="ux-btn-primary">Guardar</button>
			</div>
			<div class="mt-5 grid gap-4 md:grid-cols-2">
				<label>
					<span class="ux-label">Nombre</span>
					<input name="name" value={professional?.name ?? ''} required disabled={!canOperate} class="ux-input" />
				</label>
				<label>
					<span class="ux-label">Especialidad (opcional)</span>
					<input name="specialty" value={professional?.specialty ?? ''} disabled={!canOperate} class="ux-input" />
				</label>
				<label>
					<span class="ux-label">Teléfono (opcional)</span>
					<input name="phone" value={professional?.phone ?? ''} disabled={!canOperate} class="ux-input" />
				</label>
				<label>
					<span class="ux-label">Correo electrónico (opcional)</span>
					<input name="email" value={professional?.email ?? ''} type="email" disabled={!canOperate} class="ux-input" />
				</label>
			</div>
			<label class="mt-5 inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white">
				<input
					type="checkbox"
					name="is_available"
					value="true"
					checked={professional?.is_active && professional?.is_public}
					disabled={!canOperate}
					class="accent-[#7c3aed]"
				/>
				Disponible para turnos
			</label>
		</form>

		{#if canManage}
			<div class="ux-card border-red-400/20">
				<h2 class="ux-section-title">Administración</h2>
				<p class="mt-1 text-sm text-white/55">Acciones reservadas al dueño del consultorio.</p>

				<div class="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<p class="font-black text-white">{professional?.is_active ? 'Archivar profesional' : 'Restaurar profesional'}</p>
						<p class="mt-1 text-sm text-white/55">
							{professional?.is_active
								? 'Lo oculta de la agenda y de las reservas. Podés restaurarlo cuando quieras.'
								: 'Vuelve a aparecer como disponible para asignar turnos.'}
						</p>
					</div>
					{#if professional?.is_active}
						<form method="POST" action="?/archive_professional" use:enhance class="shrink-0">
							<button type="submit" class="ux-btn-secondary">Archivar</button>
						</form>
					{:else}
						<form method="POST" action="?/restore_professional" use:enhance class="shrink-0">
							<button type="submit" class="ux-btn-primary">Restaurar</button>
						</form>
					{/if}
				</div>

				<div class="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<p class="font-black text-red-100">Eliminar definitivamente</p>
						<p class="mt-1 text-sm text-white/55">Solo si no tiene turnos cargados. Si los tiene, archivalo para conservar el historial.</p>
					</div>
					<form
						method="POST"
						action="?/delete_professional"
						class="shrink-0"
						onsubmit={(event) => {
							if (!confirm('¿Eliminar este profesional de forma permanente? Esta acción no se puede deshacer.')) event.preventDefault();
						}}
					>
						<button type="submit" class="ux-btn-danger">Eliminar</button>
					</form>
				</div>
			</div>
		{/if}
	{/if}

	{#if activeTab === 'servicios'}
		<div class="grid gap-5 xl:grid-cols-[1fr_0.75fr]">
			<form method="POST" action="?/save_services" class="ux-card">
				<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<h2 class="ux-section-title">Servicios que ofrece</h2>
						<p class="mt-1 text-sm text-white/55">Estos servicios estarán disponibles para reservar con este profesional.</p>
					</div>
					<button type="submit" disabled={!canOperate} class="ux-btn-primary">Guardar servicios</button>
				</div>

				<div class="mt-5 grid gap-3">
					{#each data.services as service}
						<label class={`ux-choice flex items-center gap-4 p-4 ${selectedServiceIds.includes(service.id) ? 'ux-choice-active' : ''}`}>
							<input
								type="checkbox"
								name="service_id"
								value={service.id}
								checked={selectedServiceIds.includes(service.id)}
								disabled={!canOperate}
								class="accent-[#7c3aed]"
								onchange={() => toggleService(service.id)}
							/>
							<span class="min-w-0 flex-1">
								<span class="block font-black text-white">{service.name}</span>
								<span class="mt-1 block text-sm text-white/55">
									{durationLabel(service.duration_minutes)}{service.price_label ? ` · ${service.price_label}` : ''}
								</span>
							</span>
						</label>
					{/each}
					{#if data.services.length === 0}
						<p class="ux-empty">Todavía no hay servicios cargados.</p>
					{/if}
				</div>
			</form>

			<div class="ux-card">
				<div class="flex items-start justify-between gap-4">
					<div>
						<h2 class="ux-section-title">Agregar servicio</h2>
						<p class="mt-1 text-sm text-white/55">Crealo una vez y queda asignado a {professional?.name ?? 'este profesional'}.</p>
					</div>
					<button type="button" class="ux-btn-secondary" onclick={() => (showNewService = !showNewService)}>
						{showNewService ? 'Cerrar' : 'Crear'}
					</button>
				</div>
				{#if showNewService}
					<form method="POST" action="?/create_service" class="mt-5 grid gap-4">
						<label>
							<span class="ux-label">Nombre</span>
							<input name="name" required disabled={!canOperate} class="ux-input" />
						</label>
						<label>
							<span class="ux-label">Duración</span>
							<input name="duration_minutes" type="number" min="5" max="480" step="5" value="30" disabled={!canOperate} class="ux-input" />
						</label>
						<label>
							<span class="ux-label">Precio visible (opcional)</span>
							<input name="price_label" type="text" inputmode="numeric" disabled={!canOperate} placeholder="$ 35.000" class="ux-input" oninput={handlePriceInput} />
						</label>
						<button class="ux-btn-primary" disabled={!canOperate}>Crear y asignar</button>
					</form>
				{/if}
			</div>
		</div>
	{/if}

	{#if activeTab === 'horarios'}
		<div class="grid gap-5 xl:grid-cols-[1fr_0.78fr]">
			<form method="POST" action="?/save_weekly_rules" class="ux-card" onsubmit={normalizeScheduleBeforeSubmit}>
				<div>
					<h2 class="ux-section-title">Horarios de atención</h2>
					<p class="mt-2 text-sm text-white/55">Marcá los días y escribí los bloques horarios.</p>
				</div>
				{#each selectedWeekdays as weekday}
					<input type="hidden" name="weekdays" value={weekday} />
				{/each}

				<div class="mt-6">
					<span class="ux-label">Días</span>
					<div class="mt-3 grid grid-cols-[repeat(auto-fit,minmax(112px,1fr))] gap-2">
						{#each weekdays as day, index}
							<button
								type="button"
								disabled={!canOperate}
								class={`min-h-14 min-w-0 rounded-2xl border px-3 py-3 text-center text-sm font-black leading-tight whitespace-normal transition disabled:cursor-not-allowed disabled:opacity-50 ${
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
							placeholder="9 a 13, 15 a 19"
							bind:value={weeklyTimeRanges}
							disabled={!canOperate}
							class="ux-input text-lg font-bold"
							oninput={handleScheduleTyping}
							onblur={normalizeScheduleInput}
						/>
						{#if weeklyPreview.length > 0}
							<div class="mt-3 flex flex-wrap gap-2">
								{#each weeklyPreview as range}
									<span class="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-100">
										{range.start} - {range.end}
									</span>
								{/each}
							</div>
						{/if}
					</label>
					<label>
						<span class="ux-label">Intervalo</span>
						<input name="slot_interval_minutes" type="number" inputmode="numeric" min="5" max="120" step="5" value="15" disabled={!canOperate} class="ux-input text-lg font-bold" />
					</label>
				</div>
				<button type="submit" disabled={!canOperate || selectedWeekdays.length === 0} class="ux-btn-primary mt-6 w-full">
					Guardar horarios
				</button>
			</form>

			<form method="POST" action="?/create_exception" class="ux-card">
				<h2 class="ux-section-title">Cambio puntual</h2>
				<p class="mt-2 text-sm text-white/55">Bloqueos, feriados u horarios extra.</p>
				<div class="mt-5 grid gap-4">
					<div>
						<span class="ux-label">Afecta a</span>
						<div class="mt-3 grid gap-2 sm:grid-cols-2">
							<label class="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-white/80">
								<input type="radio" name="applies_to" value="professional" checked class="mr-2 accent-[#7c3aed]" />
								{professional?.name ?? 'Profesional'}
							</label>
							<label class="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-white/80">
								<input type="radio" name="applies_to" value="business" class="mr-2 accent-[#7c3aed]" />
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
						<input name="date" type="text" inputmode="numeric" placeholder="24/05/2026" bind:value={exceptionDate} onblur={normalizeExceptionDate} required disabled={!canOperate} class="ux-input" />
					</label>
					<label>
						<span class="ux-label">Horario</span>
						<input name="time_range" type="text" placeholder="10 a 12" bind:value={exceptionTimeRange} onblur={normalizeExceptionTime} required disabled={!canOperate} class="ux-input" />
					</label>
					<label>
						<span class="ux-label">Motivo (opcional)</span>
						<input name="reason" placeholder="Vacaciones, feriado, trámite..." disabled={!canOperate} class="ux-input" />
					</label>
				</div>
				<button type="submit" disabled={!canOperate} class="ux-btn-secondary mt-5 w-full">
					Guardar cambio
				</button>
			</form>
		</div>

		<div class="grid gap-5 xl:grid-cols-[1fr_0.78fr]">
			<div class="ux-card">
				<div class="flex items-center justify-between gap-4">
					<h2 class="ux-section-title">Semana habitual</h2>
					<span class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/55">
						{data.rules.length} bloques
					</span>
				</div>
				<div class="mt-5 grid gap-3">
					{#each rulesByWeekday as day}
						<div class="ux-soft-card p-4">
							<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
								<p class="min-w-28 text-sm font-black text-white">{day.day}</p>
								<div class="flex flex-1 flex-wrap gap-2">
									{#if day.rules.length > 0}
										{#each day.rules as rule}
											<form method="POST" action="?/delete_rule" class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2" onsubmit={(event) => {
												if (!confirm('¿Quitar este horario?')) event.preventDefault();
											}}>
												<input type="hidden" name="rule_id" value={rule.id} />
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
				</div>
			</div>

			<div class="ux-card">
				<h2 class="ux-section-title">Cambios puntuales</h2>
				<div class="mt-5 grid gap-3">
					{#each data.exceptions as item}
						<form method="POST" action="?/delete_exception" class="ux-soft-card p-4" onsubmit={(event) => {
							if (!confirm('¿Eliminar este cambio puntual?')) event.preventDefault();
						}}>
							<input type="hidden" name="exception_id" value={item.id} />
							<div class="flex items-start justify-between gap-3">
								<div class="text-sm">
									<p class="font-bold text-white">{item.type === 'blocked' ? 'Bloqueo' : 'Horario extra'} · {exceptionTarget(item)}</p>
									<p class="mt-1 text-white/55">{formatDateTime(item.starts_at)} - {formatDateTime(item.ends_at)}</p>
									{#if item.reason}<p class="mt-1 text-xs text-white/42">{item.reason}</p>{/if}
								</div>
								<button type="submit" disabled={!canOperate} class="text-sm font-bold text-red-200 disabled:opacity-50">Eliminar</button>
							</div>
						</form>
					{/each}
					{#if data.exceptions.length === 0}
						<p class="ux-empty">Sin cambios puntuales cargados.</p>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</section>
