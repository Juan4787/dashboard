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

	let { data, form } = $props<{
		data: {
			context: BusinessContext;
			members: Member[];
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

	const members = $derived(data.members as Member[]);
	const roles = $derived(data.roles as readonly BusinessRole[]);
	const canManage = $derived(data.context.canManage && !data.demo);

	const formatDate = (value: string) =>
		value
			? new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value))
			: 'Sin fecha';
</script>

<section class="ux-page">
	<div class="ux-hero">
		<BackLink href="/odonto/configuracion" label="Volver" class="mb-5" />
		<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<p class="ux-badge">Permisos</p>
				<h1 class="ux-title mt-4">Usuarios</h1>
				<p class="ux-subtitle">Quién entra al panel y qué puede hacer.</p>
			</div>
			<div class="ux-soft-card min-w-32 p-5 text-center">
				<p class="text-sm font-bold text-white/55">Usuarios</p>
				<p class="mt-1 text-4xl font-bold text-white">{members.length}</p>
			</div>
		</div>
	</div>

	{#if form?.message}
		<p class={form.success ? 'ux-alert ux-alert-success' : 'ux-alert'}>{form.message}</p>
	{/if}
	{#if data.demo}
		<p class="ux-empty">Los usuarios no se modifican en modo demo.</p>
	{:else if !data.context.canManage}
		<p class="ux-empty">Tu permiso actual permite ver usuarios, pero no administrarlos.</p>
	{/if}

	<form method="POST" action="?/add_user" class="ux-card">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h2 class="ux-section-title">Agregar usuario</h2>
				<p class="mt-1 text-sm text-white/55">El correo ya debe tener una cuenta creada.</p>
			</div>
			<button type="submit" disabled={!canManage} class="ux-btn-primary">Agregar</button>
		</div>
		<div class="mt-5 grid gap-4 lg:grid-cols-[1fr_260px]">
			<label>
				<span class="ux-label">Correo</span>
				<input name="email" type="email" autocomplete="email" value={String(form?.values?.email ?? '')} placeholder="usuario@consultorio.com" disabled={!canManage} class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Permiso</span>
				<select name="role" disabled={!canManage} class="ux-select">
					{#each roles as role}
						<option value={role} selected={String(form?.values?.role ?? 'reception') === role}>{roleLabels[role]}</option>
					{/each}
				</select>
			</label>
		</div>
	</form>

	<div class="grid gap-4">
		{#each members as member}
			<article class="ux-card">
				<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-2">
							<h2 class="truncate text-xl font-bold text-white">{member.email ?? 'Usuario sin correo'}</h2>
							{#if member.user_id === data.currentUserId}
								<span class="ux-badge">Vos</span>
							{/if}
						</div>
						<p class="mt-2 text-sm text-white/55">{roleLabels[member.role]} · agregado el {formatDate(member.created_at)}</p>
					</div>

					<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
						<form method="POST" action="?/update_role" class="flex gap-2">
							<input type="hidden" name="membership_id" value={member.id} />
							<select name="role" disabled={!canManage} class="ux-select min-w-44">
								{#each roles as role}
									<option value={role} selected={member.role === role}>{roleLabels[role]}</option>
								{/each}
							</select>
							<button type="submit" disabled={!canManage} class="ux-btn-secondary">Guardar</button>
						</form>
						<form method="POST" action="?/remove_user">
							<input type="hidden" name="membership_id" value={member.id} />
							<button type="submit" disabled={!canManage || member.user_id === data.currentUserId} class="ux-btn-danger">
								Quitar
							</button>
						</form>
					</div>
				</div>
			</article>
		{/each}
	</div>
</section>
