# Exportacion de datos de pacientes

Este directorio es la fuente de verdad de la implementacion. Su objetivo es
evitar que una compactacion de contexto, una pausa o una correccion parcial
hagan perder decisiones importantes.

## Protocolo obligatorio por fase

Antes de comenzar cada fase se debe:

1. Leer este archivo completo.
2. Leer `IMPLEMENTACION.md` completo.
3. Leer `CONTRATO-XLSX-V1.md` completo.
4. Leer la ultima entrada de `BITACORA.md` y confirmar el siguiente paso.
5. Registrar en `BITACORA.md` que los documentos fueron consultados.

Al terminar cada fase se debe:

1. Actualizar el estado de la fase.
2. Registrar archivos modificados, decisiones, pruebas y resultados.
3. Anotar riesgos pendientes y el punto exacto de reanudacion.
4. Releer los criterios de salida antes de avanzar.

No se puede marcar una fase como completada por haber escrito codigo: deben
cumplirse tambien sus verificaciones.

## Estado general

- Fase 0 - Especificacion documental: completada.
- Fase 1 - Baseline, inventario y decisiones finales: completada.
- Fase 2 - Base de datos y contrato servidor: completada.
- Fase 3 - Serializador XLSX y Web Worker: completada.
- Fase 4 - Interfaz y acceso restringido: completada.
- Fase 5 - Auditoria, regresion y rendimiento: completada.
- Fase 6 - Supabase, main y verificacion de publicacion: en curso.

## Decisiones no negociables

- Exportacion individual y global solo para membresias directas `owner` o
  `admin` activas y aceptadas.
- Una asistencia temporal de Cita Suite nunca puede exportar, aunque el
  contexto efectivo tenga rol `admin`.
- El servidor decide y limita todos los datos. El navegador solo pagina los
  datos autorizados y construye el archivo.
- Los RPC de exportacion son exclusivos del backend con `service_role`; el
  navegador no puede saltear el rate limit ni llamar al control plane directo.
- No se reutilizan datos parciales de una pagina, caches de pacientes ni
  consultas limitadas de la interfaz.
- No se usa `select('*')`; cada campo exportado pertenece a una lista versionada.
- La version inicial no incluye radiografias, imagenes, PDF ni adjuntos.
- Se incluyen datos tabulares ingresados por el consultorio: pacientes, ficha
  clinica, campos personalizados, historial, turnos, profesionales por turno y
  seguimientos.
- El XLSX no contiene formulas. Los datos controlados por usuarios se escriben
  como texto y se conservan sin cambios.
- No se trunca contenido silenciosamente.
- Los errores visibles son humanos y accionables; nunca muestran SQL,
  PostgREST, UUID internos, codigos HTTP ni detalles de infraestructura.
- La libreria XLSX se carga de forma diferida y solo al iniciar una exportacion.
- No se agregan triggers de exportacion: la consistencia se verifica con una
  huella calculada unicamente al inicio y al final de cada intento.
- Las rutas y cargas existentes no pueden sumar requests, datos, dependencias
  ansiosas ni trabajo de CPU por esta funcionalidad.
- Toda alteracion de escrituras frecuentes se compara contra un baseline. Si
  existe una regresion medible, no se publica esa arquitectura.
- La exportacion se mantiene disponible durante el acceso comercial restringido
  para owner/admin directo. Una cuenta archivada o pausada manualmente no puede
  exportar sin reactivacion o intervencion verificada.
- La publicacion incluye el cambio contractual que describe contenido y
  exclusiones con precision.
- No se empuja trabajo ajeno ni `apps/web/output/playwright/**`.

## Definicion de terminado

La funcionalidad se considera terminada solamente cuando:

- Los contratos de base de datos, API y XLSX estan versionados y probados.
- Owner y admin directo pueden exportar; profesional, asistencia temporal,
  usuario revocado y otro consultorio no pueden hacerlo.
- El resultado global e individual comparte exactamente el mismo esquema.
- Los conteos y los identificadores del workbook coinciden con la fuente.
- El archivo reabierto contiene cero formulas y conserva texto, Unicode,
  identificadores, fechas, valores personalizados y textos extensos.
- Los cambios concurrentes se detectan y nunca generan un archivo mezclado.
- Una sesion abandonada vence y libera el bloqueo global.
- Una recarga, cierre o navegacion durante una exportacion inicia la cancelacion
  servidor con `keepalive`; la expiracion queda como segunda barrera.
- La interfaz cubre inicio, progreso, cancelacion, exito, expiracion, cambio de
  datos, falta de permiso, limite de uso y dependencia no disponible.
- La exportacion funciona en acceso restringido y no aparece para roles no
  autorizados.
- No hay regresion detectable en navegacion, carga de paciente ni guardado de
  entradas/turnos dentro del umbral definido en la fase de baseline.
- Pasan tests focalizados, tests de servidor, tests de cliente, `pnpm check`,
  build Cloudflare, E2E secuencial aplicable y auditoria de dependencias.
- Las migraciones estan aplicadas y verificadas en Supabase.
- El commit publicado coincide con `HEAD`, `origin/main` y el SHA remoto.
