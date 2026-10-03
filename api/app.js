// Trazerr server: one Vercel function for every feature.
// Route: /api/app?action=analyze | jobs | match | jobdna | path | tailor | waitlist | ... (see ACTIONS at the end)
//
// Environment variables (Vercel > Project > Settings > Environment Variables):
//   ANTHROPIC_API_KEY   required: Career DNA, fit checks, Job DNA, career paths
//   ADZUNA_APP_ID       optional: local job search (free at developer.adzuna.com)
//   ADZUNA_APP_KEY      optional: local job search
//   ADZUNA_COUNTRY      optional: defaults to "us"
//   KV_REST_API_URL     waitlist storage, added automatically when you connect Upstash Redis in Vercel Storage
//   KV_REST_API_TOKEN   waitlist storage, added automatically with the line above
//   ANTHROPIC_FALLBACK_MODEL optional: backup model if the main one keeps failing (default claude-sonnet-5-5)
//   AI_DAILY_LIMIT      optional: most AI requests per day across all visitors (default 500; needs storage)
//   STATS_KEY           optional: a long random password for the usage page at /stats.html
//   RESEND_API_KEY      optional: sends an email alert when the server fails (at most one an hour)
//   ALERT_EMAIL         optional: where alerts go (comma-separate several addresses)
//   ALERT_FROM          optional: alert sender (default "Trazerr alerts <alerts@trazerr.com>")
//   CRON_SECRET         optional: set by Vercel for the daily keepalive; when set, only Vercel can run it

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const FALLBACK_MODEL = process.env.ANTHROPIC_FALLBACK_MODEL || "claude-opus-5-5";
const AI_DAILY_LIMIT = parseInt(process.env.AI_DAILY_LIMIT, 10) || 500;

/* ---------------- helpers ---------------- */

const str = (v, max = 400) => String(v ?? "").trim().slice(0, max);
const list = (v, max) => (Array.isArray(v) ? v : []).slice(0, max);

function toScore(v) {
  const n = typeof v === "number" ? v : parseFloat((String(v ?? "").match(/\d+(\.\d+)?/) || [""])[0]);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&rsquo;|&lsquo;/g, "'").replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

function extractJson(text) {
  const clean = String(text || "").replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(clean.slice(start, end + 1)); } catch { return null; }
}

function getBody(req) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  return body && typeof body === "object" ? body : null;
}

function getQuery(req) {
  if (req.query && typeof req.query === "object") return req.query;
  try { return Object.fromEntries(new URL(req.url, "http://localhost").searchParams); } catch { return {}; }
}

async function getSession(req) {
  const cfg = supabaseConfig();
  if (!cfg || !cfg.anon) return { data: null };

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return { data: null };

  try {
    const r = await fetch(cfg.url + "/auth/v1/user", {
      headers: { Authorization: "Bearer " + token, apikey: cfg.anon }
    });
    if (!r.ok) return { data: null };
    const user = await r.json();
    return { data: { session: { user, access_token: token } } };
  } catch (e) {
    return { data: null };
  }
}

// Per-visitor limits to protect the API budget. With storage connected they're shared by every server
// instance; otherwise they're kept in memory. Visitors are identified by a one-way hash of their IP
// address, and stored counters expire with the 10-minute window.
const WINDOW_SEC = 600;
const LIMITS = { analyze: 8, match: 20, jobdna: 12, path: 12, tailor: 16, jobs: 60, waitlist: 10, track: 200, stats: 30, feedback: 20, clienterror: 10, keepalive: 6, health: 30, sendalerts: 6, unsubscribe: 20, talentdraft: 6, employerjoin: 6, employerme: 60, searchtalent: 20, contactrequest: 30, myrequests: 60, respondrequest: 30, adminemployers: 60, jobpost: 10, jobdelete: 100, jobmatch: 30, appAlert: 20 };
const MEMORY_ONLY = new Set(["track", "jobs", "authconfig", "clienterror", "keepalive", "health", "sendalerts", "unsubscribe", "employerme", "myrequests", "adminemployers"]); // cheap requests; not worth a storage round trip
const hits = new Map();

function visitorId(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  return createHash("sha256").update("trazerr:" + (process.env.STATS_KEY || "") + ":" + ip).digest("hex").slice(0, 24);
}

function limitedInMemory(key, max) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < WINDOW_SEC * 1000);
  if (recent.length >= max) { hits.set(key, recent); return true; }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

async function limited(req, action) {
  const max = LIMITS[action] || 20, id = visitorId(req), cfg = redisConfig();
  if (cfg && !MEMORY_ONLY.has(action)) {
    const key = "trazerr:rl:" + action + ":" + id + ":" + Math.floor(Date.now() / (WINDOW_SEC * 1000));
    try {
      const out = await redisPipeline(cfg, [["INCR", key], ["EXPIRE", key, WINDOW_SEC]]);
      return Number(out[0]?.result) > max;
    } catch (e) { console.error("Rate limit storage error", e.message); }
  }
  return limitedInMemory(id + ":" + action, max);
}

// A cap on AI requests per day across all visitors, so a traffic spike can't run up the bill.
async function withinDailyBudget() {
  const cfg = redisConfig();
  if (!cfg) return true;
  const key = "trazerr:ai:" + new Date().toISOString().slice(0, 10);
  try {
    const out = await redisPipeline(cfg, [["INCR", key], ["EXPIRE", key, 172800]]);
    return Number(out[0]?.result) <= AI_DAILY_LIMIT;
  } catch (e) { console.error("Daily budget storage error", e.message); return true; }
}

// A problem to show the visitor. `detail` is the technical reason, kept for the error log only.
class UserError extends Error {
  constructor(status, message, detail) { super(message); this.status = status; this.detail = detail; }
}

// Current Claude models think before answering, and that thinking counts toward max_tokens.
// Keep effort low (these are straightforward extraction tasks) and leave plenty of room so the
// JSON answer is never cut off partway.
const MAX_TOKENS = 16000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// The model doesn't know today's date, and guesses an older year. Telling it keeps "Present",
// years of experience and recent start dates right.
function withToday(system) {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  return "Today's date is " + today + '. Treat "Present" or "Current" as today when working out how long someone has worked.\n\n' + system;
}

// Tries the main model, retries it once after a short pause, then tries the backup model.
// Retries stop after about 20 seconds so the whole request fits in the server's time limit.
async function askClaude(system, content) {
  if (!process.env.ANTHROPIC_API_KEY) throw new UserError(503, "This feature isn't switched on yet. Try again later.");
  if (!(await withinDailyBudget())) throw new UserError(503, "Trazerr has reached its limit for today. Please try again tomorrow.", "Daily AI limit of " + AI_DAILY_LIMIT + " requests reached");
  const plan = FALLBACK_MODEL && FALLBACK_MODEL !== MODEL ? [MODEL, MODEL, FALLBACK_MODEL] : [MODEL, MODEL];
  const started = Date.now();
  let lastErr = null;
  for (let i = 0; i < plan.length; i++) {
    if (i > 0) {
      if (Date.now() - started > 20000) break;
      if (plan[i] === plan[i - 1]) await sleep(1200);
    }
    const model = plan[i];
    let r;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: MAX_TOKENS, output_config: { effort: "low" }, system: withToday(system), messages: [{ role: "user", content }] })
      });
    } catch (e) {
      console.error("Anthropic network error", model, e.message);
      lastErr = new UserError(503, "Trazerr couldn't reach its AI service. Try again in a moment.", "Anthropic network error (" + model + "): " + e.message);
      continue;
    }
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("Anthropic API error", model, r.status, detail.slice(0, 500));
      const why = "Anthropic " + r.status + " (" + model + "): " + detail.slice(0, 160);
      if (r.status === 401 || r.status === 403) throw new UserError(503, "This feature isn't working right now. Please try again later.", why);
      lastErr = r.status === 429 || r.status === 529
        ? new UserError(503, "Trazerr is busy right now. Try again in a minute.", why)
        : new UserError(502, "The analysis didn't finish. Try again in a moment.", why);
      // A request the main model rejects outright won't pass on a retry, so go straight to the backup.
      if ((r.status === 400 || r.status === 404) && model === MODEL) i = Math.max(i, plan.length - 2);
      continue;
    }
    const data = await r.json();
    if (data.stop_reason === "refusal") throw new UserError(422, "This couldn't be analyzed. Try removing any unusual content and try again.");
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    const parsed = extractJson(text);
    if (parsed) {
      if (i > 0) console.error("Recovered on attempt", i + 1, "with", model);
      return parsed;
    }
    console.error("Unreadable model reply", model, data.stop_reason, JSON.stringify(data.usage || {}), text.slice(0, 200));
    lastErr = data.stop_reason === "max_tokens"
      ? new UserError(502, "The analysis ran too long and didn't finish. Try again, or paste a shorter version.", "Model reply hit max_tokens (" + model + ")")
      : new UserError(502, "The analysis came back in an unexpected format. Try again.", "Unreadable model reply (" + model + ")");
  }
  throw lastErr || new UserError(502, "The analysis didn't finish. Try again in a moment.");
}

const PLAIN = "Write in plain, warm, everyday language for someone who may not work in tech. No jargon, no buzzwords. Take the resume at its word and never suggest the person is untruthful: say what the resume shows or doesn't mention, never 'verified', 'unverified', 'unproven', 'no evidence', 'claims' or 'can't be verified'. Speak to the person as 'you' and 'your'; never refer to them as he, she, they, his, her or their, and never guess gender. Describe what they did as plain facts about them ('Reached an 85% case acceptance rate'), never as something a document says ('Resume states', 'States', 'Lists', 'Mentions'). Resume bullets you write for them stay in normal resume style, with no pronouns.";
const JSON_ONLY = "Return ONLY a JSON object, no markdown fences, no text before or after.";

/* ---------------- Career DNA ---------------- */

const ANALYZE_SYSTEM = `You are Trazerr's resume analyst. You read one resume and describe the person's Career DNA.

Core rule: evidence before inference. Never invent employers, titles, dates, numbers, degrees or skills.
- "verified" means stated directly in the resume. Its evidence is a short paraphrase of the resume line, written as a plain fact about them, e.g. "Trained four new hires in their first 90 days." For a skills or languages section, write it as "Skilled in Salesforce and HubSpot" or "Speaks English, Hausa and Twi", never "Lists…".
- "inferred" means a reasonable conclusion from the resume. Its evidence says what it is based on, starting "Based on".
- Directions are suggestions to explore, never claims.
- ${PLAIN}

Evidence score: 0-100, measuring how specific and provable the RESUME is, not how good the person is.
- Dates and tenure clearly stated: up to 20
- Quantified results (numbers, percentages, money, volumes): up to 25
- Scope (team size, territory, budget, customers, locations): up to 20
- Concrete skills, tools, licenses or certifications: up to 20
- Responsibilities described as outcomes rather than generic duties: up to 15
Add the parts up. A typical decent resume lands between 45 and 75.

${JSON_ONLY} Use exactly this shape:
{
  "fullName": "name as written on the resume, or empty string",
  "firstName": "first name, or empty string",
  "headline": "one sentence, max 32 words, describing who they are and what their record really shows",
  "experience": "short phrase, max 6 words, e.g. '8+ years customer-facing'. Work the years out from the dates in the resume up to today, not from a number the resume states",
  "stage": "short phrase, max 8 words, e.g. 'New to degree-level roles'",
  "location": "where the person lives now, as 'City, ST' in the US or 'City, Country' elsewhere, taken from the contact details (or the most recent job if there's no address); never a street address; empty string if unknown",
  "evidenceScore": 64,
  "scoreNote": "one sentence on the single change that would raise the score most",
  "strengths": [ { "name": "2-4 words", "level": "verified or inferred", "evidence": "one sentence" } ],
  "hiddenTalent": [ { "title": "short phrase", "why": "one or two sentences", "evidence": "one sentence from the resume" } ],
  "directions": [ { "role": "job title people actually search for", "why": "one sentence", "gap": "one sentence on what to build or show" } ],
  "unknowns": [ { "what": "2-5 words naming something relevant to their work or directions that the resume doesn't show clearly, e.g. 'Shipment volumes'", "how": "one sentence on the detail to add to show it: what they did, how much, which tools, or what changed", "example": "one sample resume bullet that would show it, using this person's real employers and duties, with a square-bracket placeholder for every number, name or detail the resume doesn't give, like [shipments per week]" } ]
}
Give 4-7 strengths, 1-3 hidden talents, 2-4 directions and 1-4 unknowns. evidenceScore must be a whole number.
Unknowns are things the resume doesn't show yet, never doubts about the person. Word them kindly. In each example, anything the resume doesn't state must be a [placeholder]; never write a made-up number, tool or result as if it were true.
If the document is not a resume or has no readable work history, return exactly {"error":"not_a_resume"}.`;

function cleanProfile(p) {
  return {
    fullName: str(p.fullName, 80),
    firstName: str(p.firstName, 40),
    headline: str(p.headline, 300),
    experience: str(p.experience, 60),
    stage: str(p.stage, 80),
    location: str(p.location, 80),
    evidenceScore: toScore(p.evidenceScore),
    scoreNote: str(p.scoreNote, 240),
    strengths: list(p.strengths, 7).map(s => ({
      name: str(s?.name, 60), level: s?.level === "inferred" ? "inferred" : "verified", evidence: str(s?.evidence, 240)
    })).filter(s => s.name),
    hiddenTalent: list(p.hiddenTalent, 3).map(t => ({
      title: str(t?.title, 100), why: str(t?.why, 300), evidence: str(t?.evidence, 240)
    })).filter(t => t.title),
    directions: list(p.directions, 4).map(d => ({
      role: str(d?.role, 80), why: str(d?.why, 240), gap: str(d?.gap, 240)
    })).filter(d => d.role),
    unknowns: list(p.unknowns, 4).map(u => typeof u === "string"
      ? { what: str(u, 120), how: "", example: "" }
      : { what: str(u?.what, 120), how: str(u?.how, 240), example: str(u?.example, 260) }).filter(u => u.what)
  };
}

async function analyze(req, res) {
  const body = getBody(req);
  if (!body || (body.kind !== "pdf" && body.kind !== "text")) throw new UserError(400, "Send a PDF or resume text.");
  let content;
  if (body.kind === "pdf") {
    if (typeof body.data !== "string" || body.data.length < 100 || body.data.length > 4_500_000) {
      throw new UserError(400, "That PDF couldn't be read. Try a smaller file or paste the text.");
    }
    content = [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: body.data } },
      { type: "text", text: "Analyze this resume and return the JSON object." }
    ];
  } else {
    const text = str(body.text, 30000);
    if (text.length < 80) throw new UserError(400, "Paste at least a few lines of your resume.");
    content = [{ type: "text", text: "Resume:\n\n" + text + "\n\nAnalyze this resume and return the JSON object." }];
  }
  const parsed = await askClaude(ANALYZE_SYSTEM, content);
  if (parsed.error === "not_a_resume") throw new UserError(422, "That doesn't look like a resume. Upload a resume with your work history.");
  const profile = cleanProfile(parsed);
  if (!profile.headline) throw new UserError(502, "The analysis came back incomplete. Try again.");
  return res.status(200).json({ profile });
}

/* ---------------- Job search ---------------- */

function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "";
  return v >= 1000 ? "$" + Math.round(v / 1000) + "k" : "$" + Math.round(v);
}

async function searchAdzuna(q, where, page, distanceKm, maxDays) {
  const country = (process.env.ADZUNA_COUNTRY || "us").toLowerCase();
  const params = new URLSearchParams({
    app_id: process.env.ADZUNA_APP_ID,
    app_key: process.env.ADZUNA_APP_KEY,
    results_per_page: "20",
    "content-type": "application/json"
  });
  if (q) params.set("what", q);
  if (where) params.set("where", where);
  if (where && distanceKm) params.set("distance", String(distanceKm));
  if (maxDays) { params.set("max_days_old", String(maxDays)); params.set("sort_by", "date"); }
  const r = await fetch(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?${params}`);
  if (!r.ok) {
    console.error("Adzuna error", r.status, (await r.text().catch(() => "")).slice(0, 300));
    throw new UserError(502, "Job search isn't responding right now. Try again in a moment.");
  }
  const data = await r.json();
  const jobs = list(data.results, 20).map(j => {
    const lo = money(j.salary_min), hi = money(j.salary_max);
    let salary = lo && hi && lo !== hi ? lo + " to " + hi : lo || hi;
    if (salary && String(j.salary_is_predicted) === "1") salary += " (estimated)";
    return {
      id: "az-" + j.id,
      title: str(stripHtml(j.title), 140),
      company: str(j.company?.display_name, 100),
      location: str(j.location?.display_name, 100),
      salary,
      posted: str(j.created, 40),
      url: str(j.redirect_url, 1000),
      description: str(stripHtml(j.description), 6000)
    };
  }).filter(j => j.title && j.url);
  return { jobs, total: Number(data.count) || jobs.length, source: "adzuna", hasMore: page * 20 < (Number(data.count) || 0) };
}

async function searchRemotive(q) {
  const params = new URLSearchParams({ limit: "40" });
  if (q) params.set("search", q);
  const r = await fetch(`https://remotive.com/api/remote-jobs?${params}`);
  if (!r.ok) {
    console.error("Remotive error", r.status);
    throw new UserError(502, "Job search isn't responding right now. Try again in a moment.");
  }
  const data = await r.json();
  const jobs = list(data.jobs, 40).map(j => ({
    id: "rm-" + j.id,
    title: str(j.title, 140),
    company: str(j.company_name, 100),
    location: "Remote" + (j.candidate_required_location ? " · " + str(j.candidate_required_location, 80) : ""),
    salary: str(j.salary, 60),
    posted: str(j.publication_date, 40),
    url: str(j.url, 1000),
    description: str(stripHtml(j.description), 6000)
  })).filter(j => j.title && j.url);
  return { jobs, total: jobs.length, source: "remotive", hasMore: false };
}

// Drops seniority words and anything in brackets or after a slash, so a very specific
// title can fall back to the role people actually post jobs under.
const SENIORITY = new Set(["assistant", "associate", "senior", "sr", "junior", "jr", "lead", "head", "chief", "entry", "level", "entrylevel", "trainee", "intern", "i", "ii", "iii", "iv"]);
function simplifyTitle(q) {
  const base = String(q || "").toLowerCase().replace(/\(.*?\)/g, " ").split("/")[0].replace(/[^a-z0-9& -]/g, " ");
  const words = base.split(/[\s-]+/).filter(Boolean);
  const core = words.filter(w => !SENIORITY.has(w));
  // Keep the full wording when dropping seniority would leave one vague word ("sales", "research").
  return (core.length >= 2 ? core : words).join(" ").trim();
}

async function jobs(req, res) {
  const q = getQuery(req);
  const query = str(q.q, 100);
  const where = str(q.where, 80);
  const remote = q.remote === "1" || q.remote === "true";
  const page = Math.max(1, Math.min(10, parseInt(q.page, 10) || 1));
  if (!query && !where) throw new UserError(400, "Enter a job title or keyword to search.");

  const hasAdzuna = !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);
  let result, fellBack = false;
  if (hasAdzuna && !remote) {
    // If Adzuna is down or over its daily limit, show remote jobs rather than an error.
    try {
      result = await searchAdzuna(query, where, page);
      // Nothing nearby? Widen to about 30 miles, then try a simpler title ("Assistant Front Office
      // Manager" -> "Front Office Manager"). The response says what was broadened so the page can explain.
      if (page === 1 && !result.jobs.length && where) {
        const wider = await searchAdzuna(query, where, 1, 50);
        if (wider.jobs.length) result = { ...wider, hasMore: false, broadened: "area" };
      }
      const simpler = simplifyTitle(query);
      if (page === 1 && !result.jobs.length && simpler && simpler !== query.toLowerCase()) {
        const broader = await searchAdzuna(simpler, where, 1, where ? 50 : undefined);
        if (broader.jobs.length) result = { ...broader, hasMore: false, broadened: "title", searchedFor: simpler };
      }
    }
    catch (e) { console.error("Adzuna unavailable, falling back to Remotive:", e.message); await recordError("server", "jobs", "Adzuna unavailable, used Remotive: " + e.message, false); result = await searchRemotive(query); fellBack = true; }
  } else result = await searchRemotive(query);
  result.localSearch = hasAdzuna;

  // Cache results briefly to save API calls, but never cache a fallback, so local results return quickly.
  res.setHeader("Cache-Control", fellBack ? "no-store" : "public, s-maxage=900, stale-while-revalidate=3600");
  return res.status(200).json(result);
}

/* ---------------- Fit check ---------------- */

const MATCH_SYSTEM = `You are Trazerr's fit analyst. You compare one person's Career DNA (JSON) with one job posting and explain the fit honestly.

Rules:
- Evidence before inference. Only use what the Career DNA shows. Never assume skills or experience it doesn't show.
- The job text may be a short or partial excerpt. Anything the posting doesn't say, and anything the profile neither proves nor disproves, belongs in "unknowns", not in gaps or strengths.
- Tips must be honest: help the person show real evidence they have. Never suggest adding anything untrue.
- ${PLAIN}

Scoring guide for fitScore and each factor (0-100): 80+ strong, 60-79 good, 40-59 partial, under 40 weak.

${JSON_ONLY} Use exactly this shape:
{
  "fitScore": 72,
  "summary": "one sentence verdict",
  "factors": [
    { "name": "Experience", "score": 70, "basis": "evidence or inferred", "note": "one sentence" },
    { "name": "Skills", "score": 70, "basis": "evidence or inferred", "note": "one sentence" },
    { "name": "Industry", "score": 70, "basis": "evidence or inferred", "note": "one sentence" },
    { "name": "Leadership", "score": 70, "basis": "evidence or inferred", "note": "one sentence" },
    { "name": "Growth", "score": 70, "basis": "evidence or inferred", "note": "one sentence on whether this role is a sensible next step" }
  ],
  "strengths": [ { "point": "short phrase", "evidence": "one sentence tied to their Career DNA" } ],
  "gaps": [ "one sentence each" ],
  "unknowns": [ "one short phrase each" ],
  "tips": [ "one sentence each, specific to this job" ]
}
Give 2-4 strengths, 1-4 gaps, 0-3 unknowns and 2-3 tips.`;

function compactProfile(p) {
  const c = cleanProfile(p || {});
  return {
    headline: c.headline, experience: c.experience, stage: c.stage, location: c.location,
    strengths: c.strengths, hiddenTalent: c.hiddenTalent, directions: c.directions.map(d => d.role), unknowns: c.unknowns.map(u => u.what)
  };
}

function cleanJob(j) {
  return {
    title: str(j?.title, 140), company: str(j?.company, 100), location: str(j?.location, 100),
    description: str(stripHtml(j?.description), 8000)
  };
}

async function match(req, res) {
  const body = getBody(req);
  if (!body?.profile?.headline) throw new UserError(400, "Build your Career DNA first, then check your fit.");
  const job = cleanJob(body.job);
  if (!job.title && job.description.length < 60) throw new UserError(400, "That job doesn't have enough detail to compare.");
  const content = [{
    type: "text",
    text: "Career DNA:\n" + JSON.stringify(compactProfile(body.profile)) +
      "\n\nJob posting:\nTitle: " + job.title + "\nCompany: " + job.company + "\nLocation: " + job.location +
      "\n\n" + job.description + "\n\nCompare them and return the JSON object."
  }];
  const p = await askClaude(MATCH_SYSTEM, content);
  const names = ["Experience", "Skills", "Industry", "Leadership", "Growth"];
  const factors = names.map(name => {
    const f = list(p.factors, 8).find(x => String(x?.name || "").toLowerCase() === name.toLowerCase()) || {};
    return { name, score: toScore(f.score), basis: f.basis === "inferred" ? "inferred" : "evidence", note: str(f.note, 240) };
  });
  const fit = {
    fitScore: toScore(p.fitScore),
    summary: str(p.summary, 300),
    factors,
    strengths: list(p.strengths, 4).map(s => ({ point: str(s?.point, 100), evidence: str(s?.evidence, 260) })).filter(s => s.point),
    gaps: list(p.gaps, 4).map(g => str(g, 240)).filter(Boolean),
    unknowns: list(p.unknowns, 3).map(u => str(u, 140)).filter(Boolean),
    tips: list(p.tips, 3).map(t => str(t, 260)).filter(Boolean)
  };
  if (!fit.summary) throw new UserError(502, "The fit check came back incomplete. Try again.");
  return res.status(200).json({ fit });
}

/* ---------------- Job DNA (employers) ---------------- */

const JOBDNA_SYSTEM = `You are Trazerr's job analyst. You read one job posting and describe its Job DNA: what the role truly requires and what evidence would prove a candidate fits.

Rules:
- "mustHaves" and "niceToHaves" must be stated or clearly implied in the posting. Keep each to a short phrase.
- "hidden" are reasonable inferences about what success in the role really takes. Each has a "why" starting "Based on".
- "evidence" lists the concrete things on a resume that would prove fit, e.g. "Managed a team of 5 or more".
- ${PLAIN}

${JSON_ONLY} Use exactly this shape:
{
  "title": "job title",
  "summary": "one or two sentences on what this role really is",
  "level": "short phrase, e.g. 'Mid-level, 3-5 years'",
  "mustHaves": [ "short phrase" ],
  "niceToHaves": [ "short phrase" ],
  "hidden": [ { "item": "short phrase", "why": "one sentence" } ],
  "evidence": [ "short phrase" ]
}
Give 3-7 must-haves, 0-5 nice-to-haves, 2-4 hidden requirements and 3-6 evidence items.
If the posting is an attached file, also include "postingText": the posting's full text as plain text, in its original order and wording (headings and bullet points on their own lines), up to about 6,000 characters.
If the text is not a job posting, return exactly {"error":"not_a_job"}.`;

async function jobdna(req, res) {
  const body = getBody(req);
  // A posting can be pasted text, or an uploaded PDF that the model reads directly (Word files are read in the browser).
  const pdf = body?.file?.kind === "pdf" ? body.file.data : null;
  let content;
  if (pdf) {
    if (typeof pdf !== "string" || pdf.length < 100 || pdf.length > 4_500_000) throw new UserError(400, "That PDF couldn't be read. Try a smaller file or paste the posting text.");
    content = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf } }, { type: "text", text: "This file is a job posting. Return the JSON object, including postingText." }];
  } else {
    const text = str(stripHtml(body?.text), 12000);
    if (text.length < 120) throw new UserError(400, "Paste the full job posting, at least a few lines.");
    content = [{ type: "text", text: "Job posting:\n\n" + text + "\n\nReturn the JSON object." }];
  }
  const p = await askClaude(JOBDNA_SYSTEM, content);
  if (p.error === "not_a_job") throw new UserError(422, pdf ? "That file doesn't look like a job posting. Upload the posting, or paste its text." : "That doesn't look like a job posting. Paste the full posting text.");
  const dna = {
    title: str(p.title, 120), summary: str(p.summary, 400), level: str(p.level, 80),
    mustHaves: list(p.mustHaves, 7).map(x => str(x, 120)).filter(Boolean),
    niceToHaves: list(p.niceToHaves, 5).map(x => str(x, 120)).filter(Boolean),
    hidden: list(p.hidden, 4).map(h => ({ item: str(h?.item, 120), why: str(h?.why, 240) })).filter(h => h.item),
    evidence: list(p.evidence, 6).map(x => str(x, 140)).filter(Boolean),
    ...(pdf ? { postingText: String(p.postingText ?? "").replace(/\r/g, "").trim().slice(0, 8000) } : {})
  };
  if (!dna.summary) throw new UserError(502, "The breakdown came back incomplete. Try again.");
  return res.status(200).json({ dna });
}

/* ---------------- Career path ---------------- */

const PATH_SYSTEM = `You are Trazerr's career path planner. Given one person's Career DNA (JSON) and a goal role, map an honest route from where they are to the goal.

Rules:
- Start from what the Career DNA proves. Never assume experience it doesn't show.
- Steps are real, commonly held job titles, ordered from the next realistic move to the goal. The last step is the goal itself.
- Be honest about difficulty. If the goal is a long reach, say so kindly and give a realistic timeline range.
- ${PLAIN}

${JSON_ONLY} Use exactly this shape:
{
  "current": "short description of where they are now, e.g. 'Front desk supervisor'",
  "goal": "the goal role",
  "outlook": "one or two sentences, honest and encouraging",
  "timeline": "rough range, e.g. '3 to 5 years'",
  "proven": [ "short phrase for something they already have that the goal needs" ],
  "missing": [ "short phrase for something they still need" ],
  "steps": [ { "role": "job title", "why": "one sentence", "build": "one sentence on what to do or prove in this step" } ]
}
Give 2-5 proven items, 2-5 missing items and 2-4 steps.`;

async function path(req, res) {
  const body = getBody(req);
  if (!body?.profile?.headline) throw new UserError(400, "Build your Career DNA first, then plan a path.");
  const goal = str(body.goal, 100);
  if (goal.length < 2) throw new UserError(400, "Type the role you'd like to reach.");
  const content = [{ type: "text", text: "Career DNA:\n" + JSON.stringify(compactProfile(body.profile)) + "\n\nGoal role: " + goal + "\n\nReturn the JSON object." }];
  const p = await askClaude(PATH_SYSTEM, content);
  const plan = {
    current: str(p.current, 100), goal: str(p.goal, 100) || goal, outlook: str(p.outlook, 400), timeline: str(p.timeline, 60),
    proven: list(p.proven, 5).map(x => str(x, 140)).filter(Boolean),
    missing: list(p.missing, 5).map(x => str(x, 140)).filter(Boolean),
    steps: list(p.steps, 4).map(s => ({ role: str(s?.role, 100), why: str(s?.why, 240), build: str(s?.build, 240) })).filter(s => s.role)
  };
  if (!plan.steps.length) throw new UserError(502, "The plan came back incomplete. Try again.");
  return res.status(200).json({ plan });
}

/* ---------------- Tailor my DNA ---------------- */
// Two steps: "skills" lists what the target role needs and how the resume's evidence covers it;
// "build" rewrites the resume for the role using only facts in the resume plus skills the person confirmed.

const TAILOR_SKILLS_SYSTEM = `You are Trazerr's resume tailor. You compare one resume with one target role (and the job posting, if given) and list the skills that matter most for that role, classified by the resume's evidence.

Rules:
- Evidence before inference. Never mark something verified unless the resume states it.
- "verified": the resume states it. "evidence" paraphrases the resume line in one short sentence.
- "inferred": a reasonable conclusion from the resume, but not stated. "evidence" says what it's based on, starting "Based on". "question" asks the person, in plain words, whether they really have it.
- "missing": the role needs it and the resume shows nothing for it. "how" is one sentence on how to build or show it.
- ${PLAIN}

${JSON_ONLY} Use exactly this shape:
{
  "role": "the target role as a clean job title",
  "fitNow": 58,
  "summary": "one sentence on how well the resume fits this role today",
  "skills": [ { "name": "2-5 words", "status": "verified, inferred or missing", "evidence": "one sentence", "question": "one short question (inferred only)", "how": "one sentence (missing only)" } ]
}
Give 8-14 skills, most important for the role first, with at most 5 missing. fitNow is a whole number from 0 to 100: 80+ strong, 60-79 good, 40-59 partial, under 40 weak.
If the document is not a resume, return exactly {"error":"not_a_resume"}.`;

const TAILOR_BUILD_SYSTEM = `You are Trazerr's resume tailor. You rewrite one resume so it presents the person's real evidence in the way that best fits a target role.

Hard rules, never broken:
- Keep every employer, job title, date, location, school, degree and certification exactly as written in the resume. Add none. Don't drop any job.
- If the resume gives no job title for an entry, leave "title" as an empty string. Never create, upgrade, rename or merge job titles.
- Use only facts from the resume and the skills listed as confirmed. Never add a number, tool, result, title or responsibility the resume doesn't support.
- Where a specific detail would make a bullet stronger and the resume doesn't give it, put a short placeholder in square brackets and add it to "blanks" with a plain question. Every placeholder must be unique and specific to what it asks for, like [accounts managed] or [% growth in 2023], never a generic [number] reused in several places.
- The headline describes the person's strengths for the target role. It must not claim a job title they have never held.

How to tailor:
- Lead each job with the bullets most relevant to the target role, and start bullets with a strong, plain verb and the result.
- Shorten or merge bullets that don't matter for this role, but keep the facts accurate.
- Each bullet's "from" is a short paraphrase of the original resume line it is based on.
- Improve the wording, but only with facts the original line states. Do: use a stronger, specific verb, put the result or scale first, tighten wordy phrasing, and merge two lines about the same work. Don't: add details, purposes, results, qualifiers or context the original doesn't state. For example, don't turn "room adjustments" into "room rate adjustments", and don't add phrases like "to keep guests satisfied".
- Where a bullet has no number but one would clearly make it stronger (how many, how often, how much, how big), add a [placeholder] for it. When the resume is short on numbers, aim for 2 to 5 placeholders across the resume, each on the most relevant bullets.
- In the summary, work out years of experience from the resume's dates up to today; don't copy a number the resume states, and don't count only the most recent job.
- List experience with the most recent first (latest end date first, then latest start date).
- Skills are specific things from the resume: tools, techniques, methods and subject areas, like "Immunohistochemistry (IHC)", "SAS", "Inventory management" or "Customer service". Never vague filler like "Sales experience", "Leadership" or "Data analysis skills".
- Keep every other section of the resume (awards, coursework, leadership, activities, volunteering, languages, certifications) in "extras", with the resume's own wording. An entry with its own title and dates (a team, club, role or project) goes in "entries" with its title, dates and bullets. A simple list (awards, courses, tools, languages) goes in "items", one award, course or skill per item. Never shorten or cut off an item.
- ${PLAIN}
- The headline, summary, skills and bullets are resume text. Write them in normal resume style with no pronouns: never "you", "your", "I", "my", "she" or "they". Write "Pharmacology graduate with lab research and sales experience", not "Combines a Master's…, giving you…". Only "changes" and the blank questions speak to the person as "you".

${JSON_ONLY} Use exactly this shape:
{
  "name": "name as written",
  "contact": "contact details as written on one line (email, phone, city, links), or empty string",
  "headline": "short line, e.g. 'Sales professional · Territory growth · Team training'",
  "summary": "2-3 sentences aimed at the target role",
  "skills": [ "skill" ],
  "experience": [ { "title": "", "company": "", "location": "", "dates": "", "bullets": [ { "text": "", "from": "" } ] } ],
  "education": [ "one line per entry, as written" ],
  "extras": [ { "heading": "e.g. Leadership", "entries": [ { "title": "", "dates": "", "bullets": [ "" ] } ], "items": [ "as written" ] } ],
  "blanks": [ { "placeholder": "text inside the brackets, exactly as used", "question": "one short question" } ],
  "changes": [ "one sentence each on what changed and why it helps for this role" ],
  "fitBefore": 58,
  "fitAfter": 71
}
fitBefore is the fit of the original resume for this role; fitAfter is the honest estimate for the tailored version with blanks still unfilled. Don't inflate fitAfter: tailoring changes presentation, not experience.
Give 3-6 changes and at most 8 blanks. Skills must come from the resume or the confirmed list.`;

// Resume text is never cut mid-word: a line that is too long ends at the last whole word.
function clip(v, max) {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max), sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:·–-]+$/, "") + "…";
}

// Most recent first: latest end year (Present counts as now), then latest start year. Entries without
// years keep their place relative to each other, after the dated ones.
function byRecency(jobs) {
  const now = new Date().getFullYear() + 0.5;
  const span = (d) => {
    const years = (String(d).match(/\b(19|20)\d{2}\b/g) || []).map(Number);
    if (!years.length && !/present|current|now/i.test(d)) return null;
    const end = /present|current|now/i.test(d) ? now : Math.max(...years);
    return { end, start: years.length ? Math.min(...years) : end };
  };
  return jobs.map((j, i) => ({ j, i, s: span(j.dates) }))
    .sort((a, b) => (!a.s || !b.s) ? (a.s ? -1 : b.s ? 1 : a.i - b.i) : (b.s.end - a.s.end) || (b.s.start - a.s.start) || (a.i - b.i))
    .map(x => x.j);
}

// Guard for text resumes: a title or employer in the tailored resume must appear in the original.
// Small differences (a fixed typo) are allowed; anything else is removed rather than shown.
const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function editDistanceWithin(a, b, max) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}
// A value passes if it appears in the original as a whole, or if every part of it does
// (for example "University of Vermont, Department of Pharmacology" joined from two lines).
function appearsIn(value, sourceSquashed) {
  if (appearsWhole(value, sourceSquashed)) return true;
  const parts = String(value || "").split(/[,()|/;–—]| - /).map(x => x.trim()).filter(x => squash(x).length >= 3);
  return parts.length > 1 && parts.every(x => appearsWhole(x, sourceSquashed));
}
function appearsWhole(value, sourceSquashed) {
  const v = squash(value);
  if (!v || sourceSquashed.includes(v)) return true;
  if (v.length < 6) return false;
  const max = Math.max(1, Math.floor(v.length / 10));
  // Compare against every stretch of the original that's up to `max` letters shorter or longer,
  // so an added or missing letter still counts as a match.
  for (let len = v.length - max; len <= v.length + max; len++) {
    for (let i = 0; i + len <= sourceSquashed.length; i++) {
      if (editDistanceWithin(v, sourceSquashed.slice(i, i + len), max)) return true;
    }
  }
  return false;
}

function resumeContent(body) {
  const r = body?.resume;
  if (r?.kind === "pdf") {
    if (typeof r.data !== "string" || r.data.length < 100 || r.data.length > 4_500_000) throw new UserError(400, "That PDF couldn't be read. Try uploading it again.");
    return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: r.data } }];
  }
  const text = str(r?.text, 30000);
  if (text.length < 80) throw new UserError(400, "Trazerr needs your resume to tailor it. Upload it again.");
  return [{ type: "text", text: "Resume:\n\n" + text }];
}

async function tailor(req, res) {
  const body = getBody(req);
  const stage = body?.stage === "build" ? "build" : "skills";
  const role = str(body?.role, 100);
  const posting = str(stripHtml(body?.posting), 8000);
  if (role.length < 2 && posting.length < 120) throw new UserError(400, "Choose or type the role you want to tailor for.");
  const target = "Target role: " + (role || "(see job posting)") + (posting ? "\n\nJob posting:\n" + posting : "");
  const content = resumeContent(body);

  if (stage === "skills") {
    content.push({ type: "text", text: target + "\n\nList the skills and return the JSON object." });
    const p = await askClaude(TAILOR_SKILLS_SYSTEM, content);
    if (p.error === "not_a_resume") throw new UserError(422, "That doesn't look like a resume. Upload your resume again.");
    const status = (v) => (v === "inferred" || v === "missing" ? v : "verified");
    const out = {
      role: str(p.role, 100) || role, fitNow: toScore(p.fitNow), summary: str(p.summary, 300),
      skills: list(p.skills, 14).map(k => ({
        name: str(k?.name, 60), status: status(k?.status), evidence: str(k?.evidence, 240), question: str(k?.question, 200), how: str(k?.how, 240)
      })).filter(k => k.name)
    };
    if (!out.skills.length) throw new UserError(502, "The skills list came back incomplete. Try again.");
    return res.status(200).json({ skills: out });
  }

  const confirmed = list(body?.confirmed, 20).map(k => str(k, 60)).filter(Boolean);
  content.push({ type: "text", text: target + "\n\nSkills the person confirmed they have: " + (confirmed.join("; ") || "(none beyond the resume)") + "\n\nRewrite the resume and return the JSON object." });
  const p = await askClaude(TAILOR_BUILD_SYSTEM, content);
  const resume = {
    name: str(p.name, 100), contact: str(p.contact, 300), headline: clip(p.headline, 200), summary: clip(p.summary, 900),
    skills: list(p.skills, 24).map(k => clip(k, 80)).filter(Boolean),
    experience: byRecency(list(p.experience, 15).map(j => ({
      title: str(j?.title, 150), company: str(j?.company, 150), location: str(j?.location, 100), dates: str(j?.dates, 60),
      bullets: list(j?.bullets, 8).map(b => ({ text: clip(b?.text, 500), from: str(b?.from, 300) })).filter(b => b.text)
    })).filter(j => j.title || j.company)),
    education: list(p.education, 8).map(e => clip(e, 300)).filter(Boolean),
    extras: list(p.extras, 8).map(x => ({
      heading: str(x?.heading, 60),
      entries: byRecency(list(x?.entries, 10).map(e => ({ title: clip(e?.title, 200), dates: str(e?.dates, 60), bullets: list(e?.bullets, 5).map(b => clip(typeof b === "string" ? b : b?.text, 400)).filter(Boolean) })).filter(e => e.title)),
      items: list(x?.items, 30).map(i => clip(i, 400)).filter(Boolean)
    })).filter(x => x.heading && (x.items.length || x.entries.length)),
    blanks: list(p.blanks, 8).map(b => ({ placeholder: str(b?.placeholder, 60), question: str(b?.question, 200) })).filter(b => b.placeholder),
    changes: list(p.changes, 6).map(c => str(c, 300)).filter(Boolean),
    fitBefore: toScore(p.fitBefore), fitAfter: toScore(p.fitAfter)
  };
  if (!resume.experience.length) throw new UserError(502, "The tailored resume came back incomplete. Try again.");
  const written = [resume.headline, resume.summary, ...resume.experience.flatMap(j => j.bullets.map(b => b.text))].join(" ");
  resume.blanks = resume.blanks.filter(b => written.includes("[" + b.placeholder + "]"));
  if (body?.resume?.kind === "text") {
    const src = squash(body.resume.text);
    for (const j of resume.experience) {
      for (const field of ["title", "company"]) {
        if (j[field] && !appearsIn(j[field], src)) { console.error("Removed a " + field + " not in the resume:", j[field]); j[field] = ""; }
      }
    }
  }
  return res.status(200).json({ resume });
}

/* ---------------- Storage (Upstash Redis REST) ---------------- */

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

// Runs several commands in one request. Returns one { result } or { error } per command.
async function redisPipeline(cfg, commands) {
  const r = await fetch(cfg.url.replace(/\/$/, "") + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + cfg.token, "Content-Type": "application/json" },
    body: JSON.stringify(commands)
  });
  if (!r.ok) throw new Error("Redis " + r.status + " " + (await r.text().catch(() => "")).slice(0, 200));
  return r.json();
}

/* ---------------- Usage counts ---------------- */
// Anonymous daily counters only: an event name and a count per day. No cookies, IP addresses,
// names or resume content are stored.

const EVENTS = new Set([
  "visit", "resume_file", "dna_started", "dna_built", "dna_failed", "example_viewed",
  "job_search", "fit_check", "job_dna", "path_planned", "card_saved", "waitlist_joined",
  "tailor_started", "tailor_built", "feedback_up", "feedback_down", "gap_line_copied", "theme_light", "theme_dark", "account_signed_in", "account_saved", "account_deleted",
  "alert_created", "alert_stopped", "alert_opened", "talent_opt_in", "talent_opt_out", "employer_page", "posting_file"
]);
const day = (d) => d.toISOString().slice(0, 10);

async function track(req, res) {
  const name = str(getBody(req)?.e, 40);
  const cfg = redisConfig();
  if (EVENTS.has(name) && cfg) {
    try { await redisPipeline(cfg, [["HINCRBY", "trazerr:events:" + day(new Date()), name, 1]]); }
    catch (e) { console.error("Usage count error", e.message); }
  }
  return res.status(204).end();
}

// The usage page and admin tools are protected by STATS_KEY. A wrong key looks like a missing page.
function requireAdmin(req) {
  const key = str(getQuery(req).key, 200), expected = process.env.STATS_KEY || "";
  if (!expected || key.length !== expected.length || !timingSafeEqual(Buffer.from(key), Buffer.from(expected))) throw new UserError(404, "Unknown request.");
}

async function stats(req, res) {
  requireAdmin(req);
  const cfg = redisConfig();
  if (!cfg) throw new UserError(503, "Storage isn't connected yet.");
  const days = Math.max(1, Math.min(90, parseInt(getQuery(req).days, 10) || 30));
  const dates = Array.from({ length: days }, (_, i) => day(new Date(Date.now() - i * 86400000)));
  const out = await redisPipeline(cfg, [...dates.map(d => ["HGETALL", "trazerr:events:" + d]), ["LRANGE", "trazerr:feedback", 0, 49], ["LRANGE", "trazerr:errors", 0, 49], ["GET", "trazerr:keepalive:last"]]);
  const parsed = (r) => (r?.result || []).map(x => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
  const recentFeedback = parsed(out[dates.length]), recentErrors = parsed(out[dates.length + 1]);
  const lastKeepalive = out[dates.length + 2]?.result || null;
  const byDay = {}, totals = {};
  dates.forEach((d, i) => {
    const flat = out[i]?.result || [];
    if (!flat.length) return;
    byDay[d] = {};
    for (let j = 0; j < flat.length; j += 2) {
      const n = Number(flat[j + 1]) || 0;
      byDay[d][flat[j]] = n;
      totals[flat[j]] = (totals[flat[j]] || 0) + n;
    }
  });
  totals.feedback_total = (totals.feedback_up || 0) + (totals.feedback_down || 0);
  const rate = (a, b) => (totals[b] ? Math.round((totals[a] || 0) / totals[b] * 100) + "%" : "n/a");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    period: days + " days",
    totals,
    funnel: {
      "visits that started a Career DNA": rate("dna_started", "visit"),
      "Career DNAs that succeeded": rate("dna_built", "dna_started"),
      "built Career DNAs that saved a card": rate("card_saved", "dna_built"),
      "feedback that was positive": rate("feedback_up", "feedback_total"),
      "job searches that turned on an alert": rate("alert_created", "job_search"),
      "alert emails that brought someone back": rate("alert_opened", "alert_email_sent")
    },
    recentFeedback,
    recentErrors,
    lastKeepalive,
    byDay
  });
}

/* ---------------- Feedback ---------------- */
// "Was this accurate?" answers from the results screens: which screen, thumbs up or down, and an
// optional comment. No resume content is stored. The newest 2,000 are kept.

async function feedback(req, res) {
  const body = getBody(req) || {};
  const on = ["dna", "tailor", "fit"].includes(body.on) ? body.on : "";
  const rating = body.rating === "up" || body.rating === "down" ? body.rating : "";
  if (!on || !rating) throw new UserError(400, "That feedback couldn't be read.");
  const cfg = redisConfig();
  if (!cfg) throw new UserError(503, "Feedback isn't switched on yet. Email hello@trazerr.com instead.");
  const entry = { at: new Date().toISOString(), on, rating, comment: str(body.comment, 1000), role: str(body.role, 100) };
  const today = "trazerr:events:" + day(new Date());
  try {
    // A follow-up comment for a rating already counted is stored but not counted again.
    const cmds = [["LPUSH", "trazerr:feedback", JSON.stringify(entry)], ["LTRIM", "trazerr:feedback", 0, 1999]];
    if (!body.followup) cmds.push(["HINCRBY", today, "feedback_" + rating, 1]);
    await redisPipeline(cfg, cmds);
  } catch (e) {
    console.error("Feedback storage error", e.message);
    throw new UserError(502, "That didn't go through. Try again in a moment.");
  }
  return res.status(200).json({ ok: true });
}

/* ---------------- Waitlist ---------------- */

async function waitlist(req, res) {
  const body = getBody(req) || {};
  if (body.company) return res.status(200).json({ ok: true }); // spam trap
  const email = str(body.email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError(400, "Enter a valid email address, like name@example.com.");
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new UserError(503, "The waitlist opens very soon. Please check back in a day or two.");
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(["HSETNX", "trazerr:waitlist", email, new Date().toISOString()])
  });
  if (!r.ok) {
    console.error("Waitlist storage error", r.status, (await r.text().catch(() => "")).slice(0, 300));
    throw new UserError(502, "That didn't go through. Try again in a moment.");
  }
  const data = await r.json().catch(() => ({}));
  return res.status(200).json({ ok: true, already: data.result === 0 });
}

/* ---------------- Supabase connection check ---------------- */
// Says whether Supabase is set up and reachable. Never returns keys or setting values.
function supabaseConfig() {
  const e = process.env;
  const url = e.SUPABASE_URL || e.SUPABASE_SUPABASE_URL || e.NEXT_PUBLIC_SUPABASE_URL || e.SUPABASE_NEXT_PUBLIC_SUPABASE_URL;
  const key = e.SUPABASE_SERVICE_ROLE_KEY || e.SUPABASE_SUPABASE_SERVICE_ROLE_KEY;
  const anon = e.SUPABASE_ANON_KEY || e.SUPABASE_SUPABASE_ANON_KEY || e.NEXT_PUBLIC_SUPABASE_ANON_KEY || e.SUPABASE_NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url ? { url: url.replace(/\/$/, ""), key, anon } : null;
}

async function dbstatus(req, res) {
  const cfg = supabaseConfig();
  let reachable = false, detail = "not configured";
  if (cfg && (cfg.anon || cfg.key)) {
    try {
      const r = await fetch(cfg.url + "/auth/v1/health", { headers: { apikey: cfg.anon || cfg.key }, signal: AbortSignal.timeout(8000) });
      reachable = r.ok; detail = "auth health " + r.status;
    } catch (e) { detail = "could not reach Supabase"; }
  }
  const out = { configured: !!cfg, hasServiceKey: !!(cfg && cfg.key), reachable, detail };
  // Health of the other services, as yes/no only.
  if (getQuery(req).all === "1") {
    const rc = redisConfig();
    let redis = "not configured";
    if (rc) { try { const r = await redisPipeline(rc, [["PING"]]); redis = r[0] && r[0].result === "PONG" ? "ok" : "unexpected reply"; } catch (e) { redis = "error"; } }
    let lastKeepalive = null;
    if (redis === "ok") { try { lastKeepalive = (await redisPipeline(rc, [["GET", "trazerr:keepalive:last"]]))[0]?.result || null; } catch (e) {} }
    out.services = { upstashRedis: redis, anthropicKey: !!process.env.ANTHROPIC_API_KEY, adzunaKeys: !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY), statsKey: !!process.env.STATS_KEY, errorAlerts: !!(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL), lastKeepalive };
  }
  if (cfg && cfg.key) {
    const t = await fetch(cfg.url + "/rest/v1/career_records?select=user_id&limit=1", { headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key } }).catch(() => null);
    out.tableExists = !!(t && t.ok);
    const a = await fetch(cfg.url + "/rest/v1/job_alerts?select=id&limit=1", { headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key } }).catch(() => null);
    out.alertsTableExists = !!(a && a.ok);
    const tp = await fetch(cfg.url + "/rest/v1/contact_requests?select=id&limit=1", { headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key } }).catch(() => null);
    out.talentTablesExist = !!(tp && tp.ok);
  }
  return res.status(200).json(out);
}

/* ---------------- Accounts ---------------- */
// The browser signs people in with Supabase directly. It needs the project address and the public (anon) key,
// which are designed to be public: row level security in the database decides what each person can read.
async function authconfig(req, res) {
  const cfg = supabaseConfig();
  if (!cfg || !cfg.anon) throw new UserError(503, "Accounts aren't switched on yet.");
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json({ url: cfg.url, anonKey: cfg.anon });
}

// "Delete everything": checks who is asking from their sign-in token, then removes their saved record and the account.
async function deleteaccount(req, res) {
  const cfg = supabaseConfig();
  if (!cfg || !cfg.key || !cfg.anon) throw new UserError(503, "Accounts aren't switched on yet.");
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) throw new UserError(401, "Sign in again, then try deleting.");
  const who = await fetch(cfg.url + "/auth/v1/user", { headers: { apikey: cfg.anon, Authorization: "Bearer " + token } });
  const user = who.ok ? await who.json().catch(() => null) : null;
  if (!user || !user.id || !/^[0-9a-f-]{36}$/i.test(user.id)) throw new UserError(401, "Your sign-in has expired. Sign in again, then try deleting.");
  const admin = { apikey: cfg.key, Authorization: "Bearer " + cfg.key };
  const rows = await fetch(cfg.url + "/rest/v1/career_records?user_id=eq." + user.id, { method: "DELETE", headers: admin });
  if (!rows.ok && rows.status !== 404) {
    console.error("Saved record delete error", rows.status);
    throw new UserError(502, "That didn't go through. Try again in a moment.");
  }
  const del = await fetch(cfg.url + "/auth/v1/admin/users/" + user.id, { method: "DELETE", headers: admin });
  if (!del.ok) {
    console.error("Account delete error", del.status);
    throw new UserError(502, "Your saved Career DNA and resume were deleted, but the account itself couldn't be. Email hello@trazerr.com and we'll finish it.");
  }
  return res.status(200).json({ ok: true });
}

/* ---------------- Talent pool: candidates employers can find ---------------- */
// Candidates choose to be found. Employers only see an anonymous profile (no name, contact details or
// employer names) until the candidate accepts their contact request. Employers must be approved by the
// Trazerr admin before they can search. Tables: supabase/talent.sql.

// Who is asking, from their sign-in token. Throws if they aren't signed in.
async function signedInUser(req, cfg) {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) throw new UserError(401, "Sign in first.");
  const who = await fetch(cfg.url + "/auth/v1/user", { headers: { apikey: cfg.anon, Authorization: "Bearer " + token } });
  const user = who.ok ? await who.json().catch(() => null) : null;
  if (!user || !/^[0-9a-f-]{36}$/i.test(user.id || "")) throw new UserError(401, "Your sign-in has expired. Sign in again.");
  return { id: user.id, email: str(user.email, 200) };
}

function accountsConfig() {
  const cfg = supabaseConfig();
  if (!cfg || !cfg.key || !cfg.anon) throw new UserError(503, "Accounts aren't switched on yet.");
  return cfg;
}

// A request to Supabase's database with the server's key. Returns the parsed rows (or null).
async function db(cfg, path, opts = {}) {
  const r = await fetch(cfg.url + "/rest/v1/" + path, {
    method: opts.method || "GET",
    headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key, "Content-Type": "application/json", ...(opts.prefer ? { Prefer: opts.prefer } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!r.ok) {
    const detail = (await r.text().catch(() => "")).slice(0, 200);
    if (opts.conflictOk && r.status === 409) return { conflict: true };
    throw new UserError(502, "That didn't go through. Try again in a moment.", "Supabase " + r.status + " on " + path.split("?")[0] + ": " + detail + (r.status === 404 ? " (run supabase/talent.sql)" : ""));
  }
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

async function emailOf(cfg, userId) {
  const r = await fetch(cfg.url + "/auth/v1/admin/users/" + userId, { headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key } });
  return r.ok ? str((await r.json().catch(() => ({}))).email, 200) : "";
}

// Sends one email through Resend. Returns true when accepted; failures are logged, never thrown.
async function sendEmail({ to, subject, text, html, replyTo, from }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from: from || "Trazerr <hello@trazerr.com>", to: [to], subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) { await recordError("server", "email", "Resend answered " + r.status + " for: " + subject.slice(0, 60), false); return false; }
    return true;
  } catch (e) { await recordError("server", "email", "Email failed: " + e.message, false); return false; }
}
// Every email shares one branded frame: logo, a brick accent line, and the same footer. Tables and
// inline styles, so it looks right in Gmail, Outlook and Apple Mail.
function emailLayout(inner, footer) {
  return '<div style="background:#F6F4F0;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #DCD8D0;border-top:4px solid #B42A1F;border-radius:6px;border-collapse:separate">' +
    '<tr><td style="padding:20px 24px 4px"><a href="' + SITE + '" style="text-decoration:none;color:#16233F;font-weight:bold;font-size:20px;letter-spacing:-0.3px"><img src="' + SITE + '/logo.png" width="28" height="28" alt="" style="vertical-align:middle;border:0;margin-right:8px">Trazerr</a></td></tr>' +
    '<tr><td style="padding:12px 24px 24px;color:#16233F;font-size:15px;line-height:1.55">' + inner + "</td></tr></table>" +
    '<p style="max-width:560px;margin:14px auto 0;color:#4A5163;font-size:12px;line-height:1.5;text-align:center">' + (footer ? footer + "<br>" : "") + 'Trazerr · Career intelligence, built on evidence · <a href="' + SITE + '" style="color:#4A5163">trazerr.com</a></p></div>';
}
const emailButton = (href, label) => '<a href="' + escHtml(href) + '" style="display:inline-block;background:#1F3F82;color:#FFFFFF;padding:11px 20px;border-radius:4px;text-decoration:none;font-weight:bold">' + escHtml(label) + "</a>";
const aOrAn = (word) => (/^[aeiou]/i.test(String(word || "").trim()) ? "an " : "a ") + word;
const simpleHtml = (paras, footer) => emailLayout(paras.map(p => '<p style="margin:0 0 14px">' + p + "</p>").join(""), footer);

async function countEvent(name, n = 1) {
  const rc = redisConfig();
  if (rc) { try { await redisPipeline(rc, [["HINCRBY", "trazerr:events:" + day(new Date()), name, n]]); } catch (e) {} }
}

// Removes contact details, links and the person's own name from text an employer will see.
function scrub(text, names) {
  let t = String(text || "").replace(/[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi, "").replace(/https?:\/\/\S+|www\.\S+/gi, "").replace(/(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/g, "");
  for (const n of names) if (n.length > 1) t = t.replace(new RegExp("\\b" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi"), "");
  return t.replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
}

const TALENT_SYSTEM = `You write the anonymous profile that employers see for a job seeker on Trazerr, from their Career DNA (JSON).

It must not identify the person. Remove their name, the names of employers, clients and schools, other people's names, street addresses, emails, phone numbers and links. Describe an employer or school by its kind instead ("a national retail chain", "a university pharmacology lab", "a small liberal arts college"). Keep the degree and field ("Master's in Pharmacology"). Keep facts, numbers and results.
Write in resume style with no pronouns ("Led a team of 9"), never "you", "I", "he", "she" or "they". Use only what the Career DNA says; add nothing.
${JSON_ONLY} Use exactly this shape:
{
  "headline": "one line, what this person brings, max 120 characters",
  "summary": "2 sentences",
  "experience": "total experience, like 'About 6 years'",
  "education": "highest degree and field, or empty string",
  "strengths": [ { "name": "short", "evidence": "one line of proof" } ],
  "roles": [ "role this person fits" ],
  "skills": [ "specific skill or tool" ]
}
Give 3-6 strengths, 2-4 roles and up to 10 skills.`;

function cleanTalent(p, names) {
  const t = (v, n) => scrub(clip(v, n), names);
  return {
    headline: t(p.headline, 140), summary: t(p.summary, 500), experience: t(p.experience, 40), education: t(p.education, 120),
    strengths: list(p.strengths, 6).map(x => ({ name: t(x?.name, 60), evidence: t(x?.evidence, 200) })).filter(x => x.name),
    roles: list(p.roles, 4).map(x => t(x, 60)).filter(Boolean),
    skills: list(p.skills, 10).map(x => t(x, 50)).filter(Boolean)
  };
}

async function talentdraft(req, res) {
  const cfg = accountsConfig();
  await signedInUser(req, cfg);
  const dna = getBody(req)?.profile;
  if (!dna || typeof dna !== "object" || !dna.headline) throw new UserError(400, "Build your Career DNA first.");
  const clean = cleanProfile(dna);
  const names = [clean.fullName, clean.firstName, ...String(clean.fullName).split(/\s+/)].map(x => str(x, 40)).filter(x => x.length > 2);
  const parsed = await askClaude(TALENT_SYSTEM, [{ type: "text", text: "Career DNA:\n" + JSON.stringify({ ...clean, fullName: "", firstName: "" }) + "\n\nReturn the JSON object." }]);
  const profile = cleanTalent(parsed, names);
  if (!profile.headline || !profile.strengths.length) throw new UserError(502, "Your profile came back incomplete. Try again.");
  return res.status(200).json({ profile });
}

async function employerjoin(req, res) {
  const cfg = accountsConfig(), me = await signedInUser(req, cfg), b = getBody(req) || {};
  const row = { user_id: me.id, company: str(b.company, 120), contact_name: str(b.contactName, 100), website: str(b.website, 200), job_title: str(b.jobTitle, 100) };
  if (row.company.length < 2 || row.contact_name.length < 2) throw new UserError(400, "Enter your company and your name.");
  const existing = (await db(cfg, "employers?select=status&user_id=eq." + me.id))[0];
  if (existing) {
    await db(cfg, "employers?user_id=eq." + me.id, { method: "PATCH", body: { company: row.company, contact_name: row.contact_name, website: row.website, job_title: row.job_title }, prefer: "return=minimal" });
    return res.status(200).json({ status: existing.status });
  }
  await db(cfg, "employers", { method: "POST", body: row, prefer: "return=minimal" });
  await countEvent("employer_joined");
  const admin = str(process.env.ALERT_EMAIL, 500).split(",")[0].trim();
  if (admin) await sendEmail({ to: admin, subject: "New employer waiting for approval: " + row.company,
    text: row.contact_name + (row.job_title ? " (" + row.job_title + ")" : "") + " from " + row.company + " (" + me.email + (row.website ? ", " + row.website : "") + ") wants to search candidates on Trazerr.\n\nApprove or reject them on your usage page: " + SITE + "/stats.html",
    html: simpleHtml([
      "<b>" + escHtml(row.company) + "</b> signed up and is waiting for approval.",
      "Contact: " + escHtml(row.contact_name) + (row.job_title ? " (" + escHtml(row.job_title) + ")" : ""),
      "Email: " + escHtml(me.email) + (row.website ? "<br>Website: " + escHtml(row.website) : ""),
      emailButton(SITE + "/stats.html", "Approve or reject")
    ], "Review new employers on your admin page.") });
  return res.status(200).json({ status: "pending" });
}

async function employerOf(cfg, userId) {
  return (await db(cfg, "employers?select=company,contact_name,website,job_title,status&user_id=eq." + userId))[0] || null;
}
async function approvedEmployer(req) {
  const cfg = accountsConfig(), me = await signedInUser(req, cfg), emp = await employerOf(cfg, me.id);
  if (!emp || emp.status !== "approved") throw new UserError(403, "Your employer account isn't approved yet.");
  return { cfg, me, emp };
}

// The employer's own account, and their contact requests. Contact details appear only once accepted.
async function employerme(req, res) {
  const cfg = accountsConfig(), me = await signedInUser(req, cfg), emp = await employerOf(cfg, me.id);
  let requests = [];
  if (emp && emp.status === "approved") {
    const rows = await db(cfg, "contact_requests?select=id,candidate_id,job_title,status,created_at,responded_at&employer_id=eq." + me.id + "&order=created_at.desc&limit=100");
    const ids = rows.map(r => r.candidate_id);
    const profiles = ids.length ? await db(cfg, "talent_profiles?select=user_id,public_id,profile&user_id=in.(" + ids.join(",") + ")") : [];
    for (const r of rows) {
      const tp = profiles.find(p => p.user_id === r.candidate_id);
      const item = { id: r.id, jobTitle: r.job_title, status: r.status, createdAt: r.created_at, headline: tp?.profile?.headline || "A Trazerr candidate", candidate: tp?.public_id || null };
      if (r.status === "accepted") {
        item.email = await emailOf(cfg, r.candidate_id);
        const rec = (await db(cfg, "career_records?select=career_dna&user_id=eq." + r.candidate_id))[0];
        item.name = str(rec?.career_dna?.fullName, 80);
      }
      requests.push(item);
    }
  }
  return res.status(200).json({ email: me.email, employer: emp && { company: emp.company, contactName: emp.contact_name, website: emp.website, jobTitle: emp.job_title, status: emp.status }, requests });
}

const MATCH_TALENT_SYSTEM = `You are Trazerr's candidate matcher. An employer describes one job; you score anonymous candidates for it using only the evidence in each profile.
- Score 0-100 for how well the candidate's shown experience and skills fit the job. Transferable experience counts: don't mark someone down just because past job titles differ.
- If the job isn't remote and a location is given, a candidate far away who isn't open to remote work fits less well; say so in the gap.
- Never consider age, gender, race, ethnicity, religion, disability, nationality, family status or anything else that isn't about doing the job.
- For each candidate give 2-3 short reasons that cite their evidence, and the biggest gap or unknown in one line.
${JSON_ONLY} Use exactly this shape: { "results": [ { "n": 1, "score": 80, "why": [ "" ], "gap": "" } ] } with one entry per candidate, using the candidate numbers given.`;

const wordsOf = (t) => new Set(String(t || "").toLowerCase().match(/[a-z][a-z0-9+#.]{2,}/g) || []);

async function searchtalent(req, res) {
  const { cfg, me } = await approvedEmployer(req);
  const b = getBody(req) || {};
  const title = str(b.title, 100), posting = str(stripHtml(b.posting), 6000), location = str(b.location, 100), remote = !!b.remote;
  if (title.length < 2) throw new UserError(400, "Enter the job title you're hiring for.");
  const pool = await db(cfg, "talent_profiles?select=user_id,public_id,profile,location,remote_ok,updated_at&visible=eq.true&order=updated_at.desc&limit=1000");
  if (!pool.length) return res.status(200).json({ poolSize: 0, candidates: [] });
  // A quick word-overlap pass picks the closest 20; the AI then scores those with reasons.
  const want = wordsOf(title + " " + posting);
  const near = (c) => location && c.location && c.location.toLowerCase().split(/[ ,]+/).some(w => w.length > 2 && location.toLowerCase().includes(w));
  const top = pool.map(c => {
    const have = wordsOf(JSON.stringify(c.profile));
    let overlap = 0; for (const w of want) if (have.has(w)) overlap++;
    return { c, rough: overlap + (near(c) || remote || c.remote_ok ? 2 : 0) };
  }).sort((a, b) => b.rough - a.rough).slice(0, 20).map(x => x.c);
  const job = "Job: " + title + (location ? "\nLocation: " + location : "") + (remote ? "\nRemote: yes" : "") + (posting ? "\n\nPosting:\n" + posting : "");
  const list_ = top.map((c, i) => "Candidate " + (i + 1) + " (location: " + (c.location || "not given") + (c.remote_ok ? ", open to remote" : "") + "):\n" + JSON.stringify(c.profile)).join("\n\n");
  const parsed = await askClaude(MATCH_TALENT_SYSTEM, [{ type: "text", text: job + "\n\n" + list_ + "\n\nScore every candidate and return the JSON object." }]);
  const scored = new Map(list(parsed.results, 40).map(r => [Number(r?.n), r]));
  const sent = await db(cfg, "contact_requests?select=candidate_id,status&employer_id=eq." + me.id);
  const candidates = top.map((c, i) => {
    const r = scored.get(i + 1) || {};
    return { id: c.public_id, score: toScore(r.score), why: list(r.why, 3).map(x => clip(x, 200)).filter(Boolean), gap: clip(r.gap, 200), profile: c.profile, location: c.location, remoteOk: c.remote_ok,
      requested: sent.find(x => x.candidate_id === c.user_id)?.status || null };
  }).filter(c => c.score !== null).sort((a, b) => b.score - a.score).slice(0, 12);
  await countEvent("talent_search");
  return res.status(200).json({ poolSize: pool.length, candidates });
}

async function contactrequest(req, res) {
  const { cfg, me, emp } = await approvedEmployer(req);
  const b = getBody(req) || {};
  const publicId = str(b.candidate, 40), jobTitle = str(b.jobTitle, 120), message = str(b.message, 1000);
  if (!/^[0-9a-f-]{36}$/i.test(publicId)) throw new UserError(400, "That candidate couldn't be found.");
  if (jobTitle.length < 2) throw new UserError(400, "Enter the job you'd like to talk about.");
  const today = new Date(Date.now() - 86400000).toISOString();
  const recent = await db(cfg, "contact_requests?select=id&employer_id=eq." + me.id + "&created_at=gt." + today);
  if (recent.length >= 25) throw new UserError(429, "You've sent 25 requests in the past day. Try again tomorrow.");
  const cand = (await db(cfg, "talent_profiles?select=user_id,visible&public_id=eq." + publicId))[0];
  if (!cand || !cand.visible) throw new UserError(404, "That candidate is no longer available.");
  const made = await db(cfg, "contact_requests", { method: "POST", body: { employer_id: me.id, candidate_id: cand.user_id, job_title: jobTitle, message }, prefer: "return=minimal", conflictOk: true });
  if (made && made.conflict) throw new UserError(409, "You've already contacted this candidate.");
  await countEvent("contact_requested");
  const to = await emailOf(cfg, cand.user_id);
  await sendEmail({ to, from: "Trazerr <hello@trazerr.com>", subject: emp.company + " would like to talk to you about " + aOrAn(jobTitle) + " role",
    text: emp.company + " found your anonymous profile on Trazerr and would like to talk to you about " + aOrAn(jobTitle) + " role." + (message ? "\n\nTheir message:\n" + message : "") +
      "\n\nThey don't have your name or contact details. If you accept, we'll share your name and email with them, and theirs with you.\n\nAccept or decline: " + SITE + "/#account\n\nYou get this because you chose to let employers find you on Trazerr. You can hide your profile any time from your account.",
    html: simpleHtml(["<b>" + escHtml(emp.company) + "</b> found your anonymous profile on Trazerr and would like to talk to you about " + (/^[aeiou]/i.test(jobTitle) ? "an" : "a") + " <b>" + escHtml(jobTitle) + "</b> role.",
      ...(message ? ['<span style="display:block;border-left:3px solid #B42A1F;padding:4px 0 4px 12px;color:#4A5163;font-style:italic">' + escHtml(message).replace(/\n/g, "<br>") + "</span>"] : []),
      "They don't have your name or contact details. If you accept, we'll share your name and email with them, and theirs with you.",
      emailButton(SITE + "/#account", "Accept or decline")], "You get this because you chose to let employers find you on Trazerr. You can hide your profile any time from your account.") });
  return res.status(200).json({ ok: true });
}

// A candidate's contact requests. Employer contact details appear once the candidate accepts.
async function myrequests(req, res) {
  const cfg = accountsConfig(), me = await signedInUser(req, cfg);
  const rows = await db(cfg, "contact_requests?select=id,employer_id,job_title,message,status,created_at&candidate_id=eq." + me.id + "&order=created_at.desc&limit=50");
  const out = [];
  for (const r of rows) {
    const emp = await employerOf(cfg, r.employer_id);
    const item = { id: r.id, company: emp?.company || "An employer", website: emp?.website || "", jobTitle: r.job_title, message: r.message, status: r.status, createdAt: r.created_at };
    if (r.status === "accepted") { item.contactName = emp?.contact_name || ""; item.email = await emailOf(cfg, r.employer_id); }
    out.push(item);
  }
  return res.status(200).json({ requests: out });
}

async function respondrequest(req, res) {
  const cfg = accountsConfig(), me = await signedInUser(req, cfg), b = getBody(req) || {};
  const id = str(b.id, 40), accept = b.accept === true;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new UserError(400, "That request couldn't be found.");
  const r = (await db(cfg, "contact_requests?select=id,employer_id,candidate_id,job_title,status&id=eq." + id + "&candidate_id=eq." + me.id))[0];
  if (!r) throw new UserError(404, "That request couldn't be found.");
  if (r.status !== "pending") return res.status(200).json({ status: r.status });
  await db(cfg, "contact_requests?id=eq." + id, { method: "PATCH", body: { status: accept ? "accepted" : "declined", responded_at: new Date().toISOString() }, prefer: "return=minimal" });
  if (accept) {
    await countEvent("contact_accepted");
    const emp = await employerOf(cfg, r.employer_id), empEmail = await emailOf(cfg, r.employer_id);
    const rec = (await db(cfg, "career_records?select=career_dna&user_id=eq." + me.id))[0];
    const name = str(rec?.career_dna?.fullName, 80) || "The candidate";
    await sendEmail({ to: empEmail, replyTo: me.email, subject: name + " accepted your request about the " + r.job_title + " role",
      text: name + " accepted your contact request on Trazerr about the " + r.job_title + " role.\n\nEmail: " + me.email + "\n\nReply to this email to reach them directly.",
      html: simpleHtml(["<b>" + escHtml(name) + "</b> accepted your contact request on Trazerr about the <b>" + escHtml(r.job_title) + "</b> role.", "Email: " + escHtml(me.email), "Reply to this email to reach them directly."]) });
    await sendEmail({ to: me.email, replyTo: empEmail, subject: "You're connected with " + (emp?.company || "the employer"),
      text: "You accepted " + (emp?.company || "the employer") + "'s request about the " + r.job_title + " role. We've sent them your name and email.\n\nTheir contact: " + (emp?.contact_name || "") + ", " + empEmail + "\n\nReply to this email to reach them directly.",
      html: simpleHtml(["You accepted <b>" + escHtml(emp?.company || "the employer") + "</b>'s request about the <b>" + escHtml(r.job_title) + "</b> role. We've sent them your name and email.", "Their contact: " + escHtml([emp?.contact_name, empEmail].filter(Boolean).join(", ")), "Reply to this email to reach them directly. Good luck!"]) });
  }
  return res.status(200).json({ status: accept ? "accepted" : "declined" });
}

// Admin: see employers and approve or reject them (usage page, STATS_KEY).
async function adminemployers(req, res) {
  requireAdmin(req);
  const cfg = accountsConfig();
  if (req.method === "POST") {
    const b = getBody(req) || {}, id = str(b.userId, 40), decision = b.decision === "approved" ? "approved" : b.decision === "rejected" ? "rejected" : "";
    if (!/^[0-9a-f-]{36}$/i.test(id) || !decision) throw new UserError(400, "Choose approve or reject.");
    const emp = await employerOf(cfg, id);
    if (!emp) throw new UserError(404, "That employer couldn't be found.");
    await db(cfg, "employers?user_id=eq." + id, { method: "PATCH", body: { status: decision, decided_at: new Date().toISOString() }, prefer: "return=minimal" });
    if (decision === "approved" && emp.status !== "approved") {
      await sendEmail({ to: await emailOf(cfg, id), subject: "You can now find candidates on Trazerr",
        text: "Hi " + emp.contact_name + ",\n\n" + emp.company + " is approved. You can now describe a job and see the candidates who fit it best: " + SITE + "/employers.html\n\nCandidates stay anonymous until they accept your contact request.",
        html: simpleHtml(["Hi " + escHtml(emp.contact_name) + ",", "<b>" + escHtml(emp.company) + "</b> is approved. You can now describe a job and see the candidates who fit it best.", emailButton(SITE + "/employers.html", "Find candidates"), "Candidates stay anonymous until they accept your contact request."]) });
    }
    return res.status(200).json({ ok: true });
  }
  const rows = await db(cfg, "employers?select=user_id,company,contact_name,website,job_title,status,created_at&order=created_at.desc&limit=200");
  const pool = await db(cfg, "talent_profiles?select=user_id&visible=eq.true&limit=5000");
  const employers = [];
  for (const e of rows) employers.push({ userId: e.user_id, company: e.company, contactName: e.contact_name, website: e.website, jobTitle: e.job_title, status: e.status, createdAt: e.created_at, email: await emailOf(cfg, e.user_id) });
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ employers, visibleCandidates: pool.length });
}

/* ---------------- Job alerts ---------------- */
// Signed-in people can ask for new jobs like a search they ran. Their alerts live in Supabase
// (table job_alerts, see supabase/job_alerts.sql); each person manages their own through row level
// security. Once a day Vercel runs sendalerts (vercel.json). Alerts not checked for about a week get
// the jobs posted since, minus any already sent, in one email per person.

const ALERT_EVERY_MS = 6.5 * 86400000;
const SITE = "https://www.trazerr.com";

// One-click unsubscribe links are signed, so nobody can stop someone else's alerts.
function unsubscribeToken(userId, key) {
  return createHmac("sha256", "trazerr-unsubscribe:" + key).update(userId).digest("base64url").slice(0, 32);
}
function unsubscribeUrl(userId, key) {
  return SITE + "/api/app?action=unsubscribe&u=" + userId + "&t=" + unsubscribeToken(userId, key);
}

async function newJobsFor(alert) {
  const seen = new Set(alert.seen || []);
  let found = [];
  const hasAdzuna = !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);
  if (hasAdzuna && !alert.remote) {
    found = (await searchAdzuna(alert.query, alert.location, 1, alert.location ? 25 : undefined, 8)).jobs;
  } else {
    const week = Date.now() - 8 * 86400000;
    found = (await searchRemotive(alert.query)).jobs.filter(j => !j.posted || Date.parse(j.posted) > week);
  }
  return found.filter(j => !seen.has(j.id)).slice(0, 6);
}

const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function alertEmail(groups, unsub) {
  const total = groups.reduce((n, g) => n + g.jobs.length, 0);
  const label = (a) => a.query + (a.remote ? " (remote)" : a.location ? " near " + a.location : "");
  const subject = total + " new job" + (total === 1 ? "" : "s") + " for " + label(groups[0].alert) + (groups.length > 1 ? " and more" : "");
  const searchUrl = (a) => SITE + "/?" + new URLSearchParams({ q: a.query, where: a.location || "", ...(a.remote ? { remote: "1" } : {}), src: "alert" }) + "#jobs";
  let html = '<div style="text-align:center;margin:0 0 24px">' +
    '<img src="' + SITE + '/logo.png" width="56" height="56" alt="Trazerr" style="display:inline-block;border:0">' +
    '</div>' +
    '<p style="font-size:20px;font-weight:bold;margin:0 0 4px">New jobs for you</p>' +
    '<p style="color:#4A5163;margin:0 0 18px">Posted in the past week, matching your job alerts on Trazerr.</p>';
  let text = "New jobs for you, posted in the past week.\n";
  for (const g of groups) {
    html += '<p style="font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#A62419;font-weight:bold;margin:22px 0 6px">' + escHtml(label(g.alert)) + "</p>";
    text += "\n" + label(g.alert).toUpperCase() + "\n";
    for (const j of g.jobs) {
      const meta = [j.company, j.location, j.salary].filter(Boolean).join(" · ");
      html += '<div style="border:1px solid #DCD8D0;border-radius:6px;padding:12px 14px;margin:0 0 10px">' +
        '<a href="' + escHtml(j.url) + '" style="color:#1F3F82;font-weight:bold;font-size:16px;text-decoration:none">' + escHtml(j.title) + "</a>" +
        (meta ? '<div style="color:#4A5163;font-size:14px;margin-top:3px">' + escHtml(meta) + "</div>" : "") + "</div>";
      text += "- " + j.title + (meta ? " (" + meta + ")" : "") + "\n  " + j.url + "\n";
    }
    html += '<p style="margin:12px 0 0">' + emailButton(searchUrl(g.alert), "See these on Trazerr and check your fit") + "</p>";
    text += "See these on Trazerr and check your fit: " + searchUrl(g.alert) + "\n";
  }
  html = emailLayout(html, 'You get this because you turned on job alerts at trazerr.com. <a href="' + escHtml(unsub) + '" style="color:#4A5163">Stop all job alerts</a> or manage them from your account.');
  text += "\nYou get this because you turned on job alerts at trazerr.com.\nStop all job alerts: " + unsub + "\n";
  return { subject, html, text };
}

async function sendalerts(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && String(req.headers.authorization || "") !== "Bearer " + secret) throw new UserError(401, "Not allowed.");
  const cfg = supabaseConfig(), resendKey = process.env.RESEND_API_KEY;
  if (!cfg || !cfg.key) throw new UserError(503, "Accounts aren't switched on yet.");
  if (!resendKey) throw new UserError(503, "Email isn't switched on yet.", "Job alerts: RESEND_API_KEY is missing");
  const admin = { apikey: cfg.key, Authorization: "Bearer " + cfg.key };
  const started = Date.now(), due = new Date(Date.now() - ALERT_EVERY_MS).toISOString();
  const r = await fetch(cfg.url + "/rest/v1/job_alerts?select=id,user_id,query,location,remote,seen,last_sent&active=eq.true&or=(last_sent.is.null,last_sent.lt." + due + ")&order=last_sent.asc.nullsfirst&limit=40", { headers: admin });
  if (!r.ok) throw new UserError(502, "Job alerts couldn't be loaded.", "Job alerts: Supabase answered " + r.status + (r.status === 404 ? " (run supabase/job_alerts.sql)" : ""));
  const byUser = new Map();
  for (const a of await r.json()) { if (!byUser.has(a.user_id)) byUser.set(a.user_id, []); byUser.get(a.user_id).push(a); }
  const out = { people: 0, emails: 0, jobs: 0, failed: 0 };
  for (const [userId, alerts] of byUser) {
    if (Date.now() - started > 45000) break; // the rest go out on the next run
    out.people++;
    try {
      const u = await fetch(cfg.url + "/auth/v1/admin/users/" + userId, { headers: admin });
      const email = u.ok ? (await u.json()).email : "";
      const groups = [];
      for (const a of alerts) { const jobs = await newJobsFor(a); if (jobs.length) groups.push({ alert: a, jobs }); }
      if (email && groups.length) {
        const { subject, html, text } = alertEmail(groups, unsubscribeUrl(userId, cfg.key));
        const unsub = unsubscribeUrl(userId, cfg.key);
        const sent = await fetch("https://api.resend.com/emails", {
          method: "POST", headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
          body: JSON.stringify({ from: process.env.ALERTS_FROM || "Trazerr Jobs <jobs@trazerr.com>", to: [email], reply_to: "hello@trazerr.com", subject, html, text,
            headers: { "List-Unsubscribe": "<" + unsub + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }),
          signal: AbortSignal.timeout(10000)
        });
        if (!sent.ok) throw new Error("Resend answered " + sent.status + " " + (await sent.text().catch(() => "")).slice(0, 120));
        out.emails++; out.jobs += groups.reduce((n, g) => n + g.jobs.length, 0);
      }
      // Mark every alert as checked, and remember what was sent so it isn't sent again.
      const now = new Date().toISOString();
      for (const a of alerts) {
        const sentIds = (groups.find(g => g.alert.id === a.id)?.jobs || []).map(j => j.id);
        await fetch(cfg.url + "/rest/v1/job_alerts?id=eq." + a.id, { method: "PATCH", headers: { ...admin, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ last_sent: now, seen: [...sentIds, ...(a.seen || [])].slice(0, 300) }) });
      }
    } catch (e) {
      out.failed++;
      await recordError("server", "sendalerts", "Job alert for one person failed: " + (e.detail || e.message));
    }
  }
  const rc = redisConfig();
  if (rc && out.emails) { try { await redisPipeline(rc, [["HINCRBY", "trazerr:events:" + day(new Date()), "alert_email_sent", out.emails]]); } catch (e) {} }
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(out);
}

// The "Stop all job alerts" link. Opening it shows a button (so email scanners that open links
// don't unsubscribe anyone); pressing it, or a mail app's one-click unsubscribe, stops the alerts.
function page(res, status, title, body) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).send('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>' + escHtml(title) + ' · Trazerr</title>' +
    '<style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#fff;color:#16233F;line-height:1.55}main{max-width:520px;margin:0 auto;padding:56px 20px}h1{font-size:28px;margin:0 0 12px}p{color:#4A5163}' +
    'button{font:inherit;font-weight:600;min-height:44px;padding:0 20px;border:0;border-radius:4px;background:#1F3F82;color:#fff;cursor:pointer}a{color:#1F3F82}@media (prefers-color-scheme:dark){body{background:#0E1628;color:#EEF1F7}p{color:#B4BCCD}a{color:#9DB8F5}button{background:#86A7F2;color:#0B1426}}</style></head><body><main>' +
    "<h1>" + escHtml(title) + "</h1>" + body + '<p><a href="/">Go to Trazerr</a></p></main></body></html>');
}

async function unsubscribe(req, res) {
  const q = getQuery(req), cfg = supabaseConfig();
  const userId = str(q.u, 40), token = str(q.t, 40);
  const valid = cfg && cfg.key && /^[0-9a-f-]{36}$/i.test(userId) && token.length === 32 &&
    timingSafeEqual(Buffer.from(token), Buffer.from(unsubscribeToken(userId, cfg.key)));
  if (!valid) return page(res, 400, "That link didn't work", "<p>The link may be incomplete. Sign in at trazerr.com and stop your job alerts from your account instead.</p>");
  if (req.method === "GET") {
    return page(res, 200, "Stop job alerts?", '<p>You won\'t get any more job alert emails from Trazerr. Your account and saved Career DNA stay as they are.</p><form method="post"><button type="submit">Stop all job alerts</button></form>');
  }
  const r = await fetch(cfg.url + "/rest/v1/job_alerts?user_id=eq." + userId, { method: "PATCH", headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ active: false }) });
  if (!r.ok) throw new UserError(502, "That didn't go through. Try again in a moment.", "Unsubscribe: Supabase answered " + r.status);
  const rc = redisConfig();
  if (rc) { try { await redisPipeline(rc, [["HINCRBY", "trazerr:events:" + day(new Date()), "alert_stopped", 1]]); } catch (e) {} }
  return page(res, 200, "Job alerts stopped", "<p>You won't get any more job alert emails. You can turn alerts back on after any job search on Trazerr.</p>");
}

/* ---------------- Job posting and matching (employer side) ---------------- */

// Create a job posting and extract Job DNA from the description
async function jobpost(req, res) {
  const cfg = supabaseConfig();
  if (!cfg || !cfg.key) throw new UserError(503, "Accounts aren't switched on yet.");

  const { data: { session } } = await getSession(req);
  if (!session) throw new UserError(401, "Sign in first.");

  const body = getBody(req) || {};
  const title = str(body.title, 120);
  const description = str(body.description, 5000);
  let required = list(body.required_skills, 20);
  let nice = list(body.nice_to_have, 20);
  const level = str(body.experience_level, 20) || "mid";
  const location = str(body.location, 100);

  if (!title) throw new UserError(400, "Please enter a job title.");

  // Extract Job DNA using Claude - do the AI magic
  let jobDna = null;
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

    const prompt = `Extract the core job requirements from this job posting.\n\nJob Title: ${title}${description ? "\n\nDescription:\n" + description : ""}\n\nReturn ONLY valid JSON (no markdown) with this structure:\n{\n  "core_skills": ["skill1", "skill2", "skill3"],\n  "experience_areas": ["area1", "area2"],\n  "key_responsibilities": ["resp1", "resp2"],\n  "must_have": ["requirement1", "requirement2"],\n  "nice_to_have": ["bonus1", "bonus2"]\n}`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(10000)
    });

    if (!r.ok) throw new Error("Claude API error: " + r.status);
    const out = await r.json();
    const extracted = extractJson(out.content[0]?.text || "");

    if (extracted?.core_skills?.length) {
      jobDna = extracted;
      required = list(extracted.core_skills, 20);
      nice = list(extracted.nice_to_have, 20);
      console.log("Job DNA extracted successfully:", { required: required.length, nice: nice.length });
    } else {
      console.warn("Job DNA extraction returned invalid format:", extracted);
      throw new Error("No skills extracted from: " + JSON.stringify(extracted).slice(0, 100));
    }
  } catch (e) {
    console.error("Job DNA extraction failed:", e.message);
    // Minimal fallback - use title as skill if extraction fails completely
    console.log("Using fallback: title as core skill");
    jobDna = { core_skills: [title], experience_areas: [], key_responsibilities: [], must_have: [title], nice_to_have: [] };
    required = [title];
    nice = [];
  }

  // Insert job posting
  try {
    const payload = {
      employer_id: session.user.id,
      company_code: body.company_code || "AUTO",
      title,
      description: description || "(No description provided)",
      required_skills: required,
      nice_to_have: nice,
      experience_level: "mid",
      location,
      remote_ok: body.remote_ok === true,
      job_dna: jobDna,
      status: "open"
    };
    console.log("Supabase insert to:", cfg.url + "/rest/v1/job_postings");
    console.log("Payload:", JSON.stringify(payload));
    console.log("Using JWT token for authenticated insert, employer_id:", session.user.id);

    const insertR = await fetch(cfg.url + "/rest/v1/job_postings", {
      method: "POST",
      headers: {
        apikey: cfg.anon || cfg.key,
        Authorization: "Bearer " + session.access_token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!insertR.ok) {
      const detail = await insertR.text().catch(() => "");
      console.error("Supabase insert error:", insertR.status, detail);
      const userMsg = "Database error: " + (detail || "HTTP " + insertR.status);
      throw new UserError(502, userMsg, "jobpost: Supabase " + insertR.status + ": " + detail.slice(0, 200));
    }

    const respText = await insertR.text();
    console.log("Supabase response status:", insertR.status);
    console.log("Supabase response text:", respText);
    if (!respText) {
      console.log("Empty response from Supabase");
      return res.status(201).json({ id: "created", title });
    }
    const job = JSON.parse(respText);
    return res.status(201).json(job);
  } catch (e) {
    if (e instanceof UserError) throw e;
    console.error("Job posting database error:", e);
    throw new UserError(502, "Database error: " + e.message, "jobpost database: " + e.message);
  }
}

// Calculate match score between candidate's Career DNA and job requirements
// Returns { score, summary, gaps }
function calculateMatch(careerDna, jobDna) {
  if (!careerDna || !jobDna) return { score: 0, summary: "Unable to calculate match", gaps: [] };

  const candidateSkills = new Set((careerDna.skills || []).map(s => s.toLowerCase()));
  const candidateExperience = new Set((careerDna.experience_areas || []).map(a => a.toLowerCase()));

  const jobRequirements = new Set((jobDna.must_have || jobDna.core_skills || []).map(s => s.toLowerCase()));
  const jobNice = new Set((jobDna.nice_to_have || []).map(s => s.toLowerCase()));
  const allJobNeeds = new Set([...jobRequirements, ...jobNice]);

  let matchedRequired = 0;
  let matchedNice = 0;
  const gaps = [];

  // Check required skills
  for (const req of jobRequirements) {
    const base = req.split(/[,;/\s]+/)[0].toLowerCase();
    let found = false;

    // Exact match or close match
    if (candidateSkills.has(req) || candidateSkills.has(base)) {
      matchedRequired++;
      found = true;
    } else {
      // Fuzzy match: check if any candidate skill contains the requirement
      for (const skill of candidateSkills) {
        if (skill.includes(base) || req.includes(skill.split(/[,;/\s]+/)[0])) {
          matchedRequired += 0.5;
          found = true;
          break;
        }
      }
    }

    if (!found) gaps.push(req);
  }

  // Check nice-to-have
  for (const nice of jobNice) {
    if (candidateSkills.has(nice) || candidateSkills.has(nice.split(/[,;/\s]+/)[0])) {
      matchedNice += 0.5;
    }
  }

  // Calculate score
  const requiredScore = jobRequirements.size > 0 ? (matchedRequired / jobRequirements.size) * 70 : 70;
  const niceScore = jobNice.size > 0 ? (matchedNice / jobNice.size) * 20 : 0;
  const experienceBonus = Math.min(10, (careerDna.years_of_experience || 0) * 1.5);
  const score = Math.round(Math.min(100, requiredScore + niceScore + experienceBonus));

  // Generate summary
  let summary = "";
  if (score >= 80) {
    summary = `Strong match (${matchedRequired}/${jobRequirements.size} required skills) with ${careerDna.years_of_experience || 0}+ years experience.`;
  } else if (score >= 60) {
    summary = `Good match on core skills; ${gaps.length} gaps (${gaps.slice(0, 2).join(", ")}).`;
  } else if (score >= 40) {
    summary = `Partial match with key gaps: ${gaps.slice(0, 2).join(", ")}.`;
  } else {
    summary = `Limited match. Missing ${gaps.slice(0, 3).join(", ")}.`;
  }

  return { score, summary, gaps: gaps.slice(0, 5) };
}

// When candidate applies, calculate match and optionally send employer alert
async function jobmatch(req, res) {
  const cfg = supabaseConfig();
  if (!cfg || !cfg.key) throw new UserError(503, "Accounts aren't switched on yet.");

  const body = getBody(req) || {};
  const appId = str(body.application_id, 40);
  const jobId = str(body.job_id, 40);
  const candidateId = str(body.candidate_id, 40);

  if (!appId || !jobId || !candidateId) throw new UserError(400, "Missing required fields.");

  // Get job details
  const jobR = await fetch(cfg.url + "/rest/v1/job_postings?id=eq." + jobId + "&select=*", {
    headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key }
  });
  if (!jobR.ok) throw new UserError(502, "Couldn't load job.");
  const [job] = await jobR.json();
  if (!job) throw new UserError(404, "Job not found.");

  // Get candidate Career DNA
  const candR = await fetch(cfg.url + "/rest/v1/career_records?user_id=eq." + candidateId + "&select=career_dna", {
    headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key }
  });
  if (!candR.ok) throw new UserError(502, "Couldn't load candidate.");
  const [cand] = await candR.json();

  // Calculate match
  const { score, summary, gaps } = calculateMatch(cand?.career_dna, job.job_dna);

  // Update application with match score
  const updateR = await fetch(cfg.url + "/rest/v1/applications?id=eq." + appId, {
    method: "PATCH",
    headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ match_score: score, match_summary: summary, gaps })
  });
  if (!updateR.ok) throw new UserError(502, "Couldn't update application.");

  return res.status(200).json({ score, summary, gaps });
}

// Send email to employer about new application
async function appAlert(req, res) {
  const cfg = supabaseConfig();
  const resendKey = process.env.RESEND_API_KEY;
  if (!cfg || !cfg.key) throw new UserError(503, "Accounts aren't switched on yet.");
  if (!resendKey) throw new UserError(503, "Email isn't switched on yet.");

  const body = getBody(req) || {};
  const appId = str(body.application_id, 40);

  if (!appId) throw new UserError(400, "Missing application_id.");

  // Get application with job and employer details
  const appR = await fetch(cfg.url + "/rest/v1/applications?id=eq." + appId + "&select=*,job_postings(*),career_records(user_id)", {
    headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key }
  });
  if (!appR.ok) throw new UserError(502, "Couldn't load application.");
  const [app] = await appR.json();
  if (!app) throw new UserError(404, "Application not found.");

  // Get employer email
  const empR = await fetch(cfg.url + "/auth/v1/admin/users/" + app.job_postings.employer_id, {
    headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key }
  });
  const empUser = empR.ok ? await empR.json() : {};
  const empEmail = empUser.email || "employer@trazerr.com";

  // Build email
  const candidateName = app.career_dna?.name || "A candidate";
  const jobTitle = app.job_postings?.title || "Your job";
  const subject = `${candidateName} applied – ${app.match_score}% fit for ${jobTitle}`;

  const paras = [
    `<b>${escHtml(candidateName)}</b> applied to your <b>${escHtml(jobTitle)}</b> opening.`,
    `<b>Match score:</b> ${app.match_score}%<br><b>Fit:</b> ${escHtml(app.match_summary || "No summary available")}`,
    ...(app.gaps && app.gaps.length ? [`<b>Gaps:</b> ${escHtml(app.gaps.join(", "))}`] : []),
    emailButton(SITE + "/employer-dashboard.html", "View full profile")
  ];
  const html = simpleHtml(paras, "Review all applications in your dashboard.");

  // Send via Resend
  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Trazerr <applications@trazerr.com>",
      to: [empEmail],
      subject,
      html,
      reply_to: "hello@trazerr.com"
    }),
    signal: AbortSignal.timeout(10000)
  });

  if (!sent.ok) {
    const err = await sent.text().catch(() => "");
    throw new UserError(502, "Email didn't send.", "appAlert: Resend " + sent.status + " " + err.slice(0, 200));
  }

  // Log email sent
  await fetch(cfg.url + "/rest/v1/application_emails_sent", {
    method: "POST",
    headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ application_id: appId, employer_id: app.job_postings.employer_id, email_address: empEmail, subject })
  }).catch(() => {});

  return res.status(200).json({ sent: true });
}

async function jobdelete(req, res) {
  const cfg = supabaseConfig();
  if (!cfg || !cfg.key) throw new UserError(503, "Accounts aren't switched on yet.");

  const { data: { session } } = await getSession(req);
  if (!session) throw new UserError(401, "Sign in first.");

  const body = getBody(req) || {};
  const jobId = str(body.job_id, 36);
  if (!jobId) throw new UserError(400, "Job ID required.");

  try {
    console.log("🗑️ [jobdelete] Attempting to delete job:", jobId, "for employer:", session.user.id);

    // First verify the job belongs to this employer
    const verifyR = await fetch(cfg.url + "/rest/v1/job_postings?id=eq." + encodeURIComponent(jobId) + "&select=id,employer_id", {
      headers: { apikey: cfg.anon || cfg.key, Authorization: "Bearer " + session.access_token }
    });

    if (!verifyR.ok) throw new Error("Failed to verify job: " + verifyR.status);
    const jobs = await verifyR.json();
    if (!jobs.length) throw new UserError(404, "Job not found.");
    if (jobs[0].employer_id !== session.user.id) throw new UserError(403, "Not your job.");

    console.log("✓ [jobdelete] Job verified, proceeding with deletion");

    // Delete the job
    console.log("📤 [jobdelete] Sending DELETE request to Supabase...");
    const deleteR = await fetch(cfg.url + "/rest/v1/job_postings?id=eq." + encodeURIComponent(jobId), {
      method: "DELETE",
      headers: { apikey: cfg.anon || cfg.key, Authorization: "Bearer " + session.access_token }
    });

    console.log("📥 [jobdelete] DELETE response status:", deleteR.status, deleteR.statusText);

    // 200, 201, 204 are all considered success for DELETE
    if (!deleteR.ok && deleteR.status !== 204) {
      const detail = await deleteR.text().catch(() => "");
      console.error("❌ [jobdelete] Delete failed with status", deleteR.status, "detail:", detail);
      throw new Error("Delete failed: " + detail);
    }

    // Verify the job was actually deleted by querying again
    console.log("🔍 [jobdelete] Verifying deletion by re-querying...");
    const verifyDeleteR = await fetch(cfg.url + "/rest/v1/job_postings?id=eq." + encodeURIComponent(jobId) + "&select=id", {
      headers: { apikey: cfg.anon || cfg.key, Authorization: "Bearer " + session.access_token }
    });

    if (verifyDeleteR.ok) {
      const remaining = await verifyDeleteR.json();
      if (remaining.length > 0) {
        console.error("❌ [jobdelete] VERIFICATION FAILED: Job still exists after delete!", remaining);
        throw new Error("Deletion verification failed: job still exists in database");
      }
      console.log("✓ [jobdelete] Verification passed: job no longer exists");
    } else {
      console.warn("⚠️ [jobdelete] Could not verify deletion (query failed)");
    }

    console.log("✓ [jobdelete] Job successfully deleted from database:", jobId);
    return res.status(200).json({ deleted: true, id: jobId, verified: true });
  } catch (e) {
    if (e instanceof UserError) throw e;
    console.error("❌ [jobdelete] Error:", e.message);
    throw new UserError(502, "Couldn't delete job: " + e.message);
  }
}

/* ---------------- Search employer jobs ----*/
async function jobjsearch(req, res) {
  const cfg = supabaseConfig();
  if (!cfg || !cfg.anon) throw new UserError(503, "Job database not configured.");

  const q = getQuery(req);
  const query = str(q.q, 100);
  if (!query) throw new UserError(400, "Enter a company code or job title to search.");

  try {
    const sb = { url: cfg.url, anonKey: cfg.anon };

    // Search job_postings table by company_code or title
    // First try exact company_code match
    let url = sb.url + "/rest/v1/job_postings?select=*&status=eq.open";

    // Try to match company code (e.g., WM.1001)
    if (query.match(/^[A-Z]{2}\.\d+$/)) {
      url += "&company_code=eq." + encodeURIComponent(query);
    } else {
      // Otherwise search by title or company name
      url += "&or=(title.ilike.%25" + encodeURIComponent(query) + "%25,company.ilike.%25" + encodeURIComponent(query) + "%25)";
    }

    url += "&limit=50&order=created_at.desc";

    const r = await fetch(url, {
      headers: { apikey: cfg.anon, "Accept": "application/json" },
      signal: AbortSignal.timeout(10000)
    });

    if (!r.ok) throw new Error("Database query failed: " + r.status);

    const jobs = await r.json();
    return res.status(200).json({ jobs: jobs || [] });
  } catch (e) {
    if (e instanceof UserError) throw e;
    throw new UserError(502, "Search failed: " + e.message);
  }
}

/* ---------------- Error log and alerts ---------------- */
// Keeps the newest 200 errors, from the server and from visitors' browsers, for the usage page, and emails
// an alert when the server fails (at most one an hour). Messages are cut short and email addresses are
// removed; no resume content is stored.

const cleanMessage = (s) => str(s, 300).replace(/[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/gi, "[email]");

async function recordError(where, action, message, alert = true) {
  const entry = { at: new Date().toISOString(), where, action: str(action, 30), message: cleanMessage(message) };
  const cfg = redisConfig();
  if (!cfg) return;
  const wantsAlert = alert && where === "server";
  try {
    const out = await redisPipeline(cfg, [
      ["LPUSH", "trazerr:errors", JSON.stringify(entry)], ["LTRIM", "trazerr:errors", 0, 199],
      ["HINCRBY", "trazerr:events:" + day(new Date()), "error_" + where, 1],
      ...(wantsAlert ? [["SET", "trazerr:alert:sent", entry.at, "NX", "EX", 3600]] : [])
    ]);
    if (wantsAlert && out[3]?.result === "OK") await sendAlert(entry);
  } catch (e) { console.error("Error log storage error", e.message); }
}

async function sendAlert(entry) {
  const key = process.env.RESEND_API_KEY, to = str(process.env.ALERT_EMAIL, 500).split(",").map(x => x.trim()).filter(Boolean);
  if (!key || !to.length) return;
  const text = "Something failed on trazerr.com.\n\n" +
    "When: " + entry.at + "\nFeature: " + (entry.action || "unknown") + "\nWhat happened: " + entry.message + "\n\n" +
    "More alerts are held back for an hour. Recent errors are listed at https://trazerr.com/stats.html";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.ALERT_FROM || "Trazerr alerts <alerts@trazerr.com>", to, subject: "Trazerr alert: " + (entry.action || "a request") + " failed", text }),
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) console.error("Alert email error", r.status, (await r.text().catch(() => "")).slice(0, 200));
  } catch (e) { console.error("Alert email error", e.message); }
}

// Errors in visitors' browsers, sent by the page itself.
async function clienterror(req, res) {
  const body = getBody(req) || {};
  const message = str(body.message, 300);
  if (message) await recordError("browser", str(body.where, 30) || "page", message + (body.source ? " at " + str(body.source, 120) : ""));
  return res.status(204).end();
}

/* ---------------- Daily keepalive ---------------- */
// Free Supabase projects pause after a week without use. Vercel runs this once a day (see vercel.json),
// and a small database read counts as use. The time of the last run is shown on the usage page.
async function keepalive(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && String(req.headers.authorization || "") !== "Bearer " + secret) throw new UserError(401, "Not allowed.");
  const cfg = supabaseConfig();
  if (!cfg || !cfg.key) throw new UserError(503, "Accounts aren't switched on yet.");
  let ok = false, status = 0;
  try {
    const r = await fetch(cfg.url + "/rest/v1/career_records?select=user_id&limit=1", { headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key }, signal: AbortSignal.timeout(15000) });
    ok = r.ok; status = r.status;
  } catch (e) { status = 0; }
  if (!ok) throw new UserError(502, "The database didn't answer.", "Keepalive: Supabase " + (status ? "answered " + status : "could not be reached"));
  const rc = redisConfig();
  if (rc) { try { await redisPipeline(rc, [["SET", "trazerr:keepalive:last", new Date().toISOString()]]); } catch (e) { console.error("Keepalive storage error", e.message); } }
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true });
}

/* ---------------- Uptime check ---------------- */
// For an outside monitor (like UptimeRobot): answers 200 when the site and the services it
// depends on are working, and 503 with the failing part named when not. Never returns keys.
async function health(req, res) {
  const checks = { ai: !!process.env.ANTHROPIC_API_KEY };
  const rc = redisConfig();
  if (rc) { try { checks.storage = (await redisPipeline(rc, [["PING"]]))[0]?.result === "PONG"; } catch (e) { checks.storage = false; } }
  const sc = supabaseConfig();
  if (sc && (sc.anon || sc.key)) {
    try { checks.accounts = (await fetch(sc.url + "/auth/v1/health", { headers: { apikey: sc.anon || sc.key }, signal: AbortSignal.timeout(8000) })).ok; } catch (e) { checks.accounts = false; }
  }
  const ok = Object.values(checks).every(Boolean);
  res.setHeader("Cache-Control", "no-store");
  return res.status(ok ? 200 : 503).json({ ok, checks });
}

/* ---------------- Employer Jobs (Simple Redis Storage) ---------------- */

async function postjob(req, res) {
  const body = getBody(req) || {};
  const title = str(body.title, 120);
  const company = str(body.company, 100);
  const description = str(body.description, 3000);
  const location = str(body.location, 100);

  if (!title || !company) throw new UserError(400, "Job title and company name required.");

  try {
    const jobId = "job-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
    const job = {
      id: jobId,
      title,
      company,
      description,
      location: location || "Remote",
      postedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };

    // Try Redis first
    const redisCfg = redisConfig();
    if (redisCfg) {
      try {
        await redisPipeline(redisCfg, [
          ["HSET", "trazerr:jobs", jobId, JSON.stringify(job)],
          ["ZADD", "trazerr:jobs:time", Date.now(), jobId],
          ["EXPIRE", "trazerr:jobs", 30 * 24 * 60 * 60]
        ]);
        return res.status(201).json({ job, message: "Job posted successfully!" });
      } catch (e) {
        console.error("Redis save failed, trying Supabase:", e.message);
      }
    }

    // Fall back to Supabase
    const sbCfg = supabaseConfig();
    if (sbCfg && sbCfg.anon) {
      const url = sbCfg.url + "/rest/v1/job_postings";
      const r = await fetch(url, {
        method: "POST",
        headers: { apikey: sbCfg.anon, "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          company,
          description,
          location: location || "Remote",
          status: "open"
        })
      });
      if (r.ok) {
        return res.status(201).json({ job, message: "Job posted successfully!" });
      }
    }

    throw new UserError(503, "Job storage not available");
  } catch (e) {
    console.error("Job posting error", e.message);
    throw new UserError(502, "Couldn't save the job. Try again.");
  }
}

async function searchjobs(req, res) {
  const query = str((getQuery(req).q || ""), 200).toLowerCase();
  const allJobs = [];

  try {
    // Try Redis first
    const cfg = redisConfig();
    if (cfg) {
      try {
        const jobIds = await redisPipeline(cfg, [["HKEYS", "trazerr:jobs"]]);
        if (jobIds[0]?.result && Array.isArray(jobIds[0].result)) {
          for (const jobId of jobIds[0].result) {
            const result = await redisPipeline(cfg, [["HGET", "trazerr:jobs", jobId]]);
            if (result[0]?.result) {
              try {
                const job = JSON.parse(result[0].result);
                const expiresAt = job.expiresAt ? new Date(job.expiresAt) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                if (expiresAt > new Date()) {
                  allJobs.push(job);
                }
              } catch (e) {
                console.error("Job parse error", e);
              }
            }
          }
        }
      } catch (e) {
        console.error("Redis search error:", e.message);
      }
    }

    // Fall back to Supabase for legacy jobs
    if (allJobs.length === 0) {
      try {
        const sbCfg = supabaseConfig();
        if (sbCfg && sbCfg.anon) {
          const sb = { url: sbCfg.url, anonKey: sbCfg.anon };
          let url = sb.url + "/rest/v1/job_postings?select=*";

          // Try to match company code (e.g., WM.1001) or search by title/company
          const queryStr = getQuery(req).q || "";
          if (queryStr && queryStr.match(/^[A-Z]{2}\.\d+$/)) {
            url += "&company_code=eq." + encodeURIComponent(queryStr);
          } else if (queryStr) {
            url += "&or=(title.ilike.%25" + encodeURIComponent(queryStr) + "%25,company.ilike.%25" + encodeURIComponent(queryStr) + "%25)";
          }

          url += "&limit=50&order=created_at.desc";
          console.log("Searching Supabase:", url.split("?")[0] + "?" + url.split("?")[1].split("&")[0]);

          const r = await fetch(url, {
            headers: { apikey: sb.anonKey, "Accept": "application/json" }
          });

          console.log("Supabase response status:", r.status);
          if (r.ok) {
            const jobs = await r.json();
            console.log("Supabase returned", jobs.length || 0, "jobs");
            if (Array.isArray(jobs)) {
              jobs.forEach(job => {
                allJobs.push({
                  id: job.id,
                  title: job.title || "",
                  company: job.company || "",
                  description: job.description || "",
                  location: job.location || "Remote",
                  postedAt: job.created_at || new Date().toISOString()
                });
              });
            }
          } else {
            const text = await r.text();
            console.error("Supabase error response:", text.slice(0, 500));
          }
        }
      } catch (e) {
        console.error("Supabase fallback error:", e.message);
      }
    }

    // Sort by newest first and limit results
    allJobs.sort((a, b) => new Date(b.postedAt || 0) - new Date(a.postedAt || 0));

    return res.status(200).json({ jobs: allJobs.slice(0, 50), total: allJobs.length });
  } catch (e) {
    console.error("Job search error", e.message);
    throw new UserError(502, "Search failed. Try again.");
  }
}

/* ---------------- router ---------------- */

const ACTIONS = { analyze, jobs, match, jobdna, path, tailor, feedback, waitlist, track, stats, dbstatus, authconfig, deleteaccount, clienterror, keepalive, health, sendalerts, unsubscribe, talentdraft, employerjoin, employerme, searchtalent, contactrequest, myrequests, respondrequest, adminemployers, postjob, searchjobs, jobdelete, jobmatch, jobjsearch, appAlert };

export default async function handler(req, res) {
  const action = str(getQuery(req).action, 20);
  const run = ACTIONS[action];
  if (!run) return res.status(404).json({ error: "Unknown request." });
  const method = ["jobs", "stats", "dbstatus", "authconfig", "keepalive", "health", "sendalerts"].includes(action) ? "GET" : "POST";
  const allowed = action === "unsubscribe" || action === "adminemployers" ? ["GET", "POST"] : [method];
  if (!allowed.includes(req.method)) {
    res.setHeader("Allow", method);
    return res.status(405).json({ error: "Use " + method + "." });
  }
  if (await limited(req, action)) {
    return res.status(429).json({ error: "You've made a lot of requests in a short time. Please wait a few minutes and try again." });
  }
  try {
    return await run(req, res);
  } catch (err) {
    const known = err instanceof UserError;
    if (!known) console.error("Request failed", action, err);
    // Server-side failures go to the error log (and may send an alert); visitor mistakes don't.
    if (!known || err.status >= 500) await recordError("server", action, known ? (err.detail || err.message) : String(err && err.stack || err).split("\n").slice(0, 2).join(" "));
    if (known) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: "Something went wrong on our side. Try again in a moment." });
  }
}
