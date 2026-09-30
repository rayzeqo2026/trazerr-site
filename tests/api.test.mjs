// Tests for the server function (api/app.js), with every outside service replaced by a fake.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const SB = "https://mock.supabase.test", REDIS = "https://mock.redis.test";
let calls, redisLog, adminFails, supabaseDown, emails, stored, aiReply, alerts, patches, adzunaJobs;

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const h = opts.headers || {};
  calls.push((opts.method || "GET") + " " + url);
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (url.startsWith(REDIS)) {
    const cmds = JSON.parse(opts.body);
    redisLog.push(...cmds);
    return res(200, cmds.map(c => {
      if (c[0] === "SET" && c.includes("NX")) { if (stored[c[1]]) return { result: null }; stored[c[1]] = c[2]; return { result: "OK" }; }
      if (c[0] === "SET") { stored[c[1]] = c[2]; return { result: "OK" }; }
      if (c[0] === "GET") return { result: stored[c[1]] ?? null };
      if (c[0] === "LRANGE") return { result: (stored[c[1]] || []) };
      if (c[0] === "LPUSH") { (stored[c[1]] ||= []).unshift(c[2]); return { result: 1 }; }
      if (c[0] === "INCR") return { result: 1 };
      if (c[0] === "PING") return { result: "PONG" };
      return { result: 1 };
    }));
  }
  if (url === "https://api.resend.com/emails") { emails.push({ ...JSON.parse(opts.body), headersSent: h }); return res(200, { id: "e1" }); }
  if (url.startsWith("https://api.adzuna.com")) return res(200, { count: adzunaJobs.length, results: adzunaJobs });
  if (url.startsWith(SB)) {
    if (supabaseDown) return res(503, {});
    if (url.endsWith("/auth/v1/health")) return res(200, {});
    if (url.endsWith("/auth/v1/user")) { const who = TOKENS[String(h.Authorization || "").slice(7)]; return who ? res(200, who) : res(401, {}); }
    if (url.includes("/rest/v1/career_records?select=career_dna")) { const id = url.match(/user_id=eq\.([^&]+)/)[1]; return res(200, tables.career_records.filter(r => r.user_id === id)); }
    if (url.includes("/rest/v1/career_records")) return res(opts.method === "DELETE" ? 204 : 200, []);
    const tm = url.match(/\/rest\/v1\/(talent_profiles|employers|contact_requests)(\?.*)?$/);
    if (tm) return tableCall(tm[1], new URLSearchParams((tm[2] || "").slice(1)), opts.method || "GET", opts.body ? JSON.parse(opts.body) : null, res);
    if (url.includes("/rest/v1/job_alerts")) {
      if ((opts.method || "GET") === "GET") return res(200, alerts);
      if (opts.method === "PATCH") { patches.push({ url, body: JSON.parse(opts.body) }); return res(204, null); }
    }
    if (url.includes("/auth/v1/admin/users/") && (opts.method || "GET") === "GET") { const id = url.split("/").pop(); const known = Object.values(TOKENS).find(u => u.id === id); return res(200, { id, email: known ? known.email : "user-" + id.slice(0, 4) + "@example.com" }); }
    if (url.includes("/auth/v1/admin/users/")) return adminFails ? res(500, {}) : res(200, {});
  }
  if (url.startsWith("https://api.anthropic.com")) return aiReply ? res(200, { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(aiReply) }] }) : res(529, { error: "overloaded" });
  return res(404, {});
};

// A tiny stand-in for Supabase's database API, enough for the talent pool tables.
const TOKENS = {
  "good-token": { id: "11111111-2222-3333-4444-555555555555", email: "sam@example.com" },
  "cand2-token": { id: "22222222-2222-3333-4444-555555555555", email: "alex@example.com" },
  "emp-token": { id: "eeeeeeee-2222-3333-4444-555555555555", email: "hire@acme.com" }
};
let tables;
function tableCall(name, q, method, body, res) {
  const rows = tables[name];
  const match = (r) => [...q.entries()].every(([k, v]) => {
    if (["select", "order", "limit"].includes(k)) return true;
    const [op, ...rest] = v.split("."); const val = rest.join(".");
    if (op === "eq") return String(r[k]) === val;
    if (op === "in") return val.slice(1, -1).split(",").includes(String(r[k]));
    if (op === "gt") return String(r[k]) > val;
    return true;
  });
  if (method === "GET") return res(200, rows.filter(match));
  if (method === "POST") {
    const row = { id: crypto.randomUUID(), status: name === "contact_requests" || name === "employers" ? "pending" : undefined, created_at: new Date().toISOString(), ...body };
    if (name === "contact_requests" && rows.some(r => r.employer_id === row.employer_id && r.candidate_id === row.candidate_id)) return res(409, { code: "23505" });
    rows.push(row); return res(201, null);
  }
  if (method === "PATCH") { rows.filter(match).forEach(r => Object.assign(r, body)); return res(204, null); }
}

Object.assign(process.env, { SUPABASE_URL: SB, SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", KV_REST_API_URL: REDIS, KV_REST_API_TOKEN: "t", STATS_KEY: "s3cret-key", ANTHROPIC_API_KEY: "k", ADZUNA_APP_ID: "a", ADZUNA_APP_KEY: "b" });
const { default: handler } = await import("../api/app.js");

let ip = 0;
async function call(action, { method = "POST", auth, body = {}, query = {} } = {}) {
  const req = { method, query: { action, ...query }, headers: { authorization: auth, "x-forwarded-for": "203.0.113." + (ip++ % 250) }, body };
  let out = { status: 200 };
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { out = { status: this.statusCode, body: o }; return this; }, end() { out = { status: this.statusCode }; return this; }, send(b) { out = { status: this.statusCode, html: String(b), headers: this.headers }; return this; } };
  await handler(req, res);
  return out;
}

beforeEach(() => {
  calls = []; redisLog = []; emails = []; stored = {}; adminFails = false; supabaseDown = false; aiReply = null; alerts = []; patches = []; adzunaJobs = []; tables = { talent_profiles: [], employers: [], contact_requests: [], career_records: [] };
  delete process.env.RESEND_API_KEY; delete process.env.ALERT_EMAIL; delete process.env.CRON_SECRET;
});

test("unknown actions and wrong methods are refused", async () => {
  assert.equal((await call("nope")).status, 404);
  assert.equal((await call("deleteaccount", { method: "GET" })).status, 405);
  assert.equal((await call("jobs", { method: "POST" })).status, 405);
});

test("authconfig returns only the public address and key", async () => {
  const r = await call("authconfig", { method: "GET" });
  assert.deepEqual(r.body, { url: SB, anonKey: "anon" });
});

test("deleteaccount needs a valid sign-in", async () => {
  assert.equal((await call("deleteaccount")).status, 401);
  assert.equal((await call("deleteaccount", { auth: "Bearer bad-token" })).status, 401);
  assert.ok(!calls.some(c => c.startsWith("DELETE")), "nothing is deleted for a bad token");
});

test("deleteaccount removes the saved record, then the account", async () => {
  const r = await call("deleteaccount", { auth: "Bearer good-token" });
  assert.equal(r.status, 200);
  const deletes = calls.filter(c => c.startsWith("DELETE"));
  assert.match(deletes[0], /career_records\?user_id=eq\.11111111/);
  assert.match(deletes[1], /admin\/users\/11111111/);
});

test("deleteaccount explains when only the record could be deleted", async () => {
  adminFails = true;
  const r = await call("deleteaccount", { auth: "Bearer good-token" });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /hello@trazerr\.com/);
});

test("browser errors are stored without email addresses", async () => {
  const r = await call("clienterror", { body: { message: "TypeError: x for sam@example.com", source: "/assets/app.js:10:2", where: "page" } });
  assert.equal(r.status, 204);
  const entry = JSON.parse(stored["trazerr:errors"][0]);
  assert.equal(entry.where, "browser");
  assert.match(entry.message, /\[email\]/);
  assert.doesNotMatch(entry.message, /sam@example/);
  assert.equal(emails.length, 0, "browser errors don't send alerts");
});

test("a server failure is logged and emails one alert an hour", async () => {
  process.env.RESEND_API_KEY = "re_test"; process.env.ALERT_EMAIL = "owner@example.com";
  const body = { kind: "text", text: "x".repeat(200) };
  const first = await call("analyze", { body });
  assert.equal(first.status, 503);
  assert.match(first.body.error, /busy/);
  const entry = JSON.parse(stored["trazerr:errors"][0]);
  assert.equal(entry.action, "analyze");
  assert.match(entry.message, /Anthropic 529/);
  assert.equal(emails.length, 1);
  assert.deepEqual(emails[0].to, ["owner@example.com"]);
  await call("analyze", { body });
  assert.equal(emails.length, 1, "no second email within the hour");
  assert.equal(stored["trazerr:errors"].length, 2, "but the error is still logged");
});

test("visitor mistakes are not logged as errors", async () => {
  const r = await call("analyze", { body: { kind: "text", text: "too short" } });
  assert.equal(r.status, 400);
  assert.equal(stored["trazerr:errors"], undefined);
});

test("keepalive reads the database and records the time", async () => {
  const r = await call("keepalive", { method: "GET" });
  assert.equal(r.status, 200);
  assert.ok(calls.some(c => c.includes("/rest/v1/career_records?select=user_id&limit=1")));
  assert.ok(stored["trazerr:keepalive:last"]);
});

test("keepalive only runs for Vercel when CRON_SECRET is set", async () => {
  process.env.CRON_SECRET = "cron";
  assert.equal((await call("keepalive", { method: "GET" })).status, 401);
  assert.equal((await call("keepalive", { method: "GET", auth: "Bearer cron" })).status, 200);
});

test("keepalive failure is logged and alerts", async () => {
  process.env.RESEND_API_KEY = "re_test"; process.env.ALERT_EMAIL = "owner@example.com";
  supabaseDown = true;
  assert.equal((await call("keepalive", { method: "GET" })).status, 502);
  assert.match(JSON.parse(stored["trazerr:errors"][0]).message, /Keepalive: Supabase answered 503/);
  assert.equal(emails.length, 1);
});

test("stats needs the key and includes errors and the last keepalive", async () => {
  assert.equal((await call("stats", { method: "GET", query: { key: "wrong" } })).status, 404);
  stored["trazerr:errors"] = [JSON.stringify({ at: "2026-09-30T00:00:00Z", where: "server", action: "jobs", message: "m" })];
  stored["trazerr:keepalive:last"] = "2026-09-30T09:17:00Z";
  const r = await call("stats", { method: "GET", query: { key: "s3cret-key" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.recentErrors[0].action, "jobs");
  assert.equal(r.body.lastKeepalive, "2026-09-30T09:17:00Z");
});

test("health answers 200 when everything works, 503 naming what doesn't", async () => {
  const ok = await call("health", { method: "GET" });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.checks, { ai: true, storage: true, accounts: true });
  supabaseDown = true;
  const bad = await call("health", { method: "GET" });
  assert.equal(bad.status, 503);
  assert.equal(bad.body.checks.accounts, false);
});

test("the security rules allow every inline script and the services the site uses", async () => {
  const { readFileSync } = await import("node:fs");
  const { inlineHashes } = await import("./inline-hashes.mjs");
  const headers = Object.fromEntries(JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url))).headers[0].headers.map(h => [h.key, h.value]));
  const csp = headers["Content-Security-Policy"];
  for (const { file, hash } of inlineHashes()) assert.ok(csp.includes(hash), "An inline script in " + file + " changed. Add " + hash + " to script-src in vercel.json (run: node tests/inline-hashes.mjs)");
  for (const host of ["https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com", "https://fonts.gstatic.com", ".supabase.co"]) assert.ok(csp.includes(host), host);
  assert.match(csp, /frame-ancestors 'none'/);
  for (const k of ["Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]) assert.ok(headers[k], k);
});

test("a tailored resume is sorted newest first, keeps extra sections whole, and never cuts a word", async () => {
  const long = "Biochemistry, Biostatistics, Cellular Biology, Chemistry, Ecology, Endocrinology, Genetics, Human Anatomy and Physiology, Oceanography, Plant Biology, Toxicology, Pharmacology";
  aiReply = {
    name: "Alex Doe", contact: "alex@example.com", headline: "Lab research · Sales", summary: "Scientist with sales experience.",
    skills: ["Immunohistochemistry (IHC)", "Inventory management"],
    experience: [
      { title: "Sales Associate", company: "Shop", dates: "2024 – 2026", bullets: [{ text: "Sold products.", from: "sold" }] },
      { title: "Intern", company: "Farm", dates: "2023 – 2024", bullets: [{ text: "Maintained equipment.", from: "maintained" }] },
      { title: "Research Assistant", company: "University", dates: "2025 – Present", bullets: [{ text: "Ran experiments.", from: "ran" }] },
      { title: "Volunteer", company: "Library", dates: "", bullets: [{ text: "Helped readers.", from: "helped" }] }
    ],
    education: ["M.S. Pharmacology, 2026"],
    extras: [
      { heading: "Leadership", entries: [{ title: "Team Captain, Basketball", dates: "2020 – 2024", bullets: ["Named team MVP."] }, { title: "Club Member", dates: "2025 – 2026", bullets: ["Planned events."] }] },
      { heading: "Coursework", items: [long + ", " + long + ", " + long] }
    ],
    blanks: [], changes: ["Put research first."], fitBefore: 50, fitAfter: 60
  };
  const r = await call("tailor", { body: { stage: "build", role: "Medical device sales", resume: { kind: "text", text: "Alex Doe Sales Associate Shop Intern Farm Research Assistant University Volunteer Library " + "x".repeat(100) } } });
  assert.equal(r.status, 200);
  const x = r.body.resume;
  assert.deepEqual(x.experience.map(j => j.title), ["Research Assistant", "Sales Associate", "Intern", "Volunteer"]);
  assert.deepEqual(x.extras[0].entries.map(e => e.title), ["Club Member", "Team Captain, Basketball"]);
  assert.deepEqual(x.extras[0].entries[1].bullets, ["Named team MVP."]);
  const item = x.extras[1].items[0];
  assert.ok(item.length <= 401 && item.endsWith("…"), "long item shortened with an ellipsis");
  const lastWord = item.slice(0, -1).split(/[ ,]+/).pop();
  assert.ok(long.split(/[ ,]+/).includes(lastWord), "ends on a whole word, not '" + lastWord + "'");
});

const U1 = "aaaaaaaa-1111-2222-3333-444444444444", U2 = "bbbbbbbb-1111-2222-3333-444444444444";
const az = (id, title) => ({ id, title, company: { display_name: "Acme" }, location: { display_name: "Newark, NJ" }, redirect_url: "https://example.com/" + id, created: new Date().toISOString(), description: "Lead a team." });

test("job alerts: one email per person with only new jobs, and every alert marked as checked", async () => {
  process.env.RESEND_API_KEY = "re_test";
  adzunaJobs = [az(1, "Shift Supervisor"), az(2, "Warehouse Lead"), az(3, "Operations Supervisor")];
  alerts = [
    { id: "a1", user_id: U1, query: "supervisor", location: "Newark, NJ", remote: false, seen: ["az-1"], last_sent: null },
    { id: "a2", user_id: U1, query: "warehouse lead", location: "", remote: false, seen: ["az-1", "az-2", "az-3"], last_sent: null },
    { id: "a3", user_id: U2, query: "lead", location: "Trenton", remote: false, seen: ["az-1", "az-2", "az-3"], last_sent: null }
  ];
  const r = await call("sendalerts", { method: "GET" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { people: 2, emails: 1, jobs: 2, failed: 0 });
  assert.equal(emails.length, 1, "no email for someone with nothing new");
  const e = emails[0];
  assert.deepEqual(e.to, ["user-aaaa@example.com"]);
  assert.match(e.subject, /^2 new jobs for supervisor near Newark, NJ/);
  assert.ok(!e.html.includes("Shift Supervisor"), "a job already sent isn't sent again");
  assert.ok(e.html.includes("Warehouse Lead") && e.html.includes("Operations Supervisor"));
  assert.match(e.headers["List-Unsubscribe"], /action=unsubscribe&u=aaaaaaaa-1111-2222-3333-444444444444&t=/);
  assert.equal(e.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(e.text, /q=supervisor&where=Newark%2C\+NJ&src=alert#jobs/);
  assert.equal(patches.length, 3, "all three alerts are marked as checked");
  const a1 = patches.find(p => p.url.includes("id=eq.a1")).body;
  assert.deepEqual(a1.seen.slice(0, 2), ["az-2", "az-3"]);
  assert.ok(a1.seen.includes("az-1") && a1.last_sent);
});

test("job alerts need email switched on, and only Vercel can run them when CRON_SECRET is set", async () => {
  assert.equal((await call("sendalerts", { method: "GET" })).status, 503);
  process.env.RESEND_API_KEY = "re_test"; process.env.CRON_SECRET = "cron";
  assert.equal((await call("sendalerts", { method: "GET" })).status, 401);
  assert.equal((await call("sendalerts", { method: "GET", auth: "Bearer cron" })).status, 200);
});

test("unsubscribe links are signed; opening one asks first, pressing the button stops the alerts", async () => {
  process.env.RESEND_API_KEY = "re_test";
  adzunaJobs = [az(9, "Lead")];
  alerts = [{ id: "a1", user_id: U1, query: "lead", location: "", remote: false, seen: [], last_sent: null }];
  await call("sendalerts", { method: "GET" });
  const link = new URL(emails[0].headers["List-Unsubscribe"].slice(1, -1));
  const q = { u: link.searchParams.get("u"), t: link.searchParams.get("t") };
  patches = [];
  const look = await call("unsubscribe", { method: "GET", query: q });
  assert.equal(look.status, 200);
  assert.match(look.html, /<form method="post">/);
  assert.equal(patches.length, 0, "just opening the link changes nothing");
  const stop = await call("unsubscribe", { method: "POST", query: q });
  assert.match(stop.html, /Job alerts stopped/);
  assert.equal(patches.length, 1);
  assert.match(patches[0].url, /job_alerts\?user_id=eq\.aaaaaaaa/);
  assert.deepEqual(patches[0].body, { active: false });
  const forged = await call("unsubscribe", { method: "POST", query: { u: U2, t: q.t } });
  assert.equal(forged.status, 400);
  assert.equal(patches.length, 1, "someone else's link can't be forged");
});

const CAND = TOKENS["good-token"], CAND2 = TOKENS["cand2-token"], EMP = TOKENS["emp-token"];
const talentRow = (u, headline, extra = {}) => ({ user_id: u.id, public_id: crypto.randomUUID(), visible: true, location: "Newark, NJ", remote_ok: false, updated_at: new Date().toISOString(),
  profile: { headline, summary: "", experience: "About 5 years", education: "", strengths: [{ name: "Team leadership", evidence: "Led a team of 9" }], roles: ["Operations supervisor"], skills: ["Scheduling"] }, ...extra });

test("the anonymous profile removes the person's name, email, phone and links", async () => {
  assert.equal((await call("talentdraft", { body: { profile: { headline: "x" } } })).status, 401);
  aiReply = { headline: "Sam Rivera: warehouse lead who trains teams", summary: "Reach Sam at sam@example.com or (802) 373-1573, www.sam.dev. Led teams 2019 - 2024.", experience: "About 6 years", education: "",
    strengths: [{ name: "Team leadership", evidence: "Rivera led a team of 9" }], roles: ["Operations supervisor"], skills: ["Scheduling"] };
  const r = await call("talentdraft", { auth: "Bearer good-token", body: { profile: { fullName: "Sam Rivera", firstName: "Sam", headline: "A warehouse lead." } } });
  assert.equal(r.status, 200);
  const text = JSON.stringify(r.body.profile);
  for (const bad of ["Sam", "Rivera", "sam@example.com", "373-1573", "www.sam.dev"]) assert.ok(!text.includes(bad), "removed: " + bad);
  assert.match(r.body.profile.summary, /2019 - 2024/, "dates are kept");
});

test("employers must be approved before they can search; approval emails them", async () => {
  process.env.RESEND_API_KEY = "re_test"; process.env.ALERT_EMAIL = "owner@example.com";
  const join = await call("employerjoin", { auth: "Bearer emp-token", body: { company: "Acme Logistics", contactName: "Pat Lee", website: "acme.com" } });
  assert.deepEqual(join.body, { status: "pending" });
  assert.equal(emails.length, 1); assert.deepEqual(emails[0].to, ["owner@example.com"]); assert.match(emails[0].subject, /Acme Logistics/);
  assert.equal((await call("searchtalent", { auth: "Bearer emp-token", body: { title: "Supervisor" } })).status, 403);
  assert.equal((await call("adminemployers", { method: "GET", query: { key: "wrong" } })).status, 404);
  const list = await call("adminemployers", { method: "GET", query: { key: "s3cret-key" } });
  assert.equal(list.body.employers[0].email, "hire@acme.com");
  const ok = await call("adminemployers", { method: "POST", query: { key: "s3cret-key" }, body: { userId: EMP.id, decision: "approved" } });
  assert.equal(ok.status, 200);
  assert.equal(tables.employers[0].status, "approved");
  assert.deepEqual(emails[1].to, ["hire@acme.com"]); assert.match(emails[1].subject, /now find candidates/);
});

test("search ranks visible candidates only, and never reveals who they are", async () => {
  tables.employers.push({ user_id: EMP.id, company: "Acme", contact_name: "Pat Lee", website: "", job_title: "", status: "approved" });
  tables.talent_profiles.push(talentRow(CAND, "Warehouse lead who trains teams"), talentRow(CAND2, "Retail supervisor"), talentRow({ id: "33333333-2222-3333-4444-555555555555" }, "Hidden person", { visible: false }));
  aiReply = { results: [{ n: 1, score: 64, why: ["Leads a team"], gap: "No budget shown" }, { n: 2, score: 88, why: ["Led a team of 9"], gap: "" }] };
  const r = await call("searchtalent", { auth: "Bearer emp-token", body: { title: "Operations supervisor", location: "Newark, NJ" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.poolSize, 2);
  assert.deepEqual(r.body.candidates.map(c => c.score), [88, 64]);
  const text = JSON.stringify(r.body);
  for (const id of [CAND.id, CAND2.id, "33333333"]) assert.ok(!text.includes(id), "account ids stay private");
  assert.ok(!text.includes("Hidden person"));
  assert.ok(!text.includes("@example.com"));
});

test("contact requests: anonymous until the candidate accepts, then both get each other's details", async () => {
  process.env.RESEND_API_KEY = "re_test";
  tables.employers.push({ user_id: EMP.id, company: "Acme", contact_name: "Pat Lee", website: "acme.com", job_title: "", status: "approved" });
  const tp = talentRow(CAND, "Warehouse lead"); tables.talent_profiles.push(tp);
  tables.career_records.push({ user_id: CAND.id, career_dna: { fullName: "Sam Rivera" } });
  const sent = await call("contactrequest", { auth: "Bearer emp-token", body: { candidate: tp.public_id, jobTitle: "Shift supervisor", message: "We'd love to talk." } });
  assert.equal(sent.status, 200);
  assert.deepEqual(emails[0].to, ["sam@example.com"]); assert.match(emails[0].subject, /Acme would like to talk to you/);
  assert.ok(!emails[0].text.includes("hire@acme.com"), "the employer's email isn't shared before accepting");
  assert.equal((await call("contactrequest", { auth: "Bearer emp-token", body: { candidate: tp.public_id, jobTitle: "Shift supervisor" } })).status, 409);

  const before = await call("employerme", { auth: "Bearer emp-token" });
  assert.equal(before.body.requests[0].status, "pending");
  assert.equal(before.body.requests[0].email, undefined); assert.equal(before.body.requests[0].name, undefined);
  const mine = await call("myrequests", { auth: "Bearer good-token" });
  assert.equal(mine.body.requests[0].company, "Acme"); assert.equal(mine.body.requests[0].email, undefined);

  const id = mine.body.requests[0].id;
  assert.equal((await call("respondrequest", { auth: "Bearer cand2-token", body: { id, accept: true } })).status, 404, "only the candidate can answer");
  const yes = await call("respondrequest", { auth: "Bearer good-token", body: { id, accept: true } });
  assert.deepEqual(yes.body, { status: "accepted" });
  const toEmp = emails.find(e => e.to[0] === "hire@acme.com"), toCand = emails.filter(e => e.to[0] === "sam@example.com")[1];
  assert.match(toEmp.text, /Sam Rivera accepted/); assert.match(toEmp.text, /sam@example\.com/);
  assert.match(toCand.text, /Pat Lee, hire@acme\.com/);
  const after = await call("employerme", { auth: "Bearer emp-token" });
  assert.equal(after.body.requests[0].email, "sam@example.com"); assert.equal(after.body.requests[0].name, "Sam Rivera");
});
