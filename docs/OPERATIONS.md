# Running Trazerr

## Files

| Path | What it is |
|---|---|
| `index.html` | The page. Styles are in `assets/site.css`, code in `assets/app.js`. |
| `api/app.js` | The one server function. Every feature is an `?action=`. |
| `stats.html` | Private usage page (needs the stats key). |
| `privacy.html`, `terms.html` | Legal pages. |
| `supabase/setup.sql` | The accounts table and its access rules (already run). |
| `supabase/job_alerts.sql` | The job alerts table and its access rules. |
| `tests/` | Automatic tests. Not deployed. |
| `vercel.json` | Server time limit and the daily keepalive. |

## Automatic tests

Every push and pull request runs the tests on GitHub (`.github/workflows/tests.yml`). The result shows as a ✓ or ✕ next to the commit on GitHub. When a test fails, the report is attached to the run as `test-report`.

To run them on a computer:

```
cd tests
npm install
npx playwright install chromium   # first time only
npm test
```

- `tests/api.test.mjs`: the server function, with fake Supabase, Redis, Resend and Anthropic.
- `tests/e2e/site.spec.js`: every page in light and dark at 320–1280px: no errors, no sideways scrolling, no serious accessibility problems (axe-core), phone header, theme switch, error reporting.
- `tests/e2e/tools.spec.js`: building a Career DNA, error messages, job search and fit checks.
- `tests/e2e/accounts.spec.js`: sign in by email link, save, download, delete everything, expired links. Uses the real sign-in library against a fake Supabase.
- `tests/e2e/stats.spec.js`: the usage page.

No test calls the real AI, job search, database or email.

## Usage page and error alerts

`https://trazerr.com/stats.html` shows visits, Career DNAs built, fit checks, tailored resumes, account saves, the funnel, recent feedback, recent errors and service health. It needs the `STATS_KEY` value.

Errors are collected two ways:

- **Server:** any request that fails on Trazerr's side (AI busy or down, daily AI limit reached, database or storage failure, unexpected crash) is logged. Mistakes by visitors (a too-short resume, a wrong email) are not.
- **Browser:** errors in the page's own code are reported by the page, at most 5 per visit. Errors from browser extensions are ignored.

The newest 200 are kept in Upstash Redis (`trazerr:errors`). Email addresses are removed and messages are cut to 300 characters.

When `RESEND_API_KEY` and `ALERT_EMAIL` are set, a server failure sends an email, at most one an hour. The email lists what failed and links to the usage page.

## Job alerts

After a job search, people can choose "Email me new jobs". Signing in is required (the same emailed link), so every address is confirmed. Each person can have up to 3 alerts, stored in the Supabase table `job_alerts` (`supabase/job_alerts.sql`), protected by row level security.

Every day at 13:07 UTC (9:07 am New York time), Vercel runs `/api/app?action=sendalerts`. Alerts not checked for 6½ days are searched for jobs posted in the past 8 days. Jobs already sent are skipped, and each person gets at most one email, with up to 6 jobs per alert. The email comes from `jobs@trazerr.com` through Resend. It links back to the search on Trazerr and has a signed "Stop all job alerts" link, plus one-click unsubscribe for mail apps.

Limits to know: Resend's free plan sends 100 emails a day, and each run handles up to 40 alerts; any left over go out the next day. The usage page shows alerts turned on, emails sent and how many people came back from them.

## Keeping Supabase awake

Free Supabase projects pause after 7 days without use. Vercel runs `/api/app?action=keepalive` every day at 09:17 UTC. It reads one row from the accounts table, which counts as use, and saves the time. The usage page shows when it last ran; if it fails, it's logged as an error and sends an alert. When `CRON_SECRET` is set in Vercel, only Vercel can run it.

## Security rules

`vercel.json` sends security headers with every page:

- **Content-Security-Policy:** the browser only runs scripts from the site itself, plus two fingerprinted libraries from jsDelivr (sign-in) and cdnjs (Word reader), and only connects to the site and Trazerr's Supabase project.
- **HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP:** HTTPS only, no embedding in other sites, no camera, microphone or location access.

If you change an inline `<script>` in an HTML page, its fingerprint changes. The tests fail and print the new value; add it to `script-src` in `vercel.json` (or run `node tests/inline-hashes.mjs`). Anything the rules block on the live site is reported to the error log as "Blocked by security rules".

If the Supabase project ever changes, update its address in `connect-src`.

## Uptime monitoring

`https://www.trazerr.com/api/app?action=health` answers 200 when the site, AI key, storage and accounts are working, and 503 naming the failing part when not. An outside monitor (UptimeRobot, free) checks it every 5 minutes and emails you if the site is down, even if Vercel itself is down.

## Settings in Vercel

| Name | Needed for |
|---|---|
| `ANTHROPIC_API_KEY` | AI features |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | Local job search (otherwise remote jobs only) |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Usage counts, rate limits, feedback, waitlist, error log (added by the Upstash integration) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Accounts (added by the Supabase integration) |
| `STATS_KEY` | The usage page. A long random password. |
| `RESEND_API_KEY` | Error alert emails. A Resend key with "Sending access" only. |
| `ALERT_EMAIL` | Where alert emails go |
| `CRON_SECRET` | Optional. Limits the keepalive to Vercel. |
| `AI_DAILY_LIMIT` | Optional. Most AI requests per day (default 500). |
