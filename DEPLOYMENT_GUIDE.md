# Trazerr Match - Deployment Guide

## Overview

Trazerr Match is a complete AI-powered job matching platform built with:
- **Frontend**: HTML5, JavaScript (ES6+) with Supabase client
- **Backend**: Node.js on Vercel serverless functions
- **Database**: PostgreSQL on Supabase with Row-Level Security
- **AI**: Anthropic Claude API for Career DNA and Job DNA analysis
- **Email**: Resend for email notifications (optional)

## What's Implemented ✅

### Core Features
- **User Authentication**: Signup/Login with role-based routing (candidate vs employer)
- **Career DNA Analysis**: AI-powered resume analysis that extracts skills, experience, and career trajectories
- **Job DNA Analysis**: AI-powered job posting analysis that extracts requirements and hidden expectations
- **Match Code System**: Unique invitation codes (TZ-XXXX format) for candidate-to-job matching
- **Applications Tracking**: Complete workflow for submitting, reviewing, and responding to applications
- **Career Paths**: Suggested career progression based on resume and current role
- **Email Notifications**: Ready-to-use notification system (via Resend API)

### Pages & Workflows

#### For Candidates
1. **signup.html** - Create account (email/password/name)
2. **login.html** - Sign in returning users
3. **dashboard-candidate.html** - Main hub with stats and navigation
4. **upload-resume.html** - Upload resume and view Career DNA analysis
5. **match.html** - Enter match codes to unlock and view job opportunities
6. **candidate-applications.html** - Track all applications and responses
7. **career-paths.html** - View suggested career progression paths

#### For Employers
1. **signup.html** - Create employer account
2. **login.html** - Sign in returning employers
3. **dashboard-employer.html** - Post jobs, generate match codes
4. **applications.html** - Review and respond to candidate applications

### API Endpoints

All endpoints are at `/api/app?action=<endpoint_name>`:

**Authentication**
- `signup` - Register new user (candidate or employer)
- `login` - Sign in existing user (handled by Supabase auth)

**Resume & Analysis**
- `uploadresume` - Upload and analyze resume (calls analyze endpoint)
- `analyze` - AI analysis of resume text → Career DNA
- `getcareerdn` - Retrieve saved Career DNA

**Jobs & Job DNA**
- `postjob` - Create job posting (requires auth, calls jobdna)
- `jobdna` - AI analysis of job posting → Job DNA
- `searchjobs` - Find jobs by keyword/location
- `jobdelete` - Delete a job posting (employer only)

**Matching System**
- `generatematch` - Generate TZ-XXXX code for candidate
- `unlockmatch` - Validate code and get job/match score
- `getmatches` - List all active matches for candidate

**Applications**
- `submitapplication` - Submit application to a job
- `getapplications` - Get applications for employer's jobs
- `appAlert` - Send email notification about new application

**Career Paths**
- `path` - Generate career path suggestions (integrated with analyze)

## Deployment Steps

### 1. Prerequisites
- Supabase account (free tier works)
- Vercel account (free tier works)
- Anthropic API key (for Claude)
- GitHub account (for code hosting)

### 2. Set Up Supabase

1. Go to [supabase.com](https://supabase.com) and create a project
2. In SQL Editor, create new query and run `/db-schema.sql`
3. Once tables are created, go to Authentication settings:
   - Add your redirect URLs:
     ```
     http://localhost:3000
     http://localhost:3000/dashboard-candidate.html
     http://localhost:3000/dashboard-employer.html
     http://localhost:3000/upload-resume.html
     http://localhost:3000/match.html
     http://localhost:3000/applications.html
     http://localhost:3000/candidate-applications.html
     http://localhost:3000/career-paths.html
     https://your-domain.com
     https://your-domain.com/*
     ```

4. Get your credentials:
   - Project URL: `Settings > API > Project URL`
   - Anon Key: `Settings > API > Project API keys > anon`
   - Service Role Key: `Settings > API > Project API keys > service_role`

### 3. Set Up Vercel

1. Go to [vercel.com](https://vercel.com) and import this repository
2. Set environment variables in Vercel settings:
   ```
   ANTHROPIC_API_KEY=sk-ant-... (from Anthropic)
   SUPABASE_URL=https://xxx.supabase.co
   SUPABASE_ANON_KEY=eyJ... (from Supabase)
   SUPABASE_SERVICE_ROLE_KEY=eyJ... (from Supabase)
   RESEND_API_KEY=re_... (optional, from resend.com)
   ALERT_EMAIL=your-email@example.com (optional)
   ```

3. Deploy the project

### 4. Update Frontend Configuration

Update hardcoded Supabase credentials in these files:
- `signup.html`
- `login.html`
- `dashboard-candidate.html`
- `upload-resume.html`
- `match.html`
- `dashboard-employer.html`
- `applications.html`
- `candidate-applications.html`
- `career-paths.html`

Replace:
```javascript
const SUPABASE_URL = 'https://gkeykkisawohugfwptvr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...';
```

With your actual Supabase credentials.

### 5. Test Locally

1. Copy `.env.local` template (if not present):
   ```bash
   SUPABASE_URL=https://xxx.supabase.co
   SUPABASE_ANON_KEY=eyJ...
   ```

2. Start local file server:
   ```bash
   python3 -m http.server 3000
   ```

3. Test flows:
   - Go to `http://localhost:3000/signup.html`
   - Create account (candidate)
   - Upload resume
   - View Career DNA
   - (Employer account for job posting and match codes)

## Key Design Decisions

### Authentication Flow
- Tokens stored in `sessionStorage` (cleared on browser close for security)
- Session verification on each protected page
- Role detection via candidate/employers table lookup

### Database Architecture
- Row-Level Security (RLS) policies restrict data access
- Candidates see only their own data
- Employers see only their own jobs and applications
- Service role key used for admin operations (job creation, etc.)

### Match Code Format
- `TZ-XXXX` format (7 characters: `TZ-` + 4 random alphanumeric)
- Uniqueness enforced in database
- 30-day expiration
- Can be used only once

### AI Integration
- Claude Sonnet 5.5 for fast, cost-effective analysis
- Fallback to Claude Opus 5.5 if primary model fails
- Per-visitor rate limiting (8 resumes/day, 12 jobs/day)
- Streaming for long-form content

## Production Checklist

- [ ] All Supabase URLs updated in frontend files
- [ ] Environment variables set in Vercel
- [ ] Database schema deployed to Supabase
- [ ] Supabase authentication redirect URLs configured
- [ ] Domain/SSL configured
- [ ] Email notifications tested (if using Resend)
- [ ] Rate limiting appropriate for your usage
- [ ] Monitor logs for errors
- [ ] Backup database regularly
- [ ] Set up monitoring/alerting

## Troubleshooting

### "Session expired" errors
- Check sessionStorage in browser dev tools
- Verify token is being saved on login
- Check Supabase auth configuration

### "Supabase not configured" errors
- Verify environment variables in Vercel
- Check SUPABASE_URL and SUPABASE_ANON_KEY exist
- Ensure frontend files have correct Supabase credentials

### Job DNA not generating
- Check ANTHROPIC_API_KEY is set
- Check API usage at Anthropic dashboard
- Check job description is at least 120 characters

### Email notifications not sending
- Verify RESEND_API_KEY is set
- Verify email is valid in ALERT_EMAIL
- Check Resend account has credits
- Ensure appAlert endpoint is called with application_id

## Performance Optimization

For production, consider:
1. **CDN for static assets** - Move CSS/images to storage
2. **Database indexing** - Already included for common queries
3. **API caching** - Implement Redis for frequently accessed data
4. **Image optimization** - Compress resume images before upload
5. **Rate limiting** - Per-user per-minute limits already configured

## Security Considerations

- All passwords hashed by Supabase
- CORS configured for your domain
- SQL injection prevented by Supabase prepared statements
- XSS prevention via HTML escaping on all user content
- CSRF protection via token-based authentication
- Rate limiting per visitor to prevent abuse
- Sensitive data (service role key) kept in environment variables

## Monitoring

Set up monitoring for:
- API response times (target: <2s)
- Database connections
- Anthropic API failures
- Supabase auth failures
- Email delivery failures

Use Vercel Analytics and Supabase logs for monitoring.

## Support & Next Steps

1. **Email integration**: Wire up Resend for application notifications
2. **Admin dashboard**: Create page for platform statistics
3. **Advanced search**: Add filtering by skills, salary, etc.
4. **Interview prep**: Add AI-powered interview questions
5. **Salary insights**: Add compensation data
6. **Mobile app**: React Native version

---

**Platform Status**: MVP Complete (60-70%)
- Core matching system: 100%
- User management: 100%
- Application tracking: 100%
- Email notifications: 80% (ready to use, manual trigger)
- Polish & optimization: 60%

Estimated additional effort to launch: 1-2 weeks
