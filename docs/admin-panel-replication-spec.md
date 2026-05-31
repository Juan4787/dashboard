# Especificación para replicar el panel de administración en Dental Suite

Fecha de análisis: 2026-05-27

Esta documentación deja estudiado el diseño funcional del panel administrativo existente y define cómo debe replicarse más adelante dentro de la app de consultorios Dental Suite.

El criterio principal queda fijado así:

```text
La lógica operativa debe mantenerse.
La interfaz visual debe seguir el lenguaje actual de Dental Suite.
No se debe copiar la estética vieja/liviana del módulo administrativo.
```

## 1. Alcance exacto

Hay dos piezas administrativas relevantes en el repo:

```text
/administrativo
/odonto/maestro
```

`/administrativo` contiene la lógica de un panel operativo tipo expediente:

```text
lista principal
búsqueda
filtros por estado
alta rápida en modal
detalle
timeline
nuevo movimiento
edición
archivo/cierre
```

`/odonto/maestro` contiene la lógica de administración de accesos por correo:

```text
listar correos autorizados
agregar correo
habilitar/deshabilitar
eliminar
confirmaciones destructivas por texto
restricción por MASTER_EMAIL
```

Para Dental Suite, el panel futuro debe tomar:

```text
Lógica de administración:
  conservar el comportamiento y la seguridad.

UI:
  usar el sistema visual actual de Dental Suite.

Mejora agregada:
  incorporar una opción de acceso por 1 día / 24 horas.
```

## 2. Regla de diseño final

La UI final no debe parecer el módulo administrativo viejo.

No usar como referencia visual principal:

```text
fondos claros
cards blancas
navbar simple blanco
botones azules primary-600
formularios administrativos compactos estilo oficina
```

Sí usar como referencia visual:

```text
Dental Suite actual
fondo oscuro azul profundo
cards tipo glass oscuro
bordes #244062
acento violeta #7c3aed
ux-hero
ux-card
ux-soft-card
ux-choice
ux-input
ux-select
ux-textarea
ux-btn-primary
ux-btn-secondary
ux-btn-danger
ux-badge
ux-alert
```

El panel debe sentirse parte del mismo producto que:

```text
/odonto/agenda
/odonto/configuracion
/odonto/disponibilidad
/odonto/mensajes
/odonto/turnos/[appointmentId]
```

No debe sentirse como una app vieja pegada encima.

## 3. Sistema visual Dental Suite que debe usarse

Los tokens visuales actuales están definidos en:

```text
apps/web/src/app.css
```

Clases base:

```text
ux-page
ux-hero
ux-card
ux-panel
ux-title
ux-subtitle
ux-section-title
ux-muted
ux-soft-card
ux-choice
ux-choice-active
ux-input
ux-select
ux-textarea
ux-label
ux-btn-primary
ux-btn-secondary
ux-btn-danger
ux-badge
ux-badge-success
ux-badge-warning
ux-badge-danger
ux-empty
ux-alert
ux-alert-success
ux-pill-nav
```

Valores visuales importantes:

```text
Fondo general oscuro:
  #0b1626

Card principal:
  radial-gradient con violeta suave arriba a la izquierda
  linear-gradient entre #0b1d32 y #071626

Borde principal:
  #244062

Acento principal:
  #7c3aed

Acento hover:
  #6d28d9

Texto principal:
  #ffffff

Texto secundario:
  rgba(255,255,255,0.55 - 0.72)

Radio de cards:
  1.25rem a 1.75rem

Sombra:
  shadow oscuro suave, no sombras duras
```

## 4. Layout que debe replicarse

El layout nuevo debe vivir dentro de la navegación actual de Dental Suite.

No crear un layout paralelo como `/administrativo/+layout.svelte`.

Debe usar el layout de:

```text
apps/web/src/routes/odonto/+layout.svelte
```

El panel futuro debe verse como una sección más del sistema, por ejemplo:

```text
/odonto/maestro
```

o, si se separa más adelante:

```text
/odonto/admin
/odonto/admin/accesos
/odonto/admin/expedientes
```

La estructura visual recomendada:

```text
ux-page
  ux-hero
    ux-badge
    ux-title
    ux-subtitle

  grid principal
    ux-card para acción primaria
    ux-card para lista / tabla / estado

  modales para acciones secundarias o destructivas
```

## 5. Panel maestro actual: lógica estudiada

Archivo principal:

```text
apps/web/src/routes/odonto/maestro/+page.svelte
apps/web/src/routes/odonto/maestro/+page.server.ts
```

Tabla usada:

```text
allowed_emails
```

Migración base:

```text
supabase/migrations/20251231000000_existing_odonto_base.sql
```

Estructura actual:

```sql
allowed_emails (
  id uuid primary key,
  email text not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
)
```

Función actual de acceso:

```sql
public.is_email_enabled(p_email text)
```

Regla actual:

```text
El correo puede ingresar si existe en allowed_emails y enabled = true.
```

Restricción del panel:

```text
Solo MASTER_EMAIL puede entrar al panel maestro.
```

Función server-side:

```ts
ensureMaster(accessToken)
```

Si el usuario no es master:

```text
redirect 303 a /odonto/pacientes
```

## 6. Acciones actuales del panel maestro

### 6.1 Cargar lista

Carga:

```text
id
email
enabled
created_at
```

Orden:

```text
email ascendente
```

Error de carga:

```text
No se pudo cargar la lista. Revisá la conexión.
```

### 6.2 Agregar correo

Acción:

```text
add_email
```

Campos actuales:

```text
email
enabled
```

Validación:

```text
email no vacío
email contiene @
email se guarda en minúsculas
```

Errores actuales:

```text
Ingresá un correo electrónico válido.
Ese correo electrónico ya existe en la lista.
No pudimos guardar el correo electrónico.
```

### 6.3 Habilitar / deshabilitar

Acción:

```text
toggle_email
```

Campos:

```text
id
enabled
```

Validación:

```text
id obligatorio
```

Confirmación visual actual para deshabilitar:

```text
abrir modal
mostrar correo objetivo
pedir escribir "deshabilitar"
habilitar botón solo si el texto coincide
```

### 6.4 Eliminar

Acción:

```text
delete_email
```

Campos:

```text
id
```

Confirmación visual actual:

```text
abrir modal
mostrar correo objetivo
pedir escribir "eliminar"
habilitar botón solo si el texto coincide
```

Esta lógica de confirmación debe conservarse.

## 7. Mejora obligatoria: opción 1 día / 24 horas

El panel futuro debe agregar una opción de acceso temporal:

```text
1 día (24 horas)
```

El comportamiento esperado:

```text
El master agrega un correo.
Elige una duración de acceso.
Si elige 1 día (24 horas), el acceso vence automáticamente 24 horas después de creado.
Pasadas las 24 horas, ese correo ya no puede iniciar sesión.
El registro puede quedar visible en el panel como vencido.
```

### 7.1 Opciones recomendadas

Opciones mínimas:

```text
1 día (24 horas)
Sin vencimiento
```

Opciones recomendadas si se quiere mantener flexibilidad:

```text
1 día (24 horas)
7 días
30 días
Sin vencimiento
```

La opción nueva pedida explícitamente es:

```text
1 día (24 horas)
```

### 7.2 Modelo de datos recomendado

Agregar columnas a `allowed_emails`:

```sql
access_expires_at timestamptz null
access_duration text not null default 'unlimited'
updated_at timestamptz not null default now()
disabled_at timestamptz null
```

Valores sugeridos para `access_duration`:

```text
24h
7d
30d
unlimited
```

Para `1 día (24 horas)`:

```sql
access_expires_at = now() + interval '24 hours'
access_duration = '24h'
enabled = true
```

Para `Sin vencimiento`:

```sql
access_expires_at = null
access_duration = 'unlimited'
enabled = true
```

### 7.3 Cambio necesario en función de acceso

La función `is_email_enabled` debe cambiar de:

```sql
ae.enabled = true
```

a:

```sql
ae.enabled = true
and (
  ae.access_expires_at is null
  or ae.access_expires_at > now()
)
```

Es decir:

```text
enabled controla habilitación manual.
access_expires_at controla vencimiento automático.
ambas condiciones deben cumplirse.
```

### 7.4 Estado visual del acceso

La lista no debe mostrar solo:

```text
Habilitado
Deshabilitado
```

Debe distinguir:

```text
Habilitado
Vence en 24 horas / vence hoy / vence mañana
Vencido
Deshabilitado
```

Reglas:

```text
enabled = false:
  Deshabilitado

enabled = true y access_expires_at < now():
  Vencido

enabled = true y access_expires_at >= now():
  Habilitado hasta fecha/hora

enabled = true y access_expires_at is null:
  Sin vencimiento
```

### 7.5 Acciones sobre correos vencidos

El panel debe permitir:

```text
Reactivar sin vencimiento
Renovar por 1 día (24 horas)
Eliminar
```

No hace falta agregar todo en primera versión si se busca simpleza. Mínimo:

```text
Eliminar
Habilitar
```

Pero lo ideal para UX es:

```text
Renovar 24 h
Sin vencimiento
Eliminar
```

## 8. UI final recomendada para el panel maestro en Dental Suite

### 8.1 Hero

Debe usar:

```svelte
<section class="ux-page">
  <div class="ux-hero">
    <p class="ux-badge">Panel maestro</p>
    <h1 class="ux-title mt-4">Accesos autorizados</h1>
    <p class="ux-subtitle">Gestioná qué correos pueden entrar al sistema y por cuánto tiempo.</p>
  </div>
</section>
```

No usar:

```text
header blanco
texto "Administrativo · ANSES"
estética light
```

### 8.2 Card de alta

Debe ser una `ux-card`.

Campos:

```text
Correo
Duración del acceso
Estado inicial
```

Duración del acceso debe ser una elección visual, no un select técnico.

Opciones visuales:

```text
1 día (24 horas)
7 días
30 días
Sin vencimiento
```

La opción seleccionada debe usar:

```text
ux-choice-active
```

El CTA principal:

```text
Guardar acceso
```

### 8.3 Lista de accesos

Debe estar en `ux-card`.

Cada correo debe renderizarse como `ux-soft-card`.

Contenido por fila:

```text
email
badge de estado
fecha de vencimiento si existe
fecha de creación
acciones
```

Acciones:

```text
Habilitar
Deshabilitar
Renovar 24 h
Eliminar
```

Acciones destructivas:

```text
Deshabilitar
Eliminar
```

Ambas deben conservar confirmación por texto:

```text
deshabilitar
eliminar
```

### 8.4 Modal de confirmación

Mantener el patrón actual:

```text
Modal
texto claro
correo afectado
input de confirmación
botón deshabilitado hasta que el texto coincida
botón cancelar
botón destructivo
```

Pero estilizarlo coherente con Dental Suite:

```text
fondo dark
borde #244062
botón danger
texto blanco / gris
```

## 9. Panel administrativo de expedientes: lógica estudiada

Archivo fuente:

```text
apps/web/src/routes/administrativo/expedientes/+page.svelte
apps/web/src/routes/administrativo/expedientes/+page.server.ts
apps/web/src/routes/administrativo/expedientes/[id]/+page.svelte
apps/web/src/routes/administrativo/expedientes/[id]/+page.server.ts
```

Este módulo está actualmente deshabilitado por layout:

```ts
throw redirect(303, '/odonto/pacientes');
```

Eso significa que la lógica existe, pero el acceso al módulo administrativo está bloqueado.

### 9.1 Lista principal

Comportamiento:

```text
cargar hasta 200 expedientes
ordenar por updated_at descendente
filtrar por estado vía query param estado
filtrar localmente mientras se escribe
buscar por título, persona o DNI/CUIL
normalizar búsqueda sin acentos y sin mayúsculas
abrir detalle al hacer click en la tarjeta
crear expediente desde modal
```

Estados disponibles:

```text
Nuevo
En curso
Pendiente docs
Presentado
Resuelto
Cerrado
```

La lógica de búsqueda local:

```text
normalize string
remove diacritics
lowercase
comparar contra title/person_name/person_dni
```

Esto debe conservarse si se replica este flujo.

### 9.2 Alta rápida de expediente

Modal:

```text
Alta rápida de expediente
```

Campos:

```text
Persona *
DNI / CUIL
Teléfono
Correo electrónico
Carátula / título *
Estado
Próxima acción
Fecha objetivo
```

Validación:

```text
Persona obligatoria
Carátula/título obligatorio
```

En base real:

```text
si existe persona con el mismo DNI, reutiliza persona
si no existe, crea persona
crea expediente asociado
redirige al detalle
```

### 9.3 Detalle de expediente

El detalle muestra:

```text
título
persona
DNI/CUIL
estado
próxima acción
timeline de movimientos
datos de persona
notas internas
fecha de creación
última actualización
```

Acciones:

```text
Atrás
Archivar
Editar
Nuevo movimiento
```

### 9.4 Timeline

Componente:

```text
apps/web/src/lib/components/Timeline.svelte
```

Renderiza eventos:

```text
title = event_type
description = detail
meta = fecha/hora formateada
badge = event_type
```

Orden:

```text
created_at descendente
```

Tipos de movimiento:

```text
Llamada
Presentación
Rechazo
Requerimiento
Envío docs
Visita
Nota
```

### 9.5 Nuevo movimiento

Modal:

```text
Nuevo movimiento
```

Campos:

```text
Tipo
Fecha y hora
Detalle
```

El input de fecha/hora usa:

```text
DateTimePartsInput
```

No usa input nativo de fecha/hora.

Validaciones:

```text
created_at obligatorio
formato esperado YYYY-MM-DDTHH:mm
año entre 2000 y 2045
mes 1 a 12
día válido para ese mes
hora 00:00 a 23:59
tipo obligatorio
detalle obligatorio
```

Esto es importante para replicar el criterio de UX:

```text
validación clara
mensaje humano
evitar errores crudos
```

### 9.6 Editar expediente

Modal:

```text
Editar expediente
```

Campos:

```text
Estado
Próxima acción
Fecha objetivo
Notas internas
```

Actualizar:

```text
status
notes
next_action
next_action_date
updated_at
```

### 9.7 Archivar

Acción:

```text
archive_case
```

Comportamiento:

```text
confirm nativo del navegador
status = Cerrado
archived_at = now()
redirect a /administrativo/expedientes?estado=Cerrado
```

Para Dental Suite, no usar `confirm()` nativo. Debe reemplazarse por modal estilo Dental Suite.

## 10. Cómo adaptar la lógica a Dental Suite

La lógica debe mantenerse, pero con nombres de dominio Dental Suite.

Ejemplo si el panel administra accesos:

```text
cases        -> allowed_emails / business_access / invitations
case_events  -> access_events / audit_logs
people       -> users / profiles / business_users
```

Ejemplo si el panel administra consultorios:

```text
caseFile.title     -> nombre del consultorio
caseFile.status    -> estado del consultorio
person_name        -> responsable
person_dni         -> CUIT/DNI si aplica
next_action        -> próxima acción comercial/soporte
case_events        -> historial administrativo
```

No copiar textos de ANSES:

```text
Expedientes
Carátula
DNI/CUIL
Presentado
Requerimiento
```

Adaptar a textos del producto:

```text
Accesos
Consultorios
Clientes
Usuarios autorizados
Estado de acceso
Historial
Próxima acción
```

## 11. Pantalla recomendada: Accesos autorizados

Esta es la adaptación más directa para Dental Suite.

Ruta recomendada:

```text
/odonto/maestro
```

Título:

```text
Accesos autorizados
```

Subtítulo:

```text
Gestioná qué correos pueden entrar al sistema y por cuánto tiempo.
```

Secciones:

```text
1. Nuevo acceso
2. Accesos activos
3. Accesos vencidos/deshabilitados
```

Alta:

```text
Correo
Duración
Estado inicial
Guardar acceso
```

Duración:

```text
1 día (24 horas)
7 días
30 días
Sin vencimiento
```

Lista:

```text
email
estado
vencimiento
acciones
```

Acciones:

```text
Renovar 24 h
Habilitar
Deshabilitar
Eliminar
```

## 12. Estados recomendados de acceso

Definir función de estado visual:

```ts
if (!enabled) return 'disabled';
if (access_expires_at && access_expires_at <= now) return 'expired';
if (access_expires_at) return 'temporary';
return 'active';
```

Etiquetas:

```text
active:
  Habilitado

temporary:
  Temporal

expired:
  Vencido

disabled:
  Deshabilitado
```

Badges:

```text
active:
  ux-badge ux-badge-success

temporary:
  ux-badge ux-badge-warning

expired:
  ux-badge ux-badge-danger

disabled:
  ux-badge
```

## 13. Reglas de seguridad

Mantener:

```text
solo MASTER_EMAIL accede al panel maestro
server-side redirect si no corresponde
validación server-side para cada acción
no confiar solo en UI
```

Agregar:

```text
el login debe rechazar correos vencidos
las acciones de renovación deben recalcular access_expires_at en servidor
no permitir duración arbitraria desde frontend sin validar
```

Valores válidos server-side:

```text
24h
7d
30d
unlimited
```

Si llega otro valor:

```text
fail 400: Duración inválida.
```

## 14. Migración recomendada para 1 día / 24 horas

Crear migración nueva, no modificar la base vieja directamente:

```sql
alter table allowed_emails
  add column if not exists access_duration text not null default 'unlimited',
  add column if not exists access_expires_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists disabled_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'allowed_emails_access_duration_chk'
  ) then
    alter table allowed_emails
      add constraint allowed_emails_access_duration_chk
      check (access_duration in ('24h', '7d', '30d', 'unlimited'));
  end if;
end $$;

create or replace function public.is_email_enabled(p_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from allowed_emails ae
    where lower(ae.email) = lower(trim(p_email))
      and ae.enabled = true
      and (
        ae.access_expires_at is null
        or ae.access_expires_at > now()
      )
  );
$$;
```

## 15. Acciones server-side recomendadas

### 15.1 add_email

Entrada:

```text
email
enabled
access_duration
```

Calcular:

```ts
const expiresAt =
  access_duration === '24h' ? addHours(now, 24)
  : access_duration === '7d' ? addDays(now, 7)
  : access_duration === '30d' ? addDays(now, 30)
  : null;
```

Insertar:

```text
email
enabled
access_duration
access_expires_at
created_at
updated_at
```

### 15.2 renew_email

Entrada:

```text
id
access_duration
```

Validar:

```text
id existe
duration válida
```

Actualizar:

```text
enabled = true
access_duration = duración elegida
access_expires_at = fecha calculada o null
disabled_at = null
updated_at = now()
```

### 15.3 toggle_email

Si deshabilita:

```text
enabled = false
disabled_at = now()
updated_at = now()
```

Si habilita:

```text
enabled = true
disabled_at = null
updated_at = now()
```

No debe borrar `access_expires_at` automáticamente salvo que la acción sea renovar sin vencimiento.

### 15.4 delete_email

Mantener igual:

```text
delete by id
```

Con modal de confirmación.

## 16. UX exacta para la opción 1 día / 24 horas

La opción debe ser visible en el alta.

Texto recomendado:

```text
1 día
24 horas
```

Debe verse como tarjeta seleccionable:

```text
Título: 1 día
Subtexto: 24 horas
```

No usar:

```text
24h
expires_at
access_duration
temporal
```

El usuario final no debe leer nombres técnicos.

## 17. Diferencias entre lógica y UI

Esta es la regla más importante para la futura implementación:

```text
La lógica debe comportarse como el panel existente.
La UI debe verse como Dental Suite.
```

Ejemplo:

El panel viejo hace:

```text
modal para crear
validación server-side
redirect después de crear
confirmación destructiva
```

Eso se conserva.

Pero visualmente se reemplaza:

```text
rounded-2xl bg-white border-neutral
```

por:

```text
ux-card / ux-soft-card / ux-btn-primary / ux-btn-danger
```

## 18. Cosas que no deben replicarse

No replicar:

```text
Administrativo · ANSES
navbar viejo de /administrativo
cards blancas como sistema principal
confirm() nativo para archivar
formularios largos sin jerarquía visual
selects cuando una tarjeta o botones sean más claros
textos de dominio ANSES
```

## 19. Criterios de cierre para futura implementación

El panel replicado se considera correcto si cumple:

```text
1. Solo MASTER_EMAIL puede entrar.
2. La UI usa Dental Suite oscuro/violeta.
3. Se puede agregar correo autorizado.
4. Se puede elegir 1 día (24 horas).
5. El acceso de 1 día vence realmente en servidor.
6. El login rechaza correos vencidos.
7. Se puede renovar acceso por 24 horas.
8. Se puede habilitar/deshabilitar.
9. Se puede eliminar con confirmación por texto.
10. No aparece ningún término técnico al usuario.
11. No se rompe la lógica actual de allowed_emails.
12. La app sigue compilando.
```

## 20. Resumen ejecutivo

La implementación futura no debe copiar literalmente `/administrativo` como pantalla.

Debe copiar:

```text
estructura funcional
validaciones
acciones server-side
confirmaciones
flujo de alta/listado/detalle/historial si aplica
```

Debe reemplazar:

```text
estética vieja
layout claro
botones azules
navbar administrativo
textos ANSES
```

por:

```text
Dental Suite dark UI
ux-* components
lenguaje simple
acciones claras
opción 1 día / 24 horas
control de vencimiento real
```

