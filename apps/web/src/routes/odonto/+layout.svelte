<script lang="ts">
	import { page } from '$app/stores';
	import { navigating } from '$app/stores';
	import { onDestroy, onMount } from 'svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import OdontoRouteSkeleton from '$lib/components/skeleton/OdontoRouteSkeleton.svelte';

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
		href: string;
		activePrefixes?: string[];
	};

	const dailyNav: NavItem[] = [
		{ label: 'Agenda', href: '/odonto/agenda', activePrefixes: ['/odonto/agenda', '/odonto/turnos'] },
		{ label: 'Pacientes', href: '/odonto/pacientes', activePrefixes: ['/odonto/pacientes'] },
		{ label: 'Profesionales', href: '/odonto/profesionales', activePrefixes: ['/odonto/profesionales'] },
		{
			label: 'Configuración',
			href: '/odonto/configuracion',
			activePrefixes: ['/odonto/configuracion']
		}
	];

	const professionalNav: NavItem[] = [
		{ label: 'Mis turnos', href: '/odonto/mis-turnos', activePrefixes: ['/odonto/mis-turnos'] },
		{ label: 'Mis pacientes', href: '/odonto/pacientes', activePrefixes: ['/odonto/pacientes'] },
		{ label: 'Mi perfil', href: '/odonto/mi-perfil', activePrefixes: ['/odonto/mi-perfil'] }
	];

	const readonlyNav: NavItem[] = [
		{ label: 'Agenda', href: '/odonto/agenda', activePrefixes: ['/odonto/agenda', '/odonto/turnos'] },
		{ label: 'Pacientes', href: '/odonto/pacientes', activePrefixes: ['/odonto/pacientes'] }
	];

	const activeBusiness = $derived(data?.activeBusiness);
	const isCommercialBlocked = $derived.by(() => {
		const access = activeBusiness?.access;
		return Boolean(
			access &&
				(!access.commercialAccessEnabled ||
					access.commercialStatus === 'restricted' ||
					access.commercialStatus === 'archived')
		);
	});

	const configNav = $derived.by(() => {
		if (isCommercialBlocked) return [];
		const caps = activeBusiness?.capabilities;
		if (!caps) return [];
		return [
			caps.canConfigureBusiness ? { label: 'Negocio', href: '/odonto/configuracion/negocio' } : null,
			caps.canManageUsers ? { label: 'Roles', href: '/odonto/configuracion/usuarios' } : null,
			caps.canManageSubscription ? { label: 'Suscripción', href: '/odonto/configuracion/suscripcion' } : null,
			caps.canConfigureCommunication ? { label: 'Comunicación', href: '/odonto/configuracion/comunicacion' } : null
		].filter((item): item is NavItem => Boolean(item));
	});
	const visibleNav = $derived.by(() => {
		if (isCommercialBlocked) return [];
		if (activeBusiness?.role === 'professional') {
			return professionalNav;
		}
		if (activeBusiness?.role === 'readonly') {
			return readonlyNav;
		}
		const caps = activeBusiness?.capabilities;
		if (!caps) return dailyNav;
		return dailyNav.filter((item) => {
			if (item.label === 'Agenda') return caps.canViewAgenda || caps.canCreateAppointment;
			if (item.label === 'Pacientes') return caps.canViewBasicPatients;
			if (item.label === 'Profesionales') return caps.canConfigureProfessionals;
			if (item.label === 'Configuración') return configNav.length > 0;
			return true;
		});
	});

	const canShowConfigMenu = $derived(
		configNav.length > 0
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
		if (access.commercialStatus === 'restricted') return 'Suspendido';
		if (access.commercialStatus === 'archived') return 'Archivado';
		return null;
	});

	const accessTone = $derived.by(() => {
		const access = activeBusiness?.access;
		if (!access?.commercialAccessEnabled || access?.commercialStatus === 'restricted' || access?.commercialStatus === 'archived') {
			return 'danger';
		}
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
		if (!access || !canSeeCommercialNotice || isCommercialBlocked) return null;
		if (!access.commercialAccessEnabled) return 'La cuenta no está disponible. Contactá soporte.';
		if (access.commercialStatus === 'archived') {
			return 'La cuenta está archivada. Contactá soporte para solicitar reactivación o exportación.';
		}
		if (access.commercialStatus === 'restricted') {
			return 'La cuenta está suspendida. Regularizá la suscripción para continuar.';
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

	const blockedCommercialTitle = $derived.by(() =>
		activeBusiness?.access?.commercialStatus === 'archived'
			? 'Cuenta archivada'
			: 'Suscripción pendiente de regularización'
	);

	const blockedCommercialMessage = $derived.by(() =>
		activeBusiness?.access?.commercialStatus === 'archived'
			? 'Contactá soporte para solicitar reactivación o exportación.'
			: 'Para volver a operar el consultorio, regularizá la suscripción.'
	);

	const blockedCommercialBadge = $derived.by(() =>
		activeBusiness?.access?.commercialStatus === 'archived' ? 'Archivado' : 'Regularización pendiente'
	);

	const blockedCommercialTone = $derived.by(() =>
		activeBusiness?.access?.commercialStatus === 'archived' ? 'danger' : 'warning'
	);

	const shouldShowAccessChip = $derived.by(() => {
		if (!accessLabel || !canSeeCommercialNotice) return false;
		return activeBusiness?.access?.visualStatus !== 'active';
	});

	const isActive = (href: string) => $page.url.pathname.startsWith(href);
	const isNavItemActive = (item: NavItem) =>
		(item.activePrefixes ?? [item.href]).some((prefix) => $page.url.pathname.startsWith(prefix));

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
		if (path.startsWith('/odonto/profesionales')) return 'Profesionales';
		if (path.startsWith('/odonto/servicios')) return 'Profesionales';
		if (path.startsWith('/odonto/disponibilidad')) return 'Profesionales';
		if (path.startsWith('/odonto/recordatorios')) return 'Comunicación';
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
		if (path.startsWith('/odonto/profesionales/')) return '/odonto/profesionales';
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
		<div class="flex h-14 items-center justify-between px-4 md:hidden">
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
		<div class="mx-auto hidden max-w-7xl items-center justify-between gap-6 px-6 py-4 md:flex">
			<div class="flex min-w-0 items-center gap-3">
				<picture>
					<source srcset="/logo-mejorado.webp" type="image/webp" />
					<img
						src="/logo-mejorado.png"
						alt="Dental Suite"
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
						<source srcset="/logo-mejorado.webp" type="image/webp" />
						<img
							src="/logo-mejorado.png"
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
						<div class="rounded-xl px-4 py-3">
							<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">
								Tema
							</p>
							<ThemeToggle />
						</div>
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

	<main class="mx-auto max-w-6xl px-4 py-6" aria-busy={showSkeleton}>
		{#if isCommercialBlocked}
			<section class="mx-auto flex min-h-[55vh] w-full max-w-2xl items-center">
				<div class="ux-card w-full text-center">
					<span class={`ux-badge mx-auto ${blockedCommercialTone === 'danger' ? 'ux-badge-danger' : 'ux-badge-warning'}`}>
						{blockedCommercialBadge}
					</span>
					<h1 class="mt-5 text-3xl font-black text-white">{blockedCommercialTitle}</h1>
					<p class="mx-auto mt-3 max-w-md text-base font-bold text-white/75">
						{blockedCommercialMessage}
					</p>
					<p class={`mt-6 text-left ${blockedCommercialTone === 'danger' ? 'ux-alert' : 'ux-alert ux-alert-warning'}`}>
						Contactá soporte del sistema para regularizar el acceso.
					</p>
				</div>
			</section>
		{:else}
			{#if data?.businessError}
				<div class="ux-alert ux-alert-warning mb-4" role="status">
					{data.businessError}
				</div>
			{/if}
			{#if commercialNotice}
				<div
					class={`mb-4 ${accessTone === 'danger' ? 'ux-alert' : 'ux-alert ux-alert-warning'}`}
					role={accessTone === 'danger' ? 'alert' : 'status'}
				>
					{commercialNotice}
				</div>
			{/if}
			{#if showSkeleton}
				<OdontoRouteSkeleton kind={skeletonKind} />
			{:else}
				{@render children()}
			{/if}
		{/if}
	</main>
</div>
