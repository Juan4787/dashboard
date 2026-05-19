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

## Estado actual

La app operativa sigue siendo el panel SvelteKit existente en `apps/web`, con rutas `/odonto` protegidas, login Supabase, modo demo y radiografías vía Google Drive. Las siguientes fases incorporan el modelo multi-tenant, turnos, disponibilidad, agenda y WhatsApp oficial.
