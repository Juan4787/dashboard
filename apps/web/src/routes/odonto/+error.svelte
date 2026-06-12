<script lang="ts">
	import { page } from '$app/stores';

	const isNotFound = $derived($page.status === 404);
	const homeHref = $derived(
		$page.data?.activeBusiness?.role === 'professional' ? '/odonto/mis-turnos' : '/odonto/agenda'
	);
	const title = $derived(isNotFound ? 'No encontramos lo que buscás' : 'Algo no salió como esperábamos');
	const detail = $derived.by(() => {
		const message = $page.error?.message ?? '';
		if (!message || message === 'Internal Error' || message === 'Not Found') {
			return isNotFound
				? 'El contenido no existe o ya no está disponible.'
				: 'Ocurrió un problema al cargar esta sección. Probá de nuevo en unos segundos.';
		}
		return message;
	});
</script>

<section class="ux-page">
	<div class="ux-hero text-center">
		<p class="ux-badge mx-auto">{isNotFound ? 'No disponible' : 'Error'}</p>
		<h1 class="ux-title mt-4">{title}</h1>
		<p class="ux-subtitle mx-auto">{detail}</p>
		<div class="mt-6 flex flex-wrap justify-center gap-3">
			<a href={homeHref} class="ux-btn-primary">Volver al inicio</a>
			<a href="/odonto/pacientes" class="ux-btn-secondary">Ver pacientes</a>
		</div>
	</div>
</section>
