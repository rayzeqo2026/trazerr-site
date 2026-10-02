-- Row-Level Security (RLS) for job_postings table
-- Run this in Supabase SQL Editor

-- Enable RLS on job_postings
alter table public.job_postings enable row level security;

-- Policy 1: Employers can insert their own job postings
create policy "Employers can insert own jobs" on public.job_postings
for insert to authenticated
with check (auth.uid() = employer_id);

-- Policy 2: Employers can view their own job postings
create policy "Employers can view own jobs" on public.job_postings
for select to authenticated
using (auth.uid() = employer_id);

-- Policy 3: Employers can update their own job postings
create policy "Employers can update own jobs" on public.job_postings
for update to authenticated
using (auth.uid() = employer_id)
with check (auth.uid() = employer_id);

-- Policy 4: Anyone (authenticated or not) can view public job postings
create policy "Anyone can view public jobs" on public.job_postings
for select using (status = 'open');

-- Enable RLS on applications table
alter table public.applications enable row level security;

-- Policy 5: Employers can view applications to their jobs
create policy "Employers can view job applications" on public.applications
for select to authenticated
using (exists (select 1 from job_postings where job_postings.id = job_id and job_postings.employer_id = auth.uid()));
