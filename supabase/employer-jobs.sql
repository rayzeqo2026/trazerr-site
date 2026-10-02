-- Employer job postings and candidate applications
-- Run once in Supabase: SQL Editor > New query > paste all of this > Run.

-- Job postings created by employers
create table if not exists public.job_postings (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers (user_id) on delete cascade,
  company_code text not null check (char_length(company_code) = 6), -- e.g., "WLMD22"
  title text not null check (char_length(title) between 3 and 120),
  description text not null check (char_length(description) between 10 and 5000),
  required_skills text[] not null default '{}', -- e.g., {"Node.js", "React", "TypeScript"}
  nice_to_have text[] not null default '{}',
  experience_level text not null check (experience_level in ('entry', 'mid', 'senior', 'lead')), -- e.g., "mid"
  salary_min integer,
  salary_max integer,
  location text not null default '', -- e.g., "New York, NY"
  remote_ok boolean not null default false,
  job_dna jsonb, -- structured requirements extracted by AI
  status text not null default 'open' check (status in ('open', 'closed', 'draft')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique(employer_id, company_code, title) -- one posting per employer per code+title combo
);
create index if not exists job_postings_employer on public.job_postings (employer_id);
create index if not exists job_postings_code on public.job_postings (company_code);
create index if not exists job_postings_status on public.job_postings (status);

-- Candidate applications to jobs
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.job_postings (id) on delete cascade,
  candidate_id uuid not null references public.career_records (user_id) on delete cascade,
  career_dna jsonb, -- snapshot of candidate's Career DNA at time of application
  match_score integer check (match_score between 0 and 100), -- e.g., 87
  match_summary text, -- e.g., "Strong match on Node.js and React; no AWS experience"
  gaps text[], -- missing skills
  status text not null default 'new' check (status in ('new', 'reviewed', 'rejected', 'interview', 'hired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id, candidate_id) -- one application per candidate per job
);
create index if not exists applications_job on public.applications (job_id);
create index if not exists applications_candidate on public.applications (candidate_id);
create index if not exists applications_status on public.applications (status);
create index if not exists applications_score on public.applications (match_score desc);

-- Email history (track what was sent to employers)
create table if not exists public.application_emails_sent (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  employer_id uuid not null references public.employers (user_id) on delete cascade,
  email_address text not null,
  subject text not null,
  sent_at timestamptz not null default now()
);
create index if not exists app_emails_employer on public.application_emails_sent (employer_id);
create index if not exists app_emails_sent on public.application_emails_sent (sent_at);
