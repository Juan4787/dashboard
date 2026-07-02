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
	// `group` agrupa las notificaciones del mismo turno: antes de mostrar la nueva se
	// cierran las viejas del grupo (p.ej. el aviso de 24h con el horario anterior a una
	// reprogramación). El tag igual pisa la del mismo kind; esto cubre los kinds cruzados.
	const group = typeof payload.group === 'string' && payload.group ? payload.group : null;
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
	event.waitUntil(show());
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
