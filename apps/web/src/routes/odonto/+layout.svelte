<script lang="ts">
	import { page } from '$app/stores';
	import { navigating } from '$app/stores';
	import { onDestroy } from 'svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import OdontoRouteSkeleton from '$lib/components/skeleton/OdontoRouteSkeleton.svelte';

	let { data, children } = $props();
	let mobileMenuOpen = $state(false);
	let showReportHelp = $state(false);
	let showSkeleton = $state(false);
	let shownAt = $state<number | null>(null);
	let skeletonKind = $state<'patients' | 'patientDetail' | 'config' | 'master'>('patients');

	const SKELETON_DELAY_MS = 120;
	const SKELETON_MIN_VISIBLE_MS = 220;

	let showDelayTimer: ReturnType<typeof setTimeout> | null = null;
	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	const nav = [
		{ label: 'Agenda', href: '/odonto/agenda' },
		{ label: 'Pacientes', href: '/odonto/pacientes' },
		{ label: 'Profesionales', href: '/odonto/profesionales' },
		{ label: 'Servicios', href: '/odonto/servicios' },
		{ label: 'Disponibilidad', href: '/odonto/disponibilidad' },
		{ label: 'Mis turnos', href: '/odonto/mis-turnos' },
		{ label: 'Configuración', href: '/odonto/configuracion' }
	];

	const activeBusiness = $derived(data?.activeBusiness);
	const visibleNav = $derived.by(() => {
		if (activeBusiness?.role === 'professional') {
			return nav.filter((item) => item.href === '/odonto/mis-turnos' || item.href === '/odonto/pacientes');
		}
		if (activeBusiness?.role === 'readonly') {
			return nav.filter((item) => item.href === '/odonto/agenda' || item.href === '/odonto/pacientes');
		}
		return nav;
	});

	const isActive = (href: string) => $page.url.pathname.startsWith(href);

	const mobileTitle = $derived.by(() => {
		const path = $page.url.pathname;
		if (path.startsWith('/odonto/pacientes/') && $page.data?.patient?.full_name) {
			return $page.data.patient.full_name;
		}
		if (path.startsWith('/odonto/agenda')) return 'Agenda';
		if (path.startsWith('/odonto/pacientes')) return 'Pacientes';
		if (path.startsWith('/odonto/profesionales')) return 'Profesionales';
		if (path.startsWith('/odonto/servicios')) return 'Servicios';
		if (path.startsWith('/odonto/disponibilidad')) return 'Disponibilidad';
		if (path.startsWith('/odonto/mis-turnos')) return 'Mis turnos';
		if (path.startsWith('/odonto/configuracion')) return 'Configuración';
		if (path.startsWith('/odonto/maestro')) return 'Panel maestro';
		return 'Odontología';
	});

	const showBack = $derived.by(() => {
		const path = $page.url.pathname;
		return path !== '/odonto/pacientes' && path.startsWith('/odonto');
	});

	const resolveSkeletonKind = (routeId: string | null | undefined, path: string) => {
		if (routeId === '/odonto/pacientes/[id]') return 'patientDetail';
		if (routeId === '/odonto/configuracion') return 'config';
		if (routeId === '/odonto/maestro') return 'master';
		if (routeId === '/odonto/pacientes') return 'patients';
		if (path.startsWith('/odonto/pacientes/')) return 'patientDetail';
		if (path.startsWith('/odonto/configuracion')) return 'config';
		if (path.startsWith('/odonto/maestro')) return 'master';
		return 'patients';
	};

	const clearShowDelay = () => {
		if (!showDelayTimer) return;
		clearTimeout(showDelayTimer);
		showDelayTimer = null;
	};

	const clearHideDelay = () => {
		if (!hideTimer) return;
		clearTimeout(hideTimer);
		hideTimer = null;
	};

	const scheduleShowSkeleton = (kind: 'patients' | 'patientDetail' | 'config' | 'master') => {
		skeletonKind = kind;
		clearHideDelay();
		if (showSkeleton) return;
		clearShowDelay();
		showDelayTimer = setTimeout(() => {
			showSkeleton = true;
			shownAt = Date.now();
			showDelayTimer = null;
		}, SKELETON_DELAY_MS);
	};

	const scheduleHideSkeleton = () => {
		clearShowDelay();
		if (!showSkeleton) return;
		const elapsed = shownAt ? Date.now() - shownAt : 0;
		const wait = Math.max(SKELETON_MIN_VISIBLE_MS - elapsed, 0);
		clearHideDelay();
		hideTimer = setTimeout(() => {
			showSkeleton = false;
			shownAt = null;
			hideTimer = null;
		}, wait);
	};

	$effect(() => {
		const navState = $navigating;
		const targetPath = navState?.to?.url?.pathname ?? '';
		if (targetPath.startsWith('/odonto')) {
			const kind = resolveSkeletonKind(navState?.to?.route?.id, targetPath);
			scheduleShowSkeleton(kind);
		} else {
			scheduleHideSkeleton();
		}
	});

	onDestroy(() => {
		clearShowDelay();
		clearHideDelay();
	});
</script>

<div class="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-[#0b1626] dark:text-[#eaf1ff]">
	<header class="sticky top-0 z-20 border-b border-neutral-100 bg-white/80 backdrop-blur dark:border-[#1f2b45] dark:bg-[#0f1f36]/90">
		<div class="flex h-14 items-center justify-between px-4 md:hidden">
			{#if showBack}
				<a
					href="/odonto/pacientes"
					class="flex h-11 w-11 items-center justify-center rounded-full text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#13243d]"
					aria-label="Volver"
				>
					<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
					</svg>
				</a>
			{:else}
				<button
					type="button"
					class="flex h-11 w-11 items-center justify-center rounded-full text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#13243d]"
					aria-label="Abrir menú"
					onclick={() => (mobileMenuOpen = true)}
				>
					<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M4 12h16M4 17h16" />
					</svg>
				</button>
			{/if}
			<h1 class="max-w-[60vw] truncate text-base font-semibold text-neutral-900 dark:text-white">
				{mobileTitle}
			</h1>
			<button
				type="button"
				class="flex h-11 w-11 items-center justify-center rounded-full text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#13243d]"
				aria-label="Menú de acciones"
				onclick={() => (mobileMenuOpen = true)}
			>
				<svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
					<circle cx="6" cy="12" r="1.6" />
					<circle cx="12" cy="12" r="1.6" />
					<circle cx="18" cy="12" r="1.6" />
				</svg>
			</button>
		</div>
		{#if mobileMenuOpen}
			<div class="fixed inset-0 z-40 flex items-start justify-center bg-black/60 px-4 py-6 md:hidden relative">
				<div
					class="relative z-10 w-full max-w-sm rounded-2xl border border-neutral-100 bg-white p-4 text-neutral-900 shadow-2xl dark:border-white/10 dark:bg-[#0f1f36] dark:text-white"
					role="dialog"
					aria-modal="true"
					aria-label="Menú de navegación"
				>
					<div class="flex items-center justify-between">
						<p class="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">Menú</p>
						<button
							type="button"
							class="flex h-10 w-10 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/10"
							onclick={() => {
								mobileMenuOpen = false;
								showReportHelp = false;
							}}
							aria-label="Cerrar menú"
						>
							<span aria-hidden="true">×</span>
						</button>
					</div>
					<nav class="mt-4 flex flex-col gap-2">
						{#if activeBusiness?.business}
							<div class="rounded-xl border border-neutral-200 px-4 py-3 text-sm dark:border-white/10">
								<p class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">
									Negocio activo
								</p>
								<p class="mt-1 font-semibold text-neutral-900 dark:text-white">
									{activeBusiness.business.name}
								</p>
								<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-300">
									Rol: {activeBusiness.role}
								</p>
							</div>
						{/if}
						{#each visibleNav as item}
							<a
								href={item.href}
								class={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
									isActive(item.href)
										? 'bg-[#7c3aed] text-white'
										: 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/10'
								}`}
								onclick={() => (mobileMenuOpen = false)}
							>
								{item.label}
							</a>
						{/each}
						{#if data?.isMaster}
							<a
								href="/odonto/maestro"
								class={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
									isActive('/odonto/maestro')
										? 'bg-[#7c3aed] text-white'
										: 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/10'
								}`}
								onclick={() => (mobileMenuOpen = false)}
							>
								Panel maestro
							</a>
						{/if}
					</nav>
					<div class="mt-4 rounded-xl border border-neutral-200 p-3 dark:border-white/10">
						<p class="text-xs font-semibold text-neutral-500 uppercase tracking-wide dark:text-neutral-300">Tema</p>
						<div class="mt-2">
							<ThemeToggle />
						</div>
					</div>
					<button
						type="button"
						class="mt-4 w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-white/10"
						onclick={() => (showReportHelp = !showReportHelp)}
					>
						Reportar problema
					</button>
					{#if showReportHelp}
						<div class="mt-3 rounded-xl border border-red-400/30 bg-[#430a0a] p-3 text-xs text-white">
							<p class="font-semibold">Soporte</p>
							<p>
								Para reportar errores, escribí a
								<span class="font-semibold">juanpabloaltamira@protonmail.com</span>.
							</p>
						</div>
					{/if}
					<a
						href="/logout"
						class="mt-4 block w-full rounded-xl bg-neutral-900 px-4 py-3 text-center text-sm font-semibold text-white dark:bg-white dark:text-neutral-900"
						onclick={() => (mobileMenuOpen = false)}
					>
						Salir
					</a>
				</div>
				<button
					type="button"
					class="absolute inset-0 z-0"
					aria-label="Cerrar menú"
					onclick={() => {
						mobileMenuOpen = false;
						showReportHelp = false;
					}}
				></button>
			</div>
		{/if}
		<div class="mx-auto hidden max-w-6xl items-center justify-between px-6 py-3 md:flex">
			<div class="flex items-center gap-3">
				<picture>
					<source srcset="/logo-mejorado.webp" type="image/webp" />
					<img
						src="/logo-mejorado.png"
						alt="Dental Suite"
						class="h-20 w-20"
						width="80"
						height="80"
						loading="eager"
						decoding="async"
					/>
				</picture>
				{#if activeBusiness?.business}
					<div class="hidden min-w-0 lg:block">
						<p class="truncate text-sm font-semibold text-neutral-900 dark:text-white">
							{activeBusiness.business.name}
						</p>
						<p class="text-xs text-neutral-500 dark:text-neutral-300">
							/{activeBusiness.business.slug} · {activeBusiness.role}
						</p>
					</div>
				{/if}
			</div>
			<nav class="flex flex-wrap items-center justify-end gap-2 text-sm font-semibold">
				<ThemeToggle />
				{#each visibleNav as item}
					<a
						href={item.href}
						class={`group rounded-full px-3 py-2 transition-all duration-200 ${
							isActive(item.href)
								? 'bg-[#7c3aed] text-white shadow-sm'
								: 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white'
						}`}
					>
						<span
							class={`inline-block transition-colors duration-200 ${
								isActive(item.href) ? 'text-white' : 'group-hover:text-[#7c3aed] dark:group-hover:text-[#c084fc]'
							}`}
						>
							{item.label}
						</span>
					</a>
				{/each}
				{#if data?.isMaster}
					<a
						href="/odonto/maestro"
						class={`group rounded-full px-3 py-2 transition-all duration-200 ${
							isActive('/odonto/maestro')
								? 'bg-[#7c3aed] text-white shadow-sm'
								: 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white'
						}`}
					>
						<span
							class={`inline-block transition-colors duration-200 ${
								isActive('/odonto/maestro')
									? 'text-white'
									: 'group-hover:text-[#7c3aed] dark:group-hover:text-[#c084fc]'
							}`}
						>
							Panel maestro
						</span>
					</a>
				{/if}
				<a
					href="/logout"
					class="group text-neutral-500 transition hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
				>
					<span class="inline-block transition-colors duration-200 group-hover:text-[#7c3aed] dark:group-hover:text-[#c084fc]">
						Salir
					</span>
				</a>
			</nav>
		</div>
	</header>

	<main class="mx-auto max-w-6xl px-4 py-6" aria-busy={showSkeleton}>
		{#if data?.businessError}
			<div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-100">
				{data.businessError}
			</div>
		{/if}
		{#if showSkeleton}
			<OdontoRouteSkeleton kind={skeletonKind} />
		{:else}
			{@render children()}
		{/if}
	</main>
</div>
