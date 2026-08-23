# Próximos turnos, Pacientes y validación de teléfono

Fecha de cierre: 22 de agosto de 2026.

Este documento registra el contrato funcional, las decisiones técnicas, la auditoría lateral y
la evidencia de validación de los cambios realizados sobre Agenda, Pacientes y la creación manual
de turnos. Su objetivo es permitir retomar el trabajo sin depender del historial de la interfaz.

## Estado de entrega

- El código está implementado en el worktree aislado
  `Base-de-Datos-Sabrina-storage-phase1`, rama `codex/supabase-storage-phase1`.
- La aplicación local está disponible en `http://127.0.0.1:5174`.
- No se hizo commit, push ni despliegue de Netlify como parte de este cambio.
- Las migraciones `20260822020000` y `20260822021000` sí fueron aplicadas al Supabase remoto,
  porque el nuevo contrato necesita aceptar escrituras tanto del código anterior como del nuevo
  durante la transición.
- El trabajo previo del visor clínico se preservó. Sus decisiones están documentadas en
  `docs/supabase-clinical-files-phase-1.md`.

## 1. Contrato de próximos turnos

### Definición única

Un turno es operacionalmente activo sólo si su estado es uno de estos:

- `reserved`;
- `confirmed`;
- `reschedule_requested`.

Un turno es próximo si `starts_at` es igual o posterior al instante actual. La comparación se hace
con timestamps absolutos; la presentación de fechas sigue usando la zona horaria del consultorio.

La definición está centralizada en
`apps/web/src/lib/utils/appointment-visibility.ts`. Tanto el servidor como las defensas del cliente
consumen el mismo conjunto de estados.

### Superficies operativas corregidas

| Superficie | Regla final | Orden |
| --- | --- | --- |
| Ficha del paciente, “Próximos turnos” | futuro + activo | ascendente |
| Agenda, filtro “Cualquier día” | futuro + activo | ascendente |
| Búsqueda viva de Agenda | futuro + activo | ascendente |
| “Mis turnos”, bloque de próximos días | futuro + activo | ascendente |

La ficha del paciente ya no presenta turnos pasados activos ni turnos futuros cancelados. El
título “Turnos recientes” fue reemplazado por “Próximos turnos” y el vacío quedó reducido a “No
hay próximos turnos”.

“Cualquier día” deja de ofrecer estados terminales en el selector. Una URL antigua que combine
`date=any` con `cancelled`, `attended` o `no_show` se sanea en el servidor en lugar de mostrar una
búsqueda contradictoria. La búsqueda libre dice solamente “Busca próximos turnos mientras
escribís”.

### Historia que se conserva deliberadamente

No se eliminó información histórica. Continúan mostrando registros pasados cuando el usuario los
solicita de manera explícita:

- Agenda de una fecha seleccionada, incluida una fecha pasada;
- vista semanal elegida por el usuario;
- historial de un profesional;
- detalle directo de un turno;
- bloque de turnos del día de un profesional, necesario para cerrar asistencia o ausencia.

Esta frontera evita contaminar superficies operativas con turnos viejos sin destruir la función de
historia y cierre administrativo.

## 2. Pacientes: experiencia y rendimiento

### Búsqueda local inmediata y servidor autorizado

La búsqueda admite el primer carácter. El flujo final es local-first:

1. cada pulsación filtra sincrónicamente los pacientes que ya están en memoria;
2. nombre se compara sin distinguir mayúsculas ni acentos;
3. DNI y teléfonos se comparan sólo por dígitos;
4. a los 120 ms se consulta el servidor para completar resultados fuera de la página cargada;
5. una respuesta anterior nunca puede sobrescribir una consulta posterior;
6. borrar el texto aborta la consulta pendiente y restaura la lista base inmediatamente.

Al borrar caracteres se usa la unión deduplicada de la página base y el último resultado remoto.
Así la interfaz puede ampliar resultados en el acto, no sólo reducir el conjunto más reciente.

El endpoint rápido sigue usando `list_accessible_patients_page`: no se cambió la autorización ni se
expusieron datos fuera del alcance del usuario. Durante la escritura omite únicamente trabajos
redundantes —recuentos y lecturas de revisión— y devuelve una respuesta no cacheable. La carga
normal conserva el snapshot privado, cursores firmados, revisión y recuentos estrictos.

### Concurrencia y caché

- Cada consulta tiene `AbortController` y número de secuencia.
- Una respuesta abortada o vieja no cambia resultados, URL, spinner ni errores.
- Los recuentos Activos/Archivados no se sustituyen por ceros durante una búsqueda rápida.
- La revisión Realtime ya no muestra el aviso intermitente “Hay cambios nuevos”. Si la revisión
  realmente cambió, actualiza silenciosamente en segundo plano una sola vez por revisión y estado.
- El caché continúa siendo privado, en memoria, separado por negocio, estado y consulta.

### Interfaz final

- El spinner es sólo un icono y tiene un espacio reservado independiente de la X.
- La X es un botón propio, accesible, con foco visible; se ocultó el cancelador nativo de WebKit
  para impedir duplicados.
- Activos y Archivados usan exactamente la misma estructura: etiqueta arriba, cantidad abajo.
- En escritorio cualquier zona no interactiva de la fila abre la ficha.
- En mobile toda la tarjeta tiene un enlace superpuesto y el botón explícito se conserva.
- Formularios, botones y enlaces internos no disparan accidentalmente la navegación de la fila.
- Se eliminó el segundo CTA “+ Nuevo turno” que aparecía en el vacío de Agenda.

En la cuenta real de prueba, el primer resultado local se hizo visible en 17 ms en la pasada final,
muy por debajo del límite E2E de 500 ms.

## 3. Teléfono antes de crear un turno

### Estados funcionales

| Estado | Significado | `phone_e164` utilizable | Requiere aceptación |
| --- | --- | --- | --- |
| `valid` | móvil argentino completo, normalizado sin adivinar | sí | no |
| `missing` | no se ingresó ningún valor | no | sí |
| `invalid` | hay texto, pero no permite comunicación automática segura | no | sí |
| `unknown` | compatibilidad con turnos existentes o flujos externos sin esta decisión | no se presume | no |

La forma canónica para WhatsApp es `+54 9` más los diez dígitos nacionales. Se aceptan las formas
argentinas completas habituales, incluidas variantes locales con `0` y `15`, sólo cuando la
conversión es inequívoca. No se inventan códigos de área ni se considera válido un teléfono de
otro país bajo una regla argentina.

### Flujo de interfaz

Al pulsar “Confirmar turno”:

- si el teléfono es válido, continúa el flujo normal;
- si falta, aparece el bloque ámbar “Falta el número de teléfono”;
- si está presente pero es inválido, aparece “El número de teléfono no es válido”;
- no se envía la acción de creación mientras la advertencia esté pendiente.

“Agregar/Corregir número” cierra el bloque grande, remarca el campo, lo enfoca y selecciona su
contenido. Servicio, profesional o equipo, fecha, hora, paciente y nota permanecen intactos. El
campo no se pinta ámbar durante una escritura normal: sólo cuando requiere atención.

“Confirmar de todos modos” guarda una aceptación que debe coincidir con el problema actual. Si el
teléfono cambia, esa aceptación se invalida y la nueva entrada vuelve a comprobarse.

### Doble validación

La validación del navegador existe por fluidez, no por confianza. La acción de servidor:

1. vuelve a cargar el paciente seleccionado desde el negocio activo;
2. ignora un teléfono oculto manipulado si el usuario no declaró haberlo editado;
3. clasifica nuevamente el valor efectivo;
4. rechaza una aceptación que no coincida con `missing` o `invalid`;
5. revalida disponibilidad antes de escribir;
6. recién entonces crea el turno.

Si JavaScript está deshabilitado o la ficha cambia concurrentemente, el resultado del servidor
vuelve al mismo asistente y el componente sincroniza la advertencia sin perder el estado local.

### Paciente existente y paciente nuevo

- En una ficha existente, el campo se hidrata con `phone_raw`, `phone` o `phone_e164`, en ese orden.
- La ficha sólo se actualiza si el usuario modificó explícitamente el campo.
- Una corrección válida escribe el texto visible y el E.164 canónico.
- Una entrada inválida aceptada conserva el texto en `phone_raw`/`phone`, pero fuerza
  `phone_e164 = null`.
- Un paciente nuevo sin teléfono puede crearse después de la aceptación explícita.
- En Agenda, ningún teléfono —válido o inválido— identifica ni fusiona fichas. En reserva pública,
  una asociación automática sólo puede reutilizar una única coincidencia exacta de nombre
  normalizado + teléfono válido; cero o varias coincidencias crean una ficha separada.

Cuando el teléfono se corrige más adelante y vuelve a generar un `phone_e164` válido, recordatorios
y acciones de comunicación quedan habilitados normalmente.

### Después de confirmar de todos modos

La decisión queda ligada al turno. Al abrir el detalle con `created=1` no aparecen:

- “Último paso”;
- una nueva advertencia sobre teléfono;
- “Corregir teléfono del paciente”;
- enlace de activación o WhatsApp.

La supresión es doble: el servidor no construye el enlace y el componente no renderiza el bloque.
Esto también protege frente a una ficha histórica internamente contradictoria.

### Mensajería posterior

La cola automática y el procesador de envíos vuelven a normalizar estrictamente el destino:

- un teléfono no utilizable no genera un recordatorio en cola;
- una fila antigua de cola con destino no utilizable se marca como omitida con
  `PHONE_NOT_USABLE` antes de llamar al proveedor;
- recordatorios manuales, activación y reprogramación consumen la misma regla estricta.

La app no confía en que la mera presencia de `phone` o incluso de un E.164 legado implique que
WhatsApp es seguro.

## 4. Persistencia y atomicidad

### Migración `20260822020000_appointment_phone_decision.sql`

Agrega a `appointments`:

- `phone_communication_status_at_booking text not null default 'unknown'`;
- `phone_warning_acknowledged_at timestamptz`;
- restricción de valores `unknown | valid | missing | invalid`.

Los turnos existentes quedan en `unknown`, sin reinterpretar información histórica.

Los turnos individuales guardan estado y aceptación en el mismo `INSERT` del turno. Los turnos
conjuntos usan `create_joint_appointment_with_phone_decision`, un wrapper transaccional sobre el
RPC atómico existente: crea la reserva conjunta, actualiza la decisión y amplía el audit log dentro
de la misma transacción.

El nuevo RPC está revocado para `public`, `anon` y `authenticated`; sólo `service_role` puede
ejecutarlo después de la autorización de la acción de servidor.

### Migración `20260822021000_appointment_phone_decision_consistency.sql`

Agrega una segunda frontera SQL:

- `missing/invalid` exige `phone_warning_acknowledged_at is not null`;
- `unknown/valid` exige `phone_warning_acknowledged_at is null`.

Esto impide guardar decisiones parciales o contradictorias aunque una escritura futura no pase por
la aplicación actual.

### Verificación remota

- ambas migraciones quedaron registradas en el historial remoto;
- las dos restricciones fueron releídas desde `pg_constraint`;
- el RPC fue verificado como no ejecutable por `anon`/`authenticated` y ejecutable por
  `service_role`;
- la consulta de consistencia devolvió 0 filas inválidas.

La última relectura se hizo directamente contra PostgreSQL con `ON_ERROR_STOP`: confirmó las dos
versiones de migración, las definiciones completas de ambas restricciones, los tres privilegios del
RPC y el conteo de inconsistencias. Un intento posterior de repetir `supabase db push --dry-run`
quedó detenido durante la inicialización de la conexión y se interrumpió; no se tomó ese intento
como evidencia. Una pasada anterior del mismo dry-run sí había informado que remoto estaba al día.

## 5. Auditoría lateral de consultas de turnos

Se revisaron todas las lecturas directas de `appointments` en rutas y servicios.

- Recordatorios, Web Push y despachos automáticos ya aplican ventana futura/estado recordable y
  revalidan antes de enviar.
- Google Calendar y callbacks consultan un turno concreto por identificador/token; no son listas
  operativas.
- Reprogramación y slots consultan el turno concreto que el usuario decidió modificar.
- Agenda diaria/semanal e historial profesional son vistas históricas explícitas y se conservaron.
- Detalle directo conserva turnos terminales porque es el registro administrativo del evento.

No quedó otra lista genérica de “próximos” que mezcle fechas pasadas o estados terminales.

## 6. Evidencia de pruebas

Todas las ejecuciones pesadas se hicieron en secuencia y con un solo worker.

### Estática y unidades

- `svelte-check`: 0 errores y 0 advertencias.
- Vitest servidor completo: 81 archivos, 641 pruebas aprobadas.
- Vitest cliente completo: 4 archivos, 40 pruebas aprobadas.
- Suite focal servidor/utilidades: 9 archivos, 107 pruebas aprobadas.
- Suite focal UI: 2 archivos, 7 pruebas aprobadas.
- `git diff --check`: aprobado.

### Integración E2E específica

- 4/4 recorridos aislados aprobados:
  - búsqueda inmediata, simetría, fila completa y próximos turnos;
  - inválido → corregir → válido;
  - faltante → confirmar de todos modos;
  - inválido presente → confirmar de todos modos.
- En los cuatro se comprobó el estado real en Supabase y la limpieza posterior dejó 0 fixtures.
- Auditoría de sólo lectura sobre la cuenta real: 1/1 aprobada en desktop y mobile; 17 ms de
  latencia local final.
- Regresión larga de roles/Agenda: 1/1 aprobada de forma aislada después de corregir teléfonos
  inválidos del fixture y exigir el contrato real de redirección de SvelteKit.
- Flujo operativo público completo: 1/1 aprobado de forma aislada.
- Seguimientos: 5/5 aprobados compartiendo una sola sesión, sin debilitar el rate limit de login.

La primera matriz global encontró defectos de la cobertura, no del flujo final: dos textos
obsoletos, teléfonos sintéticos inválidos aceptados antes por una aserción demasiado amplia, una
búsqueda de Seguimientos cuyo fixture administrativo elegía pacientes sin limitar el consultorio y
el uso repetido de una misma cuenta hasta activar correctamente el rate limit. Cada caso fue
aislado, corregido y repetido.

La matriz global final, con fixtures destructivos explícitamente habilitados y un solo worker,
terminó en 20/20 pruebas aplicables aprobadas, 0 fallas y 6 omisiones declaradas en 6,5 minutos. Las
omisiones corresponden a condiciones que este entorno no ofrece: credencial maestra, dos pruebas
de archivos que exigen Supabase local, Google interactivo real y dos recorridos exclusivos del modo
demo. Ninguna omisión cubre Pacientes, próximos turnos, teléfono, Agenda, roles, seguimiento,
autenticación normal ni la auditoría desktop/mobile solicitada.

Para conservar el rate limit real, el arnés guarda la sesión únicamente en memoria durante el
worker y la reutiliza entre archivos. No escribe cookies ni tokens al disco. Seguimientos también
comparte un único contexto entre sus cinco casos y su paciente de referencia se obtiene con el
`business_id` exacto de la cuenta probada.

### Build

- build SvelteKit de producción: aprobado;
- `node scripts/netlify-build.mjs`: aprobado;
- `pnpm audit --audit-level high`: 0 vulnerabilidades conocidas;
- no se ejecutó deploy.

### Limpieza de fixtures

La consulta final contra el Supabase remoto devolvió 0 para cada grupo creado por las pruebas:

- negocios temporales de Pacientes UX y roles/Agenda;
- allowlist y usuarios owner de esos negocios;
- pacientes `E2E` y `Pruebaautomatizada` del consultorio real;
- profesionales y servicios `E2E` del consultorio real;
- mensajes de Seguimientos con marcador `E2E-SEG`.

## 7. Hallazgos cerrados durante la auditoría

- carrera al borrar una consulta antes de que respondiera el servidor;
- spinner y X compartiendo espacio;
- resultados locales incapaces de ampliarse al borrar caracteres;
- segundo CTA duplicado en el vacío de Agenda;
- estado ámbar durante una escritura normal del teléfono;
- aceptación explícita que podía depender de un E.164 histórico inconsistente;
- filtro terminal disponible dentro de “Cualquier día”;
- fixture E2E con `phone`, `phone_raw` y `phone_e164` aleatorios y distintos;
- pruebas de acción que consideraban éxito cualquier respuesta menor a 500;
- cinco logins repetidos para cinco casos de Seguimientos;
- autenticaciones repetidas de la misma cuenta entre archivos E2E;
- selección administrativa de un paciente de otro consultorio en una prueba de Seguimientos;
- limpieza incompleta de pacientes públicos cuyo prefijo era `Pruebaautomatizada`.

## 8. Fuera de alcance

- No se alteró la historia clínica ni se eliminaron turnos pasados.
- No se cambió el contrato de reservas públicas existente, salvo la revalidación defensiva de
  canales antes de comunicar.
- No se agregó edición de imágenes ni cambios al almacenamiento clínico.
- No se implementaron backup externo, recuperación, exportación ni purga controlada.
- No se publicó el código en GitHub ni Netlify.
