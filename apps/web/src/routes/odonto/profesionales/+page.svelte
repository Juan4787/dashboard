<script lang="ts">
	type Professional = {
		id: string;
		name: string;
		specialty: string | null;
		phone: string | null;
		email: string | null;
		avatar_url: string | null;
		is_public: boolean;
		is_active: boolean;
		sort_order: number;
	};

	type ProfessionalUser = {
		id: string;
		professional_id: string;
		user_id: string;
	};

	type BusinessUser = {
		user_id: string;
		email: string | null;
		role: string;
	};

	let { data, form } = $props<{
		data: {
			context: { canOperate: boolean };
			professionals: Professional[];
			professionalUsers: ProfessionalUser[];
			businessUsers: BusinessUser[];
			demo: boolean;
		};
		form?: { success?: boolean; message?: string; values?: Record<string, unknown> };
	}>();

	const canOperate = $derived(data.context.canOperate && !data.demo);
	const professionalUsers = $derived(data.professionalUsers as ProfessionalUser[]);
	const businessUsers = $derived(data.businessUsers as BusinessUser[]);
	const linkedUsersFor = (professionalId: string) =>
		professionalUsers.filter((link) => link.professional_id === professionalId);
	const emailFor = (userId: string) =>
		businessUsers.find((user) => user.user_id === userId)?.email ?? 'Usuario sin email';
</script>

<section class="flex flex-col gap-6">
	<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<h1 class="text-2xl font-semibold text-neutral-900 dark:text-white">Profesionales</h1>
		<p class="mt-2 max-w-3xl text-sm text-neutral-600 dark:text-neutral-200">
			Creá los profesionales que atienden y vinculalos con usuarios reales del sistema.
		</p>
	</div>

	{#if form?.message}
		<p class={`rounded-xl px-4 py-3 text-sm font-semibold ${form.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
			{form.message}
		</p>
	{/if}

	<form method="POST" action="?/create_professional" class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<div class="flex flex-col gap-1">
			<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Nuevo profesional</h2>
			<p class="text-sm text-neutral-600 dark:text-neutral-200">Después podés asignarle servicios y horarios.</p>
		</div>
		<div class="mt-4 grid gap-4 md:grid-cols-2">
			<label class="space-y-1">
				<span class="text-sm font-semibold">Nombre</span>
				<input name="name" required disabled={!canOperate} value={String(form?.values?.name ?? '')} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
			<label class="space-y-1">
				<span class="text-sm font-semibold">Especialidad</span>
				<input name="specialty" disabled={!canOperate} value={String(form?.values?.specialty ?? '')} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
			<label class="space-y-1">
				<span class="text-sm font-semibold">Teléfono</span>
				<input name="phone" disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
			<label class="space-y-1">
				<span class="text-sm font-semibold">Email</span>
				<input name="email" type="email" disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
			<label class="space-y-1">
				<span class="text-sm font-semibold">Avatar URL</span>
				<input name="avatar_url" disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
			<label class="space-y-1">
				<span class="text-sm font-semibold">Orden</span>
				<input name="sort_order" type="number" value="0" disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
			</label>
		</div>
		<div class="mt-4 flex flex-wrap gap-3">
			<label class="flex items-center gap-2 rounded-xl border border-neutral-200 px-4 py-3 text-sm font-semibold dark:border-[#1f3554]">
				<input type="checkbox" name="is_public" value="true" checked disabled={!canOperate} class="accent-[#7c3aed]" />
				Visible público
			</label>
			<label class="flex items-center gap-2 rounded-xl border border-neutral-200 px-4 py-3 text-sm font-semibold dark:border-[#1f3554]">
				<input type="checkbox" name="is_active" value="true" checked disabled={!canOperate} class="accent-[#7c3aed]" />
				Activo
			</label>
		</div>
		<div class="mt-5 flex justify-end">
			<button type="submit" disabled={!canOperate} class="rounded-xl bg-[#7c3aed] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">
				Crear profesional
			</button>
		</div>
	</form>

	<div class="grid gap-4">
		{#each data.professionals as professional}
			<article class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642]">
				<form method="POST" action="?/update_professional" class="grid gap-4 lg:grid-cols-[1fr_auto]">
					<input type="hidden" name="professional_id" value={professional.id} />
					<div class="grid gap-4 md:grid-cols-2">
						<label class="space-y-1">
							<span class="text-sm font-semibold">Nombre</span>
							<input name="name" value={professional.name} disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
						</label>
						<label class="space-y-1">
							<span class="text-sm font-semibold">Especialidad</span>
							<input name="specialty" value={professional.specialty ?? ''} disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
						</label>
						<label class="space-y-1">
							<span class="text-sm font-semibold">Teléfono</span>
							<input name="phone" value={professional.phone ?? ''} disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
						</label>
						<label class="space-y-1">
							<span class="text-sm font-semibold">Email</span>
							<input name="email" value={professional.email ?? ''} disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
						</label>
						<label class="space-y-1">
							<span class="text-sm font-semibold">Orden</span>
							<input name="sort_order" type="number" value={professional.sort_order} disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
						</label>
						<label class="space-y-1">
							<span class="text-sm font-semibold">Avatar URL</span>
							<input name="avatar_url" value={professional.avatar_url ?? ''} disabled={!canOperate} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]" />
						</label>
					</div>
					<div class="flex flex-col gap-3 lg:items-end">
						<div class="flex flex-wrap gap-2">
							<label class="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold dark:border-[#1f3554]">
								<input type="checkbox" name="is_public" value="true" checked={professional.is_public} disabled={!canOperate} class="accent-[#7c3aed]" />
								Público
							</label>
							<label class="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold dark:border-[#1f3554]">
								<input type="checkbox" name="is_active" value="true" checked={professional.is_active} disabled={!canOperate} class="accent-[#7c3aed]" />
								Activo
							</label>
						</div>
						<a href={`/odonto/profesionales/${professional.id}`} class="rounded-xl border border-neutral-200 px-4 py-2 text-sm font-semibold hover:bg-neutral-100 dark:border-[#1f3554] dark:hover:bg-[#0f1f36]">
							Configurar
						</a>
						<button type="submit" disabled={!canOperate} class="rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900">
							Guardar
						</button>
					</div>
				</form>

				<div class="mt-4 border-t border-neutral-100 pt-4 dark:border-[#1f3554]">
					<p class="text-sm font-semibold text-neutral-900 dark:text-white">Usuarios vinculados</p>
					<div class="mt-2 flex flex-wrap gap-2">
						{#each linkedUsersFor(professional.id) as link}
							<form method="POST" action="?/unlink_user" class="inline-flex items-center gap-2 rounded-full border border-neutral-200 px-3 py-2 text-xs font-semibold dark:border-[#1f3554]">
								<input type="hidden" name="link_id" value={link.id} />
								<input type="hidden" name="professional_id" value={professional.id} />
								<span>{emailFor(link.user_id)}</span>
								<button type="submit" disabled={!canOperate} class="text-red-600 disabled:opacity-60">Quitar</button>
							</form>
						{/each}
						{#if linkedUsersFor(professional.id).length === 0}
							<span class="text-sm text-neutral-500 dark:text-neutral-300">Sin usuario vinculado.</span>
						{/if}
					</div>
					<form method="POST" action="?/link_user" class="mt-3 flex flex-col gap-2 sm:flex-row">
						<input type="hidden" name="professional_id" value={professional.id} />
						<select name="user_id" disabled={!canOperate} class="rounded-xl border border-neutral-200 px-4 py-2 text-sm disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36]">
							<option value="">Seleccionar usuario</option>
							{#each data.businessUsers as user}
								<option value={user.user_id}>{user.email ?? 'Sin email'} · {user.role}</option>
							{/each}
						</select>
						<button type="submit" disabled={!canOperate} class="rounded-xl border border-neutral-200 px-4 py-2 text-sm font-semibold disabled:opacity-60 dark:border-[#1f3554]">
							Vincular usuario
						</button>
					</form>
				</div>
			</article>
		{/each}
		{#if data.professionals.length === 0}
			<div class="rounded-2xl border border-dashed border-neutral-300 bg-white/70 p-6 text-sm text-neutral-600 dark:border-[#1f3554] dark:bg-[#152642] dark:text-neutral-200">
				Todavía no hay profesionales cargados.
			</div>
		{/if}
	</div>
</section>
