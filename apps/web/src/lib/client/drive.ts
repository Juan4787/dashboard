const GSI_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

let gsiPromise: Promise<void> | null = null;
let tokenClient: any | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

const ensureBrowser = () => {
	if (typeof window === 'undefined') {
		throw new Error('Google OAuth solo esta disponible en el navegador.');
	}
};

const loadScript = () => {
	ensureBrowser();
	if (gsiPromise) return gsiPromise;
	gsiPromise = new Promise((resolve, reject) => {
		if ((window as any).google?.accounts?.oauth2) return resolve();
		const script = document.createElement('script');
		script.src = GSI_SRC;
		script.async = true;
		script.defer = true;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error('No se pudo cargar Google Identity.'));
		document.head.appendChild(script);
	});
	return gsiPromise;
};

export const requestAccessToken = async (options: {
	clientId: string;
	scopes: string;
	prompt?: '' | 'consent' | 'select_account';
}): Promise<string> => {
	ensureBrowser();
	const now = Date.now();
	if (cachedToken && cachedToken.expiresAt > now + 30_000) {
		return cachedToken.token;
	}
	await loadScript();
	const google = (window as any).google;
	if (!google?.accounts?.oauth2) {
		throw new Error('Google Identity no esta disponible.');
	}
	if (!tokenClient) {
		tokenClient = google.accounts.oauth2.initTokenClient({
			client_id: options.clientId,
			scope: options.scopes,
			callback: () => {}
		});
	}
	return await new Promise((resolve, reject) => {
		tokenClient.callback = (resp: { access_token?: string; expires_in?: number; error?: string }) => {
			if (resp?.error) {
				reject(new Error(resp.error));
				return;
			}
			if (!resp?.access_token) {
				reject(new Error('No se pudo obtener el token de Google.'));
				return;
			}
			const expiresInMs = (resp.expires_in ?? 0) * 1000;
			cachedToken = {
				token: resp.access_token,
				expiresAt: Date.now() + (expiresInMs || 0)
			};
			resolve(resp.access_token);
		};
		tokenClient.requestAccessToken({ prompt: options.prompt ?? '' });
	});
};

export const revokeAccessToken = async (token: string) => {
	ensureBrowser();
	await loadScript();
	const google = (window as any).google;
	if (google?.accounts?.oauth2?.revoke) {
		await new Promise<void>((resolve) => {
			google.accounts.oauth2.revoke(token, () => resolve());
		});
	}
	if (cachedToken?.token === token) {
		cachedToken = null;
	}
};

const assertOk = async (response: Response, fallback: string) => {
	if (response.ok) return;
	let detail = '';
	try {
		detail = JSON.stringify(await response.json());
	} catch {
		try {
			detail = await response.text();
		} catch {
			detail = '';
		}
	}
	throw new Error(detail ? `${fallback}: ${detail}` : fallback);
};

export const getUserInfo = async (accessToken: string) => {
	const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
		headers: { Authorization: `Bearer ${accessToken}` }
	});
	await assertOk(response, 'No se pudo leer el email de Google.');
	return (await response.json()) as { email?: string };
};

export const createDriveFolder = async (options: {
	accessToken: string;
	name: string;
	parentId?: string | null;
}) => {
	const body = {
		name: options.name,
		mimeType: DRIVE_FOLDER_MIME,
		parents: options.parentId ? [options.parentId] : undefined
	};
	const response = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${options.accessToken}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body)
	});
	await assertOk(response, 'No se pudo crear la carpeta en Drive.');
	const data = (await response.json()) as { id?: string };
	if (!data?.id) {
		throw new Error('No se recibio el id de la carpeta.');
	}
	return data.id;
};

export const initResumableUpload = async (options: {
	accessToken: string;
	metadata: Record<string, unknown>;
	file: File;
}) => {
	const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${options.accessToken}`,
			'Content-Type': 'application/json; charset=UTF-8',
			'X-Upload-Content-Type': options.file.type,
			'X-Upload-Content-Length': `${options.file.size}`
		},
		body: JSON.stringify(options.metadata)
	});
	await assertOk(response, 'No se pudo iniciar la subida.');
	const uploadUrl = response.headers.get('Location');
	if (!uploadUrl) {
		throw new Error('No se recibio la URL de subida.');
	}
	return uploadUrl;
};

export const uploadResumable = async (options: {
	accessToken: string;
	uploadUrl: string;
	file: File;
}) => {
	const endByte = options.file.size ? options.file.size - 1 : 0;
	const response = await fetch(options.uploadUrl, {
		method: 'PUT',
		headers: {
			Authorization: `Bearer ${options.accessToken}`,
			'Content-Type': options.file.type || 'application/octet-stream',
			'Content-Length': `${options.file.size}`,
			'Content-Range': `bytes 0-${endByte}/${options.file.size}`
		},
		body: options.file
	});
	await assertOk(response, 'No se pudo completar la subida.');
	return (await response.json()) as { id?: string };
};
