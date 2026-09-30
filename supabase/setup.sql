-- Trazerr accounts: one saved Career DNA and resume per person.
-- Paste this whole file into Supabase > SQL Editor and press Run. Safe to run again.

create table if not exists public.career_records (
  user_id    uuid primary key references auth.users(id) on delete cascade,  -- deleting an account deletes its record
  career_dna jsonb not null,
  resume     jsonb,                                                          -- { kind: "text", text } or { kind: "pdf", data } or null
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resume_size check (resume is null or pg_column_size(resume) < 6000000)
);

-- Row level security: each signed-in person can only see and change their own row.
alter table public.career_records enable row level security;

drop policy if exists "own record: read"   on public.career_records;
drop policy if exists "own record: add"    on public.career_records;
drop policy if exists "own record: change" on public.career_records;
drop policy if exists "own record: delete" on public.career_records;

create policy "own record: read"   on public.career_records for select to authenticated using (auth.uid() = user_id);
create policy "own record: add"    on public.career_records for insert to authenticated with check (auth.uid() = user_id);
create policy "own record: change" on public.career_records for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own record: delete" on public.career_records for delete to authenticated using (auth.uid() = user_id);

-- Visitors who aren't signed in can't touch the table at all.
revoke all on public.career_records from anon;
grant select, insert, update, delete on public.career_records to authenticated;
