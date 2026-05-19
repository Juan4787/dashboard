<script lang="ts">
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

<section class="flex flex-col gap-6">
	<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<a href="/odonto/profesionales" class="text-xs font-semibold uppercase tracking-wide text-[#7c3aed] hover:underline">
			Volver a profesionales
		</a>
		<h1 class="mt-2 text-2xl font-semibold text-neutral-900 dark:text-white">
			{data.professional?.name ?? 'Profesional'}
		</h1>
		<p class="mt-2 text-sm text-neutral-600 dark:text-neutral-200">
			Asigná los servicios que este profesional puede atender.
		</p>
	</div>

	{#if form?.message}
		<p class={`rounded-xl px-4 py-3 text-sm font-semibold ${form.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
			{form.message}
		</p>
	{/if}

	<form method="POST" action="?/save_services" class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<div class="flex flex-col gap-1">
			<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Servicios ofrecidos</h2>
			<p class="text-sm text-neutral-600 dark:text-neutral-200">
				Un servicio solo genera disponibilidad pública si está asignado al profesional.
			</p>
		</div>

		<div class="mt-4 grid gap-3 md:grid-cols-2">
			{#each data.services as service}
				<label class="flex items-start gap-3 rounded-xl border border-neutral-200 px-4 py-3 dark:border-[#1f3554]">
					<input
						type="checkbox"
						name="service_id"
						value={service.id}
						checked={data.assignedServiceIds.includes(service.id)}
						disabled={!canOperate}
						class="mt-1 accent-[#7c3aed]"
					/>
					<span>
						<span class="block text-sm font-semibold text-neutral-900 dark:text-white">{service.name}</span>
						<span class="block text-xs text-neutral-500 dark:text-neutral-300">
							{service.duration_minutes} min · {service.is_active ? 'Activo' : 'Inactivo'} · {service.is_public ? 'Público' : 'Privado'}
						</span>
					</span>
				</label>
			{/each}
		</div>
		{#if data.services.length === 0}
			<p class="mt-4 rounded-xl border border-dashed border-neutral-300 px-4 py-3 text-sm text-neutral-600 dark:border-[#1f3554] dark:text-neutral-200">
				Primero cargá servicios en la sección Servicios.
			</p>
		{/if}

		<div class="mt-5 flex justify-end">
			<button type="submit" disabled={!canOperate} class="rounded-xl bg-[#7c3aed] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">
				Guardar servicios
			</button>
		</div>
	</form>
</section>
