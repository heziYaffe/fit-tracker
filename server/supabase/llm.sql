-- LLM gateway usage log (one row per Gemini attempt that reached the API,
-- plus refused calls). Written only by the `llm` Edge Function (service role).
create table if not exists public.llm_usage (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  task text not null,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  ok boolean not null default false,
  error text
);
create index if not exists llm_usage_user_time on public.llm_usage (user_id, created_at desc);
alter table public.llm_usage enable row level security;
drop policy if exists "llm_usage read own" on public.llm_usage;
create policy "llm_usage read own" on public.llm_usage for select using (auth.uid() = user_id);
