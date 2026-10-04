-- Trazerr Match - Complete Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS & AUTHENTICATION
-- ============================================

-- Candidates (extend auth.users)
CREATE TABLE IF NOT EXISTS candidates (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  location TEXT,
  headline TEXT,
  about TEXT,
  avatar_url TEXT,
  current_role TEXT,
  years_experience INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Employers (extend auth.users)
CREATE TABLE IF NOT EXISTS employers (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  company_name TEXT NOT NULL,
  company_website TEXT,
  company_logo TEXT,
  industry TEXT,
  company_size TEXT,
  location TEXT,
  about TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- RESUMES & CAREER DNA
-- ============================================

-- Resumes (uploaded files)
CREATE TABLE IF NOT EXISTS resumes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_url TEXT,
  file_size INTEGER,
  mime_type TEXT,
  raw_text TEXT,
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Career DNA (AI-generated candidate profile)
CREATE TABLE IF NOT EXISTS career_dna (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  resume_id UUID REFERENCES resumes(id) ON DELETE SET NULL,
  headline TEXT,
  summary TEXT,
  verified_skills JSONB, -- {skill: "...", evidence: "...", years: N}
  inferred_skills JSONB, -- {skill: "...", basis: "..."}
  potential_skills JSONB, -- {skill: "...", note: "..."}
  experience JSONB, -- Array of {title, company, years, achievements}
  education JSONB, -- Array of {degree, school, field}
  certifications JSONB,
  languages JSONB,
  clarity_score INTEGER, -- 0-100
  strengths JSONB, -- Array of {point, evidence}
  gaps JSONB, -- Array of {gap, why}
  career_paths JSONB,
  ai_analysis TEXT,
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- JOBS & JOB DNA
-- ============================================

-- Job Postings
CREATE TABLE IF NOT EXISTS job_postings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employer_id UUID NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  company TEXT,
  description TEXT NOT NULL,
  location TEXT,
  job_type TEXT, -- 'Full-time', 'Part-time', 'Contract', 'Remote'
  salary_min INTEGER,
  salary_max INTEGER,
  salary_currency TEXT,
  requirements JSONB,
  nice_to_haves JSONB,
  benefits JSONB,
  posted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Job DNA (AI-generated job analysis)
CREATE TABLE IF NOT EXISTS job_dna (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  title TEXT,
  summary TEXT,
  level TEXT,
  must_haves JSONB, -- Array of requirements
  nice_to_haves JSONB,
  hidden_requirements JSONB, -- Array of {item, why}
  evidence_markers JSONB, -- What proves fit on a resume
  skills_required JSONB,
  experience_required TEXT,
  ai_analysis TEXT,
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- MATCH CODES & MATCHING
-- ============================================

-- Match Codes (invitation system)
CREATE TABLE IF NOT EXISTS match_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL, -- TZ-XXXX format (7 chars total)
  job_id UUID NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL, -- NULL until matched
  employer_id UUID NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  is_used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '30 days'
);

-- Match Scores (AI-generated fit analysis)
CREATE TABLE IF NOT EXISTS match_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_code_id UUID NOT NULL REFERENCES match_codes(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL,
  overall_score INTEGER, -- 0-100
  experience_score INTEGER, -- 0-10
  skills_score INTEGER, -- 0-10
  industry_score INTEGER, -- 0-10
  factors JSONB, -- {name, score, basis, note}
  strengths JSONB, -- Array of {point, evidence}
  gaps JSONB, -- Array of gaps
  unknowns JSONB, -- Array of unknowns
  interview_tips JSONB, -- Array of tips
  ai_analysis TEXT,
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- APPLICATIONS & TRACKING
-- ============================================

-- Applications (candidate applications to jobs)
CREATE TABLE IF NOT EXISTS applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  match_code_id UUID REFERENCES match_codes(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'submitted', -- 'submitted', 'reviewed', 'shortlisted', 'rejected', 'accepted'
  response_email TEXT,
  response_message TEXT,
  match_score INTEGER,
  match_summary TEXT,
  employer_notes TEXT,
  candidate_notes TEXT,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Application Interactions
CREATE TABLE IF NOT EXISTS application_interactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  interaction_type TEXT, -- 'view', 'comment', 'status_change', 'email_sent'
  actor_id UUID,
  actor_type TEXT, -- 'candidate', 'employer', 'system'
  message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- FEEDBACK & ANALYTICS
-- ============================================

-- User Feedback
CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT, -- 'match_feedback', 'general_feedback', 'bug_report'
  message TEXT,
  rating INTEGER, -- 1-5 stars
  tags JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Match Analytics
CREATE TABLE IF NOT EXISTS match_analytics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_code_id UUID REFERENCES match_codes(id) ON DELETE SET NULL,
  event_type TEXT, -- 'viewed', 'unlocked', 'responded', 'dismissed'
  user_id UUID,
  user_type TEXT, -- 'candidate', 'employer'
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX idx_candidates_email ON candidates(email);
CREATE INDEX idx_employers_email ON employers(email);
CREATE INDEX idx_resumes_candidate ON resumes(candidate_id);
CREATE INDEX idx_career_dna_candidate ON career_dna(candidate_id);
CREATE INDEX idx_job_postings_employer ON job_postings(employer_id);
CREATE INDEX idx_job_dna_job ON job_dna(job_id);
CREATE INDEX idx_match_codes_code ON match_codes(code);
CREATE INDEX idx_match_codes_job ON match_codes(job_id);
CREATE INDEX idx_match_codes_candidate ON match_codes(candidate_id);
CREATE INDEX idx_match_scores_match ON match_scores(match_code_id);
CREATE INDEX idx_applications_candidate ON applications(candidate_id);
CREATE INDEX idx_applications_job ON applications(job_id);
CREATE INDEX idx_applications_status ON applications(status);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- Candidates can only see their own data
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Candidates can view own data"
  ON candidates FOR SELECT
  USING (auth.uid() = id);

-- Employers can only see their own data
ALTER TABLE employers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employers can view own data"
  ON employers FOR SELECT
  USING (auth.uid() = id);

-- Resumes are private to candidates
ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Candidates can view own resumes"
  ON resumes FOR SELECT
  USING (candidate_id = auth.uid());

-- Career DNA is private to candidates
ALTER TABLE career_dna ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Candidates can view own career DNA"
  ON career_dna FOR SELECT
  USING (candidate_id = auth.uid());

-- Job postings are viewable by all, editable by employer
ALTER TABLE job_postings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Job postings are public"
  ON job_postings FOR SELECT
  USING (is_active = TRUE);
CREATE POLICY "Employers can edit own jobs"
  ON job_postings FOR UPDATE
  USING (employer_id = auth.uid());

-- Match codes are private
ALTER TABLE match_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Candidates can view their match codes"
  ON match_codes FOR SELECT
  USING (candidate_id = auth.uid() OR employer_id = auth.uid());

-- Applications privacy
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Candidates can view own applications"
  ON applications FOR SELECT
  USING (candidate_id = auth.uid());
CREATE POLICY "Employers can view applications to their jobs"
  ON applications FOR SELECT
  USING (job_id IN (SELECT id FROM job_postings WHERE employer_id = auth.uid()));
