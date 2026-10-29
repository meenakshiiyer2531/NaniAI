-- NaniAI migration 0003 — move meal feedback off device localStorage into the
-- user's profile (so NO user data lives in the browser; only the auth session
-- token is cached client-side, which is unavoidable for staying logged in).

alter table public.profiles
  add column if not exists feedback jsonb not null default '{}'::jsonb;
