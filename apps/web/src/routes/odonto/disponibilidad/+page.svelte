<script lang="ts">
	import { formatDateTime } from '$lib/utils/format';

	const weekdays = [
		'Domingo',
		'Lunes',
		'Martes',
		'Miércoles',
		'Jueves',
		'Viernes',
		'Sábado'
	];

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
	const selectedProfessional = $derived(
		professionals.find((professional) => professional.id === data.selectedProfessionalId)
	);
	const professionalName = (id: string | null) =>
		id ? professionals.find((professional) => professional.id === id)?.name ?? 'Profesional' : 'Todo el negocio';
</script>

<section class="flex flex-col gap-6">
	<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<h1 class="text-2xl font-semibold text-neutral-900 dark:text-white">Disponibilidad</h1>
		<p class="mt-2 max-w-3xl text-sm text-neutral-600 dark:text-neutral-200">
			Cargá horarios semanales y excepciones. El motor de slots usa estas reglas como fuente de verdad.
		</p>
	</div>

	{#if form?.message}
		<p class="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{form.message}</p>
	{/if}

	<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<form method="GET" class="flex flex-col gap-3 sm:flex-row sm:items-end">
			<label class="flex-1 space-y-1">
				<span class="text-sm font-semibold">Profesional</span>
				<select name="professional_id" class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm dark:border-[#1f3554] dark:bg-[#0f1f36]">
					{#each data.professionals as professional}
						<option value={professional.id} selected={professional.id === data.selectedProfessionalId}>
							{professional.name}{professional.is_active ? '' : ' · inactivo'}
						</option>
					{/each}
				</select>
			</label>
			<button class="rounded-xl border border-neutral-200 px-5 py-3 text-sm font-semibold dark:border-[#1f3554]">
				Ver horarios
			</button>
		</form>
	</div>

	<div class="grid gap-6 lg:grid-cols-[1fr_1fr]">
		<form method="POST" action="?/create_rule" class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
			<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Horario semanal</h2>
			<input type="hidden" name="professional_id" value={data.selectedProfessionalId} />
			<div class="mt-4 grid gap-4 sm:grid-cols-2">
				<label class="space-y-1 sm:col-span-2">
					<span class="text-sm font-semibold">Profesional</span>
					<input value={selectedProfessional?.name ?? 'Sin profesional'} disabled class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm opacity-70 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
				</label>
				<label class="space-y-1">
					<span class="text-sm font-semibold">Día</span>
					<select name="weekday" disabled={!canOperate || !data.selectedProfessionalId} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]">
						{#each weekdays as day, index}
							<option value={index}>{day}</option>
						{/each}
					</select>
				</label>
				<label class="space-y-1">
					<span class="text-sm font-semibold">Intervalo</span>
					<input name="slot_interval_minutes" type="number" min="5" value="15" disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
				</label>
				<label class="space-y-1">
					<span class="text-sm font-semibold">Inicio</span>
					<input name="start_time" type="time" required disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
				</label>
				<label class="space-y-1">
					<span class="text-sm font-semibold">Fin</span>
					<input name="end_time" type="time" required disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
				</label>
			</div>
			<div class="mt-5 flex justify-end">
				<button type="submit" disabled={!canOperate || !data.selectedProfessionalId} class="rounded-xl bg-[#7c3aed] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">
					Agregar horario
				</button>
			</div>
		</form>

		<form method="POST" action="?/create_exception" class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
			<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Excepción</h2>
			<div class="mt-4 grid gap-4 sm:grid-cols-2">
				<label class="space-y-1 sm:col-span-2">
					<span class="text-sm font-semibold">Afecta a</span>
					<select name="professional_id" disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]">
						<option value="">Todo el negocio</option>
						{#each data.professionals as professional}
							<option value={professional.id} selected={professional.id === data.selectedProfessionalId}>{professional.name}</option>
						{/each}
					</select>
				</label>
				<label class="space-y-1">
					<span class="text-sm font-semibold">Tipo</span>
					<select name="type" disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]">
						<option value="blocked">Bloqueo</option>
						<option value="extra_available">Horario extra</option>
					</select>
				</label>
				<label class="space-y-1">
					<span class="text-sm font-semibold">Fecha</span>
					<input name="date" type="date" required disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
				</label>
				<label class="space-y-1">
					<span class="text-sm font-semibold">Inicio</span>
					<input name="start_time" type="time" required disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
				</label>
				<label class="space-y-1">
					<span class="text-sm font-semibold">Fin</span>
					<input name="end_time" type="time" required disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
				</label>
				<label class="space-y-1 sm:col-span-2">
					<span class="text-sm font-semibold">Motivo</span>
					<input name="reason" disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
				</label>
			</div>
			<div class="mt-5 flex justify-end">
				<button type="submit" disabled={!canOperate} class="rounded-xl bg-neutral-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900">
					Agregar excepción
				</button>
			</div>
		</form>
	</div>

	<div class="grid gap-6 lg:grid-cols-2">
		<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
			<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Horarios de {selectedProfessional?.name ?? 'profesional'}</h2>
			<div class="mt-4 grid gap-3">
				{#each data.rules as rule}
					<form method="POST" action="?/delete_rule" class="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 px-4 py-3 dark:border-[#1f3554]">
						<input type="hidden" name="rule_id" value={rule.id} />
						<input type="hidden" name="professional_id" value={data.selectedProfessionalId} />
						<span class="text-sm">
							<span class="font-semibold">{weekdays[rule.weekday]}</span>
							{rule.start_time.slice(0, 5)} - {rule.end_time.slice(0, 5)} · cada {rule.slot_interval_minutes} min
						</span>
						<button type="submit" disabled={!canOperate} class="text-sm font-semibold text-red-600 disabled:opacity-60">Eliminar</button>
					</form>
				{/each}
				{#if data.rules.length === 0}
					<p class="rounded-xl border border-dashed border-neutral-300 px-4 py-3 text-sm text-neutral-600 dark:border-[#1f3554] dark:text-neutral-200">
						No hay horarios semanales para este profesional.
					</p>
				{/if}
			</div>
		</div>

		<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
			<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Excepciones recientes</h2>
			<div class="mt-4 grid gap-3">
				{#each data.exceptions as item}
					<form method="POST" action="?/delete_exception" class="rounded-xl border border-neutral-200 px-4 py-3 dark:border-[#1f3554]">
						<input type="hidden" name="exception_id" value={item.id} />
						<input type="hidden" name="professional_id" value={item.professional_id ?? ''} />
						<div class="flex items-start justify-between gap-3">
							<div class="text-sm">
								<p class="font-semibold">{item.type === 'blocked' ? 'Bloqueo' : 'Horario extra'} · {professionalName(item.professional_id)}</p>
								<p class="text-neutral-600 dark:text-neutral-300">{formatDateTime(item.starts_at)} - {formatDateTime(item.ends_at)}</p>
								{#if item.reason}<p class="text-xs text-neutral-500 dark:text-neutral-300">{item.reason}</p>{/if}
							</div>
							<button type="submit" disabled={!canOperate} class="text-sm font-semibold text-red-600 disabled:opacity-60">Eliminar</button>
						</div>
					</form>
				{/each}
				{#if data.exceptions.length === 0}
					<p class="rounded-xl border border-dashed border-neutral-300 px-4 py-3 text-sm text-neutral-600 dark:border-[#1f3554] dark:text-neutral-200">
						Sin excepciones cargadas.
					</p>
				{/if}
			</div>
		</div>
	</div>
</section>
