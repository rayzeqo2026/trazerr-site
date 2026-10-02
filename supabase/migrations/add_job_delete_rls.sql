-- Enable RLS on job_postings if not already enabled
ALTER TABLE job_postings ENABLE ROW LEVEL SECURITY;

-- Create policy to allow employers to delete their own jobs
CREATE POLICY "Employers can delete their own jobs"
ON job_postings
FOR DELETE
USING (employer_id = auth.uid());

-- Also ensure employers can still select and update their jobs
CREATE POLICY "Employers can view their own jobs"
ON job_postings
FOR SELECT
USING (employer_id = auth.uid());

CREATE POLICY "Employers can update their own jobs"
ON job_postings
FOR UPDATE
USING (employer_id = auth.uid());

CREATE POLICY "Employers can insert jobs"
ON job_postings
FOR INSERT
WITH CHECK (employer_id = auth.uid());
