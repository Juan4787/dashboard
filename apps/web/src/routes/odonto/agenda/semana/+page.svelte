<script lang="ts">
	import { formatDate } from '$lib/utils/format';

	type DaySummary = {
		date: string;
		total: number;
		stats: Array<{ status: string; count: number }>;
	};
	type Professional = { id: string; name: string; is_active: boolean };

	let { data } = $props<{
		data: {
			selectedDate: string;
			selectedProfessionalId: string;
			days: DaySummary[];
			professionals: Professional[];
		};
	}>();

	const statusLabels: Record<string, string> = {
		reserved: 'Reservados',
		confirmed: 'Confirmados',
		cancelled: 'Cancelados',
		reschedule_requested: 'Reprogramar',
		attended: 'Asistieron',
		no_show: 'No asistieron'
	};

	const statusText = (day: DaySummary) =>
		day.stats
			.filter((stat) => stat.count > 0)
			.map((stat) => `${statusLabels[stat.status] ?? stat.status}: ${stat.count}`)
			.join(' · ');
</script>

<section class="flex flex-col gap-6">
	<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
			<div>
				<a href={`/odonto/agenda?date=${data.selectedDate}${data.selectedProfessionalId ? `&professional_id=${data.selectedProfessionalId}` : ''}`} class="text-xs font-semibold uppercase tracking-wide text-[#7c3aed] hover:underline">
					Volver al día
				</a>
				<h1 class="mt-2 text-2xl font-semibold text-neutral-900 dark:text-white">Agenda semanal</h1>
				<p class="mt-2 max-w-3xl text-sm text-neutral-600 dark:text-neutral-200">
					Resumen de carga por día. Usalo para detectar días llenos, días flojos y distribución por profesional.
				</p>
			</div>
		</div>
	</div>

	<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<form method="GET" class="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
			<label class="space-y-1">
				<span class="text-sm font-semibold">Semana de referencia</span>
				<input type="date" name="date" value={data.selectedDate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
			<label class="space-y-1">
				<span class="text-sm font-semibold">Profesional</span>
				<select name="professional_id" class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<option value="">Todos</option>
					{#each data.professionals as professional}
						<option value={professional.id} selected={professional.id === data.selectedProfessionalId}>{professional.name}</option>
					{/each}
				</select>
			</label>
			<button class="self-end rounded-xl border border-neutral-200 px-5 py-3 text-sm font-semibold transition hover:bg-neutral-50 dark:border-[#1f3554] dark:hover:bg-[#0f1f36]">
				Ver semana
			</button>
		</form>
	</div>

	<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
		{#each data.days as day}
			<a href={`/odonto/agenda?date=${day.date}${data.selectedProfessionalId ? `&professional_id=${data.selectedProfessionalId}` : ''}`} class="rounded-2xl border border-neutral-100 bg-white/90 p-4 shadow-card transition hover:border-[#7c3aed] hover:bg-neutral-50 dark:border-[#1f3554] dark:bg-[#152642] dark:hover:bg-[#0f1f36]">
				<p class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">{formatDate(`${day.date}T00:00:00`)}</p>
				<p class="mt-3 text-3xl font-semibold text-neutral-900 dark:text-white">{day.total}</p>
				<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-200">turnos</p>
				{#if statusText(day)}
					<p class="mt-4 text-xs leading-5 text-neutral-500 dark:text-neutral-300">{statusText(day)}</p>
				{:else}
					<p class="mt-4 text-xs leading-5 text-neutral-500 dark:text-neutral-300">Sin carga registrada.</p>
				{/if}
			</a>
		{/each}
	</div>

	{#if data.days.length === 0}
		<div class="rounded-2xl border border-dashed border-neutral-300 bg-white/70 p-6 text-sm text-neutral-600 dark:border-[#1f3554] dark:bg-[#152642] dark:text-neutral-200">
			No hay datos semanales para mostrar.
		</div>
	{/if}
</section>
