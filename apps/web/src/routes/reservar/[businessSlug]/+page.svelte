<script lang="ts">
	import { formatDateTime } from '$lib/utils/format';

	type Service = {
		id: string;
		name: string;
		description: string | null;
		duration_minutes: number;
		price_label: string | null;
	};
	type Professional = { id: string; name: string; specialty: string | null };
	type Slot = {
		date: string;
		time: string;
		starts_at: string;
		ends_at: string;
		professional_id: string;
		professional_name: string;
	};
	type Day = { date: string; label: string; count: number };

	let { data, form } = $props<{
		data: {
			state: {
				business: any;
				services: Service[];
				professionals: Professional[];
				slots: Slot[];
				days: Day[];
				issue: string | null;
			};
			selected: { serviceId: string; professionalId: string; date: string; slot: string };
			turnstileSiteKey: string | null;
			demo: boolean;
		};
		form?: { message?: string; values?: Record<string, unknown> };
	}>();

	const business = $derived(data.state.business);
	const selectedService = $derived(
		data.state.services.find((service: Service) => service.id === data.selected.serviceId) ?? null
	);
	const selectedProfessional = $derived(
		data.state.professionals.find((professional: Professional) => professional.id === data.selected.professionalId) ?? null
	);
	const selectedSlot = $derived(data.state.slots.find((slot: Slot) => slot.starts_at === data.selected.slot) ?? null);
	const queryFor = (params: Record<string, string | null>) => {
		const search = new URLSearchParams();
		const serviceId = params.service_id ?? data.selected.serviceId;
		const professionalId = params.professional_id ?? data.selected.professionalId;
		const date = params.date ?? data.selected.date;
		const slot = params.slot ?? data.selected.slot;
		if (serviceId) search.set('service_id', serviceId);
		if (professionalId) search.set('professional_id', professionalId);
		if (date) search.set('date', date);
		if (slot) search.set('slot', slot);
		const value = search.toString();
		return value ? `?${value}` : '';
	};
	const step = $derived(!selectedService ? 1 : !selectedProfessional ? 2 : !data.selected.date ? 3 : !selectedSlot ? 4 : 5);
	const issueMessages: Record<string, string> = {
		business_not_found: 'El enlace de reserva no está disponible.',
		booking_disabled: 'La reserva online no está disponible en este momento.',
		missing_service_role: 'La reserva online necesita configuración del servidor.',
		no_services: 'No hay servicios disponibles para reservar online en este momento.',
		no_professionals: 'No hay profesionales disponibles para ese servicio.',
		no_availability: 'No hay horarios disponibles para los próximos días.'
	};
	const values = $derived((form?.values ?? {}) as Record<string, unknown>);
	const serviceMark = (name: string) =>
		name
			.split(' ')
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase())
			.join('');
</script>

<svelte:head>
	<title>{business?.name ?? 'Reserva online'}</title>
	{#if data.turnstileSiteKey}
		<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
	{/if}
</svelte:head>

<main class="min-h-screen bg-[#06111f] px-4 py-5 text-white sm:py-8">
	<div class="mx-auto flex w-full max-w-4xl flex-col gap-5">
		<header class="ux-hero">
			<div class="flex items-start gap-4">
				{#if business?.logo_url}
					<img src={business.logo_url} alt={business.name} class="h-16 w-16 rounded-2xl object-cover" />
				{:else}
					<div class="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-[#7c3aed] text-lg font-bold text-white">
						{business?.name?.slice(0, 2).toUpperCase() ?? 'RS'}
					</div>
				{/if}
				<div class="min-w-0">
					<p class="ux-badge">Reserva online</p>
					<h1 class="mt-3 text-3xl font-bold text-white">{business?.name ?? 'Reserva online'}</h1>
					{#if business?.address || business?.phone}
						<p class="mt-2 text-sm text-white/55">{business.address ?? ''}{business.address && business.phone ? ' · ' : ''}{business.phone ?? ''}</p>
					{/if}
				</div>
			</div>
		</header>

		{#if data.state.issue}
			<section class="ux-card">
				<p class="text-lg font-bold text-white">{issueMessages[data.state.issue] ?? 'No se pudo cargar la reserva online.'}</p>
				{#if business?.phone}
					<p class="mt-2 text-sm text-white/55">Contactá al consultorio: {business.phone}</p>
				{/if}
			</section>
		{:else}
			<section class="ux-card">
				<div class="mx-auto flex max-w-md items-center gap-3">
					{#each [1, 2, 3, 4, 5] as item, index}
						<span class={`grid h-9 w-9 place-items-center rounded-full text-sm font-bold ${step >= item ? 'bg-[#7c3aed] text-white' : 'bg-white/10 text-white/50'}`}>
							{item}
						</span>
						{#if index < 4}
							<span class={`h-px flex-1 ${step > item ? 'bg-[#7c3aed]' : 'bg-white/15'}`}></span>
						{/if}
					{/each}
				</div>
			</section>

			<section class="ux-card">
				<h2 class="ux-section-title">¿Qué necesitás?</h2>
				<div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each data.state.services as service}
						<a href={queryFor({ service_id: service.id, professional_id: '', date: '', slot: '' })} class={`ux-choice p-5 text-center ${selectedService?.id === service.id ? 'ux-choice-active' : ''}`}>
							<span class="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white/10 text-lg font-bold text-white">{serviceMark(service.name)}</span>
							<p class="mt-4 text-lg font-bold text-white">{service.name}</p>
							<p class="mt-2 text-sm text-white/55">{service.duration_minutes} min{service.price_label ? ` · ${service.price_label}` : ''}</p>
						</a>
					{/each}
				</div>
			</section>

			{#if selectedService}
				<section class="ux-card">
					<h2 class="ux-section-title">¿Con quién?</h2>
					<div class="mt-5 grid gap-3 sm:grid-cols-2">
						{#each data.state.professionals as professional}
							<a href={queryFor({ professional_id: professional.id, date: '', slot: '' })} class={`ux-choice p-5 ${selectedProfessional?.id === professional.id ? 'ux-choice-active' : ''}`}>
								<p class="text-lg font-bold text-white">{professional.name}</p>
								<p class="mt-1 text-sm text-white/55">{professional.specialty ?? 'Profesional'}</p>
							</a>
						{/each}
					</div>
				</section>
			{/if}

			{#if selectedService && selectedProfessional}
				<section class="ux-card">
					<h2 class="ux-section-title">Elegí un día</h2>
					<div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
						{#each data.state.days as day}
							<a href={queryFor({ date: day.date, slot: '' })} class={`ux-choice px-4 py-3 ${data.selected.date === day.date ? 'ux-choice-active' : ''}`}>
								<span class="block font-bold text-white">{day.label}</span>
								<span class="mt-1 block text-xs font-bold text-white/50">{day.count} horarios</span>
							</a>
						{/each}
					</div>
					{#if data.state.days.length === 0}
						<p class="ux-empty mt-4">No hay días disponibles.</p>
					{/if}
				</section>
			{/if}

			{#if selectedService && selectedProfessional && data.selected.date}
				<section class="ux-card">
					<h2 class="ux-section-title">Elegí un horario</h2>
					<div class="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4">
						{#each data.state.slots as slot}
							<a href={queryFor({ slot: slot.starts_at })} class={`rounded-2xl border px-3 py-3 text-center text-sm font-bold transition ${selectedSlot?.starts_at === slot.starts_at ? 'border-[#8b5cf6] bg-[#7c3aed] text-white' : 'border-white/10 bg-white/[0.04] text-white hover:border-[#8b5cf6]/70'}`}>
								{slot.time}
							</a>
						{/each}
					</div>
					{#if data.state.slots.length === 0}
						<p class="ux-empty mt-4">No hay horarios para ese día.</p>
					{/if}
				</section>
			{/if}

			{#if selectedService && selectedProfessional && selectedSlot}
				<form method="POST" action="?/create_booking" class="ux-card">
					<h2 class="ux-section-title">Tus datos</h2>
					<div class="ux-soft-card mt-5 p-5">
						<p class="text-sm font-bold text-white/55">Resumen</p>
						<p class="mt-2 text-lg font-bold text-white">{selectedService.name} con {selectedProfessional.name}</p>
						<p class="mt-1 text-sm text-white/55">{formatDateTime(selectedSlot.starts_at)} · {selectedService.duration_minutes} min</p>
					</div>

					<input type="hidden" name="service_id" value={selectedService.id} />
					<input type="hidden" name="professional_id" value={selectedProfessional.id} />
					<input type="hidden" name="slot_starts_at" value={selectedSlot.starts_at} />

					<div class="mt-5 grid gap-4">
						<label>
							<span class="ux-label">Nombre y apellido</span>
							<input name="patient_name" required minlength="3" value={String(values.patient_name ?? '')} class="ux-input" />
						</label>
						<label>
							<span class="ux-label">Teléfono</span>
							<input name="patient_phone" required inputmode="tel" value={String(values.patient_phone ?? '')} class="ux-input" />
						</label>
						<label>
							<span class="ux-label">Correo opcional</span>
							<input name="patient_email" type="email" value={String(values.patient_email ?? '')} class="ux-input" />
						</label>
						<label>
							<span class="ux-label">Comentario opcional</span>
							<textarea name="note" rows="3" class="ux-textarea">{String(values.note ?? '')}</textarea>
						</label>
						<label class="ux-soft-card flex items-start gap-3 p-4">
							<input
								type="checkbox"
								name="whatsapp_opt_in"
								value="true"
								required
								checked={String(values.whatsapp_opt_in ?? '') === 'true'}
								class="mt-1 accent-[#7c3aed]"
							/>
							<span class="text-sm font-semibold text-white/75">
								Acepto recibir mensajes relacionados con este turno por WhatsApp.
							</span>
						</label>
					</div>

					{#if data.turnstileSiteKey}
						<div class="cf-turnstile mt-5" data-sitekey={data.turnstileSiteKey}></div>
					{/if}
					{#if form?.message}
						<p class="ux-alert mt-5">{form.message}</p>
					{/if}

					<button type="submit" class="ux-btn-primary mt-5 w-full">Confirmar reserva</button>
				</form>
			{/if}
		{/if}
	</div>
</main>
