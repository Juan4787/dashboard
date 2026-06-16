<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import BackLink from '$lib/components/BackLink.svelte';
	import { clearTtlDraft, loadTtlDraft, saveTtlDraft } from '$lib/client/ttl-draft';
	import { formatDateTime } from '$lib/utils/format';
	import { formatPriceLabel } from '$lib/utils/money-input';
	import { formatTimeRanges, normalizeTimeRangesInput, parseTimeRanges } from '$lib/utils/time-ranges';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { onMount } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';

	const weekdays = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
	const tabs = [
		{ id: 'perfil', label: 'Perfil' },
		{ id: 'servicios', label: 'Servicios' },
		{ id: 'horarios', label: 'Horarios' }
	] as const;

	type TabId = (typeof tabs)[number]['id'];
	type Service = {
		id: string;
		name: string;
		duration_minutes: number;
		price_label: string | null;
		is_active: boolean;
		is_public: boolean;
	};
	type Rule = {
		id: string;
		weekday: number;
		start_time: string;
		end_time: string;
		slot_interval_minutes: number;
		is_active: boolean;
		created_at: string | null;
	};
	type Exception = {
		id: string;
		professional_id: string | null;
		starts_at: string;
		ends_at: string;
		type: 'blocked' | 'extra_available';
		reason: string | null;
	};
	type ProfessionalDraft = {
		name: string;
		specialty: string;
		phone: string;
		email: string;
		isAvailable: boolean;
		serviceIds: string[];
		schedule: {
			weekdays: number[];
			timeRanges: string;
			slotInterval: string;
		};
		exception: {
			appliesTo: 'professional' | 'business';
			type: 'blocked' | 'extra_available';
			date: string;
			timeRange: string;
			reason: string;
		};
	};
	type DirtyFields = {
		name: boolean;
		specialty: boolean;
		phone: boolean;
		email: boolean;
		profilePublic: boolean;
		services: boolean;
		schedule: boolean;
		exception: boolean;
	};
	type PageData = {
		context: {
			business: { id: string };
			canOperate: boolean;
			canManage: boolean;
		};
		professional: {
			id: string;
			name: string;
			specialty: string | null;
			phone: string | null;
			email: string | null;
			is_active: boolean;
			is_public: boolean;
		} | null;
		services: Service[];
		assignedServiceIds: string[];
		defaultServiceIds: string[];
		rules: Rule[];
		exceptions: Exception[];
		appointmentCount: number;
		clinicalEntryCount: number;
		tab: string;
		userId: string | null;
		demo: boolean;
	};

	let { data, form } = $props<{
		data: PageData;
		form?: { success?: boolean; message?: string };
	}>();

	const cloneDraft = (value: ProfessionalDraft): ProfessionalDraft => JSON.parse(JSON.stringify(value));
	const normalizedText = (value: string) => value.trim();
	const uniqueSortedNumbers = (items: number[]) => [...new Set(items)].sort((a, b) => a - b);
	const uniqueSortedStrings = (items: string[]) => [...new Set(items)].sort((a, b) => a.localeCompare(b));
	const sameStringList = (left: string[], right: string[]) =>
		uniqueSortedStrings(left).join('|') === uniqueSortedStrings(right).join('|');
	const sameNumberList = (left: number[], right: number[]) =>
		uniqueSortedNumbers(left).join('|') === uniqueSortedNumbers(right).join('|');

	const emptyExceptionDraft = (): ProfessionalDraft['exception'] => ({
		appliesTo: 'professional',
		type: 'blocked',
		date: '',
		timeRange: '',
		reason: ''
	});

	const scheduleFromRules = (rules: Rule[]): ProfessionalDraft['schedule'] => {
		if (rules.length === 0) {
			return { weekdays: [1, 2, 3, 4, 5], timeRanges: '', slotInterval: '15' };
		}

		const latestCreatedAt = rules.reduce((latest, rule) => {
			if (!rule.created_at) return latest;
			return !latest || rule.created_at > latest ? rule.created_at : latest;
		}, '');
		const latestRules = latestCreatedAt ? rules.filter((rule) => rule.created_at === latestCreatedAt) : rules;
		const ranges = [
			...new Map(
				latestRules.map((rule) => [
					`${rule.start_time.slice(0, 5)}-${rule.end_time.slice(0, 5)}`,
					{ start: rule.start_time.slice(0, 5), end: rule.end_time.slice(0, 5) }
				])
			).values()
		];
		const intervalCounts = new Map<number, number>();
		for (const rule of latestRules) {
			intervalCounts.set(rule.slot_interval_minutes, (intervalCounts.get(rule.slot_interval_minutes) ?? 0) + 1);
		}
		const [mostUsedInterval] = [...intervalCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] ?? [15];

		return {
			weekdays: uniqueSortedNumbers(latestRules.map((rule) => rule.weekday)),
			timeRanges: formatTimeRanges(ranges),
			slotInterval: String(mostUsedInterval)
		};
	};

	const buildServerDraft = (source: PageData): ProfessionalDraft => ({
		name: source.professional?.name ?? '',
		specialty: source.professional?.specialty ?? '',
		phone: source.professional?.phone ?? '',
		email: source.professional?.email ?? '',
		isAvailable: Boolean(source.professional?.is_active && source.professional?.is_public),
		serviceIds: [...(source.assignedServiceIds ?? [])],
		schedule: scheduleFromRules(source.rules as Rule[]),
		exception: emptyExceptionDraft()
	});

	const sanitizeDraft = (value: Partial<ProfessionalDraft> | null, fallback: ProfessionalDraft): ProfessionalDraft => ({
		name: typeof value?.name === 'string' ? value.name : fallback.name,
		specialty: typeof value?.specialty === 'string' ? value.specialty : fallback.specialty,
		phone: typeof value?.phone === 'string' ? value.phone : fallback.phone,
		email: typeof value?.email === 'string' ? value.email : fallback.email,
		isAvailable: typeof value?.isAvailable === 'boolean' ? value.isAvailable : fallback.isAvailable,
		serviceIds: Array.isArray(value?.serviceIds) ? value.serviceIds.map(String) : fallback.serviceIds,
		schedule: {
			weekdays: Array.isArray(value?.schedule?.weekdays)
				? value.schedule.weekdays.map(Number).filter((item) => Number.isInteger(item) && item >= 0 && item <= 6)
				: fallback.schedule.weekdays,
			timeRanges: typeof value?.schedule?.timeRanges === 'string' ? value.schedule.timeRanges : fallback.schedule.timeRanges,
			slotInterval: typeof value?.schedule?.slotInterval === 'string' ? value.schedule.slotInterval : fallback.schedule.slotInterval
		},
		exception: {
			appliesTo: value?.exception?.appliesTo === 'business' ? 'business' : 'professional',
			type: value?.exception?.type === 'extra_available' ? 'extra_available' : 'blocked',
			date: typeof value?.exception?.date === 'string' ? value.exception.date : fallback.exception.date,
			timeRange: typeof value?.exception?.timeRange === 'string' ? value.exception.timeRange : fallback.exception.timeRange,
			reason: typeof value?.exception?.reason === 'string' ? value.exception.reason : fallback.exception.reason
		}
	});

	const canonicalTimeRanges = (value: string) => {
		const parsed = parseTimeRanges(value);
		return parsed ? formatTimeRanges(parsed) : normalizedText(value);
	};

	const hasValidSchedule = (schedule: ProfessionalDraft['schedule']) => {
		const interval = Number(schedule.slotInterval);
		const parsedRanges = parseTimeRanges(schedule.timeRanges);
		return (
			uniqueSortedNumbers(schedule.weekdays).length > 0 &&
			Boolean(parsedRanges && parsedRanges.length > 0) &&
			Number.isInteger(interval) &&
			interval >= 5 &&
			interval <= 120
		);
	};

	const hasExceptionDraft = (exception: ProfessionalDraft['exception']) =>
		Boolean(exception.date.trim() || exception.timeRange.trim() || exception.reason.trim());

	const canOperate = $derived(data.context.canOperate && !data.demo);
	const canManage = $derived(data.context.canManage && !data.demo);
	const defaultServiceIdSet = $derived(new Set(data.defaultServiceIds ?? []));
	const professional = $derived(data.professional);
	const appointmentCount = $derived(data.appointmentCount ?? 0);
	const clinicalEntryCount = $derived(data.clinicalEntryCount ?? 0);
	const canDelete = $derived(appointmentCount === 0 && clinicalEntryCount === 0);
	let showDeleteConfirm = $state(false);
	const businessId = $derived(data.context.business?.id ?? 'sin-consultorio');
	const userId = $derived(data.userId ?? 'sin-usuario');
	const professionalId = $derived(data.professional?.id ?? 'nuevo');
	const draftStorageKey = $derived(`cita-suite:draft:professional-profile:${businessId}:${userId}:${professionalId}`);

	// svelte-ignore state_referenced_locally
	let baseline = $state<ProfessionalDraft>(buildServerDraft(data));
	// svelte-ignore state_referenced_locally
	let draft = $state<ProfessionalDraft>(cloneDraft(baseline));
	let draftReady = $state(false);
	let draftRestored = $state(false);
	// svelte-ignore state_referenced_locally
	let activeTab = $state<TabId>(tabs.some((tab) => tab.id === data.tab) ? (data.tab as TabId) : 'perfil');
	let showNewService = $state(false);
	let saving = $state<'profile' | 'services' | 'schedule' | 'exception' | 'all' | 'service-create' | null>(null);
	let showExitGuard = $state(false);
	let pendingNavigationHref = $state<string | null>(null);
	let guardError = $state('');
	let saveAllForm = $state<HTMLFormElement | null>(null);
	let allowNavigation = false;

	$effect(() => {
		if (data.services.length === 0) showNewService = true;
	});

	const calculateDirtyFields = (current: ProfessionalDraft, saved: ProfessionalDraft): DirtyFields => {
		const editableCurrentServices = current.serviceIds.filter((id) => !defaultServiceIdSet.has(id));
		const editableSavedServices = saved.serviceIds.filter((id) => !defaultServiceIdSet.has(id));
		return {
			name: normalizedText(current.name) !== normalizedText(saved.name),
			specialty: normalizedText(current.specialty) !== normalizedText(saved.specialty),
			phone: normalizedText(current.phone) !== normalizedText(saved.phone),
			email: normalizedText(current.email).toLowerCase() !== normalizedText(saved.email).toLowerCase(),
			profilePublic: current.isAvailable !== saved.isAvailable,
			services: !sameStringList(editableCurrentServices, editableSavedServices),
			schedule:
				!sameNumberList(current.schedule.weekdays, saved.schedule.weekdays) ||
				canonicalTimeRanges(current.schedule.timeRanges) !== canonicalTimeRanges(saved.schedule.timeRanges) ||
				String(Number(current.schedule.slotInterval || 15)) !== String(Number(saved.schedule.slotInterval || 15)),
			exception: hasExceptionDraft(current.exception)
		};
	};
	const dirtyFields = $derived.by(() => calculateDirtyFields(draft, baseline));
	const hasUnsavedChanges = $derived.by(() => Object.values(dirtyFields).some(Boolean));
	const dirtyItems = $derived.by(() => {
		const items: string[] = [];
		if (dirtyFields.name) items.push('Nombre');
		if (dirtyFields.email) items.push('Email');
		if (dirtyFields.specialty) items.push('Especialidad');
		if (dirtyFields.phone) items.push('Teléfono');
		if (dirtyFields.profilePublic) items.push('Perfil público');
		if (dirtyFields.services) items.push('Servicios');
		if (dirtyFields.schedule) items.push('Horarios');
		if (dirtyFields.exception) items.push('Disponibilidad');
		return items;
	});
	const missingItems = $derived.by(() => {
		const items: string[] = [];
		if (!draft.name.trim()) items.push('Nombre visible');
		if (!hasValidSchedule(draft.schedule)) items.push('Horarios de atención');
		return items;
	});
	const hasMissingMinimum = $derived.by(() => missingItems.length > 0);
	const visibleName = $derived.by(() => draft.name.trim() || professional?.name || 'Profesional');
	const visibleSubtitle = $derived.by(() => draft.specialty.trim() || 'Definí qué atiende y cuándo.');
	const missingSummary = $derived.by(() => missingItems.join(', '));
	const isVisibleInBooking = $derived.by(() => draft.isAvailable && !hasMissingMinimum);
	const bookingStatusLabel = $derived.by(() => (isVisibleInBooking ? 'Visible en reservas' : 'No visible en reservas'));
	const bookingStatusClass = $derived.by(() =>
		isVisibleInBooking ? 'ux-badge ux-badge-success' : hasMissingMinimum ? 'ux-badge ux-badge-danger' : 'ux-badge'
	);
	const showSaveAllAction = $derived.by(() => hasUnsavedChanges);
	const shouldSaveProfile = $derived.by(() =>
		Boolean(dirtyFields.name || dirtyFields.specialty || dirtyFields.phone || dirtyFields.email || dirtyFields.profilePublic)
	);
	const tabStates = $derived.by(
		() =>
			({
				perfil: { dirty: shouldSaveProfile, missing: missingItems.includes('Nombre visible') },
				servicios: { dirty: dirtyFields.services, missing: false },
				horarios: {
					dirty: Boolean(dirtyFields.schedule || dirtyFields.exception),
					missing: missingItems.includes('Horarios de atención')
				}
			}) satisfies Record<TabId, { dirty: boolean; missing: boolean }>
	);
	const serviceDelta = $derived.by(() => {
		const current = new Set(draft.serviceIds.filter((id) => !defaultServiceIdSet.has(id)));
		const saved = new Set(baseline.serviceIds.filter((id) => !defaultServiceIdSet.has(id)));
		const added = [...current].filter((id) => !saved.has(id));
		const removed = [...saved].filter((id) => !current.has(id));
		return { added, removed, count: added.length + removed.length };
	});
	const serviceChangeSummary = $derived.by(() =>
		serviceDelta.count === 1 ? '1 cambio sin guardar' : `${serviceDelta.count} cambios sin guardar`
	);
	const weeklyPreview = $derived(parseTimeRanges(draft.schedule.timeRanges) ?? []);
	const guardTitle = $derived.by(() => {
		if (hasUnsavedChanges && hasMissingMinimum) return 'Tenés cambios sin guardar y datos pendientes';
		if (hasUnsavedChanges) return 'Tenés cambios sin guardar';
		return 'Faltan datos para recibir turnos';
	});

	const toggleService = (serviceId: string) => {
		draft.serviceIds = draft.serviceIds.includes(serviceId)
			? draft.serviceIds.filter((id) => id !== serviceId)
			: [...draft.serviceIds, serviceId];
	};

	const toggleWeekday = (weekday: number) => {
		draft.schedule.weekdays = draft.schedule.weekdays.includes(weekday)
			? draft.schedule.weekdays.filter((item) => item !== weekday)
			: [...draft.schedule.weekdays, weekday].sort((a, b) => a - b);
	};

	const setWeekdays = (items: number[]) => {
		draft.schedule.weekdays = items;
	};

	const rulesByWeekday = $derived.by(() =>
		weekdays.map((day, weekday) => ({
			day,
			weekday,
			rules: (data.rules as Rule[]).filter((rule) => rule.weekday === weekday)
		}))
	);

	const exceptionTarget = (item: Exception) =>
		item.professional_id ? professional?.name ?? 'Profesional' : 'Todo el consultorio';

	const durationLabel = (minutes: number) => `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
	const handlePriceInput = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		input.value = formatPriceLabel(input.value);
	};

	const normalizeScheduleInput = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		input.value = normalizeTimeRangesInput(input.value);
		draft.schedule.timeRanges = input.value;
	};

	const handleScheduleTyping = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		const digits = input.value.replace(/\D/g, '');
		if (/^[\d\s]+$/.test(input.value) && digits.length >= 8 && digits.length % 8 === 0) {
			input.value = normalizeTimeRangesInput(input.value);
			draft.schedule.timeRanges = input.value;
		}
	};

	const normalizeScheduleBeforeSubmit = (event: SubmitEvent) => {
		const form = event.currentTarget as HTMLFormElement;
		const input = form.elements.namedItem('time_ranges') as HTMLInputElement | null;
		if (input) {
			input.value = normalizeTimeRangesInput(input.value);
			draft.schedule.timeRanges = input.value;
		}
	};

	const normalizeExceptionDate = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		const value = input.value.trim();
		const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
		if (match) {
			draft.exception.date = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
			return;
		}
		draft.exception.date = value;
	};
	const normalizeExceptionTime = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		draft.exception.timeRange = normalizeTimeRangesInput(input.value);
	};

	const fieldStateClass = (dirty: boolean, missing = false) =>
		missing ? 'ux-state-required' : dirty ? 'ux-state-unsaved' : '';
	const sectionStateClass = fieldStateClass;
	const serviceRowStateClass = (serviceId: string) => {
		if (serviceDelta.added.includes(serviceId)) return 'ux-choice-pending';
		if (serviceDelta.removed.includes(serviceId)) return 'ux-choice-removed';
		return '';
	};
	const resetExceptionDraft = () => {
		draft.exception = emptyExceptionDraft();
	};
	const markSaved = (section: 'profile' | 'services' | 'schedule' | 'exception' | 'all') => {
		if (section === 'all') {
			baseline = cloneDraft(draft);
			resetExceptionDraft();
			baseline.exception = emptyExceptionDraft();
			clearTtlDraft(draftStorageKey);
			draftRestored = false;
			return;
		}
		if (section === 'profile') {
			baseline.name = draft.name;
			baseline.specialty = draft.specialty;
			baseline.phone = draft.phone;
			baseline.email = draft.email;
			baseline.isAvailable = draft.isAvailable;
		}
		if (section === 'services') baseline.serviceIds = [...draft.serviceIds];
		if (section === 'schedule') baseline.schedule = cloneDraft(draft).schedule;
		if (section === 'exception') resetExceptionDraft();
		if (!Object.values(calculateDirtyFields(draft, baseline)).some(Boolean)) {
			clearTtlDraft(draftStorageKey);
			draftRestored = false;
		}
	};

	const messageFromResult = (result: any, fallback: string) =>
		typeof result?.data?.message === 'string' ? result.data.message : fallback;

	const sectionEnhance = (section: 'profile' | 'services' | 'schedule' | 'exception'): SubmitFunction => () => {
		saving = section;
		return async ({ result, update }) => {
			saving = null;
			if (result.type === 'success') {
				markSaved(section);
				await update({ reset: false, invalidateAll: true });
				return;
			}
			await update({ reset: false });
		};
	};

	const createServiceEnhance: SubmitFunction = () => {
		saving = 'service-create';
		return async ({ result, update }) => {
			saving = null;
			if (result.type === 'success') {
				const serviceId = typeof (result.data as any)?.serviceId === 'string' ? (result.data as any).serviceId : '';
				if (serviceId) {
					if (!draft.serviceIds.includes(serviceId)) draft.serviceIds = [...draft.serviceIds, serviceId];
					if (!baseline.serviceIds.includes(serviceId)) baseline.serviceIds = [...baseline.serviceIds, serviceId];
				}
				showNewService = false;
				await update({ reset: true, invalidateAll: true });
				return;
			}
			await update({ reset: false });
		};
	};

	const refreshEnhance: SubmitFunction = () => {
		return async ({ update }) => {
			await update({ reset: false, invalidateAll: true });
		};
	};

	const continuePendingNavigation = () => {
		const href = pendingNavigationHref;
		showExitGuard = false;
		pendingNavigationHref = null;
		guardError = '';
		if (!href) return;
		allowNavigation = true;
		goto(href);
	};

	const stayEditing = () => {
		showExitGuard = false;
		pendingNavigationHref = null;
		guardError = '';
		if (missingItems.includes('Nombre visible')) activeTab = 'perfil';
		else if (missingItems.includes('Horarios de atención')) activeTab = 'horarios';
	};

	const discardAndLeave = () => {
		draft = cloneDraft(baseline);
		clearTtlDraft(draftStorageKey);
		draftRestored = false;
		continuePendingNavigation();
	};

	const saveAllEnhance: SubmitFunction = () => {
		saving = 'all';
		guardError = '';
		return async ({ result, update }) => {
			saving = null;
			if (result.type === 'success') {
				markSaved('all');
				await update({ reset: false, invalidateAll: true });
				continuePendingNavigation();
				return;
			}
			guardError = messageFromResult(result, 'No se pudieron guardar los cambios.');
			await update({ reset: false });
		};
	};

	const requestSaveAll = () => {
		draft.schedule.timeRanges = normalizeTimeRangesInput(draft.schedule.timeRanges);
		draft.exception.timeRange = normalizeTimeRangesInput(draft.exception.timeRange);
		saveAllForm?.requestSubmit();
	};

	const shouldGuardExit = () => hasUnsavedChanges || hasMissingMinimum;

	beforeNavigate((navigation) => {
		const target = navigation.to?.url;
		if (!target || allowNavigation) return;
		if (target.pathname === location.pathname) return;
		if (!shouldGuardExit()) return;
		navigation.cancel();
		pendingNavigationHref = `${target.pathname}${target.search}${target.hash}`;
		guardError = '';
		showExitGuard = true;
	});

	$effect(() => {
		if (!draftReady) return;
		if (hasUnsavedChanges) saveTtlDraft(draftStorageKey, cloneDraft(draft));
		else clearTtlDraft(draftStorageKey);
	});

	$effect(() => {
		if (!draftReady || hasUnsavedChanges) return;
		const serverDraft = buildServerDraft(data);
		baseline = cloneDraft(serverDraft);
		draft = cloneDraft(serverDraft);
	});

	onMount(() => {
		const savedDraft = loadTtlDraft<Partial<ProfessionalDraft>>(draftStorageKey);
		if (savedDraft) {
			const restored = sanitizeDraft(savedDraft, baseline);
			if (Object.values(calculateDirtyFields(restored, baseline)).some(Boolean)) {
				draft = restored;
				draftRestored = true;
			}
		}
		draftReady = true;

		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			if (!shouldGuardExit()) return;
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener('beforeunload', handleBeforeUnload);
		return () => window.removeEventListener('beforeunload', handleBeforeUnload);
	});
</script>

<section class="ux-page">
		<div class="ux-hero">
			<BackLink href="/odonto/configuracion/usuarios" label="Volver" class="mb-5" />
			<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<p class="text-xs font-bold uppercase text-white/42">Profesional</p>
					<h1 class="ux-title mt-3">{visibleName}</h1>
					<p class="ux-subtitle">{visibleSubtitle}</p>
					{#if hasMissingMinimum}
						<p class="mt-3 text-sm font-bold text-red-100">Falta completar: {missingSummary}</p>
					{/if}
					{#if hasUnsavedChanges}
						<p class="mt-2 text-sm font-bold text-amber-100">Cambios sin guardar</p>
					{/if}
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<span class={bookingStatusClass}>{bookingStatusLabel}</span>
					{#if hasUnsavedChanges}
						<button type="button" disabled={!canOperate || saving === 'all'} class="ux-btn-primary" onclick={requestSaveAll}>
							{saving === 'all' ? 'Guardando...' : 'Guardar todo'}
						</button>
					{/if}
				</div>
			</div>
		</div>

		{#if form?.message}
			<p class={form.success ? 'ux-alert ux-alert-success' : 'ux-alert'}>{form.message}</p>
		{/if}
		{#if draftRestored}
			<p class="ux-alert ux-alert-warning">Tenés cambios sin guardar recuperados.</p>
		{/if}

		<form method="POST" action="?/save_all" class="hidden" use:enhance={saveAllEnhance} bind:this={saveAllForm}>
			<input type="hidden" name="save_profile" value={shouldSaveProfile ? 'true' : 'false'} />
			<input type="hidden" name="save_services" value={dirtyFields.services ? 'true' : 'false'} />
			<input type="hidden" name="save_schedule" value={dirtyFields.schedule ? 'true' : 'false'} />
			<input type="hidden" name="save_exception" value={dirtyFields.exception ? 'true' : 'false'} />
			<input type="hidden" name="name" value={draft.name} />
			<input type="hidden" name="specialty" value={draft.specialty} />
			<input type="hidden" name="phone" value={draft.phone} />
			<input type="hidden" name="email" value={draft.email} />
			<input type="hidden" name="is_available" value={draft.isAvailable ? 'true' : 'false'} />
			{#each draft.serviceIds.filter((id) => !defaultServiceIdSet.has(id)) as serviceId}
				<input type="hidden" name="service_id" value={serviceId} />
			{/each}
			{#each draft.schedule.weekdays as weekday}
				<input type="hidden" name="weekdays" value={weekday} />
			{/each}
			<input type="hidden" name="time_ranges" value={draft.schedule.timeRanges} />
			<input type="hidden" name="slot_interval_minutes" value={draft.schedule.slotInterval} />
			<input type="hidden" name="applies_to" value={draft.exception.appliesTo} />
			<input type="hidden" name="type" value={draft.exception.type} />
			<input type="hidden" name="date" value={draft.exception.date} />
			<input type="hidden" name="time_range" value={draft.exception.timeRange} />
			<input type="hidden" name="reason" value={draft.exception.reason} />
		</form>

		<div class="ux-card p-2">
			<div class="grid gap-2 sm:grid-cols-3">
				{#each tabs as tab}
					<button
					type="button"
					class={`ux-profile-tab ${activeTab === tab.id ? 'ux-profile-tab-active' : ''} ${
						tabStates[tab.id].missing ? 'ux-profile-tab-required' : tabStates[tab.id].dirty ? 'ux-profile-tab-unsaved' : ''
					}`}
					onclick={() => (activeTab = tab.id)}
					>
						<span class="inline-flex items-center justify-center gap-2">
							{tab.label}
							{#if tabStates[tab.id].missing}
								<span class="ux-tab-marker ux-tab-marker-danger" aria-label="Dato necesario faltante">!</span>
							{:else if tabStates[tab.id].dirty}
								<span class="ux-tab-marker ux-tab-marker-warning" aria-label="Cambios sin guardar">·</span>
							{/if}
						</span>
					</button>
				{/each}
			</div>
		</div>

	{#if activeTab === 'perfil'}
		<form method="POST" action="?/update_profile" class={`ux-card ${sectionStateClass(shouldSaveProfile, missingItems.includes('Nombre visible'))}`} use:enhance={sectionEnhance('profile')}>
			<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h2 class="ux-section-title">Perfil</h2>
					<p class="mt-1 text-sm text-white/55">Datos básicos del profesional.</p>
					{#if missingItems.includes('Nombre visible')}
						<p class="ux-section-meta ux-section-meta-danger">Nombre visible necesario para recibir turnos</p>
					{:else if shouldSaveProfile}
						<p class="ux-section-meta ux-section-meta-warning">Cambios sin guardar</p>
					{/if}
				</div>
				<button type="submit" disabled={!canOperate || saving === 'profile' || !shouldSaveProfile} class="ux-btn-secondary">
					{saving === 'profile' ? 'Guardando...' : 'Guardar sólo perfil'}
				</button>
			</div>
			<div class="mt-5 grid gap-4 md:grid-cols-2">
				<label>
					<span class="ux-label flex flex-wrap items-center gap-2">
						Nombre
						{#if missingItems.includes('Nombre visible')}
							<span class="ux-inline-status ux-inline-status-danger">Necesario para recibir turnos</span>
						{:else if dirtyFields.name}
							<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>
						{/if}
					</span>
					<input name="name" bind:value={draft.name} required disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.name, missingItems.includes('Nombre visible'))}`} />
				</label>
				<label>
					<span class="ux-label flex flex-wrap items-center gap-2">
						Especialidad (opcional)
						{#if dirtyFields.specialty}<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>{/if}
					</span>
					<input name="specialty" bind:value={draft.specialty} disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.specialty)}`} />
				</label>
				<label>
					<span class="ux-label flex flex-wrap items-center gap-2">
						Teléfono (opcional)
						{#if dirtyFields.phone}<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>{/if}
					</span>
					<input name="phone" bind:value={draft.phone} disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.phone)}`} />
				</label>
				<label>
					<span class="ux-label flex flex-wrap items-center gap-2">
						Correo electrónico (opcional)
						{#if dirtyFields.email}<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>{/if}
					</span>
					<input name="email" bind:value={draft.email} type="email" disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.email)}`} />
				</label>
			</div>
			<label class={`mt-5 inline-flex items-center gap-3 rounded-2xl border bg-white/[0.04] px-4 py-3 text-sm font-bold text-white ${fieldStateClass(dirtyFields.profilePublic) || 'border-white/10'}`}>
				<input
					type="checkbox"
					name="is_available"
					value="true"
					bind:checked={draft.isAvailable}
					disabled={!canOperate}
					class="accent-[#7c3aed]"
				/>
				Visible en reservas
				{#if dirtyFields.profilePublic}<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>{/if}
			</label>
		</form>

		{#if canManage}
			<div class="ux-card flex flex-col gap-4 border-red-400/15 sm:flex-row sm:items-center sm:justify-between">
				<div class="min-w-0">
					<p class="font-bold text-white">{professional?.is_active ? 'Archivar profesional' : 'Restaurar profesional'}</p>
					<p class="mt-1 text-sm text-white/55">
						{professional?.is_active
							? 'Se oculta de la agenda y de las reservas. Reversible.'
							: 'Vuelve a estar disponible para asignar turnos.'}
					</p>
				</div>
				<div class="flex shrink-0 flex-wrap items-center gap-2">
					{#if professional?.is_active}
						<form method="POST" action="?/archive_professional" use:enhance>
							<button type="submit" class="ux-btn-secondary">Archivar</button>
						</form>
					{:else}
						<form method="POST" action="?/restore_professional" use:enhance>
							<button type="submit" class="ux-btn-primary">Restaurar</button>
						</form>
					{/if}
					<button type="button" class="ux-btn-danger" onclick={() => (showDeleteConfirm = true)}>Eliminar</button>
				</div>
			</div>

			<Modal open={showDeleteConfirm} title={canDelete ? 'Eliminar profesional' : 'No se puede eliminar'} on:close={() => (showDeleteConfirm = false)}>
				{#if canDelete}
					<p class="text-sm text-white/70">
						¿Eliminar a <span class="font-bold text-white">{professional?.name}</span> de forma permanente? Esta acción no se puede deshacer.
					</p>
					<div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						<button type="button" class="ux-btn-secondary" onclick={() => (showDeleteConfirm = false)}>Cancelar</button>
						<form
							method="POST"
							action="?/delete_professional"
							use:enhance={() => {
								return async ({ update }) => {
									showDeleteConfirm = false;
									await update();
								};
							}}
						>
							<button type="submit" class="ux-btn-danger">Eliminar profesional</button>
						</form>
					</div>
				{:else}
					<p class="text-sm text-white/70">
						No se puede eliminar a <span class="font-bold text-white">{professional?.name}</span> porque tiene historial cargado{#if clinicalEntryCount > 0} ({clinicalEntryCount} consulta{clinicalEntryCount === 1 ? '' : 's'}){/if}{#if appointmentCount > 0}{clinicalEntryCount > 0 ? ' y' : ''} {appointmentCount} turno{appointmentCount === 1 ? '' : 's'}{/if}. Esos registros pertenecen a los pacientes y se conservan.
					</p>
					<div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						<button type="button" class="ux-btn-secondary" onclick={() => (showDeleteConfirm = false)}>Cerrar</button>
						<a href={`/odonto/profesionales/${professional?.id}/historial`} class="ux-btn-primary">Ver historial</a>
					</div>
				{/if}
			</Modal>
		{/if}
	{/if}

	{#if activeTab === 'servicios'}
		<div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
			<form method="POST" action="?/save_services" class={`ux-card ${sectionStateClass(dirtyFields.services)}`} use:enhance={sectionEnhance('services')}>
				<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<h2 class="ux-section-title">Servicios que ofrece</h2>
						<p class="mt-1 text-sm text-white/55">Estos servicios estarán disponibles para reservar con este profesional.</p>
						{#if dirtyFields.services}
							<p class="ux-section-meta ux-section-meta-warning">{serviceChangeSummary}</p>
						{/if}
					</div>
					<button type="submit" disabled={!canOperate || saving === 'services' || !dirtyFields.services} class="ux-btn-secondary">
						{saving === 'services' ? 'Guardando...' : 'Guardar sólo servicios'}
					</button>
				</div>

				<div class="mt-5 grid gap-3">
					{#each data.services as service}
						{@const isDefault = defaultServiceIdSet.has(service.id)}
						<label class={`ux-choice flex items-center gap-4 p-4 ${isDefault || draft.serviceIds.includes(service.id) ? 'ux-choice-active' : ''} ${serviceRowStateClass(service.id)}`}>
							<input
								type="checkbox"
								name="service_id"
								value={service.id}
								checked={isDefault || draft.serviceIds.includes(service.id)}
								disabled={!canOperate || isDefault}
								class="accent-[#7c3aed]"
								onchange={() => !isDefault && toggleService(service.id)}
							/>
							<span class="min-w-0 flex-1">
								<span class="block font-black text-white">{service.name}</span>
								<span class="mt-1 block text-sm text-white/55">
									{durationLabel(service.duration_minutes)}{service.price_label ? ` · ${service.price_label}` : ''}
								</span>
							</span>
							{#if isDefault}
								<span class="shrink-0 text-xs font-bold text-white/42">Incluido</span>
							{/if}
						</label>
					{/each}
					{#if data.services.length === 0}
						<p class="ux-empty">Todavía no hay servicios cargados.</p>
					{/if}
				</div>
			</form>

			<div class="ux-soft-card p-5">
				<div class="flex items-start justify-between gap-4">
					<div>
						<h2 class="ux-section-title">¿No encontrás el servicio?</h2>
						<p class="mt-1 text-sm text-white/55">Crealo una vez y queda asignado a {professional?.name ?? 'este profesional'}.</p>
					</div>
					<button type="button" class="ux-btn-secondary" onclick={() => (showNewService = !showNewService)}>
						{showNewService ? 'Cerrar' : 'Crear servicio nuevo'}
					</button>
				</div>
				{#if showNewService}
					<form method="POST" action="?/create_service" class="mt-5 grid gap-4" use:enhance={createServiceEnhance}>
						<label>
							<span class="ux-label">Nombre</span>
							<input name="name" required disabled={!canOperate} class="ux-input" />
						</label>
						<label>
							<span class="ux-label">Duración</span>
							<input name="duration_minutes" type="number" min="5" max="480" step="5" value="30" disabled={!canOperate} class="ux-input" />
						</label>
						<label>
							<span class="ux-label">Precio visible (opcional)</span>
							<input name="price_label" type="text" inputmode="numeric" disabled={!canOperate} placeholder="$ 35.000" class="ux-input" oninput={handlePriceInput} />
						</label>
						<button class="ux-btn-primary" disabled={!canOperate || saving === 'service-create'}>
							{saving === 'service-create' ? 'Creando...' : 'Crear y asignar'}
						</button>
					</form>
				{/if}
			</div>
		</div>
	{/if}

	{#if activeTab === 'horarios'}
		<div class="grid gap-5 xl:grid-cols-[1fr_0.78fr]">
			<form method="POST" action="?/save_weekly_rules" class={`ux-card ${sectionStateClass(dirtyFields.schedule, missingItems.includes('Horarios de atención'))}`} onsubmit={normalizeScheduleBeforeSubmit} use:enhance={sectionEnhance('schedule')}>
				<div>
					<h2 class="ux-section-title">Horarios de atención</h2>
					<p class="mt-2 text-sm text-white/55">Marcá los días y escribí los bloques horarios.</p>
					{#if missingItems.includes('Horarios de atención')}
						<p class="ux-section-meta ux-section-meta-danger">Necesario para recibir turnos</p>
					{:else if dirtyFields.schedule}
						<p class="ux-section-meta ux-section-meta-warning">Cambios sin guardar</p>
					{/if}
				</div>
				{#each draft.schedule.weekdays as weekday}
					<input type="hidden" name="weekdays" value={weekday} />
				{/each}

				<div class="mt-6">
					<span class="ux-label flex flex-wrap items-center gap-2">
						Días
					</span>
					<div class="mt-3 grid grid-cols-[repeat(auto-fit,minmax(112px,1fr))] gap-2">
						{#each weekdays as day, index}
							<button
								type="button"
								disabled={!canOperate}
								class={`min-h-14 min-w-0 rounded-2xl border px-3 py-3 text-center text-sm font-black leading-tight whitespace-normal transition disabled:cursor-not-allowed disabled:opacity-50 ${
									draft.schedule.weekdays.includes(index)
										? 'border-[#8b5cf6] bg-[#7c3aed] text-white shadow-lg shadow-[#7c3aed]/20'
										: 'border-white/10 bg-white/[0.03] text-white/65 hover:border-[#8b5cf6]/60 hover:bg-white/[0.06]'
								}`}
								onclick={() => toggleWeekday(index)}
							>
								{day}
							</button>
						{/each}
					</div>
					<div class="mt-3 flex flex-wrap gap-2">
						<button type="button" class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/65 hover:bg-white/[0.06]" onclick={() => setWeekdays([1, 2, 3, 4, 5])}>Lunes a viernes</button>
						<button type="button" class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/65 hover:bg-white/[0.06]" onclick={() => setWeekdays([1, 2, 3, 4, 5, 6])}>Lunes a sábado</button>
						<button type="button" class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/65 hover:bg-white/[0.06]" onclick={() => setWeekdays([])}>Limpiar</button>
					</div>
				</div>

				<div class="mt-6 grid gap-4 lg:grid-cols-[1fr_180px]">
					<label>
						<span class="ux-label flex flex-wrap items-center gap-2">
							Horarios
							{#if missingItems.includes('Horarios de atención')}
								<span class="ux-inline-status ux-inline-status-danger">Necesario para recibir turnos</span>
							{:else if dirtyFields.schedule}
								<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>
							{/if}
						</span>
						<input
							name="time_ranges"
							type="text"
							required
							placeholder="9 a 13, 15 a 19"
							bind:value={draft.schedule.timeRanges}
							disabled={!canOperate}
							class={`ux-input text-lg font-bold ${fieldStateClass(dirtyFields.schedule, missingItems.includes('Horarios de atención'))}`}
							oninput={handleScheduleTyping}
							onblur={normalizeScheduleInput}
						/>
						{#if weeklyPreview.length > 0}
							<div class="mt-3 flex flex-wrap gap-2">
								{#each weeklyPreview as range}
									<span class="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-100">
										{range.start} - {range.end}
									</span>
								{/each}
							</div>
						{/if}
					</label>
					<label>
						<span class="ux-label flex flex-wrap items-center gap-2">
							Descanso entre consultas
							{#if dirtyFields.schedule}<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>{/if}
						</span>
						<input name="slot_interval_minutes" type="number" inputmode="numeric" min="5" max="120" step="5" bind:value={draft.schedule.slotInterval} disabled={!canOperate} class={`ux-input text-lg font-bold ${fieldStateClass(dirtyFields.schedule)}`} />
					</label>
				</div>
				<button type="submit" disabled={!canOperate || draft.schedule.weekdays.length === 0 || saving === 'schedule' || !dirtyFields.schedule} class="ux-btn-secondary mt-6 w-full">
					{saving === 'schedule' ? 'Guardando...' : 'Guardar sólo horarios'}
				</button>
			</form>

			<form method="POST" action="?/create_exception" class={`ux-card ${sectionStateClass(dirtyFields.exception)}`} use:enhance={sectionEnhance('exception')}>
				<h2 class="ux-section-title">Cambio puntual</h2>
				<p class="mt-2 text-sm text-white/55">Bloqueos, feriados u horarios extra.</p>
				{#if dirtyFields.exception}
					<p class="ux-section-meta ux-section-meta-warning">Cambios sin guardar</p>
				{/if}
				<div class="mt-5 grid gap-4">
					<div>
						<span class="ux-label">Afecta a</span>
						<div class="mt-3 grid gap-2 sm:grid-cols-2">
							<label class="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-white/80">
								<input type="radio" name="applies_to" value="professional" bind:group={draft.exception.appliesTo} class="mr-2 accent-[#7c3aed]" />
								{professional?.name ?? 'Profesional'}
							</label>
							<label class="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-white/80">
								<input type="radio" name="applies_to" value="business" bind:group={draft.exception.appliesTo} class="mr-2 accent-[#7c3aed]" />
								Todo el consultorio
							</label>
						</div>
					</div>
					<div>
						<span class="ux-label">Tipo</span>
						<div class="mt-3 grid gap-2 sm:grid-cols-2">
							<label class="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-white/80">
								<input type="radio" name="type" value="blocked" bind:group={draft.exception.type} class="mr-2 accent-[#7c3aed]" />
								Bloquear
							</label>
							<label class="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-white/80">
								<input type="radio" name="type" value="extra_available" bind:group={draft.exception.type} class="mr-2 accent-[#7c3aed]" />
								Sumar horario
							</label>
						</div>
					</div>
					<label>
						<span class="ux-label flex flex-wrap items-center gap-2">
							Fecha
							{#if dirtyFields.exception}<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>{/if}
						</span>
						<input name="date" type="text" inputmode="numeric" placeholder="24/05/2026" bind:value={draft.exception.date} onblur={normalizeExceptionDate} required disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.exception)}`} />
					</label>
					<label>
						<span class="ux-label">Horario</span>
						<input name="time_range" type="text" placeholder="10 a 12" bind:value={draft.exception.timeRange} onblur={normalizeExceptionTime} required disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.exception)}`} />
					</label>
					<label>
						<span class="ux-label">Motivo (opcional)</span>
						<input name="reason" placeholder="Vacaciones, feriado, trámite..." bind:value={draft.exception.reason} disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.exception)}`} />
					</label>
				</div>
				<button type="submit" disabled={!canOperate || saving === 'exception' || !dirtyFields.exception} class="ux-btn-secondary mt-5 w-full">
					{saving === 'exception' ? 'Guardando...' : 'Guardar cambio'}
				</button>
			</form>
		</div>

		<div class="grid gap-5 xl:grid-cols-[1fr_0.78fr]">
			<div class="ux-card">
				<div class="flex items-center justify-between gap-4">
					<h2 class="ux-section-title">Semana habitual</h2>
					<span class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/55">
						{data.rules.length} bloques
					</span>
				</div>
				<div class="mt-5 grid gap-3">
					{#each rulesByWeekday as day}
						<div class="ux-soft-card p-4">
							<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
								<p class="min-w-28 text-sm font-black text-white">{day.day}</p>
								<div class="flex flex-1 flex-wrap gap-2">
									{#if day.rules.length > 0}
										{#each day.rules as rule}
											<form method="POST" action="?/delete_rule" class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2" use:enhance={refreshEnhance}>
												<input type="hidden" name="rule_id" value={rule.id} />
												<span class="text-sm font-bold text-white">{rule.start_time.slice(0, 5)} - {rule.end_time.slice(0, 5)}</span>
												<span class="text-xs font-bold text-white/50">Descanso entre consultas: {rule.slot_interval_minutes} min</span>
												<button type="submit" disabled={!canOperate} class="text-xs font-black text-red-200 disabled:opacity-50">Quitar</button>
											</form>
										{/each}
									{:else}
										<span class="rounded-full border border-dashed border-white/10 px-3 py-2 text-sm font-bold text-white/35">Sin atención</span>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>

			<div class="ux-card">
				<h2 class="ux-section-title">Cambios puntuales</h2>
				<div class="mt-5 grid gap-3">
						{#each data.exceptions as item}
							<form method="POST" action="?/delete_exception" class="ux-soft-card p-4" use:enhance={refreshEnhance}>
							<input type="hidden" name="exception_id" value={item.id} />
							<div class="flex items-start justify-between gap-3">
								<div class="text-sm">
									<p class="font-bold text-white">{item.type === 'blocked' ? 'Bloqueo' : 'Horario extra'} · {exceptionTarget(item)}</p>
									<p class="mt-1 text-white/55">{formatDateTime(item.starts_at)} - {formatDateTime(item.ends_at)}</p>
									{#if item.reason}<p class="mt-1 text-xs text-white/42">{item.reason}</p>{/if}
								</div>
								<button type="submit" disabled={!canOperate} class="text-sm font-bold text-red-200 disabled:opacity-50">Eliminar</button>
							</div>
						</form>
					{/each}
					{#if data.exceptions.length === 0}
						<p class="ux-empty">Sin cambios puntuales cargados.</p>
					{/if}
				</div>
			</div>
			</div>
		{/if}

		<Modal open={showExitGuard} title={guardTitle}>
			<div class="space-y-5 text-sm text-white/72">
				{#if hasUnsavedChanges}
					<div>
						<p class="font-bold text-white">Hay cambios sin guardar en:</p>
						<ul class="mt-3 grid gap-2">
							{#each dirtyItems as item}
								<li class="rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-2 font-bold text-amber-100">
									{item}
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if hasMissingMinimum}
					<div>
						<p class="font-bold text-white">{hasUnsavedChanges ? 'Además faltan datos necesarios:' : 'Este profesional todavía no tiene:'}</p>
						<ul class="mt-3 grid gap-2">
							{#each missingItems as item}
								<li class="rounded-xl border border-red-300/25 bg-red-400/10 px-3 py-2 font-bold text-red-100">
									{item}
								</li>
							{/each}
						</ul>
						<p class="mt-3">
							Sin estos datos, el profesional no va a poder aparecer correctamente al reservar un turno.
						</p>
					</div>
				{:else if hasUnsavedChanges}
					<p>Si salís ahora, esos cambios se van a perder.</p>
				{/if}

				{#if guardError}
					<p class="ux-alert">{guardError}</p>
				{/if}

				<div class="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
					{#if showSaveAllAction}
						<button type="button" class="ux-btn-secondary border-red-400/35 text-red-100" onclick={discardAndLeave}>
							Salir sin guardar
						</button>
						<button type="button" class="ux-btn-secondary" onclick={stayEditing}>Seguir editando</button>
						<button type="button" disabled={!canOperate || saving === 'all'} class="ux-btn-primary" onclick={requestSaveAll}>
							{saving === 'all' ? 'Guardando...' : 'Guardar todo'}
						</button>
					{:else}
						<button type="button" class="ux-btn-secondary border-red-400/35 text-red-100" onclick={continuePendingNavigation}>
							Salir sin completar
						</button>
						<button type="button" class="ux-btn-primary" onclick={stayEditing}>Completar ahora</button>
					{/if}
				</div>
			</div>
		</Modal>
	</section>
