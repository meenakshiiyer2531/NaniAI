-- NaniAI migration 0002 — per-user meal-prep checklist (DB-persisted).
-- Replaces device-localStorage "mark prepared" with durable, user-isolated state.
-- Run in the Supabase SQL editor or:
--   node --env-file=.env.local scripts/run-migration.mjs supabase/migrations/0002_meal_prep.sql

create table if not exists public.meal_prep (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  day        date        not null,
  slot       text        not null check (slot in ('breakfast','lunch','snack','dinner')),
  dish_id    text,
  prepared   boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, day, slot)
);

alter table public.meal_prep enable row level security;

drop policy if exists "own prep read"   on public.meal_prep;
drop policy if exists "own prep write"  on public.meal_prep;
drop policy if exists "own prep update" on public.meal_prep;
drop policy if exists "own prep delete" on public.meal_prep;

create policy "own prep read"   on public.meal_prep for select using (auth.uid() = user_id);
create policy "own prep write"  on public.meal_prep for insert with check (auth.uid() = user_id);
create policy "own prep update" on public.meal_prep for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own prep delete" on public.meal_prep for delete using (auth.uid() = user_id);
