<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';

	type Service = {
		id: string;
		name: string;
		duration_minutes: number;
		is_active: boolean;
		is_public: boolean;
	};

	let { data, form } = $props<{
		data: {
			context: { canOperate: boolean };
			professional: { id: string; name: string; specialty: string | null } | null;
			services: Service[];
			assignedServiceIds: string[];
			demo: boolean;
		};
		form?: { success?: boolean; message?: string };
	}>();

	const canOperate = $derived(data.context.canOperate && !data.demo);
</script>

<section class="ux-page">
	<div class="ux-hero">
		<BackLink href="/odonto/profesionales" label="Volver" class="mb-5" />
		<p class="ux-badge">Servicios del profesional</p>
		<h1 class="ux-title mt-4">{data.professional?.name ?? 'Profesional'}</h1>
		<p class="ux-subtitle">{data.professional?.specialty ?? 'Elegí qué servicios atiende.'}</p>
	</div>

	{#if form?.message}
		<p class={form.success ? 'ux-alert ux-alert-success' : 'ux-alert'}>{form.message}</p>
	{/if}

	<form method="POST" action="?/save_services" class="ux-card">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h2 class="ux-section-title">Servicios que atiende</h2>
				<p class="mt-1 text-sm text-white/55">Estos cambios se reflejan también en Servicios.</p>
			</div>
			<button type="submit" disabled={!canOperate} class="ux-btn-primary">Guardar</button>
		</div>

		<div class="mt-6 grid gap-3 md:grid-cols-2">
			{#each data.services as service}
				<label class={`ux-choice p-4 ${data.assignedServiceIds.includes(service.id) ? 'ux-choice-active' : ''}`}>
					<input
						type="checkbox"
						name="service_id"
						value={service.id}
						checked={data.assignedServiceIds.includes(service.id)}
						disabled={!canOperate}
						class="sr-only"
					/>
					<span class="block text-lg font-bold text-white">{service.name}</span>
					<span class="mt-1 block text-sm text-white/55">{service.duration_minutes} minutos</span>
					<span class="mt-4 inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/75">
						{data.assignedServiceIds.includes(service.id) ? 'Asignado' : 'No asignado'}
					</span>
				</label>
			{/each}
		</div>
		{#if data.services.length === 0}
			<p class="ux-empty mt-5">Primero cargá servicios.</p>
		{/if}
	</form>
</section>
