<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import { onDestroy } from 'svelte';

	let { data } = $props<{
		data: {
			demo: boolean;
			context: { business: { name: string } };
			bookingPath: string;
		};
	}>();

	const bookingUrl = $derived(
		typeof window === 'undefined' ? data.bookingPath : `${window.location.origin}${data.bookingPath}`
	);
	let copyStatus = $state<'idle' | 'copied' | 'error'>('idle');
	let copyTimer: number | null = null;

	const copyBookingUrl = async () => {
		try {
			await navigator.clipboard.writeText(bookingUrl);
			copyStatus = 'copied';
		} catch {
			copyStatus = 'error';
		}
		if (copyTimer) window.clearTimeout(copyTimer);
		copyTimer = window.setTimeout(() => (copyStatus = 'idle'), 2200);
	};

	onDestroy(() => {
		if (copyTimer) window.clearTimeout(copyTimer);
	});
</script>

<section class="ux-page">
	<div class="ux-hero">
		<BackLink href="/odonto/configuracion" label="Volver" class="mb-5" />
		<p class="ux-badge">Configuración</p>
		<h1 class="ux-title mt-4">Link de reserva</h1>
		<p class="ux-subtitle">Compartí este enlace para que tus pacientes reserven un turno.</p>
	</div>

	<div class="ux-card">
		<div class="max-w-2xl">
			<h2 class="ux-section-title">Link de reserva de {data.context.business.name}</h2>
			<p class="mt-2 text-sm text-white/55">
				Es el único enlace que necesitás enviarles a tus pacientes.
			</p>
		</div>

		<div class="mt-5 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:flex-row sm:items-center">
			<p class="min-w-0 flex-1 break-all text-sm font-bold text-white">{bookingUrl}</p>
			<div class="flex flex-col gap-2 sm:flex-row">
				<button type="button" class="ux-btn-secondary" onclick={copyBookingUrl}>
					{copyStatus === 'copied' ? 'Copiado' : 'Copiar'}
				</button>
				<a href={data.bookingPath} target="_blank" rel="noreferrer" class="ux-btn-primary text-center">Abrir link</a>
			</div>
		</div>

		{#if copyStatus === 'error'}
			<p class="ux-alert mt-4" role="status">
				No pudimos copiar el enlace automáticamente. Seleccionalo y copialo de forma manual.
			</p>
		{/if}
	</div>
</section>
