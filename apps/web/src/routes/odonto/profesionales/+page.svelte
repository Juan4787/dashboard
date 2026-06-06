<script lang="ts">
	type Professional = {
		id: string;
		name: string;
		specialty: string | null;
		phone: string | null;
		email: string | null;
		is_public: boolean;
		is_active: boolean;
	};

	let { data, form } = $props<{
		data: {
			context: { canOperate: boolean };
			professionals: Professional[];
			demo: boolean;
		};
		form?: { success?: boolean; message?: string; values?: Record<string, unknown> };
	}>();

	const canOperate = $derived(data.context.canOperate && !data.demo);
	const activeCount = $derived(data.professionals.filter((item: Professional) => item.is_active && item.is_public).length);
	let showCreate = $state(false);

	$effect(() => {
		if (data.professionals.length === 0 || form?.values) showCreate = true;
	});
</script>

<section class="ux-page">
	<div class="ux-hero">
		<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<h1 class="ux-title">Profesionales</h1>
				<p class="ux-subtitle">Definí qué atiende cada profesional y cuándo.</p>
			</div>
			<button type="button" class="ux-btn-primary" disabled={!canOperate} onclick={() => (showCreate = !showCreate)}>
				{showCreate ? 'Cerrar' : 'Nuevo profesional'}
			</button>
		</div>
	</div>

	{#if form?.message}
		<p class={form.success ? 'ux-alert ux-alert-success' : 'ux-alert'}>{form.message}</p>
	{/if}

	{#if showCreate}
		<form method="POST" action="?/create_professional" class="ux-card">
			<div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h2 class="ux-section-title">Nuevo profesional</h2>
					<p class="mt-1 text-sm text-white/55">Después cargás sus servicios y horarios.</p>
				</div>
				<button type="submit" disabled={!canOperate} class="ux-btn-primary">Crear profesional</button>
			</div>
			<div class="mt-5 grid gap-4 md:grid-cols-2">
				<label>
					<span class="ux-label">Nombre</span>
					<input name="name" required disabled={!canOperate} value={String(form?.values?.name ?? '')} class="ux-input" />
				</label>
				<label>
					<span class="ux-label">Especialidad (opcional)</span>
					<input name="specialty" disabled={!canOperate} value={String(form?.values?.specialty ?? '')} class="ux-input" />
				</label>
				<label>
					<span class="ux-label">Teléfono (opcional)</span>
					<input name="phone" disabled={!canOperate} value={String(form?.values?.phone ?? '')} class="ux-input" />
				</label>
				<label>
					<span class="ux-label">Correo electrónico (opcional)</span>
					<input name="email" type="email" disabled={!canOperate} value={String(form?.values?.email ?? '')} class="ux-input" />
				</label>
			</div>
			<label class="mt-5 inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white">
				<input type="checkbox" name="is_available" value="true" checked disabled={!canOperate} class="accent-[#7c3aed]" />
				Disponible para turnos
			</label>
		</form>
	{/if}

	<div class="ux-card">
		<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<h2 class="ux-section-title">Equipo</h2>
				<p class="mt-1 text-sm text-white/55">
					{activeCount} {activeCount === 1 ? 'profesional disponible' : 'profesionales disponibles'} para reservar.
				</p>
			</div>
		</div>

		<div class="mt-5 grid gap-3">
			{#each data.professionals as professional}
				<a href={`/odonto/profesionales/${professional.id}`} class={`ux-choice p-5 ${professional.is_active ? '' : 'opacity-65'}`}>
					<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<h3 class="truncate text-xl font-black text-white">{professional.name}</h3>
								<span class={professional.is_active && professional.is_public ? 'ux-badge ux-badge-success' : 'ux-badge'}>
									{professional.is_active && professional.is_public ? 'Disponible' : 'No disponible'}
								</span>
							</div>
							<p class="mt-1 text-sm text-white/55">{professional.specialty ?? 'Sin especialidad cargada'}</p>
						</div>
						<span class="ux-btn-secondary shrink-0">Configurar</span>
					</div>
				</a>
			{/each}
			{#if data.professionals.length === 0}
				<div class="ux-empty">
					Todavía no cargaste profesionales. Primero agregá quién atiende los turnos.
				</div>
			{/if}
		</div>
	</div>
</section>
