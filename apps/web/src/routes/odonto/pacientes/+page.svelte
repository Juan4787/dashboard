<script lang="ts">
import Modal from '$lib/components/Modal.svelte';
import { formatDate } from '$lib/utils/format';
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { enhance } from '$app/forms';
import type { KeyboardEventHandler } from 'svelte/elements';

type FormResult = {
	duplicate?: boolean;
	duplicateField?: 'dni' | 'name';
	message?: string;
	existingId?: string;
	full_name?: string;
	dni?: string;
	phone?: string;
};

let { data } = $props<{ data: any; form: FormResult }>();
const formState = $derived(($page.form as FormResult | null) ?? null);

const normalize = (value: string) =>
	value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();

let search = $state('');
let showCreate = $state($page.url.searchParams.has('nuevo'));
let showReport = $state(false);
let createFullName = $state('');
let createDni = $state('');
let createPhone = $state('');
const isSearching = $derived(search.trim().length > 0);
const canCreatePatient = $derived(data.canCreatePatient !== false);

	$effect(() => {
		if ($page.url.searchParams.has('nuevo')) {
			showCreate = true;
		}
		if (formState?.message) {
			showCreate = true;
			createFullName = formState.full_name ?? createFullName;
			createDni = formState.dni ?? createDni;
			createPhone = formState.phone ?? createPhone;
		}
	});

	let filteredPatients = $state<any[]>([]);

	const preventEnterSubmit: KeyboardEventHandler<HTMLFormElement> = (event) => {
		if (event.key !== 'Enter') return;
		const target = event.target as HTMLElement | null;
		// Allow Enter inside textareas (nueva línea). Block elsewhere to evitar submits accidentales.
		if (target instanceof HTMLTextAreaElement) return;
		event.preventDefault();
	};

	const activeCount = $derived(data.activeCount ?? (data.patients ?? []).filter((p: any) => !p.archived_at).length);
	const archivedCount = $derived(data.archivedCount ?? (data.patients ?? []).filter((p: any) => p.archived_at).length);

	$effect(() => {
		const term = normalize(search);
		const source = data.patients ?? [];
		if (!term) {
			filteredPatients = source;
			return;
		}
		filteredPatients = source.filter((p: any) => {
			const name = normalize(p.full_name || '');
			const dni = normalize(p.dni || '');
			const phone = normalize(p.phone || '');
			return name.includes(term) || dni.includes(term) || phone.includes(term);
		});
	});

	const closeModal = () => {
		showCreate = false;
		createFullName = '';
		createDni = '';
		createPhone = '';
		const url = new URL($page.url);
		url.searchParams.delete('nuevo');
		goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true });
	};

	const openCreateModal = () => {
		if (!canCreatePatient) return;
		createFullName = '';
		createDni = '';
		createPhone = '';
		showCreate = true;
	};
</script>

<section class="flex flex-col gap-4">
	<div class="flex flex-col items-start gap-3 md:flex-row md:items-center md:justify-between">
		<div class="space-y-1">
			<h1 class="text-3xl font-semibold text-neutral-900 dark:text-white">Pacientes</h1>
		</div>
		<button
			disabled={!canCreatePatient}
			class="inline-flex w-full justify-center rounded-full bg-[#7c3aed] px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
			onclick={openCreateModal}
		>
			+ Nuevo paciente
		</button>
	</div>

	<div class="flex flex-col gap-3">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
		<div class="w-full sm:flex-1">
			<label class="sr-only" for="q">Buscar</label>
			<div class="relative">
				<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">🔍</span>
				<input
					id="q"
					type="search"
					placeholder="Buscar (nombre, DNI, tel)"
					value={search}
					oninput={(event) => (search = (event.currentTarget as HTMLInputElement).value)}
					class="w-full rounded-2xl border border-neutral-200 bg-white pl-10 pr-4 py-3 text-sm shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-[#eaf1ff] dark:focus:border-primary-400 dark:focus:ring-primary-800 md:py-3 sm:py-3 py-2.5"
				/>
			</div>
		</div>
		<!-- Mobile segmented control -->
		<div class="w-full sm:w-auto md:hidden">
			<div class="flex overflow-hidden rounded-full border border-neutral-200 bg-white text-sm font-semibold dark:border-[#1f3554] dark:bg-[#0f1f36]">
				<a
					href="/odonto/pacientes"
					class={`flex-1 px-4 py-2 text-center transition ${!data.showArchived ? 'bg-[#7c3aed]/15 text-[#5b21b6] dark:bg-[#7c3aed]/20 dark:text-[#e9d5ff]' : 'text-neutral-600 dark:text-neutral-300'}`}
				>
					Activos ({activeCount})
				</a>
				<a
					href="/odonto/pacientes?estado=archivados"
					class={`flex-1 px-4 py-2 text-center transition ${data.showArchived ? 'bg-[#7c3aed]/15 text-[#5b21b6] dark:bg-[#7c3aed]/20 dark:text-[#e9d5ff]' : 'text-neutral-600 dark:text-neutral-300'}`}
				>
					Archivados ({archivedCount})
				</a>
			</div>
		</div>
		<!-- Desktop underline tabs (original) -->
		<div class="hidden items-center gap-4 text-sm font-semibold md:flex">
			<a
				href="/odonto/pacientes"
				class={`pb-2 transition ${
					!data.showArchived
						? 'text-[#7c3aed] border-b-2 border-[#7c3aed]'
						: 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white'
				}`}
			>
				Activos
			</a>
			<a
				href="/odonto/pacientes?estado=archivados"
				class={`pb-2 transition ${
					data.showArchived
						? 'text-[#7c3aed] border-b-2 border-[#7c3aed]'
						: 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white'
				}`}
			>
				Archivados
			</a>
		</div>
	</div>

	<div class="overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm dark:border-[#1f3554] dark:bg-[#122641] mb-10">
		{#if filteredPatients.length === 0}
			<div class="p-6 text-sm text-neutral-600 dark:text-[#c8d4e8]">
				{#if isSearching}
					No encontramos pacientes con ese criterio.
				{:else if data.showArchived}
					No hay pacientes archivados.
				{:else}
					Aun no hay pacientes registrados.
				{/if}
			</div>
		{:else}
			<!-- Desktop table -->
			<div class="hidden md:block">
				<div class="table w-full">
					<div class="table-header-group">
						<div class="table-row border-b border-neutral-200 bg-neutral-200 dark:border-white/10 dark:bg-white/5">
							<div class="table-cell px-6 py-4 text-xs font-semibold uppercase tracking-wide text-neutral-800 dark:text-neutral-200 align-middle">
								<div class="flex items-center gap-4">
									<span class="h-10 w-10 rounded-full bg-transparent"></span>
									<span>Paciente</span>
								</div>
							</div>
							<div class="table-cell px-6 py-4 text-xs font-semibold uppercase tracking-wide text-neutral-800 dark:text-neutral-200 align-middle text-left">
								DNI / Teléfono
							</div>
							<div class="table-cell px-6 py-4 text-xs font-semibold uppercase tracking-wide text-neutral-800 dark:text-neutral-200 align-middle text-left">
								Última visita
							</div>
							<div class="table-cell px-6 py-4 text-xs font-semibold uppercase tracking-wide text-neutral-800 dark:text-neutral-200 align-middle text-right">
								Acciones
							</div>
						</div>
					</div>

					<div class="table-row-group">
						{#each filteredPatients as patient}
							{#if data.showArchived}
								<div class="table-row border-b border-white/10 last:border-b-0 hover:bg-neutral-50 dark:hover:bg-[#0f1f36]">
									<div class="table-cell align-middle px-6 py-5">
										<div class="flex items-center gap-4">
											<div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-100 text-primary-700 font-semibold dark:bg-primary-800/40 dark:text-primary-100">
												{(patient.full_name || '?')
													.split(' ')
													.filter(Boolean)
													.slice(0, 2)
													.map((p: string) => p[0]?.toUpperCase())
													.join('')}
											</div>
											<div>
												<p class="text-sm font-semibold text-neutral-900 dark:text-white hover:underline">
													{patient.full_name}
												</p>
												<div class="text-xs text-neutral-500 dark:text-neutral-300 mt-2">
													{#if patient.archived_at}
														<span class="rounded-full bg-neutral-200 px-2 py-1 text-[11px] font-semibold text-neutral-700 dark:bg-[#1f3554] dark:text-neutral-100">Archivado</span>
													{:else}
														<span class="rounded-full bg-green-100 px-2 py-1 text-[11px] font-semibold text-green-800 dark:bg-green-800/40 dark:text-green-100">Activo</span>
													{/if}
												</div>
											</div>
										</div>
									</div>
									<div class="table-cell align-middle px-6 py-5 text-sm text-neutral-600 dark:text-neutral-200 text-left">
										{patient.dni ?? 'Sin DNI'}
										{patient.phone ? ` • ${patient.phone}` : ''}
									</div>
									<div class="table-cell align-middle px-6 py-5 text-sm text-neutral-600 dark:text-neutral-200 text-left">
										{patient.last_entry_at ? formatDate(patient.last_entry_at) : '—'}
									</div>
										<div class="table-cell align-middle px-6 py-5 text-right">
											<a
												href={`/odonto/pacientes/${patient.id}`}
												data-sveltekit-preload-data="tap"
												onclick={(event) => event.stopPropagation()}
												onkeydown={(event) => event.stopPropagation()}
												class="rounded-full px-4 py-2 text-xs font-semibold text-white bg-[#7c3aed] shadow-sm transition hover:-translate-y-0.5 hover:shadow-card"
											>
												Abrir paciente
											</a>
										{#if patient.archived_at}
											<form method="post" action={`/odonto/pacientes/${patient.id}?/unarchive_patient`} class="mt-5">
												<button
													type="submit"
													class="rounded-full border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-800 transition hover:-translate-y-0.5 hover:bg-neutral-200 dark:border-[#8fb3ff] dark:text-white dark:hover:bg-[#1b2d4b]"
												>
													Desarchivar paciente
												</button>
											</form>
										{/if}
									</div>
								</div>
							{:else}
								<div
									class="table-row border-b border-white/10 last:border-b-0 hover:bg-neutral-50 dark:hover:bg-[#0f1f36] cursor-pointer"
									role="button"
									tabindex="0"
									onclick={() => goto(`/odonto/pacientes/${patient.id}`)}
									onkeydown={(event) => {
										if (event.key === 'Enter' || event.key === ' ') {
											event.preventDefault();
											goto(`/odonto/pacientes/${patient.id}`);
										}
									}}
								>
									<div class="table-cell align-middle px-6 py-5">
										<div class="flex items-center gap-4">
											<div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-100 text-primary-700 font-semibold dark:bg-primary-800/40 dark:text-primary-100">
												{(patient.full_name || '?')
													.split(' ')
													.filter(Boolean)
													.slice(0, 2)
													.map((p: string) => p[0]?.toUpperCase())
													.join('')}
											</div>
											<div>
												<p class="text-sm font-semibold text-neutral-900 dark:text-white hover:underline">
													{patient.full_name}
												</p>
												<div class="text-xs text-neutral-500 dark:text-neutral-300 mt-2">
													{#if patient.archived_at}
														<span class="rounded-full bg-neutral-200 px-2 py-1 text-[11px] font-semibold text-neutral-700 dark:bg-[#1f3554] dark:text-neutral-100">Archivado</span>
													{:else}
														<span class="rounded-full bg-green-100 px-2 py-1 text-[11px] font-semibold text-green-800 dark:bg-green-800/40 dark:text-green-100">Activo</span>
													{/if}
												</div>
											</div>
										</div>
									</div>
									<div class="table-cell align-middle px-6 py-5 text-sm text-neutral-600 dark:text-neutral-200 text-left">
										{patient.dni ?? 'Sin DNI'}
										{patient.phone ? ` • ${patient.phone}` : ''}
									</div>
									<div class="table-cell align-middle px-6 py-5 text-sm text-neutral-600 dark:text-neutral-200 text-left">
										{patient.last_entry_at ? formatDate(patient.last_entry_at) : '—'}
									</div>
										<div class="table-cell align-middle px-6 py-5 text-right">
											<a
												href={`/odonto/pacientes/${patient.id}`}
												data-sveltekit-preload-data="tap"
												onclick={(event) => event.stopPropagation()}
												onkeydown={(event) => event.stopPropagation()}
												class="rounded-full px-4 py-2 text-xs font-semibold text-white bg-[#7c3aed] shadow-sm transition hover:-translate-y-0.5 hover:shadow-card"
											>
												Abrir paciente
											</a>
										{#if patient.archived_at}
											<form method="post" action={`/odonto/pacientes/${patient.id}?/unarchive_patient`} class="mt-5">
												<button
													type="submit"
													class="rounded-full border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-800 transition hover:-translate-y-0.5 hover:bg-neutral-200 dark:border-[#8fb3ff] dark:text-white dark:hover:bg-[#1b2d4b]"
												>
													Desarchivar paciente
												</button>
											</form>
										{/if}
									</div>
								</div>
							{/if}
						{/each}
					</div>
				</div>
			</div>

			<!-- Mobile cards -->
			<div class="space-y-3 p-3 md:hidden">
				{#each filteredPatients as patient}
					{#if data.showArchived}
						<div class="rounded-xl border border-neutral-100 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card dark:border-[#1f3554] dark:bg-[#0f1f36]">
							<div class="flex items-center gap-3">
								<div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-100 text-primary-700 font-semibold dark:bg-primary-800/40 dark:text-primary-100">
									{(patient.full_name || '?')
										.split(' ')
										.filter(Boolean)
										.slice(0, 2)
										.map((p: string) => p[0]?.toUpperCase())
										.join('')}
								</div>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2">
										<p class="truncate text-base font-semibold text-neutral-900 dark:text-white">{patient.full_name}</p>
										{#if patient.archived_at}
											<span class="rounded-full bg-neutral-200 px-2 py-1 text-[11px] font-semibold text-neutral-700 dark:bg-[#1f3554] dark:text-neutral-100">Archivado</span>
										{:else}
											<span class="rounded-full bg-green-100 px-2 py-1 text-[11px] font-semibold text-green-800 dark:bg-green-800/40 dark:text-green-100">Activo</span>
										{/if}
									</div>
									<div class="mt-1 space-y-1 text-[12px] text-neutral-600 dark:text-neutral-300">
										<p class="break-all">DNI {patient.dni ?? 'Sin DNI'}</p>
										{#if patient.phone}
											<p class="break-all">Tel {patient.phone}</p>
										{/if}
									</div>
									<p class="mt-1 text-[12px] text-neutral-600 dark:text-neutral-300">
										Últ. visita {patient.last_entry_at ? formatDate(patient.last_entry_at) : '—'}
									</p>
								</div>
							</div>
								<div class="mt-3 flex flex-col gap-2">
									<a
										href={`/odonto/pacientes/${patient.id}`}
										data-sveltekit-preload-data="tap"
										onclick={(event) => event.stopPropagation()}
										onkeydown={(event) => event.stopPropagation()}
										class="w-full rounded-full bg-[#7c3aed] px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-card"
									>
										Abrir paciente
									</a>
								{#if patient.archived_at}
									<form method="post" action={`/odonto/pacientes/${patient.id}?/unarchive_patient`}>
										<button
											type="submit"
											class="w-full rounded-full border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-800 transition hover:-translate-y-0.5 hover:bg-neutral-200 dark:border-[#8fb3ff] dark:text-white dark:hover:bg-[#1b2d4b]"
										>
											Desarchivar paciente
										</button>
									</form>
								{/if}
							</div>
						</div>
					{:else}
						<div
							class="rounded-xl border border-neutral-100 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card dark:border-[#1f3554] dark:bg-[#0f1f36] cursor-pointer"
							role="button"
							tabindex="0"
							onclick={() => goto(`/odonto/pacientes/${patient.id}`)}
							onkeydown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									goto(`/odonto/pacientes/${patient.id}`);
								}
							}}
						>
							<div class="flex items-center gap-3">
								<div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-100 text-primary-700 font-semibold dark:bg-primary-800/40 dark:text-primary-100">
									{(patient.full_name || '?')
										.split(' ')
										.filter(Boolean)
										.slice(0, 2)
										.map((p: string) => p[0]?.toUpperCase())
										.join('')}
								</div>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2">
										<p class="truncate text-base font-semibold text-neutral-900 dark:text-white">{patient.full_name}</p>
										{#if patient.archived_at}
											<span class="rounded-full bg-neutral-200 px-2 py-1 text-[11px] font-semibold text-neutral-700 dark:bg-[#1f3554] dark:text-neutral-100">Archivado</span>
										{:else}
											<span class="rounded-full bg-green-100 px-2 py-1 text-[11px] font-semibold text-green-800 dark:bg-green-800/40 dark:text-green-100">Activo</span>
										{/if}
									</div>
									<div class="mt-1 space-y-1 text-[12px] text-neutral-600 dark:text-neutral-300">
										<p class="break-all">DNI {patient.dni ?? 'Sin DNI'}</p>
										{#if patient.phone}
											<p class="break-all">Tel {patient.phone}</p>
										{/if}
									</div>
									<p class="mt-1 text-[12px] text-neutral-600 dark:text-neutral-300">
										Últ. visita {patient.last_entry_at ? formatDate(patient.last_entry_at) : '—'}
									</p>
								</div>
							</div>
						</div>
					{/if}
				{/each}
			</div>
			{/if}
		</div>
	</div>

	<div class="mt-4 hidden justify-end md:flex">
		<div class="flex flex-col items-end gap-2">
			<button
				type="button"
				class="rounded-full bg-[#991b1b] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed]"
				onclick={() => (showReport = !showReport)}
			>
				Reportar problema
			</button>
			{#if showReport}
				<div class="max-w-md rounded-xl border border-red-200 bg-[#5c0d0d] p-4 text-sm text-white shadow-sm dark:border-red-400/40 dark:bg-[#430a0a] dark:text-white">
					<p class="font-semibold mb-1">¿Encontraste un problema?</p>
					<p>Para reportar cualquier problema, error o bug de esta app, enviar un correo a <span class="font-semibold">juanpabloaltamira@protonmail.com</span>.</p>
				</div>
			{/if}
		</div>
	</div>

</section>

<Modal open={showCreate} title="Alta rápida de paciente" on:close={closeModal}>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<form method="post" action="?/create_patient" use:enhance class="space-y-4" onkeydown={preventEnterSubmit}>
		{#if !canCreatePatient}
			<div class="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
				Tu acceso a Cita Suite venció. Activá tu suscripción para volver a usar la plataforma.
			</div>
		{/if}
		<div class="space-y-2">
			<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="full_name">Nombre y apellido *</label>
			<input
				id="full_name"
				name="full_name"
				class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
				placeholder="Ej: Juan Pérez"
				required
				bind:value={createFullName}
			/>
		</div>
		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
			<div class="space-y-2">
					<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="dni">DNI (opcional)</label>
				<input
					id="dni"
					name="dni"
					inputmode="numeric"
					class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					placeholder="Solo números"
					bind:value={createDni}
				/>
			</div>
			<div class="space-y-2">
					<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="phone">Teléfono (opcional)</label>
				<input
					id="phone"
					name="phone"
					inputmode="tel"
					class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					placeholder="Código + número"
					bind:value={createPhone}
				/>
			</div>
		</div>

		{#if formState?.message}
			<div
				class={`rounded-xl px-4 py-3 text-sm font-semibold ${
					formState.duplicate
						? 'border border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-400/60 dark:bg-amber-500/15 dark:text-amber-100'
						: 'border border-red-300 bg-red-50 text-red-800 dark:border-red-400/60 dark:bg-red-500/15 dark:text-red-100'
				}`}
			>
				<p>{formState.message}</p>
				{#if formState.duplicate && formState.existingId}
					<a
						class="mt-3 inline-flex rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
						href={`/odonto/pacientes/${formState.existingId}`}
						data-sveltekit-preload-data="tap"
					>
						Abrir paciente existente
					</a>
				{/if}
			</div>
		{/if}

		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
			<button
				type="button"
				onclick={closeModal}
				class="w-full rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 sm:w-auto"
			>
				Cancelar
			</button>
			<button
				type="submit"
				disabled={!canCreatePatient}
				class="w-full rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
			>
				Crear paciente
			</button>
		</div>
	</form>
</Modal>
