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
   (e.g. paste into the Supabase SQL editor, or `psql "$STAGING_POSTGRES_URL" -f <file>`.)
3. In **Authentication → Providers → Email**, disable "Confirm email" (or leave on;
   the script uses the admin API with `email_confirm: true`, so either works).
4. Collect the staging keys from **Project Settings → API**.

## Configure `.env.staging` (gitignored — never commit)

```
STAGING_SUPABASE_URL=https://<staging-ref>.supabase.co
STAGING_SUPABASE_ANON_KEY=<staging anon key>
STAGING_SUPABASE_SERVICE_ROLE_KEY=<staging service role key>
```

## Run

```
node --env-file=.env.staging scripts/verify-rls-staging.mjs
```

The script:

1. Creates two disposable accounts (`rls-a-*@staging.test`, `rls-b-*@staging.test`).
2. Signs in independently as A and B (real GoTrue sessions).
3. Creates synthetic, non-sensitive `profiles` + `meal_prep` rows for each.
4. Asserts each account can read its own rows.
5. Asserts A cannot select / update / delete B's rows, and that B's data is
   unchanged after A's attempts.
6. Asserts unauthenticated reads return nothing and unauthenticated writes are
   rejected.
7. Deletes both accounts (cascade removes their rows) — clean teardown.

## Safety

- The script **refuses to run** if `STAGING_SUPABASE_URL` equals
  `NEXT_PUBLIC_SUPABASE_URL` (production guard).
- It requires the `STAGING_*` variables, so it can never pick up production keys
  from `.env.local`.
- It only touches the two throwaway accounts it creates.

## Status

As of this change, the RLS runtime test has **not** been executed because no
staging project/credentials are available in this environment. The script and
this setup are ready; running it requires creating the staging project above.
