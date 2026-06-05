<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import type { BusinessContext, BusinessRole } from '$lib/server/business';

	type Member = {
		id: string;
		business_id: string;
		user_id: string;
		email: string | null;
		role: BusinessRole;
		created_at: string;
	};

	type PendingInvite = {
		id: string;
		email: string;
		role: BusinessRole;
		professional_id: string | null;
		expires_at: string;
		created_at: string;
	};

	type RoleProfessional = {
		id: string;
		name: string;
		email: string | null;
		profile_status: 'incomplete' | 'complete';
		name_source: 'manual' | 'email_placeholder';
		is_active: boolean;
		is_public: boolean;
	};

	let { data, form } = $props<{
		data: {
			context: BusinessContext;
			members: Member[];
			pendingInvites: PendingInvite[];
			professionals: RoleProfessional[];
			roles: readonly BusinessRole[];
			currentUserId: string | null;
			demo: boolean;
		};
		form?: {
			intent?: 'add_user' | 'update_role' | 'remove_user';
			success?: boolean;
			message?: string;
			values?: Record<string, FormDataEntryValue>;
		};
	}>();

	const roleLabels: Record<BusinessRole, string> = {
		owner: 'Dueño',
		admin: 'Administrador',
		reception: 'Recepción',
		professional: 'Profesional',
		readonly: 'Solo lectura'
	};

	const members = $derived(data.members as Member[]);
	const pendingInvites = $derived(data.pendingInvites as PendingInvite[]);
	const roles = $derived(data.roles.filter((role: BusinessRole) => role !== 'readonly') as readonly BusinessRole[]);
	const professionals = $derived(data.professionals as RoleProfessional[]);
	const canManage = $derived(Boolean(data.context.capabilities?.canManageUsers) && !data.demo);
	const isOwner = $derived(data.context.role === 'owner');
	const isAdmin = $derived(data.context.role === 'admin');

	let addStep = $state<1 | 2 | 3>(1);
	let emailInput = $state('');
	let selectedRole = $state<BusinessRole>('reception');
	let professionalMode = $state('existing');
	let selectedProfessionalId = $state('');
	let restoredFormValues = $state(false);

	const emailIsValid = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.trim()));
	const effectiveProfessionalMode = $derived(
		selectedRole === 'professional' && professionals.length === 0 ? 'new' : professionalMode
	);
	const addFormMessage = $derived(form?.intent === 'add_user' ? form.message : '');
	const pageMessage = $derived(form?.intent !== 'add_user' ? form?.message : '');

	const addSubmitLabel = $derived.by(() => {
		if (selectedRole === 'professional') {
			return effectiveProfessionalMode === 'new'
				? 'Crear perfil y habilitar email'
				: 'Asignar profesional y habilitar email';
		}
		return 'Habilitar email';
	});

	$effect(() => {
		if (!restoredFormValues && form?.values) {
			if (form.values.email) emailInput = String(form.values.email);
			const formRole = String(form.values.role ?? '');
			if (formRole && roles.includes(formRole as BusinessRole)) selectedRole = formRole as BusinessRole;
			if (form.values.professional_mode) professionalMode = String(form.values.professional_mode);
			if (form.values.professional_id) selectedProfessionalId = String(form.values.professional_id);
			restoredFormValues = true;
		}
		if (!roles.includes(selectedRole)) selectedRole = roles[0] ?? 'reception';
		if (selectedRole === 'professional' && professionals.length === 0) {
			professionalMode = 'new';
			selectedProfessionalId = '';
		}
		if (selectedRole === 'professional' && professionals.length > 0 && !selectedProfessionalId) {
			selectedProfessionalId = professionals[0].id;
		}
	});

	const formatDate = (value: string) =>
		value
			? new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value))
			: 'Sin fecha';

	const memberRoleChoices = (member: Member): readonly BusinessRole[] => {
		const base = roles.filter((role) => role !== 'professional');
		if (member.role === 'professional') return [...base, 'professional'];
		if (isOwner) return base;
		if (isAdmin && member.role === 'reception') return base;
		return [member.role];
	};

	const canEditMember = (member: Member) =>
		canManage && (isOwner || (isAdmin && (member.role === 'reception' || member.role === 'professional')));

	const canRemoveMember = (member: Member) =>
		canEditMember(member) && member.user_id !== data.currentUserId;

	const professionalLabel = (professionalId: string | null) => {
		const professional = professionals.find((item) => item.id === professionalId);
		if (!professional) return 'Perfil pendiente';
		return professional.name_source === 'email_placeholder' ? `${professional.email ?? professional.name} · incompleto` : professional.name;
	};
</script>

<section class="ux-page">
	<div class="ux-hero">
		<BackLink href="/odonto/configuracion" label="Volver" class="mb-5" />
		<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<p class="ux-badge">Roles</p>
				<h1 class="ux-title mt-4">Accesos</h1>
			</div>
			<div class="ux-soft-card min-w-36 p-5 text-center">
				<p class="text-sm font-bold text-white/55">Activos</p>
				<p class="mt-1 text-4xl font-bold text-white">{members.length}</p>
			</div>
		</div>
	</div>

	{#if pageMessage}
		<p class={form?.success ? 'ux-alert ux-alert-success' : 'ux-alert'}>{pageMessage}</p>
	{/if}
	{#if data.demo}
		<p class="ux-empty">Los roles no se modifican en modo demo.</p>
	{:else if !data.context.capabilities?.canManageUsers}
		<p class="ux-empty">Tu rol actual permite ver accesos, pero no administrarlos.</p>
	{/if}

	<form method="POST" action="?/add_user" class="ux-card">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<h2 class="ux-section-title">Nuevo acceso</h2>
			</div>
			<div class="flex gap-2">
				{#each [1, 2, 3] as step}
					<span class={`grid h-8 w-8 place-items-center rounded-full text-sm font-black ${addStep >= step ? 'bg-[#7c3aed] text-white' : 'bg-white/10 text-white/45'}`}>{step}</span>
				{/each}
			</div>
		</div>

		<input type="hidden" name="role" value={selectedRole} />
		<input type="hidden" name="professional_mode" value={effectiveProfessionalMode} />
		<input type="hidden" name="email" value={emailInput.trim()} />

		{#if addStep === 1}
			<div class="mt-5 grid gap-4">
				<label>
					<span class="ux-label">Email</span>
					<input type="email" autocomplete="email" bind:value={emailInput} placeholder="persona@consultorio.com" disabled={!canManage} class="ux-input" />
				</label>
				{#if addFormMessage}
					<p class={form?.success ? 'ux-alert ux-alert-success' : 'ux-alert'}>{addFormMessage}</p>
				{/if}
				<button type="button" disabled={!canManage || !emailIsValid} class="ux-btn-primary" onclick={() => (addStep = 2)}>Siguiente</button>
			</div>
		{:else if addStep === 2}
			<div class="mt-5 grid gap-3 sm:grid-cols-2">
				{#each roles as role}
					<button type="button" class={`ux-choice p-5 text-left ${selectedRole === role ? 'ux-choice-active' : ''}`} disabled={!canManage} onclick={() => (selectedRole = role)}>
						<span class="block text-lg font-black text-white">{roleLabels[role]}</span>
					</button>
				{/each}
			</div>
			<div class="mt-5 flex gap-3">
				<button type="button" class="ux-btn-secondary" onclick={() => (addStep = 1)}>Atrás</button>
				<button type="button" class="ux-btn-primary flex-1" disabled={!canManage} onclick={() => (addStep = 3)}>Siguiente</button>
			</div>
		{:else}
			{#if selectedRole === 'professional'}
				<div class="mt-5 grid gap-3 sm:grid-cols-2">
					<button type="button" class={`ux-choice p-5 text-left ${effectiveProfessionalMode === 'existing' ? 'ux-choice-active' : ''}`} disabled={!canManage || professionals.length === 0} onclick={() => (professionalMode = 'existing')}>
						<span class="block text-lg font-black text-white">Profesional existente</span>
					</button>
					<button type="button" class={`ux-choice p-5 text-left ${effectiveProfessionalMode === 'new' ? 'ux-choice-active' : ''}`} disabled={!canManage} onclick={() => (professionalMode = 'new')}>
						<span class="block text-lg font-black text-white">Profesional nuevo</span>
					</button>
				</div>
				{#if effectiveProfessionalMode === 'existing'}
					<label class="mt-5 block">
						<span class="ux-label">Profesional</span>
						<select name="professional_id" bind:value={selectedProfessionalId} disabled={!canManage || professionals.length === 0} class="ux-select">
							{#each professionals as professional}
								<option value={professional.id}>{professionalLabel(professional.id)}</option>
							{/each}
						</select>
					</label>
				{:else}
					<p class="ux-empty mt-5">Se crea un perfil profesional incompleto y el email queda habilitado para crear la cuenta.</p>
				{/if}
			{:else}
				<p class="ux-empty mt-5">{roleLabels[selectedRole]} queda listo con este email.</p>
			{/if}
			<div class="mt-5 flex gap-3">
				<button type="button" class="ux-btn-secondary" onclick={() => (addStep = 2)}>Atrás</button>
				<button type="submit" disabled={!canManage || (selectedRole === 'professional' && effectiveProfessionalMode === 'existing' && !selectedProfessionalId)} class="ux-btn-primary flex-1">
					{addSubmitLabel}
				</button>
			</div>
		{/if}
	</form>

	{#if pendingInvites.length > 0}
		<section class="ux-card">
			<h2 class="ux-section-title">Pendientes</h2>
			<div class="mt-5 grid gap-3">
				{#each pendingInvites as invite}
					<div class="ux-choice p-5">
						<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
							<div class="min-w-0">
								<p class="truncate text-lg font-black text-white">{invite.email}</p>
								<p class="mt-1 text-sm text-white/55">{roleLabels[invite.role]} · vence el {formatDate(invite.expires_at)}</p>
							</div>
							{#if invite.role === 'professional'}
								<span class="ux-badge">{professionalLabel(invite.professional_id)}</span>
							{:else}
								<span class="ux-badge">Pendiente</span>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<div class="grid gap-4">
		{#each members as member}
			<article class="ux-card">
				<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-2">
							<h2 class="truncate text-xl font-bold text-white">{member.email ?? 'Email no disponible'}</h2>
							{#if member.user_id === data.currentUserId}
								<span class="ux-badge">Vos</span>
							{/if}
						</div>
						<p class="mt-2 text-sm text-white/55">{roleLabels[member.role]} · {formatDate(member.created_at)}</p>
					</div>

					<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
						<form method="POST" action="?/update_role" class="flex gap-2">
							<input type="hidden" name="membership_id" value={member.id} />
							<select name="role" disabled={!canEditMember(member)} class="ux-select min-w-44">
								{#each memberRoleChoices(member) as role}
									<option value={role} selected={member.role === role}>{roleLabels[role]}</option>
								{/each}
							</select>
							<button type="submit" disabled={!canEditMember(member)} class="ux-btn-secondary">Guardar</button>
						</form>
						<form method="POST" action="?/remove_user">
							<input type="hidden" name="membership_id" value={member.id} />
							<button type="submit" disabled={!canRemoveMember(member)} class="ux-btn-danger">Quitar</button>
						</form>
					</div>
				</div>
			</article>
		{/each}
	</div>
</section>
