// Trazerr server: one Vercel function for every feature.
// Route: /api/app?action=analyze | jobs | match | jobdna | path | tailor | waitlist
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
//   STATS_KEY           optional: a long random password for viewing usage counts at
//                       /api/app?action=stats&key=YOUR_STATS_KEY

import { createHash } from "node:crypto";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const FALLBACK_MODEL = process.env.ANTHROPIC_FALLBACK_MODEL || "claude-sonnet-5-5";
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

// Per-visitor limits to protect the API budget. With storage connected they're shared by every server
// instance; otherwise they're kept in memory. Visitors are identified by a one-way hash of their IP
// address, and stored counters expire with the 10-minute window.
const WINDOW_SEC = 600;
const LIMITS = { analyze: 8, match: 20, jobdna: 12, path: 12, tailor: 16, jobs: 60, waitlist: 10, track: 200, stats: 30, feedback: 20 };
const MEMORY_ONLY = new Set(["track", "jobs"]); // cheap requests; not worth a storage round trip
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

class UserError extends Error {
  constructor(status, message) { super(message); this.status = status; }
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
  if (!(await withinDailyBudget())) throw new UserError(503, "Trazerr has reached its limit for today. Please try again tomorrow.");
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
      lastErr = new UserError(503, "Trazerr couldn't reach its AI service. Try again in a moment.");
      continue;
    }
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("Anthropic API error", model, r.status, detail.slice(0, 500));
      if (r.status === 401 || r.status === 403) throw new UserError(503, "This feature isn't working right now. Please try again later.");
      lastErr = r.status === 429 || r.status === 529
        ? new UserError(503, "Trazerr is busy right now. Try again in a minute.")
        : new UserError(502, "The analysis didn't finish. Try again in a moment.");
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
      ? new UserError(502, "The analysis ran too long and didn't finish. Try again, or paste a shorter version.")
      : new UserError(502, "The analysis came back in an unexpected format. Try again.");
  }
  throw lastErr || new UserError(502, "The analysis didn't finish. Try again in a moment.");
}

const PLAIN = "Write in plain, warm, everyday language for someone who may not work in tech. No jargon, no buzzwords.";
const JSON_ONLY = "Return ONLY a JSON object, no markdown fences, no text before or after.";

/* ---------------- Career DNA ---------------- */

const ANALYZE_SYSTEM = `You are Trazerr's resume analyst. You read one resume and describe the person's Career DNA.

Core rule: evidence before inference. Never invent employers, titles, dates, numbers, degrees or skills.
- "verified" means stated directly in the resume. Its evidence is a short paraphrase of the resume line.
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
  "unknowns": [ "short phrase for something the resume does not show" ]
}
Give 4-7 strengths, 1-3 hidden talents, 2-4 directions and 1-4 unknowns. evidenceScore must be a whole number.
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
    unknowns: list(p.unknowns, 4).map(u => str(u, 120)).filter(Boolean)
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

async function searchAdzuna(q, where, page, distanceKm) {
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
    catch (e) { console.error("Adzuna unavailable, falling back to Remotive:", e.message); result = await searchRemotive(query); fellBack = true; }
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
    strengths: c.strengths, hiddenTalent: c.hiddenTalent, directions: c.directions.map(d => d.role), unknowns: c.unknowns
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
If the text is not a job posting, return exactly {"error":"not_a_job"}.`;

async function jobdna(req, res) {
  const body = getBody(req);
  const text = str(stripHtml(body?.text), 12000);
  if (text.length < 120) throw new UserError(400, "Paste the full job posting, at least a few lines.");
  const p = await askClaude(JOBDNA_SYSTEM, [{ type: "text", text: "Job posting:\n\n" + text + "\n\nReturn the JSON object." }]);
  if (p.error === "not_a_job") throw new UserError(422, "That doesn't look like a job posting. Paste the full posting text.");
  const dna = {
    title: str(p.title, 120), summary: str(p.summary, 400), level: str(p.level, 80),
    mustHaves: list(p.mustHaves, 7).map(x => str(x, 120)).filter(Boolean),
    niceToHaves: list(p.niceToHaves, 5).map(x => str(x, 120)).filter(Boolean),
    hidden: list(p.hidden, 4).map(h => ({ item: str(h?.item, 120), why: str(h?.why, 240) })).filter(h => h.item),
    evidence: list(p.evidence, 6).map(x => str(x, 140)).filter(Boolean)
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
- ${PLAIN}

${JSON_ONLY} Use exactly this shape:
{
  "name": "name as written",
  "contact": "contact details as written on one line (email, phone, city, links), or empty string",
  "headline": "short line, e.g. 'Sales professional · Territory growth · Team training'",
  "summary": "2-3 sentences aimed at the target role",
  "skills": [ "skill" ],
  "experience": [ { "title": "", "company": "", "location": "", "dates": "", "bullets": [ { "text": "", "from": "" } ] } ],
  "education": [ "one line per entry, as written" ],
  "extras": [ { "heading": "e.g. Certifications", "items": [ "as written" ] } ],
  "blanks": [ { "placeholder": "text inside the brackets, exactly as used", "question": "one short question" } ],
  "changes": [ "one sentence each on what changed and why it helps for this role" ],
  "fitBefore": 58,
  "fitAfter": 71
}
fitBefore is the fit of the original resume for this role; fitAfter is the honest estimate for the tailored version with blanks still unfilled. Don't inflate fitAfter: tailoring changes presentation, not experience.
Give 3-6 changes and at most 8 blanks. Skills must come from the resume or the confirmed list.`;

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
    name: str(p.name, 100), contact: str(p.contact, 300), headline: str(p.headline, 160), summary: str(p.summary, 700),
    skills: list(p.skills, 24).map(k => str(k, 60)).filter(Boolean),
    experience: list(p.experience, 15).map(j => ({
      title: str(j?.title, 120), company: str(j?.company, 120), location: str(j?.location, 100), dates: str(j?.dates, 60),
      bullets: list(j?.bullets, 8).map(b => ({ text: str(b?.text, 400), from: str(b?.from, 300) })).filter(b => b.text)
    })).filter(j => j.title || j.company),
    education: list(p.education, 8).map(e => str(e, 240)).filter(Boolean),
    extras: list(p.extras, 5).map(x => ({ heading: str(x?.heading, 60), items: list(x?.items, 12).map(i => str(i, 200)).filter(Boolean) })).filter(x => x.heading && x.items.length),
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
  "tailor_started", "tailor_built", "feedback_up", "feedback_down"
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

async function stats(req, res) {
  const key = str(getQuery(req).key, 200);
  const expected = process.env.STATS_KEY || "";
  if (!expected || key.length !== expected.length || key !== expected) throw new UserError(404, "Unknown request.");
  const cfg = redisConfig();
  if (!cfg) throw new UserError(503, "Storage isn't connected yet.");
  const days = Math.max(1, Math.min(90, parseInt(getQuery(req).days, 10) || 30));
  const dates = Array.from({ length: days }, (_, i) => day(new Date(Date.now() - i * 86400000)));
  const out = await redisPipeline(cfg, [...dates.map(d => ["HGETALL", "trazerr:events:" + d]), ["LRANGE", "trazerr:feedback", 0, 49]]);
  const recentFeedback = (out[dates.length]?.result || []).map(x => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
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
      "feedback that was positive": rate("feedback_up", "feedback_total")
    },
    recentFeedback,
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

/* ---------------- router ---------------- */

const ACTIONS = { analyze, jobs, match, jobdna, path, tailor, feedback, waitlist, track, stats };

export default async function handler(req, res) {
  const action = str(getQuery(req).action, 20);
  const run = ACTIONS[action];
  if (!run) return res.status(404).json({ error: "Unknown request." });
  const method = action === "jobs" || action === "stats" ? "GET" : "POST";
  if (req.method !== method) {
    res.setHeader("Allow", method);
    return res.status(405).json({ error: "Use " + method + "." });
  }
  if (await limited(req, action)) {
    return res.status(429).json({ error: "You've made a lot of requests in a short time. Please wait a few minutes and try again." });
  }
  try {
    return await run(req, res);
  } catch (err) {
    if (err instanceof UserError) return res.status(err.status).json({ error: err.message });
    console.error("Request failed", action, err);
    return res.status(500).json({ error: "Something went wrong on our side. Try again in a moment." });
  }
}
