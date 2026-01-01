<script lang="ts">
	import { deserialize } from '$app/forms';
	import { env } from '$env/dynamic/public';
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
	const APP_FOLDER_NAME = 'Base de Datos Sabrina';
	const PATIENTS_FOLDER_NAME = 'Pacientes';

	const googleClientId = env.PUBLIC_GOOGLE_CLIENT_ID ?? '';
	let driveConnection = $state<typeof data.driveConnection>(null);
	let busy = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');
	let infoMessage = $state('');

	const isConnected = $derived(Boolean(driveConnection?.root_folder_id));
	const hasClientId = Boolean(googleClientId);
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
		if (result.type === 'redirect') {
			window.location.assign(result.location);
			throw new Error('Redireccionando...');
		}
		return result.data as Record<string, unknown>;
	};

	const connectDrive = async () => {
		errorMessage = '';
		successMessage = '';
		infoMessage = '';
		if (!googleClientId) {
			errorMessage = 'Falta configurar PUBLIC_GOOGLE_CLIENT_ID.';
			return;
		}
		busy = true;
		try {
			const promptValue = driveConnection?.root_folder_id ? 'select_account' : 'consent';
			const token = await requestAccessToken({
				clientId: googleClientId,
				scopes: DRIVE_SCOPES,
				prompt: promptValue
			});
			const userInfo = await getUserInfo(token);
			const email = userInfo.email ?? 'Cuenta conectada';
			const sameAccount =
				driveConnection?.connected_email &&
				email &&
				driveConnection.connected_email.toLowerCase() === email.toLowerCase();

			if (driveConnection?.connected_email && !sameAccount) {
				await postAction('?/disconnect_drive', new FormData());
				driveConnection = null;
				infoMessage = 'Cuenta anterior desconectada. Se va a crear una carpeta nueva.';
			}

			let rootFolderId = sameAccount ? driveConnection?.root_folder_id ?? '' : '';

			if (!rootFolderId) {
				const appFolderId = await createDriveFolder({
					accessToken: token,
					name: APP_FOLDER_NAME
				});
				rootFolderId = await createDriveFolder({
					accessToken: token,
					name: PATIENTS_FOLDER_NAME,
					parentId: appFolderId
				});
			}

			const formData = new FormData();
			formData.set('connected_email', email);
			formData.set('root_folder_id', rootFolderId);
			await postAction('?/save_drive_connection', formData);
			driveConnection = { connected_email: email, root_folder_id: rootFolderId };
			successMessage = 'Drive conectado correctamente.';
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'No se pudo conectar Drive.';
			if (msg.includes('popup') || msg.includes('popup_blocked_by_browser')) {
				errorMessage = 'Permiti los popups para conectar Drive.';
			} else if (msg.includes('popup_closed_by_user') || msg.includes('access_denied')) {
				errorMessage = 'La autorizacion fue cancelada.';
			} else {
				errorMessage = msg;
			}
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
			successMessage = 'Drive desconectado. Las carpetas por paciente se reiniciaron.';
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

<section class="flex flex-col gap-6">
	<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<h1 class="text-2xl font-semibold text-neutral-900 dark:text-white">Configuración</h1>
		<p class="mt-2 text-sm text-neutral-600 dark:text-neutral-200">
			Las radiografías se guardan en tu Google Drive. La app solo mantiene el índice por paciente.
		</p>
	</div>

	<div class="rounded-2xl border border-neutral-100 bg-white/90 p-5 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Almacenamiento de radiografías</h2>
				<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-200">
					Estado:
					{#if isConnected}
						<span class="font-semibold">Conectado como {driveConnection?.connected_email ?? 'tu cuenta'}</span>
					{:else}
						<span class="font-semibold">No conectado</span>
					{/if}
				</p>
			</div>
			<div class="flex flex-col gap-2 sm:flex-row">
				<button
					type="button"
					class="rounded-full bg-[#7c3aed] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#6d28d9] disabled:cursor-not-allowed disabled:opacity-60"
					onclick={connectDrive}
					disabled={busy || data.demo || !hasClientId}
				>
					{isConnected ? 'Cambiar cuenta' : 'Conectar Google Drive'}
				</button>
				{#if isConnected}
					<button
						type="button"
						class="rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:-translate-y-0.5 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#1f3554] dark:text-neutral-200 dark:hover:bg-[#0f1f36]"
						onclick={disconnectDrive}
						disabled={busy || data.demo}
					>
						Desconectar
					</button>
				{/if}
			</div>
		</div>

		{#if data.demo}
			<p class="mt-4 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
				Conexión a Drive no disponible en modo demo.
			</p>
		{/if}
		{#if !hasClientId}
			<p class="mt-4 rounded-xl border border-dashed border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
				Falta configurar el Client ID de Google para habilitar la conexión.
			</p>
		{/if}

		{#if errorMessage}
			<p class="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
				{errorMessage}
			</p>
		{/if}
		{#if infoMessage}
			<p class="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
				{infoMessage}
			</p>
		{/if}
		{#if successMessage}
			<p class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
				{successMessage}
			</p>
		{/if}

		<p class="mt-4 text-xs text-neutral-500 dark:text-neutral-300">
			La app solo puede ver archivos subidos desde la app (scope drive.file).
		</p>
		{#if isConnected}
			<a
				href={rootFolderLink}
				target="_blank"
				rel="noreferrer"
				class="mt-2 inline-flex text-xs font-semibold text-[#7c3aed] hover:underline"
			>
				Abrir carpeta en Drive
			</a>
		{/if}
	</div>
</section>
