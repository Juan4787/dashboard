# Turnos SaaS

Monorepo SvelteKit + Supabase preparado para evolucionar el panel actual hacia el SaaS de turnos, agenda, WhatsApp oficial, recordatorios, confirmaciones y ficha de pacientes/clientes.

## Estructura

```text
apps/web              App SvelteKit existente
packages/shared       Tipos, constantes y helpers compartidos
supabase/migrations   SQL versionado
supabase/functions    Edge Functions futuras
```

## Comandos

```sh
pnpm install
pnpm dev
pnpm check
pnpm test
pnpm test:e2e
pnpm build
```

## Supabase

```sh
pnpm supabase:start
pnpm supabase:types
pnpm supabase:db:reset
pnpm supabase:stop
```

Las variables de entorno viven en la raíz. `apps/web/vite.config.ts` usa `envDir: '../..'` para que SvelteKit las cargue desde el workspace root.

## Despliegues

El repositorio admite Netlify y Vercel. Netlify conserva su configuración en
`netlify.toml`; Vercel usa `vercel.json` y el adaptador se selecciona durante el
build según la plataforma.

Para crear el proyecto en Vercel, importá el repositorio manteniendo la raíz del
repositorio (no `apps/web`), usá Node 20 o superior y dejá que `vercel.json`
defina la instalación y el build. Cargá las mismas variables privadas de
producción que usaba Netlify, pero definí `PUBLIC_SITE_URL` con el dominio de
Vercel antes de promoverlo a producción. Después agregá ese dominio a:

- las Redirect URLs de Supabase (login, recuperación y reservas);
- los redirect URIs de Google Calendar, si está habilitado;
- la URL del webhook y los retornos de Mercado Pago, si esas integraciones se
  usan en producción.

El build equivalente que puede verificarse localmente es:

```sh
node scripts/vercel-build.mjs
```

## Estado actual

La app operativa es el panel SvelteKit de `apps/web`, con rutas `/odonto` protegidas, login Supabase, modo demo, modelo multi-tenant, agenda, turnos, ficha clínica y archivos privados en Supabase Storage.
