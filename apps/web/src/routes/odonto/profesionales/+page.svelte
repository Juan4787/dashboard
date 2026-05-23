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
</script>

<section class="ux-page">
	<div class="ux-hero">
		<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<p class="ux-badge">Equipo</p>
				<h1 class="ux-title mt-4">Profesionales</h1>
				<p class="ux-subtitle">Personas que atienden turnos y aparecen en la agenda.</p>
			</div>
			<div class="ux-soft-card min-w-36 p-5 text-center">
				<p class="text-sm font-bold text-white/55">Activos</p>
				<p class="mt-1 text-4xl font-bold text-white">{data.professionals.filter((item: Professional) => item.is_active).length}</p>
			</div>
		</div>
	</div>

	{#if form?.message}
		<p class={form.success ? 'ux-alert ux-alert-success' : 'ux-alert'}>{form.message}</p>
	{/if}

	<form method="POST" action="?/create_professional" class="ux-card">
		<div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h2 class="ux-section-title">Nuevo profesional</h2>
				<p class="mt-1 text-sm text-white/55">Después elegís qué servicios atiende.</p>
			</div>
			<button type="submit" disabled={!canOperate} class="ux-btn-primary">Crear profesional</button>
		</div>
		<div class="mt-5 grid gap-4 md:grid-cols-2">
			<label>
				<span class="ux-label">Nombre</span>
				<input name="name" required disabled={!canOperate} value={String(form?.values?.name ?? '')} class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Especialidad opcional</span>
				<input name="specialty" disabled={!canOperate} value={String(form?.values?.specialty ?? '')} class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Teléfono opcional</span>
				<input name="phone" disabled={!canOperate} class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Correo opcional</span>
				<input name="email" type="email" disabled={!canOperate} class="ux-input" />
			</label>
		</div>
		<label class="mt-5 inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white">
			<input type="checkbox" name="is_available" value="true" checked disabled={!canOperate} class="accent-[#7c3aed]" />
			Disponible para turnos
		</label>
	</form>

	<div class="grid gap-4 md:grid-cols-2">
		{#each data.professionals as professional}
			<article class={`ux-card ${professional.is_active ? '' : 'opacity-65'}`}>
				<form method="POST" action="?/update_professional">
					<input type="hidden" name="professional_id" value={professional.id} />
					<div class="flex items-start justify-between gap-4">
						<div>
							<span class={professional.is_active && professional.is_public ? 'ux-badge ux-badge-success' : 'ux-badge'}>{professional.is_active && professional.is_public ? 'Disponible' : 'No visible'}</span>
							<h2 class="mt-4 text-2xl font-bold text-white">{professional.name}</h2>
							<p class="mt-1 text-sm text-white/55">{professional.specialty ?? 'Sin especialidad'}</p>
						</div>
						<a href={`/odonto/profesionales/${professional.id}`} class="ux-btn-secondary">Servicios</a>
					</div>

					<div class="mt-5 grid gap-3">
						<label>
							<span class="ux-label">Nombre</span>
							<input name="name" value={professional.name} disabled={!canOperate} class="ux-input" />
						</label>
						<label>
							<span class="ux-label">Especialidad opcional</span>
							<input name="specialty" value={professional.specialty ?? ''} disabled={!canOperate} class="ux-input" />
						</label>
						<div class="grid gap-3 sm:grid-cols-2">
							<label>
								<span class="ux-label">Teléfono opcional</span>
								<input name="phone" value={professional.phone ?? ''} disabled={!canOperate} class="ux-input" />
							</label>
							<label>
								<span class="ux-label">Correo opcional</span>
								<input name="email" value={professional.email ?? ''} disabled={!canOperate} class="ux-input" />
							</label>
						</div>
					</div>

					<div class="mt-5 flex flex-wrap items-center justify-between gap-3">
						<label class="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white">
							<input type="checkbox" name="is_available" value="true" checked={professional.is_active && professional.is_public} disabled={!canOperate} class="accent-[#7c3aed]" />
							Disponible para turnos
						</label>
						<button type="submit" disabled={!canOperate} class="ux-btn-primary">Guardar</button>
					</div>
				</form>
			</article>
		{/each}
		{#if data.professionals.length === 0}
			<div class="ux-empty md:col-span-2">Todavía no hay profesionales cargados.</div>
		{/if}
	</div>
</section>
