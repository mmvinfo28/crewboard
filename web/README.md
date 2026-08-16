# Crewboard web app

The hosted Crewboard dashboard, built with Next.js and Supabase.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Add the Supabase URL and publishable key.
3. Run `npm install` and `npm run dev`.

## Vercel

- Framework preset: Next.js
- Root Directory: `web`
- Build command: `npm run build`
- Production branch: the GitHub repository's default branch
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and optionally `NEXT_PUBLIC_SITE_URL` for a custom production domain

Use Vercel's native Git integration. A push to the production branch creates a production deployment; other branches and pull requests receive preview deployments. No Vercel token or custom GitHub Actions workflow is required.

Database changes live in `supabase/migrations` and should be applied to Supabase before deploying code that depends on them.
