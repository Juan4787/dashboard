/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

vi.mock('$app/navigation', () => ({ replaceState: vi.fn() }));

const SAMSUNG_USER_AGENT =
	'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36';

const appointment = {
	token: 'public-token',
	starts_at: '2026-08-10T15:00:00.000Z',
	ends_at: '2026-08-10T15:30:00.000Z',
	status: 'reserved',
	is_past: false,
	is_joint: false,
	calendar_action_status: 'not_offered',
	calendar_update_required_at: null,
	professional_name_snapshot: 'Profesional',
	service_name_snapshot: 'Consulta',
	public_status_label: 'Reservado',
	can_confirm: true,
	can_cancel: true,
	can_request_reschedule: true,
	business: {
		name: 'Consultorio',
		timezone: 'America/Argentina/Buenos_Aires',
		address: null,
		address_instructions: null,
		maps_link: null,
		logo_url: null,
		cancellation_policy: null
	}
};

const pageData = {
	appointment,
	message: '',
	created: false,
	suggestedAction: '',
	demo: false,
	device: 'android' as const,
	isSoon: false,
	vapidPublicKey: 'AQIDBA',
	publicSiteUrl: 'https://turnos.test',
	androidCalendarIntent: null
};

const delivery = (state: 'missing' | 'confirmed', id: string) => ({
	deliveryId: id,
	state,
	kind: 'test' as const,
	createdAt: new Date().toISOString(),
	expiresAt: new Date(Date.now() + 60_000).toISOString()
});

const jsonResponse = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});

const installNotificationEnvironment = (
	states: Array<'missing' | 'confirmed'>,
	initialPermission: NotificationPermission = 'granted'
) => {
	let visibilityState: DocumentVisibilityState = 'visible';
	let postCount = 0;
	const subscription = {
		options: { applicationServerKey: null },
		toJSON: () => ({
			endpoint: 'https://push.test/subscription',
			expirationTime: null,
			keys: { p256dh: 'key', auth: 'auth' }
		}),
		unsubscribe: vi.fn().mockResolvedValue(true)
	};
	const registration = {
		installing: null,
		waiting: null,
		update: vi.fn().mockResolvedValue(undefined),
		pushManager: {
			getSubscription: vi.fn().mockResolvedValue(null),
			subscribe: vi.fn().mockResolvedValue(subscription)
		}
	};
	const serviceWorker = {
		register: vi.fn().mockResolvedValue(registration),
		getRegistration: vi.fn().mockResolvedValue(undefined),
		ready: Promise.resolve(registration),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn()
	};
	const notification = {
		permission: initialPermission,
		requestPermission: vi.fn().mockResolvedValue('granted' as NotificationPermission)
	};

	Object.defineProperty(window, 'Notification', { configurable: true, value: notification });
	Object.defineProperty(window, 'PushManager', { configurable: true, value: class PushManager {} });
	Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
	Object.defineProperty(navigator, 'permissions', {
		configurable: true,
		value: { query: vi.fn().mockRejectedValue(new Error('not implemented')) }
	});
	Object.defineProperty(navigator, 'userAgent', { configurable: true, value: SAMSUNG_USER_AGENT });
	Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Linux armv8l' });
	Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		get: () => visibilityState
	});
	vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
		if (init?.method === 'POST') {
			const state = states[Math.min(postCount, states.length - 1)];
			postCount += 1;
			return jsonResponse({ ok: true, delivery: delivery(state, `delivery-${postCount}`) });
		}
		return jsonResponse({ ok: true, delivery: null });
	}));

	return {
		setVisibility(next: DocumentVisibilityState) {
			visibilityState = next;
			document.dispatchEvent(new Event('visibilitychange'));
		},
		postRequests: () => postCount
	};
};

describe('activación de notificaciones en Android', () => {
	beforeEach(() => {
		window.history.replaceState({}, '', '/turno/public-token');
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('mantiene una salida visible cuando Samsung ignora el acceso a Ajustes', async () => {
		installNotificationEnvironment(['missing']);
		const preventIntentNavigation = (event: Event) => {
			const anchor = (event.target as Element | null)?.closest?.('a');
			if (anchor?.getAttribute('href')?.startsWith('intent:')) event.preventDefault();
		};
		document.addEventListener('click', preventIntentNavigation, true);

		try {
			render(Page, { data: pageData });
			await fireEvent.click(await screen.findByRole('button', { name: /activar avisos/i }));
			const settingsLink = await screen.findByRole('link', { name: /abrir ajustes de android/i });

			vi.useFakeTimers();
			await fireEvent.click(settingsLink);
			await tick();
			expect(screen.getByRole('link', { name: /abriendo ajustes/i })).toBeInTheDocument();

			await vi.advanceTimersByTimeAsync(1_800);
			await tick();
			expect(screen.getByText(/entr[aá] en “Aplicaciones”/i)).toBeInTheDocument();
			expect(screen.getByText(/activ[aá] “Permitir notificaciones”/i)).toBeInTheDocument();
		} finally {
			document.removeEventListener('click', preventIntentNavigation, true);
		}
	});

	it('retoma la prueba automáticamente cuando el usuario vuelve de Ajustes', async () => {
		const environment = installNotificationEnvironment(['missing', 'confirmed']);
		const preventIntentNavigation = (event: Event) => {
			const anchor = (event.target as Element | null)?.closest?.('a');
			if (anchor?.getAttribute('href')?.startsWith('intent:')) event.preventDefault();
		};
		document.addEventListener('click', preventIntentNavigation, true);

		try {
			render(Page, { data: pageData });
			await fireEvent.click(await screen.findByRole('button', { name: /activar avisos/i }));
			await fireEvent.click(await screen.findByRole('link', { name: /abrir ajustes de android/i }));

			environment.setVisibility('hidden');
			environment.setVisibility('visible');

			await waitFor(() => {
				expect(screen.getByText(/avisos verificados en este tel[eé]fono/i)).toBeInTheDocument();
			});
			expect(environment.postRequests()).toBe(2);
		} finally {
			document.removeEventListener('click', preventIntentNavigation, true);
		}
	});

	it('mantiene separados el permiso del sitio y el permiso general de Android', async () => {
		installNotificationEnvironment(['missing'], 'denied');
		render(Page, { data: pageData });

		expect(await screen.findByText(/sitios y descargas/i)).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: /abrir ajustes de android/i })).not.toBeInTheDocument();
	});

	it('conserva el camino manual si el navegador vuelve por el fallback del intent', async () => {
		window.history.replaceState({}, '', '/turno/public-token?push_setup=manual');
		installNotificationEnvironment(['missing']);
		render(Page, { data: pageData });

		expect(await screen.findByText(/entr[aá] en “Aplicaciones”/i)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /activar avisos/i })).not.toBeInTheDocument();
	});
});
