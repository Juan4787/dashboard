<script lang="ts">
	import { deserialize } from '$app/forms';
	import { page } from '$app/stores';
	import { env } from '$env/dynamic/public';
	import Modal from '$lib/components/Modal.svelte';
	import DateTimePartsInput from '$lib/components/DateTimePartsInput.svelte';
	import DatePartsInput from '$lib/components/DatePartsInput.svelte';
	import { CLINICAL_ENTRY_TYPES } from '$lib/constants';
	import {
		createDriveFolder,
		initResumableUpload,
		requestAccessToken,
		uploadResumable
	} from '$lib/client/drive';
	import { formatDate, formatDateTime } from '$lib/utils/format';

	let { data, form } = $props<{
		data: {
			patient: any;
			entries: any[];
			radiographs: any[];
			driveConnection: { connected_email?: string | null; root_folder_id?: string | null } | null;
			demo?: boolean;
		};
		form: { message?: string };
	}>();

	let showEntryModal = $state(false);
	let showEditModal = $state(false);
	let showArchiveConfirm = $state(false);
	let showDeleteConfirm = $state(false);
	let showMobileActions = $state(false);
	let deleteConfirmText = $state('');
	let tab = $state<'historial' | 'datos' | 'radiografias'>('historial');
	let filterType = $state<'Todos' | 'Consulta' | 'Tratamiento'>('Todos');
	let onlyWithNote = $state(false);
	let timelineSearch = $state('');
	let expandedId = $state<string | null>(null);
	const currentYear = new Date().getFullYear();
	const driveScopes =
		'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';
	const patientFolderLabel = (patientId: string) => patientId;
	const radiographsFolderLabel = 'Radiografias';
	const largeFileThreshold = 12 * 1024 * 1024;
	const googleClientId = env.PUBLIC_GOOGLE_CLIENT_ID ?? '';

	let driveConnection = $state<typeof data.driveConnection>(null);
	let radiographs = $state<any[]>([]);
	let uploadingRadiograph = $state(false);
	let uploadError = $state('');
	let uploadInfo = $state('');
	let uploadWarning = $state('');
	let retryTargetId = $state<string | null>(null);
	let radiographNote = $state('');
	let radiographTakenAt = $state('');
	let patientDriveFolderId = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	const isDriveConnected = $derived(Boolean(driveConnection?.root_folder_id));
	const canConnectDrive = $derived(Boolean(googleClientId) && !data.demo);
	const requestedTab = $derived.by(() => $page.url.searchParams.get('tab'));
	const returnTo = $derived.by(() => {
		const params = new URLSearchParams($page.url.search);
		params.set('tab', 'radiografias');
		return encodeURIComponent(`${$page.url.pathname}?${params.toString()}`);
	});
	const connectConfigHref = $derived.by(() => `/odonto/configuracion?return=${returnTo}`);
	$effect(() => {
		if (
			requestedTab === 'historial' ||
			requestedTab === 'datos' ||
			requestedTab === 'radiografias'
		) {
			tab = requestedTab;
		}
	});
	$effect(() => {
		driveConnection = data.driveConnection;
		radiographs = data.radiographs ?? [];
		patientDriveFolderId = data.patient.drive_folder_id ?? null;
	});
	const fmtTime = (dateStr: string) =>
		new Intl.DateTimeFormat('es-AR', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).format(new Date(dateStr));
	const mainTitle = (entry: any) => entry.title ?? entry.description ?? entry.entry_type;
	const isDuplicateDescription = (entry: any) =>
		entry.description ? entry.description.trim().toLowerCase() === mainTitle(entry).trim().toLowerCase() : false;
	const hasDistinctNote = (entry: any) =>
		entry.internal_note &&
		entry.internal_note.trim() &&
		entry.internal_note.trim().toLowerCase() !== (entry.description ?? '').trim().toLowerCase();

	const copyToClipboard = (text?: string) => {
		if (!text) return;
		if (navigator?.clipboard) {
			navigator.clipboard.writeText(text).catch(() => {});
		}
	};

	const lastVisit = $derived(data.entries?.[0]?.created_at ?? null);
	const chips = $derived(
		(
			[
				lastVisit
					? {
							label: 'Última visita',
							value: formatDate(lastVisit),
							intent: 'neutral' as const
					  }
					: null,
				data.patient.allergies
					? {
							label: 'Alergias',
							value: data.patient.allergies,
							intent: 'alert' as const
					  }
					: null,
				data.patient.insurance
					? {
							label: 'Obra social',
							value: data.patient.insurance,
							intent: 'neutral' as const
					  }
					: null
			].filter((c): c is { label: string; value: string; intent: 'neutral' | 'alert' } => Boolean(c))
		)
	);

	const entryMatches = (entry: any) => {
		if (filterType !== 'Todos' && entry.entry_type !== filterType) return false;
		if (onlyWithNote && !entry.internal_note) return false;
		if (timelineSearch.trim()) {
			const q = timelineSearch.toLowerCase();
			const dateText = formatDate(entry.created_at);
			const haystack = `${entry.entry_type} ${entry.description ?? ''} ${entry.internal_note ?? ''} ${entry.teeth ?? ''} ${dateText} ${entry.created_at}`.toLowerCase();
			if (!haystack.includes(q)) return false;
		}
		return true;
	};

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

	const formatBytes = (value?: number | null) => {
		if (value == null || Number.isNaN(value)) return '';
		const units = ['B', 'KB', 'MB', 'GB'];
		let current = value;
		let idx = 0;
		while (current >= 1024 && idx < units.length - 1) {
			current /= 1024;
			idx += 1;
		}
		const decimals = current >= 10 || idx === 0 ? 0 : 1;
		return `${current.toFixed(decimals)} ${units[idx]}`;
	};

	const formatCurrency = (value?: number | string | null) => {
		if (value == null || value === '') return '';
		const normalized =
			typeof value === 'string' ? value.replace(/\./g, '').replace(',', '.') : value;
		const numeric = Number(normalized);
		if (!Number.isFinite(numeric)) return '';
		const formatted = new Intl.NumberFormat('es-AR', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(numeric);
		return `$ ${formatted}`;
	};

	const isRadiographReady = (radiograph: any) => {
		if (!radiograph) return false;
		if (radiograph.status) return radiograph.status === 'ready';
		return Boolean(radiograph.drive_file_id);
	};

	const isRadiographFailed = (radiograph: any) => radiograph?.status === 'failed';

	const isRadiographUploading = (radiograph: any) => {
		if (!radiograph) return false;
		if (radiograph.status) return radiograph.status === 'uploading';
		return !radiograph.drive_file_id;
	};

	const ensurePatientFolder = async (accessToken: string) => {
		if (!driveConnection?.root_folder_id) {
			throw new Error('Conectá Google Drive antes de subir radiografias.');
		}
		if (patientDriveFolderId) return patientDriveFolderId;
		const patientFolderId = await createDriveFolder({
			accessToken,
			name: patientFolderLabel(data.patient.id),
			parentId: driveConnection.root_folder_id
		});
		const radiographsFolderId = await createDriveFolder({
			accessToken,
			name: radiographsFolderLabel,
			parentId: patientFolderId
		});
		const formData = new FormData();
		formData.set('drive_folder_id', radiographsFolderId);
		await postAction('?/set_drive_folder', formData);
		patientDriveFolderId = radiographsFolderId;
		return radiographsFolderId;
	};

	const startRadiographRecord = async (file: File) => {
		const formData = new FormData();
		formData.set('original_filename', file.name || 'radiografia');
		formData.set('mime_type', file.type || 'application/octet-stream');
		formData.set('bytes', String(file.size ?? 0));
		const result = await postAction('?/start_radiograph', formData);
		const radiograph = result.radiograph as any;
		radiographs = [radiograph, ...radiographs];
		return radiograph;
	};

	const resetRadiographRecord = async (radiographId: string, file: File) => {
		const formData = new FormData();
		formData.set('radiograph_id', radiographId);
		formData.set('original_filename', file.name || 'radiografia');
		formData.set('mime_type', file.type || 'application/octet-stream');
		formData.set('bytes', String(file.size ?? 0));
		const result = await postAction('?/reset_radiograph', formData);
		const updated = result.radiograph as any;
		radiographs = radiographs.map((item) => (item.id === updated.id ? updated : item));
		return updated;
	};

	const finalizeRadiographRecord = async (
		radiographId: string,
		driveFileId: string,
		note?: string,
		takenAt?: string
	) => {
		const formData = new FormData();
		formData.set('radiograph_id', radiographId);
		formData.set('drive_file_id', driveFileId);
		if (note) formData.set('note', note);
		if (takenAt) formData.set('taken_at', takenAt);
		const result = await postAction('?/finalize_radiograph', formData);
		const updated = result.radiograph as any;
		radiographs = radiographs.map((item) => (item.id === updated.id ? updated : item));
		return updated;
	};

	const markRadiographFailed = async (radiographId: string) => {
		const formData = new FormData();
		formData.set('radiograph_id', radiographId);
		try {
			const result = await postAction('?/mark_radiograph_failed', formData);
			const updated = result.radiograph as any;
			radiographs = radiographs.map((item) => (item.id === updated.id ? updated : item));
		} catch {
			radiographs = radiographs.map((item) =>
				item.id === radiographId ? { ...item, status: 'failed' } : item
			);
		}
	};

	const deleteRadiograph = async (radiographId: string) => {
		const confirmed = window.confirm('¿Eliminar la referencia de esta radiografia?');
		if (!confirmed) return;
		uploadError = '';
		uploadInfo = '';
		try {
			const formData = new FormData();
			formData.set('radiograph_id', radiographId);
			await postAction('?/delete_radiograph', formData);
			radiographs = radiographs.filter((item) => item.id !== radiographId);
		} catch (err) {
			uploadError = err instanceof Error ? err.message : 'No se pudo eliminar la radiografia.';
		}
	};

	const openRetryUpload = (radiographId: string) => {
		const existing = radiographs.find((item) => item.id === radiographId);
		if (existing) {
			radiographNote = existing.note ?? '';
			radiographTakenAt = existing.taken_at ?? '';
		}
		retryTargetId = radiographId;
		uploadError = '';
		uploadInfo = '';
		uploadWarning = '';
		fileInput?.click();
	};

	const uploadRadiograph = async (file: File, existingId?: string) => {
		if (data.demo) {
			uploadError = 'No disponible en modo demo.';
			retryTargetId = null;
			return;
		}
		if (!googleClientId) {
			uploadError = 'Falta configurar PUBLIC_GOOGLE_CLIENT_ID.';
			retryTargetId = null;
			return;
		}
		if (radiographTakenAt && !/^\d{4}-\d{2}-\d{2}$/.test(radiographTakenAt)) {
			uploadError = 'La fecha debe tener formato AAAA-MM-DD.';
			retryTargetId = null;
			return;
		}
		uploadingRadiograph = true;
		uploadError = '';
		uploadInfo = '';
		let pendingId: string | null = null;
		try {
			const existing = existingId ? radiographs.find((item) => item.id === existingId) : null;
			const noteToSend = radiographNote || existing?.note || '';
			const takenAtToSend = radiographTakenAt || existing?.taken_at || '';

			const token = await requestAccessToken({
				clientId: googleClientId,
				scopes: driveScopes,
				prompt: ''
			});
			const folderId = await ensurePatientFolder(token);
			const pending = existingId
				? await resetRadiographRecord(existingId, file)
				: await startRadiographRecord(file);
			pendingId = pending.id;
			const uploadUrl = await initResumableUpload({
				accessToken: token,
				file,
				metadata: {
					name: file.name || `radiografia-${Date.now()}`,
					parents: [folderId]
				}
			});
			const uploaded = await uploadResumable({ accessToken: token, uploadUrl, file });
			if (!uploaded?.id) {
				throw new Error('Drive no devolvio el id del archivo.');
			}
			await finalizeRadiographRecord(pending.id, uploaded.id, noteToSend, takenAtToSend);
			uploadInfo = 'Radiografia guardada.';
			radiographNote = '';
			radiographTakenAt = '';
			uploadWarning = '';
		} catch (err) {
			const raw = err instanceof Error ? err.message : 'No se pudo subir la radiografia.';
			if (
				raw.includes('401') ||
				raw.includes('403') ||
				raw.includes('insufficientPermissions') ||
				raw.includes('authError')
			) {
				uploadError = 'Tu sesion con Google vencio. Reconecta Drive en Configuracion.';
			} else {
				uploadError = raw;
			}
			if (pendingId) {
				await markRadiographFailed(pendingId);
			}
		} finally {
			uploadingRadiograph = false;
			retryTargetId = null;
			if (fileInput) fileInput.value = '';
		}
	};

	const handleRadiographChange = (event: Event) => {
		const target = event.currentTarget as HTMLInputElement | null;
		const file = target?.files?.[0];
		if (!file) {
			retryTargetId = null;
			return;
		}
		uploadError = '';
		uploadInfo = '';
		uploadWarning = '';
		const name = file.name.toLowerCase();
		const isHeic = file.type === 'image/heic' || file.type === 'image/heif' || name.endsWith('.heic');
		if (isHeic) {
			uploadError = 'Converti la imagen a JPG o PNG antes de subirla.';
			if (fileInput) fileInput.value = '';
			return;
		}
		const isJpeg = file.type === 'image/jpeg' || name.endsWith('.jpg') || name.endsWith('.jpeg');
		const isPng = file.type === 'image/png' || name.endsWith('.png');
		if (!isJpeg && !isPng) {
			uploadError = 'Solo se permiten archivos JPG o PNG.';
			if (fileInput) fileInput.value = '';
			return;
		}
		if (file.size > largeFileThreshold) {
			uploadWarning = 'Archivo pesado: la subida puede tardar varios minutos.';
		}
		void uploadRadiograph(file, retryTargetId ?? undefined);
	};

let showEntryErrors = $state(false);
let showEditErrors = $state(false);
let showEditEntryErrors = $state(false);
let showEditEntryModal = $state(false);
let editingEntry: any | null = $state(null);
let editEntryType = $state('');
let editEntryDescription = $state('');
let editEntryTeeth = $state('');
let editEntryNote = $state('');
let editEntryCreatedAt = $state('');
let amountDisplay = $state('');
let amountRaw = $state('');
let editAmountDisplay = $state('');
let editAmountRaw = $state('');
let archiveForm: HTMLFormElement | null = null;
let unarchiveForm: HTMLFormElement | null = null;
let deleteForm: HTMLFormElement | null = null;
	const isArchived = $derived(Boolean(data.patient.archived_at));
	const hasPatientData = $derived(
		Boolean(
			data.patient.dni ||
			data.patient.phone ||
				data.patient.email ||
				data.patient.address ||
				data.patient.birth_date ||
				data.patient.insurance ||
				data.patient.insurance_plan ||
				data.patient.allergies ||
				data.patient.medication ||
				data.patient.background
		)
	);

const formatAmountInput = (value: string) => {
	const digits = value.replace(/\D/g, '');
	if (!digits) return { digits: '', formatted: '' };
	const formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
	return { digits, formatted };
};

const handleAmountChange = (event: Event, type: 'new' | 'edit') => {
	const target = event.currentTarget as HTMLInputElement;
	const { digits, formatted } = formatAmountInput(target.value);
	target.value = formatted;
	if (type === 'new') {
		amountDisplay = formatted;
		amountRaw = digits;
	} else {
		editAmountDisplay = formatted;
		editAmountRaw = digits;
	}
};

	const handleEntrySubmit = (event: SubmitEvent) => {
		showEntryErrors = true;
		const formEl = event.currentTarget as HTMLFormElement;
		const hidden = formEl.querySelector<HTMLInputElement>('input[name="created_at"]');
		if (!hidden || !hidden.value || hidden.value === '__invalid__') {
			event.preventDefault();
		}
	};

const handleEditSubmit = (event: SubmitEvent) => {
	showEditErrors = true;
	const formEl = event.currentTarget as HTMLFormElement;
	const birthHidden = formEl.querySelector<HTMLInputElement>('input[name="birth_date"]');
	if (birthHidden && birthHidden.value === '__invalid__') {
		event.preventDefault();
	}
};

const handleEditEntrySubmit = (event: SubmitEvent) => {
	showEditEntryErrors = true;
	const formEl = event.currentTarget as HTMLFormElement;
	const hidden = formEl.querySelector<HTMLInputElement>('input[name="created_at"]');
	if (!hidden || !hidden.value || hidden.value === '__invalid__') {
		event.preventDefault();
	}
};

const openEditEntry = (entry: any) => {
	editingEntry = entry;
	editEntryType = entry.entry_type ?? '';
	editEntryDescription = entry.description ?? '';
	editEntryTeeth = entry.teeth ?? '';
	const initialAmount = entry.amount != null ? String(entry.amount) : '';
	const { digits, formatted } = formatAmountInput(initialAmount);
	editAmountDisplay = formatted;
	editAmountRaw = digits;
	editEntryNote = entry.internal_note ?? '';
	editEntryCreatedAt = entry.created_at ?? '';
	showEditEntryErrors = false;
	showEditEntryModal = true;
};

const openNewEntryModal = () => {
	amountDisplay = '';
	amountRaw = '';
	showEntryErrors = false;
	showEntryModal = true;
};

const preventEnterSubmit = (event: KeyboardEvent) => {
	if (event.key !== 'Enter') return;
	const target = event.target as HTMLElement | null;
	if (target instanceof HTMLTextAreaElement) return;
	event.preventDefault();
	};
</script>

<div class="flex flex-col gap-5">
	<div class="rounded-2xl border border-neutral-100 bg-white/90 p-4 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
		<div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0 space-y-1">
					<h1 class="break-words text-[28px] font-semibold text-neutral-900 dark:text-white sm:text-[30px]">
						{data.patient.full_name}
					</h1>
				</div>
				<button
					type="button"
					class="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 text-neutral-700 transition hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-100 dark:hover:bg-[#122641] md:hidden"
					onclick={() => (showMobileActions = true)}
					aria-label="Acciones del paciente"
				>
					<svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
						<circle cx="6" cy="12" r="1.6" />
						<circle cx="12" cy="12" r="1.6" />
						<circle cx="18" cy="12" r="1.6" />
					</svg>
				</button>
			</div>
			<div class="hidden md:grid md:grid-cols-2 md:gap-2 md:justify-items-start lg:flex lg:flex-wrap lg:items-center lg:gap-3">
				<form method="post" action="?/archive_patient" class="contents" bind:this={archiveForm}>
					<button
						type="submit"
						class="rounded-full bg-neutral-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-neutral-800 hover:shadow-card dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white md:inline-flex md:justify-self-start"
						onclick={(event: MouseEvent) => {
							event.preventDefault();
							showArchiveConfirm = true;
						}}
					>
						{isArchived ? 'Desarchivar paciente' : 'Archivar paciente'}
					</button>
				</form>
				<form method="post" action="?/unarchive_patient" class="hidden" bind:this={unarchiveForm}></form>
				<form method="post" action="?/delete_patient" class="hidden" bind:this={deleteForm}></form>
				<button
					class="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-red-700 hover:shadow-card dark:bg-red-700 dark:hover:bg-red-800 md:inline-flex md:justify-self-start"
					type="button"
					onclick={() => (showDeleteConfirm = true)}
				>
					Eliminar paciente
				</button>
				<button
					class="rounded-full bg-[#7c3aed] px-5 py-2 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] md:col-span-2 md:inline-flex md:justify-self-start lg:col-span-1"
					type="button"
					onclick={openNewEntryModal}
				>
					+ Registrar consulta
				</button>
			</div>
		</div>
		<div class="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 sm:text-sm md:flex md:items-center md:gap-3">
			<a
				href="/odonto/pacientes"
				class="flex w-full items-center justify-center gap-2 rounded-full border border-neutral-200 px-2 py-2 text-xs font-semibold text-neutral-700 transition hover:-translate-y-0.5 hover:bg-neutral-100 hover:shadow-card dark:border-[#1f3554] dark:text-[#eaf1ff] dark:hover:bg-[#122641] sm:px-4 sm:text-sm md:w-auto"
			>
				<svg
					aria-hidden="true"
					class="h-4 w-4"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
				</svg>
				Atrás
			</a>
			<button
				class={`w-full rounded-full px-2 py-2 text-center text-xs font-semibold transition sm:px-4 sm:text-sm md:w-auto ${
					tab === 'historial'
						? 'bg-[#7c3aed] text-white shadow-sm'
						: 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#0f1f36]'
				}`}
				onclick={() => (tab = 'historial')}
			>
				Historial
			</button>
			<button
				class={`w-full rounded-full px-2 py-2 text-center text-xs font-semibold transition sm:px-4 sm:text-sm md:w-auto ${
					tab === 'datos'
						? 'bg-[#7c3aed] text-white shadow-sm'
						: 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#0f1f36]'
				}`}
				onclick={() => (tab = 'datos')}
			>
				Datos
			</button>
			<button
				class={`w-full rounded-full px-2 py-2 text-center text-xs font-semibold transition sm:px-4 sm:text-sm md:w-auto ${
					tab === 'radiografias'
						? 'bg-[#7c3aed] text-white shadow-sm'
						: 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#0f1f36]'
				}`}
				onclick={() => (tab = 'radiografias')}
			>
				Radiografías
			</button>
		</div>
		<div class="mt-4 flex flex-wrap gap-3">
			{#each chips as chip}
				<div
					class={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
						{
							neutral: 'bg-white/60 text-neutral-800 dark:bg-white/10 dark:text-neutral-100',
							alert: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-100',
							warn: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-500/15 dark:text-indigo-100'
						}[chip.intent]
					}`}
				>
					<span class="text-[11px] uppercase tracking-wide">{chip.label}:</span>
					<span>{chip.value}</span>
				</div>
			{/each}
		</div>
	</div>

	{#if tab === 'historial'}
		<div class="rounded-2xl border border-neutral-100 bg-white/90 p-4 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
			<div class="flex flex-col gap-3 text-sm sm:flex-row sm:items-center">
				<div class="relative w-full sm:max-w-xs">
					<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
						<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M3 5h18M6 12h12M10 19h4" />
						</svg>
					</span>
					<select
						bind:value={filterType}
						class="w-full rounded-full border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-[#1f3554] dark:bg-[#0f1f36]"
					>
						<option value="Todos">Filtrar por tipo: Todos</option>
						<option value="Consulta">Filtrar por tipo: Consulta</option>
						<option value="Diagnóstico">Filtrar por tipo: Diagnóstico</option>
						<option value="Tratamiento">Filtrar por tipo: Tratamiento</option>
					</select>
				</div>
				<div class="relative w-full">
					<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
						<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="11" cy="11" r="7" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M20 20l-3.5-3.5" />
						</svg>
					</span>
					<input
						type="search"
						placeholder="Buscar (palabra, fecha)"
						class="w-full rounded-full border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-neutral-700 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-neutral-50"
						bind:value={timelineSearch}
					/>
				</div>
			</div>
			<div class="mt-4">
				{#if data.entries.length === 0}
					<p class="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-neutral-200">
						<span class="md:hidden">Sin consultas registradas. Cargá la primera tocando el botón + de abajo a la derecha.</span>
						<span class="hidden md:inline">Sin consultas registradas. Cargá la primera desde “Registrar consulta”.</span>
					</p>
				{:else}
					<div class="relative pl-8">
						<span class="absolute left-2 top-0 h-full w-px bg-neutral-200 dark:bg-[#1f3554]/60"></span>
						<div class="space-y-3">
							{#each data.entries as entry (entry.id ?? entry.created_at)}
								{#if entryMatches(entry)}
									{#key entry.id ?? entry.created_at}
										<div
											role="button"
											tabindex="0"
											onclick={() => (expandedId = expandedId === (entry.id ?? entry.created_at) ? null : entry.id ?? entry.created_at)}
											onkeydown={(e) => e.key === 'Enter' && (expandedId = expandedId === (entry.id ?? entry.created_at) ? null : entry.id ?? entry.created_at)}
											class="group relative overflow-hidden rounded-xl border border-neutral-100 bg-white px-4 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] dark:border-[#1f3554] dark:bg-[#0f1f36]"
										>
											<span class="absolute left-[-14px] top-5 h-3 w-3 rounded-full border-2 border-white bg-[#7c3aed] shadow dark:border-[#0f1f36]"></span>
											<div class="flex flex-wrap items-start gap-3">
												<div class="flex min-w-0 flex-1 items-center gap-3">
													<span class="rounded-full bg-[#7c3aed]/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#5b21b6] dark:bg-[#7c3aed]/20 dark:text-[#d9c5ff]">
														{entry.entry_type}
													</span>
													<p class="text-[16px] font-semibold text-neutral-900 dark:text-white line-clamp-1">
														{mainTitle(entry)}
													</p>
												</div>
												<div class="flex w-full items-center justify-end gap-2 sm:w-auto sm:shrink-0 sm:justify-start">
													{#if entry.amount}
														<span class="text-[15px] font-semibold text-neutral-800 whitespace-nowrap dark:text-neutral-100">
															{formatCurrency(entry.amount)}
														</span>
													{/if}
													<button
														type="button"
														class="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-3 py-1 text-xs font-semibold text-neutral-600 transition hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-100 dark:hover:bg-[#122641]"
														onclick={(event) => {
															event.stopPropagation();
															openEditEntry(entry);
														}}
													>
														<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
															<path stroke-linecap="round" stroke-linejoin="round" d="M12 20h9" />
															<path stroke-linecap="round" stroke-linejoin="round" d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
														</svg>
														Editar
													</button>
												</div>
											</div>
											{#if entry.description && !isDuplicateDescription(entry)}
												<p class="mt-1 text-[13px] font-medium text-neutral-700 opacity-85 line-clamp-1 dark:text-neutral-200">
													{entry.description}
												</p>
											{/if}
											<div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-300">
												<span>{formatDate(entry.created_at)}</span>
												<span>·</span>
												<span>{fmtTime(entry.created_at)}</span>
												{#if entry.teeth}
													<span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 dark:bg-white/10 dark:text-neutral-200">
														Zona {entry.teeth}
													</span>
												{/if}
											</div>
											{#if hasDistinctNote(entry)}
												<p class="mt-2 text-xs text-neutral-500 dark:text-neutral-300 line-clamp-1">
													Nota: {entry.internal_note}
												</p>
											{/if}
											{#if expandedId === (entry.id ?? entry.created_at)}
												<div class="mt-3 space-y-2 text-sm text-neutral-800 dark:text-neutral-100">
													{#if entry.amount}
														<p><span class="font-semibold">Importe:</span> {formatCurrency(entry.amount)}</p>
													{/if}
													{#if entry.internal_note}
														<p><span class="font-semibold">Nota completa:</span> {entry.internal_note}</p>
													{/if}
												</div>
											{/if}
										</div>
									{/key}
								{/if}
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>
	{:else if tab === 'datos'}
		<div class="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm dark:border-[#1f3554] dark:bg-[#122641] sm:p-5">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Datos del paciente</h2>
				<button
					type="button"
					class="w-full rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-900 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card sm:w-auto"
					onclick={() => (showEditModal = true)}
				>
					{hasPatientData ? 'Editar datos del paciente' : 'Agregar datos del paciente'}
				</button>
			</div>
			<div class="mt-4 space-y-4">
				<div class="rounded-xl border border-neutral-100 bg-white/60 p-4 dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<div class="mb-3 flex items-center justify-between">
						<p class="text-[13px] font-bold uppercase tracking-wide text-neutral-600 dark:text-neutral-300">Alertas médicas</p>
							<button
								type="button"
								class="rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-50 dark:hover:bg-[#122641]"
								onclick={() => (showEditModal = true)}
							>
								Editar
							</button>
					</div>
					<div class="space-y-3">
						<div class="flex min-w-0 items-start justify-between gap-3 rounded-lg bg-amber-100/30 px-3 py-2 dark:bg-amber-500/10">
							<div class="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-200">
								<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M4.93 19h14.14a1 1 0 0 0 .9-1.45L12.9 4.55a1 1 0 0 0-1.8 0L4.03 17.55A1 1 0 0 0 4.93 19Z" />
								</svg>
								Alergias
							</div>
							<p
								class={`flex-1 break-words text-right text-[15px] font-semibold ${
									data.patient.allergies ? 'text-amber-900 dark:text-amber-100' : 'text-amber-700/70 dark:text-amber-200/70'
								}`}
							>
								{data.patient.allergies ?? 'Sin registrar'}
							</p>
						</div>
						<div class="flex min-w-0 items-start justify-between gap-3">
							<div class="flex items-center gap-2 text-xs font-semibold text-neutral-500 dark:text-neutral-300">
								<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M6.75 6.75 17.25 17.25M9 5.25 5.25 9 9 12.75 12.75 9 9 5.25Z" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M15 11.25 11.25 15 15 18.75 18.75 15 15 11.25Z" />
								</svg>
								Medicación
							</div>
							<p
								class={`flex-1 break-words text-left text-[15px] font-semibold ${
									data.patient.medication ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'
								}`}
							>
								{data.patient.medication ?? 'Sin registrar'}
							</p>
						</div>
						<div class="flex min-w-0 items-start justify-between gap-3">
							<div class="flex items-center gap-2 text-xs font-semibold text-neutral-500 dark:text-neutral-300">
								<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M6.75 4.5h10.5a1.5 1.5 0 0 1 1.5 1.5v12.75l-4.5-2.25L9.75 18.75 5.25 21V6A1.5 1.5 0 0 1 6.75 4.5Z" />
								</svg>
								Antecedentes
							</div>
							<p
								class={`flex-1 break-words text-left text-[15px] font-semibold whitespace-pre-wrap ${
									data.patient.background ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'
								}`}
							>
								{data.patient.background ?? 'Sin registrar'}
							</p>
						</div>
					</div>
				</div>

				<div class="rounded-xl border border-neutral-100 bg-white/60 p-4 dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<div class="mb-3 flex items-center justify-between">
						<p class="text-[13px] font-bold uppercase tracking-wide text-neutral-600 dark:text-neutral-300">Contacto</p>
							<button
								type="button"
								class="rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-50 dark:hover:bg-[#122641]"
								onclick={() => (showEditModal = true)}
							>
								Editar
							</button>
					</div>
					<div class="grid gap-3 md:grid-cols-2">
						<div class="space-y-1">
							<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Teléfono</p>
							<div class="flex items-center gap-2">
								<p class={`text-[15px] font-semibold ${data.patient.phone ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`}>
									{data.patient.phone ?? 'Sin registrar'}
								</p>
								{#if data.patient.phone}
									<button
										type="button"
										class="grid h-8 w-8 place-items-center rounded-full border border-neutral-200 text-xs text-neutral-600 dark:border-[#1f3554] dark:text-neutral-200"
										onclick={() => copyToClipboard(data.patient.phone)}
										title="Copiar"
									>
										⧉
									</button>
								{/if}
							</div>
						</div>
						<div class="space-y-1">
							<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Email</p>
							<div class="flex items-center gap-2">
								<p class={`text-[15px] font-semibold break-all ${data.patient.email ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`}>
									{data.patient.email ?? 'Sin registrar'}
								</p>
								{#if data.patient.email}
									<button
										type="button"
										class="grid h-8 w-8 place-items-center rounded-full border border-neutral-200 text-xs text-neutral-600 dark:border-[#1f3554] dark:text-neutral-200"
										onclick={() => copyToClipboard(data.patient.email)}
										title="Copiar"
									>
										⧉
									</button>
								{/if}
							</div>
						</div>
						<div class="space-y-1 md:col-span-2">
							<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Dirección</p>
							<div class="flex items-center gap-2">
								<p class={`text-[15px] font-semibold ${data.patient.address ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`}>
									{data.patient.address ?? 'Sin registrar'}
								</p>
								{#if data.patient.address}
									<button
										type="button"
										class="grid h-8 w-8 place-items-center rounded-full border border-neutral-200 text-xs text-neutral-600 dark:border-[#1f3554] dark:text-neutral-200"
										onclick={() => copyToClipboard(data.patient.address)}
										title="Copiar"
									>
										⧉
									</button>
								{/if}
							</div>
						</div>
					</div>
				</div>

				<div class="rounded-xl border border-neutral-100 bg-white/60 p-4 dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<div class="mb-3 flex items-center justify-between">
						<p class="text-[13px] font-bold uppercase tracking-wide text-neutral-600 dark:text-neutral-300">Administrativo</p>
							<button
								type="button"
								class="rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-50 dark:hover:bg-[#122641]"
								onclick={() => (showEditModal = true)}
							>
								Editar
							</button>
					</div>
					<div class="grid gap-3 md:grid-cols-2">
						<div class="space-y-1">
							<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Obra social</p>
							<p class={`text-[15px] font-semibold ${data.patient.insurance ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`}>
								{data.patient.insurance ?? 'Sin registrar'}
							</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Plan de la obra social</p>
							<p class={`text-[15px] font-semibold ${data.patient.insurance_plan ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`}>
								{data.patient.insurance_plan ?? 'Sin registrar'}
							</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Nacimiento</p>
							<p class={`text-[15px] font-semibold ${data.patient.birth_date ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`}>
								{data.patient.birth_date ? formatDate(data.patient.birth_date) : 'Sin registrar'}
							</p>
						</div>
					</div>
				</div>
			</div>
			<details class="mt-4 text-[11px] text-[#65738d] dark:text-[#7b8aa5]">
				<summary class="cursor-pointer text-neutral-600 dark:text-neutral-200">Ver detalles</summary>
				<p class="mt-1">
					Creado: {formatDate(data.patient.created_at)} • Última actualización: {formatDateTime(data.patient.updated_at)}
				</p>
			</details>
		</div>
	{:else if tab === 'radiografias'}
		<div class="rounded-2xl border border-neutral-100 bg-white/90 p-4 shadow-card dark:border-[#1f3554] dark:bg-[#152642] sm:p-6">
			<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Radiografías</h2>
				</div>
				{#if isDriveConnected}
					<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
						<input
							class="hidden"
							type="file"
							accept="image/*"
							capture="environment"
							bind:this={fileInput}
							onchange={handleRadiographChange}
						/>
						<button
							type="button"
							class="rounded-full bg-[#7c3aed] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#6d28d9] disabled:cursor-not-allowed disabled:opacity-60"
							onclick={() => fileInput?.click()}
							disabled={uploadingRadiograph || data.demo || !googleClientId}
						>
							{uploadingRadiograph ? 'Subiendo...' : '+ Añadir radiografía'}
						</button>
					</div>
				{/if}
			</div>

			{#if isDriveConnected}
				<div class="mt-5 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-300">
					<span class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200">
						✓ Google Drive conectado
					</span>
					{#if driveConnection?.connected_email}
						<span>Cuenta: {driveConnection.connected_email}</span>
					{/if}
					<a href={connectConfigHref} class="font-semibold text-[#7c3aed] hover:underline">
						Cambiar o desconectar
					</a>
				</div>
			{:else}
				<div class="mt-5 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/80 p-5 dark:border-[#1f3554] dark:bg-[#0f1f36] sm:p-6">
					<h3 class="text-lg font-semibold text-neutral-900 dark:text-white">
						Para subir radiografías, primero conectá Google Drive
					</h3>
					<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-200">
						Se guarda en tu Google Drive. Podés desconectarlo cuando quieras.
					</p>
					<div class="mt-6 flex flex-col gap-3 sm:flex-row sm:items-stretch">
						<div class="flex flex-1 flex-col gap-3 rounded-xl border border-neutral-200 bg-white/80 px-4 py-4 dark:border-[#1f3554] dark:bg-[#0b1626]">
							<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
								<span class="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-sm font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
									1
								</span>
								<div class="min-w-0 flex-1">
									<p class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">Paso 1</p>
									<p class="text-sm font-semibold text-neutral-900 dark:text-white">Conectar Google Drive</p>
								</div>
								<a
									href={connectConfigHref}
									class={`flex w-full items-center justify-center gap-2 rounded-full bg-[#7c3aed] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#6d28d9] sm:ml-auto sm:w-auto ${
										canConnectDrive ? '' : 'pointer-events-none opacity-60'
									}`}
									aria-disabled={!canConnectDrive}
								>
									<svg class="h-4 w-4" viewBox="0 0 87 78" aria-hidden="true">
										<path fill="#0F9D58" d="M6.5 67.6L27.6 31l13.9 24.1L20.4 78 6.5 67.6z" />
										<path fill="#4285F4" d="M80.5 67.6H38.4L24.5 43.5h42.1l13.9 24.1z" />
										<path fill="#F4B400" d="M42.2 0l21 36.6-13.9 24.1L28.3 24 42.2 0z" />
									</svg>
									Conectar Google Drive
								</a>
							</div>
						</div>
						<div class="flex items-center justify-center text-neutral-400 sm:hidden">↓</div>
						<div class="hidden sm:flex items-center justify-center text-neutral-400">→</div>
						<div class="flex flex-1 items-center gap-4 rounded-xl border border-neutral-200 bg-white/70 px-4 py-4 opacity-70 dark:border-[#1f3554] dark:bg-[#0b1626]">
							<span class="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-sm font-semibold text-neutral-500 dark:bg-white/10 dark:text-neutral-300">
								2
							</span>
							<div>
								<p class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-300">Paso 2</p>
								<p class="text-sm font-semibold text-neutral-900 dark:text-white">Subir primera radiografía</p>
							</div>
							<span class="ml-auto text-lg text-neutral-400" aria-hidden="true">🔒</span>
							<span class="sr-only">Bloqueado</span>
						</div>
					</div>
				</div>
			{/if}

			{#if isDriveConnected}
				<div class="mt-6 grid gap-4 sm:grid-cols-2">
					<div class="space-y-2">
						<label class="text-xs font-semibold text-neutral-600 dark:text-neutral-200" for="radiograph-date">
							Fecha de toma (opcional)
						</label>
						<input
							id="radiograph-date"
							type="date"
							class="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-neutral-50"
							bind:value={radiographTakenAt}
						/>
					</div>
					<div class="space-y-2">
						<label class="text-xs font-semibold text-neutral-600 dark:text-neutral-200" for="radiograph-note">
							Nota (opcional)
						</label>
						<input
							id="radiograph-note"
							type="text"
							placeholder="Ej: Panorámica inicial"
							class="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-neutral-50"
							bind:value={radiographNote}
						/>
					</div>
				</div>
			{/if}

			{#if data.demo}
				<p class="mt-5 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
					Subidas a Drive no disponibles en modo demo.
				</p>
			{/if}
			{#if !googleClientId}
				<p class="mt-5 rounded-xl border border-dashed border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
					Falta configurar el Client ID de Google para habilitar las subidas.
				</p>
			{/if}

			{#if uploadError}
				<p class="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
					{uploadError}
				</p>
			{/if}
			{#if uploadWarning}
				<p class="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
					{uploadWarning}
				</p>
			{/if}
			{#if uploadInfo}
				<p class="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
					{uploadInfo}
				</p>
			{/if}

			<div class="mt-6 space-y-4">
				{#if radiographs.length > 0}
					{#each radiographs as radiograph (radiograph.id)}
						<div class="flex flex-col gap-3 rounded-xl border border-neutral-100 bg-white/80 p-4 shadow-sm dark:border-[#1f3554] dark:bg-[#0f1f36] sm:flex-row sm:items-center sm:justify-between">
							<div class="min-w-0">
								<p class="truncate text-sm font-semibold text-neutral-900 dark:text-white">
									{radiograph.original_filename ?? 'Radiografía'}
								</p>
								<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-300">
									{formatDate(radiograph.taken_at ?? radiograph.created_at)}
									{radiograph.bytes ? ` · ${formatBytes(radiograph.bytes)}` : ''}
								</p>
								{#if radiograph.note}
									<p class="mt-1 text-xs text-neutral-600 dark:text-neutral-200">{radiograph.note}</p>
								{/if}
								{#if isRadiographFailed(radiograph)}
									<p class="mt-2 text-xs font-semibold text-red-600">Subida fallida</p>
								{:else if isRadiographUploading(radiograph)}
									<p class="mt-2 text-xs font-semibold text-amber-600">Subida en proceso</p>
								{/if}
							</div>
							<div class="flex flex-col gap-2 sm:flex-row">
								{#if isRadiographReady(radiograph)}
									<a
										href={`https://drive.google.com/file/d/${radiograph.drive_file_id}/preview`}
										target="_blank"
										rel="noreferrer"
										class="rounded-full border border-neutral-200 px-4 py-2 text-center text-sm font-semibold text-neutral-700 transition hover:-translate-y-0.5 hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-200 dark:hover:bg-[#122641]"
									>
										Ver
									</a>
								{:else}
									<button
										type="button"
										class="rounded-full border border-neutral-200 px-4 py-2 text-center text-sm font-semibold text-neutral-400 dark:border-[#1f3554] dark:text-neutral-500"
										disabled
									>
										Ver
									</button>
								{/if}
								{#if !isRadiographReady(radiograph)}
									<button
										type="button"
										class="rounded-full border border-neutral-200 px-4 py-2 text-center text-sm font-semibold text-neutral-700 transition hover:-translate-y-0.5 hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-200 dark:hover:bg-[#122641]"
										onclick={() => openRetryUpload(radiograph.id)}
										disabled={!isDriveConnected || uploadingRadiograph || data.demo || !googleClientId}
									>
										Reintentar
									</button>
								{/if}
								<button
									type="button"
									class="rounded-full border border-neutral-200 px-4 py-2 text-center text-sm font-semibold text-neutral-700 transition hover:-translate-y-0.5 hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-200 dark:hover:bg-[#122641]"
									onclick={() => deleteRadiograph(radiograph.id)}
								>
									Eliminar referencia
								</button>
							</div>
						</div>
					{/each}
				{/if}
			</div>

			<details class="mt-6 text-xs text-neutral-600 dark:text-neutral-300">
				<summary class="inline-flex cursor-pointer items-center gap-1 font-semibold text-neutral-700 dark:text-neutral-200">
					Más información
					<svg class="h-3.5 w-3.5 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
					</svg>
				</summary>
				<div class="mt-3 rounded-xl border border-neutral-200 bg-white/70 px-4 py-3 dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<div class="space-y-2">
						<p><span class="font-semibold">¿Dónde se guarda?</span> En tu cuenta de Google Drive.</p>
						<p><span class="font-semibold">¿Es seguro?</span> Solo vos podés acceder; la app guarda referencias.</p>
						<p><span class="font-semibold">¿Cuánto tiempo permanece?</span> Hasta que vos lo elimines en Drive.</p>
						<p><span class="font-semibold">¿Qué pasa si pierdo la cuenta?</span> No vas a poder acceder a esas imágenes.</p>
					</div>
				</div>
			</details>
		</div>
	{/if}
</div>

<!-- FAB móvil para nueva entrada -->
{#if tab === 'historial'}
	<button
		class="fixed bottom-20 right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-[#7c3aed] text-2xl font-bold text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] md:hidden"
		onclick={openNewEntryModal}
		aria-label="Registrar consulta"
	>
		+
	</button>
{/if}

<Modal open={showMobileActions} title="Acciones del paciente" on:close={() => (showMobileActions = false)}>
	<div class="space-y-3">
		<button
			type="button"
			class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-100 dark:hover:bg-[#122641]"
			onclick={() => {
				showMobileActions = false;
				showArchiveConfirm = true;
			}}
		>
			{isArchived ? 'Desarchivar paciente' : 'Archivar paciente'}
		</button>
		<button
			type="button"
			class="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700"
			onclick={() => {
				showMobileActions = false;
				showDeleteConfirm = true;
			}}
		>
			Eliminar paciente
		</button>
		<button
			type="button"
			class="w-full rounded-xl px-4 py-3 text-sm font-semibold text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-[#122641]"
			onclick={() => (showMobileActions = false)}
		>
			Cerrar
		</button>
	</div>
</Modal>

<Modal open={showEntryModal} title={`Registrar consulta - ${data.patient.full_name}`} on:close={() => (showEntryModal = false)}>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<form method="post" action="?/add_entry" class="space-y-4" onkeydown={preventEnterSubmit} onsubmit={handleEntrySubmit}>
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="entry_type">Tipo de consulta</label>
				<select
					id="entry_type"
					name="entry_type"
					required
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
				>
					<option value="">Seleccionar</option>
					{#each CLINICAL_ENTRY_TYPES as type}
						<option value={type}>{type}</option>
					{/each}
				</select>
			</div>
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="created_at-year">Fecha y hora</label>
				<DateTimePartsInput name="created_at" minYear={2000} maxYear={2045} showErrors={showEntryErrors} />
			</div>
		</div>
		<div class="space-y-2">
			<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="description">Descripción</label>
			<textarea
				id="description"
				name="description"
				required
				rows="4"
				class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
				placeholder="Motivo de consulta, hallazgos, indicaciones..."
			></textarea>
		</div>
		<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="teeth">Dientes / zona (opcional)</label>
				<input
					id="teeth"
					name="teeth"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					placeholder="Ej: 11-12"
				/>
			</div>
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="amount">Importe (opcional)</label>
				<input type="hidden" name="amount" value={amountRaw} />
				<input
					id="amount"
					name="amount_display"
					type="text"
					inputmode="numeric"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					placeholder="Ej: 18.000"
					value={amountDisplay}
					oninput={(event) => handleAmountChange(event, 'new')}
				/>
			</div>
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="internal_note">Nota interna (opcional)</label>
				<input
					id="internal_note"
					name="internal_note"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					placeholder="Ej: recordar control"
				/>
			</div>
		</div>
		{#if form?.message}
			<p class="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{form.message}</p>
		{/if}
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
			<button
				type="button"
				onclick={() => (showEntryModal = false)}
				class="w-full rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:text-white dark:hover:bg-[#1b2d4b] sm:w-auto"
			>
				Cancelar
			</button>
			<button
				type="submit"
				class="w-full rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 sm:w-auto"
			>
				Guardar
			</button>
		</div>
	</form>
</Modal>

<Modal open={showArchiveConfirm} title={isArchived ? 'Desarchivar paciente' : 'Archivar paciente'} on:close={() => (showArchiveConfirm = false)} dismissible>
	<div class="space-y-4 text-sm text-neutral-800 dark:text-neutral-100">
		{#if isArchived}
			<p>El paciente volverá a la lista de activos.</p>
		{:else}
			<p>El paciente se moverá a “Archivados”. Podrás recuperarlo más adelante.</p>
		{/if}
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
			<button
				type="button"
				class="w-full rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:text-white dark:hover:bg-[#1b2d4b] sm:w-auto"
				onclick={() => (showArchiveConfirm = false)}
			>
				Cancelar
			</button>
				<button
					type="button"
					class="w-full rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 sm:w-auto"
					onclick={() => {
						showArchiveConfirm = false;
					if (isArchived) {
						unarchiveForm?.submit();
					} else {
						archiveForm?.submit();
					}
					}}
				>
					{isArchived ? 'Desarchivar paciente' : 'Archivar paciente'}
				</button>
			</div>
		</div>
	</Modal>

<Modal open={showDeleteConfirm} title="Eliminar paciente" on:close={() => (showDeleteConfirm = false)} dismissible>
	<div class="space-y-4 text-sm text-neutral-800 dark:text-neutral-100">
		<p class="text-base font-semibold text-red-600 dark:text-red-400">Esta acción eliminará al paciente y su historial. No se puede deshacer.</p>
		<div class="space-y-2">
			<label class="text-sm font-semibold text-neutral-600 dark:text-neutral-300" for="delete-confirm-input">
					Escribí <span class="font-bold">eliminar</span> para confirmar
				</label>
			<input
				id="delete-confirm-input"
				class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-red-500 focus:ring-2 focus:ring-red-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
				placeholder="eliminar"
				bind:value={deleteConfirmText}
				autocomplete="off"
			/>
		</div>
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
			<button
				type="button"
				class="w-full rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:text-white dark:hover:bg-[#1b2d4b] sm:w-auto"
				onclick={() => {
					deleteConfirmText = '';
					showDeleteConfirm = false;
				}}
			>
				Cancelar
			</button>
			<button
				type="button"
				disabled={deleteConfirmText.trim().toLowerCase() !== 'eliminar'}
				class={`w-full rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 sm:w-auto ${
					deleteConfirmText.trim().toLowerCase() === 'eliminar'
						? 'bg-red-600 hover:bg-red-700'
						: 'bg-red-400 cursor-not-allowed opacity-80'
				}`}
				onclick={() => {
					if (deleteConfirmText.trim().toLowerCase() !== 'eliminar') return;
					showDeleteConfirm = false;
					deleteConfirmText = '';
					deleteForm?.submit();
				}}
			>
				Eliminar definitivamente
			</button>
		</div>
	</div>
</Modal>

<Modal open={showEditEntryModal} title="Editar entrada" on:close={() => (showEditEntryModal = false)}>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<form method="post" action="?/update_entry" class="space-y-4" onkeydown={preventEnterSubmit} onsubmit={handleEditEntrySubmit}>
		<input type="hidden" name="entry_id" value={editingEntry?.id ?? ''} />
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="edit_entry_type">Tipo de consulta</label>
				<select
					id="edit_entry_type"
					name="entry_type"
					required
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					bind:value={editEntryType}
				>
					<option value="">Seleccionar</option>
					{#each CLINICAL_ENTRY_TYPES as type}
						<option value={type}>{type}</option>
					{/each}
				</select>
			</div>
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="edit_created_at-year">Fecha y hora</label>
				<DateTimePartsInput name="created_at" minYear={2000} maxYear={2045} initialValue={editEntryCreatedAt} showErrors={showEditEntryErrors} />
			</div>
		</div>
		<div class="space-y-2">
			<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="edit_description">Descripción</label>
			<textarea
				id="edit_description"
				name="description"
				required
				rows="4"
				class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
				bind:value={editEntryDescription}
				placeholder="Motivo de consulta, hallazgos, indicaciones..."
			></textarea>
		</div>
		<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="edit_teeth">Dientes / zona (opcional)</label>
				<input
					id="edit_teeth"
					name="teeth"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					bind:value={editEntryTeeth}
					placeholder="Ej: 11-12"
				/>
			</div>
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="edit_amount">Importe (opcional)</label>
				<input type="hidden" name="amount" value={editAmountRaw} />
				<input
					id="edit_amount"
					name="amount_display"
					type="text"
					inputmode="numeric"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					value={editAmountDisplay}
					oninput={(event) => handleAmountChange(event, 'edit')}
					placeholder="Ej: 18.000"
				/>
			</div>
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="edit_internal_note">Nota interna (opcional)</label>
				<input
					id="edit_internal_note"
					name="internal_note"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					bind:value={editEntryNote}
					placeholder="Ej: recordar control"
				/>
			</div>
		</div>
		{#if form?.message}
			<p class="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{form.message}</p>
		{/if}
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
			<button
				type="button"
				onclick={() => (showEditEntryModal = false)}
				class="w-full rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:text-white dark:hover:bg-[#1b2d4b] sm:w-auto"
			>
				Cancelar
			</button>
			<button
				type="submit"
				class="w-full rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 sm:w-auto"
			>
				Guardar cambios
			</button>
		</div>
	</form>
</Modal>

<Modal open={showEditModal} title="Editar datos" on:close={() => (showEditModal = false)}>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<form method="post" action="?/update_patient" class="space-y-3" onkeydown={preventEnterSubmit} onsubmit={handleEditSubmit}>
		<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
			<div class="space-y-1">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="email">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					value={data.patient.email ?? ''}
				/>
			</div>
			<div class="space-y-1">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="phone">Teléfono</label>
				<input
					id="phone"
					name="phone"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					value={data.patient.phone ?? ''}
				/>
			</div>
			<div class="space-y-1">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="dni">DNI</label>
				<input
					id="dni"
					name="dni"
					inputmode="numeric"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					value={data.patient.dni ?? ''}
				/>
			</div>
		</div>
		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
			<div class="space-y-1">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="birth_date-year">Fecha de nacimiento</label>
				<DatePartsInput
					name="birth_date"
					initialValue={data.patient.birth_date ?? null}
					minYear={1900}
					maxYear={currentYear}
					showErrors={showEditErrors}
				/>
			</div>
			<div class="space-y-1">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="address">Dirección</label>
				<input
					id="address"
					name="address"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					value={data.patient.address ?? ''}
				/>
			</div>
		</div>
		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
			<div class="space-y-3">
				<div class="space-y-1">
					<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="insurance">Obra social</label>
					<input
						id="insurance"
						name="insurance"
						class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
						value={data.patient.insurance ?? ''}
					/>
				</div>
				<div class="space-y-1">
					<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="insurance_plan">
						Plan de la obra social
					</label>
					<input
						id="insurance_plan"
						name="insurance_plan"
						class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
						value={data.patient.insurance_plan ?? ''}
					/>
				</div>
			</div>
			<div class="space-y-1">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="allergies">Alergias</label>
				<input
					id="allergies"
					name="allergies"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					value={data.patient.allergies ?? ''}
				/>
			</div>
		</div>
		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
			<div class="space-y-1">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="medication">Medicación</label>
				<textarea
					id="medication"
					name="medication"
					rows="2"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
				>{data.patient.medication ?? ''}</textarea>
			</div>
			<div class="space-y-1">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="background">Antecedentes</label>
				<textarea
					id="background"
					name="background"
					rows="2"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
				>{data.patient.background ?? ''}</textarea>
			</div>
		</div>
		{#if form?.message}
			<p class="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{form.message}</p>
		{/if}
		<p class="text-xs text-neutral-500 dark:text-neutral-300">Todos los datos son opcionales.</p>
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
			<button
				type="button"
				class="w-full rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:text-white dark:hover:bg-[#1b2d4b] sm:w-auto"
				onclick={() => (showEditModal = false)}
			>
				Cancelar
			</button>
			<button
				type="submit"
				class="w-full rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 sm:w-auto"
			>
				Guardar cambios
			</button>
		</div>
	</form>
</Modal>
