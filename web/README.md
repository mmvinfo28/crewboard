# Crewboard web app

The hosted Crewboard dashboard, built with Next.js and Supabase.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Add the Supabase URL and publishable key. Connector development also needs the server-only values listed in `.env.example`.
3. Run `npm install` and `npm run dev`.

## Connector backend

The hosted dashboard is the control plane. Claude Code and Codex run through a small connector on the user's own computer, so Crewboard never stores provider API keys. The connector can use the user's existing local Claude or Codex subscription/login; Crewboard itself only incurs Vercel and Supabase infrastructure usage.

The connector protocol uses:

- a ten-minute, one-time pairing challenge;
- a rotating device refresh token stored only on that computer;
- a five-minute connector JWT scoped to one party and one device;
- Realtime Broadcast as a content-free wake-up signal;
- an atomic database claim as the source of truth;
- task leases, heartbeat renewal, approval gates, and automatic requeue after disconnects.

To create the two connector-owned secrets without printing them, run:

```powershell
npm run connector:secrets
```

This writes gitignored files under `.crewboard-secrets` and refuses to overwrite an existing key. Then:

1. In Supabase, open **Authentication → JWT Signing Keys**, import `.crewboard-secrets/connector-private.jwk.json`, and rotate to it.
2. In Supabase **Project Settings → API Keys**, copy a server-side secret key. Never use it in a `NEXT_PUBLIC_` variable.
3. Add the following as sensitive Vercel variables for Production, Preview, and Development:
   - `SUPABASE_SECRET_KEY`: the Supabase server-side secret key.
   - `CREWBOARD_CONNECTOR_JWT_PRIVATE_JWK`: the one-line contents of `connector-private.jwk.json`.
   - `CREWBOARD_PAIRING_PEPPER`: the contents of `pairing-pepper.txt`.
4. Add `CREWBOARD_MIN_CONNECTOR_VERSION=0.1.0` and set `NEXT_PUBLIC_SITE_URL` once the production Crewboard domain is assigned.
5. Redeploy, then run the fake-connector contract check with `npm run connector:fake` while the app is running.

Rotating the JWT signing key requires a short overlap: add the new key to Supabase first, deploy the matching private key to Vercel, wait at least five minutes for old connector JWTs to expire, and only then remove the old key.

## Vercel

- Framework preset: Next.js
- Root Directory: `web`
- Build command: `npm run build`
- Production branch: the GitHub repository's default branch
- Environment variables are documented in `.env.example`; all variables without `NEXT_PUBLIC_` are server-only.

Use Vercel's native Git integration. A push to the production branch creates a production deployment; other branches and pull requests receive preview deployments. No Vercel token or custom GitHub Actions workflow is required.

Database changes live in `supabase/migrations` and should be applied to Supabase before deploying code that depends on them.

The live database also runs `crewboard-reap-task-leases` every minute through Supabase Cron. It expires timed-out approvals, requeues abandoned runs, and marks stale devices offline.
