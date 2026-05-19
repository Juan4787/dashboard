<script lang="ts">
	import type { BusinessContext, BusinessIndustry } from '$lib/server/business';

	let { data, form } = $props<{
		data: {
			context: BusinessContext;
			industries: readonly BusinessIndustry[];
			publicBookingUrl: string;
			readiness: { services: number; professionals: number; availabilityRules: number };
			demo: boolean;
		};
		form?: {
			success?: boolean;
			message?: string;
			values?: Record<string, unknown>;
		};
	}>();
	const business = $derived(data.context.business);
	const canManage = $derived(Boolean(data.context.canManage) && !data.demo);
	const businessValues = $derived(business as unknown as Record<string, unknown>);
	const values = $derived((form?.values ?? {}) as Record<string, unknown>);
	const valueOf = (key: string, fallback: unknown = '') =>
		String(values[key] ?? businessValues[key] ?? fallback ?? '');
	const checkedOf = (key: string, fallback: boolean) =>
		values[key] != null ? values[key] === 'true' : Boolean(fallback);
	const isPublicReady = $derived(
		business.is_active &&
			business.public_booking_enabled &&
			data.readiness.services > 0 &&
			data.readiness.professionals > 0 &&
			data.readiness.availabilityRules > 0
	);
</script>

<section class="flex flex-col gap-6">
	<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<a href="/odonto/configuracion" class="text-xs font-semibold uppercase tracking-wide text-[#7c3aed] hover:underline">
			Volver a configuración
		</a>
		<div class="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
			<div>
				<h1 class="text-2xl font-semibold text-neutral-900 dark:text-white">Negocio</h1>
				<p class="mt-2 text-sm text-neutral-600 dark:text-neutral-200">
					Datos operativos del consultorio, link público y reglas iniciales de reserva.
				</p>
			</div>
			<span
				class={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${
					business.is_active
						? 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-100'
						: 'bg-neutral-200 text-neutral-700 dark:bg-white/10 dark:text-neutral-200'
				}`}
			>
				{business.is_active ? 'Activo' : 'Inactivo'}
			</span>
		</div>
	</div>

	<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
			<div>
				<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Reserva pública</h2>
				<p class="mt-2 text-sm text-neutral-600 dark:text-neutral-200">
					Este es el link que podés compartir cuando el negocio esté listo para recibir turnos online.
				</p>
			</div>
			<span
				class={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${
					isPublicReady
						? 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-100'
						: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-100'
				}`}
			>
				{isPublicReady ? 'Listo para publicar' : 'Falta configuración'}
			</span>
		</div>
		<div class="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
			<input readonly value={data.publicBookingUrl} class="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-neutral-200" />
			<a href={data.publicBookingUrl} target="_blank" rel="noreferrer" class="inline-flex items-center justify-center rounded-xl border border-neutral-200 px-5 py-3 text-sm font-semibold transition hover:bg-neutral-50 dark:border-[#1f3554] dark:hover:bg-[#0f1f36]">
				Abrir link
			</a>
		</div>
		<div class="mt-4 grid gap-3 text-sm sm:grid-cols-3">
			<div class="rounded-xl border border-neutral-200 px-4 py-3 dark:border-[#1f3554]">
				<p class="font-semibold text-neutral-900 dark:text-white">Servicios públicos</p>
				<p class="mt-1 text-neutral-600 dark:text-neutral-200">{data.readiness.services}</p>
			</div>
			<div class="rounded-xl border border-neutral-200 px-4 py-3 dark:border-[#1f3554]">
				<p class="font-semibold text-neutral-900 dark:text-white">Profesionales públicos</p>
				<p class="mt-1 text-neutral-600 dark:text-neutral-200">{data.readiness.professionals}</p>
			</div>
			<div class="rounded-xl border border-neutral-200 px-4 py-3 dark:border-[#1f3554]">
				<p class="font-semibold text-neutral-900 dark:text-white">Horarios activos</p>
				<p class="mt-1 text-neutral-600 dark:text-neutral-200">{data.readiness.availabilityRules}</p>
			</div>
		</div>
	</div>

	<form method="post" action="?/update_business" class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<div class="grid gap-5 md:grid-cols-2">
			<div class="space-y-2">
				<label for="name" class="text-sm font-semibold text-neutral-800 dark:text-white">Nombre del consultorio</label>
				<input id="name" name="name" required value={valueOf('name')} disabled={!canManage} class="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white" />
			</div>
			<div class="space-y-2">
				<label for="slug" class="text-sm font-semibold text-neutral-800 dark:text-white">Slug público</label>
				<input id="slug" name="slug" required value={valueOf('slug')} disabled={!canManage} class="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white" />
			</div>
			<div class="space-y-2">
				<label for="industry" class="text-sm font-semibold text-neutral-800 dark:text-white">Industria</label>
				<select id="industry" name="industry" disabled={!canManage} class="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white">
					{#each data.industries as industry}
						<option value={industry} selected={valueOf('industry') === industry}>{industry}</option>
					{/each}
				</select>
			</div>
			<div class="space-y-2">
				<label for="timezone" class="text-sm font-semibold text-neutral-800 dark:text-white">Zona horaria</label>
				<input id="timezone" name="timezone" value={valueOf('timezone', 'America/Argentina/Cordoba')} disabled={!canManage} class="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white" />
			</div>
			<div class="space-y-2">
				<label for="phone" class="text-sm font-semibold text-neutral-800 dark:text-white">Teléfono</label>
				<input id="phone" name="phone" value={valueOf('phone')} disabled={!canManage} class="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white" />
			</div>
			<div class="space-y-2">
				<label for="email" class="text-sm font-semibold text-neutral-800 dark:text-white">Email</label>
				<input id="email" name="email" type="email" value={valueOf('email')} disabled={!canManage} class="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white" />
			</div>
			<div class="space-y-2 md:col-span-2">
				<label for="address" class="text-sm font-semibold text-neutral-800 dark:text-white">Dirección</label>
				<input id="address" name="address" value={valueOf('address')} disabled={!canManage} class="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white" />
			</div>
			<div class="space-y-2 md:col-span-2">
				<label for="logo_url" class="text-sm font-semibold text-neutral-800 dark:text-white">Logo URL</label>
				<input id="logo_url" name="logo_url" value={valueOf('logo_url')} disabled={!canManage} class="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white" />
			</div>
			<div class="space-y-2">
				<label for="min_booking_notice_minutes" class="text-sm font-semibold text-neutral-800 dark:text-white">Anticipación mínima (min)</label>
				<input id="min_booking_notice_minutes" name="min_booking_notice_minutes" type="number" min="0" value={valueOf('min_booking_notice_minutes', 1440)} disabled={!canManage} class="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white" />
			</div>
			<div class="space-y-2">
				<label for="max_booking_days_ahead" class="text-sm font-semibold text-neutral-800 dark:text-white">Días máximos hacia adelante</label>
				<input id="max_booking_days_ahead" name="max_booking_days_ahead" type="number" min="1" value={valueOf('max_booking_days_ahead', 60)} disabled={!canManage} class="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white" />
			</div>
			<div class="space-y-2 md:col-span-2">
				<label for="cancellation_policy" class="text-sm font-semibold text-neutral-800 dark:text-white">Política de cancelación</label>
				<textarea id="cancellation_policy" name="cancellation_policy" rows="3" disabled={!canManage} class="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/20 disabled:opacity-60 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white">{valueOf('cancellation_policy')}</textarea>
			</div>
		</div>

		<div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
			<label class="flex items-center gap-3 rounded-xl border border-neutral-200 px-4 py-3 text-sm font-semibold dark:border-[#1f3554]">
				<input type="checkbox" name="public_booking_enabled" value="true" checked={checkedOf('public_booking_enabled', business.public_booking_enabled)} disabled={!canManage} class="h-4 w-4 accent-[#7c3aed]" />
				Reserva pública
			</label>
			<label class="flex items-center gap-3 rounded-xl border border-neutral-200 px-4 py-3 text-sm font-semibold dark:border-[#1f3554]">
				<input type="checkbox" name="whatsapp_enabled" value="true" checked={checkedOf('whatsapp_enabled', business.whatsapp_enabled)} disabled={!canManage} class="h-4 w-4 accent-[#7c3aed]" />
				WhatsApp
			</label>
			<label class="flex items-center gap-3 rounded-xl border border-neutral-200 px-4 py-3 text-sm font-semibold dark:border-[#1f3554]">
				<input type="checkbox" name="allow_same_day_booking" value="true" checked={checkedOf('allow_same_day_booking', business.allow_same_day_booking)} disabled={!canManage} class="h-4 w-4 accent-[#7c3aed]" />
				Mismo día
			</label>
			<label class="flex items-center gap-3 rounded-xl border border-neutral-200 px-4 py-3 text-sm font-semibold dark:border-[#1f3554]">
				<input type="checkbox" name="is_active" value="true" checked={checkedOf('is_active', business.is_active)} disabled={!canManage} class="h-4 w-4 accent-[#7c3aed]" />
				Activo
			</label>
		</div>

		{#if form?.message}
			<p class="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-100">{form.message}</p>
		{/if}
		{#if form?.success}
			<p class="mt-5 rounded-xl bg-green-50 px-4 py-3 text-sm font-semibold text-green-800 dark:bg-green-500/15 dark:text-green-100">Negocio guardado.</p>
		{/if}
		{#if !canManage}
			<p class="mt-5 rounded-xl bg-neutral-100 px-4 py-3 text-sm font-semibold text-neutral-700 dark:bg-white/10 dark:text-neutral-200">Tu rol actual no permite editar esta configuración.</p>
		{/if}

		<div class="mt-6 flex justify-end">
			<button type="submit" disabled={!canManage} class="rounded-xl bg-[#7c3aed] px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-card disabled:cursor-not-allowed disabled:opacity-60">
				Guardar cambios
			</button>
		</div>
	</form>
</section>
