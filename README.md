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

El repositorio admite Netlify, Vercel y Cloudflare Workers. Netlify conserva su
configuración en `netlify.toml`; Vercel usa `vercel.json`; y Workers usa
`wrangler.jsonc`. El adaptador se selecciona durante el build según la
plataforma, sin compartir artefactos entre proveedores.

Para crear el proyecto en Vercel, configurá `apps/web` como **Root Directory**
y mantené habilitada la opción para incluir archivos fuera de esa raíz. Así
Vercel encuentra su `vercel.json`, y sus comandos vuelven a la raíz del
monorepo para resolver `packages/shared`. Usá Node 20 o superior. Cargá las
mismas variables privadas de producción que usaba Netlify, pero definí
`PUBLIC_SITE_URL` con el dominio de Vercel antes de promoverlo a producción.
Después agregá ese dominio a:

- las Redirect URLs de Supabase (login, recuperación y reservas);
- los redirect URIs de Google Calendar, si está habilitado;
- la URL del webhook y los retornos de Mercado Pago, si esas integraciones se
  usan en producción.

El build equivalente que puede verificarse localmente es:

```sh
node scripts/vercel-build.mjs
```

### Cloudflare Workers (producción comercial)

Workers es la plataforma prevista para la producción comercial. El Worker se
llama `cita-suite` y usa el artefacto de SvelteKit generado exclusivamente por
el adaptador de Cloudflare. Netlify y Vercel no cambian de configuración ni de
adaptador.

Antes del primer despliegue, configurá el proyecto de Workers con **Root
Directory** en la raíz del repositorio y Node 20.3 o superior. En **Settings →
Builds** usá estos comandos:

```text
Build command: pnpm build:cloudflare
Deploy command: pnpm --filter web exec wrangler deploy --config ../../wrangler.jsonc
Non-production branch deploy command: pnpm --filter web exec wrangler versions upload --config ../../wrangler.jsonc
```

El nombre del Worker creado en el panel debe ser exactamente `cita-suite`, como
en `wrangler.jsonc`. Para un despliegue desde una máquina autorizada:

```sh
pnpm deploy:cloudflare
```

No copies valores privados al repositorio ni a `wrangler.jsonc`. Cargá en
Cloudflare, en **Settings → Variables and Secrets**, las mismas variables de
producción que necesita el servidor (incluidas las claves de Supabase,
integraciones de calendario, mensajería y VAPID). `DEMO_MODE` debe permanecer
sin definir o con valor distinto de `true` en producción. Definí también
`PUBLIC_SITE_URL` con el dominio final de Cloudflare y agregalo a las Redirect
URLs de Supabase, a los redirect URIs de Google Calendar y a los retornos y
webhooks de Mercado Pago que estén habilitados.

Para una vista previa de Workers desde la terminal, tras cargar secretos locales
en un archivo no versionado `.dev.vars`, ejecutá:

```sh
pnpm dev:cloudflare
```

Los secretos locales no se incluyen en Git. El Worker usa la compatibilidad de
Node de Cloudflare para mantener los módulos de servidor existentes. El
`compatibility_date` queda fijado a la última fecha compatible con la versión
de Wrangler que conserva soporte para Node 20.3, el mínimo ya documentado para
los despliegues existentes.

## Estado actual

La app operativa es el panel SvelteKit de `apps/web`, con rutas `/odonto` protegidas, login Supabase, modo demo, modelo multi-tenant, agenda, turnos, ficha clínica y archivos privados en Supabase Storage.
