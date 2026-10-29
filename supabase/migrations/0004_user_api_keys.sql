-- NaniAI migration 0004 — per-user BYOK API keys (encrypted at rest).
-- Stores a user's own provider API key as AES-256-GCM ciphertext. The
-- encryption master key lives ONLY in the server env (BYOK_ENCRYPTION_KEY),
-- never in this table, so a database leak alone cannot reveal any key.
-- Dedicated table (NOT a profiles JSON field), owner-only RLS.
--   node --env-file=.env.local scripts/run-migration.mjs supabase/migrations/0004_user_api_keys.sql

create table if not exists public.user_api_keys (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  provider   text        not null default 'nvidia',
  ciphertext text        not null,
  iv         text        not null,
  auth_tag   text        not null,
  last4      text,
  updated_at timestamptz not null default now()
);

alter table public.user_api_keys enable row level security;

-- Users may only see/modify their OWN key row. The ciphertext is additionally
-- useless without the server-only encryption key, so this is defense in depth.
drop policy if exists "own api key read"   on public.user_api_keys;
drop policy if exists "own api key insert" on public.user_api_keys;
drop policy if exists "own api key update" on public.user_api_keys;
drop policy if exists "own api key delete" on public.user_api_keys;
create policy "own api key read"   on public.user_api_keys for select using (auth.uid() = user_id);
create policy "own api key insert" on public.user_api_keys for insert with check (auth.uid() = user_id);
create policy "own api key update" on public.user_api_keys for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own api key delete" on public.user_api_keys for delete using (auth.uid() = user_id);
