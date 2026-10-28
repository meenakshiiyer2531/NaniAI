-- NaniAI — Supabase schema & Row Level Security (migration 0001)
-- Awaiting configuration: run this in the Supabase SQL editor (or `supabase db push`)
-- once a project exists. It creates the per-user profile store with strict RLS so
-- one user can NEVER read or write another user's data.
--
-- Identity comes from Supabase Auth (auth.users). The app derives the user id
-- from the verified server-side session — never from a browser-supplied id.

create extension if not exists "pgcrypto";

-- One row per authenticated user.
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  preferred_name    text,
  age               int check (age is null or (age >= 1 and age <= 120)),
  dietary_pattern   text,                          -- vegetarian | vegan | egg | non_veg | other
  spice_tolerance   text,                          -- mild | medium | hot
  texture_max       int  check (texture_max is null or (texture_max between 0 and 7)),
  cuisines          text[]      not null default '{}',   -- many-to-many preference
  region            text,
  loved_dishes      text[]      not null default '{}',   -- free text
  disliked          text[]      not null default '{}',
  allergies         text[]      not null default '{}',
  conditions        text[]      not null default '{}',
  medications       text[]      not null default '{}',
  lifestyle         jsonb       not null default '{}',    -- role, schedule, cooking, etc.
  goals             text[]      not null default '{}',
  emergency_name    text,
  emergency_phone   text,
  onboarding_done   boolean     not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- keep updated_at fresh
create or replace function public.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Row Level Security: users may only see/modify their own row.
alter table public.profiles enable row level security;

drop policy if exists "own profile read"   on public.profiles;
drop policy if exists "own profile insert" on public.profiles;
drop policy if exists "own profile update" on public.profiles;
drop policy if exists "own profile delete" on public.profiles;

create policy "own profile read"   on public.profiles for select using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "own profile delete" on public.profiles for delete using (auth.uid() = id);

-- Auto-create an empty profile row when a new auth user signs up.
create or replace function public.handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end; $$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
