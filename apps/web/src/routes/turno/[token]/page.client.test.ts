/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

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
	androidCalendarShareIcs: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
	pushSetupManual: false,
	notificationBrowser: {
		label: 'Samsung Internet',
		androidPackage: 'com.sec.android.app.sbrowser',
		supportsAndroidSettingsIntent: true
	},
	androidCalendarIntent: null,
	googleCalendar: {
		available: false,
		state: 'none' as const,
		current: false,
		reminderLabel: '24 horas y 2 horas antes'
	},
	calendarMessage: null
};

const delivery = (state: 'accepted' | 'displayed' | 'missing' | 'confirmed', id: string) => ({
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
	states: Array<'accepted' | 'displayed' | 'missing' | 'confirmed'>,
	initialPermission: NotificationPermission = 'granted',
	requestedPermission: NotificationPermission = 'granted',
	persistRequestedPermission = true
) => {
	let visibilityState: DocumentVisibilityState = 'visible';
	let postCount = 0;
	let permission = initialPermission;
	const actionOrder: string[] = [];
	let lastDelivery = delivery('displayed', 'delivery-0');
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
		get permission() {
			return permission;
		},
		requestPermission: vi.fn(async () => {
			actionOrder.push('permission-requested');
			if (persistRequestedPermission) permission = requestedPermission;
			actionOrder.push(`permission-result:${requestedPermission}`);
			return requestedPermission;
		})
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
			actionOrder.push(`test-post:${permission}`);
			const state = states[Math.min(postCount, states.length - 1)];
			postCount += 1;
			lastDelivery = delivery(state ?? 'missing', `delivery-${postCount}`);
			return jsonResponse({ ok: true, delivery: lastDelivery });
		}
		if (init?.method === 'PATCH') {
			const visible = JSON.parse(String(init.body ?? '{}')).visible === true;
			lastDelivery = delivery(visible ? 'confirmed' : 'missing', lastDelivery.deliveryId);
			return jsonResponse({ ok: true, delivery: lastDelivery });
		}
		return jsonResponse({ ok: true, delivery: lastDelivery });
	}));

	return {
		setVisibility(next: DocumentVisibilityState) {
			visibilityState = next;
			document.dispatchEvent(new Event('visibilitychange'));
		},
		postRequests: () => postCount,
		actionOrder: () => [...actionOrder],
		requestPermission: notification.requestPermission
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
		Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
		Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
	});

	it('muestra al principio solamente el recordatorio y envía una prueba real al tocarlo', async () => {
		const environment = installNotificationEnvironment(['displayed'], 'default');
		render(Page, {
			data: {
				...pageData,
				created: true,
				googleCalendar: { ...pageData.googleCalendar, available: true }
			}
		});

		expect(screen.getByRole('heading', { name: 'Tu turno quedó reservado' })).toBeInTheDocument();
		expect(
			screen.getByRole('heading', { name: 'Último paso: activá el recordatorio' })
		).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Agregar a Calendario Samsung' })).not.toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Agregar a Google Calendar' })).not.toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));

		await waitFor(() => {
			expect(screen.getByText('¿Recibiste la notificación de prueba?')).toBeInTheDocument();
		});
		expect(environment.requestPermission).toHaveBeenCalledOnce();
		expect(environment.postRequests()).toBe(1);
		expect(environment.actionOrder()).toEqual([
			'permission-requested',
			'permission-result:granted',
			'test-post:granted'
		]);
		expect(screen.queryByRole('link', { name: 'Agregar a Calendario Samsung' })).not.toBeInTheDocument();
	});

	it('no envía la prueba mientras el permiso efectivo todavía no esté concedido', async () => {
		const environment = installNotificationEnvironment(['displayed'], 'default', 'granted', false);
		render(Page, {
			data: {
				...pageData,
				googleCalendar: { ...pageData.googleCalendar, available: true }
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));

		expect(environment.requestPermission).toHaveBeenCalledOnce();
		expect(environment.postRequests()).toBe(0);
		expect(
			await screen.findByRole('button', { name: '🔔 Activar recordatorio' })
		).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Agregar a Calendario Samsung' })).not.toBeInTheDocument();
	});

	it('pregunta si llegó aunque Android no informe automáticamente que la mostró', async () => {
		vi.useFakeTimers();
		installNotificationEnvironment(['accepted']);
		render(Page, {
			data: {
				...pageData,
				googleCalendar: { ...pageData.googleCalendar, available: true }
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));
		await vi.advanceTimersByTimeAsync(5_100);

		expect(screen.getByText('¿Recibiste la notificación de prueba?')).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Agregar a Calendario Samsung' })).not.toBeInTheDocument();
	});

	it('finaliza el proceso sin mostrar calendarios cuando la persona confirma la prueba', async () => {
		installNotificationEnvironment(['displayed']);
		render(Page, {
			data: {
				...pageData,
				googleCalendar: { ...pageData.googleCalendar, available: true }
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Sí, la recibí' }));

		expect(await screen.findByText('Recordatorio activado')).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Agregar a Calendario Samsung' })).not.toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Agregar a Google Calendar' })).not.toBeInTheDocument();
	});

	it('muestra Samsung primero y Google después si la prueba no llegó', async () => {
		installNotificationEnvironment(['displayed']);
		render(Page, {
			data: {
				...pageData,
				googleCalendar: { ...pageData.googleCalendar, available: true }
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'No la recibí' }));

		const samsung = await screen.findByRole('link', { name: 'Agregar a Calendario Samsung' });
		const google = screen.getByRole('link', { name: 'Agregar a Google Calendar' });
		expect(samsung).toHaveAttribute(
			'href',
			'/turno/public-token/google-calendar/connect?target=samsung'
		);
		expect(google).toHaveAttribute(
			'href',
			'/turno/public-token/google-calendar/connect?target=google'
		);
		expect(samsung.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('mantiene Samsung primero y Google después con un selector en memoria si OAuth no está disponible', async () => {
		const share = vi.fn().mockResolvedValue(undefined);
		const canShare = vi.fn().mockReturnValue(true);
		Object.defineProperty(navigator, 'share', { configurable: true, value: share });
		Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare });
		installNotificationEnvironment(['displayed']);
		render(Page, { data: pageData });

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'No la recibí' }));

		const samsung = await screen.findByRole('button', { name: 'Agregar a Calendario Samsung' });
		const google = screen.getByRole('link', { name: 'Agregar a Google Calendar' });
		expect(google).toHaveAttribute('href', '/turno/public-token/ir/google');
		expect(samsung.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

		await fireEvent.click(samsung);

		expect(canShare).toHaveBeenCalledOnce();
		expect(share).toHaveBeenCalledOnce();
		const sharedFile = share.mock.calls[0]?.[0]?.files?.[0] as File;
		expect(sharedFile).toBeInstanceOf(File);
		expect(sharedFile.name).toBe('turno.ics');
		expect(sharedFile.type).toBe('text/calendar');
	});

	it('pasa directamente a los calendarios cuando se rechaza el permiso', async () => {
		installNotificationEnvironment(['displayed'], 'default', 'denied');
		render(Page, {
			data: {
				...pageData,
				googleCalendar: { ...pageData.googleCalendar, available: true }
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));

		expect(await screen.findByRole('link', { name: 'Agregar a Calendario Samsung' })).toBeInTheDocument();
		expect(screen.queryByText(/ajustes|permisos del sitio/i)).not.toBeInTheDocument();
	});

	it('muestra los calendarios si el navegador no admite notificaciones', async () => {
		Object.defineProperty(window, 'Notification', { configurable: true, value: undefined });
		Object.defineProperty(window, 'PushManager', { configurable: true, value: undefined });
		Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
		Object.defineProperty(navigator, 'userAgent', { configurable: true, value: SAMSUNG_USER_AGENT });

		render(Page, {
			data: {
				...pageData,
				googleCalendar: { ...pageData.googleCalendar, available: true }
			}
		});

		expect(await screen.findByRole('link', { name: 'Agregar a Calendario Samsung' })).toBeInTheDocument();
		expect(screen.queryByText(/abr[ií] este turno en el navegador/i)).not.toBeInTheDocument();
	});
});

describe('Google Calendar administrado en Android', () => {
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it('ofrece Samsung y Google cuando las notificaciones no están configuradas', () => {
		render(Page, {
			data: {
				...pageData,
				vapidPublicKey: null,
				googleCalendar: { ...pageData.googleCalendar, available: true }
			}
		});

		expect(screen.getByRole('link', { name: 'Agregar a Calendario Samsung' })).toHaveAttribute(
			'href',
			'/turno/public-token/google-calendar/connect?target=samsung'
		);
		expect(screen.getByRole('link', { name: 'Agregar a Google Calendar' })).toHaveAttribute(
			'href',
			'/turno/public-token/google-calendar/connect?target=google'
		);
	});

	it('confirma la cobertura verificada y explica la actualización automática', () => {
		render(Page, {
			data: {
				...pageData,
				vapidPublicKey: null,
				googleCalendar: {
					available: true,
					state: 'active' as const,
					current: true,
					reminderLabel: '24 horas y 2 horas antes'
				}
			}
		});

		expect(screen.getByText('Recordatorio guardado en tu calendario')).toBeInTheDocument();
		expect(screen.getByText(/actualizamos el mismo evento autom[aá]ticamente/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /quitar de mi cuenta google/i })).toBeInTheDocument();
	});

	it('durante una reprogramación no pide volver a agregar el evento', () => {
		render(Page, {
			data: {
				...pageData,
				appointment: {
					...pageData.appointment,
					calendar_update_required_at: '2026-08-04T12:00:00.000Z'
				},
				vapidPublicKey: null,
				googleCalendar: {
					available: true,
					state: 'updating' as const,
					current: false,
					reminderLabel: '24 horas y 2 horas antes'
				}
			}
		});

		expect(screen.getByText('Actualizando tu recordatorio')).toBeInTheDocument();
		expect(screen.getByText(/no ten[eé]s que volver a agregarlo/i)).toBeInTheDocument();
		expect(
			screen.queryByRole('link', { name: 'Agregar a Google Calendar' })
		).not.toBeInTheDocument();
	});
});

describe('calendario en iPhone', () => {
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it('mantiene una acción directa y no muestra notificaciones ni opciones Android', () => {
		render(Page, {
			data: {
				...pageData,
				created: true,
				device: 'ios' as const,
				googleCalendar: { ...pageData.googleCalendar, available: true }
			}
		});

		expect(screen.getByRole('heading', { name: 'Tu turno quedó reservado' })).toBeInTheDocument();
		expect(
			screen.getByRole('heading', { name: 'Último paso: activá el recordatorio' })
		).toBeInTheDocument();
		expect(screen.getByRole('link', { name: '📅 Agregar al calendario' })).toHaveAttribute(
			'href',
			'/turno/public-token/calendario.ics?p=phone'
		);
		expect(screen.queryByRole('button', { name: /activar recordatorio/i })).not.toBeInTheDocument();
		expect(screen.queryByText(/Calendario Samsung/i)).not.toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Agregar a Google Calendar' })).not.toBeInTheDocument();
	});
});
