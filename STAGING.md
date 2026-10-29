# Staging Supabase — RLS verification setup

This document describes how to verify NaniAI's Row Level Security (RLS) with
**real authenticated requests** on a **dedicated staging project** — never
against production.

## Why staging

The app's data isolation is enforced by Postgres RLS (see
`supabase/migrations/0001_init.sql` and `0002_meal_prep.sql`):

- `public.profiles` — `id uuid primary key references auth.users(id) on delete cascade`
  with policies `auth.uid() = id` for select / insert / update / delete.
- `public.meal_prep` — `user_id ... references auth.users(id) on delete cascade`
  with policies `auth.uid() = user_id` for select / insert / update / delete.

Reading the SQL proves the policies are *written* correctly; it does **not**
prove the deployed project *enforces* them at runtime. `scripts/verify-rls-staging.mjs`
closes that gap by signing in as two real accounts and asserting cross-user
reads/writes/deletes fail.

## Minimum staging setup

1. Create a **new, separate** Supabase project (free tier is fine) — do NOT reuse
   the production project.
2. Run the existing migrations against it, in order:
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_meal_prep.sql`
   - `supabase/migrations/0003_profile_feedback.sql`
   - `supabase/migrations/0004_user_api_keys.sql`
   (e.g. paste into the Supabase SQL editor, or `psql "$STAGING_POSTGRES_URL" -f <file>`.)
3. In **Authentication → Providers → Email**, disable "Confirm email" (or leave on;
   the script uses the admin API with `email_confirm: true`, so either works).
4. Collect the staging keys from **Project Settings → API**.

## Configure `.env.staging` (gitignored — never commit)

Copy `.env.staging.example` → `.env.staging` and fill in your staging keys:

```
STAGING_SUPABASE_URL=https://<staging-ref>.supabase.co
STAGING_SUPABASE_ANON_KEY=<staging anon key>
STAGING_SUPABASE_SERVICE_ROLE_KEY=<staging service role key>
```

## Run (locally)

```
npm run test:rls
```

(equivalently: `node --env-file=.env.staging scripts/verify-rls-staging.mjs`)

The script exercises BOTH RLS-protected tables (`profiles`, `meal_prep`) and:

1. Both accounts authenticate independently.
2. Account A reads its own `profiles` + `meal_prep` rows.
3. Account B reads its own rows.
4. A cannot read B's rows (both tables); a blanket select returns only A's rows.
5. A cannot update or delete B's rows — and B's rows are confirmed unchanged
   afterwards (owner-verified), proving these were real denials.
6. A cannot INSERT a row referencing B (`WITH CHECK`) in either table.
7. Unauthenticated reads return nothing and unauthenticated writes are rejected.
8. Every check above runs against each relevant table + operation.
9. An RLS denial (`{ data: [], error: null }` / 0 rows affected) is distinguished
   from a network / setup error (non-null error), so a broken test can't look
   like a pass.

Access-control checks use the normal authenticated anon client + user JWTs. The
service-role client is used ONLY to create and delete the two disposable test
accounts (admin setup/teardown) — never to test user-level RLS.

After a successful run it deletes both accounts (cascade removes their rows);
cleanup failures are printed explicitly.

## Run in CI

`.github/workflows/staging-rls.yml` runs this verification **on demand**
(`workflow_dispatch`). The weekly `schedule:` trigger is **disabled** (commented
out) until a staging project + secrets exist and the first manual run succeeds —
otherwise it would fail every week on missing secrets. Re-enable it by
uncommenting the `schedule:` block in that workflow after the first green run.

It is kept **separate** from the mocked account-isolation E2E in `ci.yml` so the
main pipeline never reports the full security suite as green while silently
skipping live RLS.

Add these repository (or environment) secrets under
**Settings → Secrets and variables → Actions**:

- `STAGING_SUPABASE_URL`
- `STAGING_SUPABASE_ANON_KEY`
- `STAGING_SUPABASE_SERVICE_ROLE_KEY`

If any are missing, the workflow's preflight step **fails clearly** rather than
skipping.

## Safety

- The script **refuses to run** if `STAGING_SUPABASE_URL` equals
  `NEXT_PUBLIC_SUPABASE_URL` (production guard).
- It requires the `STAGING_*` variables, so it can never pick up production keys
  from `.env.local`.
- It only touches the two throwaway accounts it creates.

## Status

As of this change, the RLS runtime test has **not** been executed because no
staging project/credentials are available in this environment. The script,
`test:rls` command, CI workflow, and this setup are ready; running it requires
creating the staging project above and providing its keys.
