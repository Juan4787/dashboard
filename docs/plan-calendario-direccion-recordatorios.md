# Plan de implementación — Calendario, dirección, push y recordatorios de turno

> Estado: EN EJECUCIÓN. Ver "Registro de avance" al final.
> Este documento es el plan acordado (versión final, con las correcciones de la revisión
> quirúrgica incorporadas). La especificación de producto vive en el documento madre
> "Calendario, dirección, push y recordatorios"; acá está el CÓMO técnico exacto.

---

## 1. Restricciones externas verificadas (condicionan el diseño)

1. **Google Calendar (`action=TEMPLATE`) no acepta recordatorios personalizados.**
   Soporta `text`, `dates`, `details`, `location`, `ctz`. Las alarmas 24h/2h solo viajan
   en el `.ics`. En Google el usuario recibe sus recordatorios default.
2. **Web Push en iOS requiere PWA instalada en home screen** (iOS 16.4+, incluso con
   Declarative Web Push de Safari 18.4). Push queda excluido en iPhone/iPad, por diseño.
3. **En Android, descargar un `.ics` tiene fricción** (descarga → abrir → elegir app).
   El link directo de Google Calendar abre la app prellenada. Google Calendar primero en Android.
4. **En iOS Safari, un `.ics` servido `inline` con `text/calendar` muestra la vista previa
   del evento con "Agregar".** Camino principal en iPhone/iPad.
5. **Outlook personal tiene deeplink**: `outlook.live.com/calendar/deeplink/compose`
   con `subject`, `startdt`, `enddt`, `body`, `location` (ISO 8601).
6. **Navegador embebido de WhatsApp**: muchos pacientes abren `/turno/[token]` desde el chat.
   Android usa Custom Tabs (todo funciona); el webview de iOS puede no manejar bien el `.ics`.
   Mitigación: en iOS siempre ofrecer Google Calendar como segunda opción + "Copiar detalles".
7. **VALARM**: Apple Calendar y la mayoría de calendarios nativos lo respetan; Google Calendar
   lo ignora al importar (usa defaults del usuario). Por eso son "alarmas sugeridas".
8. **`goo.gl` está deprecado** (los enlaces inactivos dejaron de resolver en 2025).
   No se acepta como host de Maps manual.

## 2. Hechos del repo que condicionan el diseño

- `/turno/[token]` YA es la pantalla post-confirmación (la reserva redirige con `?creado=1`).
  Todo se construye sobre esa página.
- `formatDateTime` (`apps/web/src/lib/utils/format.ts`) no usaba timezone → bug latente de
  SSR en UTC (Netlify). Se corrige en Fase 0.
- `rescheduleAppointment` (`lib/server/appointments.ts`) es el único punto donde cambia la
  fecha → ahí se engancha el versionado del calendario (SEQUENCE).
- Patrón de jobs internos (`lib/server/internal-jobs.ts` + `INTERNAL_JOB_SECRET`) se reusa
  para push. El claim atómico copia el patrón de `claim_queued_message_dispatches`.
- DEMO_MODE existe en todas las páginas públicas → cada endpoint nuevo debe manejarlo.
- La base es la REMOTA de Supabase con drift conocido → migraciones con grants/RLS explícitos
  y verificación post-aplicación.
- La pipeline Meta/WhatsApp automática existe pero queda DORMIDA (`WHATSAPP_AUTOMATIC_REMINDERS_ENABLED`).
  Recordatorios manuales es el camino operativo. El filtro anti-duplicación la contempla
  (un turno con dispatch automático activo no aparece en Recordatorios).

## 3. Decisiones de diseño centrales

- **Calendario = recordatorio principal.** Push secundario (Android/desktop compatible, opt-in).
  WhatsApp manual desde Recordatorios solo para turnos sin cobertura registrada.
- **Tracking por redirect server-side, no por JavaScript.** Cada opción de calendario es un
  link real a un endpoint propio que registra la acción y redirige/sirve. Funciona sin JS,
  en webviews y nunca pierde un evento.
- **Fechas ICS en UTC** (sin VTIMEZONE). Todos los clientes convierten correctamente y se
  evita el bloque más frágil del formato. El texto humano de la descripción va en TZ del negocio.
- **Honestidad del tracking**: se registra "acción de calendario", nunca certeza de guardado.
  `offered` NUNCA cuenta como cobertura.
- **Estado vivo**: `/turno/[token]` y su `.ics` siempre reflejan el estado actual del turno.
  `Cache-Control: no-store` en todo lo tokenizado.

## 4. Correcciones incorporadas de la revisión quirúrgica

1. `push_subscriptions`: `unique (appointment_id, endpoint)` (NO `endpoint unique` global)
   + índice suelto por `endpoint` para revocación por 410 + upsert idempotente en suscripción.
2. Push: `claimed_at` / `sent_at` separados, claim atómico vía RPC espejo de
   `claim_queued_message_dispatches`, con reclaim por timeout (10 min) para cubrir crash
   entre claim y send. Nunca marcar `sent` antes de enviar.
3. Whitelist Maps estricta: `maps.app.goo.gl`, `maps.google.com`, y `google.com`/`www.google.com`
   solo con path que empiece en `/maps`. Sin `goo.gl` ni `g.co`. Falso negativo barato:
   validación al guardar + fallback generado desde la dirección.
4. `record_calendar_action` como RPC SQL atómica (status + provider + timestamps + contador
   + limpieza de `calendar_update_required_at` en un solo statement).
5. `calendar_offered_at`: filtro de bots/preview (WhatsApp, facebookexternalhit, TelegramBot…),
   no se escribe en HEAD ni DEMO_MODE, escritura best-effort que jamás rompe el load.
6. ICS de cancelación (`METHOD:CANCEL`): el endpoint SIEMPRE lo sirve si el turno está
   cancelado (corrección, el link vive en el evento guardado), pero en UI es un link de
   texto secundario. El mensaje principal es texto plano: "Si lo habías agregado, eliminá el evento".
7. Copy interno: "Sin calendario registrado" y "Calendario pendiente de actualizar".
8. Mejoras propias: revocar suscripciones push de turnos terminales en el mismo job;
   línea de salud push en Configuración → Comunicación.

---

## FASE 0 — Timezone correcta en todo lo público

- `apps/web/src/lib/utils/format.ts`: `formatDateTime(value, timeZone?)` y
  `formatDate(value, timeZone?)` con TZ opcional (sin TZ = comportamiento previo para
  páginas internas). Nuevo `formatInTimeZone(iso, timeZone)` → `{ dateLabel, timeLabel, full }`.
- Páginas públicas (`/turno`, `/reservar`, `/confirmar`, `/cancelar`, `/reprogramar`) pasan
  `business.timezone`.
- `setHeaders({ 'cache-control': 'no-store' })` en el load de `/turno/[token]`.
- Test: TZ `America/Argentina/Cordoba` con horario que cruza medianoche UTC
  (turno 21:30 ART = 00:30 UTC del día siguiente).

## FASE 1 — Migración única de base de datos

`supabase/migrations/20260611XXXXXX_calendar_location_reminders.sql`:

- `businesses`: `address_instructions text`, `maps_url text`.
- `appointments`:
  - `calendar_action_status` text not null default `'not_offered'`
    check in (`not_offered, offered, clicked_google, clicked_ics, downloaded_ics,
    clicked_outlook, clicked_phone_calendar`)
  - `calendar_provider` text check in (`google, ics, outlook, phone_calendar`)
  - `calendar_offered_at`, `calendar_action_at` timestamptz
  - `calendar_action_count` int not null default 0
  - `calendar_sequence` int not null default 0  ← fuente del SEQUENCE del ICS
  - `calendar_update_required_at` timestamptz   ← seteado al reprogramar si hubo acción previa
  - `whatsapp_reminder_opened_at/by`, `whatsapp_reminder_marked_sent_at/by`
- Índice parcial: `(business_id, starts_at) where status in ('reserved','confirmed')`.
- `push_subscriptions`: id, business_id, appointment_id, endpoint, p256dh, auth, user_agent,
  `push_24h_claimed_at/sent_at`, `push_2h_claimed_at/sent_at`, failed_count, revoked_at,
  created_at, updated_at, **unique (appointment_id, endpoint)**, índices por endpoint y
  appointment. RLS habilitada SIN policies (solo service role). Revoke a anon/authenticated.
- RPC `record_calendar_action(p_appointment_id, p_action, p_provider)`: update atómico.
- RPC `claim_due_push_reminders(claim_now, claim_limit)`: claim con
  `FOR UPDATE SKIP LOCKED`, ventanas 24h (entre now+2h y now+24h) y 2h (entre now y now+2h),
  reclaim si `claimed_at < now - 10 min`, devuelve filas + `reminder_kind`.
- Aplicación: `supabase db push` a remoto + verificación de grants
  (lección del drift de `patients`).

## FASE 2 — Ubicación: librería + configuración + readiness

- `apps/web/src/lib/server/location.ts`:
  - `buildMapsSearchUrl(address)` → `https://www.google.com/maps/search/?api=1&query=...`
  - `isValidMapsUrl(raw)` → https + whitelist estricta (punto 3 de correcciones)
  - `resolveMapsUrl({ address, maps_url })` → manual válido > generado > null
- `PUBLIC_BUSINESS_SELECT` (+`address_instructions, maps_url`) y propagación a
  `PublicAppointmentView.business` (+ `maps_link` resuelto).
- Config negocio (`configuracion/negocio`):
  - Campos nuevos: instrucciones adicionales (textarea) y link manual de Maps (input URL).
  - Validación: maps_url no vacío e inválido → error claro al guardar.
  - **Gating sin retroactividad**: habilitar `public_booking_enabled` sin dirección → `fail(400)`.
    Quien ya está habilitado sin dirección NO se apaga: banner rojo persistente en
    Configuración y Agenda.
- `/reservar/[businessSlug]`: la dirección del header se vuelve link "Cómo llegar".

## FASE 3 — Librería ICS (`apps/web/src/lib/server/ics.ts`)

Funciones puras. Reglas (cada una con test):

1. CRLF (`\r\n`) en todas las líneas.
2. Folding a 75 octetos medidos en **bytes UTF-8** (tildes = 2 bytes), continuación con espacio.
3. Escapado TEXT: `\` `;` `,` y saltos de línea (`\n` literal).
4. Fechas UTC (`DTSTART:20260615T143000Z`), sin VTIMEZONE.
5. `UID:appointment-{id}@{host}` estable (host de PUBLIC_SITE_URL).
6. `SEQUENCE` = `appointments.calendar_sequence` (+1 en variante cancelada).
7. Alarmas según proximidad: >24h → −PT24H y −PT2H; 2–24h → −PT2H; 30min–2h → −PT30M;
   <30min → ninguna.
8. `METHOD:PUBLISH` + `STATUS:CONFIRMED` (o `METHOD:CANCEL` + `STATUS:CANCELLED`),
   `TRANSP:OPAQUE`, `URL`, `DTSTAMP` = now UTC.
9. `SUMMARY: Turno en {negocio}` — NUNCA el servicio (privacidad pantalla bloqueada).
10. `LOCATION`: dirección (+ instrucciones con " · ").
11. `DESCRIPTION` (§10 del doc madre): fecha, hora local del consultorio, profesional,
    consultorio, dirección, indicaciones, Cómo llegar (maps), Ver turno (link).
    Sin datos clínicos, sin nombre del paciente.

## FASE 4 — Endpoints públicos (tracking sin JS, por redirect)

| Ruta (GET, `+server.ts`) | Registra | Responde |
|---|---|---|
| `/turno/[token]/calendario.ics` | `clicked_ics` / `clicked_phone_calendar` (`?p=phone`) | ICS `inline` |
| `/turno/[token]/calendario-descargar.ics` | `downloaded_ics` | ICS `attachment` |
| `/turno/[token]/ir/google` | `clicked_google` | 302 a Google Calendar |
| `/turno/[token]/ir/outlook` | `clicked_outlook` | 302 a Outlook |
| `/turno/[token]/ir/maps` | solo audit (no cambia status) | 302 al maps URL |

- Headers ICS: `Content-Type: text/calendar; charset=utf-8; method=PUBLISH`,
  `Content-Disposition: inline; filename="turno.ics"`, `Cache-Control: no-store`.
  Fallback descarga: `attachment`.
- Siempre genera desde el estado actual (vía `loadPublicAppointmentByToken`).
  Cancelado → variante CANCEL. Pasado → ICS sin alarmas, sin registrar acción.
- Acciones solo se registran con turno vigente (reserved/confirmed/reschedule_requested
  según reglas existentes de la vista pública).
- `ir/google|outlook` con turno no vigente → 302 a `/turno/[token]`.
- Tracking vía RPC `record_calendar_action` + `writeAuditLog('appointment.calendar_action')`.
- `calendar_offered_at`/estado `offered`: en el load de la página, primera vez, con filtro
  de bots, best-effort.
- `lib/server/calendar-links.ts`: `buildGoogleCalendarUrl` (UTC + `ctz` del negocio),
  `buildOutlookUrl` (deeplink personal). El `details` de Google lleva la misma descripción
  del ICS.
- DEMO_MODE: todos los endpoints responden con datos del turno demo.

## FASE 5 — Detección de dispositivo (`apps/web/src/lib/device.ts`)

1. SSR por User-Agent → `ios | android | desktop | unknown` (la página renderiza el orden
   correcto sin JS).
2. Refinamiento cliente: `maxTouchPoints > 1 && /Mac/` → iPad que se reporta como Mac → iOS.
3. Push: solo client-side (`serviceWorker && PushManager && Notification && !iOS`).

| Dispositivo | Opción 1 | Opción 2 | Opción 3 | Push |
|---|---|---|---|---|
| iPhone/iPad | Calendario del iPhone (.ics inline) | Google Calendar | Copiar detalles | Nunca |
| Android | Google Calendar | Calendario del teléfono (.ics) | Copiar detalles | Si soporta |
| Desktop | Google Calendar | Outlook | Descargar calendario | No |
| Desconocido | Agregar al calendario (.ics) | Google Calendar | Copiar detalles | No |

## FASE 6 — Rediseño de `/turno/[token]`

Estructura: Hero (confirmación + fecha/hora en TZ negocio) → Card resumen → **Card ubicación**
(dirección + instrucciones + botón "Cómo llegar") → **Card recordatorio** (CTA "Agregar al
calendario" protagonista + selector por dispositivo + push opt-in si corresponde + "Copiar
detalles") → Card acciones (confirmar/reprogramar/cancelar, existente).

Estados:
- Turno en <2h: ubicación arriba de todo, "Tu turno es pronto. Revisá la dirección ahora."
- `calendar_update_required_at` seteado: banner "Tu turno fue reprogramado. Actualizá el
  calendario para recibir el aviso correcto." + botón Actualizar calendario.
- Cancelado: texto §32 + link de texto secundario al ICS CANCEL.
- Pasado: histórico, sin CTAs.
- Acción ya registrada: advertencia §27 (avisos duplicados) con [Agregar igual] / [Cancelar],
  server-rendered.
- Copiar detalles: clipboard con fallback `<details>` con texto seleccionable.

## FASE 7 — Integración con reprogramación / cancelación

En `rescheduleAppointment`:
- `calendar_sequence += 1` (siempre).
- `calendar_update_required_at = now()` solo si `calendar_action_count > 0`.
- Audit extra `appointment.calendar_update_required`.
- El pedido público (`reschedule_requested`) NO toca nada (la fecha no cambió).
- Cancelación: sin cambios de datos (el endpoint ICS lee el estado y sirve CANCEL).

## FASE 8 — Recordatorios (`/odonto/recordatorios`)

`apps/web/src/lib/server/reminders.ts` + página (reemplaza el redirect actual).

Criterios de inclusión (ventanas Hoy / Mañana en TZ del negocio, default Mañana):
1. `status in ('reserved','confirmed')` y futuro. `reschedule_requested` queda FUERA
   (tiene su propio flujo en agenda).
2. Sin cobertura: `calendar_action_status in ('not_offered','offered')` → grupo
   "Sin calendario registrado"; o `calendar_update_required_at != null` → grupo
   "Calendario pendiente de actualizar".
3. Sin push activo para el turno (`push_subscriptions.revoked_at is null`).
4. Sin dispatch automático activo (`message_dispatches` tipo reminder, estados activos).
5. Teléfono E.164 válido y paciente no bloqueado → botón WhatsApp. Sin teléfono →
   fila visible con "Sin teléfono válido", sin botón.
6. Acceso comercial restricted/archived → página deshabilitada con aviso.

Botón **Enviar WhatsApp**: redirect-through `GET /odonto/recordatorios/abrir/[appointmentId]`
(auth + registra `whatsapp_reminder_opened_at/by` + audit `reminder.whatsapp_opened` +
302 a `wa.me`), `target="_blank"`. Mensaje §48 (neutral: fecha, hora, consultorio, dirección,
maps, link turno). Anti-duplicado: si ya se abrió → "WhatsApp abierto hace X" + confirmación
para reabrir. **Marcar como enviado**: action POST que setea `whatsapp_reminder_marked_sent_at/by`.

Nav: "Recordatorios" en `dailyNav` (no para professional/readonly). Banner liviano en Agenda
con count de mañana sin cobertura.

## FASE 9 — Push (Android/desktop, opt-in, PR independiente)

- Dep `web-push`. Env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
  `PUBLIC_VAPID_PUBLIC_KEY`.
- SW: `apps/web/static/push-sw.js` registrado MANUALMENTE al aceptar (no `src/service-worker`
  de SvelteKit, que se auto-registra y cachea). Handlers `push` + `notificationclick`.
- Opt-in en `/turno/[token]`: click → `requestPermission()` → subscribe → POST
  `/turno/[token]/push` (valida token, upsert `on conflict (appointment_id, endpoint)`).
  Permiso JAMÁS al cargar la página. La activación envía una prueba inmediata y sólo
  muestra "Avisos verificados" después de: aceptación del proveedor, acuse del service
  worker, `showNotification()` resuelto y confirmación explícita de la persona.
- `push_delivery_attempts` separa `accepted`, `received`, `displayed` y confirmación
  humana. El secreto de acuse no se guarda en claro: persiste sólo su SHA-256.
- Job `/internal/jobs/send-push-reminders` (cron externo ~10 min, `assertInternalJobRequest`):
  1. Revoca suscripciones de turnos terminales.
  2. `claim_due_push_reminders` → enviar → `sent_at`; fallo → limpiar claim +
     `failed_count += 1`; 404/410 → `revoked_at` por endpoint; 3 fallos → revoke.
  3. Payload neutral: título "Turno en {consultorio}", body "Te recordamos tu turno el {día}
     a las {hora}.", url `/turno/{token}`. Audit `appointment.push_sent`.
- Reprogramación: el trigger reinicia atómicamente claims/sent de 24h y 2h, marca
  obsoletos los intentos del horario anterior y el job vuelve a leer `starts_at` justo
  antes de enviar. 24h, 2h y el aviso inmediato comparten un `Topic` Web Push estable
  por turno para que el proveedor reemplace cualquier mensaje viejo todavía en cola.
- Recordatorios excluye turnos con push activo (ya en Fase 8).
- Salud push en Configuración → Comunicación: suscripciones activas, enviados 7 días, fallos.

## FASE 10 — Tests

Unitarios (Vitest, patrón de los `.test.ts` existentes):
- `ics.test.ts`: snapshot, folding bytes UTF-8, CRLF, escapado, 4 ramas de alarmas,
  UID estable, SEQUENCE, variante CANCEL.
- `location.test.ts`: cascada manual/generado/null, whitelist (casos goo.gl/g.co rechazados,
  google.com sin /maps rechazado), encoding de direcciones con #, &, tildes.
- `calendar-links.test.ts`: formato fechas Google/Outlook, encoding.
- `device.test.ts`: clasificación UA (iPhone, iPad viejo, Android, desktop, bot).
- `reminders.test.ts`: cada filtro de inclusión/exclusión, ventanas TZ Córdoba cruzando
  medianoche, mensaje wa.me exacto.
- `push.test.ts` (PR 4): ventanas, idempotencia, revocación.
- `push-sw.test.ts`: acuses received/displayed, fallo de telemetría sin bloquear el
  aviso, reemplazo del horario visible y click con URL relativa.
- `appointments.test.ts`: reschedule incrementa sequence y marca update_required solo si
  hubo acción.

E2E (Playwright): página turno muestra dirección + CTAs; `.ics` 200 con headers correctos;
`ir/google` 302; recordatorios demo. QA manual (matriz): iPhone Safari, iPhone desde WhatsApp,
iPad, Android Chrome, Samsung Internet, Android desde WhatsApp, desktop Chrome/Firefox/Edge/Safari.

## FASE 11 — Rollout

1. `supabase db push` a remoto + verificación de grants de tablas/funciones nuevas.
2. Netlify env: `VAPID_*`. Verificar `PUBLIC_SITE_URL` (el UID del ICS depende de esto).
3. Cron externo para `send-push-reminders` (mismo mecanismo que los jobs de dispatches).
4. Checklist staging: reservar turno real → ICS en iPhone y Android físicos → reprogramar →
   verificar SEQUENCE y banner → cancelar → verificar ICS CANCEL.
5. Decisión documentada: pipeline Meta queda dormida; Recordatorios es el camino operativo.

## FASE 12 — Android sin `.ics`: intent nativo + jerarquía de avisos (post-prueba real)

> Origen: prueba en dispositivos reales (2026-06-12). En Android, el `.ics` descarga un
> archivo que el paciente tiene que buscar y abrir a mano → DESCARTADO como flujo
> principal Android. Además, no todos los Android tienen Google Calendar instalado, y
> Google Calendar web móvil es un recordatorio débil. Esta fase reemplaza la fila
> Android de la matriz de Fase 5.

### Restricciones verificadas (se suman a §1)

9. **Ninguna vía web puede garantizar alarmas 24h/2h en Android.** `ACTION_INSERT`
   prellena título/fechas/lugar/descripción pero NO tiene extra documentado de
   recordatorios; el template de Google ya estaba verificado (§1.1); el VALARM del
   `.ics` solo lo respeta Apple (§1.7). En Android el evento queda con los defaults
   del usuario (~30 min). ⇒ La única garantía 24h/2h en Android es el **push propio**,
   que ya tiene exactamente esas ventanas (`claim_due_push_reminders`).
10. **Chrome soporta `intent://` con fallback oficial** (`S.browser_fallback_url`,
    que Chrome consume y no le llega a la app). Solo funciona desde un `<a href>` con
    gesto real del usuario: si viene de JS sin gesto o de un redirect, va directo al
    fallback. Extras tipados: `S.` string (URL-encoded), `l.` long (epoch millis).
11. **Soporte por navegador Android**: Chromium con UI real (Chrome, Samsung Internet,
    Edge; Custom Tabs = el Chrome del usuario, cubre WhatsApp) → OK. WebView crudo
    (token `; wv)` en el UA: Instagram/Facebook/apps embebidas) → `ERR_UNKNOWN_URL_SCHEME`,
    link muerto sin fallback. Firefox Android → sin soporte. ⇒ el href `intent://`
    solo se emite tras un **gate de User-Agent**; fuera del gate, Android sigue con
    Google Calendar como hasta ahora.

### Decisiones

1. **Jerarquía Android invertida.** CTA principal = push **"Activar avisos en este
   teléfono"** con copy de beneficio explícito ("Te avisamos 24 h y 2 h antes del
   turno"); el calendario pasa a conveniencia secundaria. iOS y desktop NO cambian
   (iOS ya cumple el requisito completo vía `.ics` inline + VALARM; en desktop el
   aviso fuerte vive en el teléfono).
2. **Intent detrás de flag, con DOS variantes** (el matching de intent-filters varía
   según la app de calendario; decide la matriz de dispositivos, no la especulación):
   - `data`: `intent://com.android.calendar/events#Intent;scheme=content;action=android.intent.action.INSERT;…;end`
   - `type`: `intent:#Intent;action=android.intent.action.INSERT;type=vnd.android.cursor.dir/event;…;end`
   Flag: env `ANDROID_CALENDAR_INTENT_MODE` = `off` (default) | `data` | `type`.
   Override de QA por query `?ci=off|data|type` (gana sobre el env y fuerza el href
   incluso fuera del gate de UA, para correr la matriz sin redeploys; en manos de un
   paciente solo cambia el href del botón, sin riesgo).
3. **El intento NO cuenta como cobertura** (corrección sobre el borrador previo): el
   click al intent se registra SOLO en `audit_logs`
   (`appointment.calendar_intent_attempt`), sin tocar `calendar_action_status`.
   Razón: el beacon dispara antes de saber si se abrió algo; si un intent fallido
   marcara cobertura, el paciente desaparece de Recordatorios y se queda SIN ningún
   aviso. Cobertura real solo la registran el fallback
   `ir/google?source=android_native_fallback` (302 server-side, tracking de siempre)
   o el push. Consistente con "`offered` nunca cuenta como cobertura".
4. **`.ics` demovido en Android** a link terciario chico "Descargar archivo de
   calendario (.ics)" (nunca más rotulado "Calendario del teléfono").
5. **Sin lógica por marca** (Samsung/Xiaomi) salvo que la matriz demuestre necesidad.
6. **Fine print honesto por dispositivo**: en Android no se prometen alarmas del
   evento; la promesa 24h/2h vive en el push. En iOS se mantiene el texto actual.
7. El copy del push es dinámico por proximidad: >24h → "24 h y 2 h antes";
   2–24h → "2 h antes"; <2h → "antes del turno" (las ventanas del job ya se
   comportan así).

### Implementación

- `lib/server/android-calendar-intent.ts`: builder puro de las dos variantes.
  Encoding estricto: cada extra `S.` va con `encodeURIComponent` (sin `;`/`=`/saltos
  crudos que rompan el parseo del Intent), `l.beginTime`/`l.endTime` en epoch millis,
  `S.browser_fallback_url` URL absoluta encodeada. Tests de formato/encoding.
- `lib/device.ts`: `supportsAndroidCalendarIntent(ua)` — gate Chromium-sin-WebView
  (excluye `; wv)`, `Version/X … Chrome/`, FB/Instagram/Line, no-Chromium). Tests.
- `/turno/[token]/+page.server.ts`: resuelve modo (query `?ci` > env > off), aplica
  gate de UA (salvo override), arma el href con fallback absoluto
  `…/ir/google?source=android_native_fallback` y pasa
  `androidCalendarIntent: { url, variant } | null`.
- `/turno/[token]/+page.svelte`: en Android el bloque push se renderiza ANTES del
  calendario y con botón primario; el selector de calendario pasa a botón secundario;
  la opción intent va primera dentro del selector (Google visible como escape);
  beacon best-effort al tocar el intent (`navigator.sendBeacon` → fallback
  `fetch keepalive`, nunca bloquea la navegación); `.ics` terciario.
- `POST /turno/[token]/calendario-intent`: audit-only, responde 204 siempre,
  valida token + turno vigente, DEMO_MODE no-op.
- `ir/google`: acepta `?source=` (whitelist) y lo suma al metadata del audit.

### Matriz de prueba (dispositivos reales, con `?ci=data` y `?ci=type`)

- Samsung (Chrome directo, Chrome desde WhatsApp, Samsung Internet, con y sin
  Google Calendar instalado), Xiaomi (Chrome, navegador propio), Pixel/Motorola
  (Chrome directo y desde WhatsApp). Por cada combinación: ¿abre app nativa o
  selector? ¿prellena título/fecha/lugar/descripción? ¿descarga algo? ¿cae al
  fallback de Google? ¿no hace nada?
- Éxito: abre calendario nativo o selector prellenado y guardar es 1 toque, sin
  descarga; el fallback a Google funciona cuando el intent no resuelve.
- Decisión posterior: si una variante funciona bien en Samsung → fijarla en el env
  como default Android (gate mediante). Si es inconsistente → `off` y Android queda
  push-first + Google (no se pierde nada respecto de hoy).

## Orden de PRs

1. **PR 1** — Fases 0+1+2 (timezone, migración, ubicación + config + readiness).
2. **PR 2** — Fases 3+4+5+6 (ICS, endpoints, detección, página del turno).
3. **PR 3** — Fases 7+8 (reprogramación + Recordatorios).
4. **PR 4** — Fase 9 (push). Independiente y prescindible sin bloquear lo demás.
5. **PR 5** — e2e + QA matrix + rollout.

---

## Registro de avance

> Se actualiza al completar hitos importantes. El detalle fino está en los commits y el código.

- 2026-06-11 — Plan redactado y aprobado con correcciones de la revisión quirúrgica.
  Comienza PR 1.
- 2026-06-11 — **PR 1 completo (Fases 0+1+2).** Timezone: `formatDate/formatDateTime`
  aceptan TZ opcional + `formatInTimeZone`; páginas públicas (`/turno`, `/reservar`)
  pasan la TZ del negocio; `no-store` en el load de `/turno/[token]`. Migración
  `20260611120000_calendar_location_reminders.sql` (ubicación, tracking calendario,
  push_subscriptions, RPCs `record_calendar_action` y `claim_due_push_reminders`).
  `location.ts` con whitelist estricta de Maps. Config negocio: campos dirección
  visible/indicaciones/link Maps + validación + gating de reserva pública sin dirección
  (no retroactivo) + banner. `PUBLIC_BUSINESS_SELECT` y `PublicAppointmentView`
  extendidos (incluye `maps_link` resuelto y campos calendar_*). Tests: 22 pasando
  (location, format, public-appointments, business, public-booking).
  ⚠ PENDIENTE ROLLOUT: la migración NO está aplicada al remoto todavía; la app no debe
  correr contra el remoto hasta aplicar `supabase db push` (los selects ya referencian
  columnas nuevas).
- 2026-06-11 — **PR 2 completo (Fases 3+4+5+6).** Librerías: `ics.ts` (folding UTF-8,
  CRLF, escapado, UID estable, SEQUENCE, alarmas por proximidad, variante CANCEL),
  `calendar-links.ts` (Google template + Outlook deeplink), `calendar-content.ts`
  (contenido neutral: nunca servicio ni paciente), `calendar-tracking.ts` (RPC atómica
  + offered best-effort), `device.ts` (clasificación UA + refinamiento iPad-como-Mac +
  filtro de bots/previews), `appointment-token.ts` (carga por token + redirects no-store).
  Endpoints: `calendario.ics` (inline), `calendario-descargar.ics` (attachment),
  `ir/google`, `ir/outlook`, `ir/maps` — tracking por redirect server-side, sin JS.
  Página `/turno/[token]` rediseñada: hero con fecha en TZ del negocio, card de
  ubicación con "Cómo llegar" (primera si el turno es en <2h), selector "Agregar al
  calendario" por dispositivo, advertencia de duplicado, "Copiar detalles", banner
  "Actualizar calendario" tras reprogramación, bloque de cancelado con link al ICS
  CANCEL. Tests: 38 nuevos pasando; svelte-check sin errores nuevos (solo warnings
  preexistentes de otra página).
- 2026-06-11 — **PR 3 completo (Fases 7+8).** `rescheduleAppointment` incrementa
  `calendar_sequence` y marca `calendar_update_required_at` solo si hubo acción previa
  (con tests de mock). `reminders.ts`: ventanas Hoy/Mañana en TZ del negocio (math de
  medianoche local correcta cruzando medianoche UTC), clasificador de cobertura puro
  (`offered` nunca cuenta como cobertura; excluye push activo y dispatches Meta
  activos), mensaje WhatsApp §48 + `wa.me`. Página `/odonto/recordatorios` reemplaza
  el redirect legacy: tabs Hoy/Mañana, grupos "Calendario pendiente de actualizar" y
  "Sin calendario registrado", fila con Enviar WhatsApp (redirect-through GET
  `abrir/[appointmentId]` que registra apertura + 302 a wa.me, anti-duplicado con
  confirmación), "Marcar como enviado", "Sin teléfono válido". Roles: professional →
  mis-turnos, readonly → agenda; restricted/archived deshabilitado. Nav "Recordatorios"
  en dailyNav + banner en Agenda con count aproximado de mañana. Tests: 16 más pasando.
- 2026-06-11 — **PR 4 completo (Fase 9, push).** Dep `web-push` + `push.ts` (claim
  atómico vía RPC, revalidación del turno con estado vivo antes de enviar, `sent_at`
  solo tras envío exitoso, 404/410 → revoke por endpoint, 3 fallos → revoke, payload
  neutral §67). SW manual `static/push-sw.js` (sin cache, no PWA), opt-in en
  `/turno/[token]` (permiso recién al tocar el botón, nunca en iOS), endpoint
  `POST /turno/[token]/push` con upsert `(appointment_id, endpoint)`, job
  `/internal/jobs/send-push-reminders` (revoca terminales + claim + envío), línea de
  salud push en Configuración → Comunicación (activas / enviados 7d / revocadas 7d).
  Tests de push: validez de payload, sent_at por kind, 410→revoke, fallo transitorio
  → release+failed_count, cancelado tras claim → release, sin VAPID → no-op.
- 2026-06-11 — **Pasada de consistencia ("ni un solo bug").** `vapidPublicKey`
  tipado en los props de `/turno/[token]`; "Copiar detalles" usa `page.url.origin`
  (el texto SSR sale completo); Recordatorios valida E.164 con `isLikelyPhoneE164`
  ("Sin teléfono válido" en vez de un wa.me roto), también en `abrir/[appointmentId]`;
  el count del banner de Agenda ahora incluye "pendiente de actualizar" (`.or` con
  `calendar_update_required_at`); `summarizeSlotsByDate` ordena los días
  cronológicamente.
- 2026-06-11 — **PR 5 (Fases 10+11) — e2e + perf/UX de reserva.**
  E2E smoke actualizado a la página rediseñada del turno (hero "Te esperamos el…",
  dirección + "Cómo llegar" + "Agregar al calendario" + "Copiar detalles") y al flujo
  de reserva demo con pasos colapsables; spec nuevo de endpoints: `.ics` 200 con
  `text/calendar`/`inline`/`no-store` y SUMMARY neutral (verificado des-folding),
  `calendario-descargar.ics` attachment, `ir/google` y `ir/maps` 302. Verificación
  SSR manual en DEMO_MODE (curl): reservar pasos 1/2/3, turno, ICS y redirects.
  **Extra pedido: `/reservar/[businessSlug]` más rápida y con mejor UX.**
  Performance (server): caché TTL en memoria de los escaneos de disponibilidad
  (60s catálogo/profesionales, 25s slots; crear reserva SIEMPRE revalida contra
  disponibilidad viva e invalida los escaneos del negocio), gate comercial +
  catálogo + asignaciones del servicio en paralelo, la fecha elegida se filtra del
  escaneo de días ya hecho (`scannedThrough`) en vez de re-consultar, y el load del
  server NO lee el param `slot` → elegir horario no re-ejecuta el load (instantáneo,
  se resuelve client-side desde `page.url`). Tests que fijan el contrato: 2 escaneos
  por selección completa, 0 escaneos al repetir navegación, 1 query puntual solo si
  la fecha cae fuera del rango escaneado.
  UX: los pasos resueltos colapsan a filas compactas con "Cambiar" (una sola card
  activa), barra de progreso "Paso X de 5" + "Empezar de nuevo", selección optimista
  durante la navegación con skeletons solo cuando la lista depende de un dato aún en
  vuelo, horarios agrupados Mañana/Tarde, días con count de horarios libres,
  avatar/iniciales y "Primer turno" por profesional, autocomplete (name/tel/email),
  microcopy de confirmación + política de cancelación, `cache-control: no-store`.
  Fix real de Turnstile: render explícito al montar el form (el modo implícito de
  Cloudflare solo escanea al cargar el documento y el form aparece tras una
  navegación client-side) + `reset()` tras intento fallido (token de un solo uso).
  Estado: 127 tests unitarios pasando, `svelte-check` 0 errores. Playwright NO se
  corrió en esta máquina (poca RAM): correr el smoke en staging/CI.

- 2026-06-12 — **FASE 12 planificada.** La prueba real en Android confirmó que el
  `.ics` descarga archivo (inaceptable como flujo principal). Investigación
  verificada contra doc oficial de Chrome (intent: + `S.browser_fallback_url` +
  requisito de gesto directo) y referencia de intents del calendario Android
  (ACTION_INSERT sin extras de recordatorios → las alarmas 24h/2h en Android solo
  las garantiza el push propio). Decisiones: jerarquía Android push-first, intent
  con dos variantes detrás de `ANDROID_CALENDAR_INTENT_MODE` + override QA `?ci=`,
  gate de UA Chromium-sin-WebView, tracking del intento audit-only (NO cobertura),
  `.ics` terciario en Android. iOS y desktop sin cambios. Comienza implementación.
- 2026-06-12 — **FASE 12 implementada completa.**
  Librerías: `android-calendar-intent.ts` (builder puro de las variantes `data` y
  `type`, encoding estricto con tests de round-trip que cubren `;`/`=`/saltos/tildes
  y fallback completamente encodeado) y `supportsAndroidCalendarIntent` en
  `device.ts` (acepta Chrome/Samsung Internet/Custom Tabs; rechaza WebView `wv`,
  Instagram in-app, Firefox, no-Android — con tests de UA reales).
  Server: `/turno/[token]` resuelve `?ci` > `ANDROID_CALENDAR_INTENT_MODE` > off,
  aplica el gate de UA (salvo override de QA) y pasa `androidCalendarIntent`;
  `POST calendario-intent` registra el intento SOLO en audit (204 siempre, valida
  token + turno vigente, DEMO no-op); `ir/google` acepta `?source=` whitelisteado
  y lo suma al audit (`android_native_fallback`).
  UI `/turno/[token]`: en Android el push es CTA primario ("Activar avisos en este
  teléfono", copy por proximidad 24h+2h / 2h / antes del turno), el calendario pasa
  a botón secundario (salvo "Actualizar calendario" tras reprogramación, que sigue
  primario), la opción intent va primera con beacon best-effort
  (sendBeacon→fetch keepalive), Google visible como escape, `.ics` demovido a link
  terciario "Descargar archivo de calendario (.ics)", fine print honesto (sin
  prometer alarmas del evento en Android). iOS/desktop/unknown sin cambios; copy
  referenciado en Configuración → Comunicación actualizado.
  Verificación: 139 tests unitarios pasando (12 nuevos), `svelte-check` 0 errores,
  y SSR manual en DEMO_MODE (curl): intent href bien formado en ambas variantes con
  UA Android, `?ci=off`/default sin intent, desktop ignora `?ci`, beacon 204,
  `ir/google?source=…` 302 a Google, fine print y `.ics` terciario presentes.
  PENDIENTE (manual): matriz de dispositivos reales con `?ci=data` y `?ci=type`
  (Samsung/Xiaomi/Pixel, Chrome/Samsung Internet/WhatsApp) y, según resultado,
  fijar `ANDROID_CALENDAR_INTENT_MODE` en Netlify (default actual: off, Android
  queda push-first + Google, sin pérdida respecto de hoy).

### Pendiente de rollout (manual, fuera del repo)

1. ~~`supabase db push` al remoto~~ **HECHO 2026-06-11.** La app daba 500 contra el
   remoto (42703: columnas faltantes). Había 9 migraciones sin registrar en la
   historia remota: las 8 anteriores ya estaban aplicadas a mano por el SQL Editor
   (verificado por REST: tablas + RPCs presentes; re-pushearlas era DESTRUCTIVO —
   `delete from availability_rules`, `delete from professional_users`). Se hizo
   `supabase migration repair --status applied` de esas 8 y `supabase db push`
   aplicó solo `20260611120000`. Verificado post-aplicación: columnas nuevas OK,
   `push_subscriptions` responde a service role y da 42501 a anon, RPCs
   `record_calendar_action`/`claim_due_push_reminders` funcionan y anon no puede
   ejecutarlas. La historia de migraciones remota quedó consistente para futuros
   `db push`.
2. Netlify env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
   `PUBLIC_VAPID_PUBLIC_KEY` (generar con `npx web-push generate-vapid-keys`).
   Verificar `PUBLIC_SITE_URL` (el UID del ICS depende de esto).
3. Cron externo cada ~10 min a `POST /internal/jobs/send-push-reminders` con
   `INTERNAL_JOB_SECRET` (mismo mecanismo que los jobs de dispatches).
4. Checklist staging en dispositivos reales (matriz de QA de Fase 10): reservar →
   ICS en iPhone y Android físicos → reprogramar → verificar SEQUENCE y banner →
   cancelar → verificar ICS CANCEL.
5. Decisión documentada: la pipeline Meta queda dormida; Recordatorios es el camino
   operativo.
