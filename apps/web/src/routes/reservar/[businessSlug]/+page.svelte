<script lang="ts">
	import { formatDateTime } from '$lib/utils/format';

	type Service = {
		id: string;
		name: string;
		description: string | null;
		duration_minutes: number;
		price_label: string | null;
	};
	type Professional = { id: string; name: string; specialty: string | null; avatar_url: string | null };
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
</script>

<svelte:head>
	<title>{business?.name ?? 'Reserva online'}</title>
	{#if data.turnstileSiteKey}
		<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
	{/if}
</svelte:head>

<main class="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-[#0b1626] dark:text-white">
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:py-8">
		<header class="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#152642]">
			<div class="flex items-start gap-4">
				{#if business?.logo_url}
					<img src={business.logo_url} alt={business.name} class="h-14 w-14 rounded-xl object-cover" />
				{:else}
					<div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#7c3aed] text-lg font-semibold text-white">
						{business?.name?.slice(0, 2).toUpperCase() ?? 'RS'}
					</div>
				{/if}
				<div class="min-w-0">
					<h1 class="text-2xl font-semibold leading-tight text-neutral-900 dark:text-white">{business?.name ?? 'Reserva online'}</h1>
					<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-200">
						Elegí servicio, profesional y horario disponible.
					</p>
					{#if business?.address || business?.phone}
						<p class="mt-2 text-xs text-neutral-500 dark:text-neutral-300">
							{business.address ?? ''}{business.address && business.phone ? ' · ' : ''}{business.phone ?? ''}
						</p>
					{/if}
				</div>
			</div>
		</header>

		{#if data.state.issue}
			<section class="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-700 dark:border-[#1f3554] dark:bg-[#152642] dark:text-neutral-200">
				<p class="font-semibold">{issueMessages[data.state.issue] ?? 'No se pudo cargar la reserva online.'}</p>
				{#if business?.phone}
					<p class="mt-2">Contactá al consultorio: {business.phone}</p>
				{/if}
			</section>
		{:else}
			<section class="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm dark:border-[#1f3554] dark:bg-[#152642]">
				<div class="grid grid-cols-5 gap-2 text-center text-xs font-semibold">
					{#each [1, 2, 3, 4, 5] as item}
						<div class={`rounded-full px-2 py-2 ${step >= item ? 'bg-[#7c3aed] text-white' : 'bg-neutral-100 text-neutral-500 dark:bg-[#0f1f36] dark:text-neutral-300'}`}>
							{item}
						</div>
					{/each}
				</div>
			</section>

			<section class="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#152642]">
				<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">1. Servicio</h2>
				<div class="mt-4 grid gap-3">
					{#each data.state.services as service}
						<a href={queryFor({ service_id: service.id, professional_id: '', date: '', slot: '' })} class={`rounded-xl border p-4 transition ${selectedService?.id === service.id ? 'border-[#7c3aed] bg-[#7c3aed]/10' : 'border-neutral-200 hover:bg-neutral-50 dark:border-[#1f3554] dark:hover:bg-[#0f1f36]'}`}>
							<p class="font-semibold text-neutral-900 dark:text-white">{service.name}</p>
							{#if service.description}
								<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-200">{service.description}</p>
							{/if}
							<p class="mt-2 text-xs text-neutral-500 dark:text-neutral-300">
								{service.duration_minutes} min{service.price_label ? ` · ${service.price_label}` : ''}
							</p>
						</a>
					{/each}
				</div>
			</section>

			{#if selectedService}
				<section class="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#152642]">
					<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">2. Profesional</h2>
					<div class="mt-4 grid gap-3">
						{#each data.state.professionals as professional}
							<a href={queryFor({ professional_id: professional.id, date: '', slot: '' })} class={`rounded-xl border p-4 transition ${selectedProfessional?.id === professional.id ? 'border-[#7c3aed] bg-[#7c3aed]/10' : 'border-neutral-200 hover:bg-neutral-50 dark:border-[#1f3554] dark:hover:bg-[#0f1f36]'}`}>
								<p class="font-semibold text-neutral-900 dark:text-white">{professional.name}</p>
								<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-200">{professional.specialty ?? 'Profesional'}</p>
							</a>
						{/each}
					</div>
				</section>
			{/if}

			{#if selectedService && selectedProfessional}
				<section class="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#152642]">
					<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">3. Día</h2>
					<div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
						{#each data.state.days as day}
							<a href={queryFor({ date: day.date, slot: '' })} class={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${data.selected.date === day.date ? 'border-[#7c3aed] bg-[#7c3aed]/10 text-[#5b21b6] dark:text-[#e9d5ff]' : 'border-neutral-200 hover:bg-neutral-50 dark:border-[#1f3554] dark:hover:bg-[#0f1f36]'}`}>
								<span class="block">{day.label}</span>
								<span class="mt-1 block text-xs font-medium text-neutral-500 dark:text-neutral-300">{day.count} horarios</span>
							</a>
						{/each}
					</div>
					{#if data.state.days.length === 0}
						<p class="mt-4 rounded-xl border border-dashed border-neutral-300 px-4 py-3 text-sm text-neutral-600 dark:border-[#1f3554] dark:text-neutral-200">
							No hay días disponibles para este servicio y profesional.
						</p>
					{/if}
				</section>
			{/if}

			{#if selectedService && selectedProfessional && data.selected.date}
				<section class="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#152642]">
					<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">4. Horario</h2>
					<div class="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
						{#each data.state.slots as slot}
							<a href={queryFor({ slot: slot.starts_at })} class={`rounded-xl border px-3 py-3 text-center text-sm font-semibold transition ${selectedSlot?.starts_at === slot.starts_at ? 'border-[#7c3aed] bg-[#7c3aed] text-white' : 'border-neutral-200 hover:bg-neutral-50 dark:border-[#1f3554] dark:hover:bg-[#0f1f36]'}`}>
								{slot.time}
							</a>
						{/each}
					</div>
					{#if data.state.slots.length === 0}
						<p class="mt-4 rounded-xl border border-dashed border-neutral-300 px-4 py-3 text-sm text-neutral-600 dark:border-[#1f3554] dark:text-neutral-200">
							No hay horarios disponibles para este día.
						</p>
					{/if}
				</section>
			{/if}

			{#if selectedService && selectedProfessional && selectedSlot}
				<form method="POST" action="?/create_booking" class="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#152642]">
					<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">5. Tus datos y confirmación</h2>
					<div class="mt-4 rounded-xl bg-neutral-50 p-4 text-sm text-neutral-700 dark:bg-[#0f1f36] dark:text-neutral-200">
						<p class="font-semibold text-neutral-900 dark:text-white">Resumen</p>
						<p class="mt-2">{selectedService.name} con {selectedProfessional.name}</p>
						<p>{formatDateTime(selectedSlot.starts_at)} · {selectedService.duration_minutes} min</p>
					</div>

					<input type="hidden" name="service_id" value={selectedService.id} />
					<input type="hidden" name="professional_id" value={selectedProfessional.id} />
					<input type="hidden" name="slot_starts_at" value={selectedSlot.starts_at} />

					<div class="mt-4 grid gap-4">
						<label class="space-y-1">
							<span class="text-sm font-semibold">Nombre y apellido</span>
							<input name="patient_name" required minlength="3" value={String(values.patient_name ?? '')} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm dark:border-[#1f3554] dark:bg-[#0f1f36]" />
						</label>
						<label class="space-y-1">
							<span class="text-sm font-semibold">Teléfono</span>
							<input name="patient_phone" required inputmode="tel" value={String(values.patient_phone ?? '')} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm dark:border-[#1f3554] dark:bg-[#0f1f36]" />
						</label>
						<label class="space-y-1">
							<span class="text-sm font-semibold">Email opcional</span>
							<input name="patient_email" type="email" value={String(values.patient_email ?? '')} class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm dark:border-[#1f3554] dark:bg-[#0f1f36]" />
						</label>
						<label class="space-y-1">
							<span class="text-sm font-semibold">Comentario opcional</span>
							<textarea name="note" rows="3" class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm dark:border-[#1f3554] dark:bg-[#0f1f36]">{String(values.note ?? '')}</textarea>
						</label>
					</div>

					{#if data.turnstileSiteKey}
						<div class="cf-turnstile mt-4" data-sitekey={data.turnstileSiteKey}></div>
					{/if}

					{#if form?.message}
						<p class="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-100">{form.message}</p>
					{/if}

					<button type="submit" class="mt-5 w-full rounded-xl bg-[#7c3aed] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#6d28d9]">
						Confirmar reserva
					</button>
				</form>
			{/if}
		{/if}
	</div>
</main>
