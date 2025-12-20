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

<section class="flex flex-col gap-6">
	<div class="rounded-2xl border border-neutral-100 bg-white/80 p-6 shadow-card dark:border-[#1f3554] dark:bg-[#152642]">
		<h1 class="text-2xl font-semibold text-neutral-900 dark:text-white">Panel maestro</h1>
		<p class="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
			Desde acá habilitás o deshabilitás los emails que pueden registrarse y entrar a la app.
		</p>
	</div>

	<div class="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
		<div class="rounded-2xl border border-neutral-100 bg-white/80 p-6 shadow-card dark:border-[#1f3554] dark:bg-[#152642]">
			<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Habilitar nuevo email</h2>
			<p class="mt-1 text-sm text-neutral-500 dark:text-neutral-300">
				Agregá un email y definí si puede registrarse de inmediato.
			</p>

			<form method="post" action="?/add_email" class="mt-5 space-y-4">
				<div class="space-y-2">
					<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="email">
						Email a habilitar
					</label>
					<input
						id="email"
						name="email"
						type="email"
						class="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white"
						placeholder="ejemplo@correo.com"
						required
					/>
				</div>
				<div class="flex items-center gap-3">
					<input id="enabled" name="enabled" type="checkbox" value="true" checked class="h-4 w-4 accent-[#7c3aed]" />
					<label for="enabled" class="text-sm text-neutral-600 dark:text-neutral-300">Habilitar para registrarse</label>
				</div>
				{#if form?.message}
					<p class="rounded-xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200">
						{form.message}
					</p>
				{/if}
				<button
					type="submit"
					class="w-full rounded-xl bg-[#7c3aed] px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl"
				>
					Guardar email
				</button>
			</form>
		</div>

		<div class="rounded-2xl border border-neutral-100 bg-white/80 p-6 shadow-card dark:border-[#1f3554] dark:bg-[#152642]">
			<div class="flex items-center justify-between">
				<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Emails habilitados</h2>
				<span class="rounded-full bg-[#7c3aed]/10 px-3 py-1 text-xs font-semibold text-[#7c3aed]">
					{data.emails?.length ?? 0} emails
				</span>
			</div>

			{#if data.loadError}
				<p class="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200">
					{data.loadError}
				</p>
			{:else if !data.emails || data.emails.length === 0}
				<p class="mt-4 text-sm text-neutral-500 dark:text-neutral-300">
					Todavía no hay emails habilitados.
				</p>
			{:else}
				<div class="mt-4 space-y-3">
					{#each data.emails as item}
						<div class="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-neutral-100 bg-white/60 p-4 dark:border-[#1f3554] dark:bg-[#0f1f36]">
							<div>
								<p class="text-sm font-semibold text-neutral-900 dark:text-white">{item.email}</p>
								<span
									class={`mt-1 inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold ${
										item.enabled
											? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-100'
											: 'bg-neutral-200 text-neutral-700 dark:bg-[#1f3554] dark:text-neutral-200'
									}`}
								>
									{item.enabled ? 'Habilitado' : 'Deshabilitado'}
								</span>
							</div>
							<div class="flex items-center gap-2">
								{#if item.enabled}
									<button
										type="button"
										class="rounded-full bg-neutral-900 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-card dark:bg-neutral-100 dark:text-neutral-900"
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
											class="rounded-full bg-[#7c3aed] px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-card"
										>
											Habilitar
										</button>
									</form>
								{/if}
								<form method="post" action="?/delete_email">
									<button
										type="button"
										class="rounded-full border border-neutral-200 px-4 py-2 text-xs font-semibold text-neutral-700 transition hover:-translate-y-0.5 hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-200 dark:hover:bg-[#122641]"
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

<Modal open={showDisableConfirm} title="Deshabilitar email" on:close={closeDisableConfirm} dismissible>
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

<Modal open={showDeleteConfirm} title="Eliminar email" on:close={closeDeleteConfirm} dismissible>
	<div class="space-y-4 text-sm text-neutral-800 dark:text-neutral-100">
		<p>
			Vas a eliminar el email
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
