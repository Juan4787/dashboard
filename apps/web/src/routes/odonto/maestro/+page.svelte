<script lang="ts">
	import Modal from '$lib/components/Modal.svelte';
	import { formatMoneyInteger } from '$lib/utils/money-input';

	let { data, form } = $props();

	type BusinessCard = {
		id: string;
		name: string;
		slug: string;
		is_active: boolean;
		primaryOwnerEmail: string | null;
		owners: { email: string | null; role: string }[];
		members: { email: string | null; role: string }[];
		access: {
			commercialStatus: 'active' | 'grace' | 'restricted' | 'archived';
			visualStatus: 'permanent' | 'active' | 'expiring' | 'grace' | 'restricted' | 'archived';
			isPermanent: boolean;
			commercialAccessEnabled: boolean;
			paidUntil: string | null;
			graceUntil: string | null;
			restrictedUntil: string | null;
			archivedAt: string | null;
			daysUntilExpiration: number | null;
			shouldShowExpiringWarning: boolean;
		};
		subscription: {
			access_source?: string | null;
			access_note?: string | null;
			last_payment_at?: string | null;
			last_payment_amount?: number | string | null;
			updated_at?: string | null;
		} | null;
		recentGrants: any[];
	};

	type EmailRow = {
		id: string;
		email: string;
		enabled: boolean;
		note?: string | null;
		disabled_at?: string | null;
		disabled_reason?: string | null;
		created_at?: string | null;
		updated_at?: string | null;
	};

	type PendingInvite = {
		id: string;
		business_id: string;
		email: string;
		role: string;
		status: string;
		expires_at?: string | null;
		created_at?: string | null;
	};

	const durationOptions = [
		{ value: 'hour_1', label: '1 hora' },
		{ value: 'day_1', label: '1 día' },
		{ value: 'day_7', label: '7 días' },
		...Array.from({ length: 12 }, (_, index) => ({
			value: `month_${index + 1}`,
			label: `${index + 1} mes${index === 0 ? '' : 'es'}`
		})),
		{ value: 'permanent', label: 'Permanente' }
	];

	const operationOptions = [
		{ value: 'extend_access', label: 'Sumar acceso' },
		{ value: 'reduce_access', label: 'Quitar tiempo' },
		{ value: 'set_permanent', label: 'Marcar permanente' },
		{ value: 'unset_permanent', label: 'Quitar permanente' },
		{ value: 'disable_business_access', label: 'Deshabilitar negocio' },
		{ value: 'enable_business_access', label: 'Habilitar negocio' },
		{ value: 'archive_business', label: 'Archivar negocio' },
		{ value: 'reactivate_business', label: 'Reactivar negocio' }
	];

	let activeTab = $state('all');
	let search = $state('');
	let provisionEmail = $state('');
	let provisionDestination = $state<'existing' | 'new' | null>(null);
	let provisionBusinessId = $state('');
	let provisionBusinessName = $state('');
	let provisionDuration = $state('month_1');
	let provisionNote = $state('');
	let showEmailPanel = $state(false);
	let showHistory = $state<Record<string, boolean>>({});
	let expandedBusinessId = $state<string | null>(null);
	let confirmModal = $state<{
		formId: string;
		title: string;
		body: string;
		tone: 'danger' | 'warning' | 'normal';
		confirm: string;
	} | null>(null);
	let disableEmailTarget = $state<{ id: string; email: string } | null>(null);
	let disableReason = $state('');

	const masterEmail = $derived(String(data.masterEmail ?? '').trim().toLowerCase());
	const isMasterEmailRow = (email?: string | null) => {
		const normalized = String(email ?? '').trim().toLowerCase();
		return Boolean(normalized && normalized === masterEmail);
	};
	const businesses = $derived(
		((data.businesses ?? []) as BusinessCard[]).filter(
			(business) =>
				!isMasterEmailRow(business.primaryOwnerEmail) &&
				!business.owners.some((owner) => isMasterEmailRow(owner.email))
		)
	);
	const emails = $derived(
		((data.emails ?? []) as EmailRow[]).filter((item) => !isMasterEmailRow(item.email))
	);
	const authEmailSet = $derived(
		new Set(((data.authEmails ?? []) as string[]).map((email) => email.trim().toLowerCase()))
	);
	const pendingInvites = $derived(
		((data.pendingInvites ?? []) as PendingInvite[]).filter((item) => !isMasterEmailRow(item.email))
	);
	const normalizedSearch = $derived(search.trim().toLowerCase());
	const normalizedProvisionEmail = $derived(provisionEmail.trim().toLowerCase());
	const provisionEmailValid = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedProvisionEmail));
	const provisionEmailRow = $derived(
		emails.find((item) => item.email.toLowerCase() === normalizedProvisionEmail) ?? null
	);
	const provisionEmailEnabled = $derived(Boolean(provisionEmailRow?.enabled));
	const provisionAuthExists = $derived(authEmailSet.has(normalizedProvisionEmail));
	const provisionPendingInvite = $derived(
		pendingInvites.find((item) => item.email.toLowerCase() === normalizedProvisionEmail) ?? null
	);
	const provisionPendingBusiness = $derived(
		provisionPendingInvite
			? businesses.find((business) => business.id === provisionPendingInvite.business_id) ?? null
			: null
	);
	const provisionStepLabel = $derived(
		!provisionEmailValid ? 'Paso 1' : provisionDestination ? 'Paso 3' : 'Paso 2'
	);

	const formatDateTime = (value?: string | null) => (value ? new Date(value).toLocaleString() : 'No vence');
	const money = (value?: number | string | null) => {
		if (value === null || value === undefined || value === '') return 'Sin registrar';
		const parsed = Number(value);
		if (!Number.isFinite(parsed)) return String(value);
		return parsed.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
	};

	const statusLabel = (business: BusinessCard) => {
		if (!business.access.commercialAccessEnabled) return 'Deshabilitado';
		if (business.access.visualStatus === 'permanent') return 'Permanente';
		if (business.access.visualStatus === 'expiring') return 'Vence mañana';
		if (business.access.commercialStatus === 'active') {
			return business.access.daysUntilExpiration
				? `Activo · ${business.access.daysUntilExpiration} días`
				: 'Activo';
		}
		if (business.access.commercialStatus === 'grace') return 'Vencido';
		if (business.access.commercialStatus === 'restricted') return 'Suspendido';
		return 'Archivado';
	};

	const statusClass = (business: BusinessCard) => {
		if (!business.access.commercialAccessEnabled) return 'ux-badge ux-badge-danger';
		if (business.access.visualStatus === 'permanent') return 'ux-badge ux-badge-success';
		if (business.access.visualStatus === 'expiring') return 'ux-badge ux-badge-warning';
		if (business.access.commercialStatus === 'active') return 'ux-badge ux-badge-success';
		if (business.access.commercialStatus === 'grace') return 'ux-badge ux-badge-warning';
		return 'ux-badge ux-badge-danger';
	};

	const matchesTab = (business: BusinessCard) => {
		if (activeTab === 'all') return true;
		if (activeTab === 'permanent') return business.access.isPermanent;
		if (activeTab === 'disabled') return !business.access.commercialAccessEnabled;
		if (activeTab === 'expiring') return business.access.visualStatus === 'expiring';
		return business.access.commercialStatus === activeTab;
	};

	const filteredBusinesses = $derived.by(() => {
		return businesses.filter((business) => {
			if (!matchesTab(business)) return false;
			if (!normalizedSearch) return true;
			return [
				business.name,
				business.slug,
				business.primaryOwnerEmail ?? '',
				...business.members.map((member) => member.email ?? '')
			]
				.join(' ')
				.toLowerCase()
				.includes(normalizedSearch);
		});
	});

	const criticalOperation = (operation: string, duration: string) =>
		[
			'reduce_access',
			'set_permanent',
			'unset_permanent',
			'disable_business_access',
			'archive_business',
			'reactivate_business'
		].includes(operation) || duration === 'permanent';

	const beforeSubmit = (event: SubmitEvent, business: BusinessCard) => {
		const formEl = event.currentTarget as HTMLFormElement;
		if (formEl.dataset.confirmedSubmit === '1') {
			delete formEl.dataset.confirmedSubmit;
			return;
		}

		const formData = new FormData(formEl);
		const operation = String(formData.get('operation') ?? '');
		const duration = String(formData.get('duration') ?? '');
		const idempotency = formEl.querySelector<HTMLInputElement>('input[name="idempotency_key"]');
		if (idempotency) idempotency.value = crypto.randomUUID();

		if (!criticalOperation(operation, duration)) return;

		event.preventDefault();
		const operationLabel = operationOptions.find((option) => option.value === operation)?.label ?? operation;
		const durationLabel = durationOptions.find((option) => option.value === duration)?.label ?? duration;
		confirmModal = {
			formId: formEl.id,
			title: 'Confirmar ajuste',
			body: `${operationLabel} para ${business.name}. Duración: ${durationLabel}.`,
			tone: operation.includes('disable') || operation.includes('archive') ? 'danger' : 'warning',
			confirm: operation.includes('disable') || operation.includes('archive') ? 'Confirmar acción crítica' : 'Confirmar ajuste'
		};
	};

	const confirmSubmit = () => {
		if (!confirmModal) return;
		const formEl = document.getElementById(confirmModal.formId) as HTMLFormElement | null;
		confirmModal = null;
		if (!formEl) return;
		formEl.dataset.confirmedSubmit = '1';
		formEl.requestSubmit();
	};

	const beforeSessionsSubmit = (event: SubmitEvent, business: BusinessCard) => {
		const formEl = event.currentTarget as HTMLFormElement;
		if (formEl.dataset.confirmedSubmit === '1') {
			delete formEl.dataset.confirmedSubmit;
			return;
		}
		event.preventDefault();
		confirmModal = {
			formId: formEl.id,
			title: 'Cerrar sesiones',
			body: `Vas a cerrar todas las sesiones de ${business.name}. Los usuarios deberán volver a iniciar sesión.`,
			tone: 'warning',
			confirm: 'Cerrar sesiones'
		};
	};

	const handleMoneyInput = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		input.value = formatMoneyInteger(input.value);
	};

	$effect(() => {
		if (form?.success === true) {
			provisionEmail = '';
			provisionDestination = null;
			provisionBusinessId = '';
			provisionBusinessName = '';
			provisionNote = '';
			return;
		}
		if (form?.email) provisionEmail = String(form.email);
	});
</script>

<section class="ux-page">
	<header class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<p class="ux-badge">Panel maestro</p>
			<h1 class="mt-3 text-3xl font-black text-white">Accesos</h1>
		</div>
		<button type="button" class="ux-btn-secondary w-fit" onclick={() => (showEmailPanel = !showEmailPanel)}>
			{showEmailPanel ? 'Ocultar emails' : 'Ver emails'}
		</button>
	</header>

	{#if form?.message}
		<p class={form?.success === true ? 'ux-alert ux-alert-success' : 'ux-alert'}>{form.message}</p>
	{/if}
	{#if data.loadError}
		<p class="ux-alert">{data.loadError}</p>
	{/if}

	<section class="ux-card">
		<div class="flex items-center justify-between gap-3">
			<h2 class="ux-section-title">Alta guiada</h2>
			<span class="ux-badge">{provisionStepLabel}</span>
		</div>

		<div class="mt-5">
			<label class="ux-label" for="provision-email">1. Email</label>
			<input
				id="provision-email"
				class="ux-input"
				type="email"
				placeholder="email@consultorio.com"
				bind:value={provisionEmail}
				oninput={() => {
					provisionDestination = null;
					provisionBusinessId = '';
				}}
			/>
			{#if provisionEmail && !provisionEmailValid}
				<p class="mt-2 text-sm font-bold text-red-200">Email inválido.</p>
			{/if}
		</div>

		{#if provisionEmailValid}
			<div class="mt-4 grid gap-2 md:grid-cols-3">
				<div class="ux-soft-card p-3">
					<p class="text-xs font-black uppercase text-white/40">Email</p>
					<p class="mt-1 font-black text-white">{provisionEmailEnabled ? 'Habilitado' : 'Por habilitar'}</p>
				</div>
				<div class="ux-soft-card p-3">
					<p class="text-xs font-black uppercase text-white/40">Cuenta</p>
					<p class="mt-1 font-black text-white">{provisionAuthExists ? 'Creada' : 'Pendiente'}</p>
				</div>
				<div class="ux-soft-card p-3">
					<p class="text-xs font-black uppercase text-white/40">Destino</p>
					<p class="mt-1 font-black text-white">{provisionPendingInvite ? 'Pendiente' : 'Sin asignar'}</p>
				</div>
			</div>

			{#if provisionPendingInvite}
				<div class="ux-empty mt-5">
					<p class="font-bold text-white">
						Asignación pendiente: {provisionPendingBusiness?.name ?? 'consultorio seleccionado'}.
					</p>
				</div>
			{:else if !provisionDestination}
				<div class="mt-5">
					<p class="ux-label">2. Destino</p>
					<div class="grid gap-3 md:grid-cols-2">
						<button
							type="button"
							class="ux-choice px-4 py-5 text-left"
							onclick={() => {
								provisionDestination = 'existing';
								provisionBusinessId = businesses[0]?.id ?? '';
							}}
						>
							<span class="block text-lg font-black text-white">Consultorio existente</span>
						</button>
						<button
							type="button"
							class="ux-choice px-4 py-5 text-left"
							onclick={() => {
								provisionDestination = 'new';
								provisionBusinessId = '';
							}}
						>
							<span class="block text-lg font-black text-white">Consultorio nuevo</span>
						</button>
					</div>
				</div>
			{:else if provisionDestination === 'existing'}
				<form method="post" action="?/provision_owner_access" class="mt-5 space-y-4">
					<input type="hidden" name="email" value={normalizedProvisionEmail} />
					<input type="hidden" name="destination" value="existing" />
					<div>
						<label class="ux-label" for="provision-business">2. Consultorio</label>
						<select id="provision-business" name="business_id" required class="ux-select" bind:value={provisionBusinessId}>
							<option value="" disabled>Elegí consultorio</option>
							{#each businesses as business}
								<option value={business.id}>{business.name}</option>
							{/each}
						</select>
					</div>
					<input name="note" class="ux-input" placeholder="Nota interna opcional" bind:value={provisionNote} />
					<div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
						<button type="button" class="ux-btn-secondary" onclick={() => (provisionDestination = null)}>
							Volver
						</button>
						<button class="ux-btn-primary" disabled={!provisionBusinessId}>
							{provisionEmailEnabled
								? provisionAuthExists
									? 'Asignar'
									: 'Crear invitación'
								: provisionAuthExists
									? 'Habilitar y asignar'
									: 'Habilitar e invitar'}
						</button>
					</div>
				</form>
			{:else}
				<form method="post" action="?/provision_owner_access" class="mt-5 space-y-4">
					<input type="hidden" name="email" value={normalizedProvisionEmail} />
					<input type="hidden" name="destination" value="new" />
					<div>
						<label class="ux-label" for="provision-business-name">2. Nuevo consultorio</label>
						<input
							id="provision-business-name"
							name="business_name"
							required
							class="ux-input"
							placeholder="Nombre del consultorio"
							bind:value={provisionBusinessName}
						/>
					</div>
					<select name="duration" required class="ux-select" bind:value={provisionDuration}>
						{#each durationOptions as option}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
					<input name="note" class="ux-input" placeholder="Nota interna opcional" bind:value={provisionNote} />
					<div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
						<button type="button" class="ux-btn-secondary" onclick={() => (provisionDestination = null)}>
							Volver
						</button>
						<button class="ux-btn-primary" disabled={!provisionBusinessName.trim()}>
							{provisionAuthExists ? 'Habilitar y crear' : 'Habilitar, crear e invitar'}
						</button>
					</div>
				</form>
			{/if}
		{/if}
	</section>

	{#if showEmailPanel}
		<section class="ux-card">
			<h2 class="ux-section-title">Emails</h2>
			<div class="mt-5 max-h-80 space-y-2 overflow-auto pr-1">
				{#each emails as item}
					<div class="ux-soft-card p-3">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="truncate text-sm font-bold text-white">{item.email}</p>
								<span class={item.enabled ? 'ux-badge ux-badge-success mt-2' : 'ux-badge ux-badge-danger mt-2'}>
									{item.enabled ? 'Habilitado' : 'Deshabilitado'}
								</span>
							</div>
							{#if item.enabled}
								<button
									type="button"
									class="ux-btn-danger px-3 py-2 text-xs"
									onclick={() => {
										disableEmailTarget = item;
										disableReason = '';
									}}
								>
									Deshabilitar
								</button>
							{:else}
								<form method="post" action="?/toggle_email">
									<input type="hidden" name="id" value={item.id} />
									<input type="hidden" name="enabled" value="true" />
									<button class="ux-btn-secondary px-3 py-2 text-xs">Habilitar</button>
								</form>
							{/if}
						</div>
					</div>
				{:else}
					<p class="ux-empty">Sin emails registrados.</p>
				{/each}
			</div>
		</section>
	{/if}

	<section class="ux-card">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
			<div>
				<h2 class="ux-section-title">Consultorios</h2>
			</div>
			<span class="ux-badge">{filteredBusinesses.length} consultorios</span>
		</div>

		<div class="mt-5">
			<input class="ux-input" placeholder="Buscar consultorio, slug o email..." bind:value={search} />
		</div>

		<div class="mt-5 grid gap-3 md:grid-cols-4">
			{#each [
				['all', 'Todos'],
				['active', 'Activo'],
				['expiring', 'Vence pronto'],
				['grace', 'Vencido'],
				['restricted', 'Suspendido'],
				['archived', 'Archivado'],
				['permanent', 'Permanente'],
				['disabled', 'Deshabilitado']
			] as tab}
				<button
					type="button"
					class={activeTab === tab[0] ? 'ux-choice ux-choice-active px-4 py-3 text-sm font-bold' : 'ux-choice px-4 py-3 text-sm font-bold'}
					onclick={() => (activeTab = tab[0])}
				>
					{tab[1]}
				</button>
			{/each}
		</div>
	</section>

	<div class="space-y-4">
		{#if filteredBusinesses.length === 0}
			<p class="ux-empty">No hay consultorios para este filtro.</p>
		{/if}

		{#each filteredBusinesses as business}
			<article class="ux-card">
				<div class="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-3">
							<h2 class="text-2xl font-black text-white">{business.name}</h2>
							<span class={statusClass(business)}>{statusLabel(business)}</span>
						</div>
						<p class="mt-2 text-sm text-white/55">/{business.slug}</p>
						<p class="mt-3 text-sm text-white/70">
							Owner: <span class="font-bold text-white">{business.primaryOwnerEmail ?? 'Sin owner detectado'}</span>
						</p>
					</div>
					<div class="grid gap-3 text-sm text-white/65 sm:grid-cols-3 xl:min-w-[34rem]">
						<div class="ux-soft-card p-4">
							<p class="font-bold text-white/45">Vence</p>
							<p class="mt-1 font-bold text-white">{business.access.isPermanent ? 'No vence' : formatDateTime(business.access.paidUntil)}</p>
						</div>
						<div class="ux-soft-card p-4">
							<p class="font-bold text-white/45">Restricción</p>
							<p class="mt-1 font-bold text-white">{formatDateTime(business.access.graceUntil)}</p>
						</div>
						<div class="ux-soft-card p-4">
							<p class="font-bold text-white/45">Archivo</p>
							<p class="mt-1 font-bold text-white">{formatDateTime(business.access.restrictedUntil)}</p>
						</div>
					</div>
				</div>

				<div class="mt-5 flex justify-end">
					<button
						type="button"
						class="ux-btn-secondary"
						onclick={() => {
							expandedBusinessId = expandedBusinessId === business.id ? null : business.id;
						}}
					>
						{expandedBusinessId === business.id ? 'Cerrar gestión' : 'Gestionar'}
					</button>
				</div>

				{#if expandedBusinessId === business.id}
					<div class="mt-5 rounded-3xl border border-white/10 bg-white/[0.035] p-4">
						<h3 class="text-lg font-black text-white">Ajustar acceso</h3>
						<form
							id={`business-access-${business.id}`}
							method="post"
							action="?/adjust_business_access"
							class="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr_1fr_1fr_auto]"
							onsubmit={(event) => beforeSubmit(event, business)}
						>
							<input type="hidden" name="business_id" value={business.id} />
							<input type="hidden" name="idempotency_key" value="" />
							<select name="operation" class="ux-select">
								{#each operationOptions as option}
									<option value={option.value}>{option.label}</option>
								{/each}
							</select>
							<select name="duration" class="ux-select">
								{#each durationOptions as option}
									<option value={option.value}>{option.label}</option>
								{/each}
							</select>
							<input name="amount" type="text" inputmode="numeric" class="ux-input" placeholder="Monto opcional" oninput={handleMoneyInput} />
							<input name="note" class="ux-input" placeholder="Nota interna" />
							<button class="ux-btn-primary">Aplicar</button>
						</form>

						<div class="mt-5 grid gap-3 md:grid-cols-3">
							<form id={`business-toggle-${business.id}`} method="post" action="?/adjust_business_access" onsubmit={(event) => beforeSubmit(event, business)}>
								<input type="hidden" name="business_id" value={business.id} />
								<input type="hidden" name="operation" value={business.access.commercialAccessEnabled ? 'disable_business_access' : 'enable_business_access'} />
								<input type="hidden" name="duration" value="hour_1" />
								<input type="hidden" name="idempotency_key" value="" />
								<button class={business.access.commercialAccessEnabled ? 'ux-btn-danger w-full' : 'ux-btn-secondary w-full'}>
									{business.access.commercialAccessEnabled ? 'Deshabilitar negocio' : 'Habilitar negocio'}
								</button>
							</form>
							<form id={`business-sessions-${business.id}`} method="post" action="?/revoke_business_sessions" onsubmit={(event) => beforeSessionsSubmit(event, business)}>
								<input type="hidden" name="business_id" value={business.id} />
								<button class="ux-btn-secondary w-full">Cerrar sesiones</button>
							</form>
							<button
								type="button"
								class="ux-btn-secondary w-full"
								onclick={() => {
									showHistory = { ...showHistory, [business.id]: !showHistory[business.id] };
								}}
							>
								{showHistory[business.id] ? 'Ocultar historial' : 'Ver historial'}
							</button>
						</div>

						{#if showHistory[business.id]}
							<div class="mt-5 space-y-3">
								{#if business.recentGrants.length === 0}
									<p class="ux-empty">Sin movimientos comerciales registrados.</p>
								{:else}
									{#each business.recentGrants as grant}
										<div class="ux-soft-card p-4">
											<div class="flex flex-wrap items-center justify-between gap-3">
												<p class="font-bold text-white">{grant.operation}</p>
												<time class="text-sm text-white/50">{formatDateTime(grant.created_at)}</time>
											</div>
											<p class="mt-2 text-sm text-white/60">
												{grant.admin_email ?? 'admin'} · {grant.source ?? 'manual'} · {money(grant.amount)}
											</p>
											{#if grant.note}
												<p class="mt-2 text-sm text-white/70">{grant.note}</p>
											{/if}
										</div>
									{/each}
								{/if}
							</div>
						{/if}
					</div>
				{/if}
			</article>
		{/each}
	</div>
</section>

<Modal open={Boolean(disableEmailTarget)} title="Deshabilitar email" on:close={() => (disableEmailTarget = null)} dismissible>
	<div class="space-y-4 text-sm text-neutral-800 dark:text-neutral-100">
		<p>
			Vas a deshabilitar el acceso global de
			<span class="font-semibold">{disableEmailTarget?.email ?? ''}</span>.
		</p>
		<input class="ux-input" placeholder="Motivo interno opcional" bind:value={disableReason} />
		<div class="flex justify-end gap-3">
			<button class="ux-btn-secondary" type="button" onclick={() => (disableEmailTarget = null)}>Cancelar</button>
			<form method="post" action="?/toggle_email">
				<input type="hidden" name="id" value={disableEmailTarget?.id ?? ''} />
				<input type="hidden" name="enabled" value="false" />
				<input type="hidden" name="reason" value={disableReason} />
				<button class="ux-btn-danger">Deshabilitar</button>
			</form>
		</div>
	</div>
</Modal>

<Modal open={Boolean(confirmModal)} title={confirmModal?.title ?? 'Confirmar'} on:close={() => (confirmModal = null)} dismissible>
	<div class="space-y-4 text-sm text-neutral-800 dark:text-neutral-100">
		<p>{confirmModal?.body}</p>
		{#if confirmModal?.tone === 'danger'}
			<p class="ux-alert">Esta acción puede cortar acceso operativo. Revisá antes de confirmar.</p>
		{:else if confirmModal?.tone === 'warning'}
			<p class="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-3 text-amber-100">
				Este ajuste cambia la licencia comercial del consultorio.
			</p>
		{/if}
		<div class="flex justify-end gap-3">
			<button class="ux-btn-secondary" type="button" onclick={() => (confirmModal = null)}>Cancelar</button>
			<button class={confirmModal?.tone === 'danger' ? 'ux-btn-danger' : 'ux-btn-primary'} type="button" onclick={confirmSubmit}>
				{confirmModal?.confirm ?? 'Confirmar'}
			</button>
		</div>
	</div>
</Modal>
