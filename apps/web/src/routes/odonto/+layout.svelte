<script lang="ts">
	import { page } from '$app/stores';
	import { navigating } from '$app/stores';
	import { onDestroy, onMount } from 'svelte';
	import OdontoRouteSkeleton from '$lib/components/skeleton/OdontoRouteSkeleton.svelte';
	import FollowUpsNotice from '$lib/components/seguimientos/FollowUpsNotice.svelte';

	let { data, children } = $props();
	let mobileMenuOpen = $state(false);
	let showReportHelp = $state(false);
	let configMenuOpen = $state(false);
	let userMenuOpen = $state(false);
	let showSkeleton = $state(false);
	let shownAt = $state<number | null>(null);
	type SkeletonKind =
		| 'agenda'
		| 'agendaWeek'
		| 'appointments'
		| 'appointmentDetail'
		| 'availability'
		| 'config'
		| 'master'
		| 'patientDetail'
		| 'patients'
		| 'professionalDetail'
		| 'professionals'
		| 'services';
	let skeletonKind = $state<SkeletonKind>('patients');

	const SKELETON_DELAY_MS = 120;
	const SKELETON_MIN_VISIBLE_MS = 220;

	let showDelayTimer: ReturnType<typeof setTimeout> | null = null;
	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	type NavItem = {
		label: string;
		shortLabel?: string;
		href: string;
		activePrefixes?: string[];
		excludePrefixes?: string[];
	};

	const dailyNav: NavItem[] = [
		{ label: 'Agenda', href: '/odonto/agenda', activePrefixes: ['/odonto/agenda', '/odonto/turnos'] },
		{
			label: 'Turnos para recordar',
			shortLabel: 'Recordar',
			href: '/odonto/recordatorios',
			activePrefixes: ['/odonto/recordatorios']
		},
		{
			label: 'Seguimientos',
			shortLabel: 'Seguir',
			href: '/odonto/seguimientos',
			activePrefixes: ['/odonto/seguimientos']
		},
		{ label: 'Pacientes', href: '/odonto/pacientes', activePrefixes: ['/odonto/pacientes'] },
		{
			label: 'Configuración',
			href: '/odonto/configuracion',
			activePrefixes: ['/odonto/configuracion', '/odonto/profesionales']
		}
	];

	const professionalNav: NavItem[] = [
		{ label: 'Mis turnos', href: '/odonto/mis-turnos', activePrefixes: ['/odonto/mis-turnos'] },
		{
			label: 'Seguimientos',
			shortLabel: 'Seguir',
			href: '/odonto/seguimientos',
			activePrefixes: ['/odonto/seguimientos']
		},
		{ label: 'Pacientes', href: '/odonto/pacientes', activePrefixes: ['/odonto/pacientes'] }
	];

	const readonlyNav: NavItem[] = [
		{ label: 'Agenda', href: '/odonto/agenda', activePrefixes: ['/odonto/agenda', '/odonto/turnos'] },
		{ label: 'Pacientes', href: '/odonto/pacientes', activePrefixes: ['/odonto/pacientes'] }
	];

	const configNav: NavItem[] = [
		{ label: 'Negocio', href: '/odonto/configuracion/negocio' },
		{ label: 'Equipo', href: '/odonto/configuracion/usuarios' },
		{ label: 'Suscripción', href: '/odonto/configuracion/suscripcion' },
		{ label: 'Comunicación', href: '/odonto/configuracion/comunicacion' }
	];

	const activeBusiness = $derived(data?.activeBusiness);
	const commercialLockActive = $derived.by(() => {
		const access = activeBusiness?.access;
		if (!access) return false;
		if ($page.url.pathname.startsWith('/odonto/maestro')) return false;
		return !access.commercialAccessEnabled || access.commercialStatus === 'restricted';
	});
	const visibleNav = $derived.by(() => {
		if (commercialLockActive) return [];
		if (activeBusiness?.role === 'professional') {
			return professionalNav;
		}
		if (activeBusiness?.role === 'readonly') {
			return readonlyNav;
		}
		if (activeBusiness?.role === 'reception') {
			return dailyNav.filter((item) => item.label !== 'Configuración');
		}
		return dailyNav;
	});

	const canShowConfigMenu = $derived(
		!commercialLockActive &&
			(activeBusiness?.role === 'owner' || activeBusiness?.role === 'admin')
	);
	const primaryMobileNav = $derived.by(() =>
		visibleNav.filter((item) => item.label !== 'Configuración')
	);

	const roleLabel = $derived.by(() => {
		const role = activeBusiness?.role;
		if (role === 'owner') return 'Dueño';
		if (role === 'admin') return 'Administrador';
		if (role === 'reception') return 'Recepción';
		if (role === 'professional') return 'Profesional';
		if (role === 'readonly') return 'Lectura';
		return 'Usuario';
	});

	const accessLabel = $derived.by(() => {
		const access = activeBusiness?.access;
		if (!access) return null;
		if (!access.commercialAccessEnabled) return 'Acceso pausado';
		if (access.visualStatus === 'permanent') return 'Permanente';
		if (access.visualStatus === 'expiring') return 'Vence mañana';
		if (access.commercialStatus === 'grace') return 'Vencido';
		if (access.commercialStatus === 'restricted') return 'Regularizar';
		if (access.commercialStatus === 'archived') return 'Archivado';
		return null;
	});

	const accessTone = $derived.by(() => {
		const access = activeBusiness?.access;
		if (access?.commercialStatus === 'archived') {
			return 'danger';
		}
		if (!access?.commercialAccessEnabled || access?.commercialStatus === 'restricted') return 'warning';
		if (access?.commercialStatus === 'grace' || access?.visualStatus === 'expiring') return 'warning';
		return 'neutral';
	});

	const canSeeCommercialNotice = $derived.by(() => {
		const role = activeBusiness?.role;
		const access = activeBusiness?.access;
		if (!access) return false;
		if (access.commercialStatus === 'restricted' || access.commercialStatus === 'archived') return true;
		return role === 'owner' || role === 'admin';
	});

	const commercialNotice = $derived.by(() => {
		const access = activeBusiness?.access;
		if (!access || !canSeeCommercialNotice) return null;
		if (!access.commercialAccessEnabled) return 'La cuenta no está disponible. Contactá soporte.';
		if (access.commercialStatus === 'archived') {
			return 'La cuenta está archivada. Contactá soporte para solicitar reactivación o exportación.';
		}
		if (access.commercialStatus === 'restricted') {
			return 'Suscripción pendiente de regularización. Para volver a operar el consultorio, regularizá la suscripción.';
		}
		if (access.commercialStatus === 'grace') {
			return access.graceUntil
				? `La suscripción está vencida. Regularizá el pago antes del ${new Date(access.graceUntil).toLocaleString('es-AR')} para evitar restricciones operativas.`
				: 'La suscripción está vencida. Regularizá el pago para evitar restricciones operativas.';
		}
		if (access.visualStatus === 'expiring') {
			return 'La suscripción vence mañana. Regularizá el pago para evitar restricciones operativas.';
		}
		return null;
	});

	const shouldShowAccessChip = $derived.by(() => {
		if (!accessLabel || !canSeeCommercialNotice) return false;
		return activeBusiness?.access?.visualStatus !== 'active';
	});

	const isActive = (href: string) => $page.url.pathname.startsWith(href);
	const isNavItemActive = (item: NavItem) =>
		(item.activePrefixes ?? [item.href]).some((prefix) => $page.url.pathname.startsWith(prefix)) &&
		!(item.excludePrefixes ?? []).some((prefix) => $page.url.pathname.startsWith(prefix));

	const closeMenus = () => {
		configMenuOpen = false;
		userMenuOpen = false;
	};

	onMount(() => {
		const handleOutsideClick = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (target.closest('[data-menu-root]')) return;
			closeMenus();
		};

		document.addEventListener('pointerdown', handleOutsideClick, true);
		return () => document.removeEventListener('pointerdown', handleOutsideClick, true);
	});

	const mobileTitle = $derived.by(() => {
		const path = $page.url.pathname;
		if (path.startsWith('/odonto/pacientes/') && $page.data?.patient?.full_name) {
			return $page.data.patient.full_name;
		}
		if (path.startsWith('/odonto/agenda')) return 'Agenda';
		if (path.startsWith('/odonto/pacientes')) return 'Pacientes';
		if (path.startsWith('/odonto/configuracion/usuarios')) return 'Equipo';
		if (path.startsWith('/odonto/profesionales')) return 'Equipo';
		if (path.startsWith('/odonto/servicios')) return 'Equipo';
		if (path.startsWith('/odonto/disponibilidad')) return 'Equipo';
		if (path.startsWith('/odonto/seguimientos')) return 'Seguimientos';
		if (path.startsWith('/odonto/recordatorios')) return 'Turnos para recordar';
		if (path.startsWith('/odonto/mensajes')) return 'Comunicación';
		if (path.startsWith('/odonto/mis-turnos')) return 'Mis turnos';
		if (path.startsWith('/odonto/configuracion')) return 'Configuración';
		if (path.startsWith('/odonto/maestro')) return 'Panel maestro';
		return 'Odontología';
	});

	const showBack = $derived.by(() => {
		const path = $page.url.pathname;
		return path !== '/odonto/pacientes' && path.startsWith('/odonto');
	});
	const mobileBackHref = $derived.by(() => {
		const path = $page.url.pathname;
		if (path.startsWith('/odonto/turnos/')) return '/odonto/agenda';
		if (path.startsWith('/odonto/agenda/semana')) return '/odonto/agenda';
		if (path.startsWith('/odonto/pacientes/')) return '/odonto/pacientes';
		if (path.startsWith('/odonto/seguimientos/importantes')) return '/odonto/seguimientos';
		if (path.startsWith('/odonto/profesionales/')) return '/odonto/configuracion/usuarios';
		if (path.startsWith('/odonto/configuracion/usuarios')) return '/odonto/agenda';
		if (path.startsWith('/odonto/configuracion/')) return '/odonto/configuracion';
		if (path.startsWith('/odonto/maestro')) return '/odonto/agenda';
		if (path.startsWith('/odonto/mis-turnos')) return '/odonto/agenda';
		return '/odonto/agenda';
	});

	const resolveSkeletonKind = (routeId: string | null | undefined, path: string) => {
		if (routeId === '/odonto/agenda/semana') return 'agendaWeek';
		if (routeId === '/odonto/agenda') return 'agenda';
		if (routeId === '/odonto/turnos/[appointmentId]') return 'appointmentDetail';
		if (routeId === '/odonto/mis-turnos') return 'appointments';
		if (routeId === '/odonto/seguimientos') return 'config';
		if (routeId === '/odonto/seguimientos/importantes') return 'config';
		if (routeId === '/odonto/recordatorios') return 'config';
		if (routeId === '/odonto/mensajes') return 'config';
		if (routeId === '/odonto/disponibilidad') return 'professionals';
		if (routeId === '/odonto/servicios') return 'professionals';
		if (routeId === '/odonto/profesionales/[professionalId]') return 'professionalDetail';
		if (routeId === '/odonto/profesionales') return 'professionals';
		if (routeId === '/odonto/pacientes/[id]') return 'patientDetail';
		if (routeId === '/odonto/configuracion') return 'config';
		if (routeId === '/odonto/maestro') return 'master';
		if (routeId === '/odonto/pacientes') return 'patients';
		if (path.startsWith('/odonto/agenda/semana')) return 'agendaWeek';
		if (path.startsWith('/odonto/agenda')) return 'agenda';
		if (path.startsWith('/odonto/turnos/')) return 'appointmentDetail';
		if (path.startsWith('/odonto/mis-turnos')) return 'appointments';
		if (path.startsWith('/odonto/seguimientos')) return 'config';
		if (path.startsWith('/odonto/recordatorios')) return 'config';
		if (path.startsWith('/odonto/mensajes')) return 'config';
		if (path.startsWith('/odonto/disponibilidad')) return 'professionals';
		if (path.startsWith('/odonto/servicios')) return 'professionals';
		if (path.startsWith('/odonto/profesionales/')) return 'professionalDetail';
		if (path.startsWith('/odonto/profesionales')) return 'professionals';
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

	const scheduleShowSkeleton = (kind: SkeletonKind) => {
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
		<div class="flex h-14 items-center gap-3 px-4 md:hidden">
			{#if showBack}
				<a
					href={mobileBackHref}
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
		</div>
		{#if mobileMenuOpen}
			<div class="fixed inset-0 z-40 flex items-start justify-center bg-black/60 px-4 py-6 md:hidden">
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
									Consultorio activo
								</p>
								<p class="mt-1 font-semibold text-neutral-900 dark:text-white">
									{activeBusiness.business.name}
								</p>
							</div>
						{/if}
						<p class="mt-2 px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">
							Trabajo diario
						</p>
						{#each primaryMobileNav as item}
							<a
								href={item.href}
								class={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
									isNavItemActive(item)
										? 'bg-[#7c3aed] text-white'
										: 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/10'
								}`}
								onclick={() => {
									mobileMenuOpen = false;
									closeMenus();
								}}
							>
								{item.label}
							</a>
						{/each}
						{#if canShowConfigMenu}
							<p class="mt-4 px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">
								Configuración
							</p>
							{#each configNav as item}
								<a
									href={item.href}
									class={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
										isNavItemActive(item)
											? 'bg-[#7c3aed] text-white'
											: 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/10'
									}`}
									onclick={() => {
										mobileMenuOpen = false;
										closeMenus();
									}}
								>
									{item.label}
								</a>
							{/each}
						{/if}
						<p class="mt-4 px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">
							Cuenta
						</p>
						{#if activeBusiness?.role !== 'professional'}
							<a
								href="/odonto/mis-turnos"
								class={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
									isActive('/odonto/mis-turnos')
										? 'bg-[#7c3aed] text-white'
										: 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/10'
								}`}
								onclick={() => {
									mobileMenuOpen = false;
									closeMenus();
								}}
							>
								Mis turnos
							</a>
						{/if}
						{#if data?.isMaster}
							<a
								href="/odonto/maestro"
								class={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
									isActive('/odonto/maestro')
										? 'bg-[#7c3aed] text-white'
										: 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/10'
								}`}
								onclick={() => {
									mobileMenuOpen = false;
									closeMenus();
								}}
							>
								Panel maestro
							</a>
						{/if}
					</nav>
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
		<div class="mx-auto hidden max-w-7xl items-center justify-between gap-6 px-6 py-4 md:flex">
			<div class="flex min-w-0 items-center gap-3">
				<picture>
					<img
						src="/logo-cita-suite.png"
						alt="Cita Suite"
						class="h-14 w-14 shrink-0 rounded-2xl"
						width="56"
						height="56"
						loading="eager"
						decoding="async"
					/>
				</picture>
				{#if activeBusiness?.business}
					<div class="min-w-0">
						<p class="truncate text-sm font-semibold text-neutral-900 dark:text-white">
							{activeBusiness.business.name}
						</p>
					</div>
				{/if}
			</div>
			<nav class="flex min-w-0 flex-1 items-center justify-center gap-2 text-sm font-semibold">
				{#each visibleNav as item}
					{#if item.label === 'Configuración' && canShowConfigMenu}
							<div class="relative" data-menu-root>
							<button
								type="button"
								class={`group rounded-2xl px-4 py-3 transition-all duration-200 ${
									isNavItemActive(item)
										? 'bg-[#7c3aed]/90 text-white shadow-sm shadow-[#7c3aed]/20'
										: 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white'
								}`}
								aria-haspopup="menu"
								aria-expanded={configMenuOpen}
								onclick={() => {
									configMenuOpen = !configMenuOpen;
									userMenuOpen = false;
								}}
							>
								<span
									class={`inline-block transition-colors duration-200 ${
										isNavItemActive(item)
											? 'text-white'
											: 'group-hover:text-[#7c3aed] dark:group-hover:text-[#c084fc]'
									}`}
								>
									{item.label}
								</span>
							</button>
							{#if configMenuOpen}
								<div
									class="absolute left-1/2 top-full z-30 mt-3 w-64 -translate-x-1/2 rounded-2xl border border-neutral-200 bg-white p-2 shadow-2xl shadow-black/10 dark:border-white/10 dark:bg-[#101f35] dark:shadow-black/40"
									role="menu"
								>
									{#each configNav as configItem}
										<a
											href={configItem.href}
											class={`block rounded-xl px-4 py-3 text-sm font-semibold transition ${
												isNavItemActive(configItem)
													? 'bg-[#7c3aed] text-white'
													: 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-200 dark:hover:bg-white/10 dark:hover:text-white'
											}`}
											role="menuitem"
											onclick={closeMenus}
										>
											{configItem.label}
										</a>
									{/each}
								</div>
							{/if}
						</div>
					{:else}
						<a
							href={item.href}
							class={`group rounded-2xl px-4 py-3 transition-all duration-200 ${
								isNavItemActive(item)
									? 'bg-[#7c3aed]/90 text-white shadow-sm shadow-[#7c3aed]/20'
									: 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white'
							}`}
						>
							<span
								class={`inline-block transition-colors duration-200 ${
									isNavItemActive(item)
										? 'text-white'
										: 'group-hover:text-[#7c3aed] dark:group-hover:text-[#c084fc]'
								}`}
							>
								{item.label}
							</span>
						</a>
					{/if}
				{/each}
			</nav>
				<div class="relative flex min-w-0 justify-end" data-menu-root>
				<button
					type="button"
					class="flex max-w-64 items-center gap-3 rounded-2xl border border-neutral-200 bg-white/70 px-3 py-2 text-left shadow-sm transition hover:border-[#7c3aed]/40 hover:bg-white dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.07]"
					aria-haspopup="menu"
					aria-expanded={userMenuOpen}
					onclick={() => {
						userMenuOpen = !userMenuOpen;
						configMenuOpen = false;
					}}
				>
					<picture>
						<img
							src="/logo-cita-suite.png"
							alt=""
							class="h-10 w-10 shrink-0 rounded-xl"
							width="40"
							height="40"
							loading="eager"
							decoding="async"
						/>
					</picture>
						<span class="min-w-0">
							<span class="block truncate text-sm font-semibold text-neutral-900 dark:text-white">
								{activeBusiness?.business?.name ?? 'Cuenta'}
							</span>
						<span class="flex items-center gap-2 truncate text-xs text-neutral-500 dark:text-neutral-300">
							<span>{roleLabel}</span>
							{#if shouldShowAccessChip}
								<span
									class={`rounded-full px-2 py-0.5 text-[10px] font-black ${
										accessTone === 'danger'
											? 'bg-red-500/15 text-red-200'
											: accessTone === 'warning'
												? 'bg-amber-400/15 text-amber-100'
												: 'bg-white/10 text-white/70'
									}`}
								>
									{accessLabel}
								</span>
							{/if}
						</span>
						</span>
					<svg class="h-4 w-4 shrink-0 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
					</svg>
				</button>
				{#if userMenuOpen}
					<div
						class="absolute right-0 top-full z-30 mt-3 w-64 rounded-2xl border border-neutral-200 bg-white p-2 shadow-2xl shadow-black/10 dark:border-white/10 dark:bg-[#101f35] dark:shadow-black/40"
						role="menu"
					>
						{#if activeBusiness?.role !== 'professional'}
							<a
								href="/odonto/mis-turnos"
								class={`block rounded-xl px-4 py-3 text-sm font-semibold transition ${
									isActive('/odonto/mis-turnos')
										? 'bg-[#7c3aed] text-white'
										: 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-200 dark:hover:bg-white/10 dark:hover:text-white'
								}`}
								role="menuitem"
								onclick={closeMenus}
							>
								Mis turnos
							</a>
						{/if}
						{#if data?.isMaster}
							<a
								href="/odonto/maestro"
								class={`block rounded-xl px-4 py-3 text-sm font-semibold transition ${
									isActive('/odonto/maestro')
										? 'bg-[#7c3aed] text-white'
										: 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-200 dark:hover:bg-white/10 dark:hover:text-white'
								}`}
								role="menuitem"
								onclick={closeMenus}
							>
								Panel maestro
							</a>
						{/if}
						<div class="my-2 border-t border-neutral-200 dark:border-white/10"></div>
						<a
							href="/logout"
							class="block rounded-xl px-4 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 dark:text-red-200 dark:hover:bg-red-500/10"
							role="menuitem"
							onclick={closeMenus}
						>
							Salir
						</a>
					</div>
				{/if}
			</div>
		</div>
	</header>

	<main class="mx-auto max-w-6xl px-4 pt-6 pb-28 md:pb-6" aria-busy={showSkeleton}>
		{#if data?.businessError}
			<div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-100">
				{data.businessError}
			</div>
		{/if}
		{#if commercialNotice && !commercialLockActive}
			<div
				class={`mb-4 rounded-2xl border px-4 py-3 text-sm font-bold ${
					accessTone === 'danger'
						? 'border-red-300 bg-red-50 text-red-900 dark:border-red-300/60 dark:bg-red-200 dark:text-red-950'
						: 'border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-200/70 dark:bg-amber-200 dark:text-amber-950'
				}`}
			>
				{commercialNotice}
			</div>
		{/if}
		{#if !commercialLockActive && data?.followUps?.count > 0}
			<FollowUpsNotice notice={data.followUps} todayISO={data.followUpsTodayISO} />
		{/if}
		{#if commercialLockActive}
			<section class="mx-auto mt-8 max-w-2xl rounded-3xl border border-amber-300/40 bg-amber-400/12 p-8 text-center shadow-2xl shadow-amber-950/10 dark:border-amber-400/25 dark:bg-amber-400/10">
				<p class="mx-auto inline-flex rounded-full bg-amber-400/15 px-3 py-1 text-xs font-black uppercase tracking-wide text-amber-900 dark:text-amber-100">
					Regularización
				</p>
				<h1 class="mt-5 text-3xl font-black text-neutral-950 dark:text-white">
					Suscripción pendiente de regularización
				</h1>
				<p class="mx-auto mt-3 max-w-lg text-base font-semibold text-neutral-700 dark:text-amber-50/80">
					Para volver a operar el consultorio, regularizá la suscripción.
				</p>
				<p class="mt-6 rounded-2xl border border-amber-300/35 bg-white/70 px-4 py-3 text-sm font-bold text-amber-950 dark:bg-[#13243d]/70 dark:text-amber-100">
					Contactá soporte del sistema.
				</p>
			</section>
		{:else if showSkeleton}
			<OdontoRouteSkeleton kind={skeletonKind} />
		{:else}
			{@render children()}
		{/if}
	</main>

	{#snippet navIcon(label: string)}
		<svg class="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
			{#if label === 'Agenda'}
				<rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
				<path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
			{:else if label === 'Pacientes'}
				<circle cx="9" cy="8" r="3.1" />
				<path d="M3.8 19v-1.3A3.7 3.7 0 0 1 7.5 14h3a3.7 3.7 0 0 1 3.7 3.7V19" />
				<path d="M16 5.3a3 3 0 0 1 0 5.8M20.2 19v-1.3a3.5 3.5 0 0 0-2.6-3.3" />
			{:else if label === 'Equipo'}
				<rect x="4.5" y="3.5" width="15" height="17" rx="2.5" />
				<circle cx="12" cy="9.8" r="2.4" />
				<path d="M8.2 16.6a3.8 3.8 0 0 1 7.6 0" />
			{:else if label === 'Mis turnos'}
				<rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
				<path d="M3.5 9.5h17M8 3.5v3M16 3.5v3M9 14.7l2 2 4-4" />
			{:else if label === 'Turnos para recordar'}
				<path d="M18 8.5a6 6 0 0 0-12 0c0 6-2.5 8-2.5 8h17s-2.5-2-2.5-8" />
				<path d="M13.7 20.5a2 2 0 0 1-3.4 0" />
			{:else if label === 'Seguimientos'}
				<rect x="4.5" y="4.5" width="15" height="16" rx="2.5" />
				<path d="M9 4.5h6v2.5H9z" />
				<path d="M8.5 12.5l2.2 2.2 4.8-4.8" />
			{:else}
				<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
				<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
				<circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
			{/if}
		</svg>
	{/snippet}

	{#if !commercialLockActive && primaryMobileNav.length > 0}
		<nav
			class="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#0b1d32]/95 backdrop-blur md:hidden"
			style="padding-bottom: env(safe-area-inset-bottom);"
			aria-label="Navegación principal"
		>
			<div class="mx-auto flex max-w-md items-stretch">
				{#each primaryMobileNav as item}
					<a
						href={item.href}
						aria-current={isNavItemActive(item) ? 'page' : undefined}
						class={`flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-bold transition ${
							isNavItemActive(item) ? 'text-white' : 'text-white/50'
						}`}
					>
						<span
							class={`flex h-8 w-14 items-center justify-center rounded-full transition ${
								isNavItemActive(item) ? 'bg-[#7c3aed] text-white shadow-lg shadow-[#7c3aed]/30' : ''
							}`}
						>
							{@render navIcon(item.label)}
						</span>
						{item.shortLabel ?? item.label}
					</a>
				{/each}
				<button
					type="button"
					onclick={() => (mobileMenuOpen = true)}
					class="flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-bold text-white/50 transition"
				>
					<span class="flex h-8 w-14 items-center justify-center rounded-full">
						{@render navIcon('mas')}
					</span>
					Más
				</button>
			</div>
		</nav>
	{/if}
</div>
