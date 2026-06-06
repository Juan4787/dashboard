<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import type { BusinessContext, BusinessRole } from '$lib/server/business';

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

	type Professional = {
		id: string;
		name: string;
		email: string | null;
		is_active: boolean;
		is_public: boolean;
	};

	let { data, form } = $props<{
		data: {
			context: BusinessContext;
			members: RoleAccess[];
			professionals: Professional[];
			roles: readonly BusinessRole[];
			currentUserId: string | null;
			demo: boolean;
		};
		form?: { success?: boolean; message?: string; values?: Record<string, FormDataEntryValue> };
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
		professional: 'Accede a sus pacientes y turnos.',
		readonly: 'Sólo consulta información.'
	};

	const members = $derived(data.members as RoleAccess[]);
	const roles = $derived(data.roles as readonly BusinessRole[]);
	const professionals = $derived(data.professionals as Professional[]);
	const canManage = $derived(data.context.canManage && !data.demo);
	const activeCount = $derived(members.filter((member) => member.status === 'active').length);
	let step = $state(1);
	let email = $state('');
	let role = $state<BusinessRole>('reception');
	let professionalMode = $state<'existing' | 'new'>('existing');
	let professionalId = $state('');
	let professionalName = $state('');

	$effect(() => {
		if (form?.values?.email) email = String(form.values.email);
		if (form?.values?.role && roles.includes(String(form.values.role) as BusinessRole)) {
			role = String(form.values.role) as BusinessRole;
		}
		if (form?.values?.professional_id) professionalId = String(form.values.professional_id);
		if (form?.values?.professional_name) professionalName = String(form.values.professional_name);
	});

	const formatDate = (value: string) =>
		value
			? new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value))
			: 'Sin fecha';

	const nextStep = () => {
		if (step === 1) {
			step = 2;
			return;
		}
		if (step === 2) {
			step = role === 'professional' ? 3 : 4;
			return;
		}
		if (step === 3) step = 4;
	};

	const previousStep = () => {
		if (step === 4 && role !== 'professional') {
			step = 2;
			return;
		}
		step = Math.max(1, step - 1);
	};

	const selectedProfessional = $derived(professionals.find((item) => item.id === professionalId) ?? null);
	const professionalAccessById = $derived(
		new Map(
			members
				.filter((member): member is RoleAccess & { professional_id: string } => Boolean(member.professional_id))
				.map((member) => [member.professional_id, member])
		)
	);
</script>

<section class="ux-page">
	<div class="ux-hero">
		<BackLink href="/odonto/configuracion" label="Volver" class="mb-5" />
		<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<h1 class="ux-title">Roles</h1>
			</div>
			<div class="ux-soft-card min-w-32 p-5 text-center">
				<p class="text-sm font-bold text-white/55">Activos</p>
				<p class="mt-1 text-4xl font-bold text-white">{activeCount}</p>
			</div>
		</div>
	</div>

	{#if form?.message}
		<p class={form.success ? 'ux-alert ux-alert-success' : 'ux-alert'}>{form.message}</p>
	{/if}
	{#if data.demo}
		<p class="ux-empty">Los roles no se modifican en modo demo.</p>
	{:else if !data.context.canManage}
		<p class="ux-empty">Tu permiso actual permite ver roles, pero no administrarlos.</p>
	{/if}

	<form method="POST" action="?/add_user" class="ux-card">
		<div class="flex items-center justify-between gap-4">
			<h2 class="ux-section-title">Asignar rol</h2>
			<div class="flex gap-2">
				{#each [1, 2, 3, 4] as item}
					<span class={`grid h-8 w-8 place-items-center rounded-full text-sm font-black ${step === item ? 'bg-[#7c3aed] text-white' : 'bg-white/10 text-white/45'}`}>
						{item}
					</span>
				{/each}
			</div>
		</div>

		<input type="hidden" name="email" value={email} />
		<input type="hidden" name="role" value={role} />
		<input type="hidden" name="professional_mode" value={professionalMode} />
		<input type="hidden" name="professional_id" value={professionalId} />
		<input type="hidden" name="professional_name" value={professionalName} />

		{#if step === 1}
			<label class="mt-5 block">
				<span class="ux-label">Email</span>
				<input
					type="email"
					autocomplete="email"
					placeholder="persona@consultorio.com"
					disabled={!canManage}
					class="ux-input"
					bind:value={email}
				/>
			</label>
			<button type="button" disabled={!canManage || !email} class="ux-btn-primary mt-4 w-full" onclick={nextStep}>
				Siguiente
			</button>
		{:else if step === 2}
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
		{:else if step === 3}
			<div class="mt-5 grid gap-3 md:grid-cols-2">
				<button
					type="button"
					class={`rounded-2xl border px-5 py-4 text-left transition ${
						professionalMode === 'existing'
							? 'border-[#7c3aed] bg-[#7c3aed]/20 text-white'
							: 'border-white/10 bg-white/[0.04] text-white/80 hover:border-white/25'
					}`}
					onclick={() => (professionalMode = 'existing')}
				>
					<span class="block text-lg font-black">Profesional existente</span>
					<span class="mt-1 block text-sm text-white/55">Usá un perfil ya cargado en Profesionales.</span>
				</button>
				<button
					type="button"
					class={`rounded-2xl border px-5 py-4 text-left transition ${
						professionalMode === 'new'
							? 'border-[#7c3aed] bg-[#7c3aed]/20 text-white'
							: 'border-white/10 bg-white/[0.04] text-white/80 hover:border-white/25'
					}`}
					onclick={() => (professionalMode = 'new')}
				>
					<span class="block text-lg font-black">Profesional nuevo</span>
					<span class="mt-1 block text-sm text-white/55">Crea el perfil y habilita el email.</span>
				</button>
			</div>

			{#if professionalMode === 'existing'}
				<label class="mt-4 block">
					<span class="ux-label">Profesional</span>
					<select class="ux-select" bind:value={professionalId} disabled={!canManage || professionals.length === 0}>
						<option value="">Seleccionar</option>
						{#each professionals as professional}
							<option value={professional.id}>{professional.name}</option>
						{/each}
					</select>
				</label>
				{#if professionals.length === 0}
					<p class="ux-empty mt-4">No hay profesionales cargados. Usá Profesional nuevo.</p>
				{/if}
			{:else}
				<label class="mt-4 block">
					<span class="ux-label">Nombre del profesional</span>
					<input class="ux-input" placeholder="Nombre y apellido" bind:value={professionalName} disabled={!canManage} />
				</label>
			{/if}

			<div class="mt-4 flex gap-3">
				<button type="button" class="ux-btn-secondary" onclick={previousStep}>Atrás</button>
				<button
					type="button"
					disabled={!canManage || (professionalMode === 'existing' ? !professionalId : !professionalName)}
					class="ux-btn-primary flex-1"
					onclick={nextStep}
				>
					Siguiente
				</button>
			</div>
		{:else}
			<div class="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
				<p class="text-sm font-bold text-white/45">Email</p>
				<p class="mt-1 text-xl font-black text-white">{email}</p>
				<p class="mt-4 text-sm font-bold text-white/45">Rol</p>
				<p class="mt-1 text-xl font-black text-white">{roleLabels[role]}</p>
				{#if role === 'professional'}
					<p class="mt-4 text-sm font-bold text-white/45">Profesional</p>
					<p class="mt-1 text-xl font-black text-white">
						{professionalMode === 'new' ? professionalName : selectedProfessional?.name ?? 'Seleccionar'}
					</p>
				{/if}
			</div>
			<div class="mt-4 flex gap-3">
				<button type="button" class="ux-btn-secondary" onclick={previousStep}>Atrás</button>
				<button type="submit" disabled={!canManage} class="ux-btn-primary flex-1">Guardar rol</button>
			</div>
		{/if}
	</form>

	<div class="grid gap-4">
		{#each members as member}
			<article class="ux-card">
				<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-2">
							<h2 class="truncate text-xl font-bold text-white">{member.email}</h2>
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
						{#if member.status === 'active'}
							<form method="POST" action="?/update_role" class="flex gap-2">
								<input type="hidden" name="membership_id" value={member.id} />
								<select name="role" disabled={!canManage} class="ux-select min-w-44">
									{#each roles as option}
										<option value={option} selected={member.role === option}>{roleLabels[option]}</option>
									{/each}
								</select>
								<button type="submit" disabled={!canManage} class="ux-btn-secondary">Guardar</button>
							</form>
						{/if}
						<form method="POST" action="?/remove_user">
							<input type="hidden" name="access_id" value={member.id} />
							<input type="hidden" name="status" value={member.status} />
							<button type="submit" disabled={!canManage || member.user_id === data.currentUserId} class="ux-btn-danger">
								Quitar
							</button>
						</form>
					</div>
				</div>
			</article>
		{/each}
	</div>

	<div class="ux-card">
		<div>
			<h2 class="ux-section-title">Profesionales</h2>
			<p class="mt-1 text-sm text-white/55">Perfiles que pueden vincularse al rol Profesional.</p>
		</div>
		<div class="mt-5 grid gap-3">
			{#each professionals as professional}
				{@const access = professionalAccessById.get(professional.id)}
				<div class="ux-soft-card p-4">
					<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<h3 class="truncate text-lg font-black text-white">{professional.name}</h3>
								<span class={professional.is_active && professional.is_public ? 'ux-badge ux-badge-success' : 'ux-badge'}>
									{professional.is_active && professional.is_public ? 'Disponible' : 'No disponible'}
								</span>
							</div>
							<p class="mt-1 text-sm text-white/55">{professional.email ?? 'Sin email cargado'}</p>
						</div>
						{#if access}
							<span class={access.status === 'pending' ? 'ux-badge ux-badge-warning' : 'ux-badge ux-badge-success'}>
								{access.status === 'pending' ? 'Rol pendiente' : 'Rol activo'}
							</span>
						{:else}
							<span class="ux-badge">Sin rol</span>
						{/if}
					</div>
				</div>
			{/each}
			{#if professionals.length === 0}
				<div class="ux-empty">Todavía no hay perfiles profesionales cargados.</div>
			{/if}
		</div>
	</div>
</section>
