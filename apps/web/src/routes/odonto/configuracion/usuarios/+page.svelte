<script lang="ts">
	import type { BusinessContext, BusinessRole } from '$lib/server/business';
	import { formatPriceLabel } from '$lib/utils/money-input';
	import { normalizeTimeRangesForCommit, normalizeTimeRangesInput, parseTimeRanges } from '$lib/utils/time-ranges';
	import {
		createEmptyScheduleBlock,
		serializeScheduleBlocks,
		validateScheduleBlocks,
		type ScheduleBlockDraft
	} from '$lib/utils/schedule-blocks';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';

	type RoleAccess = {
		id: string;
		business_id: string;
		user_id: string | null;
		email: string;
		role: BusinessRole;
		status: 'active' | 'pending';
		professional_id: string | null;
		created_at: string;
	};

	type Service = {
		id: string;
		name: string;
		duration_minutes: number;
		price_label: string | null;
		is_default: boolean;
	};

	type NewService = {
		name: string;
		duration_minutes: number;
		price_label: string;
	};

	let { data, form } = $props<{
		data: {
			context: BusinessContext;
			members: RoleAccess[];
			services: Service[];
			roles: readonly BusinessRole[];
			defaultServiceNames: readonly string[];
			currentUserId: string | null;
			demo: boolean;
		};
		form?: { success?: boolean; message?: string; openRole?: BusinessRole; values?: Record<string, FormDataEntryValue> };
	}>();

	const roleLabels: Record<BusinessRole, string> = {
		owner: 'Dueño',
		admin: 'Administrador',
		reception: 'Recepción',
		professional: 'Profesional',
		readonly: 'Solo lectura'
	};

	const roleDescriptions: Record<BusinessRole, string> = {
		owner: 'Control total del consultorio.',
		admin: 'Configura equipo, agenda y pacientes.',
		reception: 'Opera agenda y pacientes sin historia clínica.',
		professional: 'Atiende turnos y accede a sus pacientes.',
		readonly: 'Sólo consulta información.'
	};

	const weekdayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

	const members = $derived(data.members as RoleAccess[]);
	const roles = $derived(data.roles as readonly BusinessRole[]);
	const services = $derived(data.services as Service[]);
	const customServices = $derived(services.filter((service) => !service.is_default));
	const canManage = $derived(data.context.canManage && !data.demo);

	// ----- Configurar atendible (dueño/admin que también atiende pacientes) -----
	let showAttendingForm = $state(false);
	let attendingUserId = $state('');
	let attendingName = $state('');
	let attendingError = $state('');
	const attendingEligible = $derived(
		members.filter((m) => m.status === 'active' && (m.role === 'owner' || m.role === 'admin'))
	);
	const attendingPending = $derived(attendingEligible.filter((m) => !m.professional_id && m.user_id));
	const attendingActive = $derived(attendingEligible.filter((m) => m.professional_id));

	// Categorías desplegables de la pantalla Equipo.
	type Category = { id: string; title: string; role: BusinessRole };
	const baseCategories: Category[] = [
		{ id: 'owner', title: 'Dueño', role: 'owner' },
		{ id: 'admin', title: 'Administradores', role: 'admin' },
		{ id: 'reception', title: 'Recepción', role: 'reception' },
		{ id: 'professional', title: 'Profesionales', role: 'professional' }
	];
	const categories = $derived(
		members.some((member) => member.role === 'readonly')
			? [...baseCategories, { id: 'readonly', title: 'Solo lectura', role: 'readonly' as BusinessRole }]
			: baseCategories
	);
	// svelte-ignore state_referenced_locally
	let openCategories = $state<Record<string, boolean>>(form?.success && form.openRole ? { [form.openRole]: true } : {});
	const toggleCategory = (id: string) => {
		openCategories = { ...openCategories, [id]: !openCategories[id] };
	};
	const membersByRole = (role: BusinessRole) => members.filter((member) => member.role === role);

	const memberRoleOptions = (member: RoleAccess) =>
		roles.includes(member.role) ? roles : [...roles, member.role];

	const formatDate = (value: string) =>
		value
			? new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value))
			: 'Sin fecha';

	// ----- Wizard Agregar integrante -----
	const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

	let showWizard = $state(false);
	let stepIndex = $state(0);
	let email = $state('');
	let role = $state<BusinessRole>('reception');
	let professionalName = $state('');
	let professionalSpecialty = $state('');
	let selectedServiceIds = $state<string[]>([]);
	let newServices = $state<NewService[]>([]);
	let newServiceName = $state('');
	let newServiceDuration = $state('30');
	let newServicePrice = $state('');
	let scheduleBlocks = $state<ScheduleBlockDraft[]>([{ ...createEmptyScheduleBlock('wizard-block-1') }]);
	let scheduleBlockSeq = 20;
	let exceptionAppliesTo = $state<'professional' | 'business'>('professional');
	let exceptionType = $state<'blocked' | 'extra_available'>('blocked');
	let exceptionDate = $state('');
	let exceptionTimeRange = $state('');
	let exceptionReason = $state('');

	let emailError = $state('');
	let nameError = $state('');
	let newServiceError = $state('');
	let scheduleError = $state('');
	let exceptionError = $state('');
	let wizardSubmitting = $state(false);
	let attendingSubmitting = $state(false);
	let teamActionBusy = $state('');

	const steps = $derived(
		role === 'professional'
			? ['email', 'rol', 'datos', 'servicios', 'horarios', 'resumen']
			: ['email', 'rol', 'resumen']
	);
	const currentStep = $derived(steps[Math.min(stepIndex, steps.length - 1)]);

	$effect(() => {
		if (!form?.values) return;
		showWizard = true;
		if (form.values.email) email = String(form.values.email);
		if (form.values.role && roles.includes(String(form.values.role) as BusinessRole)) {
			role = String(form.values.role) as BusinessRole;
		}
		if (form.values.professional_name) professionalName = String(form.values.professional_name);
		if (form.values.professional_specialty) professionalSpecialty = String(form.values.professional_specialty);
		if (form.values.schedule_blocks) {
			try {
				const parsed = JSON.parse(String(form.values.schedule_blocks));
				if (Array.isArray(parsed)) {
					scheduleBlocks = parsed.map((item: any, index) => ({
						id: `restored-wizard-block-${index + 1}`,
						weekdays: Array.isArray(item?.weekdays)
							? item.weekdays.map(Number).filter((value: number) => Number.isInteger(value) && value >= 0 && value <= 6)
							: [],
						timeRanges: String(item?.timeRanges ?? item?.time_ranges ?? ''),
						slotInterval: String(item?.slotInterval ?? item?.slot_interval_minutes ?? '15')
					}));
				}
			} catch {
				scheduleBlocks = [{ ...createEmptyScheduleBlock('wizard-block-1') }];
			}
		} else if (form.values.time_ranges || form.values.weekdays_csv) {
			scheduleBlocks = [
				{
					id: 'restored-wizard-block-1',
					weekdays: String(form.values.weekdays_csv ?? '')
						.split(',')
						.map((value) => Number(value))
						.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6),
					timeRanges: String(form.values.time_ranges ?? ''),
					slotInterval: String(form.values.slot_interval_minutes ?? '15')
				}
			];
		}
		if (form.values.service_ids_csv) {
			selectedServiceIds = String(form.values.service_ids_csv).split(',').filter(Boolean);
		}
		if (form.values.new_services) {
			try {
				const parsed = JSON.parse(String(form.values.new_services));
				if (Array.isArray(parsed)) {
					newServices = parsed.map((item: any) => ({
						name: String(item?.name ?? ''),
						duration_minutes: Number(item?.duration_minutes ?? 30),
						price_label: String(item?.price_label ?? '')
					}));
				}
			} catch {
				newServices = [];
			}
		}
		if (form.values.exception_date) exceptionDate = String(form.values.exception_date);
		if (form.values.exception_time_range) exceptionTimeRange = String(form.values.exception_time_range);
		if (form.values.exception_reason) exceptionReason = String(form.values.exception_reason);
	});

	const resetWizard = () => {
		stepIndex = 0;
		email = '';
		role = 'reception';
		professionalName = '';
		professionalSpecialty = '';
		selectedServiceIds = [];
		newServices = [];
		newServiceName = '';
		newServiceDuration = '30';
		newServicePrice = '';
		scheduleBlocks = [{ ...createEmptyScheduleBlock(`wizard-block-${scheduleBlockSeq++}`) }];
		exceptionAppliesTo = 'professional';
		exceptionType = 'blocked';
		exceptionDate = '';
		exceptionTimeRange = '';
		exceptionReason = '';
		emailError = '';
		nameError = '';
		newServiceError = '';
		scheduleError = '';
		exceptionError = '';
	};

	const usedWeekdays = (exceptBlockId = '') =>
		new Set(
			scheduleBlocks
				.filter((block) => block.id !== exceptBlockId)
				.flatMap((block) => block.weekdays)
		);

	const updateScheduleBlock = (blockId: string | undefined, patch: Partial<ScheduleBlockDraft>) => {
		scheduleBlocks = scheduleBlocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block));
		scheduleError = '';
	};

	const commitScheduleBlockTimeRanges = (blockId: string | undefined) => {
		const block = scheduleBlocks.find((item) => item.id === blockId);
		if (!block) return false;
		const result = normalizeTimeRangesForCommit(block.timeRanges);
		if (!result.ok) {
			scheduleError = 'Horario inválido.';
			return false;
		}
		updateScheduleBlock(block.id, { timeRanges: result.value });
		return true;
	};

	const toggleWizard = () => {
		showWizard = !showWizard;
		if (showWizard) resetWizard();
	};

	const validateCurrentStep = () => {
		if (currentStep === 'email') {
			if (!email.trim()) {
				emailError = 'Completá el email para continuar.';
				return false;
			}
			if (!EMAIL_FORMAT_REGEX.test(email.trim().toLowerCase())) {
				emailError = 'Ingresá un email válido.';
				return false;
			}
			emailError = '';
			return true;
		}
		if (currentStep === 'datos') {
			if (!professionalName.trim()) {
				nameError = 'Completá el nombre para continuar.';
				return false;
			}
			nameError = '';
			return true;
		}
		if (currentStep === 'horarios') {
			let valid = true;
			for (const block of scheduleBlocks) {
				if (!commitScheduleBlockTimeRanges(block.id)) valid = false;
			}
			const scheduleResult = validateScheduleBlocks(scheduleBlocks);
			if (!scheduleResult.ok) {
				scheduleError = scheduleResult.message;
				valid = false;
			} else {
				scheduleError = '';
			}
			const hasPartialException =
				(exceptionDate.trim() && !exceptionTimeRange.trim()) ||
				(!exceptionDate.trim() && exceptionTimeRange.trim());
			if (hasPartialException) {
				exceptionError = 'Para cargar el cambio puntual completá fecha y horario, o dejalo vacío.';
				valid = false;
			} else {
				exceptionError = '';
			}
			return valid;
		}
		return true;
	};

	const nextStep = () => {
		if (!validateCurrentStep()) return;
		if (stepIndex < steps.length - 1) stepIndex += 1;
	};

	const previousStep = () => {
		stepIndex = Math.max(Math.min(stepIndex, steps.length - 1) - 1, 0);
	};

	const toggleService = (serviceId: string) => {
		selectedServiceIds = selectedServiceIds.includes(serviceId)
			? selectedServiceIds.filter((id) => id !== serviceId)
			: [...selectedServiceIds, serviceId];
	};

	const addNewService = () => {
		const name = newServiceName.trim();
		const duration = Number(newServiceDuration);
		if (!name) {
			newServiceError = 'Completá el nombre del servicio.';
			return;
		}
		if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
			newServiceError = 'La duración debe estar entre 5 y 480 minutos.';
			return;
		}
		newServiceError = '';
		newServices = [...newServices, { name, duration_minutes: duration, price_label: newServicePrice.trim() }];
		newServiceName = '';
		newServiceDuration = '30';
		newServicePrice = '';
	};

	const removeNewService = (index: number) => {
		newServices = newServices.filter((_, itemIndex) => itemIndex !== index);
	};

	const toggleBlockWeekday = (blockId: string | undefined, weekday: number) => {
		const target = scheduleBlocks.find((block) => block.id === blockId);
		if (!target) return;
		const adding = !target.weekdays.includes(weekday);
		scheduleBlocks = scheduleBlocks.map((block) => {
			if (block.id === blockId) {
				return {
					...block,
					weekdays: adding
						? [...block.weekdays, weekday].sort((a, b) => a - b)
						: block.weekdays.filter((item) => item !== weekday)
				};
			}
			return adding ? { ...block, weekdays: block.weekdays.filter((item) => item !== weekday) } : block;
		});
		scheduleError = '';
	};

	const setBlockWeekdays = (blockId: string | undefined, items: number[]) => {
		const normalized = [...new Set(items)].sort((a, b) => a - b);
		scheduleBlocks = scheduleBlocks.map((block) => {
			if (block.id === blockId) return { ...block, weekdays: normalized };
			return { ...block, weekdays: block.weekdays.filter((weekday) => !normalized.includes(weekday)) };
		});
		scheduleError = '';
	};

	const addScheduleBlock = () => {
		const next = createEmptyScheduleBlock(`wizard-block-${scheduleBlockSeq++}`);
		scheduleBlocks = [...scheduleBlocks, next];
		scheduleError = '';
	};

	const removeScheduleBlock = (blockId: string | undefined) => {
		if (scheduleBlocks.length <= 1) {
			scheduleBlocks = [{ ...scheduleBlocks[0], weekdays: [], timeRanges: '', slotInterval: '15' }];
		} else {
			scheduleBlocks = scheduleBlocks.filter((block) => block.id !== blockId);
		}
		scheduleError = '';
	};

	const handlePriceInput = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		input.value = formatPriceLabel(input.value);
		newServicePrice = input.value;
	};

	const normalizeExceptionDate = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		const value = input.value.trim();
		const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
		if (match) {
			exceptionDate = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
			return;
		}
		exceptionDate = value;
	};

	const normalizeExceptionTime = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		exceptionTimeRange = normalizeTimeRangesInput(input.value);
	};

	const schedulePreview = (block: ScheduleBlockDraft) => parseTimeRanges(block.timeRanges) ?? [];
	const selectedCustomServices = $derived(customServices.filter((service) => selectedServiceIds.includes(service.id)));
	const summaryAdditionalServices = $derived([
		...selectedCustomServices.map((service) => service.name),
		...newServices.map((service) => service.name)
	]);
	const summaryScheduleBlocks = $derived(
		scheduleBlocks.map((block) => ({
			days: block.weekdays.map((weekday) => weekdayNames[weekday]).join(', '),
			ranges: schedulePreview(block).map((range) => `${range.start} a ${range.end}`).join(', '),
			slotInterval: block.slotInterval || '15'
		}))
	);
	const hasExceptionLoaded = $derived(Boolean(exceptionDate.trim() && exceptionTimeRange.trim()));
	const newServicesJson = $derived(JSON.stringify(newServices));
	const scheduleBlocksJson = $derived(serializeScheduleBlocks(scheduleBlocks));

	const defaultServiceRows = $derived(
		(data.defaultServiceNames as readonly string[]).map((name) => {
			const existing = services.find((service) => service.is_default && service.name.trim().toLowerCase() === name.toLowerCase());
			return {
				name,
				duration_minutes: existing?.duration_minutes ?? 30,
				price_label: existing?.price_label ?? null
			};
		})
	);

	const durationLabel = (minutes: number) => `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;

	const handleWizardSubmit = (event: SubmitEvent) => {
		if (role !== 'professional') return;
		if (validateCurrentStep()) return;
		event.preventDefault();
		stepIndex = steps.indexOf('horarios');
	};

	const wizardEnhance: SubmitFunction = ({ cancel }) => {
		if (role === 'professional' && !validateCurrentStep()) {
			stepIndex = steps.indexOf('horarios');
			cancel();
			return;
		}
		wizardSubmitting = true;
		return async ({ result, update }) => {
			wizardSubmitting = false;
			if (result.type === 'success') {
				showWizard = false;
				resetWizard();
				await update({ reset: false, invalidateAll: true });
				return;
			}
			await update({ reset: false, invalidateAll: true });
		};
	};
</script>

<section class="ux-page">
	<div class="ux-hero">
		<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<h1 class="ux-title">Equipo</h1>
				<p class="ux-subtitle">Gestioná quién puede entrar al consultorio y qué rol cumple.</p>
			</div>
			<button type="button" class="ux-btn-primary" disabled={!canManage} onclick={toggleWizard}>
				{showWizard ? 'Cerrar' : 'Agregar integrante'}
			</button>
		</div>
	</div>

	{#if form?.message}
		<p class={form.success ? 'ux-alert ux-alert-success' : 'ux-alert'}>{form.message}</p>
	{/if}
	{#if data.demo}
		<p class="ux-empty">El equipo no se modifica en modo demo.</p>
	{/if}

	{#if showWizard}
		<form
			method="POST"
			action="?/add_user"
			class="ux-card scroll-mt-5"
			onsubmit={handleWizardSubmit}
			use:enhance={wizardEnhance}
			aria-busy={wizardSubmitting}
		>
			<div class="flex items-center justify-between gap-4">
				<h2 class="ux-section-title">Agregar integrante</h2>
				<div class="flex gap-2">
					{#each steps as _, item}
						<span class={`grid h-8 w-8 place-items-center rounded-full text-sm font-black ${stepIndex === item ? 'bg-[#7c3aed] text-white' : 'bg-white/10 text-white/45'}`}>
							{item + 1}
						</span>
					{/each}
				</div>
			</div>

			<input type="hidden" name="email" value={email.trim().toLowerCase()} />
			<input type="hidden" name="role" value={role} />
			<input type="hidden" name="professional_name" value={professionalName} />
			<input type="hidden" name="professional_specialty" value={professionalSpecialty} />
			{#each selectedServiceIds as serviceId}
				<input type="hidden" name="service_ids" value={serviceId} />
			{/each}
			<input type="hidden" name="service_ids_csv" value={selectedServiceIds.join(',')} />
			<input type="hidden" name="new_services" value={newServicesJson} />
			<input type="hidden" name="schedule_blocks" value={scheduleBlocksJson} />
			<input type="hidden" name="exception_applies_to" value={exceptionAppliesTo} />
			<input type="hidden" name="exception_type" value={exceptionType} />
			<input type="hidden" name="exception_date" value={exceptionDate} />
			<input type="hidden" name="exception_time_range" value={exceptionTimeRange} />
			<input type="hidden" name="exception_reason" value={exceptionReason} />

			{#if currentStep === 'email'}
				<label class="mt-5 block">
					<span class="ux-label">Email</span>
					<input
						type="email"
						autocomplete="email"
						placeholder="persona@consultorio.com"
						disabled={!canManage}
						class={`ux-input ${emailError ? 'border-red-400/60' : ''}`}
						bind:value={email}
					/>
				</label>
				<p class="mt-2 text-sm text-white/55">
					Con este email la persona crea su cuenta y entra automáticamente al consultorio con el rol asignado.
				</p>
				{#if emailError}
					<p class="ux-alert mt-3">{emailError}</p>
				{/if}
				<button type="button" disabled={!canManage} class="ux-btn-primary mt-4 w-full" onclick={nextStep}>
					Siguiente
				</button>
			{:else if currentStep === 'rol'}
				<div class="mt-5 grid gap-3 md:grid-cols-2">
					{#each roles as option}
						<button
							type="button"
							disabled={!canManage}
							class={`rounded-2xl border px-5 py-4 text-left transition ${
								role === option
									? 'border-[#7c3aed] bg-[#7c3aed]/20 text-white'
									: 'border-white/10 bg-white/[0.04] text-white/80 hover:border-white/25'
							}`}
							onclick={() => (role = option)}
						>
							<span class="block text-lg font-black">{roleLabels[option]}</span>
							<span class="mt-1 block text-sm text-white/55">{roleDescriptions[option]}</span>
						</button>
					{/each}
				</div>
				<div class="mt-4 flex gap-3">
					<button type="button" class="ux-btn-secondary" onclick={previousStep}>Atrás</button>
					<button type="button" disabled={!canManage} class="ux-btn-primary flex-1" onclick={nextStep}>Siguiente</button>
				</div>
			{:else if currentStep === 'datos'}
				<div class="mt-5 grid gap-4 md:grid-cols-2">
					<label>
						<span class="ux-label">Nombre</span>
						<input
							placeholder="Nombre y apellido"
							disabled={!canManage}
							class={`ux-input ${nameError ? 'border-red-400/60' : ''}`}
							bind:value={professionalName}
						/>
					</label>
					<label>
						<span class="ux-label">Especialidad (opcional)</span>
						<input disabled={!canManage} class="ux-input" bind:value={professionalSpecialty} />
					</label>
				</div>
				{#if nameError}
					<p class="ux-alert mt-3">{nameError}</p>
				{/if}
				<div class="mt-4 flex gap-3">
					<button type="button" class="ux-btn-secondary" onclick={previousStep}>Atrás</button>
					<button type="button" disabled={!canManage} class="ux-btn-primary flex-1" onclick={nextStep}>Siguiente</button>
				</div>
			{:else if currentStep === 'servicios'}
				<div class="mt-5 grid gap-5 xl:grid-cols-[1fr_0.75fr]">
					<div class="ux-soft-card p-5">
						<h3 class="ux-section-title">Servicios que ofrece</h3>
						<p class="mt-1 text-sm text-white/55">Estos servicios estarán disponibles para reservar con este profesional.</p>
						<div class="mt-5 grid gap-3">
							{#each defaultServiceRows as service}
								<div class="ux-choice ux-choice-active flex items-center gap-4 p-4">
									<input type="checkbox" checked disabled class="accent-[#7c3aed]" />
									<span class="min-w-0 flex-1">
										<span class="block font-black text-white">{service.name}</span>
										<span class="mt-1 block text-sm text-white/55">
											{durationLabel(service.duration_minutes)}{service.price_label ? ` · ${service.price_label}` : ''}
										</span>
									</span>
									<span class="ux-badge ux-badge-success shrink-0">Incluido</span>
								</div>
							{/each}
							{#each customServices as service}
								<label class={`ux-choice flex items-center gap-4 p-4 ${selectedServiceIds.includes(service.id) ? 'ux-choice-active' : ''}`}>
									<input
										type="checkbox"
										checked={selectedServiceIds.includes(service.id)}
										disabled={!canManage}
										class="accent-[#7c3aed]"
										onchange={() => toggleService(service.id)}
									/>
									<span class="min-w-0 flex-1">
										<span class="block font-black text-white">{service.name}</span>
										<span class="mt-1 block text-sm text-white/55">
											{durationLabel(service.duration_minutes)}{service.price_label ? ` · ${service.price_label}` : ''}
										</span>
									</span>
								</label>
							{/each}
							{#each newServices as service, index}
								<div class="ux-choice ux-choice-active flex items-center gap-4 p-4">
									<input type="checkbox" checked disabled class="accent-[#7c3aed]" />
									<span class="min-w-0 flex-1">
										<span class="block font-black text-white">{service.name}</span>
										<span class="mt-1 block text-sm text-white/55">
											{durationLabel(service.duration_minutes)}{service.price_label ? ` · ${service.price_label}` : ''}
										</span>
									</span>
									<span class="ux-badge shrink-0">Nuevo</span>
									<button type="button" class="text-xs font-black text-red-200" onclick={() => removeNewService(index)}>
										Quitar
									</button>
								</div>
							{/each}
						</div>
					</div>

					<div class="ux-soft-card p-5">
						<h3 class="ux-section-title">Agregar servicio</h3>
						<p class="mt-1 text-sm text-white/55">
							Crealo una vez y queda asignado a {professionalName.trim() || 'este profesional'}.
						</p>
						<div class="mt-5 grid gap-4">
							<label>
								<span class="ux-label">Nombre</span>
								<input disabled={!canManage} class="ux-input" bind:value={newServiceName} />
							</label>
							<label>
								<span class="ux-label">Duración en minutos</span>
								<input type="number" min="5" max="480" step="5" disabled={!canManage} class="ux-input" bind:value={newServiceDuration} />
							</label>
							<label>
								<span class="ux-label">Precio visible (opcional)</span>
								<input type="text" inputmode="numeric" disabled={!canManage} placeholder="$ 35.000" class="ux-input" value={newServicePrice} oninput={handlePriceInput} />
							</label>
							{#if newServiceError}
								<p class="ux-alert">{newServiceError}</p>
							{/if}
							<button type="button" class="ux-btn-secondary" disabled={!canManage} onclick={addNewService}>
								Crear y asignar
							</button>
							<p class="text-xs text-white/45">El servicio se guarda recién al confirmar con Guardar rol en el resumen.</p>
						</div>
					</div>
				</div>
				<div class="mt-4 flex gap-3">
					<button type="button" class="ux-btn-secondary" onclick={previousStep}>Atrás</button>
					<button type="button" disabled={!canManage} class="ux-btn-primary flex-1" onclick={nextStep}>Siguiente</button>
				</div>
			{:else if currentStep === 'horarios'}
				<div class="mt-5 grid gap-5 xl:grid-cols-[1fr_0.78fr]">
					<div class={`ux-soft-card p-5 ${scheduleError ? 'border border-red-400/40' : ''}`}>
						<h3 class="ux-section-title">Horarios de atención</h3>
						<p class="mt-1 text-sm text-white/55">Cada bloque tiene sus propios días, horarios y descanso.</p>

						<div class="mt-5 grid gap-4">
							{#each scheduleBlocks as block, blockIndex (block.id)}
								{@const assignedByOtherBlock = usedWeekdays(block.id)}
								{@const preview = schedulePreview(block)}
								<div class="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
									<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
										<h4 class="font-black text-white">Bloque {blockIndex + 1}</h4>
										<button type="button" class="ux-btn-secondary text-sm" disabled={!canManage} onclick={() => removeScheduleBlock(block.id)}>
											Quitar bloque
										</button>
									</div>
									<div class="mt-4">
										<span class="ux-label">Días</span>
										<div class="mt-3 grid grid-cols-[repeat(auto-fit,minmax(112px,1fr))] gap-2">
											{#each weekdayNames as day, index}
												<button
													type="button"
													disabled={!canManage}
													class={`min-h-14 min-w-0 rounded-2xl border px-3 py-3 text-center text-sm font-black leading-tight whitespace-normal transition disabled:cursor-not-allowed disabled:opacity-50 ${
														block.weekdays.includes(index)
															? 'border-[#8b5cf6] bg-[#7c3aed] text-white shadow-lg shadow-[#7c3aed]/20'
															: assignedByOtherBlock.has(index)
																? 'border-white/5 bg-white/[0.015] text-white/30'
																: 'border-white/10 bg-white/[0.03] text-white/65 hover:border-[#8b5cf6]/60 hover:bg-white/[0.06]'
													}`}
													onclick={() => toggleBlockWeekday(block.id, index)}
												>
													{day}
												</button>
											{/each}
										</div>
										<div class="mt-3 flex flex-wrap gap-2">
											<button type="button" class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/65 hover:bg-white/[0.06]" onclick={() => setBlockWeekdays(block.id, [1, 2, 3, 4, 5])}>Lunes a viernes</button>
											<button type="button" class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/65 hover:bg-white/[0.06]" onclick={() => setBlockWeekdays(block.id, [6])}>Sólo sábado</button>
											<button type="button" class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/65 hover:bg-white/[0.06]" onclick={() => setBlockWeekdays(block.id, [])}>Limpiar</button>
										</div>
									</div>

									<div class="mt-5 grid gap-4 lg:grid-cols-[1fr_180px]">
										<label>
											<span class="ux-label">Horarios</span>
											<input
												type="text"
												placeholder="9 a 13, 15 a 19"
												value={block.timeRanges}
												disabled={!canManage}
												aria-invalid={Boolean(scheduleError)}
												class={`ux-input text-lg font-bold ${scheduleError ? 'border-red-400/60' : ''}`}
												oninput={(event) => updateScheduleBlock(block.id, { timeRanges: (event.currentTarget as HTMLInputElement).value })}
												onblur={() => commitScheduleBlockTimeRanges(block.id)}
											/>
											{#if preview.length > 0}
												<div class="mt-3 flex flex-wrap gap-2">
													{#each preview as range}
														<span class="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-100">
															{range.start} - {range.end}
														</span>
													{/each}
												</div>
											{/if}
										</label>
										<label>
											<span class="ux-label">Descanso entre consultas</span>
											<input
												type="number"
												inputmode="numeric"
												min="5"
												max="120"
												step="5"
												disabled={!canManage}
												class={`ux-input text-lg font-bold ${scheduleError ? 'border-red-400/60' : ''}`}
												value={block.slotInterval}
												oninput={(event) => updateScheduleBlock(block.id, { slotInterval: (event.currentTarget as HTMLInputElement).value })}
											/>
										</label>
									</div>
								</div>
							{/each}
						</div>
						{#if scheduleError}
							<p class="ux-alert mt-4">{scheduleError}</p>
						{/if}
						<button type="button" disabled={!canManage} class="ux-btn-secondary mt-4 w-full" onclick={addScheduleBlock}>
							Agregar otro bloque
						</button>
					</div>

					<div class="ux-soft-card p-5">
						<h3 class="ux-section-title">Cambio puntual (opcional)</h3>
						<p class="mt-1 text-sm text-white/55">Bloqueos, feriados u horarios extra.</p>
						<div class="mt-5 grid gap-4">
							<div>
								<span class="ux-label">Afecta a</span>
								<div class="mt-3 grid gap-2 sm:grid-cols-2">
									<label class="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-white/80">
										<input type="radio" value="professional" bind:group={exceptionAppliesTo} class="mr-2 accent-[#7c3aed]" />
										{professionalName.trim() || 'Profesional'}
									</label>
									<label class="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-white/80">
										<input type="radio" value="business" bind:group={exceptionAppliesTo} class="mr-2 accent-[#7c3aed]" />
										Todo el consultorio
									</label>
								</div>
							</div>
							<div>
								<span class="ux-label">Tipo</span>
								<div class="mt-3 grid gap-2 sm:grid-cols-2">
									<label class="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-white/80">
										<input type="radio" value="blocked" bind:group={exceptionType} class="mr-2 accent-[#7c3aed]" />
										Bloquear
									</label>
									<label class="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-white/80">
										<input type="radio" value="extra_available" bind:group={exceptionType} class="mr-2 accent-[#7c3aed]" />
										Sumar horario
									</label>
								</div>
							</div>
							<label>
								<span class="ux-label">Fecha</span>
								<input type="text" inputmode="numeric" placeholder="24/05/2026" bind:value={exceptionDate} onblur={normalizeExceptionDate} disabled={!canManage} class="ux-input" />
							</label>
							<label>
								<span class="ux-label">Horario</span>
								<input type="text" placeholder="10 a 12" bind:value={exceptionTimeRange} onblur={normalizeExceptionTime} disabled={!canManage} class="ux-input" />
							</label>
							<label>
								<span class="ux-label">Motivo (opcional)</span>
								<input placeholder="Vacaciones, feriado, trámite..." bind:value={exceptionReason} disabled={!canManage} class="ux-input" />
							</label>
							{#if exceptionError}
								<p class="ux-alert">{exceptionError}</p>
							{/if}
						</div>
					</div>
				</div>
				<div class="mt-4 flex gap-3">
					<button type="button" class="ux-btn-secondary" onclick={previousStep}>Atrás</button>
					<button type="button" disabled={!canManage} class="ux-btn-primary flex-1" onclick={nextStep}>Siguiente</button>
				</div>
			{:else}
				<div class="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
					<p class="text-sm font-bold text-white/45">Email</p>
					<p class="mt-1 text-xl font-black text-white">{email.trim().toLowerCase()}</p>
					<p class="mt-4 text-sm font-bold text-white/45">Rol asignado</p>
					<p class="mt-1 text-xl font-black text-white">{roleLabels[role]}</p>
					{#if role === 'professional'}
						<p class="mt-4 text-sm font-bold text-white/45">Nombre</p>
						<p class="mt-1 text-xl font-black text-white">{professionalName}</p>
						{#if professionalSpecialty.trim()}
							<p class="mt-4 text-sm font-bold text-white/45">Especialidad</p>
							<p class="mt-1 text-xl font-black text-white">{professionalSpecialty}</p>
						{/if}
						<p class="mt-4 text-sm font-bold text-white/45">Servicios incluidos</p>
						<p class="mt-1 text-xl font-black text-white">{(data.defaultServiceNames as readonly string[]).join(', ')}</p>
						{#if summaryAdditionalServices.length > 0}
							<p class="mt-4 text-sm font-bold text-white/45">Servicios adicionales</p>
							<p class="mt-1 text-xl font-black text-white">{summaryAdditionalServices.join(', ')}</p>
						{/if}
						<p class="mt-4 text-sm font-bold text-white/45">Horarios habituales</p>
						<div class="mt-2 grid gap-2">
							{#each summaryScheduleBlocks as block, index}
								<div class="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
									<p class="text-sm font-bold text-white/45">Bloque {index + 1}</p>
									<p class="mt-1 text-lg font-black text-white">{block.days || 'Sin días'}</p>
									<p class="mt-1 text-sm font-bold text-white/65">
										{block.ranges || 'Sin horario'} · descanso {block.slotInterval} minutos
									</p>
								</div>
							{/each}
						</div>
						{#if hasExceptionLoaded}
							<p class="mt-4 text-sm font-bold text-white/45">Cambio puntual</p>
							<p class="mt-1 text-xl font-black text-white">
								{exceptionType === 'blocked' ? 'Bloquear' : 'Sumar horario'} · {exceptionDate} · {exceptionTimeRange}
								{exceptionAppliesTo === 'business' ? ' · Todo el consultorio' : ''}
								{exceptionReason.trim() ? ` · ${exceptionReason}` : ''}
							</p>
						{/if}
					{/if}
				</div>
				<div class="mt-4 flex gap-3">
					<button type="button" class="ux-btn-secondary" onclick={previousStep}>Atrás</button>
					<button type="submit" disabled={!canManage || wizardSubmitting} class="ux-btn-primary flex-1">
						{wizardSubmitting ? 'Guardando...' : 'Guardar rol'}
					</button>
				</div>
			{/if}
		</form>
	{/if}

	{#if attendingEligible.length > 0}
		<div class="ux-card">
			<h2 class="ux-section-title">¿El dueño o un administrador también atiende pacientes?</h2>
			<p class="mt-2 text-sm text-white/55">
				Si una persona del equipo también atiende pacientes, creá su perfil profesional para configurar
				horarios y servicios: así aparece en la agenda y puede recibir turnos y seguimientos. No cambia su rol.
			</p>

			{#if attendingActive.length > 0}
				<div class="mt-4 grid gap-2">
					{#each attendingActive as m (m.id)}
						<div class="ux-choice flex items-center justify-between gap-3 p-4">
							<span class="min-w-0 truncate font-bold text-white">{m.email}</span>
							<a href={`/odonto/profesionales/${m.professional_id}`} class="ux-btn-secondary shrink-0 text-sm">
								Ver profesional
							</a>
						</div>
					{/each}
				</div>
			{/if}

			{#if attendingPending.length > 0}
				{#if !showAttendingForm}
					<button
						type="button"
						onclick={() => (showAttendingForm = true)}
						disabled={!canManage}
						class="ux-btn-primary mt-4 disabled:opacity-50"
					>
						Configurar
					</button>
				{:else}
					<form
						method="POST"
						action="?/make_attending"
						class="mt-4 grid gap-3"
						use:enhance={() => {
							attendingError = '';
							attendingSubmitting = true;
							return async ({ result }) => {
								if (result.type === 'redirect') {
									window.location.assign(result.location);
									return;
								}
								attendingSubmitting = false;
								if (result.type === 'failure') {
									attendingError = (result.data?.message as string) ?? 'No se pudo configurar.';
									return;
								}
								if (result.type === 'error') {
									attendingError = 'Ocurrió un error. Intentá de nuevo.';
								}
							};
						}}
					>
						<label class="block">
							<span class="ux-label">Persona del equipo</span>
							<select name="user_id" bind:value={attendingUserId} required class="ux-select">
								<option value="" disabled>Elegí…</option>
								{#each attendingPending as m (m.id)}
									<option value={m.user_id}>{m.email} · {roleLabels[m.role]}</option>
								{/each}
							</select>
						</label>
						<label class="block">
							<span class="ux-label">Nombre profesional (como aparece en la agenda)</span>
							<input name="name" bind:value={attendingName} placeholder="Ej: Dr. Juan Pérez" required class="ux-input" />
						</label>
						{#if attendingError}<p class="ux-alert">{attendingError}</p>{/if}
						<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
							<button type="button" onclick={() => (showAttendingForm = false)} class="ux-btn-secondary">Cancelar</button>
							<button type="submit" disabled={!canManage || attendingSubmitting} class="ux-btn-primary disabled:opacity-50">
								{attendingSubmitting ? 'Creando...' : 'Crear perfil profesional'}
							</button>
						</div>
					</form>
				{/if}
			{:else}
				<p class="mt-4 text-sm text-white/45">
					Todos los dueños y administradores del equipo ya tienen su perfil profesional.
				</p>
			{/if}
		</div>
	{/if}

	<div class="grid gap-4">
		{#each categories as category}
			{@const categoryMembers = membersByRole(category.role)}
			<article class="ux-card p-0">
				<button
					type="button"
					class="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
					onclick={() => toggleCategory(category.id)}
					aria-expanded={Boolean(openCategories[category.id])}
				>
					<span class="flex items-center gap-3">
						<span class="text-xl font-black text-white">{category.title}</span>
						<span class="ux-badge">{categoryMembers.length}</span>
					</span>
					<svg
						class={`h-5 w-5 shrink-0 text-white/45 transition-transform ${openCategories[category.id] ? 'rotate-180' : ''}`}
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
					</svg>
				</button>

				{#if openCategories[category.id]}
					<div class="grid gap-3 px-6 pb-6">
						{#each categoryMembers as member}
							<div class="ux-soft-card p-4">
								<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
									<div class="min-w-0">
										<div class="flex flex-wrap items-center gap-2">
											<h3 class="truncate text-lg font-bold text-white">{member.email}</h3>
											{#if member.user_id === data.currentUserId}
												<span class="ux-badge">Vos</span>
											{/if}
											{#if member.status === 'pending'}
												<span class="ux-badge ux-badge-warning">Pendiente</span>
											{/if}
										</div>
										<p class="mt-2 text-sm text-white/55">
											{roleLabels[member.role]} · {member.status === 'pending' ? 'habilitado el' : 'agregado el'} {formatDate(member.created_at)}
										</p>
									</div>

									<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
										{#if member.professional_id && (member.role === 'professional' || member.role === 'owner' || member.role === 'admin')}
											<a href={`/odonto/profesionales/${member.professional_id}`} class="ux-btn-primary text-center">
												Ver profesional
											</a>
										{/if}
										{#if member.status === 'active' && member.role !== 'owner'}
											<form
												method="POST"
												action="?/update_role"
												class="flex gap-2"
												use:enhance={() => {
													teamActionBusy = `update-${member.id}`;
													return async ({ update }) => {
														teamActionBusy = '';
														await update({ reset: false, invalidateAll: true });
													};
												}}
											>
												<input type="hidden" name="membership_id" value={member.id} />
												<select name="role" disabled={!canManage} class="ux-select min-w-44">
													{#each memberRoleOptions(member) as option}
														<option value={option} selected={member.role === option}>{roleLabels[option]}</option>
													{/each}
												</select>
												<button type="submit" disabled={!canManage || teamActionBusy === `update-${member.id}`} class="ux-btn-secondary">
													{teamActionBusy === `update-${member.id}` ? 'Guardando...' : 'Guardar'}
												</button>
											</form>
										{/if}
										{#if member.role !== 'owner'}
											<form
												method="POST"
												action="?/remove_user"
												use:enhance={() => {
													teamActionBusy = `remove-${member.id}`;
													return async ({ update }) => {
														teamActionBusy = '';
														await update({ reset: false, invalidateAll: true });
													};
												}}
											>
												<input type="hidden" name="access_id" value={member.id} />
												<input type="hidden" name="status" value={member.status} />
												<button type="submit" disabled={!canManage || member.user_id === data.currentUserId || teamActionBusy === `remove-${member.id}`} class="ux-btn-danger">
													{teamActionBusy === `remove-${member.id}` ? 'Quitando...' : 'Quitar'}
												</button>
											</form>
										{/if}
									</div>
								</div>
							</div>
						{/each}
						{#if categoryMembers.length === 0}
							<p class="ux-empty">
								{category.role === 'professional'
									? 'Todavía no hay profesionales. Usá Agregar integrante con rol Profesional.'
									: 'Nadie ocupa este rol todavía.'}
							</p>
						{/if}
					</div>
				{/if}
			</article>
		{/each}
	</div>
</section>
