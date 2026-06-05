<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import type { BusinessSubscriptionRow } from '$lib/server/commercial-access';

	let { data } = $props();

	const access = $derived(data.context.access);
	const subscription = $derived((access.subscription ?? {}) as Partial<BusinessSubscriptionRow>);

	const formatDateTime = (value?: string | null, empty = 'No vence') =>
		value ? new Date(value).toLocaleString('es-AR') : empty;

	const money = (value?: number | string | null) => {
		if (value === null || value === undefined || value === '') return 'Sin registrar';
		const parsed = Number(value);
		if (!Number.isFinite(parsed)) return String(value);
		return parsed.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
	};

	const statusLabel = $derived.by(() => {
		if (!access.commercialAccessEnabled) return 'Acceso pausado';
		if (access.visualStatus === 'permanent') return 'Permanente';
		if (access.visualStatus === 'expiring') return 'Vence mañana';
		if (access.commercialStatus === 'active') return 'Activo';
		if (access.commercialStatus === 'grace') return 'Vencido';
		if (access.commercialStatus === 'restricted') return 'Pendiente';
		return 'Archivado';
	});

	const statusClass = $derived.by(() => {
		if (access.commercialStatus === 'archived') {
			return 'ux-badge ux-badge-danger';
		}
		if (!access.commercialAccessEnabled || access.commercialStatus === 'restricted') {
			return 'ux-badge ux-badge-warning';
		}
		if (access.commercialStatus === 'grace' || access.visualStatus === 'expiring') {
			return 'ux-badge ux-badge-warning';
		}
		return 'ux-badge ux-badge-success';
	});
</script>

<section class="ux-page">
	<div class="ux-hero">
		<BackLink href="/odonto/configuracion" label="Volver" class="mb-5" />
		<p class="ux-badge">Configuración / Suscripción</p>
		<h1 class="ux-title mt-4">Estado comercial</h1>
		<p class="ux-subtitle">Acceso del consultorio y movimientos registrados.</p>
	</div>

	<div class="ux-card">
		<div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
			<div>
				<span class={statusClass}>{statusLabel}</span>
				<h2 class="mt-4 text-3xl font-black text-white">{data.context.business.name}</h2>
				<p class="mt-2 text-sm text-white/55">
					{access.isPermanent ? 'Tu cuenta no tiene vencimiento.' : 'Estado de acceso del consultorio.'}
				</p>
			</div>
			<div class="grid gap-3 sm:grid-cols-2 lg:min-w-[34rem]">
				<div class="ux-soft-card p-4">
					<p class="text-sm font-bold text-white/45">Vencimiento</p>
					<p class="mt-2 font-bold text-white">{access.isPermanent ? 'No vence' : formatDateTime(access.paidUntil)}</p>
				</div>
				<div class="ux-soft-card p-4">
					<p class="text-sm font-bold text-white/45">Límite antes de suspensión</p>
					<p class="mt-2 font-bold text-white">{access.isPermanent ? 'No vence' : formatDateTime(access.graceUntil)}</p>
				</div>
				<div class="ux-soft-card p-4">
					<p class="text-sm font-bold text-white/45">Límite antes de archivo</p>
					<p class="mt-2 font-bold text-white">{access.isPermanent ? 'No vence' : formatDateTime(access.restrictedUntil)}</p>
				</div>
				<div class="ux-soft-card p-4">
					<p class="text-sm font-bold text-white/45">Último pago</p>
					<p class="mt-2 font-bold text-white">{money(subscription.last_payment_amount)}</p>
				</div>
			</div>
		</div>

		<div class="mt-6 grid gap-3 md:grid-cols-2">
			<div class="ux-soft-card p-4">
				<p class="text-sm font-bold text-white/45">Última actualización</p>
				<p class="mt-2 font-bold text-white">{formatDateTime(subscription.updated_at, 'Sin registrar')}</p>
			</div>
			<div class="ux-soft-card p-4">
				<p class="text-sm font-bold text-white/45">Cómo regularizar</p>
				<p class="mt-2 font-bold text-white">Contactá soporte del sistema.</p>
			</div>
		</div>

		{#if subscription.access_note}
			<p class="ux-alert ux-alert-success mt-5">{subscription.access_note}</p>
		{/if}
	</div>

	<div class="ux-card">
		<div class="flex items-center justify-between gap-4">
			<div>
				<h2 class="ux-section-title">Historial</h2>
				<p class="mt-2 text-sm text-white/55">Cambios de acceso registrados.</p>
			</div>
		</div>

		<div class="mt-5 space-y-3">
			{#if data.grants.length === 0}
				<p class="ux-empty">Sin movimientos registrados.</p>
			{:else}
				{#each data.grants as grant}
					<div class="ux-soft-card p-4">
						<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
							<div>
								<p class="font-black text-white">
									{grant.operation === 'set_permanent' ? 'Acceso permanente' : grant.operation === 'grant_access' || grant.operation === 'extend_access' ? 'Acceso actualizado' : 'Cambio registrado'}
								</p>
								<p class="mt-1 text-sm text-white/55">
									{money(grant.amount)}
								</p>
							</div>
							<time class="text-sm font-bold text-white/45">{formatDateTime(grant.created_at)}</time>
						</div>
						<div class="mt-3 grid gap-3 text-sm md:grid-cols-2">
							<p class="text-white/55">Antes: <span class="font-bold text-white">{formatDateTime(grant.paid_until_before)}</span></p>
							<p class="text-white/55">Después: <span class="font-bold text-white">{formatDateTime(grant.paid_until_after)}</span></p>
						</div>
						{#if grant.note}
							<p class="mt-3 text-sm text-white/70">{grant.note}</p>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	</div>
</section>
