<script lang="ts">
	import { page } from '$app/stores';

	const isNotFound = $derived($page.status === 404);
	const title = $derived(isNotFound ? 'No encontramos esa página' : 'Algo no salió como esperábamos');
	const detail = $derived.by(() => {
		const message = $page.error?.message ?? '';
		if (!message || message === 'Internal Error' || message === 'Not Found') {
			return isNotFound
				? 'El enlace no existe o ya no está disponible.'
				: 'Ocurrió un problema inesperado. Probá de nuevo en unos segundos.';
		}
		return message;
	});
</script>

<svelte:head>
	<title>{title} — Cita Suite</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
	<section class="ux-hero w-full max-w-lg text-center">
		<picture>
			<img
				src="/logo-cita-suite.png"
				alt="Cita Suite"
				class="mx-auto h-14 w-14 rounded-2xl"
				width="56"
				height="56"
			/>
		</picture>
		<h1 class="ux-title mt-5">{title}</h1>
		<p class="ux-subtitle mx-auto">{detail}</p>
		<a href="/" class="ux-btn-primary mt-6 inline-flex">Volver al inicio</a>
	</section>
</div>
