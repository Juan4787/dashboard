<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
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
		reserved: 'Pendientes',
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

	const totalWeek = $derived(data.days.reduce((sum: number, day: DaySummary) => sum + day.total, 0));
</script>

<section class="ux-page">
	<div class="ux-hero">
		<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<BackLink href={`/odonto/agenda?date=${data.selectedDate}${data.selectedProfessionalId ? `&professional_id=${data.selectedProfessionalId}` : ''}`} label="Volver al día" class="mb-4" />
				<p class="ux-badge">Semana</p>
				<h1 class="ux-title mt-4">Agenda semanal</h1>
				<p class="ux-subtitle">Carga de turnos por día para anticipar demanda.</p>
			</div>
			<div class="ux-soft-card min-w-36 p-5 text-center">
				<p class="text-sm font-bold text-white/55">Turnos</p>
				<p class="mt-1 text-4xl font-bold text-white">{totalWeek}</p>
			</div>
		</div>
	</div>

	<div class="ux-card">
		<form method="GET" class="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
			<label>
				<span class="ux-label">Semana</span>
				<input type="date" name="date" value={data.selectedDate} class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Profesional</span>
				<select name="professional_id" class="ux-select">
					<option value="">Todos</option>
					{#each data.professionals as professional}
						<option value={professional.id} selected={professional.id === data.selectedProfessionalId}>{professional.name}</option>
					{/each}
				</select>
			</label>
			<button class="ux-btn-primary self-end">Ver semana</button>
		</form>
	</div>

	<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
		{#each data.days as day}
			<a href={`/odonto/agenda?date=${day.date}${data.selectedProfessionalId ? `&professional_id=${data.selectedProfessionalId}` : ''}`} class={`ux-choice p-5 ${day.total > 0 ? '' : 'opacity-70'}`}>
				<p class="text-sm font-bold capitalize text-white">{formatDate(`${day.date}T00:00:00`)}</p>
				<p class="mt-4 text-4xl font-bold text-white">{day.total}</p>
				<p class="mt-1 text-sm text-white/50">turnos</p>
				{#if statusText(day)}
					<p class="mt-5 text-xs leading-5 text-white/55">{statusText(day)}</p>
				{:else}
					<p class="mt-5 text-xs leading-5 text-white/42">Sin turnos.</p>
				{/if}
			</a>
		{/each}
	</div>

	{#if data.days.length === 0}
		<div class="ux-empty">No hay datos semanales para mostrar.</div>
	{/if}
</section>
