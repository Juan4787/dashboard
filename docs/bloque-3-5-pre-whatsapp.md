# Bloque 3.5 - Verificacion real pre-WhatsApp

Este bloque valida que la reserva publica y las acciones por token funcionan fuera de `DEMO_MODE`.

No avanzar a WhatsApp hasta completar este checklist en staging.

## 1. Comandos locales seguros

Ejecutar siempre desde la raiz del repo:

```bash
cd "/home/usuario/CascadeProjects/Base de Datos Sabrina"
```

Verificar codigo:

```bash
pnpm check
```

Ejecutar tests unitarios:

```bash
pnpm test
```

Compilar:

```bash
pnpm build
```

Validar preflight sin tocar Supabase remoto:

```bash
pnpm preflight:staging
```

Validar preflight consultando Supabase remoto con service role:

```bash
pnpm preflight:staging -- --remote
```

El preflight no imprime secrets. Solo indica si estan presentes, si parecen placeholder y si las tablas remotas existen.

## 2. Variables necesarias

El archivo local se lee desde la raiz:

```text
.env
```

Variables minimas para staging:

```env
ODONTO_SUPABASE_URL=https://xxxxx.supabase.co
ODONTO_SUPABASE_ANON_KEY=xxxxx
ODONTO_SUPABASE_SERVICE_ROLE_KEY=xxxxx
PUBLIC_ODONTO_SUPABASE_URL=https://xxxxx.supabase.co
PUBLIC_ODONTO_SUPABASE_ANON_KEY=xxxxx
PUBLIC_SITE_URL=https://tu-staging.netlify.app
DEMO_MODE=false
MASTER_EMAIL=tu-email@example.com
```

Variables recomendadas:

```env
ADMIN_SUPABASE_URL=https://xxxxx.supabase.co
ADMIN_SUPABASE_ANON_KEY=xxxxx
ADMIN_SUPABASE_SERVICE_ROLE_KEY=xxxxx
PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

No commitear nunca:

```text
ODONTO_SUPABASE_SERVICE_ROLE_KEY
ADMIN_SUPABASE_SERVICE_ROLE_KEY
TURNSTILE_SECRET_KEY
```

## 3. Supabase staging

Crear proyecto staging en Supabase.

En Supabase Dashboard, copiar:

```text
Project URL
anon public key
service_role key
```

Mapeo:

```text
Project URL      -> ODONTO_SUPABASE_URL y PUBLIC_ODONTO_SUPABASE_URL
anon public key  -> ODONTO_SUPABASE_ANON_KEY y PUBLIC_ODONTO_SUPABASE_ANON_KEY
service_role key -> ODONTO_SUPABASE_SERVICE_ROLE_KEY
```

Vincular proyecto:

```bash
supabase login
```

```bash
supabase link --project-ref TU_PROJECT_REF
```

Ver cambios antes de aplicar:

```bash
supabase db push --dry-run
```

Aplicar migrations:

```bash
supabase db push
```

No usar `supabase db reset` contra remoto.

## 4. Auth y usuario owner

En Supabase Dashboard:

```text
Authentication -> URL Configuration
```

Configurar:

```text
Site URL: https://tu-staging.netlify.app
Redirect URL: https://tu-staging.netlify.app/reset/callback
```

Crear usuario owner:

```text
Authentication -> Users -> Add user
```

Habilitar email en SQL Editor:

```sql
insert into public.allowed_emails (email, enabled)
values ('tu-email@example.com', true)
on conflict (email)
do update set enabled = excluded.enabled;
```

Verificar:

```sql
select *
from public.allowed_emails
order by created_at desc;
```

## 5. Netlify staging

En Netlify:

```text
Site configuration -> Environment variables
```

Configurar las mismas variables del `.env`, con:

```text
PUBLIC_SITE_URL=https://tu-staging.netlify.app
DEMO_MODE=false
```

Marcar como secretas:

```text
ODONTO_SUPABASE_SERVICE_ROLE_KEY
ADMIN_SUPABASE_SERVICE_ROLE_KEY
TURNSTILE_SECRET_KEY
```

## 6. Datos demo reales

Entrar al panel staging:

```text
https://tu-staging.netlify.app/login
```

Configurar negocio:

```text
/odonto/configuracion/negocio
```

Valores de prueba:

```text
Nombre: Consultorio Staging
Slug: consultorio-staging
Industria: odontology
Zona horaria: America/Argentina/Cordoba
Reserva publica: activa
Activo: activo
Mismo dia: activo para prueba inicial
Anticipacion minima: 0 para prueba inicial
Dias maximos hacia adelante: 30
```

Crear profesional:

```text
/odonto/profesionales
```

Ejemplo:

```text
Nombre: Dra. Perez
Especialidad: Odontologia general
Activo: si
Visible publico: si
```

Crear servicio:

```text
/odonto/servicios
```

Ejemplo:

```text
Nombre: Consulta
Duracion: 30
Buffer antes: 0
Buffer despues: 0
Activo: si
Visible publico: si
```

Asignar servicio al profesional desde el detalle del profesional.

Cargar disponibilidad:

```text
/odonto/disponibilidad
```

Ejemplo:

```text
Profesional: Dra. Perez
Dia: hoy o manana
Inicio: 09:00
Fin: 13:00
Intervalo: 30
Activo: si
```

## 7. Flujo real obligatorio

Abrir:

```text
https://tu-staging.netlify.app/reservar/consultorio-staging
```

Crear turno publico:

```text
Paciente: Paciente Publico Uno
Telefono: 3511234567
Servicio: Consulta
Profesional: Dra. Perez
```

Verificar:

```text
/odonto/agenda
/odonto/turnos/[appointmentId]
/odonto/mis-turnos si el profesional esta vinculado a usuario
```

Abrir token:

```text
/turno/[token]
```

Probar:

```text
confirmar
cancelar
pedir reprogramacion
```

Verificar SQL:

```sql
select id, status, starts_at, confirmed_at, cancelled_at, reschedule_requested_at, source
from public.appointments
order by created_at desc
limit 20;
```

```sql
select action, entity_type, entity_id, metadata, created_at
from public.audit_logs
order by created_at desc
limit 30;
```

```sql
select action, success, error_code, metadata, created_at
from public.public_booking_attempts
order by created_at desc
limit 30;
```

## 8. Turnstile

Activar Turnstile solo despues de que el flujo sin Turnstile funcione.

Crear widget en Cloudflare Turnstile.

Configurar dominio:

```text
tu-staging.netlify.app
```

Agregar variables:

```env
PUBLIC_TURNSTILE_SITE_KEY=sitekey
TURNSTILE_SECRET_KEY=secret
```

Redeploy y repetir una reserva publica.

## 9. Cierre del bloque

Checklist:

```text
[ ] Supabase staging creado
[ ] supabase link ejecutado
[ ] supabase db push --dry-run revisado
[ ] supabase db push aplicado
[ ] Netlify staging con env vars
[ ] DEMO_MODE=false
[ ] owner real puede loguearse
[ ] allowed_emails configurado
[ ] negocio real creado
[ ] profesional real creado
[ ] servicio real creado
[ ] servicio asignado al profesional
[ ] disponibilidad real cargada
[ ] /reservar/[slug] abre en staging
[ ] turno publico real se crea
[ ] aparece en agenda
[ ] aparece en mis-turnos si aplica
[ ] /turno/[token] abre
[ ] confirmar funciona
[ ] cancelar funciona y libera horario
[ ] pedir reprogramacion funciona
[ ] audit_logs registra eventos
[ ] public_booking_attempts registra intentos
[ ] Turnstile activo y probado
[ ] pnpm preflight:staging -- --remote pasa
```

Cuando todo eso este completo, se puede empezar WhatsApp oficial.
