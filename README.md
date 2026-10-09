# Moseek

Moseek is a calm, spatial workspace for bringing notes, links, files, and ideas together in Environments. Arrange work on an open canvas, keep personal spaces private, and collaborate in Shared Environments.

The interface follows Moseek's design principle: **Moseek is the frame. Your work is the color.** It keeps the visual language restrained so the work stays in focus. See [MOSEEK_DESIGN.md](MOSEEK_DESIGN.md) for the product and design guidelines.

## Built with

- React and Vite
- Supabase Auth, Postgres, Row Level Security, and private Storage
- React Flow (`@xyflow/react`) for the spatial canvas
- Lucide icons

## Local development

Requirements: Node.js with npm, Docker, and the Supabase CLI.

1. Install dependencies:

   ```sh
   npm ci
   ```

2. Start the local Supabase stack and apply the checked-in migrations to that local project. Keep local database operations local; do not use linked or remote project flags for this setup.

3. Start Moseek:

   ```sh
   npm run dev
   ```

   `npm run dev` and `npm run dev:local` use the local-only browser workflow. It verifies the local project, database migrations, and API before launching Vite, and writes its generated local browser settings to an ignored environment file. It does not overwrite `.env.local`.

For an intentionally configured hosted development environment, use `npm run dev:hosted` with the appropriate `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` supplied through private local configuration. Never commit those files. Production values belong in the deployment provider's environment settings.

## Available scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local-only browser workflow. |
| `npm run dev:local` | Alias for the local-only browser workflow. |
| `npm run dev:hosted` | Start Vite in hosted mode using privately configured Supabase settings. |
| `npm run build` | Create the production frontend in `dist/`. |
| `npm run preview` | Preview the production build locally. |
| `npm run lint` | Run ESLint across the project. |
| `npm run test:local-guard` | Verify the local-only URL guard rejects non-local Supabase targets. |

Additional authenticated database and regression checks live under `scripts/`. Run those only against the explicitly identified local Supabase project described by the individual test script.

## Supabase and deployment

Database migrations are in `supabase/migrations/`. Review and apply them in order in the intended environment, and verify that environment's schema, RLS policies, Storage configuration, Auth redirects, and Realtime setup before enabling production features.

Vercel builds with `npm run build`, serves `dist/`, and uses the root `vercel.json` rewrite so SPA links can load directly. Configure the production Supabase URL and publishable key in Vercel's project environment settings. The browser must only receive a publishable/anon key; never expose a service-role key.

Set the production site URL and allowed Auth redirects in Supabase, and configure the Google OAuth provider with the production origin and Supabase callback URL. Keep provider secrets in Supabase's provider configuration, not in frontend variables or source control.
