<script lang="ts">
	import { deserialize } from '$app/forms';
	import { page } from '$app/stores';
	import { env } from '$env/dynamic/public';
	import BackLink from '$lib/components/BackLink.svelte';
	import { createDriveFolder, getUserInfo, requestAccessToken } from '$lib/client/drive';

	let { data } = $props<{
		data: {
			demo: boolean;
			driveConnection: {
				connected_email?: string | null;
				root_folder_id?: string | null;
			} | null;
		};
	}>();

	const DRIVE_SCOPES =
		'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';
	const APP_FOLDER_NAME = 'Dental Suite';
	const PATIENTS_FOLDER_NAME = 'Pacientes';

	const googleClientId = env.PUBLIC_GOOGLE_CLIENT_ID ?? '';
	let driveConnection = $state<typeof data.driveConnection>(null);
	let busy = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');
	let infoMessage = $state('');

	const isConnected = $derived(Boolean(driveConnection?.root_folder_id));
	const hasClientId = Boolean(googleClientId);
	const returnTarget = $derived.by(() => {
		const raw = $page.url.searchParams.get('return') ?? '';
		try {
			const decoded = decodeURIComponent(raw);
			return decoded.startsWith('/odonto/') ? decoded : '';
		} catch {
			return '';
		}
	});
	const rootFolderLink = $derived(
		driveConnection?.root_folder_id
			? `https://drive.google.com/drive/folders/${driveConnection.root_folder_id}`
			: ''
	);

	const postAction = async (action: string, formData: FormData) => {
		const response = await fetch(action, { method: 'POST', body: formData });
		const result = deserialize(await response.text());
		if (result.type === 'failure') {
			throw new Error((result.data as { message?: string })?.message ?? 'Error inesperado.');
		}
		if (result.type === 'error') throw new Error('Error inesperado.');
		if (result.type === 'redirect') {
			window.location.assign(result.location);
			throw new Error('Redireccionando...');
		}
		return (result.data ?? {}) as Record<string, unknown>;
	};

	const connectDrive = async () => {
		errorMessage = '';
		successMessage = '';
		infoMessage = '';
		if (!googleClientId) {
			errorMessage = 'Falta configurar Google Drive.';
			return;
		}
		busy = true;
		try {
			const promptValue = driveConnection?.root_folder_id ? 'select_account' : 'consent';
			const token = await requestAccessToken({ clientId: googleClientId, scopes: DRIVE_SCOPES, prompt: promptValue });
			const userInfo = await getUserInfo(token);
			const email = userInfo.email ?? 'Cuenta conectada';
			const sameAccount =
				driveConnection?.connected_email &&
				email &&
				driveConnection.connected_email.toLowerCase() === email.toLowerCase();

			if (driveConnection?.connected_email && !sameAccount) {
				await postAction('?/disconnect_drive', new FormData());
				driveConnection = null;
				infoMessage = 'Cuenta anterior desconectada.';
			}

			let rootFolderId = sameAccount ? driveConnection?.root_folder_id ?? '' : '';
			if (!rootFolderId) {
				const appFolderId = await createDriveFolder({ accessToken: token, name: APP_FOLDER_NAME });
				rootFolderId = await createDriveFolder({ accessToken: token, name: PATIENTS_FOLDER_NAME, parentId: appFolderId });
			}

			const formData = new FormData();
			formData.set('connected_email', email);
			formData.set('root_folder_id', rootFolderId);
			await postAction('?/save_drive_connection', formData);
			driveConnection = { connected_email: email, root_folder_id: rootFolderId };
			successMessage = 'Drive conectado.';
			if (returnTarget) window.location.assign(returnTarget);
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'No se pudo conectar Drive.';
			errorMessage = msg.includes('popup') ? 'Permití los popups para conectar Drive.' : msg;
		} finally {
			busy = false;
		}
	};

	const disconnectDrive = async () => {
		errorMessage = '';
		successMessage = '';
		infoMessage = '';
		busy = true;
		try {
			await postAction('?/disconnect_drive', new FormData());
			driveConnection = null;
			successMessage = 'Drive desconectado.';
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'No se pudo desconectar Drive.';
		} finally {
			busy = false;
		}
	};

	$effect(() => {
		driveConnection = data.driveConnection;
	});
</script>

<section class="ux-page">
	<div class="ux-hero">
		<BackLink href={returnTarget || '/odonto/pacientes'} label="Volver" class="mb-5" />
		<p class="ux-badge">Configuración</p>
		<h1 class="ux-title mt-4">Ajustes del consultorio</h1>
		<p class="ux-subtitle">Datos, permisos y almacenamiento.</p>
	</div>

	<div class="grid gap-4 lg:grid-cols-2">
		<a href="/odonto/configuracion/negocio" class="ux-choice p-6">
			<span class="ux-badge">Consultorio</span>
			<h2 class="mt-4 text-2xl font-bold text-white">Datos y reserva online</h2>
			<p class="mt-2 text-sm text-white/55">Nombre, enlace público, contacto y reglas de reserva.</p>
		</a>
		<a href="/odonto/configuracion/usuarios" class="ux-choice p-6">
			<span class="ux-badge">Permisos</span>
			<h2 class="mt-4 text-2xl font-bold text-white">Usuarios</h2>
			<p class="mt-2 text-sm text-white/55">Quién puede entrar y qué puede hacer.</p>
		</a>
	</div>

	<div class="ux-card">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<h2 class="ux-section-title">Radiografías</h2>
				<p class="mt-2 text-sm text-white/55">
					{#if isConnected}
						Conectado como {driveConnection?.connected_email ?? 'tu cuenta'}.
					{:else}
						Google Drive no está conectado.
					{/if}
				</p>
			</div>
			<div class="flex flex-wrap gap-2">
				<button type="button" class="ux-btn-primary" onclick={connectDrive} disabled={busy || data.demo || !hasClientId}>
					{isConnected ? 'Cambiar cuenta' : 'Conectar Drive'}
				</button>
				{#if isConnected}
					<button type="button" class="ux-btn-secondary" onclick={disconnectDrive} disabled={busy || data.demo}>
						Desconectar
					</button>
				{/if}
			</div>
		</div>

		{#if data.demo}
			<p class="ux-alert mt-4">No disponible en modo demo.</p>
		{/if}
		{#if !hasClientId}
			<p class="ux-alert mt-4">Falta configurar Google Drive.</p>
		{/if}
		{#if errorMessage}
			<p class="ux-alert mt-4">{errorMessage}</p>
		{/if}
		{#if infoMessage}
			<p class="ux-alert mt-4">{infoMessage}</p>
		{/if}
		{#if successMessage}
			<p class="ux-alert ux-alert-success mt-4">{successMessage}</p>
		{/if}

		{#if isConnected}
			<a href={rootFolderLink} target="_blank" rel="noreferrer" class="ux-btn-secondary mt-5">
				Abrir carpeta
			</a>
		{/if}
	</div>
</section>
