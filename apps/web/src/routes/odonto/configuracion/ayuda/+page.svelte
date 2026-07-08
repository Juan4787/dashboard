<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';

	let { data, form } = $props();

	const assistance = $derived(data.assistance);
	const context = $derived(data.context);
	const isOwner = $derived(context?.role === 'owner' && !context?.assistance);
	const isAssisting = $derived(Boolean(context?.assistance));
	const canUseBusiness = $derived(Boolean(context?.access?.canUseBusiness));
	const returnTo = '/odonto/configuracion/ayuda';
</script>

<section class="ux-page">
	<div class="ux-hero">
		<BackLink href="/odonto/configuracion" label="Volver" class="mb-5" />
		<p class="ux-badge">Configuración</p>
		<h1 class="ux-title mt-4">Ayuda para configurar</h1>
		<p class="ux-subtitle">
			Una forma simple de recibir ayuda inicial sin compartir tu contraseña.
		</p>
	</div>

	{#if form?.message}
		<p class="ux-alert">{form.message}</p>
	{/if}

	<div class="ux-card">
		{#if isAssisting}
			<div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
				<div>
					<p class="ux-badge ux-badge-success">Cita Suite</p>
					<h2 class="ux-section-title mt-4">Estás configurando esta cuenta</h2>
					<p class="mt-2 max-w-2xl text-sm leading-6 text-white/60">
						Esta ayuda termina a las {assistance.endsAtLabel ?? 'hora indicada'}. Los cambios de
						suscripción, dueños y administradores quedan fuera de este flujo.
					</p>
				</div>
				<span class="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-sm font-black text-emerald-100">
					<span class="h-[0.85em] w-[0.85em] rounded-full bg-emerald-400 shadow-[0_0_0.8rem_rgba(52,211,153,0.85)]"></span>
					Activa
				</span>
			</div>
		{:else if !canUseBusiness}
			<h2 class="ux-section-title">La cuenta debe estar activa</h2>
			<p class="mt-2 max-w-2xl text-sm leading-6 text-white/60">
				Primero regularizá la suscripción. Después vas a poder pedir ayuda para completar la configuración.
			</p>
		{:else if assistance.status === 'active'}
			<div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
				<div>
					<span class="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-emerald-100">
						<span class="h-[0.85em] w-[0.85em] rounded-full bg-emerald-400 shadow-[0_0_0.8rem_rgba(52,211,153,0.85)]"></span>
						Activa
					</span>
					<h2 class="ux-section-title mt-4">Ayuda de Cita Suite activa</h2>
					<p class="mt-2 max-w-2xl text-sm leading-6 text-white/60">
						Podemos configurar esta cuenta hasta las {assistance.endsAtLabel ?? 'hora indicada'}.
						Podés detener la ayuda cuando quieras.
					</p>
				</div>
				{#if isOwner}
					<form method="post" action="?/revoke">
						<input type="hidden" name="return_to" value={returnTo} />
						<button class="ux-btn-secondary">Detener ayuda</button>
					</form>
				{/if}
			</div>
		{:else if assistance.status === 'expired'}
			<div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
				<div>
					<p class="ux-badge ux-badge-warning">Finalizada</p>
					<h2 class="ux-section-title mt-4">La ayuda de Cita Suite finalizó</h2>
					<p class="mt-2 max-w-2xl text-sm leading-6 text-white/60">
						Ya no podemos hacer cambios en esta cuenta. Si todavía necesitás ayuda, podés activarla otra vez.
					</p>
				</div>
				{#if isOwner}
					<div class="flex flex-wrap gap-2">
						<form method="post" action="?/activate">
							<input type="hidden" name="return_to" value={returnTo} />
							<button class="ux-btn-primary">Volver a activar</button>
						</form>
						{#if assistance.canDismiss && assistance.grantId}
							<form method="post" action="?/dismiss">
								<input type="hidden" name="return_to" value={returnTo} />
								<input type="hidden" name="grant_id" value={assistance.grantId} />
								<button class="ux-btn-secondary">Cerrar aviso</button>
							</form>
						{/if}
					</div>
				{/if}
			</div>
		{:else if assistance.status === 'revoked'}
			<div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
				<div>
					<p class="ux-badge">Detenida</p>
					<h2 class="ux-section-title mt-4">Ayuda detenida</h2>
					<p class="mt-2 max-w-2xl text-sm leading-6 text-white/60">
						Cita Suite ya no puede hacer cambios en esta cuenta.
					</p>
				</div>
				{#if isOwner}
					<div class="flex flex-wrap gap-2">
						<form method="post" action="?/activate">
							<input type="hidden" name="return_to" value={returnTo} />
							<button class="ux-btn-secondary">Activar nuevamente</button>
						</form>
						{#if assistance.canDismiss && assistance.grantId}
							<form method="post" action="?/dismiss">
								<input type="hidden" name="return_to" value={returnTo} />
								<input type="hidden" name="grant_id" value={assistance.grantId} />
								<button class="ux-btn-secondary">Cerrar aviso</button>
							</form>
						{/if}
					</div>
				{/if}
			</div>
		{:else}
			<div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
				<div>
					<h2 class="ux-section-title">¿Querés que te ayudemos a configurar tu cuenta?</h2>
					<p class="mt-2 max-w-2xl text-sm leading-6 text-white/60">
						Podemos ayudarte a cargar profesionales, servicios y horarios iniciales. Se activa por
						1 hora y podés detenerlo cuando quieras.
					</p>
				</div>
				{#if isOwner}
					<form method="post" action="?/activate">
						<input type="hidden" name="return_to" value={returnTo} />
						<button class="ux-btn-primary">Quiero ayuda por 1 hora</button>
					</form>
				{:else}
					<p class="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/65">
						Esta opción la puede activar el dueño del consultorio.
					</p>
				{/if}
			</div>
		{/if}
	</div>

	<div class="ux-card">
		<h2 class="ux-section-title">Qué podemos configurar</h2>
		<div class="mt-4 grid gap-3 md:grid-cols-3">
			<div class="ux-soft-card p-4">
				<p class="font-black text-white">Equipo</p>
				<p class="mt-2 text-sm text-white/55">Profesionales, servicios y horarios habituales.</p>
			</div>
			<div class="ux-soft-card p-4">
				<p class="font-black text-white">Consultorio</p>
				<p class="mt-2 text-sm text-white/55">Datos visibles, reserva online y comunicación inicial.</p>
			</div>
			<div class="ux-soft-card p-4">
				<p class="font-black text-white">Agenda</p>
				<p class="mt-2 text-sm text-white/55">Reglas operativas para que puedas empezar a recibir turnos.</p>
			</div>
		</div>
		<p class="mt-4 text-sm text-white/45">
			La suscripción, los dueños y los administradores se mantienen bajo control del consultorio.
		</p>
	</div>
</section>
