# Contrato XLSX vigente

Este es el formato vigente del archivo exportado. No depende de UUID, hashes,
claves de base de datos ni de la estructura interna de la aplicación.

## Reglas obligatorias

- Cada registro relacionado con un paciente muestra su nombre y DNI.
- Cada profesional se muestra por su nombre.
- UUID, hashes, claves de base de datos, nombres de columnas internas, JSON y
  versiones de protocolo no se escriben en ninguna celda visible.
- Las relaciones se resuelven mientras se construye el archivo. Si falta el
  paciente o turno necesario para dar contexto humano, la exportación falla en
  lugar de mostrar un identificador interno.
- Los títulos, estados, fechas y valores se expresan en castellano.
- Las fechas calendario usan `DD/MM/AAAA`. Las fechas con hora usan
  `DD/MM/AAAA HH:MM:SS`, según la hora local del consultorio.
- DNI, teléfono, correo y textos se conservan como texto para que Excel no los
  altere.
- No hay fórmulas, macros, enlaces externos ni conexiones de datos.
- Ningún contenido se trunca. Los textos que exceden el límite de una celda se
  guardan completos en `Textos extensos`.

## Hojas y columnas

### 1. Resumen

- `Dato`
- `Detalle`

Incluye consultorio, fecha de exportación, alcance, conteos por sección, la
aclaración sobre la hora local y una instrucción para localizar textos muy
largos. No muestra versiones, zona horaria técnica ni claves internas.

### 2. Pacientes

- `Nombre completo`
- `DNI`
- `Teléfono`
- `Correo electrónico`
- `Fecha de nacimiento`
- `Dirección`
- `Obra social`
- `Plan`
- `Alergias`
- `Medicación`
- `Antecedentes`
- `Alerta clínica`
- `Notas clínicas`
- `Estado`
- `Fecha de archivo`
- `Fecha de alta`
- `Última actualización`

### 3. Datos adicionales

- `Paciente`
- `DNI`
- `Campo`
- `Valor`

Los valores simples se muestran directamente. Sí/no se expresa como `Sí` o
`No`. Los datos compuestos se convierten a líneas con etiquetas y valores; no
se muestra JSON, el tipo interno ni la clave técnica.

### 4. Historia clínica

- `Paciente`
- `DNI`
- `Fecha y hora`
- `Tipo`
- `Descripción`
- `Piezas`
- `Nota interna`
- `Importe`
- `Profesional`
- `Estado`
- `Fecha de archivo`
- `Fecha de carga`
- `Última actualización`

### 5. Turnos

- `Paciente`
- `DNI`
- `Inicio`
- `Fin`
- `Estado`
- `Origen`
- `Servicio`
- `Nota interna`
- `Profesional principal`
- `Fecha de confirmación`
- `Fecha de cancelación`
- `Pedido de reprogramación`
- `Motivo de cancelación`
- `Fecha de creación`
- `Última actualización`

### 6. Profesionales de turnos

- `Paciente`
- `DNI`
- `Inicio del turno`
- `Servicio`
- `Profesional`
- `Responsable principal`

El inicio, servicio y paciente sustituyen al identificador interno del turno.

### 7. Seguimientos

- `Paciente`
- `DNI`
- `Fecha de recordatorio`
- `Mensaje`
- `Estado`
- `Profesional asignado`
- `Fecha de finalización`
- `Fecha de creación`
- `Última actualización`

### 8. Textos extensos

- `Referencia`
- `Paciente`
- `DNI`
- `Sección`
- `Registro`
- `Campo`
- `Parte`
- `Texto`

La referencia usa el formato `Texto extenso 1`. `Registro`
describe el hecho con su fecha, como `Atención del 27/08/2026 17:15:00`. La
parte se expresa como `1 de 3`. Nunca se usa un ID interno para localizar el
contenido.

## Criterio automático de aceptación

Las pruebas deben demostrar sobre el modelo y sobre el XLSX real que:

1. los UUID internos de paciente, historia, turno, profesional, asignación y
   seguimiento no aparecen en celdas ni encabezados;
2. cada hoja relacionada contiene nombre de paciente y DNI;
3. las relaciones faltantes hacen fallar la construcción;
4. los valores compuestos muestran sus etiquetas y no contienen JSON visible;
5. el archivo conserva Unicode, textos muy largos e importes sin crear fórmulas;
6. LibreOffice puede reabrir las ocho hojas.
