<script lang="ts">
	type Professional = {
		id: string;
		name: string;
		specialty: string | null;
		phone: string | null;
		email: string | null;
		is_active: boolean;
		is_public: boolean;
	};

	type Service = {
		id: string;
		name: string;
		duration_minutes: number;
		price_label: string | null;
		is_active: boolean;
		is_public: boolean;
	};

	type AvailabilityRule = {
		weekday: number;
		start_time: string;
		end_time: string;
		slot_interval_minutes: number;
		is_active: boolean;
	};

	type AvailabilityException = {
		starts_at: string;
		ends_at: string;
		type: 'blocked' | 'extra_available';
		reason: string | null;
	};

	let { data } = $props<{
		data: {
			professional: Professional | null;
			hasInconsistentLinks?: boolean;
			services: Service[];
			availabilityRules: AvailabilityRule[];
			availabilityExceptions: AvailabilityException[];
			demo: boolean;
		};
	}>();

	const weekdayLabels = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
	const cleanTime = (value: string) => String(value ?? '').slice(0, 5);
	const formatDateTime = (value: string) =>
		new Intl.DateTimeFormat('es-AR', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));

	const groupedRules = $derived.by(() => {
		const groups = new Map<number, AvailabilityRule[]>();
		for (const rule of data.availabilityRules) {
			const list = groups.get(rule.weekday) ?? [];
			list.push(rule);
			groups.set(rule.weekday, list);
		}
		return Array.from(groups.entries()).sort(([a], [b]) => a - b);
	});
</script>

<section class="ux-page">
	<div class="ux-hero">
		<div>
			<h1 class="ux-title">Mi perfil</h1>
			<p class="ux-subtitle">Tus datos, servicios y horarios asignados por el consultorio.</p>
		</div>
	</div>

	{#if data.hasInconsistentLinks}
		<p class="ux-alert">
			Tu usuario está vinculado a más de un profesional. Contactá soporte para corregirlo antes de operar.
		</p>
	{/if}

	{#if !data.professional}
		<div class="ux-empty">
			Tu usuario no está asociado a ningún profesional. Pedile al dueño o administrador que complete el vínculo.
		</div>
	{:else}
		<div class="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
			<section class="ux-card">
				<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<h2 class="ux-section-title">Datos</h2>
						<p class="mt-1 text-sm text-white/55">Estos datos son administrados por el consultorio.</p>
					</div>
					<span class={data.professional.is_active ? 'ux-badge ux-badge-success' : 'ux-badge'}>
						{data.professional.is_active ? 'Activo' : 'No disponible'}
					</span>
				</div>

				<div class="mt-5 grid gap-3">
					<div class="ux-soft-card p-4">
						<p class="text-sm font-bold text-white/50">Nombre</p>
						<p class="mt-1 text-lg font-bold text-white">{data.professional.name}</p>
					</div>
					<div class="ux-soft-card p-4">
						<p class="text-sm font-bold text-white/50">Especialidad</p>
						<p class="mt-1 text-base font-semibold text-white">
							{data.professional.specialty ?? 'Sin especialidad cargada'}
						</p>
					</div>
					<div class="grid gap-3 sm:grid-cols-2">
						<div class="ux-soft-card p-4">
							<p class="text-sm font-bold text-white/50">Teléfono</p>
							<p class="mt-1 text-base font-semibold text-white">{data.professional.phone ?? 'Sin registrar'}</p>
						</div>
						<div class="ux-soft-card p-4">
							<p class="text-sm font-bold text-white/50">Correo</p>
							<p class="mt-1 break-all text-base font-semibold text-white">{data.professional.email ?? 'Sin registrar'}</p>
						</div>
					</div>
				</div>
			</section>

			<section class="ux-card">
				<h2 class="ux-section-title">Servicios asignados</h2>
				<p class="mt-1 text-sm text-white/55">
					Estos servicios fueron configurados por el consultorio. Para modificarlos, hablá con el dueño o administrador.
				</p>
				<div class="mt-5 grid gap-3">
					{#each data.services as service}
						<div class="ux-choice p-4">
							<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
								<div>
									<p class="text-base font-bold text-white">{service.name}</p>
									<p class="mt-1 text-sm text-white/55">
										{service.duration_minutes} min{service.price_label ? ` · ${service.price_label}` : ''}
									</p>
								</div>
								<span class={service.is_active && service.is_public ? 'ux-badge ux-badge-success' : 'ux-badge'}>
									{service.is_active && service.is_public ? 'Visible en reservas' : 'Interno'}
								</span>
							</div>
						</div>
					{/each}
					{#if data.services.length === 0}
						<p class="ux-empty">No tenés servicios asignados todavía.</p>
					{/if}
				</div>
			</section>
		</div>

		<section class="ux-card">
			<h2 class="ux-section-title">Horarios asignados</h2>
			<p class="mt-1 text-sm text-white/55">
				Estos horarios fueron configurados por el consultorio. Para modificar tu disponibilidad, hablá con el dueño o administrador.
			</p>
			<div class="mt-5 grid gap-3 lg:grid-cols-2">
				<div class="grid gap-3">
					{#each groupedRules as [weekday, rules]}
						<div class="ux-soft-card p-4">
							<p class="text-sm font-bold text-white">{weekdayLabels[weekday] ?? 'Día'}</p>
							<div class="mt-2 flex flex-wrap gap-2">
								{#each rules as rule}
									<span class="ux-badge">
										{cleanTime(rule.start_time)} a {cleanTime(rule.end_time)} · cada {rule.slot_interval_minutes} min
									</span>
								{/each}
							</div>
						</div>
					{/each}
					{#if groupedRules.length === 0}
						<p class="ux-empty">No tenés horarios configurados todavía.</p>
					{/if}
				</div>

				<div class="grid gap-3">
					<h3 class="text-sm font-bold uppercase tracking-wide text-white/55">Cambios puntuales</h3>
					{#each data.availabilityExceptions as item}
						<div class="ux-soft-card p-4">
							<span class={item.type === 'blocked' ? 'ux-badge ux-badge-danger' : 'ux-badge ux-badge-success'}>
								{item.type === 'blocked' ? 'Bloqueo' : 'Horario extra'}
							</span>
							<p class="mt-2 text-sm font-semibold text-white">
								{formatDateTime(item.starts_at)} a {formatDateTime(item.ends_at)}
							</p>
							{#if item.reason}
								<p class="mt-1 text-sm text-white/55">{item.reason}</p>
							{/if}
						</div>
					{/each}
					{#if data.availabilityExceptions.length === 0}
						<p class="ux-empty">No hay cambios puntuales próximos.</p>
					{/if}
				</div>
			</div>
		</section>
	{/if}
</section>
