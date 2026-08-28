# Implementacion detallada

## 1. Objetivo de producto

Permitir que el dueño o un administrador directo de un consultorio se lleve la
informacion tabular de sus pacientes en un archivo Excel verificable.
La funcion responde a la objecion comercial de perder acceso a los datos al
dejar de usar Cita Suite.

Texto de alcance propuesto:

> Podes exportar en Excel tus pacientes, su ficha e historial clinico, turnos y
> seguimientos. No incluye radiografias ni archivos adjuntos.

No se presenta como backup completo ni como mecanismo de restauracion dentro de
Cita Suite. El formato versionado debe, sin embargo, permitir consulta directa e
importacion por otro sistema.

## 2. Alcance funcional

### 2.1 Modalidades

- Individual: desde el detalle de un paciente.
- Global: desde `/odonto/exportar-datos` y desde el acceso habitual de
  Configuracion.
- Ambas modalidades usan el mismo recurso de exportacion, las mismas hojas, los
  mismos nombres de columnas y el mismo serializador.
- Las hojas sin filas se conservan en el workbook.

### 2.2 Acceso comercial

- Permitido: `active`, `grace` y `restricted`, siempre que `canEnterApp` sea
  verdadero y la membresia directa sea owner/admin.
- Denegado: `archived`, pausa manual (`commercial_access_enabled=false`),
  membresia deshabilitada, pendiente o revocada.
- El acceso restringido permite exclusivamente leer los datos exportables y
  generar la salida; no habilita mutaciones clinicas.

### 2.3 Exclusiones v1

- Radiografias, miniaturas y originales.
- Archivos adjuntos, imagenes y PDF.
- Tokens, hashes, claves de contacto, huellas antiabuso y datos de integraciones.
- Identificadores de autenticacion internos cuando existe un identificador de
  entidad profesional o de negocio util.
- Logs tecnicos, auditoria interna y eventos de sistema.
- Datos eliminados fisicamente antes de iniciar la exportacion.

## 3. Autorizacion

La autorizacion no debe derivarse unicamente de `BusinessContext.role`, porque
la asistencia temporal se representa como admin efectivo.

Cada operacion de inicio, pagina, validacion y cancelacion debe comprobar:

1. Usuario autenticado.
2. Actor obtenido por el backend desde una sesion ya validada.
3. Sesion de exportacion perteneciente a ese mismo actor.
4. Fila directa en `business_users` para el consultorio.
5. Rol directo `owner` o `admin`.
6. Membresia activa y aceptada segun el contrato real de la tabla.
7. Ausencia de acceso archivado o pausado manualmente.
8. Alcance del paciente dentro del mismo `business_id` cuando sea individual.

La ID de exportacion no es una credencial. Debe ser aleatoria, no enumerable y
siempre volver a validarse contra usuario, consultorio y permisos actuales.

Se mantiene defensa en profundidad:

- Los RPC del control plane se revocan a `anon` y `authenticated`; solo el
  backend con `service_role` puede ejecutarlos y debe pasar el actor explicito.
- El navegador solo habla con los cuatro endpoints HTTP y nunca recibe la
  credencial privilegiada.
- Filtro explicito por `business_id` y, en modo individual, `patient_id`.
- Las funciones `security definer` fijan `search_path`, califican tablas,
  revocan acceso publico y conceden solo lo indispensable.
- No se entrega una operacion de exportacion directa al navegador fuera de los
  endpoints del servidor.

## 4. Recurso y contrato HTTP

### 4.1 Crear sesion

`POST /api/odonto/exportaciones`

Entrada global:

```json
{
  "scope": "all_patients",
  "request_key": "uuid-generado-por-el-cliente"
}
```

Entrada individual:

```json
{
  "scope": "patient",
  "patient_id": "uuid",
  "request_key": "uuid-generado-por-el-cliente"
}
```

Respuesta `201`:

```json
{
  "reused": false,
  "export_id": "uuid",
  "scope": "all_patients",
  "schema_version": "cita-suite-patient-export/v1",
  "expected_counts": {
    "patients": 0,
    "custom_fields": 0,
    "clinical_entries": 0,
    "appointments": 0,
    "appointment_professionals": 0,
    "follow_ups": 0
  },
  "datasets": [
    "patients",
    "custom_fields",
    "clinical_entries",
    "appointments",
    "appointment_professionals",
    "follow_ups"
  ],
  "business": {
    "name": "Consultorio",
    "timezone": "America/Argentina/Buenos_Aires"
  },
  "expires_at": "2026-08-27T20:00:00Z"
}
```

El inicio consume el rate limit antes de leer datos. La escritura de sesion, el
evento `requested`, la captura de huella/conteos y el bloqueo global se
realizan de forma atomica o la operacion no comienza.

`request_key` hace idempotente un reintento de red del mismo intento. No es una
credencial y no se reutiliza para una exportacion nueva.

### 4.2 Obtener paginas

`GET /api/odonto/exportaciones/{id}/hojas/{sheet}?cursor={opaque}`

Respuesta:

```json
{
  "export_id": "uuid",
  "dataset": "patients",
  "rows": [],
  "row_count": 0,
  "next_cursor": null,
  "done": true
}
```

Reglas:

- Hoja perteneciente a un enum fijo; nunca nombre de tabla recibido del cliente.
- Cursores opacos o validados, deterministas y basados en claves estables.
- Orden total por claves permitidas; no se usa offset para datasets mutables.
- Limite inicial objetivo: 200 filas por pagina, ajustable por medicion.
- Limite adicional de aproximadamente 1,5 MB de JSON por pagina para notas
  extensas; siempre avanza al menos una fila y nunca trunca su contenido.
- Cada pagina revalida usuario, membresia directa, estado comercial, sesion y
  alcance.
- No se devuelve la siguiente pagina ante una inconsistencia.

La huella completa no se recalcula en cada pagina porque eso multiplicaria el
costo de la exportacion. Se captura al inicio y se recalcula una sola vez al
final; cualquier insercion, edicion o borrado concurrente invalida todo el
intento antes de construir el archivo.

### 4.3 Validar dataset

`POST /api/odonto/exportaciones/{id}/validaciones`

Entrada:

```json
{
  "received_counts": {
    "patients": 0,
    "custom_fields": 0,
    "clinical_entries": 0,
    "appointments": 0,
    "appointment_professionals": 0,
    "follow_ups": 0
  }
}
```

El servidor vuelve a comprobar la huella criptografica del conjunto, permisos,
expiracion y conteos. Si son validos, pasa la sesion a `dataset_validated` y
responde `{ "validated": true }`. Solo entonces el Web Worker construye el
XLSX. `Informacion` y `Textos extensos` son hojas derivadas en el navegador y
por eso no aparecen como datasets paginables.

El servidor no afirma que el archivo fue descargado o guardado.

### 4.4 Cancelar

`DELETE /api/odonto/exportaciones/{id}`

Marca la sesion como `cancelled` y libera el bloqueo. La cancelacion es
idempotente.

### 4.5 Contrato de errores

Respuesta interna estable:

```json
{
  "error": {
    "code": "EXPORT_DATA_CHANGED",
    "message": "Los datos cambiaron mientras preparabamos el archivo. Intenta nuevamente.",
    "retryable": true
  }
}
```

Codigos previstos:

- `EXPORT_INVALID_REQUEST`
- `EXPORT_NOT_AUTHENTICATED`
- `EXPORT_NOT_AUTHORIZED`
- `EXPORT_PATIENT_NOT_FOUND`
- `EXPORT_IN_PROGRESS`
- `EXPORT_RATE_LIMITED`
- `EXPORT_RATE_LIMIT_UNAVAILABLE`
- `EXPORT_SESSION_EXPIRED`
- `EXPORT_DATA_CHANGED`
- `EXPORT_COUNT_MISMATCH`
- `EXPORT_DEPENDENCY_UNAVAILABLE`
- `EXPORT_CANCELLED`
- `EXPORT_UNEXPECTED`

Los codigos no se muestran literalmente en la UI. Los errores de autorizacion,
validacion y reglas de negocio no se reintentan automaticamente. Solo se
reintenta una vez una inconsistencia de huella al reiniciar toda la sesion; no
se mezclan paginas de dos sesiones.

## 5. Modelo de base de datos

### 5.1 Huella de consistencia sin costo sobre escrituras

No se crea una tabla de revisiones ni triggers sobre tablas clinicas. Esa
alternativa agregaria trabajo permanente a altas y ediciones aunque nadie
exportara, contradiciendo la puerta de rendimiento.

Una funcion privada calcula una huella SHA-256 solo dos veces por intento:

1. al crear la sesion, junto con los conteos esperados;
2. al validar el dataset ya recibido por el navegador.

La entrada de la huella contiene, en orden determinista, el identificador y la
version MVCC `xmin` de cada fila relevante dentro del alcance:

- consultorio;
- `patients`;
- `patient_clinical_profiles`;
- `clinical_entries`;
- `clinical_entry_costs`;
- `appointments`;
- `appointment_professionals`;
- `follow_ups`;
- profesionales cuyos nombres se resuelven en la salida.

Para una exportacion individual solo participan la persona y sus relaciones.
El hash ordenado detecta altas, bajas y ediciones, incluso si una transaccion
comenzo antes del intento y confirma despues. Un cambio que luego revierte
tambien cambia `xmin`, por lo que genera como maximo un reintento seguro, nunca
un archivo mezclado. La huella y todos los conteos de cada medicion se obtienen
en una unica sentencia SQL y por lo tanto desde la misma fotografia de lectura.

Esta estrategia hace dos recorridos adicionales unicamente durante la
exportacion. Las escrituras, cargas y navegaciones existentes no ejecutan
ninguna funcion, trigger ni consulta nueva.

### 5.2 Tabla de sesiones

Tabla propuesta `patient_export_sessions`:

- `id uuid primary key`
- `business_id uuid not null`
- `requested_by_user_id uuid not null`
- `scope text check ('patient', 'all_patients')`
- `patient_id uuid null`
- `request_key uuid not null`
- `schema_version text not null`
- `dataset_fingerprint text not null`
- `expected_counts jsonb not null`
- `status text check ('requested', 'streaming', 'dataset_validated', 'failed',
  'expired', 'cancelled')`
- `failure_code text null`
- `created_at timestamptz not null`
- `last_accessed_at timestamptz not null`
- `expires_at timestamptz not null`
- `validated_at timestamptz null`
- `finished_at timestamptz null`

No guarda contenido clinico. Una restriccion parcial permite una sola sesion
global activa por consultorio. La funcion de inicio expira primero locks
vencidos, luego intenta crear el nuevo lock dentro de la misma transaccion.

La combinacion `(requested_by_user_id, request_key)` es unica para que un
reintento de transporte devuelva la misma sesion sin duplicar datos ni locks.

Las sesiones vencidas se limpian de forma perezosa en inicio/acceso y mediante
el mecanismo periodico disponible que se confirme en fase 1. El sistema no debe
depender del navegador para liberar un lock.

### 5.3 Auditoria

Eventos autoritativos:

- `patient_export_requested`
- `patient_export_dataset_validated`
- `patient_export_failed`
- `patient_export_expired`
- `patient_export_cancelled`

Metadatos permitidos:

- `export_id`
- alcance y `patient_id` solo en exportacion individual
- version de esquema
- conteos por conjunto
- duracion
- cantidad de paginas/bytes
- resultado y motivo categorizado

Metadatos prohibidos:

- nombres, DNI, telefonos y correos
- texto clinico
- valores personalizados
- tokens o credenciales

La auditoria de inicio y validacion es fail-closed. No se usa el helper actual
que absorbe errores sin devolver resultado.

### 5.4 Rate limits

Agregar acciones en TypeScript y SQL:

- `patient_export_individual_by_user`
- `patient_export_global_by_business`

Se aplican antes de las consultas de dataset. Un fallo interno del limitador es
fail-closed porque es una operacion sensible y costosa. Los valores definitivos
se fijan en fase 1; objetivo inicial conservador:

- individual: 10 inicios por usuario cada 10 minutos
- global: 2 inicios por consultorio por hora
- una global activa por consultorio

Cancelar o expirar no consume un nuevo inicio.

## 6. Fuentes y listas de campos

No se consulta la carga actual de la pagina de paciente: esta pagina limita
historial y turnos y excluye archivados.

Los identificadores enumerados en esta seccion pertenecen exclusivamente al
protocolo privado entre servidor y generador. Se usan para relacionar filas en
memoria y comprobar integridad; el contrato visible vigente
`CONTRATO-XLSX-V2.md` prohibe escribirlos en el Excel. Toda relacion visible se
resuelve a nombre de paciente, DNI, nombre profesional, fecha y contexto del
registro.

### 6.1 Pacientes

Fuente: `patients` y perfil canonico `patient_clinical_profiles`.

Campos permitidos:

- `patient_id`
- nombre completo
- DNI
- telefono
- email
- fecha de nacimiento
- direccion
- obra social
- plan
- alergias
- medicacion
- antecedentes
- alerta clinica si existe en el esquema vigente
- notas clinicas si existen en el esquema vigente
- estado activo/archivado
- `archived_at`
- `created_at`
- `updated_at`

Los campos se deben confirmar contra el esquema real en fase 1. No se exportan
normalizaciones de busqueda, telefono hasheado, flags antiabuso ni owner IDs.

### 6.2 Campos personalizados

Una fila por clave superior de `custom_fields`:

- `patient_id`
- `field_key`
- `field_label` (igual a clave si no existe catalogo)
- `value_type`: `string`, `number`, `boolean`, `null`, `object`, `array`
- `value_text`: representacion humana para escalares
- `value_json`: serializacion canonica solo para objetos/listas

El identificador y el tipo permiten validar el transporte privado. En el Excel,
solo se muestran nombre, DNI, etiqueta y un valor en castellano. Objetos y
listas se convierten a lineas con etiquetas y valores, sin JSON visible.

### 6.3 Historial clinico

Fuentes: `clinical_entries`, `clinical_entry_costs` y profesional/usuario solo
para obtener una identidad exportable segura.

Incluir entradas activas y archivadas con:

- `clinical_entry_id`
- `patient_id`
- fecha/hora
- tipo
- descripcion
- piezas
- nota interna
- importe desde la fuente canonica de costos
- profesional creador ID/nombre cuando se pueda resolver sin auth user ID
- estado y `archived_at`
- fechas de creacion/actualizacion disponibles

### 6.4 Turnos

Fuente: `appointments`.

Incluir todos los estados persistidos y traducirlos a texto humano:

- `appointment_id`
- `patient_id`
- inicio y fin
- estado
- origen
- servicio snapshot
- nota interna permitida
- profesional principal snapshot
- fechas de confirmacion, cancelacion y pedido de reprogramacion
- motivo de cancelacion permitido
- `created_at` y `updated_at`

Excluir tokens, fingerprints, claves de contacto, Google Calendar IDs y datos
antiabuso.

### 6.5 Profesionales por turno

Fuente: `appointment_professionals` y snapshot/nombre profesional seguro.

- `appointment_id`
- `patient_id`
- `professional_id`
- nombre
- orden o indicador de principal si el modelo lo permite

### 6.6 Seguimientos

Fuente: `follow_ups`.

- `follow_up_id`
- `patient_id`
- fecha de recordatorio
- mensaje
- estado
- profesional asignado ID/nombre
- `done_at`
- `created_at`
- `updated_at`

Excluir `created_by` si es auth user ID sin valor de portabilidad.

## 7. Serializacion XLSX

### 7.1 Arquitectura cliente

- Modulo de orquestacion cargado solo en rutas autorizadas.
- `write-excel-file` `4.1.1` importada solamente dentro de un Web Worker
  dedicado al iniciar la construccion.
- Transformacion, XML y compresion se ejecutan fuera del hilo principal.
- El hilo principal recibe solamente progreso, exito o error normalizado.
- No se precarga ni prefetch la dependencia.
- El worker se termina y libera referencias al finalizar/cancelar.
- El Blob y su Object URL se revocan luego de iniciar la descarga.

La eleccion se fijo en fase 1 por su entrada ESM especifica para navegador,
licencia MIT, dependencia unica (`fflate`), soporte de multiples hojas y tipos
de celda explicitos. Un spike de 50.000 filas por 12 columnas produjo un XLSX
de 3,37 MB en 5,75 s y uso 487 MB de RSS maximo en esta PC. Esa carga excede
ampliamente el caso habitual y confirma que debe permanecer en Worker.

La libreria no escapa por si sola todos los controles OOXML. Antes de entregarle
un string, el adaptador propio debe:

- proteger secuencias literales con forma `_xHHHH_`;
- codificar retornos de carro y controles XML no permitidos con escapes OOXML;
- declarar siempre `type: String` para texto controlado por usuarios.

Los tests reabren el ZIP/XML y un lector real para verificar que este adaptador
no convierta texto en formulas ni corrompa secuencias de escape.

### 7.2 Tipos

- Todo texto controlado por usuarios se escribe como `string`/shared string.
- DNI, telefono, UUID y codigos son texto.
- Fecha de nacimiento es texto `YYYY-MM-DD`.
- Instantes son ISO 8601 con offset/UTC y timezone documentada en Informacion.
- Importes son numericos solo cuando el valor fuente sea numerico finito.
- Booleanos personalizados conservan tipo mediante columna `value_type`.
- No se crean formulas, macros, external links ni data connections.

### 7.3 Textos extensos

Si un valor excede el limite seguro de caracteres o saltos de linea:

1. La celda original contiene un `text_ref` generado para el workbook.
2. `Textos extensos` recibe filas ordenadas con:
   - `text_ref`
   - entidad
   - ID de entidad
   - campo
   - parte
   - total de partes
   - texto
3. La division no corta pares sustitutos Unicode.
4. La concatenacion ordenada reproduce exactamente el texto original.

La hoja existe siempre, aunque no tenga datos.

### 7.4 Archivo

- Global: `cita-suite-pacientes-YYYYMMDD-HHmm.xlsx`
- Individual: `cita-suite-paciente-YYYYMMDD-HHmm.xlsx`
- No contiene nombre, DNI, telefono, UUID ni consultorio en el filename.
- MIME oficial de XLSX.

## 8. Contrato visual y UX

### 8.1 Pantalla global

Ruta `/odonto/exportar-datos`.

Contenido:

- Titulo `Exportar datos`.
- Explicacion breve del proposito de la exportacion.
- Lista clara de lo incluido.
- El detalle contractual de radiografias/adjuntos excluidos permanece en
  Terminos y Privacidad; por decision de producto no se muestra como cartel
  independiente en esta pantalla.
- Ultima aclaracion de que no modifica datos.
- CTA dominante `Preparar archivo Excel`.
- Indicacion de que puede tardar y que la pestana debe permanecer abierta.
- Progreso por etapas/hojas, no porcentaje ficticio.
- Accion `Cancelar` mientras esta en curso.
- Exito con conteos y accion de descarga/reintento si el navegador la bloquea.

### 8.2 Paciente individual

- Accion al final de la ficha, dentro de una seccion secundaria `Exportar datos`.
- Solo se renderiza para owner/admin directo.
- Confirmacion con nombre del paciente visible en UI, no en filename.
- Reutiliza el mismo componente de progreso y resultado.

### 8.3 Acceso restringido

- La ruta se agrega explicitamente al allowlist de lectura restringida.
- Se ofrece un enlace visible desde el bloqueo comercial y/o Pacientes.
- No se muestra para estado archivado o pausa manual.
- El servidor repite la autorizacion; el enlace no concede acceso.

### 8.4 Estados y accesibilidad

- Idle, validando, obteniendo datos, verificando, construyendo archivo, listo,
  cancelado, expirado y error.
- `aria-live` para cambios de estado.
- Foco llevado al resumen de error o exito.
- Botones con foco visible y objetivos tactiles comodos.
- No se ofrecen acciones invalidas en estados terminales.
- Mobile sin overflow; textos largos pueden partir lineas.
- No se usa skeleton para disimular latencia de exportacion.

## 9. Rendimiento

### 9.1 Principio

La feature no debe alterar el costo normal de abrir Agenda, lista de pacientes,
detalle de paciente, guardar una entrada clinica ni editar un turno.

### 9.2 Baseline obligatorio antes de codigo funcional

Registrar en `BITACORA.md`:

- SHA y estado de worktree.
- Tamano del Worker y chunks del build actual.
- Requests/carga de la lista y detalle en las pruebas disponibles.
- Tiempo comparable de una escritura clinica y una operacion de turno si existe
  un entorno seguro y repetible.
- Tests de contrato de cache/navegacion existentes.

### 9.3 Controles de no regresion

- La dependencia XLSX no aparece en el chunk inicial ni en el Worker servidor.
- Ninguna ruta existente agrega consultas de exportacion durante `load`.
- Los botones se deciden con permisos ya disponibles o una capacidad liviana;
  no disparan lecturas de dataset.
- No se invalida el cache de lista por sesiones o progreso de exportacion.
- El worker cliente solo existe durante una exportacion.
- Comparar antes/despues con mismos datos y mismos comandos.
- Umbral de aceptacion inicial: sin requests adicionales y diferencia de tiempo
  dentro del ruido de medicion; cualquier degradacion repetible superior al 5%
  en escrituras o navegacion bloquea la publicacion.

## 10. Pruebas

### 10.1 Base de datos/autorizacion

- Owner directo permitido.
- Admin directo permitido.
- Profesional denegado.
- Asistencia temporal denegada.
- Miembro pendiente/deshabilitado denegado.
- Usuario de otro consultorio denegado.
- Rol revocado entre paginas denegado y sesion fallida.
- Restricted permitido; archived y pausa manual denegados.
- Una global simultanea; lock vencido se recupera.
- Auditoria fail-closed.
- Rate limiter real bloquea; dependencia del limitador degradada bloquea.

### 10.2 Completitud

- Mas de 1.000 pacientes, entradas y turnos.
- Paginacion sin duplicados ni omisiones.
- Conteos exactos por fuente.
- Activos, archivados, pasados, futuros, cancelados y reprogramacion solicitada.
- Turnos conjuntos con todos sus profesionales.
- Seguimientos pending/done.
- Cambio concurrente invalida la sesion completa mediante una huella distinta.
- Dos consultorios nunca mezclan filas.

### 10.3 XLSX

- Hojas y encabezados exactos v1, incluidas hojas vacias.
- Cero formulas despues de reabrir.
- Valores `=`, `+`, `-`, `@`, tabs, CR/LF y Unicode conservados.
- DNI, telefonos, UUID y ceros iniciales como texto.
- Fecha de nacimiento e instantes conservados.
- `custom_fields` string/number/boolean/null/object/array reconstruibles.
- Texto >32.767 y >253 saltos reconstruible exactamente.
- Archivo abre con un lector XLSX y sus conteos coinciden.
- Nombre y MIME correctos.
- Cancelacion termina worker y revoca recursos.

### 10.4 UI/integracion

- Visibilidad por rol en global e individual.
- Flujo active, grace y restricted.
- Progreso, cancelacion, expiracion, conflicto y error de dependencia.
- Doble clic no crea dos sesiones.
- Navegacion fuera de la pagina cancela/limpia sin dejar estado global bloqueado.
- Recarga, cierre de pestana y navegacion externa activan cancelacion inmediata
  mediante `pagehide` y un `DELETE keepalive`; el TTL sigue siendo respaldo.
- Desktop y viewport movil representativo sin overflow.
- Sin errores ni warnings de consola.

### 10.5 Cierre secuencial de bajo consumo

1. Tests focalizados con `--maxWorkers=1 --no-file-parallelism`.
2. `pnpm --filter web check`.
3. Suite servidor/cliente secuencial.
4. Build Cloudflare.
5. Wrangler dry-run.
6. E2E secuencial de exportacion y rutas adyacentes.
7. Auditoria de dependencias.
8. `git diff --check` y escaneo de secretos.

## 11. Fases y puertas de salida

### Fase 0 - Especificacion

- Crear y aprobar estos documentos.
- No modificar codigo funcional.

### Fase 1 - Baseline e inventario

- Confirmar columnas, estados, membresia y RLS reales.
- Medir baseline y elegir libreria XLSX.
- Resolver estrategia de revision sin regresion.
- Actualizar este documento si el codigo obliga a cambiar algo.

### Fase 2 - Base de datos y servidor

- Migracion, funciones, indices, permisos y rate limits.
- Modulo servidor tipado y endpoints.
- Pruebas de aislamiento, errores y concurrencia.

### Fase 3 - XLSX

- Contrato v1, transformadores puros, textos extensos y worker.
- Pruebas de lectura posterior, formulas, tipos, memoria y lazy loading.

### Fase 4 - UI

- Pantalla global, accion individual, restricted y terminos.
- Estados accesibles, responsive y copy final.

### Fase 5 - Auditoria

- Regresion funcional adyacente, seguridad, rendimiento y suite secuencial.
- Corregir causa raiz de cualquier fallo antes de publicar.

### Fase 6 - Publicacion

- Releer documentacion y diff completo.
- Aplicar migraciones Supabase y verificar objetos/politicas.
- Stagear solamente archivos de la feature y documentacion.
- Commit y push a `main` autorizados por el usuario.
- Verificar `HEAD`, `origin/main`, `git ls-remote` y despliegue Cloudflare por
  separado.
- Smoke de produccion sin exponer datos reales ni credenciales.

## 12. Riesgos que bloquean publicacion

- Asistencia temporal puede iniciar o leer una exportacion.
- Dataset puede truncarse a 1.000 sin error.
- Huella no cubre una tabla o nombre exportado.
- La implementacion agrega trabajo a una escritura o carga normal.
- XLSX llega al bundle inicial o al Worker servidor.
- Workbook puede contener formulas o truncar texto.
- Sesion abandonada deja lock permanente.
- Restricted oculta o bloquea la unica salida de datos.
- Terminos/promesa dicen `todos los datos` mientras se excluyen archivos.
- Auditoria o rate limit fallan abiertos.
- Se publican archivos ajenos o artefactos Playwright.
