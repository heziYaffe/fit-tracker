-- Daily Whoop pull. Run after the whoop Edge Function is deployed and
-- WHOOP_CRON_SECRET is set both as a function secret and in
-- public.app_private_settings (key = whoop_cron_secret).
-- Do not commit the secret.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.app_private_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

revoke all on table public.app_private_settings from public, anon, authenticated;
alter table public.app_private_settings enable row level security;

create or replace function public.invoke_whoop_daily_pull()
returns void
language plpgsql
security definer
set search_path = public, net
as $$
declare
  secret text;
  url text := 'https://wnqlaajfqimkaibcnsti.supabase.co/functions/v1/whoop/cron';
begin
  select value into secret
  from public.app_private_settings
  where key = 'whoop_cron_secret';
  if secret is null or length(secret) = 0 then
    raise notice 'whoop_cron_secret is not set; skip';
    return;
  end if;
  perform net.http_post(
    url := url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    body := '{}'::jsonb,
    -- pg_net's default 5 s timeout logged every run as a failure even though
    -- the pull finishes; give it room and keep the real status code.
    timeout_milliseconds := 90000
  );
end;
$$;

revoke all on function public.invoke_whoop_daily_pull() from public, anon, authenticated;

-- Israel (Asia/Jerusalem) is UTC+2 in winter: 07:10 first pull, then two
-- retries (08:40, 10:40) because Whoop may not have scored the night yet.
select cron.unschedule(jobid)
from cron.job
where jobname in ('whoop-daily-pull', 'whoop-daily-pull-retry-1', 'whoop-daily-pull-retry-2');

select cron.schedule('whoop-daily-pull', '10 5 * * *', $$select public.invoke_whoop_daily_pull()$$);
select cron.schedule('whoop-daily-pull-retry-1', '40 6 * * *', $$select public.invoke_whoop_daily_pull()$$);
select cron.schedule('whoop-daily-pull-retry-2', '40 8 * * *', $$select public.invoke_whoop_daily_pull()$$);
