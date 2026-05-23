<script lang="ts">
	import Modal from '$lib/components/Modal.svelte';

	let { data, form } = $props();
	let showDisableConfirm = $state(false);
	let disableTarget = $state<{ id: string; email: string } | null>(null);
	let confirmText = $state('');
	const confirmEnabled = $derived(confirmText.trim().toLowerCase() === 'deshabilitar');
	let showDeleteConfirm = $state(false);
	let deleteTarget = $state<{ id: string; email: string } | null>(null);
	let deleteText = $state('');
	const deleteEnabled = $derived(deleteText.trim().toLowerCase() === 'eliminar');

	const openDisableConfirm = (item: { id: string; email: string }) => {
		disableTarget = item;
		confirmText = '';
		showDisableConfirm = true;
	};

	const closeDisableConfirm = () => {
		showDisableConfirm = false;
		disableTarget = null;
		confirmText = '';
	};

	const openDeleteConfirm = (item: { id: string; email: string }) => {
		deleteTarget = item;
		deleteText = '';
		showDeleteConfirm = true;
	};

	const closeDeleteConfirm = () => {
		showDeleteConfirm = false;
		deleteTarget = null;
		deleteText = '';
	};
</script>

<section class="ux-page">
	<div class="ux-hero">
		<p class="ux-badge">Panel maestro</p>
		<h1 class="ux-title mt-4">Accesos autorizados</h1>
		<p class="ux-subtitle">Correos que pueden registrarse y entrar al sistema.</p>
	</div>

	<div class="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
		<div class="ux-card">
			<h2 class="ux-section-title">Nuevo correo</h2>
			<p class="mt-1 text-sm text-white/55">Agregá un correo habilitado.</p>

			<form method="post" action="?/add_email" class="mt-5 space-y-4">
				<div class="space-y-2">
					<label class="ux-label" for="email">Correo</label>
					<input
						id="email"
						name="email"
						type="email"
						class="ux-input"
						placeholder="ejemplo@correo.com"
						required
					/>
				</div>
				<label class="ux-choice flex items-center gap-3 px-4 py-3">
					<input id="enabled" name="enabled" type="checkbox" value="true" checked class="h-4 w-4 accent-[#7c3aed]" />
					<span class="text-sm font-bold text-white">Habilitar para registrarse</span>
				</label>
				{#if form?.message}
					<p class="ux-alert">{form.message}</p>
				{/if}
				<button type="submit" class="ux-btn-primary w-full">Guardar</button>
			</form>
		</div>

		<div class="ux-card">
			<div class="flex items-center justify-between">
				<h2 class="ux-section-title">Correos</h2>
				<span class="ux-badge">
					{data.emails?.length ?? 0} correos
				</span>
			</div>

			{#if data.loadError}
				<p class="ux-alert mt-4">{data.loadError}</p>
			{:else if !data.emails || data.emails.length === 0}
				<p class="ux-empty mt-4">Todavía no hay correos habilitados.</p>
			{:else}
				<div class="mt-4 space-y-3">
					{#each data.emails as item}
						<div class="ux-soft-card flex flex-wrap items-center justify-between gap-4 p-4">
							<div>
								<p class="text-sm font-bold text-white">{item.email}</p>
								<span
									class={item.enabled ? 'ux-badge ux-badge-success mt-2' : 'ux-badge mt-2'}
								>
									{item.enabled ? 'Habilitado' : 'Deshabilitado'}
								</span>
							</div>
							<div class="flex items-center gap-2">
								{#if item.enabled}
									<button
										type="button"
										class="ux-btn-secondary"
										onclick={() => openDisableConfirm(item)}
									>
										Deshabilitar
									</button>
								{:else}
									<form method="post" action="?/toggle_email">
										<input type="hidden" name="id" value={item.id} />
										<input type="hidden" name="enabled" value="true" />
										<button
											type="submit"
											class="ux-btn-primary"
										>
											Habilitar
										</button>
									</form>
								{/if}
								<form method="post" action="?/delete_email">
									<button
										type="button"
										class="ux-btn-danger"
										onclick={() => openDeleteConfirm(item)}
									>
										Eliminar
									</button>
								</form>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</section>

<Modal open={showDisableConfirm} title="Deshabilitar correo electrónico" on:close={closeDisableConfirm} dismissible>
	<div class="space-y-4 text-sm text-neutral-800 dark:text-neutral-100">
		<p>
			Vas a deshabilitar el acceso de
			<span class="font-semibold">{disableTarget?.email ?? ''}</span>.
		</p>
		<p class="text-sm text-neutral-600 dark:text-neutral-300">
			Escribí <span class="font-semibold">deshabilitar</span> para confirmar.
		</p>
		<input
			class="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white"
			placeholder="deshabilitar"
			bind:value={confirmText}
		/>
		<div class="flex justify-end gap-2">
			<button
				type="button"
				class="rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:text-white dark:hover:bg-[#1b2d4b]"
				onclick={closeDisableConfirm}
			>
				Cancelar
			</button>
			<form method="post" action="?/toggle_email">
				<input type="hidden" name="id" value={disableTarget?.id ?? ''} />
				<input type="hidden" name="enabled" value="false" />
				<button
					type="submit"
					class={`rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition ${
						confirmEnabled ? 'bg-red-600 hover:bg-red-700' : 'bg-red-300 cursor-not-allowed'
					}`}
					disabled={!confirmEnabled}
				>
					Confirmar deshabilitado
				</button>
			</form>
		</div>
	</div>
</Modal>

<Modal open={showDeleteConfirm} title="Eliminar correo electrónico" on:close={closeDeleteConfirm} dismissible>
	<div class="space-y-4 text-sm text-neutral-800 dark:text-neutral-100">
		<p>
			Vas a eliminar el correo electrónico
			<span class="font-semibold">{deleteTarget?.email ?? ''}</span>.
		</p>
		<p class="text-sm text-neutral-600 dark:text-neutral-300">
			Escribí <span class="font-semibold">eliminar</span> para confirmar.
		</p>
		<input
			class="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white"
			placeholder="eliminar"
			bind:value={deleteText}
		/>
		<div class="flex justify-end gap-2">
			<button
				type="button"
				class="rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:text-white dark:hover:bg-[#1b2d4b]"
				onclick={closeDeleteConfirm}
			>
				Cancelar
			</button>
			<form method="post" action="?/delete_email">
				<input type="hidden" name="id" value={deleteTarget?.id ?? ''} />
				<button
					type="submit"
					class={`rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition ${
						deleteEnabled ? 'bg-red-600 hover:bg-red-700' : 'bg-red-300 cursor-not-allowed'
					}`}
					disabled={!deleteEnabled}
				>
					Confirmar eliminación
				</button>
			</form>
		</div>
	</div>
</Modal>
