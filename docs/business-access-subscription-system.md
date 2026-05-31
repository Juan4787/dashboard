# Sistema de accesos comerciales de Dental Suite

Fecha: 2026-05-28

Este documento describe la implementación del acceso comercial por consultorio. La regla central es:

```text
allowed_emails habilita la entrada por email.
business_users define el rol dentro del consultorio.
business_subscriptions define si el consultorio puede operar.
```

Los accesos existentes se preservan. La migración inicial deja todos los negocios existentes como permanentes y activos.

## Tablas

### allowed_emails

Sigue siendo la puerta global de entrada a Dental Suite.

No guarda licencia comercial. Sirve para habilitar o bloquear emails concretos.

Campos agregados:

```text
note
disabled_at
disabled_reason
created_by
updated_by
updated_at
```

### business_subscriptions

Define el estado comercial del consultorio.

Campos principales:

```text
business_id
commercial_access_enabled
is_permanent
subscription_status
access_starts_at
paid_until
grace_until
restricted_until
archived_at
last_payment_at
last_payment_amount
last_grant_duration_seconds
expiration_notice_enabled
access_source
access_note
updated_by
```

Estados persistidos:

```text
active
grace
restricted
archived
```

`expiring` no se persiste. Es un estado visual calculado cuando falta 1 día y el acceso tiene aviso preventivo activo.

### access_grants

Tabla append-only de auditoría comercial.

Registra:

```text
operación
duración
monto
origen
nota
admin
idempotency_key
fechas anteriores
fechas posteriores
estado anterior
estado posterior
```

No se actualiza ni se borra. Tiene triggers que bloquean `update` y `delete`.

## Estados

### Active

El consultorio opera normalmente.

Condición:

```text
is_permanent = true
o now <= paid_until
```

### Grace

El vencimiento pasó, pero todavía está dentro de las 48 horas posteriores.

Acceso:

```text
uso operativo normal
banner visible para owner/admin
```

### Restricted

Pasaron las 48 horas de gracia.

Acceso:

```text
lectura de información existente
sin creación ni edición operativa
sin reserva pública
sin acciones públicas por token
```

### Archived

Pasaron los 30 días de restricción o el negocio fue archivado manualmente.

Acceso:

```text
sin panel operativo normal
pantalla/estado de cuenta
reactivación o exportación por soporte
```

## Duraciones

El panel maestro soporta:

```text
1 hora
1 día
1 mes
2 meses
3 meses
4 meses
5 meses
6 meses
7 meses
8 meses
9 meses
10 meses
11 meses
12 meses
permanente
```

Los meses se computan como bloques comerciales de 30 días.

## Acumulación

Regla:

```text
si paid_until está en el futuro:
  nuevo paid_until = paid_until actual + duración

si paid_until está vencido o vacío:
  nuevo paid_until = now + duración
```

El período de gracia no cuenta como saldo pago.

## Permanencia

Una suscripción permanente:

```text
is_permanent = true
paid_until = null
grace_until = null
restricted_until = null
```

Puede pausarse o archivarse manualmente sin perder la marca de permanencia. En ese caso, el estado visual prioriza `restricted` o `archived`, no `permanent`.

## Idempotencia

Toda operación comercial requiere `idempotency_key`.

Si se reutiliza la misma clave con los mismos datos:

```text
no duplica el acceso
devuelve el movimiento existente
```

Si se reutiliza con datos distintos:

```text
falla
```

## Funciones SQL

### compute_business_subscription_status

Calcula:

```text
archived
restricted
active
grace
```

`archived_at` tiene prioridad sobre `commercial_access_enabled = false`.

### business_allows_operation

Devuelve si un consultorio puede operar.

Permite operar si:

```text
commercial_access_enabled = true
archived_at is null
y
is_permanent = true
o now <= paid_until
o now <= grace_until
```

Si no existe fila de suscripción, devuelve `true` por compatibilidad.

### user_can_operate_business

Ahora valida:

```text
rol owner/admin/reception
y business_allows_operation = true
```

Esto hace que las políticas RLS operativas existentes bloqueen escrituras cuando el consultorio está suspendido o archivado.

### grant_business_access

RPC service-role-only para el panel maestro.

Opera sobre:

```text
grant_access
extend_access
reduce_access
set_permanent
unset_permanent
disable_business_access
enable_business_access
archive_business
reactivate_business
manual_correction
payment_registered
payment_cancelled
```

## Enforcement

El bloqueo se aplica en tres niveles.

### 1. Helper central

Archivo:

```text
apps/web/src/lib/server/commercial-access.ts
```

Expone:

```text
getBusinessAccessState()
```

Devuelve:

```text
canEnterApp
canUseBusiness
commercialStatus
visualStatus
isPermanent
paidUntil
graceUntil
restrictedUntil
archivedAt
daysUntilExpiration
hoursUntilExpiration
shouldShowExpiringWarning
allowedCapabilities
```

### 2. Contexto de negocio

Archivo:

```text
apps/web/src/lib/server/business.ts
```

`resolveActiveBusiness()` carga la suscripción y deriva:

```text
canManage
canOperate
access
```

Si falla la carga de `business_subscriptions`, conserva acceso activo por compatibilidad.

### 3. Rutas y acciones

Se bloquean acciones operativas en servidor:

```text
crear pacientes
editar pacientes
archivar/desarchivar/eliminar pacientes
crear/editar entradas clínicas
vincular archivos externos
crear turnos
editar turnos
configurar servicios
configurar profesionales
configurar disponibilidad
configurar usuarios
configurar negocio
configurar WhatsApp
generar/procesar recordatorios
```

La reserva pública y los tokens públicos se bloquean con mensajes neutros que no exponen el motivo comercial al paciente.

## UI

### Panel maestro

Ruta:

```text
/odonto/maestro
```

Gestiona:

```text
emails globales
consultorios
suscripciones
permanencia
suspensión
archivo
historial
cierre de sesiones
```

### Configuración / Suscripción

Ruta:

```text
/odonto/configuracion/suscripcion
```

Muestra:

```text
estado actual
vencimiento
límite antes de suspensión
límite antes de archivo
último pago
origen
nota
historial de movimientos
```

### Navbar

Muestra aviso sólo cuando corresponde:

```text
owner/admin: expiring, grace, restricted, archived
otros roles: restricted, archived
```

## Compatibilidad

La migración hace backfill:

```text
todos los businesses existentes -> permanente + active
```

Además:

```text
si falta la fila de suscripción -> helper devuelve active/permanent
si falla la query de suscripción -> resolveActiveBusiness conserva acceso
```

Esto evita cortar el acceso a usuarios existentes durante el despliegue.
