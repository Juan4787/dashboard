import { describe, expect, it } from 'vitest';
import {
	androidNotificationSettingsIntent,
	classifyUserAgent,
	isLikelyBotUserAgent,
	notificationBrowserProfile,
	refineDeviceClass,
	supportsAndroidCalendarIntent
} from './device';

const UA = {
	iphone:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
	ipadOld:
		'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
	android:
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
	androidEdge:
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 EdgA/125.0.0.0',
	macSafari:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
	windowsChrome:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
	whatsappPreview: 'WhatsApp/2.23.20.0',
	facebookBot: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
	samsungInternet:
		'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
	androidWebView:
		'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/115.0.0.0 Mobile Safari/537.36',
	instagramInApp:
		'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile Safari/537.36 Instagram 334.0.0.42.95 Android',
	firefoxAndroid:
		'Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0'
};

describe('notificationBrowserProfile', () => {
	it('identifica el navegador Android antes de Chrome embebido en su UA', () => {
		expect(notificationBrowserProfile(UA.android)).toMatchObject({
			label: 'Chrome',
			androidPackage: 'com.android.chrome'
		});
		expect(notificationBrowserProfile(UA.samsungInternet)).toMatchObject({
			label: 'Samsung Internet',
			androidPackage: 'com.sec.android.app.sbrowser'
		});
		expect(notificationBrowserProfile(UA.androidEdge)).toMatchObject({
			label: 'Microsoft Edge',
			androidPackage: 'com.microsoft.emmx'
		});
	});

	it('no promete un acceso directo cuando el navegador no admite intent de Chromium', () => {
		expect(notificationBrowserProfile(UA.firefoxAndroid)).toMatchObject({
			label: 'Firefox',
			supportsAndroidSettingsIntent: false
		});
		expect(androidNotificationSettingsIntent(UA.firefoxAndroid, 'https://turnos.test/turno/1')).toBeNull();
	});
});

describe('androidNotificationSettingsIntent', () => {
	it('apunta a las notificaciones de la app correcta y conserva un retorno seguro', () => {
		const fallback = 'https://turnos.test/turno/token?desde=mensaje';
		const intent = androidNotificationSettingsIntent(UA.android, fallback);
		expect(intent).toContain('action=android.settings.APP_NOTIFICATION_SETTINGS');
		expect(intent).toContain('S.android.provider.extra.APP_PACKAGE=com.android.chrome');
		expect(intent).toContain(
			`S.browser_fallback_url=${encodeURIComponent('https://turnos.test/turno/token?desde=mensaje&push_setup=manual')}`
		);
	});

	it('no genera enlaces Android en escritorio', () => {
		expect(androidNotificationSettingsIntent(UA.windowsChrome, 'https://turnos.test')).toBeNull();
	});
});

describe('classifyUserAgent', () => {
	it('clasifica iPhone y iPad como ios', () => {
		expect(classifyUserAgent(UA.iphone)).toBe('ios');
		expect(classifyUserAgent(UA.ipadOld)).toBe('ios');
	});

	it('clasifica Android', () => {
		expect(classifyUserAgent(UA.android)).toBe('android');
	});

	it('clasifica desktop (Mac, Windows)', () => {
		expect(classifyUserAgent(UA.macSafari)).toBe('desktop');
		expect(classifyUserAgent(UA.windowsChrome)).toBe('desktop');
	});

	it('desconocido ante UA vacío o raro', () => {
		expect(classifyUserAgent(null)).toBe('unknown');
		expect(classifyUserAgent('CurlClient/1.0')).toBe('unknown');
	});
});

describe('isLikelyBotUserAgent', () => {
	it('detecta previews de WhatsApp/Facebook', () => {
		expect(isLikelyBotUserAgent(UA.whatsappPreview)).toBe(true);
		expect(isLikelyBotUserAgent(UA.facebookBot)).toBe(true);
	});

	it('no marca navegadores reales', () => {
		expect(isLikelyBotUserAgent(UA.iphone)).toBe(false);
		expect(isLikelyBotUserAgent(UA.android)).toBe(false);
		expect(isLikelyBotUserAgent(UA.windowsChrome)).toBe(false);
	});

	it('UA ausente cuenta como bot (no marcar offered)', () => {
		expect(isLikelyBotUserAgent(null)).toBe(true);
	});
});

describe('supportsAndroidCalendarIntent', () => {
	it('acepta Chrome Android (incluye Custom Tabs: mismo UA) y Samsung Internet', () => {
		expect(supportsAndroidCalendarIntent(UA.android)).toBe(true);
		expect(supportsAndroidCalendarIntent(UA.samsungInternet)).toBe(true);
	});

	it('rechaza WebView embebido (wv / Version+Chrome) e Instagram in-app', () => {
		expect(supportsAndroidCalendarIntent(UA.androidWebView)).toBe(false);
		expect(supportsAndroidCalendarIntent(UA.instagramInApp)).toBe(false);
	});

	it('rechaza Firefox Android (no Chromium, sin fallback)', () => {
		expect(supportsAndroidCalendarIntent(UA.firefoxAndroid)).toBe(false);
	});

	it('rechaza todo lo que no es Android', () => {
		expect(supportsAndroidCalendarIntent(UA.iphone)).toBe(false);
		expect(supportsAndroidCalendarIntent(UA.windowsChrome)).toBe(false);
		expect(supportsAndroidCalendarIntent(null)).toBe(false);
		expect(supportsAndroidCalendarIntent('')).toBe(false);
	});
});

describe('refineDeviceClass', () => {
	it('reclasifica iPad-como-Mac usando maxTouchPoints', () => {
		expect(
			refineDeviceClass('desktop', { maxTouchPoints: 5, platform: 'MacIntel', userAgent: UA.macSafari })
		).toBe('ios');
	});

	it('mantiene desktop en una Mac real sin touch', () => {
		expect(
			refineDeviceClass('desktop', { maxTouchPoints: 0, platform: 'MacIntel', userAgent: UA.macSafari })
		).toBe('desktop');
	});

	it('no toca clasificaciones móviles', () => {
		expect(
			refineDeviceClass('android', { maxTouchPoints: 5, platform: 'Linux armv8l', userAgent: UA.android })
		).toBe('android');
	});
});
