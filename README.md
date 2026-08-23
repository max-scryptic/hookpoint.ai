# Viewlio

A minimal Next.js application scaffolded for Vercel deployment and Supabase SSR auth/client wiring.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Fill `.env.local` with values from your Supabase project settings:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

## Connect Vercel

1. Push this repository to GitHub.
2. In Vercel, import the `hookpoint.ai` GitHub repository (unchanged; the repo has not been renamed).
3. Keep the detected framework preset as `Next.js`.
4. Add the Supabase environment variables to Vercel for Production, Preview, and Development.
5. Deploy.

## Connect Supabase

Create or open a Supabase project, then copy these values from Project Settings:

- `NEXT_PUBLIC_SUPABASE_URL`: Project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Publishable key

This starter uses `@supabase/ssr` in:

- `lib/supabase/client.ts` for browser components
- `lib/supabase/server.ts` for Server Components and server code
- `proxy.ts` for auth cookie refresh

## Database migrations

Migrations live in `supabase/migrations` and are applied by hand — through the
dashboard's SQL editor, `supabase db push`, or the Supabase MCP — separately
from the deploy. Merging a pull request ships its code to production straight
away, so a migration that is committed but not yet applied leaves the live app
asking for schema the database does not have. That usually fails quietly: the
reads that touch new schema are best-effort, so the feature simply never
appears.

`npm run check:migrations` compares the committed migrations against the
database's ledger and names any that have not been applied. The `Migrations`
workflow runs it after every push to `main` and again each morning, so drift
turns into a failed run rather than a mystery. It needs one repository secret:

- `SUPABASE_DB_URL`: the **session pooler** connection string from Supabase →
  Project Settings → Database. The direct host is IPv6-only, which GitHub's
  runners cannot reach.

Migrations are matched by name — the filename without its leading timestamp —
because a migration applied through the dashboard or the MCP is recorded under
the timestamp of the moment it ran rather than the one in its filename. So
don't rename a migration once it has been applied.
