-- Fit Tracker — Supabase schema (run in the SQL editor).
-- Do not put secrets in this file.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
drop policy if exists "profiles_own" on public.profiles;
create policy "profiles_own" on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Per-record sync. collection is workouts, nutrition, weights, metrics,
-- foods, templates, menus, dayMenus, measures, settings.
create table if not exists public.fit_records (
  user_id uuid not null references auth.users (id) on delete cascade,
  collection text not null,
  record_id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, collection, record_id)
);

create index if not exists fit_records_user_updated
  on public.fit_records (user_id, updated_at desc);

alter table public.fit_records enable row level security;
drop policy if exists "fit_records_own" on public.fit_records;
create policy "fit_records_own" on public.fit_records
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Whoop tokens: never expose to the browser. The Edge Function uses
-- the service role key to read/write this table.
create table if not exists public.whoop_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  whoop_user_id text,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  updated_at timestamptz not null default now()
);

alter table public.whoop_tokens enable row level security;
-- No policies for authenticated users: only service_role can access.

-- Safe, client-readable connection status (no tokens).
create table if not exists public.whoop_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  whoop_user_id text,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_error text
);

alter table public.whoop_links enable row level security;
drop policy if exists "whoop_links_own" on public.whoop_links;
create policy "whoop_links_own" on public.whoop_links
  for select using (auth.uid() = user_id);

-- Deduplicate webhook deliveries.
create table if not exists public.whoop_webhook_events (
  trace_id text primary key,
  whoop_user_id text,
  event_type text,
  received_at timestamptz not null default now()
);

alter table public.whoop_webhook_events enable row level security;
-- service_role only

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
