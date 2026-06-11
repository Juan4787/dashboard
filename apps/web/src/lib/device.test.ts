import { describe, expect, it } from 'vitest';
import { classifyUserAgent, isLikelyBotUserAgent, refineDeviceClass } from './device';

const UA = {
	iphone:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
	ipadOld:
		'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
	android:
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
	macSafari:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
	windowsChrome:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
	whatsappPreview: 'WhatsApp/2.23.20.0',
	facebookBot: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
};

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
