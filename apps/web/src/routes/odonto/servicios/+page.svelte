<script lang="ts">
	type Service = {
		id: string;
		name: string;
		description: string | null;
		duration_minutes: number;
		buffer_before_minutes: number;
		buffer_after_minutes: number;
		price_label: string | null;
		is_public: boolean;
		is_active: boolean;
		sort_order: number;
	};
	type Professional = {
		id: string;
		name: string;
		is_active: boolean;
		is_public: boolean;
	};

	let { data, form } = $props<{
		data: {
			context: { canOperate: boolean };
			services: Service[];
			professionals: Professional[];
			serviceProfessionalIds: Record<string, string[]>;
			demo: boolean;
		};
		form?: { success?: boolean; message?: string; values?: Record<string, unknown> };
	}>();

	const canOperate = $derived(data.context.canOperate && !data.demo);
	const assignedProfessionalsFor = (serviceId: string) => data.serviceProfessionalIds[serviceId] ?? [];
</script>

<section class="ux-page">
	<div class="ux-hero">
		<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<p class="ux-badge">Catálogo</p>
				<h1 class="ux-title mt-4">Servicios</h1>
				<p class="ux-subtitle">Lo que el paciente puede reservar y quién puede atenderlo.</p>
			</div>
			<div class="ux-soft-card min-w-36 p-5 text-center">
				<p class="text-sm font-bold text-white/55">Disponibles</p>
				<p class="mt-1 text-4xl font-bold text-white">{data.services.filter((item: Service) => item.is_active && item.is_public).length}</p>
			</div>
		</div>
	</div>

	{#if form?.message}
		<p class={form.success ? 'ux-alert ux-alert-success' : 'ux-alert'}>{form.message}</p>
	{/if}

	<form method="POST" action="?/create_service" class="ux-card">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h2 class="ux-section-title">Nuevo servicio</h2>
				<p class="mt-1 text-sm text-white/55">Nombre, duración y profesionales que lo atienden.</p>
			</div>
			<button type="submit" disabled={!canOperate} class="ux-btn-primary">Crear servicio</button>
		</div>

		<div class="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			<label class="lg:col-span-2">
				<span class="ux-label">Nombre</span>
				<input name="name" required disabled={!canOperate} value={String(form?.values?.name ?? '')} class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Duración</span>
				<input name="duration_minutes" type="number" min="1" value="30" disabled={!canOperate} class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Precio opcional</span>
				<input name="price_label" disabled={!canOperate} placeholder="$" class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Tiempo antes opcional</span>
				<input name="buffer_before_minutes" type="number" min="0" value="0" disabled={!canOperate} class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Tiempo después opcional</span>
				<input name="buffer_after_minutes" type="number" min="0" value="0" disabled={!canOperate} class="ux-input" />
			</label>
			<label class="md:col-span-2">
				<span class="ux-label">Descripción opcional</span>
				<textarea name="description" rows="2" disabled={!canOperate} class="ux-textarea"></textarea>
			</label>
		</div>

		<label class="mt-5 inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white">
			<input type="checkbox" name="is_available" value="true" checked disabled={!canOperate} class="accent-[#7c3aed]" />
			Disponible para reservar
		</label>

		<div class="mt-5">
			<p class="ux-label">Profesionales que lo atienden</p>
			{#if data.professionals.length > 0}
				<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
					{#each data.professionals as professional}
						<label class="ux-choice flex items-center gap-3 px-4 py-3">
							<input type="checkbox" name="professional_id" value={professional.id} disabled={!canOperate} class="accent-[#7c3aed]" />
							<span class="font-bold text-white">{professional.name}</span>
						</label>
					{/each}
				</div>
			{:else}
				<p class="ux-empty">Primero cargá profesionales.</p>
			{/if}
		</div>
	</form>

	<div class="grid gap-4">
		{#each data.services as service}
			<form method="POST" action="?/update_service" class="ux-card">
				<input type="hidden" name="service_id" value={service.id} />
				<div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
					<div>
						<span class={service.is_active && service.is_public ? 'ux-badge ux-badge-success' : 'ux-badge'}>{service.is_active && service.is_public ? 'Reservable' : 'Oculto'}</span>
						<h2 class="mt-4 text-2xl font-bold text-white">{service.name}</h2>
						<p class="mt-1 text-sm text-white/55">{service.duration_minutes} minutos</p>
					</div>
					<button type="submit" disabled={!canOperate} class="ux-btn-primary">Guardar</button>
				</div>

				<div class="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					<label class="lg:col-span-2">
						<span class="ux-label">Nombre</span>
						<input name="name" value={service.name} disabled={!canOperate} class="ux-input" />
					</label>
					<label>
						<span class="ux-label">Duración</span>
						<input name="duration_minutes" type="number" min="1" value={service.duration_minutes} disabled={!canOperate} class="ux-input" />
					</label>
					<label>
						<span class="ux-label">Precio opcional</span>
						<input name="price_label" value={service.price_label ?? ''} disabled={!canOperate} class="ux-input" />
					</label>
					<label>
						<span class="ux-label">Tiempo antes opcional</span>
						<input name="buffer_before_minutes" type="number" min="0" value={service.buffer_before_minutes} disabled={!canOperate} class="ux-input" />
					</label>
					<label>
						<span class="ux-label">Tiempo después opcional</span>
						<input name="buffer_after_minutes" type="number" min="0" value={service.buffer_after_minutes} disabled={!canOperate} class="ux-input" />
					</label>
					<label class="md:col-span-2">
						<span class="ux-label">Descripción opcional</span>
						<textarea name="description" rows="2" disabled={!canOperate} class="ux-textarea">{service.description ?? ''}</textarea>
					</label>
				</div>

				<div class="mt-5 flex flex-wrap gap-3">
					<label class="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white">
						<input type="checkbox" name="is_available" value="true" checked={service.is_active && service.is_public} disabled={!canOperate} class="accent-[#7c3aed]" />
						Disponible para reservar
					</label>
				</div>

				<div class="mt-5">
					<p class="ux-label">Profesionales que lo atienden</p>
					{#if data.professionals.length > 0}
						<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
							{#each data.professionals as professional}
								<label class={`ux-choice flex items-center gap-3 px-4 py-3 ${assignedProfessionalsFor(service.id).includes(professional.id) ? 'ux-choice-active' : ''}`}>
									<input
										type="checkbox"
										name="professional_id"
										value={professional.id}
										checked={assignedProfessionalsFor(service.id).includes(professional.id)}
										disabled={!canOperate}
										class="accent-[#7c3aed]"
									/>
									<span class="font-bold text-white">{professional.name}</span>
								</label>
							{/each}
						</div>
					{:else}
						<p class="ux-empty">Primero cargá profesionales.</p>
					{/if}
				</div>
			</form>
		{/each}
		{#if data.services.length === 0}
			<div class="ux-empty">Todavía no hay servicios cargados.</div>
		{/if}
	</div>
</section>
