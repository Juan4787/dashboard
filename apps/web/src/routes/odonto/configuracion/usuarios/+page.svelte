<script lang="ts">
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
		form?: {
			success?: boolean;
			message?: string;
			values?: Record<string, FormDataEntryValue>;
		};
	}>();

	const roleLabels: Record<BusinessRole, string> = {
		owner: 'Owner',
		admin: 'Admin',
		reception: 'Recepción',
		professional: 'Profesional',
		readonly: 'Solo lectura'
	};

	const roleDescriptions: Record<BusinessRole, string> = {
		owner: 'Control total del negocio y usuarios.',
		admin: 'Administra configuración y usuarios.',
		reception: 'Opera agenda, pacientes y mensajes.',
		professional: 'Acceso limitado a sus propios turnos.',
		readonly: 'Consulta datos sin modificar.'
	};

	const members = $derived(data.members as Member[]);
	const roles = $derived(data.roles as readonly BusinessRole[]);
	const canManage = $derived(data.context.canManage && !data.demo);

	const formatDate = (value: string) => {
		if (!value) return 'Sin fecha';
		return new Intl.DateTimeFormat('es-AR', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric'
		}).format(new Date(value));
	};
</script>

<section class="flex flex-col gap-6">
	<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<a
			href="/odonto/configuracion"
			class="text-xs font-semibold uppercase tracking-wide text-[#7c3aed] hover:underline"
		>
			Volver a configuración
		</a>
		<div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
			<div>
				<h1 class="text-2xl font-semibold text-neutral-900 dark:text-white">Usuarios y roles</h1>
				<p class="mt-2 max-w-2xl text-sm text-neutral-600 dark:text-neutral-200">
					Administrá quién puede entrar a {data.context.business.name} y qué permisos tiene dentro
					del panel.
				</p>
			</div>
			<span class="w-fit rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-700 dark:bg-[#0f1f36] dark:text-neutral-200">
				{members.length} usuarios
			</span>
		</div>
	</div>

	{#if form?.message}
		<p
			class={`rounded-xl border px-4 py-3 text-sm ${
				form.success
					? 'border-emerald-200 bg-emerald-50 text-emerald-900'
					: 'border-red-200 bg-red-50 text-red-800'
			}`}
		>
			{form.message}
		</p>
	{/if}

	{#if data.demo}
		<p class="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
			Los usuarios no se modifican en modo demo.
		</p>
	{:else if !data.context.canManage}
		<p class="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
			Tu rol actual permite ver usuarios, pero no administrarlos.
		</p>
	{/if}

	<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Agregar usuario</h2>
		<form method="POST" action="?/add_user" class="mt-4 grid gap-4 lg:grid-cols-[1fr_220px_auto]">
			<label class="flex flex-col gap-1">
				<span class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">
					Email
				</span>
				<input
					name="email"
					type="email"
					autocomplete="email"
					value={String(form?.values?.email ?? '')}
					placeholder="usuario@consultorio.com"
					disabled={!canManage}
					class="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 disabled:cursor-not-allowed disabled:bg-neutral-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:disabled:bg-[#182842]"
				/>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">
					Rol
				</span>
				<select
					name="role"
					disabled={!canManage}
					class="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 disabled:cursor-not-allowed disabled:bg-neutral-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:disabled:bg-[#182842]"
				>
					{#each roles as role}
						<option value={role} selected={String(form?.values?.role ?? 'reception') === role}>
							{roleLabels[role]}
						</option>
					{/each}
				</select>
			</label>
			<button
				type="submit"
				disabled={!canManage}
				class="self-end rounded-full bg-[#7c3aed] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#6d28d9] disabled:cursor-not-allowed disabled:opacity-60"
			>
				Agregar
			</button>
		</form>
		<p class="mt-3 text-xs text-neutral-500 dark:text-neutral-300">
			Por seguridad, el email ya debe tener una cuenta creada en el sistema.
		</p>
	</div>

	<div class="grid gap-4">
		{#each members as member}
			<article class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642]">
				<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-2">
							<h2 class="truncate text-base font-semibold text-neutral-900 dark:text-white">
								{member.email ?? 'Usuario sin email'}
							</h2>
							{#if member.user_id === data.currentUserId}
								<span class="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">
									Vos
								</span>
							{/if}
						</div>
						<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-200">
							{roleLabels[member.role]} · {roleDescriptions[member.role]}
						</p>
						<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-300">
							Agregado el {formatDate(member.created_at)}
						</p>
					</div>

					<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
						<form method="POST" action="?/update_role" class="flex gap-2">
							<input type="hidden" name="membership_id" value={member.id} />
							<select
								name="role"
								disabled={!canManage}
								class="min-w-40 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 disabled:cursor-not-allowed disabled:bg-neutral-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-neutral-100"
							>
								{#each roles as role}
									<option value={role} selected={member.role === role}>{roleLabels[role]}</option>
								{/each}
							</select>
							<button
								type="submit"
								disabled={!canManage}
								class="rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#1f3554] dark:text-neutral-100 dark:hover:bg-[#0f1f36]"
							>
								Guardar
							</button>
						</form>
						<form method="POST" action="?/remove_user">
							<input type="hidden" name="membership_id" value={member.id} />
							<button
								type="submit"
								disabled={!canManage || member.user_id === data.currentUserId}
								class="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/70 dark:text-red-200 dark:hover:bg-red-950/30"
							>
								Quitar
							</button>
						</form>
					</div>
				</div>
			</article>
		{/each}
	</div>
</section>
