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

	let { data, form } = $props<{
		data: { context: { canOperate: boolean }; services: Service[]; demo: boolean };
		form?: { success?: boolean; message?: string; values?: Record<string, unknown> };
	}>();

	const canOperate = $derived(data.context.canOperate && !data.demo);
</script>

<section class="flex flex-col gap-6">
	<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<h1 class="text-2xl font-semibold text-neutral-900 dark:text-white">Servicios</h1>
		<p class="mt-2 max-w-3xl text-sm text-neutral-600 dark:text-neutral-200">
			Definí qué se puede reservar, cuánto dura y qué buffers bloquean la agenda.
		</p>
	</div>

	{#if form?.message}
		<p class={`rounded-xl px-4 py-3 text-sm font-semibold ${form.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
			{form.message}
		</p>
	{/if}

	<form method="POST" action="?/create_service" class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Nuevo servicio</h2>
		<div class="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			<label class="space-y-1 lg:col-span-2">
				<span class="text-sm font-semibold">Nombre</span>
				<input name="name" required disabled={!canOperate} value={String(form?.values?.name ?? '')} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
			<label class="space-y-1">
				<span class="text-sm font-semibold">Duración min.</span>
				<input name="duration_minutes" type="number" min="1" value="30" disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
			<label class="space-y-1">
				<span class="text-sm font-semibold">Orden</span>
				<input name="sort_order" type="number" value="0" disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
			<label class="space-y-1">
				<span class="text-sm font-semibold">Buffer previo</span>
				<input name="buffer_before_minutes" type="number" min="0" value="0" disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
			<label class="space-y-1">
				<span class="text-sm font-semibold">Buffer posterior</span>
				<input name="buffer_after_minutes" type="number" min="0" value="0" disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
			<label class="space-y-1">
				<span class="text-sm font-semibold">Precio visible</span>
				<input name="price_label" disabled={!canOperate} placeholder="$ opcional" class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
			<label class="space-y-1 lg:col-span-4">
				<span class="text-sm font-semibold">Descripción</span>
				<textarea name="description" rows="2" disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]"></textarea>
			</label>
		</div>
		<div class="mt-4 flex flex-wrap gap-3">
			<label class="flex items-center gap-2 rounded-xl border border-neutral-200 px-4 py-3 text-sm font-semibold dark:border-[#1f3554]">
				<input type="checkbox" name="is_public" value="true" checked disabled={!canOperate} class="accent-[#7c3aed]" />
				Visible público
			</label>
			<label class="flex items-center gap-2 rounded-xl border border-neutral-200 px-4 py-3 text-sm font-semibold dark:border-[#1f3554]">
				<input type="checkbox" name="is_active" value="true" checked disabled={!canOperate} class="accent-[#7c3aed]" />
				Activo
			</label>
		</div>
		<div class="mt-5 flex justify-end">
			<button type="submit" disabled={!canOperate} class="rounded-xl bg-[#7c3aed] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">
				Crear servicio
			</button>
		</div>
	</form>

	<div class="grid gap-4">
		{#each data.services as service}
			<form method="POST" action="?/update_service" class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642]">
				<input type="hidden" name="service_id" value={service.id} />
				<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					<label class="space-y-1 lg:col-span-2">
						<span class="text-sm font-semibold">Nombre</span>
						<input name="name" value={service.name} disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
					</label>
					<label class="space-y-1">
						<span class="text-sm font-semibold">Duración</span>
						<input name="duration_minutes" type="number" min="1" value={service.duration_minutes} disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
					</label>
					<label class="space-y-1">
						<span class="text-sm font-semibold">Orden</span>
						<input name="sort_order" type="number" value={service.sort_order} disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
					</label>
					<label class="space-y-1">
						<span class="text-sm font-semibold">Buffer previo</span>
						<input name="buffer_before_minutes" type="number" min="0" value={service.buffer_before_minutes} disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
					</label>
					<label class="space-y-1">
						<span class="text-sm font-semibold">Buffer posterior</span>
						<input name="buffer_after_minutes" type="number" min="0" value={service.buffer_after_minutes} disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
					</label>
					<label class="space-y-1">
						<span class="text-sm font-semibold">Precio visible</span>
						<input name="price_label" value={service.price_label ?? ''} disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
					</label>
					<label class="space-y-1 lg:col-span-4">
						<span class="text-sm font-semibold">Descripción</span>
						<textarea name="description" rows="2" disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]">{service.description ?? ''}</textarea>
					</label>
				</div>
				<div class="mt-4 flex flex-wrap items-center justify-between gap-3">
					<div class="flex flex-wrap gap-3">
						<label class="flex items-center gap-2 rounded-xl border border-neutral-200 px-4 py-3 text-sm font-semibold dark:border-[#1f3554]">
							<input type="checkbox" name="is_public" value="true" checked={service.is_public} disabled={!canOperate} class="accent-[#7c3aed]" />
							Público
						</label>
						<label class="flex items-center gap-2 rounded-xl border border-neutral-200 px-4 py-3 text-sm font-semibold dark:border-[#1f3554]">
							<input type="checkbox" name="is_active" value="true" checked={service.is_active} disabled={!canOperate} class="accent-[#7c3aed]" />
							Activo
						</label>
					</div>
					<button type="submit" disabled={!canOperate} class="rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900">
						Guardar
					</button>
				</div>
			</form>
		{/each}
		{#if data.services.length === 0}
			<div class="rounded-2xl border border-dashed border-neutral-300 bg-white/70 p-6 text-sm text-neutral-600 dark:border-[#1f3554] dark:bg-[#152642] dark:text-neutral-200">
				Todavía no hay servicios cargados.
			</div>
		{/if}
	</div>
</section>
