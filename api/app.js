// Trazerr server: one Vercel function for every feature.
// Route: /api/app?action=analyze | jobs | match | jobdna | path | bullet | waitlist
//
// Environment variables (Vercel > Project > Settings > Environment Variables):
//   ANTHROPIC_API_KEY   required: Career DNA, fit checks, Job DNA, career paths, resume line coach
//   ADZUNA_APP_ID       optional: local job search (free at developer.adzuna.com)
//   ADZUNA_APP_KEY      optional: local job search
//   ADZUNA_COUNTRY      optional: defaults to "us"
//   KV_REST_API_URL     waitlist storage, added automatically when you connect Upstash Redis in Vercel Storage
//   KV_REST_API_TOKEN   waitlist storage, added automatically with the line above

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

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

// Simple per-visitor limit to protect your API budget (per server instance).
const hits = new Map();
const LIMITS = { analyze: 8, match: 20, jobdna: 12, path: 12, bullet: 20, jobs: 60, waitlist: 10 };
function limited(req, action) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const key = ip + ":" + action;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < 10 * 60 * 1000);
  if (recent.length >= (LIMITS[action] || 20)) { hits.set(key, recent); return true; }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

class UserError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function askClaude(system, content, maxTokens = 3000) {
  if (!process.env.ANTHROPIC_API_KEY) throw new UserError(503, "This feature isn't switched on yet. Try again later.");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content }] })
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    console.error("Anthropic API error", r.status, detail.slice(0, 500));
    if (r.status === 429 || r.status === 529) throw new UserError(503, "Trazerr is busy right now. Try again in a minute.");
    throw new UserError(502, "The analysis didn't finish. Try again in a moment.");
  }
  const data = await r.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  const parsed = extractJson(text);
  if (!parsed) throw new UserError(502, "The analysis came back in an unexpected format. Try again.");
  return parsed;
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
  "experience": "short phrase, max 6 words, e.g. '8+ years customer-facing'",
  "stage": "short phrase, max 8 words, e.g. 'New to degree-level roles'",
  "location": "city and state or country from the resume, or empty string",
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
  const parsed = await askClaude(ANALYZE_SYSTEM, content, 3000);
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

async function searchAdzuna(q, where, page) {
  const country = (process.env.ADZUNA_COUNTRY || "us").toLowerCase();
  const params = new URLSearchParams({
    app_id: process.env.ADZUNA_APP_ID,
    app_key: process.env.ADZUNA_APP_KEY,
    results_per_page: "20",
    "content-type": "application/json"
  });
  if (q) params.set("what", q);
  if (where) params.set("where", where);
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

async function jobs(req, res) {
  const q = getQuery(req);
  const query = str(q.q, 100);
  const where = str(q.where, 80);
  const remote = q.remote === "1" || q.remote === "true";
  const page = Math.max(1, Math.min(10, parseInt(q.page, 10) || 1));
  if (!query && !where) throw new UserError(400, "Enter a job title or keyword to search.");

  const hasAdzuna = !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);
  let result;
  if (hasAdzuna && !remote) result = await searchAdzuna(query, where, page);
  else result = await searchRemotive(query);
  result.localSearch = hasAdzuna;

  res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");
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
  const p = await askClaude(MATCH_SYSTEM, content, 2000);
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
  const p = await askClaude(JOBDNA_SYSTEM, [{ type: "text", text: "Job posting:\n\n" + text + "\n\nReturn the JSON object." }], 1800);
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
  const p = await askClaude(PATH_SYSTEM, content, 1800);
  const plan = {
    current: str(p.current, 100), goal: str(p.goal, 100) || goal, outlook: str(p.outlook, 400), timeline: str(p.timeline, 60),
    proven: list(p.proven, 5).map(x => str(x, 140)).filter(Boolean),
    missing: list(p.missing, 5).map(x => str(x, 140)).filter(Boolean),
    steps: list(p.steps, 4).map(s => ({ role: str(s?.role, 100), why: str(s?.why, 240), build: str(s?.build, 240) })).filter(s => s.role)
  };
  if (!plan.steps.length) throw new UserError(502, "The plan came back incomplete. Try again.");
  return res.status(200).json({ plan });
}

/* ---------------- Resume line coach ---------------- */

const BULLET_SYSTEM = `You are Trazerr's resume coach. You make one resume line stronger without making anything up.

Rules:
- Evidence before inference. Keep every fact from the original line and add NO new facts: no numbers, tools, titles, results or scope the person didn't write.
- Where a specific detail would make the line stronger, put a short placeholder in square brackets, e.g. [number of customers] or [% increase], and ask for it in "questions".
- Lead with a strong, plain verb. Show the outcome, not just the duty. One line each, max 30 words.
- If a target role is given, lean each rewrite toward what that role values, still using only the person's facts.
- ${PLAIN}

${JSON_ONLY} Use exactly this shape:
{
  "verdict": "one sentence on what the original line does well or where it falls short",
  "rewrites": [ { "text": "the rewritten line", "angle": "2-5 words on what this version emphasizes" } ],
  "questions": [ "one short question asking for a real detail that would make the line stronger" ]
}
Give 2-3 rewrites and 1-3 questions.
If the text is not a line from a resume or work history, return exactly {"error":"not_a_line"}.`;

async function bullet(req, res) {
  const body = getBody(req);
  const line = str(body?.line, 600);
  const role = str(body?.role, 100);
  if (line.length < 12) throw new UserError(400, "Paste one line from your resume, like a bullet point under a job.");
  const content = [{ type: "text", text: "Resume line:\n" + line + (role ? "\n\nTarget role: " + role : "") + "\n\nReturn the JSON object." }];
  const p = await askClaude(BULLET_SYSTEM, content, 1200);
  if (p.error === "not_a_line") throw new UserError(422, "That doesn't look like a resume line. Paste one bullet point that describes your work.");
  const coach = {
    verdict: str(p.verdict, 300),
    rewrites: list(p.rewrites, 3).map(r => ({ text: str(r?.text, 300), angle: str(r?.angle, 60) })).filter(r => r.text),
    questions: list(p.questions, 3).map(q => str(q, 200)).filter(Boolean)
  };
  if (!coach.rewrites.length) throw new UserError(502, "The suggestions came back incomplete. Try again.");
  return res.status(200).json({ coach });
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

const ACTIONS = { analyze, jobs, match, jobdna, path, bullet, waitlist };

export default async function handler(req, res) {
  const action = str(getQuery(req).action, 20);
  const run = ACTIONS[action];
  if (!run) return res.status(404).json({ error: "Unknown request." });
  const method = action === "jobs" ? "GET" : "POST";
  if (req.method !== method) {
    res.setHeader("Allow", method);
    return res.status(405).json({ error: "Use " + method + "." });
  }
  if (limited(req, action)) {
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
