-- NaniAI migration 0005 — BYOK can now target NVIDIA or Nebius Token Factory.
-- Adds an optional model id (needed for the Nebius path, whose model ids differ
-- from NVIDIA's). provider already exists on the table (0004).
--   node --env-file=.env.local scripts/run-migration.mjs supabase/migrations/0005_user_api_key_model.sql

alter table public.user_api_keys
  add column if not exists model text;
