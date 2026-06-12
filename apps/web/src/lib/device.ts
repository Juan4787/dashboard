// Clasificación conservadora de dispositivo para decidir qué opciones de calendario
// mostrar primero. Regla del plan: ante incertidumbre, calendario (nunca push).
// El server clasifica por User-Agent; el cliente refina el único caso invisible para
// el UA: iPad moderno que se reporta como "Macintosh" (se detecta por maxTouchPoints).

export type DeviceClass = 'ios' | 'android' | 'desktop' | 'unknown';

export const classifyUserAgent = (userAgent: string | null | undefined): DeviceClass => {
	if (!userAgent) return 'unknown';
	if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
	if (/Android/i.test(userAgent)) return 'android';
	if (/Macintosh|Windows NT|X11; Linux|CrOS/i.test(userAgent)) return 'desktop';
	return 'unknown';
};

// Previews de mensajería y crawlers fetchean el link del turno para mostrar la
// tarjeta del chat: no deben marcar el turno como "ofrecido".
export const isLikelyBotUserAgent = (userAgent: string | null | undefined): boolean => {
	if (!userAgent) return true;
	return /WhatsApp|facebookexternalhit|TelegramBot|Twitterbot|LinkedInBot|Slackbot|Discordbot|Googlebot|bingbot|bot\b|crawler|spider|preview/i.test(
		userAgent
	);
};

// FASE 12: el href "intent://" de calendario solo se emite para navegadores Android
// capaces de manejarlo CON fallback: Chromium con UI de navegador real (Chrome,
// Samsung Internet, Edge, Opera; Custom Tabs usa el Chrome del usuario, así que
// WhatsApp pasa). Quedan afuera: el WebView embebido (token "; wv)" o
// "Version/X.Y … Chrome/", típico de Instagram/Facebook y apps con WebView crudo),
// que muestra ERR_UNKNOWN_URL_SCHEME sin respetar el fallback, y los no-Chromium
// (Firefox) que ignoran el esquema. Fuera del gate, Android sigue con Google.
export const supportsAndroidCalendarIntent = (
	userAgent: string | null | undefined
): boolean => {
	if (!userAgent) return false;
	if (!/Android/i.test(userAgent)) return false;
	if (/;\s*wv\)/.test(userAgent)) return false;
	if (/\bVersion\/\d[\d.]*\s/.test(userAgent) && /Chrome\//.test(userAgent)) return false;
	if (/FBAN|FBAV|Instagram|Line\//i.test(userAgent)) return false;
	return /Chrome\/|SamsungBrowser\//.test(userAgent);
};

// Refinamiento client-side: iPadOS en modo desktop se presenta como Mac, pero una
// Mac real no tiene pantalla táctil multi-touch.
export const refineDeviceClass = (
	serverClass: DeviceClass,
	nav: Pick<Navigator, 'maxTouchPoints' | 'platform' | 'userAgent'>
): DeviceClass => {
	if (serverClass === 'desktop' && nav.maxTouchPoints > 1 && /Mac/.test(nav.platform ?? '')) {
		return 'ios';
	}
	return serverClass;
};
