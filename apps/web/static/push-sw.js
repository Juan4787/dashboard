// Service worker SOLO para recordatorios push de turnos.
// Se registra manualmente cuando el paciente toca "Recibir recordatorio" (nunca al
// cargar la página) y no cachea nada: no es una PWA, no intercepta fetch.

// La versión con acuses debe reemplazar al worker anterior sin esperar a que la
// persona cierre todas las pestañas; de lo contrario vería la prueba pero la UI no
// podría verificarla hasta una visita futura.
self.addEventListener('install', (event) => {
	event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
	event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
	let payload = {};
	try {
		payload = event.data ? event.data.json() : {};
	} catch {
		payload = {};
	}
	const title = payload.title || 'Recordatorio de turno';
	const options = {
		body: payload.body || 'Tenés un turno próximo.',
		data: { url: payload.url || '/' },
		// El contenido es neutral (sin datos clínicos): puede aparecer en pantalla bloqueada.
		tag: payload.tag || 'turno-recordatorio',
		renotify: true
	};
	// `group` agrupa las notificaciones del mismo turno: antes de mostrar la nueva se
	// cierran las viejas del grupo (p.ej. el aviso de 24h con el horario anterior a una
	// reprogramación). El tag igual pisa la del mismo kind; esto cubre los kinds cruzados.
	const group = typeof payload.group === 'string' && payload.group ? payload.group : null;
	const delivery = payload.delivery && typeof payload.delivery === 'object' ? payload.delivery : null;
	const reportDeliveryStage = async (stage) => {
		if (
			!delivery ||
			typeof delivery.id !== 'string' ||
			typeof delivery.token !== 'string' ||
			typeof delivery.receiptUrl !== 'string'
		) {
			return false;
		}
		try {
			const receiptUrl = new URL(delivery.receiptUrl, self.location.origin);
			if (receiptUrl.origin !== self.location.origin) return false;
			const response = await fetch(receiptUrl.href, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					deliveryId: delivery.id,
					receiptToken: delivery.token,
					stage
				}),
				credentials: 'omit',
				cache: 'no-store'
			});
			return response.ok;
		} catch {
			return false;
		}
	};
	const show = async () => {
		if (group && typeof self.registration.getNotifications === 'function') {
			try {
				const shown = await self.registration.getNotifications();
				for (const notification of shown) {
					const tag = notification.tag || '';
					if (tag.indexOf(group + '-') === 0 && tag !== options.tag) notification.close();
				}
			} catch {
				// Best-effort: si no se pueden listar, se muestra igual la nueva.
			}
		}
		return self.registration.showNotification(title, options);
	};
	const handlePush = async () => {
		// Primero se intenta mostrar; la telemetría corre después y nunca retrasa el
		// aviso. Un único acuse alcanza: `displayed` también completa `received` en el
		// servidor; si showNotification falla, se registra solamente `received`.
		const [shown] = await Promise.allSettled([show()]);
		await reportDeliveryStage(shown.status === 'fulfilled' ? 'displayed' : 'received');
	};
	event.waitUntil(handlePush());
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = event.notification.data && event.notification.data.url;
	if (!url) return;
	event.waitUntil(
		clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
			const targetUrl = new URL(url, self.location.origin).href;
			for (const client of windowClients) {
				if (client.url === targetUrl && 'focus' in client) return client.focus();
			}
			return clients.openWindow(targetUrl);
		})
	);
});
