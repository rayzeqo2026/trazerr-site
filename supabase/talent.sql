-- Talent pool: candidates who choose to be found, approved employers, and contact requests.
-- Run once in Supabase: SQL Editor > New query > paste all of this > Run.

-- A candidate's anonymous profile. Employers only ever see "profile" and "public_id",
-- through the server, and only while "visible" is on.
create table if not exists public.talent_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  public_id uuid not null unique default gen_random_uuid(),
  visible boolean not null default true,
  profile jsonb not null check (pg_column_size(profile) < 20000),
  location text not null default '' check (char_length(location) <= 100),
  remote_ok boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.talent_profiles enable row level security;
drop policy if exists "Own talent profile: read" on public.talent_profiles;
create policy "Own talent profile: read" on public.talent_profiles for select to authenticated using (user_id = auth.uid());
drop policy if exists "Own talent profile: add" on public.talent_profiles;
create policy "Own talent profile: add" on public.talent_profiles for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Own talent profile: change" on public.talent_profiles;
create policy "Own talent profile: change" on public.talent_profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Own talent profile: remove" on public.talent_profiles;
create policy "Own talent profile: remove" on public.talent_profiles for delete to authenticated using (user_id = auth.uid());
revoke all on public.talent_profiles from anon;
revoke all on public.talent_profiles from authenticated;
grant select, delete on public.talent_profiles to authenticated;
grant insert (user_id, visible, profile, location, remote_ok, updated_at) on public.talent_profiles to authenticated;
grant update (visible, profile, location, remote_ok, updated_at) on public.talent_profiles to authenticated;

-- Employers. Only the server reads and writes this table; new employers start as "pending"
-- until the Trazerr admin approves them.
create table if not exists public.employers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  company text not null check (char_length(company) between 2 and 120),
  contact_name text not null check (char_length(contact_name) between 2 and 100),
  website text not null default '' check (char_length(website) <= 200),
  job_title text not null default '' check (char_length(job_title) <= 100),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
alter table public.employers enable row level security;
revoke all on public.employers from anon, authenticated;

-- Contact requests from an employer to a candidate. Only the server reads and writes this table.
create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers (user_id) on delete cascade,
  candidate_id uuid not null references auth.users (id) on delete cascade,
  job_title text not null check (char_length(job_title) between 2 and 120),
  message text not null default '' check (char_length(message) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (employer_id, candidate_id)
);
create index if not exists contact_requests_candidate on public.contact_requests (candidate_id);
alter table public.contact_requests enable row level security;
revoke all on public.contact_requests from anon, authenticated;
