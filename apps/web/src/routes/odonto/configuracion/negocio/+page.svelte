<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import type { BusinessContext, BusinessIndustry } from '$lib/server/business';

	let { data, form } = $props<{
		data: {
			context: BusinessContext;
			industries: readonly BusinessIndustry[];
			publicBookingUrl: string;
			readiness: { services: number; professionals: number; availabilityRules: number };
			demo: boolean;
		};
		form?: { success?: boolean; message?: string; values?: Record<string, unknown> };
	}>();

	const business = $derived(data.context.business);
	const canManage = $derived(Boolean(data.context.canManage) && !data.demo);
	const businessValues = $derived(business as unknown as Record<string, unknown>);
	const values = $derived((form?.values ?? {}) as Record<string, unknown>);
	const valueOf = (key: string, fallback: unknown = '') =>
		String(values[key] ?? businessValues[key] ?? fallback ?? '');
	const checkedOf = (key: string, fallback: boolean) =>
		values[key] != null ? values[key] === 'true' : Boolean(fallback);
	const industryLabels: Record<BusinessIndustry, string> = {
		odontology: 'Odontología',
		aesthetics: 'Estética',
		kinesiology: 'Kinesiología',
		nutrition: 'Nutrición',
		therapy: 'Terapia',
		other: 'Otro'
	};
	const industryLabel = (industry: BusinessIndustry) => industryLabels[industry] ?? industry;
	const isPublicReady = $derived(
		business.is_active &&
			business.public_booking_enabled &&
			data.readiness.services > 0 &&
			data.readiness.professionals > 0 &&
			data.readiness.availabilityRules > 0
	);
</script>

<section class="ux-page">
	<div class="ux-hero">
		<BackLink href="/odonto/configuracion" label="Volver" class="mb-5" />
		<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<p class={business.is_active ? 'ux-badge ux-badge-success' : 'ux-badge'}>{business.is_active ? 'Activo' : 'Inactivo'}</p>
				<h1 class="ux-title mt-4">Consultorio</h1>
				<p class="ux-subtitle">Datos visibles, reserva online y reglas básicas.</p>
			</div>
			<span class={isPublicReady ? 'ux-badge ux-badge-success' : 'ux-badge ux-badge-warning'}>
				{isPublicReady ? 'Reserva lista' : 'Falta configuración'}
			</span>
		</div>
	</div>

	<div class="ux-card">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<h2 class="ux-section-title">Reserva online</h2>
				<p class="mt-2 text-sm text-white/55">Link público para compartir.</p>
			</div>
			<a href={data.publicBookingUrl} target="_blank" rel="noreferrer" class="ux-btn-secondary">Abrir link</a>
		</div>
		<input readonly value={data.publicBookingUrl} class="ux-input mt-4" />
		<div class="mt-4 grid gap-3 sm:grid-cols-3">
			<div class="ux-soft-card p-4">
				<p class="text-sm font-bold text-white/55">Servicios</p>
				<p class="mt-1 text-3xl font-bold text-white">{data.readiness.services}</p>
			</div>
			<div class="ux-soft-card p-4">
				<p class="text-sm font-bold text-white/55">Profesionales</p>
				<p class="mt-1 text-3xl font-bold text-white">{data.readiness.professionals}</p>
			</div>
			<div class="ux-soft-card p-4">
				<p class="text-sm font-bold text-white/55">Horarios</p>
				<p class="mt-1 text-3xl font-bold text-white">{data.readiness.availabilityRules}</p>
			</div>
		</div>
	</div>

	<form method="post" action="?/update_business" class="ux-card">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h2 class="ux-section-title">Datos del consultorio</h2>
				<p class="mt-1 text-sm text-white/55">Mantené solo lo necesario visible y actualizado.</p>
			</div>
			<button type="submit" disabled={!canManage} class="ux-btn-primary">Guardar</button>
		</div>

		<div class="mt-6 grid gap-4 md:grid-cols-2">
			<label>
				<span class="ux-label">Nombre</span>
				<input name="name" required value={valueOf('name')} disabled={!canManage} class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Enlace público</span>
				<input name="slug" required value={valueOf('slug')} disabled={!canManage} class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Rubro</span>
				<select name="industry" disabled={!canManage} class="ux-select">
					{#each data.industries as industry}
						<option value={industry} selected={valueOf('industry') === industry}>{industryLabel(industry)}</option>
					{/each}
				</select>
			</label>
			<label>
				<span class="ux-label">Zona horaria</span>
				<input name="timezone" value={valueOf('timezone', 'America/Argentina/Cordoba')} disabled={!canManage} class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Teléfono opcional</span>
				<input name="phone" value={valueOf('phone')} disabled={!canManage} class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Correo opcional</span>
				<input name="email" type="email" value={valueOf('email')} disabled={!canManage} class="ux-input" />
			</label>
			<label class="md:col-span-2">
				<span class="ux-label">Dirección opcional</span>
				<input name="address" value={valueOf('address')} disabled={!canManage} class="ux-input" />
			</label>
			<label class="md:col-span-2">
				<span class="ux-label">Logo opcional</span>
				<input name="logo_url" value={valueOf('logo_url')} disabled={!canManage} class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Anticipación mínima</span>
				<input name="min_booking_notice_minutes" type="number" min="0" value={valueOf('min_booking_notice_minutes', 1440)} disabled={!canManage} class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Días hacia adelante</span>
				<input name="max_booking_days_ahead" type="number" min="1" value={valueOf('max_booking_days_ahead', 60)} disabled={!canManage} class="ux-input" />
			</label>
			<label class="md:col-span-2">
				<span class="ux-label">Política de cancelación opcional</span>
				<textarea name="cancellation_policy" rows="3" disabled={!canManage} class="ux-textarea">{valueOf('cancellation_policy')}</textarea>
			</label>
		</div>

		<div class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
			<label class="ux-choice flex items-center gap-3 px-4 py-3">
				<input type="checkbox" name="public_booking_enabled" value="true" checked={checkedOf('public_booking_enabled', business.public_booking_enabled)} disabled={!canManage} class="accent-[#7c3aed]" />
				<span class="font-bold text-white">Reserva online</span>
			</label>
			<label class="ux-choice flex items-center gap-3 px-4 py-3">
				<input type="checkbox" name="whatsapp_enabled" value="true" checked={checkedOf('whatsapp_enabled', business.whatsapp_enabled)} disabled={!canManage} class="accent-[#7c3aed]" />
				<span class="font-bold text-white">WhatsApp</span>
			</label>
			<label class="ux-choice flex items-center gap-3 px-4 py-3">
				<input type="checkbox" name="allow_same_day_booking" value="true" checked={checkedOf('allow_same_day_booking', business.allow_same_day_booking)} disabled={!canManage} class="accent-[#7c3aed]" />
				<span class="font-bold text-white">Mismo día</span>
			</label>
			<label class="ux-choice flex items-center gap-3 px-4 py-3">
				<input type="checkbox" name="is_active" value="true" checked={checkedOf('is_active', business.is_active)} disabled={!canManage} class="accent-[#7c3aed]" />
				<span class="font-bold text-white">Activo</span>
			</label>
		</div>

		{#if form?.message}
			<p class="ux-alert mt-5">{form.message}</p>
		{/if}
		{#if form?.success}
			<p class="ux-alert ux-alert-success mt-5">Consultorio guardado.</p>
		{/if}
		{#if !canManage}
			<p class="ux-empty mt-5">Tu permiso actual no permite editar esta configuración.</p>
		{/if}
	</form>
</section>
