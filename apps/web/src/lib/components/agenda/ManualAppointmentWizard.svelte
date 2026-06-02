<script lang="ts">
	type Service = { id: string; name: string; duration_minutes: number };
	type Professional = {
		id: string;
		name: string;
		specialty?: string | null;
		is_active: boolean;
	};
	type Patient = { id: string; full_name: string; phone_e164: string | null; blocked: boolean };
	type Slot = {
		date: string;
		time: string;
		starts_at: string;
		ends_at: string;
		professional_id: string;
		professional_name: string;
	};

	let {
		services,
		professionals,
		serviceProfessionalIds,
		patients,
		initialDate,
		initialPatientId = '',
		canCreateAppointment,
		form
	} = $props<{
		services: Service[];
		professionals: Professional[];
		serviceProfessionalIds: Record<string, string[]>;
		patients: Patient[];
		initialDate: string;
		initialPatientId?: string;
		canCreateAppointment: boolean;
		form?: { values?: Record<string, unknown> };
	}>();

	const value = (key: string) => String(form?.values?.[key] ?? '');
	const today = () => new Date().toISOString().slice(0, 10);
	const addDays = (date: string, days: number) => {
		const next = new Date(`${date}T12:00:00`);
		next.setDate(next.getDate() + days);
		return next.toISOString().slice(0, 10);
	};
	const safeStartDate = () => {
		const current = today();
		return initialDate && initialDate >= current ? initialDate : current;
	};
	const formatTime = (value: string) => value.slice(0, 5);
	const formatDayName = (date: string) =>
		new Intl.DateTimeFormat('es-AR', { weekday: 'long' }).format(new Date(`${date}T12:00:00`));
	const formatDayNumber = (date: string) =>
		new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit' }).format(new Date(`${date}T12:00:00`));
	const formatLongDate = (date: string) =>
		new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: '2-digit', month: 'long' }).format(
			new Date(`${date}T12:00:00`)
		);
	const formatNextSlot = (slot: Slot | null) => {
		if (!slot) return 'Sin horarios próximos';
		const current = today();
		const tomorrow = addDays(current, 1);
		const day = slot.date === current ? 'Hoy' : slot.date === tomorrow ? 'Mañana' : formatDayName(slot.date);
		return `${day} ${slot.time}`;
	};
	const durationLabel = (minutes: number) => `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;

	const initialStep = () => {
		if (value('time')) return 4;
		if (value('professional_id')) return 3;
		if (value('service_id')) return 2;
		return 1;
	};
	const getInitialPatientSelection = () => value('patient_id') || initialPatientId;

	let step = $state(initialStep());
	let selectedServiceId = $state(value('service_id'));
	let selectedProfessionalId = $state(value('professional_id'));
	let visibleWeekStart = $state(value('date') || safeStartDate());
	let selectedSlotStartsAt = $state('');
	let patientMode = $state(getInitialPatientSelection() ? 'existing' : 'new');
	let selectedPatientId = $state(getInitialPatientSelection());
	let patientName = $state(value('patient_name'));
	let patientPhone = $state(value('patient_phone'));
	let patientEmail = $state(value('patient_email'));
	let patientSearch = $state('');
	let internalNote = $state(value('internal_note'));
	let pendingInitialTime = $state(value('time'));
	let slots = $state<Slot[]>([]);
	let loadingSlots = $state(false);
	let slotsLoaded = $state(false);
	let slotsError = $state('');
	let slotRequest = 0;
	let remotePatients = $state<Patient[]>([]);
	let patientSearchLoading = $state(false);
	let patientSearchError = $state('');
	let patientSearchRequest = 0;

	const selectedService = $derived(
		services.find((service: Service) => service.id === selectedServiceId) ?? null
	);
	const offeredProfessionalIds = $derived(serviceProfessionalIds[selectedServiceId] ?? []);
	const offeringProfessionals = $derived(
		professionals.filter((professional: Professional) => offeredProfessionalIds.includes(professional.id))
	);
	const nextSlotByProfessional = $derived(
		slots.reduce<Record<string, Slot>>((acc, slot) => {
			if (!acc[slot.professional_id] || slot.starts_at < acc[slot.professional_id].starts_at) {
				acc[slot.professional_id] = slot;
			}
			return acc;
		}, {})
	);
	const selectableProfessionals = $derived(
		offeringProfessionals.filter(
			(professional: Professional) => slotsLoaded && Boolean(nextSlotByProfessional[professional.id])
		)
	);
	const selectedProfessional = $derived(
		professionals.find((professional: Professional) => professional.id === selectedProfessionalId) ?? null
	);
	const weekDays = $derived(Array.from({ length: 7 }, (_, index) => addDays(visibleWeekStart, index)));
	const professionalSlots = $derived(
		slots.filter((slot) => slot.professional_id === selectedProfessionalId && weekDays.includes(slot.date))
	);
	const slotsByDay = $derived(
		weekDays
			.map((day) => ({
				day,
				slots: professionalSlots.filter((slot) => slot.date === day)
			}))
			.filter((day) => day.slots.length > 0)
	);
	const selectedSlot = $derived(slots.find((slot) => slot.starts_at === selectedSlotStartsAt) ?? null);
	const patientCandidates = $derived(patientSearch.trim().length >= 2 ? remotePatients : patients);
	const visiblePatients = $derived(
		patientCandidates
			.filter((patient: Patient) => !patient.blocked)
			.filter((patient: Patient) => {
				const query = patientSearch.trim().toLowerCase();
				if (patientSearch.trim().length >= 2) return true;
				if (!query) return true;
				return (
					patient.full_name.toLowerCase().includes(query) ||
					(patient.phone_e164 ?? '').toLowerCase().includes(query)
				);
			})
			.slice(0, 8)
	);
	const selectedPatient = $derived(
		patients.find((patient: Patient) => patient.id === selectedPatientId) ?? null
	);
	const canUseExistingPatient = $derived(patientMode === 'existing' && Boolean(selectedPatientId));
	const canUseNewPatient = $derived(
		patientMode === 'new' && patientName.trim().length >= 2 && patientPhone.trim().length >= 6
	);
	const canCreate = $derived(
		Boolean(selectedService && selectedProfessional && selectedSlot && (canUseExistingPatient || canUseNewPatient))
	);

	const goToStep = (target: number) => {
		if (target < 1 || target > 4) return;
		if (target > 1 && !selectedService) return;
		if (target > 2 && !selectedProfessional) return;
		if (target > 3 && !selectedSlot) return;
		step = target;
	};

	const selectService = (serviceId: string) => {
		selectedServiceId = serviceId;
		selectedProfessionalId = '';
		selectedSlotStartsAt = '';
		selectedPatientId = '';
		slots = [];
		slotsLoaded = false;
		slotsError = '';
		visibleWeekStart = safeStartDate();
		step = 2;
	};

	const selectProfessional = (professionalId: string) => {
		selectedProfessionalId = professionalId;
		selectedSlotStartsAt = '';
		visibleWeekStart = nextSlotByProfessional[professionalId]?.date ?? safeStartDate();
		step = 3;
	};

	const selectSlot = (slot: Slot) => {
		selectedSlotStartsAt = slot.starts_at;
		step = 4;
	};

	const loadServiceSlots = async (serviceId: string, fromDate: string) => {
		const request = ++slotRequest;
		loadingSlots = true;
		slotsLoaded = false;
		slotsError = '';
		const toDate = addDays(fromDate, 27);
		try {
			const params = new URLSearchParams({
				service_id: serviceId,
				from: fromDate,
				to: toDate
			});
			const response = await fetch(`/odonto/disponibilidad/slots?${params.toString()}`);
			const payload = await response.json();
			if (request !== slotRequest) return;
			if (!response.ok) {
				slots = [];
				slotsError = payload?.message ?? 'No se pudieron cargar los horarios.';
				return;
			}
			slots = Array.isArray(payload?.slots) ? payload.slots : [];
			slotsLoaded = true;
		} catch {
			if (request !== slotRequest) return;
			slots = [];
			slotsError = 'No se pudieron cargar los horarios.';
		} finally {
			if (request === slotRequest) loadingSlots = false;
		}
	};

	const loadPatients = async (query: string) => {
		const request = ++patientSearchRequest;
		patientSearchLoading = true;
		patientSearchError = '';
		try {
			const response = await fetch(`/odonto/pacientes/buscar?q=${encodeURIComponent(query)}`);
			const payload = await response.json();
			if (request !== patientSearchRequest) return;
			if (!response.ok) {
				remotePatients = [];
				patientSearchError = payload?.message ?? 'No se pudo buscar pacientes.';
				return;
			}
			remotePatients = Array.isArray(payload?.patients) ? payload.patients : [];
		} catch {
			if (request !== patientSearchRequest) return;
			remotePatients = [];
			patientSearchError = 'No se pudo buscar pacientes.';
		} finally {
			if (request === patientSearchRequest) patientSearchLoading = false;
		}
	};

	$effect(() => {
		if (!selectedServiceId) {
			slots = [];
			slotsLoaded = false;
			return;
		}
		void loadServiceSlots(selectedServiceId, visibleWeekStart || safeStartDate());
	});

	$effect(() => {
		if (!selectedProfessionalId) return;
		if (!offeringProfessionals.some((professional: Professional) => professional.id === selectedProfessionalId)) {
			selectedProfessionalId = '';
			selectedSlotStartsAt = '';
			step = 2;
		}
	});

	$effect(() => {
		if (slots.length === 0 || !pendingInitialTime) return;
		const initialSlot = slots.find((slot) => slot.date === visibleWeekStart && slot.time === pendingInitialTime);
		if (initialSlot) {
			selectedSlotStartsAt = initialSlot.starts_at;
			pendingInitialTime = '';
			step = 4;
		}
	});

	$effect(() => {
		const query = patientSearch.trim();
		if (query.length < 2) {
			remotePatients = [];
			patientSearchLoading = false;
			patientSearchError = '';
			return;
		}
		const timeout = window.setTimeout(() => void loadPatients(query), 220);
		return () => window.clearTimeout(timeout);
	});
</script>

<form method="POST" action="?/create_appointment" class="overflow-hidden rounded-3xl border border-[#244062] bg-[#071626] shadow-2xl shadow-black/20">
	<input type="hidden" name="service_id" value={selectedServiceId} />
	<input type="hidden" name="professional_id" value={selectedProfessionalId} />
	<input type="hidden" name="date" value={selectedSlot?.date ?? visibleWeekStart} />
	<input type="hidden" name="time" value={selectedSlot?.time ?? ''} />
	<input type="hidden" name="internal_note" value={internalNote} />

	<div class="border-b border-white/10 px-5 py-5 sm:px-8">
		<div class="mx-auto flex max-w-sm items-center justify-center gap-3">
			{#each [1, 2, 3, 4] as item, index}
				<button
					type="button"
					onclick={() => goToStep(item)}
					class={`grid h-9 w-9 place-items-center rounded-full text-sm font-bold transition ${
						step === item
							? 'bg-[#7c3aed] text-white shadow-lg shadow-[#7c3aed]/30'
							: step > item
								? 'bg-[#6d5dfc] text-white'
								: 'bg-white/10 text-white/60'
					}`}
					aria-label={`Paso ${item}`}
				>
					{step > item ? '✓' : item}
				</button>
				{#if index < 3}
					<span class={`h-px flex-1 ${step > item ? 'bg-[#7c3aed]' : 'bg-white/15'}`}></span>
				{/if}
			{/each}
		</div>
	</div>

	<div class="min-h-[520px] px-5 py-7 sm:px-8 sm:py-9">
		{#if step === 1}
			<section class="mx-auto max-w-5xl">
				<div class="text-center">
					<h2 class="text-2xl font-semibold text-white">¿Qué necesita el paciente?</h2>
				</div>

				<div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{#each services as service}
						<button
							type="button"
							disabled={!canCreateAppointment}
							onclick={() => selectService(service.id)}
							class={`group min-h-48 rounded-3xl border p-5 text-center transition disabled:opacity-60 ${
								selectedServiceId === service.id
									? 'border-[#8b5cf6] bg-[#7c3aed]/20 shadow-xl shadow-[#7c3aed]/20'
									: 'border-white/10 bg-white/[0.04] hover:border-[#8b5cf6]/70 hover:bg-white/[0.07]'
							}`}
						>
							<span class="block text-lg font-semibold leading-tight text-white">{service.name}</span>
							<span class="mt-4 inline-flex rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white/85">
								{durationLabel(service.duration_minutes)}
							</span>
						</button>
					{/each}
				</div>

				{#if services.length === 0}
					<p class="mt-8 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center text-sm text-white/75">
						No hay servicios cargados.
					</p>
				{/if}
			</section>
		{:else if step === 2}
			<section class="mx-auto max-w-5xl">
				<div class="text-center">
					<h2 class="text-2xl font-semibold text-white">
						¿Quién puede hacerlo?
					</h2>
					{#if selectedService}
						<p class="mt-2 text-sm font-semibold text-[#a78bfa]">{selectedService.name}</p>
					{/if}
				</div>

				{#if loadingSlots}
					<p class="mt-8 text-center text-sm text-white/70">Buscando disponibilidad...</p>
				{/if}

				<div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each selectableProfessionals as professional}
						{@const nextSlot = nextSlotByProfessional[professional.id] ?? null}
						<button
							type="button"
							disabled={!canCreateAppointment || !nextSlot}
							onclick={() => selectProfessional(professional.id)}
							class={`relative min-h-56 rounded-3xl border p-5 text-center transition disabled:opacity-50 ${
								selectedProfessionalId === professional.id
									? 'border-[#8b5cf6] bg-[#7c3aed]/20 shadow-xl shadow-[#7c3aed]/20'
									: 'border-white/10 bg-white/[0.04] hover:border-[#8b5cf6]/70 hover:bg-white/[0.07]'
							}`}
						>
							<span class="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[#7c3aed]/25 text-white ring-1 ring-[#8b5cf6]/35">
								<svg class="h-9 w-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
									<path stroke-linecap="round" stroke-linejoin="round" d="M20 21a8 8 0 0 0-16 0" />
									<circle cx="12" cy="8" r="4" />
								</svg>
							</span>
							<span class="mt-5 block text-lg font-semibold text-white">{professional.name}</span>
							{#if professional.specialty}
								<span class="mt-1 block text-sm text-white/60">{professional.specialty}</span>
							{/if}
							<span class="mt-5 inline-flex items-center gap-2 rounded-full bg-emerald-400/10 px-3 py-1 text-sm font-semibold text-emerald-200">
								<span class="h-2 w-2 rounded-full bg-emerald-300"></span>
								{formatNextSlot(nextSlot)}
							</span>
						</button>
					{/each}
				</div>

				{#if slotsLoaded && selectableProfessionals.length === 0}
					<p class="mt-8 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center text-sm text-white/75">
						No hay profesionales con horarios disponibles.
					</p>
				{/if}
				{#if slotsError}
					<p class="mt-8 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-center text-sm text-red-100">
						{slotsError}
					</p>
				{/if}

				<div class="mt-8 flex justify-start">
					<button type="button" onclick={() => (step = 1)} class="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
						Volver
					</button>
				</div>
			</section>
		{:else if step === 3}
			<section class="mx-auto max-w-6xl">
				<div class="grid gap-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
					<button type="button" onclick={() => (step = 2)} class="w-fit rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
						Volver
					</button>
					<div class="text-center">
						<h2 class="text-2xl font-semibold text-white">Elegí un horario</h2>
						{#if selectedService}
							<p class="mt-2 text-sm text-white/65">{selectedService.duration_minutes} minutos</p>
						{/if}
					</div>
					<div class="flex gap-2 sm:justify-end">
						<button
							type="button"
							onclick={() => {
								visibleWeekStart = addDays(visibleWeekStart, -7);
								selectedSlotStartsAt = '';
							}}
							class="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
						>
							Anterior
						</button>
						<button
							type="button"
							onclick={() => {
								visibleWeekStart = addDays(visibleWeekStart, 7);
								selectedSlotStartsAt = '';
							}}
							class="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
						>
							Siguiente
						</button>
					</div>
				</div>

				<div class="mt-7 rounded-3xl border border-white/10 bg-white/[0.035] p-4">
					{#if loadingSlots}
						<div class="grid min-h-72 place-items-center text-sm text-white/65">Buscando horarios...</div>
					{:else if slotsByDay.length > 0}
						<div class="grid gap-3">
							{#each slotsByDay as dayGroup}
								<section class={`rounded-2xl border p-4 ${selectedSlot?.date === dayGroup.day ? 'border-[#8b5cf6] bg-[#7c3aed]/12' : 'border-white/10 bg-white/[0.035]'}`}>
									<div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
										<p class="text-base font-bold capitalize text-white">{formatDayName(dayGroup.day)}</p>
										<p class="text-sm font-semibold text-white/55">{formatDayNumber(dayGroup.day)}</p>
									</div>
									<div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
										{#each dayGroup.slots as slot}
											<button
												type="button"
												onclick={() => selectSlot(slot)}
												class={`rounded-xl border px-3 py-3 text-sm font-semibold transition ${
													selectedSlotStartsAt === slot.starts_at
														? 'border-[#8b5cf6] bg-[#7c3aed] text-white shadow-lg shadow-[#7c3aed]/30'
														: 'border-sky-300/25 bg-sky-300/10 text-white hover:border-[#8b5cf6] hover:bg-[#7c3aed]/35'
												}`}
											>
												{slot.time}
											</button>
										{/each}
									</div>
								</section>
							{/each}
						</div>
					{:else}
						<div class="grid min-h-72 place-items-center text-center">
							<div>
								<p class="text-base font-semibold text-white">No hay horarios esta semana.</p>
								<button
									type="button"
									onclick={() => {
										visibleWeekStart = addDays(visibleWeekStart, 7);
										selectedSlotStartsAt = '';
									}}
									class="mt-4 rounded-2xl bg-[#7c3aed] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#6d28d9]"
								>
									Ver semana siguiente
								</button>
							</div>
						</div>
					{/if}
				</div>

				{#if slotsError}
					<p class="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-center text-sm text-red-100">
						{slotsError}
					</p>
				{/if}
			</section>
		{:else}
			<section class="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
				<div>
					<button type="button" onclick={() => (step = 3)} class="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
						Volver
					</button>

					<div class="mt-8 text-center lg:text-left">
						<h2 class="text-2xl font-semibold text-white">¿Para quién es el turno?</h2>
					</div>

					<div class="mt-7 grid gap-4 sm:grid-cols-2">
						<button
							type="button"
							onclick={() => (patientMode = 'existing')}
							class={`rounded-3xl border p-6 text-center transition ${
								patientMode === 'existing'
									? 'border-[#8b5cf6] bg-[#7c3aed]/20 shadow-xl shadow-[#7c3aed]/20'
									: 'border-white/10 bg-white/[0.04] hover:bg-white/[0.07]'
							}`}
						>
							<span class="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#7c3aed]/25 text-white ring-1 ring-[#8b5cf6]/35">
								<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
									<path stroke-linecap="round" stroke-linejoin="round" d="M21 21a7 7 0 0 0-14 0" />
									<circle cx="14" cy="8" r="4" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M3 11h5M5.5 8.5v5" />
								</svg>
							</span>
							<span class="mt-4 block text-lg font-semibold text-white">Buscar paciente</span>
						</button>
						<button
							type="button"
							onclick={() => {
								patientMode = 'new';
								selectedPatientId = '';
							}}
							class={`rounded-3xl border p-6 text-center transition ${
								patientMode === 'new'
									? 'border-[#8b5cf6] bg-[#7c3aed]/20 shadow-xl shadow-[#7c3aed]/20'
									: 'border-white/10 bg-white/[0.04] hover:bg-white/[0.07]'
							}`}
						>
							<span class="mx-auto grid h-16 w-16 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/10">
								<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
									<path stroke-linecap="round" stroke-linejoin="round" d="M20 21a8 8 0 0 0-16 0" />
									<circle cx="12" cy="8" r="4" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M19 8v6M16 11h6" />
								</svg>
							</span>
							<span class="mt-4 block text-lg font-semibold text-white">Nuevo paciente</span>
						</button>
					</div>

					{#if patientMode === 'existing'}
						<input type="hidden" name="patient_name" value="" />
						<input type="hidden" name="patient_phone" value="" />
						<input type="hidden" name="patient_email" value="" />
						<div class="mt-6">
							<label>
								<span class="mb-2 block text-sm font-bold text-white/70">Buscar por nombre, teléfono o DNI</span>
								<input
									bind:value={patientSearch}
									placeholder="Escribí al menos 2 caracteres"
									class="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-[#8b5cf6]"
								/>
							</label>
							<input type="hidden" name="patient_id" value={selectedPatientId} />
							{#if patientSearchLoading}
								<p class="mt-3 text-sm font-semibold text-white/55">Buscando pacientes...</p>
							{/if}
							{#if patientSearchError}
								<p class="mt-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm font-semibold text-red-100">{patientSearchError}</p>
							{/if}
							<div class="mt-3 grid gap-2">
								{#each visiblePatients as patient}
									<button
										type="button"
										onclick={() => (selectedPatientId = patient.id)}
										class={`rounded-2xl border px-4 py-3 text-left transition ${
											selectedPatientId === patient.id
												? 'border-[#8b5cf6] bg-[#7c3aed]/25 text-white'
												: 'border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.07]'
										}`}
									>
										<span class="block font-semibold">{patient.full_name}</span>
										{#if patient.phone_e164}
											<span class="mt-1 block text-sm text-white/55">{patient.phone_e164}</span>
										{/if}
									</button>
								{/each}
								{#if visiblePatients.length === 0}
									<p class="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/65">
										No encontramos pacientes.
									</p>
								{/if}
							</div>
						</div>
					{:else}
						<input type="hidden" name="patient_id" value="" />
						<div class="mt-6 grid gap-3">
							<label>
								<span class="mb-2 block text-sm font-bold text-white/70">Nombre del paciente</span>
								<input
									name="patient_name"
									bind:value={patientName}
									required
									disabled={!canCreateAppointment}
									class="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-[#8b5cf6] disabled:opacity-60"
								/>
							</label>
							<label>
								<span class="mb-2 block text-sm font-bold text-white/70">Teléfono</span>
								<input
									name="patient_phone"
									bind:value={patientPhone}
									required
									disabled={!canCreateAppointment}
									class="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-[#8b5cf6] disabled:opacity-60"
								/>
							</label>
							<label>
								<span class="mb-2 block text-sm font-bold text-white/70">Correo electrónico (opcional)</span>
								<input
									name="patient_email"
									type="email"
									bind:value={patientEmail}
									disabled={!canCreateAppointment}
									class="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-[#8b5cf6] disabled:opacity-60"
								/>
							</label>
						</div>
					{/if}
				</div>

				<aside class="rounded-3xl border border-white/10 bg-white/[0.055] p-5">
					<p class="text-lg font-semibold text-white">Resumen</p>
					<div class="mt-5 space-y-4">
						<div>
							<p class="text-xs font-semibold uppercase tracking-wide text-white/40">Servicio</p>
							<p class="mt-1 font-semibold text-white">{selectedService?.name ?? '-'}</p>
						</div>
						<div>
							<p class="text-xs font-semibold uppercase tracking-wide text-white/40">Profesional</p>
							<p class="mt-1 font-semibold text-white">{selectedProfessional?.name ?? '-'}</p>
						</div>
						<div>
							<p class="text-xs font-semibold uppercase tracking-wide text-white/40">Fecha</p>
							<p class="mt-1 font-semibold capitalize text-white">{selectedSlot ? formatLongDate(selectedSlot.date) : '-'}</p>
						</div>
						<div>
							<p class="text-xs font-semibold uppercase tracking-wide text-white/40">Hora</p>
							<p class="mt-1 font-semibold text-white">{selectedSlot?.time ?? '-'}</p>
						</div>
						<div>
							<p class="text-xs font-semibold uppercase tracking-wide text-white/40">Paciente</p>
							<p class="mt-1 font-semibold text-white">
								{patientMode === 'existing' ? selectedPatient?.full_name ?? '-' : patientName || '-'}
							</p>
						</div>
					</div>
					<button
						type="submit"
						disabled={!canCreateAppointment || !canCreate}
						class="mt-6 w-full rounded-2xl bg-[#7c3aed] px-5 py-4 text-base font-semibold text-white shadow-lg shadow-[#7c3aed]/25 transition hover:bg-[#6d28d9] disabled:cursor-not-allowed disabled:opacity-45"
					>
						Crear turno
					</button>
				</aside>
			</section>
		{/if}
	</div>
</form>
