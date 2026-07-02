<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import type { BusinessContext, BusinessIndustry } from '$lib/server/business';

	let { data, form } = $props<{
		data: {
			context: BusinessContext;
			industries: readonly BusinessIndustry[];
			publicBookingUrl: string;
			readiness: {
				services: number;
				professionals: number;
				availabilityRules: number;
				reservableServices: number;
				reservableProfessionals: number;
			};
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
	const maxBookingOptions = [15, 30, 60, 90];
	const minNoticeOptions = [0, 60, 120, 360, 720, 1440, 2880];
	const minNoticeLabels: Record<number, string> = {
		0: 'Sin mínimo (hasta último momento)',
		60: '1 hora antes',
		120: '2 horas antes',
		360: '6 horas antes',
		720: '12 horas antes',
		1440: '24 horas antes',
		2880: '48 horas antes'
	};
	const timezoneOptions = [
		'America/Argentina/Buenos_Aires',
		'America/Argentina/Cordoba',
		'America/Argentina/Mendoza',
		'America/Argentina/Salta',
		'America/Argentina/Tucuman'
	];
	const currentMaxBookingDays = $derived(Number(valueOf('max_booking_days_ahead', 60)));
	const currentMinNoticeMinutes = $derived(Number(valueOf('min_booking_notice_minutes', 0)));
	const isPublicReady = $derived(
		business.is_active &&
			business.public_booking_enabled &&
			data.readiness.reservableServices > 0 &&
			data.readiness.reservableProfessionals > 0 &&
			data.readiness.availabilityRules > 0 &&
			Boolean(business.address)
	);
	const missingAddressWithPublicBooking = $derived(
		business.public_booking_enabled && !business.address
	);
</script>

<section class="ux-page">
	<div class="ux-hero">
		<BackLink href="/odonto/configuracion" label="Volver" class="mb-5" />
		<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<h1 class="ux-title">Negocio</h1>
				<p class="ux-subtitle">Actualizá los datos que ven tus pacientes al reservar.</p>
			</div>
			<span class={isPublicReady ? 'ux-badge ux-badge-success' : 'ux-badge ux-badge-warning'}>
				{isPublicReady ? 'Reserva lista' : 'Falta configuración'}
			</span>
		</div>
	</div>

	{#if missingAddressWithPublicBooking}
		<div class="ux-alert">
			Falta la dirección del consultorio. Los pacientes no van a saber dónde asistir al turno.
			Cargala en "Datos visibles" y guardá.
		</div>
	{/if}

	<div class="ux-card">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<h2 class="ux-section-title">Reserva online</h2>
				<p class="mt-2 text-sm text-white/55">Tus pacientes pueden reservar desde este enlace.</p>
			</div>
			<a href={data.publicBookingUrl} target="_blank" rel="noreferrer" class="ux-btn-secondary">Abrir link</a>
		</div>
		<input readonly value={data.publicBookingUrl} class="ux-input mt-4" />
		<div class="mt-4 grid gap-3 sm:grid-cols-3">
			<div class="ux-soft-card p-4">
				<p class="text-sm font-bold text-white/55">Servicios</p>
				<p class="mt-1 text-3xl font-bold text-white">{data.readiness.reservableServices}</p>
			</div>
			<div class="ux-soft-card p-4">
				<p class="text-sm font-bold text-white/55">Profesionales</p>
				<p class="mt-1 text-3xl font-bold text-white">{data.readiness.reservableProfessionals}</p>
			</div>
			<div class="ux-soft-card p-4">
				<p class="text-sm font-bold text-white/55">Horarios</p>
				<p class="mt-1 text-3xl font-bold text-white">{data.readiness.availabilityRules}</p>
			</div>
		</div>
	</div>

	<form method="post" action="?/update_business" class="ux-card">
		<input type="hidden" name="whatsapp_enabled" value={checkedOf('whatsapp_enabled', business.whatsapp_enabled) ? 'true' : 'false'} />
		<input type="hidden" name="is_active" value={checkedOf('is_active', business.is_active) ? 'true' : 'false'} />
		<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h2 class="ux-section-title">Datos visibles</h2>
				<p class="mt-1 text-sm text-white/55">Información básica del consultorio.</p>
			</div>
			<button type="submit" disabled={!canManage} class="ux-btn-primary">Guardar</button>
		</div>

		<div class="mt-6 grid gap-4 md:grid-cols-2">
			<label>
				<span class="ux-label">Nombre</span>
				<input name="name" required value={valueOf('name')} disabled={!canManage} class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Nombre del enlace público</span>
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
				<select name="timezone" disabled={!canManage} class="ux-select">
					{#if !timezoneOptions.includes(valueOf('timezone', 'America/Argentina/Cordoba'))}
						<option value={valueOf('timezone', 'America/Argentina/Cordoba')} selected>
							{valueOf('timezone', 'America/Argentina/Cordoba')}
						</option>
					{/if}
					{#each timezoneOptions as timezone}
						<option value={timezone} selected={valueOf('timezone', 'America/Argentina/Cordoba') === timezone}>{timezone}</option>
					{/each}
				</select>
			</label>
			<label>
				<span class="ux-label">Teléfono de contacto (opcional)</span>
				<input name="phone" value={valueOf('phone')} disabled={!canManage} class="ux-input" />
			</label>
			<label>
				<span class="ux-label">Correo de contacto (opcional)</span>
				<input name="email" type="email" value={valueOf('email')} disabled={!canManage} class="ux-input" />
			</label>
			<label class="md:col-span-2">
				<span class="ux-label">Dirección visible para pacientes</span>
				<input
					name="address"
					value={valueOf('address')}
					disabled={!canManage}
					placeholder="Av. Santa Fe 1234, Piso 3, Consultorio B, CABA"
					class="ux-input"
				/>
				<span class="mt-1 block text-xs text-white/45">
					Aparece en la confirmación del turno, el evento de calendario y el botón "Cómo llegar".
					Obligatoria para la reserva online.
				</span>
			</label>
			<label class="md:col-span-2">
				<span class="ux-label">Indicaciones para llegar (opcional)</span>
				<textarea
					name="address_instructions"
					rows="2"
					disabled={!canManage}
					placeholder="Tocar timbre 4B. Entrada por galería. Presentarse 10 minutos antes."
					class="ux-textarea">{valueOf('address_instructions')}</textarea>
			</label>
			<label class="md:col-span-2">
				<span class="ux-label">Link de Google Maps (opcional)</span>
				<input
					name="maps_url"
					value={valueOf('maps_url')}
					disabled={!canManage}
					placeholder="https://maps.app.goo.gl/..."
					class="ux-input"
				/>
				<span class="mt-1 block text-xs text-white/45">
					Si lo dejás vacío, generamos el mapa automáticamente desde la dirección.
				</span>
			</label>
			<label class="md:col-span-2">
				<span class="ux-label">Logo (opcional)</span>
				<input name="logo_url" value={valueOf('logo_url')} disabled={!canManage} class="ux-input" />
			</label>
			<label class="md:col-span-2">
				<span class="ux-label">Mostrar horarios hasta</span>
				<select name="max_booking_days_ahead" disabled={!canManage} class="ux-select">
					{#if !maxBookingOptions.includes(currentMaxBookingDays)}
						<option value={currentMaxBookingDays} selected>{currentMaxBookingDays} días adelante</option>
					{/if}
					<option value="15" selected={valueOf('max_booking_days_ahead', 60) === '15'}>15 días adelante</option>
					<option value="30" selected={valueOf('max_booking_days_ahead', 60) === '30'}>30 días adelante</option>
					<option value="60" selected={valueOf('max_booking_days_ahead', 60) === '60'}>60 días adelante</option>
					<option value="90" selected={valueOf('max_booking_days_ahead', 60) === '90'}>90 días adelante</option>
				</select>
			</label>
			<label class="md:col-span-2">
				<span class="ux-label">Anticipación mínima para reservas online</span>
				<select name="min_booking_notice_minutes" disabled={!canManage} class="ux-select">
					{#if !minNoticeOptions.includes(currentMinNoticeMinutes)}
						<option value={currentMinNoticeMinutes} selected>{Math.round(currentMinNoticeMinutes / 60)} horas antes</option>
					{/if}
					{#each minNoticeOptions as option}
						<option value={option} selected={currentMinNoticeMinutes === option}>{minNoticeLabels[option]}</option>
					{/each}
				</select>
				<span class="mt-1 block text-xs text-white/45">
					Los pacientes no van a poder reservar online con menos anticipación que esta.
					No afecta a los turnos que carga el consultorio.
				</span>
			</label>
			<label class="md:col-span-2">
				<span class="ux-label">Política de cancelación (opcional)</span>
				<textarea name="cancellation_policy" rows="3" disabled={!canManage} class="ux-textarea">{valueOf('cancellation_policy')}</textarea>
			</label>
		</div>

		<div class="mt-6">
			<label class="ux-choice flex items-center gap-3 px-4 py-3">
				<input type="checkbox" name="public_booking_enabled" value="true" checked={checkedOf('public_booking_enabled', business.public_booking_enabled)} disabled={!canManage} class="accent-[#7c3aed]" />
				<span class="font-bold text-white">Reserva online activa</span>
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
