// Service worker SOLO para recordatorios push de turnos.
// Se registra manualmente cuando el paciente toca "Recibir recordatorio" (nunca al
// cargar la página) y no cachea nada: no es una PWA, no intercepta fetch.

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
	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = event.notification.data && event.notification.data.url;
	if (!url) return;
	event.waitUntil(
		clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
			for (const client of windowClients) {
				if (client.url === url && 'focus' in client) return client.focus();
			}
			return clients.openWindow(url);
		})
	);
});
