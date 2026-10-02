-- Fix: Allow employers to read their own profile for the dashboard
-- Run this in Supabase SQL Editor to enable the dashboard

-- Add RLS policy: employers can read their own record
create policy "Employers read own record" on public.employers
for select to authenticated
using (auth.uid() = user_id);

-- Grant permission to authenticated users to select from employers
grant select on public.employers to authenticated;
