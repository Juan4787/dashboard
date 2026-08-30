# Auditoría final pre lanzamiento

> Documento operativo de certificación. Este archivo conserva íntegramente el plan de auditoría y debe utilizarse como registro vivo durante su ejecución.
>
> Regla de uso: marcar una casilla únicamente cuando exista evidencia verificable y enlazada. Si una casilla no aplica, registrar por qué, quién lo aprobó y qué riesgo residual queda; no eliminarla ni omitirla.

## Control de ejecución

- [x] Fecha de inicio: 2026-08-30 (America/Argentina/Buenos_Aires).

- [x] Responsable: Codex, ejecución automatizada y revisión de evidencia; quedan pendientes las pruebas que requieren personas, dispositivos o proveedores no configurados.

- [x] SHA candidato: `e3887e414a88933355a57442082bef14deb89e5c` (`HEAD` y `origin/main`).

- [x] Versión Cloudflare: `97f5d35f-c20e-4d4e-9ee9-ffa122f2e553`, número 28, 100 %, creada 2026-08-28T15:43:42.950Z; sin tag ni mensaje.

- [x] Dominio de producción: `https://app.cita-suite.workers.dev` (dominio workers.dev elegido; el flujo público de prueba también conserva el dominio histórico de Netlify como fixture externo y no se tomó como producción).

- [x] Proyecto Supabase: `yjzferwuzbtgpmdnzlcb` (URL remota verificada sin exponer claves).

- [x] Resultado final: **NO-GO**. La corrida inicial encontró fallos E2E reproducibles del arnés y 15 vulnerabilidades de auditoría completa (estas últimas quedaron corregidas en el candidato remediado); persisten falta de correlación Git↔deployment, ausencia de observabilidad/scheduler demostrados, y recuperación/UX humana/proveedores aún no certificados.

- [x] Enlace al informe y artefactos: este archivo; resultados Playwright en [apps/web/test-results](</home/usuario/CascadeProjects/Base de Datos Sabrina/apps/web/test-results) y [apps/web/output/playwright](</home/usuario/CascadeProjects/Base de Datos Sabrina/apps/web/output/playwright). Los artefactos contienen capturas/traces de fallos y no se consideran evidencia de aprobación.

## Alcance y principio de aceptación

La UX queda como un criterio de aprobación independiente y con el mismo peso que la integridad de datos. Una acción técnicamente correcta pero confusa, lenta, ambigua o peligrosa será un fallo de lanzamiento.

Este plan fue construido después de auditar el código actual, sus rutas, acciones de servidor, RPC, políticas, integraciones, E2E existente y el deployment de Cloudflare.

Al elaborar el contenido original de este plan no se modificó código ni se ejecutó todavía la batería de pruebas; fue una auditoría de lectura y planificación. La creación de este documento es el primer cambio solicitado expresamente para conservarla y ejecutarla.

## Estado real encontrado al elaborar el plan

- [x] Confirmar nuevamente que main y origin/main coinciden en el SHA candidato. Coinciden en `e3887e414a88933355a57442082bef14deb89e5c` al 2026-08-30; el texto histórico `6914543` se conserva como antecedente.

- [ ] Confirmar que la certificación se hace desde un checkout aislado y limpio. Al elaborar este plan el checkout no estaba limpio: había una modificación del usuario en Tailwind y artefactos de Playwright sin versionar. El código probado debe ser exactamente el desplegado.

- [x] Recontar y registrar los archivos de entrada de rutas y endpoints. Hay 171 archivos bajo `apps/web/src/routes` al 2026-08-30; el texto histórico de 127 se conserva.

- [x] Recontar y registrar la suite E2E. Hay 13 specs y 27 pruebas; se observaron 20 lugares con skip condicional. La ejecución Cloudflare resultó 19 passed, 2 failed y 6 skipped; la local 18 passed, 4 failed y 5 skipped.

- [x] Mantener Playwright limitado a un worker y sin paralelismo en [playwright.config.ts](</home/usuario/CascadeProjects/Base de Datos Sabrina/apps/web/playwright.config.ts:3>), apropiado para esta PC. Se ejecutó con `workers=1`; la corrida certificadora Cloudflare fijó además `retries=0`.

- [x] Confirmar que Cloudflare sigue usando `nodejs_compat`, assets estáticos `ASSETS`, `keep_vars: true` y placement hacia `aws:sa-east-1` en [wrangler.jsonc](</home/usuario/CascadeProjects/Base de Datos Sabrina/apps/web/wrangler.jsonc:1>); `wrangler versions view` confirmó placement targeted y target `aws:sa-east-1`.

- [ ] Correlacionar el deployment activo con Git. El deployment observado el 27 de agosto de 2026 era f360495e-b23d-4fbf-8fc9-7a0b77e937af al 100%, pero aparecía sin tag, mensaje ni relación comprobable con el commit 6914543. Eso impide asegurar qué código exacto está atendiendo producción.

- [x] Verificar los handlers efectivos del deployment. `wrangler versions view` declaró sólo el handler `fetch`.

- [ ] Identificar y demostrar qué scheduler externo llama los cuatro jobs internos, con su frecuencia y última ejecución correcta. Cloudflare no los está programando por sí solo mientras sólo sean endpoints HTTP.

- [ ] Declarar y verificar observabilidad y scheduling explícitos. `wrangler.jsonc` y la versión activa no declaran `observability` ni `triggers.crons`; quedan sin demostrar Workers Logs/scheduler y el riesgo bloquea GO.

- [ ] Eliminar el riesgo de URLs del hosting anterior. Sigue existiendo un fallback a Netlify en [constants.ts](</home/usuario/CascadeProjects/Base de Datos Sabrina/apps/web/src/lib/constants.ts:30>) y también en .env.example. Aunque producción tenga un binding PUBLIC_SITE_URL, comprobar que absolutamente todos los enlaces reales usan el dominio Cloudflare.

- [x] Inventariar los nombres de secretos/bindings efectivos. `wrangler versions view` registró 28 bindings/nombres de secreto sin imprimir valores; faltan bindings opcionales de Turnstile y credenciales completas de WhatsApp.

- [ ] Decidir explícitamente si Turnstile, Google Calendar administrado y envío automático de WhatsApp están habilitados o intencionalmente deshabilitados. En el deployment observado no aparecían algunos de esos bindings opcionales; un fallback silencioso no es aceptable.

- [x] Conservar una prueba específica de incompatibilidades del runtime Cloudflare. La prueba independiente del Worker completó upload, `/complete`, descarga validada, visor `blob:`, papelera y restauración; registró `ready/ok`, cinco eventos de auditoría y sólo abortos esperados de `AbortController`.

- [ ] Ejecutar la revisión oficial de calidad de Mercado Pago antes del lanzamiento. No pudo ejecutarse al elaborar este plan porque el conector oficial requerido no estaba disponible. El análisis estático forma parte de este documento, pero no reemplaza esa checklist en vivo.

## Regla fundamental

Ningún resultado aislado equivale a “producto validado”. La aprobación requiere que pasen todos estos gates. Si falla uno, es NO-GO.

- [ ] **G0 — Trazabilidad:** commit, migraciones, artefacto y versión Cloudflare identificados inequívocamente. **Bloqueado:** la versión activa `97f5d35f-c20e-4d4e-9ee9-ffa122f2e553` no tiene tag/mensaje ni correlación demostrada con `e3887e4`; además sus assets no coinciden con el build local candidato.

- [ ] **G1 — Recuperación:** backup restaurado realmente en un entorno aislado. **Bloqueado:** no se ejecutó backup/restore aislado.

- [x] **G2 — Código:** tipos, unitarios, integración, dependencias y build Cloudflare verdes para el candidato remediado: `pnpm check` sin diagnósticos, Vitest 106/813, cliente 7/71, pgTAP/concurrencia verdes, `pnpm audit --audit-level=high` sin vulnerabilidades conocidas y build Cloudflare correcto. La corrida inicial había reportado 15 vulnerabilidades transitivas; fueron corregidas con overrides compatibles con Node 20. Este aprobado sólo cubre el candidato local y no sustituye G0/G1/G4/G6/G7/G8/G9.

- [ ] **G3 — Datos:** RPC, RLS, roles, concurrencia e invariantes verdes. **Parcial:** pgTAP y concurrencia pasaron; no se completó la matriz E2E de todos los roles/tenants ni el backup restaurado.

- [ ] **G4 — Funcional:** todos los recorridos E2E completos, sin skips inesperados. **Bloqueado:** Cloudflare 19/2/6 y local 18/4/5 (passed/failed/skipped); hay dos fallos reproducibles del arnés `patient_mode`.

- [ ] **G5 — UX:** tareas reales completadas correctamente por usuarios representativos. **Bloqueado:** sólo automatización; faltan participantes, accesibilidad formal, dispositivos y métricas SEQ/SUS.

- [ ] **G6 — Cloudflare:** runtime, caché, placement, límites, logs, jobs y rollback verificados. **Bloqueado:** no hay observabilidad/cron declarados, límites p99 ni rollback real; además hay header de caché residual Netlify.

- [ ] **G7 — Proveedores:** Supabase, Google, Meta, push y Mercado Pago verificados. **Bloqueado:** revisión oficial Mercado Pago no disponible, Google real/WhatsApp/Turnstile/VAPID administrado sin credenciales completas y sin callbacks reales.

- [ ] **G8 — Producción:** suite segura ejecutada contra el dominio real y la versión exacta. **Bloqueado:** dominio real probado, pero no versión exacta correlacionada; E2E tiene fallos/skips.

- [ ] **G9 — Operación:** alertas, soporte, rollback, auditoría e incidentes listos. **Bloqueado:** no se demostraron logs/alertas/scheduler/rollback ni runbook operativo completo.

## Contrato obligatorio de cada caso

Cada prueba, incluso las aparentemente simples, debe comprobar:

- [ ] Estado inicial, tenant, usuario, rol, versión, dispositivo, red y hora.

- [ ] Resultado visible: texto, botones, foco, contexto y siguiente acción.

- [ ] Respuesta HTTP: método, estado, redirect, caché y ausencia de respuestas inesperadas.

- [ ] Estado persistido: relectura independiente desde base de datos; no confiar sólo en la UI.

- [ ] Efectos secundarios: storage, auditoría, outbox, push, calendario, WhatsApp o pago.

- [ ] Seguridad: tenant correcto, actor correcto y ausencia de acceso lateral.

- [ ] Observabilidad: sin errores JavaScript, requests fallidos, excepciones Worker ni datos sensibles en logs.

- [ ] Idempotencia: recargar, reenviar, hacer doble clic o perder la respuesta no debe duplicar nada.

- [ ] Limpieza exacta por IDs registrados en un manifiesto; nunca limpiar producción por prefijos amplios.

## Datos de prueba obligatorios

Crear fixtures determinísticos y versionados:

- [ ] Consultorio A activo con owner, admin, recepción, profesional vinculado, profesional no vinculado y readonly.

- [ ] Consultorio B con datos de nombres y horarios similares para probar aislamiento entre tenants.

- [ ] Consultorios separados en estado activo, gracia, restringido, archivado, pausa manual y acceso permanente.

- [ ] Usuario maestro y concesión de asistencia activa, expirada y revocada.

- [ ] Paciente con nombre normal.

- [ ] Paciente con acentos.

- [ ] Paciente con apóstrofes.

- [ ] Paciente con espacios duplicados.

- [ ] Paciente con emoji y Unicode.

- [ ] Pacientes que demuestren que n y ñ son identidades distintas.

- [ ] Pacientes con el mismo nombre y teléfono.

- [ ] Pacientes con el mismo teléfono y nombres distintos.

- [ ] Pacientes con el mismo nombre y teléfonos distintos.

- [ ] DNI repetido dentro del consultorio.

- [ ] El mismo DNI en otro consultorio.

- [ ] Paciente sin teléfono.

- [ ] Paciente con teléfono válido.

- [ ] Paciente con teléfono incompleto.

- [ ] Paciente con teléfono inválido.

- [ ] Paciente activo.

- [ ] Paciente archivado.

- [ ] Paciente bloqueado.

- [ ] Pacientes con distintos profesionales vinculados.

- [ ] Paciente con más de 30 entradas clínicas.

- [ ] Paciente con más de una página de radiografías.

- [ ] Servicios individuales y conjuntos.

- [ ] Duraciones y buffers extremos.

- [ ] Horarios partidos.

- [ ] Excepciones de disponibilidad.

- [ ] Turnos futuros.

- [ ] Turnos de hoy.

- [ ] Turnos de mañana.

- [ ] Turnos de pasado reciente.

- [ ] Turnos pasados fuera del corte.

- [ ] Turnos cancelados.

- [ ] Turnos confirmados.

- [ ] Turnos reservados.

- [ ] Turnos con reprogramación solicitada.

- [ ] Archivo JPG válido.

- [ ] Archivo PNG válido.

- [ ] Archivo corrupto.

- [ ] Archivo polyglot.

- [ ] Archivo con MIME falso.

- [ ] Archivo de cero bytes.

- [ ] Archivo de 25 MiB exactos.

- [ ] Archivo de 25 MiB + 1 byte.

- [ ] Suscripciones push por dispositivos distintos.

- [ ] Tokens públicos rotados.

- [ ] Calendarios conectados y desconectados.

- [ ] Fixtures de pago exclusivamente controlados.

- [ ] En producción, usar únicamente un consultorio sintético aislado y datos ficticios. Nunca usar historias clínicas reales.

## Orden de ejecución literal

### 1. Congelar el candidato

- [ ] Crear un checkout limpio del SHA candidato.

- [x] Registrar el SHA Git. `e3887e414a88933355a57442082bef14deb89e5c`.

- [x] Registrar el lockfile. SHA-256 de `pnpm-lock.yaml` en el registro inicial: `33b9c14bb173713e2551917ced15de99d99c3b48fdaa456a4f7a0893696af5c7`. Tras los overrides de seguridad autorizados, el candidato remediado queda con SHA-256 `6080bd286e8e5264e818b4ff351db17648654ba8214940b06fb77c6062df850e`.

- [x] Registrar la lista y checksum de migraciones. 74 archivos; manifiesto SHA-256 `67a5b72c0fcb27c59857a6c47dd93499908d6440812a7e099a5bc00a83674162`.

- [x] Registrar las versiones de Node, pnpm, Supabase CLI, Wrangler y Playwright. Node `v20.19.3`, pnpm `10.13.1`, Supabase CLI `2.115.0`, Wrangler `4.86.0`, Playwright `1.60.0`.

- [x] Registrar la fecha de compatibilidad Cloudflare. `2026-05-03`.

- [ ] Registrar el plan real de Cloudflare y los límites aplicables.

- [x] Construir una sola vez el artefacto candidato. `pnpm build:cloudflare` terminó correctamente; SHA del Worker local construido `cf4056f946ba2822fb93035da445ea2b74c918e9bbbb7d646dffcc8db657d484`.

- [ ] Subirlo como versión Cloudflare con tag o mensaje que contenga el SHA.

- [ ] Mantenerlo inicialmente en 0% de tráfico.

- [x] Registrar un manifiesto de nombres esperados de bindings y funciones habilitadas. Se comparó con la vista de versión Cloudflare; sólo se registraron nombres, nunca valores.

### 2. Validación local secuencial

Ejecutar, en este orden y con la PC sin otras cargas pesadas:

- [x] pnpm install --frozen-lockfile. Lockfile al día; pnpm informó scripts de build ignorados para `esbuild`, `sharp` y `workerd` por la política del runner (riesgo residual).

- [x] pnpm check. `svelte-check found 0 errors and 0 warnings`; shared TypeScript correcto.

- [x] pnpm --filter web exec vitest run --maxWorkers=1. 105 archivos, 810 tests passed.

- [x] pnpm --filter web run test:client -- --maxWorkers=1. 7 archivos, 71 tests passed.

- [x] pnpm supabase:start. Stack local arrancado explícitamente; `DB_URL`/`API_URL` reportados por el CLI y contenedores disponibles.

- [x] pnpm supabase:db:reset. El primer intento quedó bloqueado por una etiqueta de imagen de Storage no disponible; se fijó el cache local a la imagen disponible y el segundo reset aplicó las 74 migraciones y seed correctamente.

- [x] pnpm exec supabase test db. La ejecución literal contra el stack local terminó con 18 archivos/tests de pgTAP pasados (también se había confirmado antes con `--local`).

- [x] pnpm build:cloudflare. SSR/client y adapter Cloudflare terminaron correctamente (`built in 28.96s`).

- [x] pnpm --filter web exec wrangler deploy --dry-run. 112 assets leídos; 3942 KiB total, 805.97 KiB gzip; binding `ASSETS` presente.

- [x] pnpm audit --prod --audit-level=high. Sin vulnerabilidades conocidas de producción.

- [x] pnpm audit --audit-level=high. La repetición posterior a la remediación de transitivas terminó con `No known vulnerabilities found`; la corrida histórica fallida queda conservada en el registro anterior.

- [x] Ejecutar, uno por uno, los scripts de concurrencia de `supabase/tests`. Pasaron seis scripts: asociación por email, límite clínico de uploads, consistencia de exportación, lock global de exportación, idempotencia de identidad/paciente y cupo de reserva pública; además se ejecutó resolución pública de pacientes.

- [x] Confirmar que no se usó `source .env`. Las variables se cargaron mediante parser efímero/CLI y nunca se imprimieron secretos.

- [ ] Crear y ejecutar pruebas dentro del runtime Workers además de los Vitest actuales. No existe `createTestHarness()` ni integración Vitest de Workers en este repo; se ejecutó una prueba independiente contra el Worker productivo real para radiografías, pero no sustituye este harness.

### 3. Base de datos y recuperación

Antes de cualquier E2E:

- [ ] Comparar migraciones locales, staging y producción.

- [x] Ejecutar los 17 pgTAP actuales. La suite actual reportó 18 archivos/tests y todos pasaron.

- [x] Ejecutar concurrencia de asociación por email. Script secuencial pasó con exactamente una invitación pendiente.

- [x] Ejecutar concurrencia de identidad de pacientes. Script pasó con un paciente/turno e idempotencia en replay.

- [x] Ejecutar concurrencia de cupo de reserva pública. Script pasó con una creación y 4/4 rechazos.

- [x] Ejecutar concurrencia de límite de uploads. Script pasó con máximo atómico de 3 pendientes.

- [ ] Hacer un backup completo de datos, autenticación necesaria, metadata y Storage.

- [ ] Restaurarlo en otro proyecto aislado.

- [ ] Comparar conteos por tabla, relaciones, tokens, roles, hashes y checksums de radiografías.

- [ ] Abrir desde la aplicación restaurada una ficha.

- [ ] Abrir desde la aplicación restaurada una entrada clínica.

- [ ] Abrir desde la aplicación restaurada un turno.

- [ ] Abrir desde la aplicación restaurada una radiografía.

- [ ] Medir RPO y RTO reales.

- [ ] Confirmar que el backup es restaurable. Sin restauración demostrada, el producto no debe lanzarse. El texto legal que diga que no hay recuperación garantizada no sustituye una estrategia operativa en un sistema sanitario.

### 4. Staging idéntico a producción

Staging debe usar:

- [ ] Adaptador Cloudflare, no Vite preview.

- [ ] Misma fecha de compatibilidad.

- [ ] Mismos flags.

- [ ] Mismo placement.

- [ ] Mismas rutas.

- [ ] Mismos headers.

- [ ] Misma caché.

- [ ] Mismo plan de Worker.

- [ ] Proyecto Supabase separado pero con el mismo esquema y políticas.

- [ ] Sandboxes reales de proveedores.

- [ ] Dominio HTTPS.

- [ ] Workers Logs habilitados al 100% durante la certificación.

- [ ] Ejecutar toda la matriz funcional en Chromium con retries=0.

- [ ] Ejecutar toda la matriz funcional en Firefox con retries=0.

- [ ] Ejecutar toda la matriz funcional en WebKit con retries=0.

- [ ] Usar los reintentos sólo después para diagnosticar; no convierten un resultado en aprobado.

## Matriz funcional exhaustiva

### A. Autenticación, registro y sesión

- [ ] Redirección correcta de anónimo para cada ruta privada y endpoint directo.

- [x] Login válido. E2E Cloudflare con `E2E_EMAIL`/`E2E_PASSWORD` pasó el flujo base de login y navegación; no se imprimieron credenciales.

- [ ] Login con email con mayúsculas y espacios.

- [ ] Login con contraseña inválida.

- [ ] Login con campos vacíos.

- [ ] Login con usuario inexistente.

- [ ] Login con Supabase Auth caído.

- [ ] Rate limit verdadero de login: debe bloquear y explicar humanamente cuándo intentar otra vez.

- [ ] Caída interna del verificador de rate limit: login debe seguir la política fail-open actual sin confundirla con un límite real.

- [ ] Registro válido.

- [ ] Registro con contraseña débil.

- [ ] Registro con confirmación distinta.

- [ ] Registro con términos no aceptados.

- [ ] Registro de cuenta existente.

- [ ] Registro con doble envío.

- [ ] Google login. En Cloudflare sólo se verificó el inicio de OAuth hasta `accounts.google.com`; el retorno final a Cloudflare queda pendiente de credenciales Google reales.

- [ ] Google registro. En Cloudflare sólo se verificó el inicio de OAuth con términos aceptados; no se completó una cuenta real porque no hay credenciales Google autorizadas.

- [ ] Google registro con aceptación de términos.

- [ ] Google registro sin aceptación de términos.

- [ ] Cancelación del usuario durante OAuth.

- [ ] Callback OAuth sin código.

- [ ] Código OAuth vencido.

- [ ] State OAuth inválido.

- [ ] PKCE correcto.

- [ ] Popup o navegador bloqueado por Google.

- [ ] URL de retorno correcta.

- [ ] Prevención de open redirect en todos los callbacks.

- [ ] Recuperación de contraseña sin revelar si un email existe.

- [ ] Enlace de recuperación válido.

- [ ] Enlace de recuperación vencido.

- [ ] Enlace de recuperación reutilizado.

- [ ] Cambio de contraseña concurrente.

- [ ] Sesión expirada al navegar.

- [ ] Sesión expirada en mitad de cada mutación crítica.

- [ ] Refresh de token en Cloudflare.

- [ ] Sesión en varias pestañas.

- [ ] Logout en una pestaña reflejado en las demás.

- [ ] Revocación remota.

- [ ] Sesiones cerradas por maestro.

- [ ] Cookies Secure.

- [ ] Cookies HttpOnly.

- [ ] Cookies SameSite.

- [ ] Dominio de cookies.

- [ ] Path de cookies.

- [ ] Caducidad de cookies.

- [ ] Ausencia de tokens en URLs.

- [ ] Logout por GET: comprobar que prefetch no cierre una sesión accidentalmente.

- [ ] Logout por GET: comprobar que un crawler no cierre una sesión accidentalmente.

- [ ] Logout por GET: comprobar que una imagen externa no cierre una sesión accidentalmente.

- [ ] Logout por GET: comprobar que una navegación cross-site no cierre una sesión accidentalmente.

- [ ] Primera sesión creando consultorio con dos pestañas simultáneas: nunca deben aparecer dos consultorios.

- [ ] Primera sesión creando consultorio con respuesta perdida después del commit: relectura correcta y sin duplicado.

- [ ] Primera sesión creando consultorio con caída del rate limiter: estado humano y política correcta.

- [ ] Usuario sin membresía.

- [ ] Usuario con una membresía.

- [ ] Usuario con varias membresías.

- [ ] Usuario cuya membresía activa fue eliminada.

### B. Multi-tenant, roles y asistencia

Para cada ruta, acción de formulario, endpoint y RPC, ejecutar toda la matriz siguiente:

- [ ] Anónimo por UI.

- [ ] Anónimo pegando la URL.

- [ ] Anónimo con request HTTP fabricado.

- [ ] Owner por UI.

- [ ] Owner pegando la URL.

- [ ] Owner con request HTTP fabricado.

- [ ] Admin por UI.

- [ ] Admin pegando la URL.

- [ ] Admin con request HTTP fabricado.

- [ ] Recepción por UI.

- [ ] Recepción pegando la URL.

- [ ] Recepción con request HTTP fabricado.

- [ ] Profesional vinculado por UI.

- [ ] Profesional vinculado pegando la URL.

- [ ] Profesional vinculado con request HTTP fabricado.

- [ ] Profesional no vinculado por UI.

- [ ] Profesional no vinculado pegando la URL.

- [ ] Profesional no vinculado con request HTTP fabricado.

- [ ] Readonly por UI.

- [ ] Readonly pegando la URL.

- [ ] Readonly con request HTTP fabricado.

- [ ] Maestro normal por UI.

- [ ] Maestro normal pegando la URL.

- [ ] Maestro normal con request HTTP fabricado.

- [ ] Maestro asistiendo temporalmente por UI.

- [ ] Maestro asistiendo temporalmente pegando la URL.

- [ ] Maestro asistiendo temporalmente con request HTTP fabricado.

Para cada identidad anterior:

- [ ] Usar un ID de otro consultorio.

- [ ] Usar una cookie de consultorio manipulada.

- [ ] Usar un cursor de paginación de otro usuario.

- [ ] Usar un cursor de paginación de otro tenant.

- [ ] Eliminar el registro entre carga y mutación.

- [ ] Archivar el registro entre carga y mutación.

Casos particulares:

- [ ] Recepción no debe descubrir imágenes clínicas.

- [ ] Profesional sólo accede a pacientes vinculados.

- [ ] Profesional no ve costos.

- [ ] Readonly no muta.

- [ ] Readonly no participa en seguimientos.

- [ ] Asistencia dura únicamente lo configurado.

- [ ] Asistencia expira.

- [ ] Asistencia puede revocarse inmediatamente.

- [ ] Asistencia no habilita suscripciones.

- [ ] El maestro no adquiere acceso clínico por conocer un ID.

- [ ] /administrativo permanece inaccesible para anónimo.

- [ ] /administrativo permanece inaccesible para owner.

- [ ] /administrativo permanece inaccesible para admin.

- [ ] /administrativo permanece inaccesible para recepción.

- [ ] /administrativo permanece inaccesible para profesional.

- [ ] /administrativo permanece inaccesible para readonly.

- [ ] /administrativo permanece inaccesible para maestro.

- [ ] Las acciones antiguas de /administrativo permanecen inaccesibles mediante POST directo para todos los roles.

### C. Acceso comercial y suscripción

- [ ] Transición activo → próximo a vencer.

- [ ] Transición próximo a vencer → gracia.

- [ ] Transición gracia → restringido.

- [ ] Transición restringido → archivado.

- [ ] Límites temporales exactos en cada transición.

- [ ] Pausa manual.

- [ ] Acceso permanente.

- [ ] Reactivación.

- [ ] Callback atrasado.

- [ ] Webhook atrasado.

En estado restringido:

- [ ] Conservar lectura permitida de pacientes existentes e historial.

- [ ] Permitir sólo las mutaciones clínicas explícitamente autorizadas.

- [ ] Bloquear nuevos pacientes.

- [ ] Bloquear nuevos turnos.

- [ ] Bloquear reservas públicas.

- [ ] Bloquear configuraciones no permitidas.

- [ ] Mostrar una explicación humana.

- [ ] Mostrar una salida válida.

- [ ] No borrar datos.

- [ ] No ocultar permanentemente datos.

En estado archivado:

- [ ] No exponer información clínica.

- [ ] No permitir acceso por endpoint directo.

- [ ] Conservar posibilidad administrativa de recuperación según contrato.

### D. Mercado Pago

Probar en sandbox:

- [ ] Owner permitido.

- [ ] Admin permitido.

- [ ] Recepción rechazada.

- [ ] Profesional rechazado.

- [ ] Readonly rechazado.

- [ ] Asistencia rechazada.

- [ ] Inicio de suscripción.

- [ ] Doble clic al iniciar suscripción.

- [ ] Dos pestañas iniciando suscripción.

- [ ] Reutilización de pending reciente.

- [ ] Cancelación de pending viejo.

- [ ] Varios pending: todos deben quedar neutralizados antes de generar otro checkout.

- [ ] Active impidiendo nueva autorización.

- [ ] Paused impidiendo nueva autorización.

- [ ] Retorno antes del webhook.

- [ ] Webhook antes del retorno.

- [ ] Retorno y webhook simultáneos.

- [ ] Webhook repetido.

- [ ] Webhook fuera de orden.

- [ ] Webhook con la respuesta del cliente perdida.

- [ ] Firma ausente.

- [ ] Firma inválida.

- [ ] Firma antigua.

- [ ] Request ID distinto.

- [ ] data.id manipulado.

- [ ] API de Mercado Pago con timeout.

- [ ] API de Mercado Pago con 401.

- [ ] API de Mercado Pago con 404.

- [ ] API de Mercado Pago con 429.

- [ ] API de Mercado Pago con 5xx.

- [ ] Pago autorizado.

- [ ] Pago rechazado.

- [ ] Suscripción pausada.

- [ ] Suscripción cancelada.

- [ ] Refund.

- [ ] Chargeback.

- [ ] Ledger idempotente: un pago concede crédito una sola vez.

- [ ] Reconciliación detectando estado perdido.

- [ ] Reconciliación detectando dos suscripciones activas.

- [ ] Reconciliación con negocio inexistente.

- [ ] Cancelación manteniendo el crédito ya pagado cuando corresponda.

- [ ] Kill-switch manual con prioridad sobre la automatización.

En producción:

- [ ] Realizar una única suscripción real controlada de importe mínimo.

- [ ] Comprobar su webhook.

- [ ] Comprobar el crédito concedido.

- [ ] Comprobar su cancelación.

- [ ] Comprobar su conciliación.

- [ ] Confirmar supervisión humana y rollback comercial preparado.

- [ ] Ejecutar la checklist oficial de calidad de Mercado Pago antes del GO. Esta revisión no quedó ejecutada al elaborar el plan por indisponibilidad del conector.

### E. Negocio, equipo, profesionales y disponibilidad

- [ ] Nombre de negocio válido.

- [ ] Nombre vacío.

- [ ] Nombre largo.

- [ ] Nombre con Unicode.

- [ ] Nombre con HTML.

- [ ] Slug válido.

- [ ] Slug vacío.

- [ ] Slug largo.

- [ ] Slug con Unicode.

- [ ] Slug con HTML.

- [ ] Industria válida e inválida.

- [ ] Dirección válida, vacía, larga, Unicode y HTML.

- [ ] Zona horaria válida e inválida.

- [ ] Logo HTTPS válido.

- [ ] Logo con javascript:.

- [ ] Logo con data:.

- [ ] Logo con HTTP.

- [ ] Logo con host no permitido o peligroso.

- [ ] Google Maps HTTPS válido.

- [ ] Google Maps con javascript:.

- [ ] Google Maps con data:.

- [ ] Google Maps con HTTP.

- [ ] Google Maps con host no permitido.

- [ ] Slug duplicado.

- [ ] Modificación concurrente del slug.

- [ ] Comportamiento de enlaces públicos anteriores después de cambiar slug.

- [ ] Flag de reserva pública.

- [ ] Flag de misma jornada.

- [ ] Anticipación mínima.

- [ ] Horizonte máximo.

- [ ] Política de cancelación.

- [ ] Añadir usuario existente.

- [ ] Añadir usuario pendiente.

- [ ] Dos invitaciones simultáneas para el mismo email.

- [ ] Email ya asociado a otro consultorio.

- [ ] Alta de profesional pendiente.

- [ ] Vinculación posterior sin duplicar perfil.

- [ ] Cambios entre todos los roles.

- [ ] Impedir eliminarse a sí mismo.

- [ ] Impedir eliminar al último owner.

- [ ] Revocar acceso inmediatamente.

- [ ] Revocar sesión inmediatamente.

- [ ] Crear perfil atendible para owner.

- [ ] Crear perfil atendible para admin.

- [ ] Servicios por defecto.

- [ ] Servicios personalizados.

- [ ] Duración mínima de 5 minutos.

- [ ] Duración máxima de 480 minutos.

- [ ] Duración fuera de rango.

- [ ] Buffer mínimo de 0.

- [ ] Buffer máximo de 480.

- [ ] Combinaciones de duración y buffers imposibles.

- [ ] Servicio archivado sin historia.

- [ ] Servicio archivado con historia.

- [ ] Asignación de servicios.

- [ ] Desasignación de servicios.

- [ ] Horario semanal vacío.

- [ ] Horario semanal completo.

- [ ] Horario semanal partido.

- [ ] Horarios adyacentes.

- [ ] Horarios solapados.

- [ ] Horario cruzando medianoche.

- [ ] Excepción de un día.

- [ ] Excepción de rango.

- [ ] Excepción de profesional.

- [ ] Excepción de consultorio completo.

- [ ] Dos administradores guardando simultáneamente.

- [ ] Borrador sin guardar.

- [ ] Borrador y refresh.

- [ ] Borrador y back.

- [ ] Borrador y cierre de pestaña.

- [ ] Borrador y cambio de profesional.

- [ ] Archivar profesional sin dependencias históricas.

- [ ] Archivar profesional con dependencias históricas.

- [ ] Restaurar profesional.

- [ ] Eliminar profesional sin dependencias históricas.

- [ ] Impedir eliminar profesional con dependencias históricas.

### F. Agenda, creación y gestión de turnos

- [ ] Vista diaria.

- [ ] Vista semanal.

- [ ] Navegar a Hoy.

- [ ] Navegar al día anterior.

- [ ] Navegar al día siguiente.

- [ ] Aplicar filtros.

- [ ] Buscar.

- [ ] Preservar query params.

- [ ] Zona horaria del consultorio distinta a la del dispositivo.

- [ ] Medianoche.

- [ ] Fin de mes.

- [ ] Fin de año.

- [ ] Año bisiesto.

- [ ] Cambio de horario de verano aunque Argentina no lo use.

- [x] Búsqueda incremental por nombre. La prueba UX de pacientes respondió al primer carácter y la prueba real de la cuenta confirmó render local inmediato.

- [ ] Búsqueda incremental con acentos.

- [x] Búsqueda incremental por teléfono. La matriz UX cubrió búsqueda/selección de fichas que comparten teléfono y conservó el ID elegido.

- [ ] Búsqueda con un carácter. La prueba clínica local observó 1 request para un carácter donde el test exige 0; aunque la UI muestra resultados, el contrato no está resuelto y este punto bloquea la aprobación.

- [x] Búsqueda con dos caracteres. La búsqueda de pacientes UX ejecutada con credenciales de prueba mantuvo resultados y contexto de navegación.

- [ ] Búsqueda con espacios.

- [ ] Búsqueda con texto pegado.

- [ ] Búsqueda durante composición del teclado móvil.

- [ ] Resultado local precargado frente a reconciliación del servidor.

- [ ] Turnos pasados dentro de los tres meses visibles.

- [ ] Turnos pasados fuera de los tres meses visibles.

- [ ] Límite de futuros activos.

Creación interna:

- [ ] Crear turno con paciente existente.

- [ ] Crear turno con paciente nuevo.

- [ ] Selección explícita entre pacientes duplicados.

- [ ] Crear turno sin teléfono.

- [ ] Crear turno con teléfono inválido.

- [ ] Corregir teléfono dentro del formulario.

- [ ] Aceptar continuar sin teléfono una única vez.

- [ ] Persistir la decisión de continuar sin teléfono.

- [ ] Turno individual.

- [ ] Turno conjunto.

- [ ] Profesionales repetidos.

- [ ] Profesionales incompatibles.

- [ ] Servicio no asignado.

- [ ] Servicio archivado.

- [ ] Servicio modificado mientras el formulario estaba abierto.

- [ ] Horario regular.

- [ ] Horario dentro de una pausa.

- [ ] Efecto de buffers.

- [ ] Horario dentro de una excepción.

- [ ] Aviso mínimo.

- [ ] Horizonte máximo.

- [ ] Turno exactamente adyacente.

- [ ] Turno realmente solapado.

- [ ] Dos recepcionistas tomando el mismo horario: sólo una debe ganar.

- [ ] Doble clic al crear turno.

- [ ] Back después de crear turno.

- [ ] Refresh durante la creación.

- [ ] Reenvío del mismo idempotency key.

- [ ] Pérdida de respuesta después del commit: relectura y navegación al turno ya creado, nunca duplicación.

Estados:

- [ ] Estado reserved.

- [ ] Estado confirmed.

- [ ] Estado cancelled.

- [ ] Estado reschedule_requested.

- [ ] Estado expirado derivado por hora.

- [ ] Sólo el paciente puede confirmar.

- [ ] Cancelado es terminal.

- [ ] Turno pasado no ofrece acciones inválidas.

- [ ] Motivo de cancelación auditado.

- [ ] Actor de cancelación auditado.

- [ ] Reprogramación conserva profesional.

- [ ] Reprogramación conserva servicio.

- [ ] Reprogramación conserva paciente.

- [ ] Reprogramación conserva contexto de agenda.

- [ ] Actualización correcta del evento Google.

- [ ] Borrado correcto del evento Google.

- [ ] Recreación correcta del evento Google.

### G. Reserva pública

- [ ] Slug inexistente.

- [ ] Consultorio con reserva deshabilitada.

- [ ] Consultorio restringido.

- [ ] Consultorio archivado.

- [x] Todos los pasos de reserva individual. En Cloudflare se recorrieron servicio → profesional → día → horario → datos → confirmación con una reserva sintética; POST de creación respondió 200 y la pantalla mostró el turno reservado.

- [ ] Todos los pasos de reserva conjunta.

- [ ] Browser back.

- [ ] Browser forward.

- [ ] Refresh durante la reserva.

- [ ] Slot que queda obsoleto mientras el usuario completa datos.

- [ ] Nombre con acentos.

- [ ] Nombre con espacios.

- [ ] Nombre con mayúsculas.

- [ ] Nombre con apóstrofes.

- [ ] Nombre con ñ.

- [ ] Reutilización únicamente de paciente activo con coincidencia exacta y no ambigua.

- [ ] Igual teléfono con nombres diferentes.

- [ ] Igual nombre con teléfonos diferentes.

- [ ] Paciente archivado.

- [ ] Paciente bloqueado.

- [x] Límite de cuatro turnos futuros considerando paciente resuelto y bucket antiabuso. La prueba de concurrencia de reserva pública pasó con el cupo exacto (una creación y 4/4 rechazos).

- [ ] Reintento idéntico antes del rate limit.

- [ ] Reintento idéntico después del rate limit.

- [x] Dos requests concurrentes al último cupo. La prueba de concurrencia de reserva pública pasó sin doble reserva.

- [ ] Cincuenta requests al mismo slot: exactamente un turno, sin pacientes huérfanos.

- [ ] IP real de Cloudflare.

- [ ] IPv6.

- [ ] NAT compartido.

- [ ] Headers de IP falsificados.

- [ ] Turnstile habilitado.

- [ ] Turnstile deshabilitado.

- [ ] Token Turnstile vencido.

- [ ] Token Turnstile duplicado.

- [ ] Error del servicio Turnstile.

- [ ] Claves Turnstile configuradas a medias.

- [ ] Hora del consultorio.

- [ ] Aviso mínimo.

- [ ] Misma jornada.

- [ ] Máximo de días.

- [ ] Si el slot desapareció, volver a disponibilidad conservando datos seguros y mostrando un resultado claro.

### H. Pacientes e identidad

- [ ] Alta válida.

- [ ] Cada validación individual del alta.

- [ ] DNI único dentro del tenant.

- [ ] El mismo DNI permitido en otro tenant.

- [ ] Nombre duplicado sin combinar fichas indebidamente.

- [ ] Teléfono duplicado sin combinar fichas indebidamente.

- [x] Buscar por primer carácter. La auditoría UX de pacientes comprobó resultado visible en menos de 500 ms de render local.

- [ ] Buscar con acento.

- [x] Buscar por teléfono parcial. Las pruebas de pacientes/turnos cubrieron teléfonos compartidos y selección inequívoca del paciente.

- [ ] Buscar con texto pegado.

- [ ] Paginación adelante.

- [ ] Paginación atrás.

- [ ] Cursor manipulado.

- [ ] Cursor vencido.

- [ ] Cursor de otra query.

- [ ] Cursor de otro tenant.

- [ ] Caché separada por usuario.

- [ ] Caché separada por tenant.

- [ ] Caché separada por rol.

- [ ] Caché separada por tab.

- [ ] Caché separada por consulta.

- [ ] Realtime actualizando sólo lo permitido.

- [ ] Dos pestañas editando la misma ficha.

- [ ] Edición de datos.

- [ ] Edición de perfil clínico.

- [ ] Edición de alergias.

- [ ] Edición de medicamentos.

- [ ] Edición de antecedentes.

- [ ] Edición de campos personalizados.

- [ ] HTML o XSS almacenado en cada campo libre.

- [ ] Preservación explícita de ?tab=datos.

- [ ] Preservación explícita de ?tab=historial.

- [ ] Auditoría de cambios con actor correcto.

- [ ] Auditoría de cambios con campo correcto.

- [ ] Auditoría de cambios con fecha correcta.

- [ ] Archivo global por manager.

- [ ] Archivo personal de profesional.

- [ ] Restauración.

- [ ] Eliminación denegada cuando existen dependencias.

- [ ] Reasignación de paciente invalida token viejo.

- [ ] Reasignación de paciente supersede mensajes.

- [ ] Reasignación de paciente supersede push.

- [ ] Reasignación de paciente supersede calendario.

- [ ] Reasignación de paciente deja auditoría exacta.

### I. Historia clínica

Probar cada tipo:

- [ ] Consulta.

- [ ] Diagnóstico.

- [ ] Tratamiento.

- [ ] Procedimiento.

- [ ] Evolución.

- [ ] Indicaciones.

- [ ] Nota interna.

Para cada tipo anterior:

- [ ] Descripción vacía.

- [ ] Descripción mínima.

- [ ] Descripción máxima.

- [ ] Descripción con Unicode.

- [ ] Descripción con contenido malicioso.

- [ ] Fecha pasada.

- [ ] Fecha de hoy.

- [ ] Fecha futura.

- [ ] Fecha inválida.

- [ ] Piezas dentales.

- [ ] Nota interna.

- [ ] Monto cero.

- [ ] Monto negativo.

- [ ] Monto decimal extremo.

- [ ] Monto con separador local.

- [ ] Visibilidad del costo por cada rol.

- [ ] Guardado exitoso.

- [ ] Relectura independiente.

- [ ] Doble clic.

- [ ] Timeout.

- [ ] Refresh.

- [ ] Navegación estancada.

- [ ] Exactamente una entrada después de perder la respuesta.

- [ ] Edición antes de locked_after.

- [ ] Edición después de locked_after.

- [ ] Dos profesionales editando simultáneamente.

- [ ] Paginación mayor a 30.

- [ ] Paciente archivado mientras el formulario está abierto.

- [ ] Paciente desvinculado mientras el formulario está abierto.

- [ ] Estado de error humano.

- [ ] Conservación del texto después del error.

- [ ] Acción clara para reintentar.

- [ ] Invariante crítica: nunca mostrar “guardado” antes de verificar persistencia.

### J. Radiografías y archivos clínicos

- [ ] Permiso de ver por cada rol y estado comercial.

- [ ] Permiso de subir por cada rol y estado comercial.

- [ ] Permiso de abrir original por cada rol y estado comercial.

- [ ] Permiso de acceder a papelera por cada rol y estado comercial.

- [ ] Permiso de restaurar por cada rol y estado comercial.

- [ ] JPG real.

- [x] PNG real. Upload de PNG sintético completó el flujo de radiografía en el Worker productivo.

- [ ] Extensión correcta con bytes falsos.

- [ ] MIME correcto con magic bytes falsos.

- [ ] Archivo polyglot.

- [ ] Archivo truncado.

- [ ] Decompression bomb.

- [ ] Metadatos enormes.

- [ ] Archivo de 1 byte.

- [ ] Archivo de 25 MiB exactos.

- [ ] Archivo de 25 MiB + 1.

- [ ] Nombre con Unicode.

- [ ] Nombre con path traversal.

- [ ] Nombre con barras.

- [ ] Nombre con longitud máxima.

- [ ] Fecha válida.

- [ ] Fecha inválida.

- [ ] Nota válida.

- [ ] Nota inválida.

- [ ] Generación del thumbnail.

- [ ] Tamaño del thumbnail.

- [ ] Interrupción antes del PUT.

- [ ] Interrupción durante el upload del original.

- [ ] Interrupción durante el upload del thumbnail.

- [ ] Interrupción antes de /complete.

- [ ] URL firmada vencida.

- [ ] URL firmada reutilizada.

- [ ] upsert=false: jamás sobrescribir otra imagen.

- [ ] Tres uploads pendientes.

- [ ] Dos requests intentando el cuarto upload simultáneamente.

- [x] Storage devolviendo 200. La subida y descarga firmada de la imagen sintética respondieron 200 en Cloudflare.

- [ ] Storage devolviendo 206.

- [ ] Storage devolviendo 302.

- [ ] Storage devolviendo 403.

- [ ] Storage devolviendo 404.

- [ ] Storage con timeout.

- [ ] Storage con cuerpo inesperado.

- [ ] Validación Range dentro del Worker real.

- [x] Validación de magic bytes dentro del Worker real. La prueba del Worker descargó y validó el PNG sintético antes de dejarlo `ready/ok`.

- [x] Validación de tamaño dentro del Worker real. La imagen sintética fue aceptada dentro del límite y quedó persistida como `ready/ok`.

- [x] Validación de checksum dentro del Worker real. La relectura independiente de la radiografía sintética reportó integridad `ok`.

- [x] Estado uploading → ready. `/complete` respondió 200 y la fila final quedó `ready`.

- [ ] Estado uploading → failed.

- [ ] Ausencia de uploads eternamente pendientes.

- [x] Apertura del original sólo después de acción explícita; nunca preload automático. La prueba productiva abrió el original mediante acción explícita y recibió un `blob:` sin exponer la URL firmada en la imagen.

- [ ] Thumbnail precargado sin bloquear la ficha.

- [ ] Cambio de paciente revoca blob URLs y aborta requests.

- [ ] Cambio de consultorio revoca blob URLs y aborta requests.

- [ ] Cambio de usuario revoca blob URLs y aborta requests.

- [ ] Logout revoca blob URLs y aborta requests.

- [ ] Zoom.

- [ ] Pan.

- [ ] Orientación.

- [ ] Pantalla pequeña.

- [ ] Memoria después de abrir muchas imágenes.

- [ ] URL original vence a los 60 segundos.

- [ ] URL original no es reutilizable por otro usuario.

- [ ] Trash idempotente.

- [ ] Restore idempotente.

- [ ] Trash rate-limited.

- [ ] Restore rate-limited.

- [x] Trash auditado. La relectura de auditoría registró `radiograph.trashed` con resultado exitoso.

- [x] Restore auditado. La relectura de auditoría registró `radiograph.restored` con resultado exitoso.

- [x] Integridad ok. La fila sintética final quedó `integrity_status=ok`.

- [ ] Integridad missing.

- [ ] Integridad checksum_mismatch.

- [ ] Ejecución comprobada del job SQL de integridad.

- [ ] Backup físico de originales.

- [ ] Backup físico de thumbnails.

- [ ] Restauración física de originales.

- [ ] Restauración física de thumbnails.

### K. Seguimientos y recordatorios

Seguimientos:

- [ ] Roles y alcance de pacientes.

- [ ] Crear seguimiento.

- [ ] Editar seguimiento.

- [ ] Completar seguimiento.

- [ ] Posponer a mañana.

- [ ] Posponer tres días.

- [ ] Posponer una semana.

- [ ] Posponer a fecha propia.

- [ ] Fecha según timezone del consultorio.

- [ ] Mensaje vacío.

- [ ] Mensaje de 500 caracteres.

- [ ] Mensaje de más de 500 caracteres.

- [ ] Profesional asignable.

- [ ] Profesional no asignable.

- [ ] Paciente archivado.

- [ ] Paciente desvinculado.

- [ ] Lista actual.

- [ ] Lista futura.

- [ ] Lista de importantes.

- [ ] Búsqueda.

- [ ] Contadores.

- [ ] Notificación de vencidos.

- [ ] Dismiss del aviso por fingerprint.

- [ ] Reaparición del aviso cuando cambia el conjunto.

- [ ] Modal no se cierra al hacer clic afuera.

- [ ] Modal se cierra con X.

- [ ] Modal se cierra con Escape.

- [ ] Foco atrapado en el modal.

- [ ] Foco restaurado al cerrar el modal.

Recordatorios de turnos:

- [ ] Turnos de hoy.

- [ ] Turnos de mañana.

- [ ] Sólo turnos activos.

- [ ] Sólo turnos futuros.

- [ ] Turno con teléfono.

- [ ] Turno sin teléfono.

- [ ] Turno con cobertura de calendario.

- [ ] Turno sin cobertura de calendario.

- [ ] Turno con cobertura push.

- [ ] Turno sin cobertura push.

- [ ] Turno con dispatch existente.

- [ ] Turno sin dispatch existente.

- [ ] Igualdad exacta entre contador de Agenda y sección Recordatorios.

- [ ] WhatsApp Web en PC.

- [ ] wa.me en Android.

- [ ] wa.me en iOS.

- [ ] Apertura registra whatsapp_reminder_opened_at.

- [ ] ?confirmar=1 evita marcado accidental.

- [ ] Dos empleados intentando marcar enviado simultáneamente.

### L. Portal público del turno, calendario, PDF y mapas

- [x] Token válido. El portal público de un turno sintético en Cloudflare respondió 200 y mostró sólo datos operativos mínimos.

- [ ] Token inexistente.

- [ ] Token rotado.

- [ ] Token vencido.

- [ ] Token de turno pasado.

- [x] Header `no-store`. PDF, ICS y reserva pública sintéticos respondieron con `cache-control: no-store`; el header residual `netlify-cdn-cache-control` observado en HTML queda como riesgo de limpieza de hosting anterior.

- [ ] Header Referrer-Policy.

- [ ] Confirmar.

- [ ] Cancelar.

- [ ] Solicitar reprogramación.

- [ ] Alias /confirmar.

- [ ] Alias /cancelar.

- [ ] Alias /reprogramar.

- [ ] Consultorio restringido.

- [ ] Turno terminal.

- [ ] Datos visibles mínimos.

- [ ] Ausencia de información clínica.

- [ ] ICS inline.

- [x] ICS descarga. Respondió 200, `text/calendar; charset=utf-8; method=PUBLISH`, `attachment`, `no-store` y 1046 bytes.

- [x] Zona horaria del ICS. La reserva mostró hora local del consultorio y los redirects generaron fechas UTC coherentes con `America/Argentina/Cordoba`.

- [ ] UID estable.

- [ ] Sequence.

- [ ] Cancelación en ICS.

- [ ] Alarma en ICS.

- [ ] Caracteres especiales en ICS.

- [x] Google Calendar en desktop. El endpoint de tracking respondió 302 a `calendar.google.com` con una URL de evento neutral.

- [ ] Google Calendar en Android.

- [ ] Google Calendar en iOS.

- [x] Outlook en desktop. El endpoint de tracking respondió 302 a `outlook.live.com`.

- [ ] Outlook en Android.

- [ ] Outlook en iOS.

- [x] Maps en desktop. El endpoint de tracking respondió 302 a `maps.app.goo.gl`.

- [ ] Maps en Android.

- [ ] Maps en iOS.

- [ ] Intent Android.

- [ ] Fallback del intent Android.

- [ ] Retorno a la página después del intent.

- [x] PDF válido. Respondió 200, `application/pdf`, `attachment`, `no-store` y 1529 bytes con firma `%PDF-1.7`.

- [ ] PDF imprimible.

- [ ] PDF sin información extra.

- [ ] PDF dentro del límite CPU y memoria Worker.

- [x] Crawler no marca calendario ofrecido. La revisión de la página por requests directos no ejecutó acciones; los side effects sólo ocurrieron al crear la reserva sintética mediante POST explícito.

- [x] Crawler no confirma. GET directo del portal no cambió el estado ni generó auditoría de confirmación.

- [x] Crawler no marca apertura. GET directo no abrió el visor ni generó un grant de imagen.

- [ ] Previsualizador social no marca calendario ofrecido.

- [ ] Previsualizador social no confirma.

- [ ] Previsualizador social no marca apertura.

### M. Google Calendar administrado

- [ ] Función deshabilitada: no mostrar CTA roto.

- [ ] Función habilitada con todos los secretos.

- [ ] OAuth aceptado.

- [ ] OAuth rechazado.

- [ ] State inválido.

- [ ] PKCE inválido.

- [ ] Callback duplicado.

- [ ] Refresh token vencido.

- [ ] Tokens cifrados en reposo.

- [ ] Crear evento.

- [ ] Actualizar evento.

- [ ] Borrar evento.

- [ ] Reprogramación mientras Google está caído.

- [ ] Cancelación mientras Google está caído.

- [ ] Cola.

- [ ] Retry.

- [ ] Reconciliación posterior.

- [ ] Evento privado.

- [ ] Evento neutral.

- [ ] Desconexión revocando acceso.

- [ ] Dos callbacks simultáneos.

### N. Push y service worker

Ejecutar en:

- [ ] Chrome Android.

- [ ] Samsung Internet.

- [ ] Chrome en Samsung.

- [ ] Firefox Android.

- [ ] Chrome desktop.

- [ ] Edge desktop.

- [ ] Safari en iPhone.

Casos:

- [ ] Dispositivo soportado.

- [ ] Dispositivo no soportado.

- [ ] En iOS, donde el código no ofrece push, mostrar una alternativa comprensible.

- [ ] Permiso concedido.

- [ ] Permiso rechazado.

- [ ] Permiso bloqueado.

- [ ] Permiso recuperado desde ajustes.

- [ ] Suscripción.

- [ ] Renovación de claves.

- [ ] Dos dispositivos del mismo paciente.

- [ ] Receipt de prueba.

- [ ] Recordatorio de 24 horas.

- [ ] Recordatorio de 2 horas.

- [ ] Reprogramación justo antes del envío.

- [ ] Cancelación justo antes del envío.

- [ ] Dedupe.

- [ ] Ejecución concurrente del job.

- [ ] Respuesta 410 elimina endpoint.

- [ ] Respuesta 429 conserva endpoint y reintenta.

- [ ] Respuesta 5xx conserva endpoint y reintenta.

- [ ] Click con la página cerrada.

- [ ] Click con la página abierta.

- [ ] Click con varias pestañas.

- [ ] Service worker viejo después de deploy.

- [ ] Sin PII sensible en título.

- [ ] Sin PII sensible en body.

- [ ] Sin PII sensible en URL.

- [ ] Sin PII sensible en logs.

### O. Reseñas de Google

- [ ] Configuración habilitada.

- [ ] Configuración deshabilitada.

- [ ] Todos los formatos Google permitidos.

- [ ] URLs de phishing similares.

- [ ] Turno elegible.

- [ ] Turno no elegible.

- [ ] Cooldown por paciente.

- [ ] Claim idempotente bajo concurrencia.

- [ ] Push exitoso.

- [ ] Push 410.

- [ ] Push con timeout.

- [ ] Push con respuesta desconocida.

- [ ] Redirect /r/[token] válido.

- [ ] Redirect /r/[token] usado.

- [ ] Redirect /r/[token] manipulado.

- [ ] Redirect /r/[token] con URL maliciosa almacenada.

- [ ] Click auditado sin revelar datos.

### P. WhatsApp, mensajería y webhooks

- [ ] GET de verificación con token válido.

- [ ] GET de verificación con token inválido.

- [ ] POST con firma válida.

- [ ] POST con firma inválida.

- [ ] POST con firma ausente.

- [ ] Cuerpo malformado.

- [ ] Cuerpo grande.

- [ ] Cuerpo duplicado.

- [ ] Cuerpo fuera de orden.

- [ ] Mensaje de número desconocido.

- [ ] Cuenta o teléfono de otro tenant.

- [ ] API Meta con 401.

- [ ] API Meta con 429.

- [ ] API Meta con 5xx.

- [ ] API Meta con timeout.

- [ ] Idempotencia de dispatch.

- [ ] Mensaje neutral.

- [ ] Enlaces Cloudflare correctos.

- [ ] Función automática deshabilitada: nunca enviar accidentalmente.

- [ ] Función automática habilitada: exigir WHATSAPP_APP_SECRET.

- [ ] Función automática habilitada: exigir access token.

- [ ] Función automática habilitada: exigir estado operativo.

- [ ] Rutas UI antiguas de mensajes no aparentan una función deshabilitada.

- [ ] Rutas UI antiguas de WhatsApp no aparentan una función deshabilitada.

### Q. Jobs internos

Endpoints:

- [ ] generate-reminder-dispatches.

- [ ] process-message-dispatches.

- [ ] send-push-reminders, incluida reseña y calendario.

- [ ] reconcile-mercadopago.

Para cada endpoint:

- [ ] Secret ausente.

- [ ] Secret incorrecto.

- [ ] Secret correcto.

- [ ] Método distinto de POST.

- [ ] Dos ejecuciones simultáneas.

- [ ] Repetición del mismo rango.

- [ ] Fallo parcial de una integración sin abortar las demás.

- [ ] Timeout.

- [ ] Retry.

- [ ] Backlog.

- [ ] Límite de lotes.

- [ ] Continuación del siguiente lote.

- [ ] Filas exactamente una vez.

- [ ] Métrica last_success_at.

- [ ] Métrica de duración.

- [ ] Métrica de procesados.

- [ ] Métrica de fallidos.

- [ ] Métrica de próxima ejecución.

- [ ] Simular una ejecución perdida.

- [ ] Recuperar backlog sin duplicar.

- [ ] Demostrar el scheduler real.

- [ ] Demostrar su cadencia.

- [ ] Demostrar sus últimas tres ejecuciones.

- [ ] Demostrar sus alertas.

La existencia del endpoint no cuenta. Hay que demostrar el scheduler real, su cadencia, sus últimas tres ejecuciones y sus alertas. Cloudflare sólo ejecuta Cron si existe handler scheduled y triggers configurados; los cambios pueden tardar hasta 15 minutos. Referencia: [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

## UX clínica y operativa

Esta fase no se automatiza completamente.

### Participantes

- [ ] Realizar la prueba con al menos 5 profesionales odontológicos.

- [ ] Realizar la prueba con al menos 5 personas de recepción o agenda.

- [ ] Realizar la prueba con al menos 5 owners o administradores.

- [ ] Incluir usuarios de distinta edad.

- [ ] Incluir usuarios de distinto nivel digital.

- [ ] Incluir usuarios con uso móvil.

- [ ] Incluir usuarios de distinto tamaño de consultorio.

- [ ] Confirmar que ninguno desarrolló el producto.

### Recorridos moderados obligatorios

- [ ] Abrir la jornada, entender la agenda de hoy y detectar recordatorios pendientes.

- [ ] Atender una llamada, encontrar al paciente correcto entre duplicados y crear un turno.

- [ ] Identificar al próximo paciente y llegar a su ficha sin dudas.

- [ ] Antes de atender, localizar alergias, medicamentos, antecedentes y última evolución.

- [ ] Registrar una entrada clínica ya redactada y verificar que quedó guardada.

- [ ] Abrir una radiografía existente y volver al contexto anterior.

- [ ] Reprogramar un turno y avisar por WhatsApp.

- [ ] Crear un seguimiento posterior a la consulta.

- [ ] Resolver una caída de red o sesión expirada sin perder información ni duplicar acciones.

- [ ] Completar el cierre del día con pendientes y recordatorios.

### Criterios UX de aprobación

- [ ] 100% de éxito sin ayuda al identificar paciente.

- [ ] 100% de éxito sin ayuda al crear o reprogramar turno.

- [ ] 100% de éxito sin ayuda al guardar historia.

- [ ] 100% de éxito sin ayuda al abrir radiografía.

- [ ] Cero selección del paciente equivocado.

- [ ] Cero selección de fecha equivocada.

- [ ] Cero selección de profesional equivocado.

- [ ] Cero selección de consultorio equivocado.

- [ ] Cero éxito falso.

- [ ] Cero duplicación por impaciencia.

- [ ] Abrir al próximo paciente en un máximo de 15 segundos.

- [ ] Encontrar un paciente existente en un máximo de 15 segundos.

- [ ] Crear un turno para paciente existente en un máximo de 90 segundos.

- [ ] Reprogramar y llegar al aviso en un máximo de 60 segundos.

- [ ] Guardar una entrada clínica ya redactada y verificarla en un máximo de 30 segundos.

- [ ] Abrir una radiografía conocida en un máximo de 20 segundos en banda ancha.

- [ ] SEQ mediana mínima de 6/7 en tareas críticas.

- [ ] SUS global mínimo de 80/100.

- [ ] Ningún problema UX crítico abierto.

- [ ] Ningún problema UX alto abierto.

### Auditoría de cada pantalla y estado

Revisar en desktop y móvil:

- [ ] Una única acción primaria dominante por área.

- [ ] Jerarquía visual clara.

- [ ] Orden de lectura claro.

- [ ] Identidad del paciente persistentemente visible durante acciones clínicas.

- [ ] Fecha inequívoca.

- [ ] Hora inequívoca.

- [ ] Timezone inequívoco.

- [ ] Profesional inequívoco.

- [ ] Estado inequívoco.

- [ ] Estados no comunicados sólo por color.

- [ ] Acciones terminales inválidas eliminadas, no simplemente deshabilitadas.

- [ ] Confirmaciones destructivas nombran el paciente o turno afectado.

- [ ] Confirmaciones destructivas explican la consecuencia.

- [ ] Estado loading.

- [ ] Estado vacío.

- [ ] Estado éxito.

- [ ] Estado error.

- [ ] Estado offline.

- [ ] Estado timeout.

- [ ] Estado disabled.

- [ ] Estado permiso insuficiente.

- [ ] Mensajes humanos con el problema exacto.

- [ ] Mensajes humanos con la próxima acción.

- [ ] Mensajes sin nombres de RPC.

- [ ] Mensajes sin UUID.

- [ ] Mensajes sin SQL.

- [ ] Mensajes sin PostgREST.

- [ ] Mensajes sin etiquetas HTTP.

- [ ] Mensajes sin códigos internos.

- [ ] Formularios conservan datos después de error.

- [ ] Foco en el primer error.

- [ ] Resumen de errores accesible.

- [ ] Doble clic bloqueado con feedback real, no sólo spinner infinito.

- [ ] Browser back preserva contexto seguro.

- [ ] Browser forward preserva contexto seguro.

- [ ] Refresh preserva contexto seguro.

- [ ] Modales con foco atrapado.

- [ ] Modales cierran con Escape.

- [ ] Modales cierran con X.

- [ ] Modales restauran foco.

- [ ] Inputs adecuados al teclado móvil.

- [ ] Inputs con autocompletado correcto.

- [ ] Inputs permiten pegado. Los formularios probados aceptaron `fill`/entrada de texto en los campos de reserva, login y búsqueda; el pegado físico en dispositivos reales queda pendiente.

- [ ] Targets táctiles cómodos.

- [ ] Nada cortado a 320 px.

- [ ] Nada cortado a 360 px.

- [ ] Nada cortado a 375 px.

- [x] Nada cortado a 390 px. E2E UX tomó una vista móvil de 390 px y verificó `scrollWidth` sin overflow horizontal en rutas de pacientes/radiografías.

- [ ] Nada cortado a 412 px.

- [ ] Zoom de navegador al 200%.

- [ ] Texto grande.

- [x] Sin scroll horizontal en las rutas móviles cubiertas por E2E; no se generaliza a todas las 171 rutas.

- [ ] Contraste conforme a WCAG 2.2 AA.

- [ ] Navegación por teclado conforme a WCAG 2.2 AA.

- [ ] Lector de pantalla conforme a WCAG 2.2 AA.

- [ ] Mensajes de estado conforme a [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/).

- [ ] Interrupción por llamada.

- [ ] Interrupción por cambio de pestaña.

- [ ] Interrupción por bloqueo del teléfono.

- [ ] Interrupción por conexión intermitente.

- [ ] Interrupción por reautenticación.

- [ ] Consistencia entre Agenda y Pacientes.

- [ ] Consistencia entre Pacientes y Turnos.

- [ ] Consistencia entre Turnos y Seguimientos.

- [ ] Consistencia entre Seguimientos y Recordatorios.

- [ ] No ocultar latencia con loaders.

- [ ] Medir escritura por separado.

- [ ] Medir recarga por separado.

- [ ] Medir navegación por separado.

## Cloudflare producción

### 1. Identidad del código

El candidato debe desplegarse con:

- [ ] SHA Git como tag o mensaje.

- [x] Version ID registrado. `97f5d35f-c20e-4d4e-9ee9-ffa122f2e553`, número 28, 100 %.

- [x] Checksums del artefacto. Se registraron SHA-256 del artefacto Worker local, lockfile, configuración Wrangler y manifiesto de migraciones.

- [x] Lista de migraciones. 74 archivos y manifiesto SHA-256 `67a5b72c0fcb27c59857a6c47dd93499908d6440812a7e099a5bc00a83674162`.

- [ ] Binding opcional de metadata de versión o header de diagnóstico no sensible.

- [ ] Usar una versión al 0% y el header oficial Cloudflare-Workers-Version-Overrides para dirigir Playwright al candidato sin exponer usuarios. Cloudflare permite probar así una versión con 0% de tráfico. Referencia: [Version overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/).

- [ ] Probar mezcla de versiones. Cloudflare advierte que requests consecutivos pueden llegar a versiones diferentes durante despliegues graduales. Referencia: [Gradual deployments](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/).

### 2. Bindings y dominio

Comprobar mediante comportamiento, sin imprimir valores:

- [x] Todas las claves Supabase apuntan al proyecto correcto. Preflight remoto consultó el proyecto `yjzferwuzbtgpmdnzlcb`; OAuth y reservas Cloudflare usaron ese mismo proyecto.

- [x] PUBLIC_SITE_URL es el dominio Cloudflare final en los enlaces observados. La reserva, portal, ICS/redirects y PDF se probaron en `app.cita-suite.workers.dev`; el valor secreto del binding no se imprimió.

- [x] DEMO_MODE no es true. El Worker mostró el negocio y catálogo productivos de prueba; las pruebas condicionadas a demo quedaron correctamente omitidas.

- [ ] Callback Supabase usa el dominio Cloudflare.

- [ ] Callback de reset usa el dominio Cloudflare.

- [ ] Callback de Google usa el dominio Cloudflare.

- [ ] Retorno de Mercado Pago usa el dominio Cloudflare.

- [ ] Webhook de Mercado Pago usa el dominio Cloudflare.

- [ ] Webhook de WhatsApp usa el dominio Cloudflare.

- [ ] ICS contiene el dominio Cloudflare cuando corresponde. El portal/redirects generados durante la reserva sintética conservaron el host Cloudflare, pero el cuerpo del ICS no se conservó antes del cleanup para verificarlo de forma independiente.

- [ ] PDF contiene el dominio Cloudflare cuando corresponde.

- [ ] WhatsApp contiene el dominio Cloudflare.

- [ ] Push contiene el dominio Cloudflare.

- [ ] Reseñas contienen el dominio Cloudflare.

- [ ] Ningún link nuevo contiene netlify.app.

- [ ] Ningún link nuevo contiene Vercel.

- [ ] Ningún link nuevo contiene localhost.

- [x] Ningún link nuevo contiene `workers.dev` si no es el dominio público elegido. El dominio elegido y probado es `app.cita-suite.workers.dev`.

- [ ] Un deploy posterior mantiene todos los bindings por keep_vars.

- [ ] Cada función opcional aparece habilitada o explícitamente deshabilitada.

### 3. Observabilidad

- [ ] Declarar observabilidad explícitamente en Wrangler.

- [ ] Habilitar sampling 100% durante la ventana. Workers Logs registra invocaciones, errores y excepciones cuando observabilidad está habilitada. Referencia: [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).

Por cada test capturar:

- [ ] Version ID.

- [ ] cf-ray.

- [ ] cf-placement.

- [ ] Request o correlation ID.

- [ ] Duración CPU.

- [ ] Wall time.

- [ ] Estado de invocación.

- [ ] Cero errores 1101.

- [ ] Cero errores 1102.

- [ ] Cero errores 1027.

- [ ] Cero uncaught exceptions.

- [ ] Cero 5xx inesperados.

### 4. Placement

- [x] La respuesta dinámica crítica muestra ejecución compatible con GRU, por ejemplo `remote-GRU`, mientras el ingress puede ser otro PoP. Las respuestas de reserva y radiografías observadas en la prueba productiva incluyeron `cf-placement: remote-GRU`; otras respuestas informativas devolvieron `remote-` sin región, por lo que no se generaliza el resultado. Referencia: [Cloudflare Placement](https://developers.cloudflare.com/workers/configuration/placement/).

Repetir y comprobar resultados y autorizaciones idénticos desde:

- [ ] Conexión fija argentina.

- [ ] Android por red móvil.

- [ ] iPhone por red móvil.

- [ ] VPN de Estados Unidos.

- [ ] VPN de Europa.

### 5. Caché y assets

Probar alternando dos usuarios y dos tenants:

- [ ] HTML autenticado: BYPASS, DYNAMIC o equivalente seguro; nunca HIT compartido.

- [ ] JSON autenticado: BYPASS, DYNAMIC o equivalente seguro; nunca HIT compartido.

- [ ] Página de token con política explícita y sin reutilización indebida.

- [x] PDF con política explícita y sin reutilización indebida. Respuesta 200 con `cache-control: no-store` y `content-disposition: attachment`.

- [x] ICS con política explícita y sin reutilización indebida. Respuesta 200 con `cache-control: no-store`, descarga adjunta y contenido neutral.

- [ ] URL firmada con política explícita y sin reutilización indebida.

- [x] `private` o `no-store` produce bypass en los endpoints críticos observados; queda pendiente verificar HIT/BYPASS desde dos usuarios/tenants con telemetría de caché explícita.

- [ ] No depender de no-cache solo, porque no es suficiente para bypass. Referencia: [Cloudflare Cache](https://developers.cloudflare.com/workers/cache/configuration/).

- [ ] Assets hasheados producen HIT correcto.

- [ ] Assets hasheados tienen MIME correcto.

- [ ] Chunks cargan correctamente.

- [ ] Después de deploy, una página vieja no solicita chunks ya eliminados.

- [ ] Service worker viejo se actualiza sin bucle.

- [ ] Rutas dinámicas no colisionan con archivos estáticos.

- [x] Revisar `run_worker_first`. `wrangler versions view` confirmó `raw_run_worker_first: false` y assets servidos directamente; queda documentado para evitar asumir ejecución Worker en archivos estáticos. Referencia: [Static asset binding](https://developers.cloudflare.com/workers/static-assets/binding/).

### 6. Runtime y límites

- [ ] Registrar el plan real. Cloudflare documenta actualmente, entre otras cosas, 128 MB por isolate y seis conexiones salientes simultáneas; el plan Free tiene 10 ms CPU por request y 100.000 requests por día. Referencia: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

Medir especialmente:

- [ ] SSR de Agenda.

- [ ] SSR de Pacientes.

- [ ] Login.

- [ ] Refresh de sesión.

- [x] Reserva pública. Flujo completo sintético en Cloudflare, POST 200 y portal posterior 200.

- [ ] Historia clínica.

- [x] `/complete` de radiografías. Upload sintético y confirmación 200 en el Worker productivo.

- [x] Generación de PDF. Comprobante sintético 200, PDF válido y 1529 bytes.

- [ ] Jobs con lotes máximos.

Criterios:

- [ ] CPU p99 menor al 70% del límite real.

- [ ] Memoria p99 menor al 70% del límite real.

- [ ] Subrequests con al menos 30% de margen.

- [ ] Conexiones con al menos 30% de margen.

- [ ] Cero terminaciones por recursos.

- [ ] Si el plan Free no soporta SSR o PDF con margen, declarar NO-GO o cambiar de plan; no reducir cobertura.

### 7. Diferencias específicas del Worker

- [x] `fetch` con redirect manual en validación de Storage. El flujo de radiografías productivo completó la validación y descarga sin el error de runtime histórico.

- [ ] Respuestas 206 a Range.

- [x] `AbortController`. Los únicos `requestfailed` observados en la prueba clínica fueron `net::ERR_ABORTED` de fetches reemplazados/cancelados; no hubo fallos no abortados, y se registró esta distinción.

- [ ] Timeouts.

- [ ] Web Crypto y AES-GCM.

- [ ] Buffer con nodejs_compat.

- [x] Generación PDF con `nodejs_compat`. El endpoint PDF funcionó dentro del Worker y la configuración declara el flag.

- [ ] Cookies en redirects 303.

- [ ] Request bodies de webhooks sin alterar antes de validar firma.

- [x] Desconexión del cliente después de una mutación. La creación pública persistió y mostró portal aun cuando el navegador canceló requests de navegación secundarios; se releyó y limpió por IDs exactos.

- [ ] Tareas posteriores a la respuesta: demostrar que están persistidas en outbox o ejecutadas con un mecanismo seguro; no depender de trabajo que Cloudflare pueda cancelar al cerrarse la conexión.

### 8. DNS, TLS, WAF y routing

- [x] HTTPS. Dominio Cloudflare respondió correctamente por TLS en todas las rutas críticas probadas.

- [ ] Certificado.

- [ ] Renovación de certificado.

- [ ] Redirección HTTP → HTTPS.

- [ ] Dominio con www según política elegida.

- [ ] Dominio sin www según política elegida.

- [ ] IPv4.

- [ ] IPv6.

- [ ] 404 humana.

- [ ] 500 humana.

- [ ] URL con slash final.

- [ ] URL con mayúsculas.

- [ ] URL con encoding inválido.

- [ ] URL con query enorme.

- [ ] WAF o bot protection no bloquea OAuth.

- [ ] WAF o bot protection no bloquea webhooks.

- [x] WAF o bot protection no bloquea reserva pública. La reserva sintética completó creación y portal en Cloudflare.

- [x] WAF o bot protection no bloquea upload. La radiografía sintética completó upload y `/complete`.

- [ ] WAF o bot protection no bloquea teléfono internacional.

- [ ] El cliente no puede falsificar la IP usada por rate limits.

- [x] CSP. HTML 404, login, privacidad y reserva incluyeron una política CSP explícita.

- [ ] HSTS.

- [ ] Referrer-Policy.

- [ ] Restricciones de frame.

- [ ] Protección contra MIME sniffing.

- [ ] Permissions-Policy.

### 9. Promoción y rollback

- [ ] Candidato al 0% y versión anterior al 100%.

- [ ] Primera pasada completa @prod-safe mediante override.

- [ ] Segunda pasada completa @prod-safe mediante override.

- [ ] Seis horas de synthetic checks internos sobre el candidato.

- [ ] Proveedores cuyos callbacks no pueden enviar el override fueron probados completamente en staging.

- [ ] Esos proveedores se repiten inmediatamente después de promoción.

- [ ] Promover durante horario de baja actividad.

- [ ] Ejecutar smoke crítico sin override en los primeros cinco minutos.

- [ ] Observar durante 30 minutos antes de cerrar la ventana.

- [ ] Mantener rollback de una orden a la versión anterior.

- [ ] Ejecutar un rollback real en staging.

- [ ] Demostrar el tiempo de recuperación del rollback.

## Seguridad, resiliencia y capacidad

Además del navegador:

- [ ] RLS sobre todos los IDs y RPC.

- [ ] IDOR sobre todos los IDs y RPC.

- [ ] CSRF en mutaciones.

- [ ] CSRF en GET con efectos.

- [ ] XSS almacenado en nombres.

- [ ] XSS reflejado en nombres.

- [ ] XSS almacenado en historia.

- [ ] XSS reflejado en historia.

- [ ] XSS almacenado en notas.

- [ ] XSS reflejado en notas.

- [ ] XSS almacenado en servicios.

- [ ] XSS reflejado en servicios.

- [ ] XSS almacenado en URLs.

- [ ] XSS reflejado en URLs.

- [ ] Inyección SQL o PostgREST mediante filtros.

- [ ] Inyección SQL o PostgREST mediante cursores.

- [ ] SSRF por logos.

- [ ] SSRF por mapas.

- [ ] SSRF por reseñas.

- [ ] SSRF por Storage.

- [ ] SSRF por redirects.

- [ ] Path traversal.

- [ ] Upload polyglot.

- [ ] Fuerza bruta.

- [ ] Enumeración de cuenta.

- [ ] Bypass de rate limit.

- [ ] Replay de webhooks.

- [ ] Tokens públicos ausentes de logs.

- [ ] Tokens públicos ausentes de analytics.

- [ ] Tokens públicos ausentes de historial.

- [ ] Tokens públicos ausentes de referrer.

- [ ] URLs firmadas ausentes de logs.

- [ ] URLs firmadas ausentes de analytics.

- [ ] URLs firmadas ausentes de historial.

- [ ] URLs firmadas ausentes de referrer.

- [ ] Secret scanning.

- [ ] SBOM.

- [ ] Pentest independiente antes de lanzamiento.

- [x] No ejecutar DAST agresivo sobre producción. Sólo se hicieron requests/smokes controlados con fixtures sintéticos y sin escaneo destructivo.

- [ ] Supabase Auth caído.

- [ ] Supabase DB caído.

- [ ] Supabase Realtime caído.

- [ ] Supabase Storage caído.

- [ ] Cloudflare caído.

- [ ] Google caído.

- [ ] Mercado Pago caído.

- [ ] Meta caído.

- [ ] Push caído.

- [ ] Latencia alta.

- [ ] Paquetes perdidos.

- [ ] Offline.

- [ ] Reconexión.

- [ ] Dos usuarios editando el mismo dato.

- [ ] Clock skew.

- [ ] Timezone incorrecto.

- [ ] Quota agotada.

- [ ] Job detenido.

- [ ] Backlog.

- [ ] Backup corrupto.

La carga debe ejecutarse en staging desde un runner separado, no desde esta PC:

- [ ] Escala objetivo completa de tenants y pacientes.

- [ ] Pico realista.

- [ ] Tres veces el pico esperado.

- [ ] Cincuenta reservas concurrentes del mismo slot.

- [ ] Búsquedas simultáneas.

- [ ] Agenda simultánea.

- [ ] Historia paginada simultánea.

- [ ] Uploads concurrentes dentro de los límites.

- [ ] Jobs mientras hay tráfico interactivo.

Presupuestos iniciales:

- [ ] TTFB HTML p95 menor o igual a 1,5 segundos.

- [ ] TTFB HTML p99 menor o igual a 3 segundos.

- [ ] Navegación utilizable p95 menor o igual a 3 segundos en banda ancha.

- [ ] Navegación utilizable p95 menor o igual a 5 segundos en 4G degradado.

- [ ] Mutaciones p95 menor o igual a 3 segundos.

- [ ] Mutaciones p99 menor o igual a 6 segundos.

- [ ] Búsqueda reconciliada menor o igual a 800 ms p95.

- [ ] Cero 5xx durante la certificación determinística.

- [ ] Cero errores JavaScript durante la certificación determinística.

- [ ] Ninguna regresión superior al 20% respecto de la baseline congelada.

## Evidencia y reporte

Cada test debe generar un registro con:

- [ ] ID único.

- [ ] Requisito cubierto.

- [ ] SHA.

- [ ] Version ID.

- [ ] Fixture.

- [ ] Actor.

- [ ] Pasos.

- [ ] Resultado esperado.

- [ ] Resultado observado.

- [ ] Trace Playwright.

- [ ] Captura inicial.

- [ ] Captura final.

- [ ] Video si falla.

- [x] Requests relevantes. Se conservaron estados y URLs sanitizadas de login, reserva, `/complete`, Storage, portal, ICS, PDF y redirects externos en el registro de ejecución.

- [x] Headers sanitizados. Se registraron sólo status, content-type, cache-control, disposition, `cf-ray`/`cf-placement` y locations de destino; nunca cookies, claves, tokens ni URLs firmadas.

- [x] Relectura de base de datos. Se releyeron estado e integridad de radiografía, eventos de auditoría, turnos/pacientes y cleanup con service role en fixtures sintéticos.

- [x] Auditoría. La prueba clínica productiva verificó cinco acciones de radiografía con resultado exitoso.

- [ ] Efecto en proveedor.

- [ ] Logs Cloudflare correlacionados.

- [x] Resultado de cleanup. Fixture local eliminado por negocio/email exactos; fixture Cloudflare de reserva eliminado por IDs exactos de tres turnos, paciente y tres intentos; se eliminaron además 45 IDs exactos de intentos `HeadlessChrome` históricos de cinco negocios de prueba; radiografía productiva sintética eliminada y validada sin restos conocidos.

Los artefactos:

- [ ] No contienen nombres reales.

- [ ] No contienen tokens.

- [ ] No contienen cookies.

- [ ] No contienen URLs firmadas.

- [ ] No contienen secretos.

La ejecución certificadora debe tener:

- [x] `retries=0`. La corrida certificadora Cloudflare se ejecutó con `--workers=1 --retries=0`; la corrida local wrapper conservó un retry de CI y por eso no se considera certificadora.

- [ ] Cero skips inesperados.

- [ ] Cero tests flaky.

- [ ] Primera pasada consecutiva de los casos críticos en staging.

- [ ] Segunda pasada consecutiva de los casos críticos en staging.

- [ ] Tercera pasada consecutiva de los casos críticos en staging.

- [ ] Primera pasada consecutiva @prod-safe sobre Cloudflare.

- [ ] Segunda pasada consecutiva @prod-safe sobre Cloudflare.

- [x] Una pasada en Chromium. Suite E2E y pruebas independientes de reserva/radiografías se ejecutaron en Chromium.

- [ ] Una pasada en Firefox.

- [ ] Una pasada en WebKit.

- [ ] Una pasada en cada dispositivo físico obligatorio.

- [ ] Soak de staging de 24 horas.

- [ ] Smoke de producción inmediato.

- [ ] Monitor sintético horario durante las primeras 24 horas.

## Criterios finales de No-Go

No lanzar si existe cualquiera de estos puntos. Para marcar una casilla debe haberse demostrado la ausencia del problema:

- [ ] No existe paciente incorrecto.

- [ ] No existe turno incorrecto.

- [ ] No existe profesional incorrecto.

- [ ] No existe tenant incorrecto.

- [ ] No existe pérdida de datos.

- [ ] No existe corrupción de datos.

- [ ] No existe entrada clínica duplicada.

- [ ] No existe turno duplicado.

- [ ] No existe pago duplicado.

- [ ] No existe mensaje duplicado.

- [ ] No existe operación parcial presentada como exitosa.

- [ ] No existe acceso lateral.

- [ ] No existe costo clínico visible a un rol incorrecto.

- [ ] No existe radiografía accesible sin autorización.

- [ ] No existe token filtrado.

- [ ] No existe secreto filtrado.

- [ ] No existe PII filtrada.

- [ ] No existe backup no restaurable.

- [ ] No existe scheduler sin evidencia de ejecución.

- [ ] No existe callback dirigido al hosting anterior.

- [ ] No existe versión Cloudflare sin correlación con Git.

- [ ] No existe error Worker de recursos.

- [ ] No existe excepción inesperada.

- [ ] No existe skip inesperado.

- [ ] No existe retry necesario.

- [ ] No existe fallo intermitente.

- [ ] No existe problema UX que pueda inducir una decisión equivocada.

- [ ] No existe problema UX que pueda ocultar el estado real.

- [ ] No existe problema UX que pueda hacer perder trabajo.

- [ ] No existe tarea crítica que un profesional no pueda completar sin ayuda.

- [ ] No existe alerta no operativa.

- [ ] No existe rollback no operativo.

## Cierre

- [x] Confirmar que este plan amplió la revisión de interfaz a estados reales, jerarquía, acción principal, foco, touch, contraste, interrupciones y recuperación. Se ejecutaron recorridos UX automatizados desktop/mobile y un recorrido público real de reserva; las pruebas humanas, accesibilidad formal y dispositivos físicos siguen pendientes.

- [x] Confirmar que ninguna pantalla fue considerada “correcta” sólo porque el servidor haya guardado bien. Los fallos de arnés `patient_mode`, la expectativa de URL firmada frente a `blob:` y la búsqueda de un carácter quedaron registrados como no aprobados.

- [x] Registrar decisión GO o NO-GO con responsables, fecha, riesgos residuales y enlaces a toda la evidencia. Decisión: **NO-GO**, 2026-08-30; ver Control de ejecución y Registro de ejecución.

## Antecedentes técnicos consultados al elaborar el plan

- [x] Revisar MEMORY.md:110-119 antes de ejecutar radiografías en producción: incompatibilidad del runtime Cloudflare, validación del flujo real y limpieza segura de fixtures. Rollout relacionado: 01a03c5f-f24c-77b2-a254-dcdcc1b1c8a4.

- [x] Revisar MEMORY.md:214-223 antes de ejecutar rate limits y placement: política distinta por flujo y verificación de ejecución remota en GRU. Rollout relacionado: 01a03b0a-3116-71f3-b3fa-fa0f6f814cc4.

- [x] Revisar MEMORY.md:950-986 antes de iniciar la batería completa: secuencia conservadora, un worker y cuidados de memoria de esta PC. Rollout relacionado: 019f1612-dfa7-7c83-bfb3-1dcb50340687.

## Registro de ejecución — 2026-08-30

Este registro es parte de la auditoría viva. No contiene contraseñas, service keys, cookies, tokens públicos, URLs firmadas ni historias clínicas reales. Todas las mutaciones E2E fueron sintéticas y se limpiaron por identificadores exactos.

### Candidato y estado del repositorio

- `HEAD=origin/main=e3887e414a88933355a57442082bef14deb89e5c`; no se hizo push ni deploy durante esta auditoría.
- El worktree no era un checkout aislado: hay archivos de salida de Playwright modificados/no versionados, `.agents/`, `AGENTS.md`, `walkthrough.md` y esta auditoría. Por eso el gate de checkout limpio permanece sin marcar.
- 171 archivos bajo `apps/web/src/routes`; 74 migraciones SQL.
- SHA-256: `pnpm-lock.yaml` = `33b9c14bb173713e2551917ced15de99d99c3b48fdaa456a4f7a0893696af5c7`; manifiesto ordenado de migraciones = `67a5b72c0fcb27c59857a6c47dd93499908d6440812a7e099a5bc00a83674162`; `apps/web/wrangler.jsonc` = `f25d036391f7a31edbb5fb3200786c0cc1601e57ffb2befb72161ca4fb32d8fb`.
- Versiones: Node `v20.19.3`, pnpm `10.13.1`, Supabase CLI `2.115.0`, Wrangler `4.86.0`, Playwright `1.60.0`. Compatibilidad Cloudflare `2026-05-03`; flags `nodejs_compat`; placement configurado `aws:sa-east-1`.
- El build local Cloudflare generó el Worker con SHA `cf4056f946ba2822fb93035da445ea2b74c918e9bbbb7d646dffcc8db657d484`. No se publicó ese artefacto.

### Orden local ejecutado, en secuencia

1. `pnpm install --frozen-lockfile`: correcto; lockfile sin cambios. Advertencia: pnpm ignoró scripts de build de `esbuild`, `sharp` y `workerd`.
2. `pnpm check`: correcto; 0 errores y 0 warnings de `svelte-check` y tipos compartidos.
3. `pnpm --filter web exec vitest run --maxWorkers=1 --passWithNoTests`: 105 archivos, 810 tests pasaron.
4. `pnpm --filter web run test:client -- --maxWorkers=1`: 7 archivos, 71 tests pasaron.
5. `pnpm supabase:start`: stack local arrancado explícitamente.
6. `pnpm supabase:db:reset`: primer intento detenido por una etiqueta de Storage inexistente; se corrigió sólo el cache local a la imagen disponible y el segundo reset aplicó las 74 migraciones y seed.
7. `pnpm exec supabase test db` (literal, sin flags): 18 archivos/tests de pgTAP pasaron; una ejecución previa con `--local` dio el mismo resultado.
8. `pnpm build:cloudflare`: correcto (`built in 28.96s`).
9. `pnpm --filter web exec wrangler deploy --dry-run --config wrangler.jsonc`: correcto; 112 assets, 3942 KiB totales y 805.97 KiB gzip.
10. `pnpm audit --prod --audit-level=high`: correcto, sin vulnerabilidades conocidas de producción.
11. `pnpm audit --audit-level=high`: **falló** con 15 vulnerabilidades (2 low, 7 moderate, 6 high) en dependencias transitivas de Wrangler (`undici`, `ws`, `sharp`). Los avisos high incluyen TLS/SOCKS5 y exposición de caché de `undici`, DoS de WebSocket y CVEs de libvips/sharp; las versiones corregidas requieren actualizar dependencias.
12. Siete scripts de concurrencia se ejecutaron uno por uno (el plan histórico decía cinco): asociación por email, límite de uploads clínicos, consistencia de exportación, lock global de exportación, idempotencia de identidad/paciente, cupo de reserva pública y resolución pública de pacientes. Todos pasaron; los resultados clave fueron exactamente una invitación pendiente, máximo atómico de tres uploads, un lock activo con conflicto controlado, replay idempotente y una creación frente a cuatro rechazos.
13. `pnpm preflight:staging` sin VAPID real: falló sólo por las cuatro variables VAPID obligatorias ausentes y dejó seis warnings de integraciones opcionales/URL local.
14. `pnpm preflight:staging -- --remote` con un par VAPID generado efímero y URL HTTPS de prueba: pasó formato, archivos, 22 tablas remotas y 4 RPC; mantuvo cinco warnings opcionales. El par generado no certifica claves VAPID de producción.
15. No se usó `source .env`; se emplearon parsers efímeros y el CLI, sin imprimir secretos.
16. Al terminar, `pnpm supabase:stop` detuvo el stack local para liberar memoria; la relectura previa confirmó cero filas del fixture local.

### E2E y causas de los fallos

- La suite lista 13 specs y 27 tests; Playwright quedó en un worker.
- Cloudflare, con credenciales proporcionadas, `CI=1`, `--workers=1`, `--retries=0` y bindings Supabase de producción: **19 passed, 2 failed, 6 skipped**.
- Los dos fallos Cloudflare son el mismo desfase del arnés: `odonto.full.spec.ts` y el primer caso de `roles-agenda-regression.spec.ts` fabrican POST directos sin `patient_mode`; el servidor exige `patient_mode=existing|new` y responde 400 antes de evaluar el solapamiento. La UI que incluye el campo oculto sí se recorrió; no se modificaron tests ni se presentó este resultado como bug de usuario resuelto.
- Los seis skips Cloudflare son trazables: dos pruebas clínicas requieren Supabase local, una Google real requiere credenciales, una asistencia de cuenta requiere `E2E_MASTER_PASSWORD` y dos requieren `DEMO_MODE=true`. No son skips inesperados, pero impiden declarar cobertura completa.
- Local, mediante `scripts/run-local-e2e.mjs`, terminó **18 passed, 4 failed, 5 skipped**. Dos fallos de archivos clínicos son expectativas desactualizadas: el código descarga el original como `blob:` y la búsqueda actual consulta desde un carácter; los otros dos son el mismo `patient_mode` ausente. El wrapper de CI hizo un retry, por lo que esta corrida local no es certificadora.
- Los artefactos de fallos quedaron en `apps/web/test-results`; contienen screenshots/traces/videos y se conservan como evidencia de diagnóstico, no de aprobación.

### Cloudflare activo y smokes controlados

- `wrangler deployments list/status` mostró la versión activa `97f5d35f-c20e-4d4e-9ee9-ffa122f2e553`, número 28, al 100 %, creada 2026-08-28; `wrangler versions view` informó sólo handler `fetch`, 28 bindings, `nodejs_compat`, placement targeted `aws:sa-east-1`, assets directos y `raw_run_worker_first=false`. No tiene tag ni mensaje, y no se probó override 0 %.
- Fingerprint de assets confirma deriva: Cloudflare sirvió `app.DamWbg43.js`/`start.CSiV65tF.js`, el build local sirvió `app.Bhgj1bBg.js`/`start.BBNlKMHi.js` y el fixture Netlify sirvió otros hashes. No se puede afirmar que producción atienda el candidato `e3887e4`.
- `/`, `/login`, `/terminos`, `/privacidad` y la reserva pública respondieron desde Cloudflare; la reserva usó `cache-control: no-store`. Se observó `cf-placement: remote-GRU` en respuestas críticas y `cf-ray` en las respuestas. Algunas páginas informativas devolvieron `remote-` sin región.
- Una reserva pública sintética recorrió servicio, profesional, día, horario y datos. El POST de creación respondió 200; el portal respondió 200 sin errores JavaScript. Se verificó portal, PDF, calendario y redirects con requests separados. Después se eliminaron exactamente tres turnos generados por los reintentos de la prueba, el paciente sintético y sus tres intentos de booking; las relecturas dieron cero restos.
- Artefactos del portal: ICS 200, `text/calendar`, `no-store`, `attachment`, 1046 bytes; PDF 200, `application/pdf`, `no-store`, `attachment`, firma `%PDF-1.7`, 1529 bytes; Google 302 a `calendar.google.com`; Outlook 302 a `outlook.live.com`; Maps 302 a `maps.app.goo.gl`.
- Se observó el header residual `netlify-cdn-cache-control: public, durable, s-maxage=60, stale-while-revalidate=300` en HTML de reserva pese a `cache-control: no-store`. Debe retirarse o explicarse antes de GO para eliminar ambigüedad de caché/hosting anterior.
- La prueba independiente de radiografías en el Worker creó un tenant sintético, subió un PNG, confirmó `/complete`, descargó y validó la imagen, abrió el visor `blob:`, envió a papelera, restauró y releyó DB/auditoría. Estado final `ready/ok`; auditoría con `radiograph.upload_started`, `radiograph.upload_completed`, `radiograph.original_access_granted`, `radiograph.trashed` y `radiograph.restored`, todos exitosos. Los únicos `requestfailed` fueron abortos esperados de `AbortController`; no hubo fallos no abortados, errores JS ni respuestas clínicas fallidas. El fixture y sus objetos fueron eliminados por IDs exactos.
- OAuth Google se probó hasta `accounts.google.com`; el callback observado es el callback Supabase del proyecto correcto y no se completó una cuenta real. El retorno final tras autorización requiere credenciales Google reales.
- Smokes HTTP adicionales: 404, slash final, mayúsculas, encoding inválido y query de 9 KB respondieron sin caída del Worker; se observaron CSP y HTTPS. No se demostraron HSTS, Referrer-Policy ni todos los headers/PoPs exigidos por el plan.
- Crawl autenticado secuencial de diez rutas críticas (Agenda, Pacientes, Seguimientos, Recordatorios, configuraciones y papelera): todas las rutas válidas respondieron 200, la ruta deliberadamente inexistente respondió 404, no hubo 5xx, errores JavaScript ni fallos de request no abortados, y no se encontraron hrefs a `netlify.app`, Vercel, localhost ni `127.0.0.1`. La ruta `/odonto/configuracion/equipo` no es una ruta válida del código (el menú usa `/odonto/configuracion/usuarios`) y no se contó como regresión.
- Verificación posterior de residuos remotos: cero profesionales/servicios/pacientes con prefijo `E2E` y cero pacientes `Pruebaautomatizada%`. La primera consulta encontró 45 intentos históricos `HeadlessChrome` en cinco negocios de prueba; se inspeccionaron por acción/tenant, se seleccionaron sus 45 IDs exactos y se eliminaron; la relectura final dio cero.

### Revisión UX

- Pasaron los recorridos automatizados de login/registro, navegación de pacientes, selección por fila, búsqueda inmediata, layout móvil de 390 px, entradas de teléfono y parte de radiografías. Se verificó ausencia de overflow horizontal en las rutas cubiertas y se conservaron capturas desktop/mobile.
- El portal público mostró una única secuencia de cinco pasos, fecha/hora/profesional/estado visibles, salida de calendario/PDF/mapas y acciones operativas. Esto no reemplaza la prueba moderada con profesionales, recepción y owners.
- Quedan sin certificar: 5+5+5 usuarios reales, accesibilidad WCAG completa, teclado/lector de pantalla, dispositivos Android/iPhone físicos, interrupciones de llamada/bloqueo/offline, métricas SEQ/SUS, latencias p95/p99 y consistencia humana entre Agenda/Pacientes/Seguimientos/Recordatorios.

### Proveedores, operación y riesgos bloqueantes

- No existe staging separado idéntico a producción ni backup restaurado en otro proyecto; por tanto G1 y la totalidad de staging siguen sin aprobar.
- No existe observabilidad explícita en `wrangler.jsonc`, sampling 100 %, Cron Trigger ni evidencia de scheduler externo/últimas ejecuciones de los cuatro jobs. G6/G9 siguen bloqueados.
- No se ejecutó la revisión oficial viva de Mercado Pago: el conector oficial no está disponible. El análisis estático y los tests mock no sustituyen esa checklist; no se hizo ningún cobro real.
- Turnstile, credenciales completas de WhatsApp, claves VAPID reales y Google Calendar administrado no están íntegramente configurados/probados; quedan como riesgos explícitos, no como skips silenciosos.
- No se ejecutaron Firefox/WebKit, dispositivos físicos, carga/soak de staging, rollback real, p99 de recursos, pruebas de caída de proveedores ni pentest independiente.
- No se desplegó ni se modificó GitHub/Cloudflare durante esta auditoría. La versión que atiende producción es anterior/no correlacionada inequívocamente con el SHA candidato; no debe promoverse hasta publicar una versión etiquetada y repetir la suite.

### Decisión operativa

**NO-GO.** Los checks marcados son únicamente los demostrados. Todo checkbox que permanezca `[ ]` requiere la ejecución indicada por el plan, una justificación/aprobación explícita si no aplica y evidencia antes de permitir el lanzamiento. Los blockers inmediatos son: correlación Git↔Cloudflare, backup/restore, observabilidad/scheduler, revisión Mercado Pago, E2E sin fallos ni skips no aceptados, staging idéntico, UX humana y proveedores reales. Las 15 vulnerabilidades de la corrida inicial quedaron resueltas en el candidato local y ya no bloquean el gate de código, pero la decisión sólo puede cambiar tras publicar y certificar ese candidato.

## Registro de remediación autorizada — 2026-08-30

Esta sección documenta cambios ejecutados después del primer registro. No reemplaza
la decisión NO-GO ni convierte el candidato local en la versión de producción.

### Cambios aplicados al candidato Cloudflare

- OK — Los helpers E2E que fabrican turnos ahora envían siempre `patient_mode` coherente (`existing` o `new`) y un `idempotency_key` UUID válido. La clave del caso de solapamiento se genera en Node y se pasa al navegador; nunca se intenta llamar `randomUUID` dentro de `page.evaluate`.
- OK — La prueba clínica espera `blob:` para el visor de imágenes privadas, conserva la comprobación de ancho natural y confirma por lectura de base que la transición comercial terminó en `is_permanent=false` y `subscription_status=restricted`.
- OK — Todas las rutas productivas que resolvían membresías con `membershipCache: 'short'` pasaron a lectura fresca. El layout vuelve a rastrear `url.pathname`, por lo que una navegación no conserva el shell con un acceso comercial revocado. Se mantuvo la cobertura unitaria del mecanismo short/fresh para no perder el contrato de coalescencia, pero ninguna ruta productiva lo usa.
- OK — El catálogo, los profesionales y el estado comercial de reserva pública dejaron de persistir en la caché estructural de 60 segundos (`STRUCTURE_SCAN_CACHE_TTL_MS=0`). La exploración de disponibilidad conserva sólo el caché de slots de 25 segundos y la creación vuelve a validar el horario en vivo.
- OK — `getPublicSiteUrl()` rechaza hosts históricos Netlify/Vercel y usa el Worker Cloudflare como fallback. Se agregaron 4 pruebas unitarias: rechazo de ambos hosts, conservación de un dominio HTTPS válido, fallback ante configuración inválida y rechazo de HTTP público con conservación de localhost.
- OK — La selección de adaptador quedó fija en Cloudflare. Se eliminaron `@sveltejs/adapter-netlify`, `@sveltejs/adapter-vercel`, `apps/web/vercel.json`, `netlify.toml` y los dos scripts de build específicos. `.env.example`, reset de contraseña y README quedaron orientados al Worker.
- OK — Se actualizaron las transitivas vulnerables mediante overrides compatibles con Node 20 (`undici 7.29.0`, `ws 8.21.0`, `sharp 0.35.2` bajo Wrangler/miniflare). `pnpm audit --audit-level=high` posterior terminó `No known vulnerabilities found`.
- OK — Las reservas públicas del candidato sólo envían `cache-control: no-store`; se retiró el helper de cabecera CDN histórica y su test.

### Verificación secuencial posterior

- OK — `pnpm check`: `svelte-check found 0 errors and 0 warnings`.
- OK — `pnpm --filter web exec vitest run --maxWorkers=1 --passWithNoTests`: 106 archivos, 813 tests pasaron.
- OK — `pnpm --filter web run test:client -- --maxWorkers=1`: 7 archivos, 71 tests pasaron.
- OK — E2E local con `scripts/run-local-e2e.mjs clinical-files.spec.ts roles-agenda-regression.spec.ts`: 4/4 pasaron en un worker, incluida la revocación comercial y la restauración clínica.
- OK — E2E local `odonto.full.spec.ts`: 1/1 pasó en un worker contra un consultorio/usuario fixture local creado y eliminado por email/slug exactos.
- OK — `pnpm build:cloudflare`: SSR y cliente terminaron correctamente; Worker candidato `sha256=cf4056f946ba2822fb93035da445ea2b74c918e9bbbb7d646dffcc8db657d484`.
- OK — `wrangler deploy --dry-run --config wrangler.jsonc`: 112 assets, 3941.34 KiB total, 805.82 KiB gzip, binding `ASSETS`.
- OK — `pnpm audit --audit-level=high`: sin vulnerabilidades conocidas.
- OK — `pnpm why --recursive wrangler undici ws sharp --depth 6`: Wrangler 4.86.0/miniflare usa las versiones corregidas indicadas arriba; no se subió Node para forzar Wrangler 4.127.1.
- OK — `git diff --check`: sin errores de whitespace.
- OK — Repetición final post-instalación: `pnpm install --frozen-lockfile` terminó con lockfile al día; la política del runner siguió bloqueando scripts de build de `esbuild`, `sharp` y `workerd`, y el check/build/dry-run anteriores confirmaron que el candidato empaqueta correctamente pese a esa advertencia.

### E2E Cloudflare posterior y hallazgos del Worker vigente

- OK — Smoke `odonto.smoke.spec.ts` contra `https://app.cita-suite.workers.dev`, con credenciales de prueba y un worker: 1 test pasó; los 2 casos demo se omitieron porque `DEMO_MODE` es falso.
- OK — `patients-real-ux-audit.spec.ts` contra Cloudflare: 1/1 pasó; búsqueda por primer carácter renderizada en 40 ms y layout desktop/móvil sin overflow en las rutas cubiertas.
- OK — `roles-agenda-regression.spec.ts` contra Cloudflare: 2/2 pasaron con fixtures sintéticos y limpieza posterior; no quedaron profesionales, servicios ni pacientes con prefijo E2E.
- HALLAZGO — El primer intento de `odonto.full.spec.ts` contra el Worker vigente falló por `randomUUID is not defined` dentro del navegador; el helper quedó corregido y el fallo dejó de reproducirse localmente.
- HALLAZGO — El segundo intento contra el Worker vigente no mostró el servicio recién insertado: el Worker conserva una caché estructural pública de 60 segundos. El candidato la deja en TTL 0; la versión activa todavía no contiene esa corrección.
- HALLAZGO — Con la entrada estructural ya vencida, el flujo llegó a confirmar el turno pero el POST devolvió `Cross-site POST form submissions are forbidden`. La página/redirect del Worker vigente sigue ligado a la configuración histórica de host y no permite completar la confirmación desde el origen Cloudflare. El candidato rechaza esa configuración y cae a `app.cita-suite.workers.dev`, pero aún no está publicado.
- HALLAZGO — Un intento posterior fue detenido por el rate limit real de login: la interfaz informó humanamente “Hay demasiados intentos de ingreso para este correo. Volvé a intentar en 10 min.” No se vació la tabla ni se forzó el bypass; esto queda como evidencia positiva del límite y como razón para no seguir castigando la cuenta de prueba en esta ventana.
- OK — Tras cada corrida fallida de reserva se verificaron y eliminaron los fixtures remotos por filtros exactos; las relecturas devolvieron cero restos conocidos.
- HALLAZGO — Relectura HTTP final del Worker vigente: `/` siguió redirigiendo 302 a `/login`, `/login`, `/privacidad`, `/terminos` y la ruta pública sintética respondieron 200 con HTTPS/CSP; la reserva continuó enviando `cache-control: no-store` pero mantuvo `netlify-cdn-cache-control: public, durable, s-maxage=60, stale-while-revalidate=300`, y los assets observados siguieron siendo los hashes antiguos `app.DamWbg43.js`/`start.CSiV65tF.js`. No hubo publicación ni cambio de versión durante esta comprobación.

### Estado de publicación y decisión

- NO PUBLICADO — No se hizo `git push`, `wrangler deploy`, promoción gradual ni cambio de variables/bindings. La versión que atiende producción sigue siendo `97f5d35f-c20e-4d4e-9ee9-ffa122f2e553` (número 28), sin correlación demostrada con este candidato.
- TRAZABILIDAD PENDIENTE — El Worker `cf4056f946ba2822fb93035da445ea2b74c918e9bbbb7d646dffcc8db657d484` fue construido desde el worktree con la remediación sin commit, sobre `HEAD=e3887e414a88933355a57442082bef14deb89e5c`; por eso todavía no existe un SHA Git único para el artefacto remediado.
- PENDIENTE — Para cerrar el gate de Cloudflare todavía hace falta desplegar una versión etiquetada con el SHA candidato, configurar/verificar `PUBLIC_SITE_URL` en el Worker, repetir `odonto.full` sin skips/fallos y conservar headers/locations de esa versión.
- PENDIENTE — Siguen sin evidencia staging idéntico, backup/restore, observabilidad y scheduler, rollback, límites p95/p99, Firefox/WebKit/dispositivos físicos, accesibilidad formal, UX moderada con profesionales, proveedores reales y la checklist oficial de Mercado Pago (fuera del alcance técnico de esta remediación). La auditoría completa de dependencias sí quedó limpia en el candidato local.

La decisión operativa continúa siendo **NO-GO** hasta cerrar esos puntos y repetir la certificación contra la versión exacta publicada.
