# Contrato XLSX `cita-suite-patient-export/v1`

Este archivo fija el formato externo. Cambiar nombres, orden, significado o
tipos incompatibles requiere una nueva version del contrato.

## Reglas generales

- Orden fijo de hojas.
- Todas las hojas existen aunque no tengan filas.
- Primera fila con encabezados exactos.
- IDs, DNI, telefonos, codigos, fechas calendario e instantes se serializan
  segun las reglas de esta especificacion, no por inferencia de Excel.
- No existen formulas, macros, hipervinculos creados automaticamente, enlaces
  externos ni conexiones de datos.
- Los controles no admitidos literalmente por XML y las secuencias reservadas
  `_xHHHH_` se protegen mediante escapes OOXML reversibles antes de serializar.
- Las ausencias se representan como celda vacia salvo que la columna de tipo
  necesite distinguir `null`.
- Los textos extensos usan referencias; nunca truncamiento.

## Orden de hojas

1. `Informacion`
2. `Pacientes`
3. `Campos personalizados`
4. `Historial clinico`
5. `Turnos`
6. `Profesionales por turno`
7. `Seguimientos`
8. `Textos extensos`

## Informacion

Formato clave/valor, una fila por dato:

- `Clave`
- `Valor`

Claves obligatorias:

- `version_formato`
- `generado_en_utc`
- `timezone_consultorio`
- `alcance`
- `consultorio`
- `cantidad_pacientes`
- `cantidad_campos_personalizados`
- `cantidad_entradas_clinicas`
- `cantidad_turnos`
- `cantidad_relaciones_profesionales`
- `cantidad_seguimientos`
- `incluye_radiografias` = `No`
- `incluye_adjuntos` = `No`
- `aclaracion`

## Pacientes

Encabezados previstos, sujetos a confirmacion de esquema en fase 1:

- `ID paciente`
- `Nombre completo`
- `DNI`
- `Telefono`
- `Email`
- `Fecha de nacimiento`
- `Direccion`
- `Obra social`
- `Plan`
- `Alergias`
- `Medicacion`
- `Antecedentes`
- `Alerta clinica`
- `Notas clinicas`
- `Estado`
- `Archivado en`
- `Creado en`
- `Actualizado en`

## Campos personalizados

- `ID paciente`
- `Clave`
- `Etiqueta`
- `Tipo`
- `Valor`
- `Valor JSON`

Tipos permitidos:

- `string`
- `number`
- `boolean`
- `null`
- `object`
- `array`

`Valor JSON` solo se usa para `object` y `array`. El orden se fija por paciente
y clave.

Defensa para datos historicos fuera del contrato actual: si `custom_fields`
contiene un valor raiz que no es objeto, se conserva en una unica fila con
`Clave` = `__valor_sin_clave__` y `Etiqueta` = `Valor sin clave`. No se descarta
ni se corrige silenciosamente.

## Historial clinico

- `ID entrada clinica`
- `ID paciente`
- `Fecha y hora`
- `Tipo`
- `Descripcion`
- `Piezas`
- `Nota interna`
- `Importe`
- `ID profesional`
- `Profesional`
- `Estado`
- `Archivado en`
- `Creado en`
- `Actualizado en`

## Turnos

- `ID turno`
- `ID paciente`
- `Inicio`
- `Fin`
- `Estado`
- `Origen`
- `Servicio`
- `Nota interna`
- `Profesional principal`
- `Confirmado en`
- `Cancelado en`
- `Reprogramacion solicitada en`
- `Motivo de cancelacion`
- `Creado en`
- `Actualizado en`

## Profesionales por turno

- `ID turno`
- `ID paciente`
- `ID profesional`
- `Profesional`
- `Es principal`
- `Orden`

## Seguimientos

- `ID seguimiento`
- `ID paciente`
- `Recordar el`
- `Mensaje`
- `Estado`
- `ID profesional asignado`
- `Profesional asignado`
- `Completado en`
- `Creado en`
- `Actualizado en`

## Textos extensos

- `Referencia texto`
- `Entidad`
- `ID entidad`
- `Campo`
- `Parte`
- `Total de partes`
- `Texto`

El valor de la celda original es la misma `Referencia texto`. Las partes se
concatenan en orden numerico. El algoritmo debe respetar Unicode y los limites
de caracteres y saltos de linea por celda. Los escapes OOXML se decodifican al
abrir el archivo y no forman parte del texto de negocio reconstruido.

## Estados humanos

Los enums internos no se exponen. El mapeo se fija en codigo y tests. Ejemplos:

- paciente activo -> `Activo`
- paciente archivado -> `Archivado`
- turno reserved -> `Reservado`
- turno confirmed -> `Confirmado`
- turno cancelled -> `Cancelado`
- turno reschedule_requested -> `Reprogramación solicitada`
- seguimiento pending -> `Pendiente`
- seguimiento done -> `Completado`

Origenes de turnos:

- manual -> `Carga manual`
- public_booking -> `Reserva en línea`
- whatsapp_bot -> `WhatsApp`
- admin -> `Administración`

Otros valores humanos:

- relacion profesional principal -> `Sí`; secundaria -> `No`
- campo personalizado booleano true -> `Verdadero`; false -> `Falso`

Los importes se escriben como numero solamente cuando su decimal canonico
puede convertirse y volver a texto sin cambiar. Si exceden la precision segura
o perderian digitos, se conservan como texto en la misma columna.

## Compatibilidad

- Cambios aditivos que no alteren las hojas/columnas existentes requieren una
  decision explicita: en general se prefiere version nueva para no sorprender a
  importadores.
- Renombrar, reordenar, eliminar o cambiar tipo implica `v2`.
- El serializador, endpoints y hoja `Informacion` deben declarar la misma
  version.
