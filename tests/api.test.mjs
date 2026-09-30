// Tests for the server function (api/app.js), with every outside service replaced by a fake.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const SB = "https://mock.supabase.test", REDIS = "https://mock.redis.test";
let calls, redisLog, adminFails, supabaseDown, emails, stored;

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
      return { result: 1 };
    }));
  }
  if (url === "https://api.resend.com/emails") { emails.push(JSON.parse(opts.body)); return res(200, { id: "e1" }); }
  if (url.startsWith(SB)) {
    if (supabaseDown) return res(503, {});
    if (url.endsWith("/auth/v1/user")) return h.Authorization === "Bearer good-token" ? res(200, { id: "11111111-2222-3333-4444-555555555555" }) : res(401, {});
    if (url.includes("/rest/v1/career_records")) return res(opts.method === "DELETE" ? 204 : 200, []);
    if (url.includes("/auth/v1/admin/users/")) return adminFails ? res(500, {}) : res(200, {});
  }
  if (url.startsWith("https://api.anthropic.com")) return res(529, { error: "overloaded" });
  return res(404, {});
};

Object.assign(process.env, { SUPABASE_URL: SB, SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", KV_REST_API_URL: REDIS, KV_REST_API_TOKEN: "t", STATS_KEY: "s3cret-key", ANTHROPIC_API_KEY: "k" });
const { default: handler } = await import("../api/app.js");

let ip = 0;
async function call(action, { method = "POST", auth, body = {}, query = {} } = {}) {
  const req = { method, query: { action, ...query }, headers: { authorization: auth, "x-forwarded-for": "203.0.113." + (ip++ % 250) }, body };
  let out = { status: 200 };
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { out = { status: this.statusCode, body: o }; return this; }, end() { out = { status: this.statusCode }; return this; } };
  await handler(req, res);
  return out;
}

beforeEach(() => {
  calls = []; redisLog = []; emails = []; stored = {}; adminFails = false; supabaseDown = false;
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
