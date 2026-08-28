# Bitacora de implementacion

Registro append-only de fases, decisiones y verificaciones. Las correcciones se
agregan como entradas nuevas; no se reescribe el historial para ocultar fallos.

## 2026-08-27 - Fase 0 iniciada

Documentos consultados antes de actuar:

- Instrucciones generales y memoria del proyecto.
- Guia de diseno de API.
- Guia de manejo de errores.
- Guia de diseno de interfaz.
- Propuesta y revisiones previas de exportacion.

Estado inicial del repositorio:

- Rama `main` alineada visualmente con `origin/main` antes de fetch remoto.
- Cambios ajenos preexistentes que deben preservarse:
  - `apps/web/tailwind.config.js`
  - `Auditoria final pre lanzamiento.md`
  - `apps/web/output/playwright/**`
- No se modifico codigo funcional antes de crear esta documentacion.

Decisiones fijadas:

- Owner/admin directo unicamente; asistencia temporal denegada.
- XLSX construido en Web Worker luego de dataset validado.
- API basada en sesiones y cursores.
- Esquema v1 estable con seguimiento y texto extenso.
- Dependencia XLSX lazy.
- Auditoria y rate limit fail-closed.
- Acceso restringido conserva la salida de datos.
- Rendimiento existente es una puerta de publicacion.

Siguiente paso exacto:

1. Releer los tres documentos rectores.
2. Levantar baseline y confirmar el esquema real.
3. Elegir libreria XLSX y estrategia de consistencia mediante medicion antes de
   modificar flujos funcionales.

## 2026-08-27 - Fase 0 completada y Fase 1 abierta

Consulta obligatoria realizada:

- `README.md`: leido completo.
- `IMPLEMENTACION.md`: leido completo en dos segmentos hasta EOF.
- `CONTRATO-XLSX-V1.md`: leido completo.
- Ultima entrada de esta bitacora: leida y confirmada.

Resultado de Fase 0:

- Existen cuatro documentos bajo `docs/exportacion-datos/` con 1.014 lineas.
- Se fijaron alcance, seguridad, API, datos, XLSX, UI, rendimiento, pruebas,
  fases y publicacion.
- No se modifico codigo funcional.
- Se preservan los cambios ajenos detectados al inicio.

Fase 1 queda habilitada exclusivamente para lectura, inventario, baseline y
spikes descartables/controlados. No se implementa aun el flujo funcional.

Siguiente paso exacto:

1. Confirmar SHA/divergencia y estructura real de tablas/capacidades.
2. Medir artefactos y tests de rendimiento existentes sin procesos pesados en
   paralelo.
3. Comparar librerias XLSX compatibles con Web Worker y elegir una.
4. Resolver la estrategia de consistencia con evidencia de costo.

## 2026-08-27 21:48 - Reconsulta por compactacion durante Fase 1

La interfaz compacto el contexto mientras Fase 1 seguia abierta. Antes de
reanudar se cumplio nuevamente el protocolo:

- `README.md`: leido completo.
- `IMPLEMENTACION.md`: leido completo hasta EOF.
- `CONTRATO-XLSX-V1.md`: leido completo hasta EOF.
- Ultima entrada de esta bitacora: leida y punto de reanudacion confirmado.

Estado reconfirmado:

- `HEAD` sigue en `69145438dfde7d71ae7c847b89cc1a9c36fa9185`.
- Divergencia con `origin/main`: `0 0`.
- Se preservan sin tocar `apps/web/tailwind.config.js`,
  `Auditoria final pre lanzamiento.md` y `apps/web/output/playwright/**`.
- La maquina tiene 2,4 GiB disponibles y el swap esta ocupado; toda prueba
  pesada continuara de manera secuencial y con un solo worker.

Siguiente paso exacto: ejecutar los contratos focalizados de rendimiento y
navegacion sobre este baseline, registrar sus resultados y cerrar la decision
de consistencia sin agregar costo a las escrituras normales.

## 2026-08-27 21:58 - Fase 1 completada

Criterios de salida releidos antes de cerrar la fase: columnas, estados,
membresia, RLS, baseline, libreria y consistencia quedaron confirmados.

Baseline de repositorio y build, previo al codigo funcional:

- `HEAD`, `origin/main` y remoto: `69145438dfde7d71ae7c847b89cc1a9c36fa9185`;
  divergencia `0 0`.
- Build Cloudflare: exitosa en 38,78 s, RSS maximo 1.231.628 KB.
- Tamano `.svelte-kit/cloudflare`: 1.334.922 bytes.
- Cliente: 1.362.113 bytes; servidor: 1.969.846 bytes.
- Mayor chunk JavaScript inicial: 204.409 bytes; mayor nodo: 97.801 bytes;
  CSS: 74.601 bytes.
- Los contratos focalizados existentes pasaron en tres ejecuciones
  secuenciales: 23 + 11 + 4 = 38 tests, sin paralelismo de archivos.
- No se hicieron escrituras de medicion contra datos reales porque no existe
  aun un fixture remoto aislado y autorizado. La arquitectura elegida no agrega
  ningun trigger, consulta ni codigo a los caminos normales de escritura.

Inventario confirmado:

- Autorizacion directa: `business_users` activa, aceptada y con rol `owner` o
  `admin`; `BusinessContext.role` solo no alcanza porque asistencia se mapea a
  `admin`.
- `restricted` admite lectura de manager mientras `commercial_access_enabled`
  siga activo; `archived` y pausa manual se deniegan.
- Fuentes canonicas: `patient_clinical_profiles`, `clinical_entry_costs`,
  `appointments`, `appointment_professionals` y `follow_ups`.
- Estados finales de turno: `reserved`, `confirmed`, `cancelled` y
  `reschedule_requested`.
- Se excluyeron campos tecnicos de telefono, tokens, huellas, IDs de calendario
  e IDs de usuarios Auth.

Decision de consistencia:

- Se descarto `business_export_revisions` y cualquier trigger de revision.
- Una huella SHA-256 ordenada por ID y `xmin`, junto con conteos tomados en una
  unica sentencia, se calcula solo al inicio y al validar.
- Esta eleccion detecta altas, bajas, cambios, transacciones confirmadas entre
  paginas y reversiones, sin costo permanente para guardados normales.
- `IMPLEMENTACION.md`, `README.md` y el contrato se actualizaron antes de crear
  funciones de base de datos.

Decision XLSX y evidencia:

- Elegida y fijada `write-excel-file@4.1.1` (MIT), con una unica dependencia
  runtime `fflate@0.8.3`; `fflate` se declaro tambien como dependencia de
  desarrollo para inspeccionar el ZIP/XML en tests.
- El primer `pnpm add` fallo sin modificar archivos por cambio de store de VS
  Code; se repitio usando el store ya enlazado, sin reinstalar el workspace.
- Spike adversarial: multiples hojas, Unicode, ceros iniciales y prefijos de
  formula quedaron como strings y el XML tuvo cero etiquetas `<f>`.
- Hallazgo corregible obligatorio: la libreria no protege retornos de carro ni
  secuencias literales `_xHHHH_`; el adaptador propio aplicara escapes OOXML y
  tendra prueba de reapertura.
- Spike de capacidad: 50.000 filas x 12 columnas, 3.372.352 bytes, 5.745 ms y
  486.844 KB de RSS maximo. Por eso XML y compresion se ejecutaran dentro de un
  Web Worker cargado de forma diferida.

Archivos de la feature modificados durante Fase 1:

- `apps/web/package.json`
- `pnpm-lock.yaml`
- `docs/exportacion-datos/README.md`
- `docs/exportacion-datos/IMPLEMENTACION.md`
- `docs/exportacion-datos/CONTRATO-XLSX-V1.md`
- `docs/exportacion-datos/BITACORA.md`

Riesgos que pasan a las fases siguientes:

- Probar la huella y la autorizacion con base real/local antes de desplegar.
- Verificar que el Worker y `write-excel-file` formen solo chunks diferidos y
  no entren al bundle servidor.
- Confirmar en reapertura real controles OOXML, formulas y textos extensos.

Punto exacto de reanudacion: antes de Fase 2 releer los tres documentos y esta
entrada; luego crear una unica migracion autocontenida con sesiones, huella,
auditoria, limpieza y rate limits, seguida por el modulo servidor y endpoints.

## 2026-08-27 22:00 - Fase 2 abierta

Consulta obligatoria realizada antes de codigo de base de datos/servidor:

- `README.md`: leido completo con Fase 1 ya cerrada.
- `IMPLEMENTACION.md`: leido completo hasta EOF con la huella sin triggers.
- `CONTRATO-XLSX-V1.md`: leido completo hasta EOF.
- Ultima entrada de esta bitacora: leida y punto exacto confirmado.

Alcance habilitado para esta fase:

1. migracion autocontenida de sesiones, huella, paginas, auditoria, expiracion
   y allowlist del rate limiter;
2. tipos/servicio servidor y los cuatro endpoints documentados;
3. pruebas focalizadas de permisos, cursores, errores, conteos y contrato SQL.

Punto de reanudacion: crear primero la migracion sin tocar ninguna tabla
clinica con triggers; luego ejecutar validacion SQL disponible antes de montar
los endpoints sobre ese contrato.

## 2026-08-28 - Reconsulta por interrupcion durante Fase 2

La interfaz interrumpio el turno con la implementacion de servidor ya creada.
Antes de continuar se repitio el protocolo obligatorio:

- `README.md`: leido completo.
- `IMPLEMENTACION.md`: leido completo hasta EOF.
- `CONTRATO-XLSX-V1.md`: leido completo hasta EOF.
- Ultima entrada de esta bitacora: leida y punto de reanudacion confirmado.

Estado reconfirmado:

- Fase 1 permanece completada y Fase 2 en curso.
- La migracion, el contrato TypeScript, el servicio servidor y los cuatro
  endpoints existen en el arbol local, todavia sin publicar.
- La migracion ya compilo y se aplico sobre la base Supabase local; los tests
  TypeScript focalizados de esta fase pasaron (25 tests) y `pnpm check` paso
  con 0 errores y 0 advertencias.
- Se preservan sin stagear los cambios ajenos en `tailwind.config.js`, la
  auditoria suelta y `apps/web/output/playwright/**`.

Punto exacto de reanudacion: completar pruebas SQL transaccionales de permisos,
aislamiento, paginacion, locks, expiracion, auditoria y consistencia; corregir
cualquier hallazgo y cerrar formalmente Fase 2 antes de abrir Fase 3.

## 2026-08-28 - Reconsulta despues de reinicio de la PC durante Fase 2

La PC se congelo durante una nueva ejecucion de `pnpm check` y fue reiniciada.
Ese proceso interrumpido no se considera una validacion aprobada. Antes de
retomar se cumplio nuevamente el protocolo:

- `README.md`: leido completo.
- `IMPLEMENTACION.md`: leido completo hasta EOF.
- `CONTRATO-XLSX-V1.md`: leido completo hasta EOF.
- Ultima entrada de esta bitacora: leida y punto de reanudacion confirmado.

Estado recuperado:

- Todos los archivos de la feature y los cambios ajenos siguen intactos.
- Supabase local volvio a iniciar y la base figura saludable.
- Luego de la entrada anterior se cerro el bypass de RPC directo: el control
  plane de exportacion ahora es exclusivo de `service_role` y cada RPC recibe
  el actor autenticado para revalidar membresia directa.
- La prueba SQL transaccional ya paso con 1.005 pacientes, seis datasets,
  aislamiento, roles, restricted, lock, vencimiento, revocacion, auditoria
  fail-closed y cambio de datos.
- Esa prueba encontro una llamada inexistente a `jsonb_object_length`; se
  reprodujo en PostgreSQL 17, se reemplazo por conteo de
  `jsonb_object_keys` y el repro completo paso despues del arreglo.
- Los tests TypeScript focalizados anteriores al ultimo endurecimiento pasaron
  (4 archivos, 26 tests). Falta repetirlos con los parsers allowlist agregados.
- La ejecucion de `pnpm check` iniciada despues de esos parsers fue interrumpida
  por el reinicio y debe repetirse con la memoria ya recuperada.

Punto exacto de reanudacion: aplicar nuevamente la migracion local si hiciera
falta, repetir prueba SQL y tests focalizados, ejecutar `pnpm check` secuencial,
agregar la prueba de actualizacion concurrente en transacciones separadas y
cerrar Fase 2 solo cuando todo vuelva a quedar verde.

## 2026-08-28 - Fase 2 completada

Los criterios de salida de Fase 2 y la definicion global de terminado fueron
releidos antes de cerrar. Base de datos, servidor, aislamiento, errores y
concurrencia quedaron implementados y verificados; XLSX, UI y publicacion
siguen expresamente fuera de este cierre.

Implementacion de base de datos:

- `supabase/migrations/20260827220000_patient_data_exports.sql` crea sesiones
  sin PHI, huella/conteos export-only, paginacion keyset, validacion final,
  cancelacion, auditoria autoritativa, expiracion perezosa y cron cada 15 min.
- No se agrego ningun trigger de exportacion a tablas clinicas. La consulta
  local confirmo cero triggers cuyo cuerpo incluya exportacion sobre las siete
  fuentes clinicas.
- Los cuatro RPC son exclusivos de `service_role`; `authenticated` no posee
  `EXECUTE`. El backend pasa el actor validado y cada operacion revalida
  membresia directa owner/admin, estado y alcance.
- Las paginas se limitan por filas y por aproximadamente 1,5 MB JSON, sin
  truncar: una fila historica grande siempre puede avanzar completa.
- Los importes se transportan como decimal textual exacto para evitar perdida
  de precision JavaScript; el serializador decidira numero seguro o texto.
- Se ampliaron de forma identica las dos funciones existentes del rate limiter
  solo con las acciones individual/global; el backend sigue fail-closed.

Implementacion servidor:

- Contrato compartido versionado en `apps/web/src/lib/patient-export/contract.ts`.
- Autorizacion UI/servidor en `patient-permissions.ts` niega asistencia aunque
  su rol efectivo sea admin y admite restricted mediante `canEnterApp`.
- `patient-exports.ts` normaliza errores humanos, limita cuerpos/cursores,
  ejecuta rate limit antes de iniciar, usa el control plane privado y
  reconstruye cada fila desde una allowlist tipada. Campos inesperados se
  eliminan en el limite servidor y filas incompletas fallan cerradas.
- `patient-export-http.ts` aplica `private, no-store`, `Vary: Cookie` y
  `Retry-After` cuando corresponde, sin exponer errores de infraestructura.
- Quedaron implementados los cuatro endpoints bajo
  `apps/web/src/routes/api/odonto/exportaciones/`.

Hallazgo y correccion de raiz:

- El primer fixture integrado devolvio `EXPORT_DEPENDENCY_UNAVAILABLE` al leer
  pacientes. Una sonda temporal acotada revelo SQLSTATE `42883`: PostgreSQL 17
  no ofrece `jsonb_object_length`.
- Se sustituyo por conteo de `jsonb_object_keys`, se separo la validacion de
  tipo antes del conteo, se retiro la sonda temporal y se agrego un contrato
  que impide reintroducir esa llamada. El repro original completo paso.

Pruebas y evidencia:

- Vitest focalizado final: 4 archivos, 32 tests, todos aprobados y con un solo
  worker. Incluye permisos, rate limits, contrato SQL, cursores, errores y
  parsers allowlist de los seis datasets.
- `supabase/tests/patient_data_exports.sql`: aprobado dentro de una transaccion
  que termina en rollback. Verifico 1.005 pacientes, seis datasets, conteos,
  ausencia de duplicados/omisiones, otro consultorio, todos los roles, ayuda
  temporal, restricted/archived/pausa, lock, idempotencia, expiracion,
  revocacion, auditoria fail-closed y cambio concurrente por alta.
- `run_patient_export_consistency_concurrency.sh`: aprobado; dos transacciones
  comprometidas cambiaron y restauraron un nombre y aun asi `xmin` invalido la
  sesion con una unica auditoria `data_changed`.
- `run_patient_export_global_lock_concurrency.sh`: aprobado; dos inicios
  simultaneos produjeron exactamente una sesion/auditoria y un conflicto
  controlado `EXPORT_IN_PROGRESS`.
- `pnpm --filter web check`: 0 errores, 0 advertencias; 1:21,85 y RSS maximo
  1.336.188 KB. Se ejecuto solo despues del reinicio y sin tareas pesadas en
  paralelo.
- La migracion se aplico/reaplico localmente con `ON_ERROR_STOP=1`; grants,
  cron y ausencia de triggers se verificaron consultando catalogos reales.
- `git diff --check` focalizado y validacion sintactica Bash: aprobados. El
  `git diff --check` global conserva un aviso preexistente ajeno en
  `apps/web/tailwind.config.js`, que no se modifico ni se incluira.

Archivos de Fase 2:

- `supabase/migrations/20260827220000_patient_data_exports.sql`
- `supabase/tests/patient_data_exports.sql`
- `supabase/tests/run_patient_export_consistency_concurrency.sh`
- `supabase/tests/run_patient_export_global_lock_concurrency.sh`
- `apps/web/src/lib/patient-export/contract.ts`
- `apps/web/src/lib/server/patient-exports.ts`
- `apps/web/src/lib/server/patient-export-http.ts`
- `apps/web/src/lib/server/patient-permissions.ts`
- `apps/web/src/lib/server/rate-limits.ts`
- los cuatro endpoints y los tests focalizados asociados
- documentacion de esta carpeta

Riesgos que pasan a Fase 3:

- Probar la transformacion/reapertura real de todas las hojas, formulas,
  controles OOXML, Unicode, precision y textos extensos.
- Mantener `write-excel-file` exclusivamente dentro del Web Worker lazy y
  confirmar por artefactos de build que no ingresa al cliente inicial ni al
  Worker servidor.
- Una unica fila JSON excepcionalmente enorme puede superar el objetivo de
  1,5 MB porque el contrato prohibe truncarla; debe probarse el comportamiento
  y el error humano del limite de plataforma sin afectar flujos normales.

Punto exacto de reanudacion: antes de abrir Fase 3 releer `README.md`,
`IMPLEMENTACION.md`, `CONTRATO-XLSX-V1.md` y esta entrada; registrar la nueva
consulta y luego implementar primero transformadores puros/textos extensos,
despues el adaptador OOXML y finalmente el Web Worker lazy.

## 2026-08-28 - Fase 3 abierta

Consulta obligatoria realizada despues de cerrar Fase 2:

- `README.md`: leido completo con Fase 2 marcada como completada.
- `IMPLEMENTACION.md`: leido completo hasta EOF, incluido el control plane
  exclusivo de backend y el limite por bytes.
- `CONTRATO-XLSX-V1.md`: leido completo hasta EOF; orden, columnas, tipos y
  reglas de textos extensos reconfirmados.
- Ultima entrada de esta bitacora: leida y punto de reanudacion confirmado.

Alcance habilitado para Fase 3:

1. transformadores puros y esquema exacto de ocho hojas;
2. particion reversible de textos extensos sin cortar Unicode;
3. proteccion OOXML y tipos de celda que impidan formulas/inferencia;
4. generacion con `write-excel-file` dentro de un Web Worker creado solo por
   accion explicita;
5. pruebas de ZIP/XML, reapertura real, tipos, conteos, cancelacion, memoria y
   separacion de bundles.

Punto exacto de reanudacion: inspeccionar la API instalada de
`write-excel-file`, fijar tipos internos del workbook y escribir primero los
transformadores/tests puros antes de crear el Worker.

## 2026-08-28 - Reconsulta de continuidad de Fase 3

Luego del reinicio y de la compactacion de la interfaz se repitio el protocolo
obligatorio antes de volver a tocar codigo funcional:

- `README.md`: leido completo; Fase 3 continua en curso.
- `IMPLEMENTACION.md`: leido completo hasta EOF, incluidas las puertas de
  rendimiento, pruebas y publicacion.
- `CONTRATO-XLSX-V1.md`: leido completo hasta EOF; se reconfirmaron las ocho
  hojas, encabezados, tipos y reconstruccion de textos extensos.
- Ultima entrada de esta bitacora: leida; el punto de reanudacion sigue siendo
  transformadores puros, adaptador OOXML y Worker lazy, en ese orden.

Estado recuperado: el arbol mantiene intacta la implementacion de Fase 2 y los
cambios ajenos siguen fuera del alcance. No se considera aprobada ninguna tarea
interrumpida por el congelamiento. Las validaciones pesadas continuaran en
serie y con un unico worker.

Punto exacto de reanudacion: inspeccionar los tipos reales que entrega el
backend, fijar el modelo interno del workbook y agregar transformadores y
pruebas puras antes de importar `write-excel-file` desde el Web Worker.

## 2026-08-28 - Fase 3 completada

Se releyeron la puerta de salida de Fase 3, las pruebas XLSX, la definicion
global de terminado y los riesgos que bloquean publicacion. El contrato XLSX,
la transformacion, el adaptador OOXML y el Worker lazy quedaron implementados
y verificados. La descarga/Object URL y la integracion en rutas pertenecen a
Fase 4 y su validacion final de bundle se repetira en Fase 5.

Implementacion:

- `workbook.ts` fija las ocho hojas, todos los encabezados y tipos internos
  `text`/`number`/vacio. Genera siempre hojas vacias y la hoja `Informacion`
  declara version, UTC, timezone, alcance, conteos y exclusiones.
- IDs, DNI, telefonos, fechas y cualquier texto controlado se mantienen como
  texto. Los estados, origenes y booleanos se convierten a etiquetas humanas.
- Los importes decimales solo pasan a Number si la representacion canonica
  vuelve exactamente al mismo decimal y permanece dentro de precision segura;
  los demas quedan como texto.
- Los textos usan bloques de hasta 30.000 unidades UTF-16 y 250 LF, sin cortar
  pares sustitutos. La celda original recibe `texto-NNNNNN` y todas las partes
  quedan ordenadas y reconstruibles en `Textos extensos`, sin IDs tecnicos
  nuevos.
- `ooxml.ts` protege primero secuencias literales `_xHHHH_` y luego codifica CR,
  controles y caracteres que la libreria descartaria. Se comprobo la ida y
  vuelta, incluidos Unicode suplementario y noncharacters; Unicode mal formado
  falla de forma visible en lugar de perder datos.
- `xlsx-adapter.ts` entrega a la libreria solamente celdas con `type: String` o
  `type: Number`; nunca usa `Formula`, strings inferibles, hipervinculos,
  imagenes ni contenido activo.
- `patient-export.worker.ts` es el unico import runtime de
  `write-excel-file/browser`. `client.ts` lo crea exclusivamente al pedir la
  construccion, valida el protocolo/resultados, normaliza errores y siempre lo
  termina al completar, fallar o cancelar.
- El origen de turno quedo endurecido tambien en el parser servidor a la lista
  real `manual/public_booking/whatsapp_bot/admin`; una futura etiqueta interna
  desconocida falla cerrada y no se filtra al archivo.

Hallazgos corregidos durante pruebas:

- La primera corrida focalizada tuvo 19/21 pruebas verdes. Detecto que el
  filename no separaba fecha/hora y que `-0.00` producia Number negativo cero.
  Se corrigieron ambos en el serializador y la repeticion paso completa.
- El primer `svelte-check` encontro dos errores exclusivamente de tipado: un
  narrowing perdido dentro de una callback y tipos ausentes de `jsdom` en el
  test. Se corrigieron sin agregar dependencias; la repeticion quedo en cero.
- Se detecto en la auditoria manual que un nombre profesional largo podia usar
  `allocation_id` como metadato. Se sustituyo por el ID de turno ya exportado,
  evitando exponer un identificador tecnico adicional.

Pruebas y evidencia:

- Suite XLSX focalizada final: 4 archivos, 21 pruebas, todas aprobadas con un
  unico worker. Cubre esquema exacto, hojas vacias, mapeos, tipos, formulas,
  controles, secuencias reservadas, Unicode, precision, textos extensos,
  protocolo, cancelacion, errores humanos, ZIP/XML y contenido activo.
- Reapertura real: LibreOffice abrio el XLSX y lo convirtio a ODS con las ocho
  hojas; la prueba no se limita a inspeccionar bytes del ZIP.
- Suite combinada XLSX + parser servidor: 5 archivos, 35 pruebas aprobadas,
  incluida la denegacion de un origen interno desconocido.
- `pnpm --filter web check`: 0 errores y 0 advertencias. RSS maximo 1.402.488 KB,
  ejecutado en solitario.
- Build Cloudflare: aprobado en 1:06,09, RSS maximo 1.284.608 KB. El mayor chunk
  cliente se mantuvo en 204,41 kB. Totales: cliente 1.362.108 bytes frente a
  baseline 1.362.113; Cloudflare 1.334.917 frente a baseline 1.334.922.
- Build Vite de auditoria con `client.ts` como entrada: wrapper lazy 3.313 bytes
  y Worker XLSX separado 82.931 bytes. Las firmas `sharedStrings.xml`/worksheets
  aparecieron solo en ese Worker, no en el cliente inicial ni en el Worker
  servidor. El directorio temporal se elimino despues de inspeccionarlo.
- El aumento del output servidor respecto del baseline corresponde a los
  endpoints/control plane de Fase 2; no hay imports XLSX en servidor ni nuevas
  llamadas desde cargas normales.

Archivos principales de Fase 3:

- `apps/web/src/lib/patient-export/ooxml.ts`
- `apps/web/src/lib/patient-export/workbook.ts`
- `apps/web/src/lib/patient-export/xlsx-adapter.ts`
- `apps/web/src/lib/patient-export/worker-protocol.ts`
- `apps/web/src/lib/patient-export/patient-export.worker.ts`
- `apps/web/src/lib/patient-export/client.ts`
- fixtures y cuatro archivos de pruebas focalizadas
- contrato compartido, parser servidor y documentacion actualizados

Riesgos que pasan a Fase 4/5:

- La UI debe revocar cada Object URL, liberar arrays y cancelar la sesion HTTP
  al desmontarse; terminar el Worker por si solo no libera el lock servidor.
- La integracion real de rutas debe conservar el split observado y no importar
  el cliente/Worker antes del clic. Se repetira sobre el build final alcanzable.
- Falta medir el flujo completo con paginacion, progreso y una fila JSON
  excepcionalmente grande desde el navegador.

Punto exacto de reanudacion: antes de abrir Fase 4 releer los tres documentos y
esta entrada; inventariar layout, permisos ya cargados, ruta restricted,
configuracion y ficha individual. Implementar primero el orquestador HTTP
testeable y luego la UI compartida, sin agregar loads o requests normales.

## 2026-08-28 - Fase 4 abierta

Consulta obligatoria realizada antes de implementar la interfaz:

- `README.md`: leido completo con Fase 3 cerrada y Fase 4 pendiente.
- `IMPLEMENTACION.md`: leido completo hasta EOF; se reconfirmaron el contrato
  visual, los estados accesibles, restricted y la prohibicion de nuevos loads.
- `CONTRATO-XLSX-V1.md`: leido completo hasta EOF, incluida la ampliacion de
  mapeos humanos y precision decimal documentada al cerrar Fase 3.
- Ultima entrada de esta bitacora: leida; se confirmo que primero corresponde
  inventariar rutas/permisos y luego crear orquestador y componente compartido.

Alcance habilitado para Fase 4:

1. orquestacion HTTP cancelable, paginada y con validacion de conteos;
2. componente compartido de estados, progreso, cancelacion, exito y descarga;
3. pantalla global, acceso desde Configuracion y accion individual al final de
   la ficha solo para owner/admin directo;
4. allowlist/enlace restricted y copy contractual preciso;
5. pruebas UI/cliente sin requests adicionales en cargas normales.

Punto exacto de reanudacion: leer layout/contexto comercial, Configuracion,
detalle de paciente, allowlist restricted y patrones visuales existentes;
reutilizar capacidades ya cargadas y no agregar consultas de exportacion a
ningun `load`.

## 2026-08-28 - Ajuste visual solicitado durante Fase 4

- Se retiro de la pantalla de exportacion el cartel independiente `Archivos no
  incluidos en esta version`.
- Se elimino la palabra `Portabilidad` de los accesos visibles; Configuracion
  usa la etiqueta simple `Excel` y la ficha no agrega una etiqueta secundaria.
- Las exclusiones exactas siguen publicadas en Terminos y Privacidad para no
  ampliar silenciosamente el alcance contractual del XLSX.

## 2026-08-28 - Fase 4 completada

La interfaz global e individual, el acceso restringido y los textos
contractuales quedaron integrados sin agregar lecturas del dataset a rutas
normales. La pantalla visible ya no contiene el cartel de archivos excluidos ni
la etiqueta `Portabilidad`, segun la decision de producto tomada durante esta
fase.

Implementacion y alcance:

- El orquestador cliente inicia, pagina las seis fuentes, valida conteos, reintenta
  una sola vez ante cambio concurrente y carga el constructor XLSX unicamente
  despues de validar el dataset completo.
- El panel compartido cubre espera, progreso por hoja, validacion,
  transformacion, escritura, exito, cancelacion y errores humanos accionables.
  Bloquea doble clic, descarga mediante Object URL y revoca todos los recursos.
- Owner/admin directo ven el acceso global en navegacion y Configuracion, y la
  accion individual al final de la ficha. Profesional y asistencia temporal no
  reciben esos accesos y el servidor vuelve a autorizar cada request.
- El acceso comercial `restricted` conserva el enlace de exportacion para
  owner/admin directo; archivado y pausa manual permanecen denegados.
- La ficha normal solo importa el helper liviano de capacidad. El panel, el
  orquestador, `write-excel-file` y el Worker no se cargan antes de una decision
  explicita de exportar.

Hallazgo de causa raiz y correccion:

- La primera prueba de recarga con una hoja demorada dejo una sesion
  `requested`. `onDestroy` cubria navegacion interna, pero una recarga completa
  puede destruir el documento antes de que Svelte ejecute ese desmontaje.
- Se publico una funcion de cancelacion idempotente apenas el servidor devuelve
  el ID de sesion. El panel la ejecuta antes de abortar la lectura y usa un
  `DELETE keepalive` independiente.
- Se agrego `pagehide` para recarga, cierre de pestana y navegacion externa;
  `onDestroy` se conserva para navegacion interna. El TTL servidor permanece
  como segunda barrera si el navegador pierde conectividad.

Pruebas y evidencia:

- Orquestador: 8/8 pruebas aprobadas con un worker, incluida cancelacion
  `keepalive` inmediata e idempotente.
- Panel cliente: 7/7 pruebas aprobadas, incluidas cancelacion explicita,
  desmontaje y `pagehide` sin doble DELETE.
- Integracion servidor/permisos/ruta/UI: 5 archivos y 37 pruebas aprobadas antes
  del ajuste de ciclo de vida; el orquestador focalizado volvio a aprobar luego.
- Navegador real desktop y 390x844: sin overflow horizontal; la pantalla no
  muestra el cartel ni la etiqueta retirados. Se descargaron un XLSX global y
  uno individual reales; el archivo reabierto con ZIP/XML tenia ocho hojas,
  cero formulas y preservo `Paciente Exportación Ñandú` con sus caracteres
  Unicode originales.
- En carga normal de ficha no aparecieron panel, orquestador, cliente,
  `write-excel-file` ni Worker. En la ruta de exportacion, antes del clic, solo
  aparecieron el panel y el helper de permiso.
- Reproduccion final de recarga sobre una pagina demorada: la fila paso de
  `requested` a `cancelled`, guardo `finished_at` y quedaron 0 locks activos.
  La cancelacion explicita individual termino como `cancelled_by_user` y tambien
  dejo 0 locks activos.
- `pnpm check`: 0 errores y 0 advertencias; RSS maximo 1.268.440 KB y cero swaps
  adicionales, ejecutado sin navegador ni servidor Vite en paralelo.
- El consultorio, usuario, paciente y sesiones efimeras usados para la prueba
  local se eliminaron y se verificaron con conteos en cero.

Riesgos que pasan a Fase 5:

- Repetir la suite completa y el build final despues de toda la integracion.
- Comparar chunks finales contra el baseline y demostrar nuevamente que XLSX y
  Worker no entraron al arranque normal.
- Ejecutar dry-run Cloudflare, auditoria de dependencias, chequeos de diff y
  secretos, y revisar flujos adyacentes sin modificar trabajo ajeno.

Punto exacto de reanudacion: abrir Fase 5 cumpliendo otra vez el protocolo de
lectura completa; luego ejecutar la matriz de auditoria en serie y detener la
publicacion ante cualquier regresion funcional, de seguridad o rendimiento.

## 2026-08-28 - Fase 5 abierta

Consulta obligatoria realizada antes de iniciar la auditoria:

- `README.md`: leido completo; Fases 0 a 4 estan cerradas y la definicion de
  terminado exige pruebas, rendimiento, build, seguridad y publicacion
  verificables por separado.
- `IMPLEMENTACION.md`: leido completo hasta EOF; se reconfirmaron el umbral de
  regresion, el cierre secuencial de bajo consumo y todos los riesgos que
  bloquean publicacion.
- `CONTRATO-XLSX-V1.md`: leido completo hasta EOF; se mantienen las ocho hojas,
  tipos explicitos, textos extensos reconstruibles y cero contenido activo.
- Ultima entrada de esta bitacora: leida completa; el siguiente paso confirmado
  es repetir suites y build final, inspeccionar bundles, hacer dry-run/auditoria
  y revisar flujos adyacentes sin tocar cambios ajenos.

Orden de ejecucion de Fase 5:

1. inventario final de cambios y matriz de tests focalizados servidor/cliente;
2. pruebas SQL y de concurrencia locales;
3. chequeo de tipos y build Cloudflare, siempre en serie;
4. inspeccion de bundles y comparacion exacta contra baseline;
5. dry-run, auditoria de dependencias, diff/secrets y regresiones adyacentes;
6. documentar hallazgos y no abrir Fase 6 si queda una puerta sin evidencia.

Punto exacto de reanudacion: comenzar por el inventario de archivos de la
feature y ejecutar la suite focalizada completa con un unico worker.

## 2026-08-28 - Fase 5 completada y Fase 6 abierta

Auditoria final aprobada:

- Suite focalizada: 81 pruebas servidor/XLSX y 7 cliente, todas verdes.
- Suite completa: 105 archivos/809 pruebas servidor y 7 archivos/71 pruebas
  cliente, sin regresiones.
- SQL real: contrato de autorizacion/completitud con 1.003 pacientes aprobado;
  carreras de lock global y cambio/reversion concurrente aprobadas.
- `pnpm check`: 0 errores y 0 advertencias.
- Build Cloudflare final: aprobado; mayor chunk compartido 204.409 bytes,
  exactamente igual al baseline. Worker XLSX separado: 82.933 bytes. La ficha
  normal no importa orquestador, cliente XLSX ni Worker.
- Wrangler dry-run aprobado. `pnpm audit --prod`: cero vulnerabilidades. La
  auditoria completa solo informa dependencias transitivas de desarrollo de
  Wrangler/Miniflare; Wrangler 4.86.0 es la ultima version compatible con Node
  20 del proyecto y esos paquetes no integran el Worker publicado.
- Diff de la feature, scripts y secretos: aprobados. El unico `git diff --check`
  global ajeno es una linea final en `tailwind.config.js`, archivo preexistente
  que queda expresamente fuera del commit.

Hallazgos corregidos en auditoria:

- `pagehide` podia dejar una vista `running` al restaurarse desde BFCache aunque
  el servidor ya estuviera cancelado. Ahora conserva el estado terminal
  `cancelled`; la prueba especifica pasa.
- El permiso visual se calcula en el layout servidor usando el contexto ya
  cargado y viaja como un booleano. No agrega consultas y elimina el helper del
  bundle global del navegador.

Protocolo de Fase 6 cumplido inmediatamente despues de cerrar la auditoria:
`README.md`, `IMPLEMENTACION.md` y `CONTRATO-XLSX-V1.md` fueron releidos
completos; tambien se releyo la ultima entrada de esta bitacora. Se confirmo que
solo corresponde aplicar/verificar Supabase, stagear rutas exactas, publicar
`main` y comprobar SHA/Cloudflare por separado.

Punto exacto de reanudacion: aplicar la migracion de exportacion en Supabase de
produccion y verificar tabla, RPC, ACL y cron antes del commit.

## 2026-08-28 - Fase 6 completada

- Supabase produccion: migracion `20260827220000` aplicada y registrada. Se
  verificaron RLS, ausencia de permisos para `anon/authenticated`, ejecucion de
  los cuatro RPC solo por `service_role`, acciones de rate limit y cron activo
  cada 15 minutos.
- GitHub `main`: feature publicada en `76577088c13f568d9d824c1643ae95839cd44340`;
  `HEAD`, `origin/main` y el SHA remoto coincidieron con divergencia `0 0`.
- Cloudflare Workers: despliegue directo exitoso en
  `https://app.cita-suite.workers.dev`, version
  `953263dd-20e3-46cd-9c64-aa4a241f522a`, startup 43 ms.
- Smoke de produccion: `/login` respondio 200, la pantalla protegida redirigio
  al ingreso y el endpoint sin sesion respondio 401.
- `tailwind.config.js`, `Auditoria final pre lanzamiento.md` y
  `apps/web/output/playwright/**` quedaron fuera del commit.

La implementacion y todas sus fases quedan cerradas.

## 2026-08-28 - Fase 7 abierta: el Excel debe sobrevivir a la aplicacion

Consulta obligatoria realizada antes de corregir:

- `README.md`, `IMPLEMENTACION.md`, el contrato v1 y la ultima entrada de esta
  bitacora fueron leidos.
- La objecion se reprodujo directamente en `workbook.ts` y en su prueba: el
  contrato anterior exigia conservar UUID de pacientes, historias, turnos y
  profesionales en las celdas visibles.

Causa raiz:

- Se confundio portabilidad tecnica con utilidad para la persona. Los UUID
  ayudaban a reconstruir relaciones para un importador programado, pero hacian
  que las relaciones no pudieran identificarse por nombre y DNI fuera de Cita
  Suite.
- La hoja de resumen tambien exponia claves de protocolo y los datos
  adicionales mostraban tipos y JSON.

Criterio corregido y siguiente paso:

1. conservar identificadores solo durante la union interna de datos;
2. resolver cada fila a nombre de paciente, DNI, profesional, fecha y servicio;
3. fallar si una relacion no se puede resolver, sin usar el UUID como salida;
4. publicar el contrato humano v2 y agregar pruebas que busquen todos los UUID
   de las fixtures dentro del XLSX real;
5. reabrir el archivo con LibreOffice, ejecutar chequeos y volver a desplegar.

Punto exacto de reanudacion: completar pruebas y auditoria del generador v2;
despues actualizar esta entrada antes de publicar.

## 2026-08-28 - Fase 7 implementada y auditada

Cambios comprobados:

- Las ocho hojas ya no escriben UUID de paciente, entrada clinica, turno,
  profesional, asignacion ni seguimiento.
- `Historia clínica`, `Turnos`, `Datos adicionales`, `Profesionales de turnos`,
  `Seguimientos` y `Textos extensos` resuelven el paciente a nombre y DNI.
- Los campos compuestos se muestran como etiquetas y valores. El analizador
  conserva numeros mayores al limite seguro de JavaScript sin cambiar digitos.
- Las fechas se muestran en formato argentino usando la hora del consultorio.
- Si falta el paciente o turno necesario para resolver una relacion, la
  construccion se detiene; nunca reemplaza el nombre por un identificador.
- El nombre del archivo paso a `datos-paciente...xlsx` o
  `datos-pacientes...xlsx`.

Evidencia:

- Suite completa servidor/XLSX: 105 archivos y 810 pruebas aprobadas.
- Suite completa cliente: 7 archivos y 71 pruebas aprobadas.
- `pnpm check`: 0 errores y 0 advertencias.
- El XLSX real contiene ocho hojas, cero formulas, ninguno de los UUID de las
  fixtures y se reabre correctamente con LibreOffice.
- Build Cloudflare aprobado. El mayor chunk compartido sigue en 204,41 kB,
  igual al baseline. El codigo adicional queda dentro del Worker XLSX, que solo
  se carga al iniciar una exportacion.
- No hay cambios de tablas, RPC ni politicas; Supabase no requiere una nueva
  migracion para esta correccion.

Punto exacto de reanudacion: publicar las rutas exactas en `main`, desplegar
Cloudflare y registrar SHA y version final.

## 2026-08-28 - Fase 7 publicada

- GitHub `main`: correccion publicada en
  `e3cd0f76da700e067d0ac3c457fd98cb9884e821`.
- Cloudflare Workers: version
  `2101ebcf-bda0-4517-b0fd-f927ee386763` desplegada en
  `https://app.cita-suite.workers.dev`; startup 37 ms.
- Smoke de produccion: `/login` respondio 200, la ruta de exportacion sin
  sesion redirigio al ingreso y el nuevo Worker XLSX respondio 200.
- Supabase conserva la migracion ya aplicada. Esta correccion no modifica el
  contrato privado de datos y no necesita SQL adicional.
- `tailwind.config.js`, `Auditoria final pre lanzamiento.md` y
  `apps/web/output/playwright/**` permanecieron fuera de los commits.

La Fase 7 queda cerrada.
