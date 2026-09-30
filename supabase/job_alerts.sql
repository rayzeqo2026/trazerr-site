-- Job alerts: saved searches that email new jobs once a week.
-- Run once in Supabase: SQL Editor > New query > paste all of this > Run.

create table if not exists public.job_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  query text not null check (char_length(query) between 2 and 100),
  location text not null default '' check (char_length(location) <= 100),
  remote boolean not null default false,
  active boolean not null default true,
  seen text[] not null default '{}',
  last_sent timestamptz,
  created_at timestamptz not null default now()
);

-- The same search can't be saved twice by one person.
create unique index if not exists job_alerts_unique on public.job_alerts (user_id, lower(query), lower(location), remote);
create index if not exists job_alerts_due on public.job_alerts (active, last_sent);

alter table public.job_alerts enable row level security;

-- Each person sees and changes only their own alerts, and can have at most 3.
drop policy if exists "Own alerts: read" on public.job_alerts;
create policy "Own alerts: read" on public.job_alerts for select to authenticated using (user_id = auth.uid());
drop policy if exists "Own alerts: add" on public.job_alerts;
create policy "Own alerts: add" on public.job_alerts for insert to authenticated
  with check (user_id = auth.uid() and (select count(*) from public.job_alerts where user_id = auth.uid()) < 3);
drop policy if exists "Own alerts: change" on public.job_alerts;
create policy "Own alerts: change" on public.job_alerts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Own alerts: remove" on public.job_alerts;
create policy "Own alerts: remove" on public.job_alerts for delete to authenticated using (user_id = auth.uid());

revoke all on public.job_alerts from anon;
revoke all on public.job_alerts from authenticated;
grant select, delete on public.job_alerts to authenticated;
grant insert (user_id, query, location, remote) on public.job_alerts to authenticated;
grant update (active) on public.job_alerts to authenticated;
