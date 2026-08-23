# Identidad de pacientes y creación de turnos

Fecha de la decisión: 23 de agosto de 2026.

## Invariantes

- `patients.id` es la única identidad interna de una persona.
- El DNI continúa siendo único dentro del consultorio cuando está informado.
- Nombre, teléfono y correo son atributos descriptivos y pueden repetirse.
- Dos fichas con el mismo teléfono conservan IDs, turnos, historias clínicas, radiografías,
  seguimientos y bloqueos independientes.
- Una ficha archivada nunca se reutiliza automáticamente.
- `patients.blocked` se aplica sólo a ese `patient_id`; no funciona como lista negra del teléfono.

El índice `patients_business_phone_e164_uq` fue reemplazado por
`patients_business_phone_e164_idx`, que sirve para buscar sin imponer unicidad.
También se eliminó el índice histórico `patients_owner_dni_uq`: el único índice de DNI que
permanece es `patients_business_dni_uq`, para que dos consultorios del mismo dueño técnico no se
bloqueen entre sí.

## Contrato de creación

Toda creación interna declara una estrategia explícita:

- `existing`: exige `patientId` y no admite nombre o correo alternativos. El turno queda asociado
  exactamente al ID seleccionado.
- `new`: prohíbe `patientId` y siempre crea una ficha nueva, aunque nombre o teléfono coincidan.
- `public`: prohíbe `patientId`. Es una transición conservadora para una reserva anónima.

El servidor no busca una ficha por teléfono para los modos `existing` o `new`.

El RPC es exclusivo de `service_role`. Si recibe `owner_id` o `created_by_user_id`, comprueba que
sean integrantes activos del consultorio. En una reserva pública vuelve a comprobar dentro de la
misma transacción que el servicio y todos los profesionales sigan activos, públicos y asignados;
la disponibilidad calculada antes no se considera autorización permanente.

La reserva pública sólo reutiliza una ficha activa cuando existe exactamente una coincidencia de
nombre normalizado + teléfono E.164. Si no hay coincidencias o hay varias, crea una ficha nueva. No
elige la primera fila y no reutiliza fichas archivadas.

Nombre + teléfono no prueban identidad. La solución absoluta para que una persona pública vuelva
a su ficha requeriría una referencia firmada o autenticación. Hasta entonces, ante cualquier
ambigüedad se prioriza no mezclar historias clínicas.

## Atomicidad e idempotencia

`create_appointment_with_patient_identity` crea paciente y turno en una única transacción. También
abarca los turnos conjuntos. Si falla el servicio, el profesional, el horario, una superposición o
la asignación del equipo, la ficha nueva se revierte junto con el turno.

Cada envío lleva un UUID de idempotencia. El turno guarda:

- `creation_request_key`;
- `creation_request_fingerprint`.

La misma clave con el mismo contenido devuelve el turno original. La misma clave con otro contenido
se rechaza. Dos solicitudes simultáneas idénticas producen una ficha y un turno, no duplicados.

El modo interno `replay_only` consulta esa misma clave y huella sin crear ni modificar filas. Agenda
y la reserva pública lo ejecutan antes de revalidar cupo, rate limits y disponibilidad. Así, si la
primera respuesta se perdió después del commit, el reintento recupera el cuarto turno o el horario
ya ocupado en vez de informar un falso error. Un replay no registra otro intento anti-spam.

## Diagnóstico y procedencia

Cada turno conserva:

- `patient_name_at_booking`;
- `patient_phone_raw_at_booking`, incluso si el texto era incompleto o inválido;
- `patient_phone_e164_at_booking`;
- `patient_resolution_strategy`;
- la clave y huella de creación.

Las estrategias posibles distinguen datos históricos, selección por ID, alta explícita, asociación
pública exacta, alta pública nueva, ambigüedad pública y reasignación manual. Un trigger de
compatibilidad deriva siempre las instantáneas desde el `patient_id` real para creadores antiguos
de turnos conjuntos y rechaza procedencia atómica falsificada en un `INSERT` directo.

Las columnas de identidad, instantáneas, procedencia y el token público no pueden modificarse
mediante un `UPDATE` genérico. Sólo el creador atómico y el RPC de reparación abren una autorización
local a la transacción. El origen conserva la transición interna requerida por el creador conjunto
histórico.

## Límite público y abuso

El cupo de cuatro turnos futuros no usa sólo el nombre ni trata el teléfono como identidad. Cuenta
la unión de:

- los turnos del `patient_id` resuelto;
- las reservas públicas del mismo bucket antiabuso.

El bucket es un SHA-256 de nombre normalizado + teléfono y se guarda en
`public_booking_contact_key`. No enlaza historias ni bloqueos. Juan y Carlos con el mismo número
tienen buckets distintos por tener nombres distintos. Si hay dos fichas idénticas y cada reserva
debe crear otro ID por seguridad, el bucket evita que esa ambigüedad reinicie el cupo.

Los cambios de nombre, teléfono o archivado se serializan con la resolución pública mediante un
bloqueo transaccional. La lectura pública no toma después un bloqueo de fila en orden inverso, por
lo que una edición concurrente no puede formar una espera circular. Esto no agrega una restricción
única: sólo evita decisiones distintas por una carrera concurrente.

Los límites temporales por teléfono e IP continúan como protección anti-spam y tampoco crean
identidad clínica.

Una reasignación histórica actualiza primero el bucket descriptivo aunque el paciente destino ya
tenga cuatro turnos. Esa excepción existe sólo dentro del RPC de reparación auditado: el turno
corregido permanece contado y una reserva futura sigue siendo rechazada mientras el total exceda
el cupo.

## Reparación controlada

`reassign_appointment_patient_safely` es exclusivo de `service_role` y exige negocio, turno, nuevo
paciente, actor y motivo. Antes de reasignar:

- rechaza fichas archivadas o bloqueadas;
- se detiene si un WhatsApp, un Push o una sincronización Google ya están en vuelo;
- bloquea las filas de cola y suscripción antes de comprobarlas: un worker que reclamó primero se
  observa como envío en curso y, si la reparación bloqueó primero, el worker omite esas filas;
- cancela despachos pendientes y marca como reemplazado todo despacho histórico de la asociación
  anterior, sin borrar si fue enviado, entregado o leído;
- permite que un recordatorio nuevo ocupe el índice activo sin borrar la evidencia del anterior;
- revoca las suscripciones Push, limpia sus marcas de recordatorio y supersede todos los intentos,
  incluidos los de prueba para que una respuesta tardía no reactive el dispositivo anterior;
- impide insertar telemetría Push para una suscripción revocada o perteneciente a otro turno. La
  aplicación no envía el Push si esa defensa gana una carrera, aun cuando el aviso programado
  normalmente toleraría una falla de telemetría;
- rota `confirmation_token`, por lo que los enlaces enviados a la persona anterior dejan de abrir
  el turno;
- invalida intentos OAuth no consumidos y encola la eliminación de cualquier evento Google del
  paciente anterior;
- actualiza instantáneas y bucket público;
- reinicia la cobertura de calendario para que la ficha nueva deba registrar su propia acción;
- recalcula la actividad de la ficha anterior;
- registra una auditoría con IDs anterior y nuevo, motivo y cantidades reparadas.

Una notificación ya visible, un WhatsApp ya entregado o un archivo de calendario descargado no se
pueden retirar del dispositivo remoto. Se conservan como historial reemplazado, y la rotación del
token impide que sus enlaces sigan dando acceso al turno.

Las consultas de cobertura y el claim de WhatsApp excluyen `superseded_at`: un envío anterior no
puede ocultar el recordatorio que necesita la ficha corregida ni volver a ser reclamado.

No existe información suficiente para reparar masivamente asociaciones históricas: los turnos
anteriores no guardaban el nombre ingresado originalmente. Sólo deben corregirse casos confirmados.

## Despliegue y reversión

Las migraciones se aplican en este orden:

1. desacople, creador atómico, snapshots, idempotencia y política pública;
2. reparación segura y actividad;
3. protección de campos de identidad.

El preflight remoto exige los RPC nuevos. La función heredada no versionada
`reserve_public_booking_hold_safely`, que resolvía por teléfono, se elimina en todas sus sobrecargas.

Después de admitir teléfonos repetidos, una reversión no puede restaurar el índice único. El camino
seguro es mantener el esquema no único, volver a código compatible y, si fuera necesario, desactivar
temporalmente nuevas altas mientras se corrige el problema.

## Matriz mínima de regresión

- Juan + teléfono A y Carlos + teléfono A generan dos IDs y dos turnos.
- Buscar el teléfono devuelve ambas fichas y la interfaz muestra datos para distinguirlas.
- Bloquear a Juan no bloquea a Carlos.
- Ambos pueden usar el mismo destino de WhatsApp en turnos separados.
- Historias, radiografías, seguimientos y vínculos profesionales permanecen por `patient_id`.
- Reserva individual y conjunta tienen rollback atómico.
- Reintentos idénticos y simultáneos no duplican datos.
- El replay del cuarto turno funciona antes del cupo y no crea otro intento ni otra ficha.
- Homónimos y contactos ambiguos no se seleccionan automáticamente.
- El quinto turno público se rechaza incluso en una coincidencia ambigua.
- Una carrera pública exacta genera una ficha y dos turnos; una carrera con el mismo teléfono y
  nombres distintos genera dos fichas.
- La reasignación invalida enlaces, mensajería, Push y calendario de forma auditable, preservando
  la evidencia de entregas históricas.
- La reparación funciona con el cupo destino completo, pero el quinto turno resultante continúa
  contando para impedir nuevas reservas.
