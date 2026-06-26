# Hookpoint.ai

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
2. In Vercel, import the `hookpoint.ai` GitHub repository.
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
