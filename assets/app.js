/* Trazerr front end: forms, results, tools, animations and accounts. Loaded at the end of index.html. */
const API = "/api/app";
const STORE_KEY = "trazerr.profile.v3";
const RESUME_KEY = "trazerr.resume.v1";
let resumeSrc = null; // the resume behind the current Career DNA, needed for Tailor my DNA
const $ = (id) => document.getElementById(id);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let picked = null;
let profile = null;
let jobState = { q: "", where: "", remote: false, page: 1, list: [] };
let lastFocus = null;

/* ---------- utilities ---------- */
function esc(s){ return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function setStatus(el, msg, isErr){
  el.textContent = msg || "";
  el.classList.toggle("err", !!isErr);
  if(isErr){ el.setAttribute("role", "alert"); el.setAttribute("aria-live", "assertive"); el.setAttribute("aria-atomic", "true"); }
  else { el.setAttribute("aria-live", "polite"); el.removeAttribute("aria-atomic"); }
}
function toScore(v){
  const n = typeof v === "number" ? v : parseFloat((String(v ?? "").match(/\d+(\.\d+)?/) || [""])[0]);
  return isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
}
const arr = (v) => Array.isArray(v) ? v : [];
function safeUrl(u){ try { const x = new URL(u); return (x.protocol === "https:" || x.protocol === "http:") ? x.href : "#"; } catch(e){ return "#"; } }
function ago(d){
  const t = Date.parse(d); if (!t) return "";
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return "Today"; if (days === 1) return "Yesterday";
  if (days < 30) return days + " days ago";
  const m = Math.floor(days / 30); return m === 1 ? "1 month ago" : m + " months ago";
}
function snippet(t, n){ t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n).replace(/\s\S*$/, "") + "…" : t; }

// Anonymous usage counts (event name only). See the privacy section.
function track(e){
  try {
    const body = JSON.stringify({ e });
    if (navigator.sendBeacon) navigator.sendBeacon(API + "?action=track", new Blob([body], { type: "application/json" }));
    else fetch(API + "?action=track", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
  } catch (err) {}
}

// Errors in this page's own code are reported (message and line only, at most 5 per visit), so problems
// visitors hit show up on the usage page. Errors from browser extensions and other sites are ignored.
(function reportErrors(){
  let sent = 0; const seen = new Set();
  function report(message, source){
    message = String(message || "").slice(0, 300);
    if (!message || sent >= 5 || seen.has(message)) return;
    seen.add(message); sent++;
    try { fetch(API + "?action=clienterror", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, source, where: "page" }), keepalive: true }).catch(() => {}); } catch (e) {}
  }
  const ours = (file) => !file || file.startsWith(location.origin + "/");
  window.addEventListener("error", e => {
    if (!e.message || !ours(e.filename)) return;
    report(e.message, (e.filename || "").replace(location.origin, "") + ":" + e.lineno + ":" + e.colno);
  });
  // Something the security rules blocked (vercel.json): usually a sign a rule needs updating.
  document.addEventListener("securitypolicyviolation", e => report("Blocked by security rules: " + e.effectiveDirective + " " + String(e.blockedURI || "").slice(0, 120), (e.sourceFile || "").replace(location.origin, "") + ":" + e.lineNumber));
  window.addEventListener("unhandledrejection", e => {
    const r = e.reason, stack = String(r && r.stack || "");
    if (stack && !stack.includes(location.origin + "/")) return;
    report("Unhandled: " + (r && r.message || r), (stack.match(/\/assets\/[^\s)]+/) || [""])[0]);
  });
})();

async function api(action, opts){
  opts = opts || {};
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  let url = API + "?action=" + action;
  if (opts.query) url += "&" + new URLSearchParams(opts.query).toString();
  try {
    const r = await fetch(url, opts.body
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts.body), signal: ctrl.signal }
      : { method: "GET", signal: ctrl.signal });
    let data = {};
    try { data = await r.json(); } catch(e) {}
    if (!r.ok) throw new Error(data.error || (r.status === 404 ? "This feature isn't available right now." : r.status === 504 ? "That took too long. Please try again." : "Something went wrong. Try again in a moment."));
    return data;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("That took too long. Please try again.");
    if (e instanceof TypeError) throw new Error("Couldn't connect. Check your internet connection and try again.");
    throw e;
  } finally { clearTimeout(timer); }
}

function normalize(p){
  p = p || {};
  return {
    fullName: String(p.fullName || "").trim(),
    firstName: String(p.firstName || String(p.fullName || "").split(" ")[0] || "").trim(),
    headline: String(p.headline || "").trim(),
    experience: String(p.experience || "").trim(),
    stage: String(p.stage || "").trim(),
    location: String(p.location || "").trim(),
    evidenceScore: toScore(p.evidenceScore),
    scoreNote: String(p.scoreNote || "").trim(),
    strengths: arr(p.strengths).filter(s => s && s.name),
    hiddenTalent: arr(p.hiddenTalent).filter(s => s && s.title),
    directions: arr(p.directions).filter(s => s && s.role),
    unknowns: arr(p.unknowns).map(u => typeof u === "string" ? { what: u, how: "", example: "" } : { what: String(u?.what || ""), how: String(u?.how || ""), example: String(u?.example || "") }).filter(u => u.what),
    isExample: !!p.isExample
  };
}

/* ---------- saved profile ---------- */
function loadSaved(){ try { const raw = localStorage.getItem(STORE_KEY); return raw ? normalize(JSON.parse(raw)) : null; } catch(e){ return null; } }
function saveProfile(p){ try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); return true; } catch(e){ return false; } }
function removeProfile(){ try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(RESUME_KEY); } catch(e){} }
function loadResume(){ try { const r = localStorage.getItem(RESUME_KEY); return r ? JSON.parse(r) : null; } catch(e){ return null; } }
function saveResume(r){ try { localStorage.setItem(RESUME_KEY, JSON.stringify(r)); } catch(e){} } // a large PDF may not fit; that's fine
function isSaved(){ return !!loadSaved(); }

function setProfile(p){
  profile = p;
  refreshProfileUI();
}
// Job search looks near where the person lives, taken from their resume. It only fills an empty box
// or one it filled before, so a location the person typed themselves is never overwritten.
function cleanLocation(s){ return String(s || "").replace(/,?\s*(United States( of America)?|U\.?S\.?A?\.?)\s*$/i, "").trim(); }
function applyHomeLocation(p){
  const jw = $("jw"), loc = cleanLocation(p && !p.isExample ? p.location : "");
  if (loc && (!jw.value.trim() || jw.dataset.auto === "1")) { jw.value = loc; jw.dataset.auto = "1"; }
  $("jwNoteText").textContent = loc;
  $("jwNote").hidden = !loc || jw.value !== loc;
  return loc;
}
function refreshProfileUI(){
  const box = $("welcome");
  const saved = loadSaved();
  if (saved) {
    box.innerHTML = "<span>Welcome back" + (saved.firstName ? ", " + esc(saved.firstName) : "") + '. Your Career DNA is saved.</span><span class="welcome-actions"><button class="btn btn-primary btn-sm" type="button" id="openSaved">Open it</button><button class="btn btn-ghost btn-sm" type="button" id="welcomeTailor">Tailor it</button></span>';
    box.hidden = false;
    $("openSaved").onclick = () => showProfile(saved);
    $("welcomeTailor").onclick = () => openTailor(saved, {});
  } else box.hidden = true;
  $("homeTailor").textContent = saved || (profile && !profile.isExample) ? "Tailor my resume" : "Build my Career DNA first";
  $("homeTailorHint").textContent = saved || (profile && !profile.isExample) ? "" : "It takes about 20 seconds, then you can tailor for any role.";

  const real = profile && !profile.isExample ? profile : null;
  const chips = $("chips");
  if (real && real.directions.length) {
    chips.innerHTML = "<small>From your Career DNA:</small>" + real.directions.map((d, i) => '<button class="chip" type="button" data-chip="' + i + '">' + esc(d.role) + "</button>").join("");
    chips.hidden = false;
    chips.querySelectorAll("[data-chip]").forEach(b => b.onclick = () => {
      const d = real.directions[+b.dataset.chip];
      $("jq").value = d.role;
      applyHomeLocation(real);
      runJobSearch(true);
    });
  } else chips.hidden = true;
  $("postingFitBtn").hidden = !real;
  applyHomeLocation(real);
}

/* ---------- overlay ---------- */
// The results screen gets its own browser history entry, so the phone's Back button closes it
// instead of leaving the site.
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
if (history.state && history.state.trzOverlay) history.replaceState(null, "");
let overlayInHistory = false, ignoreNextPop = false;
window.addEventListener("popstate", () => {
  if (ignoreNextPop) { ignoreNextPop = false; return; }
  if ($("overlay").classList.contains("open")) { overlayInHistory = false; hideOverlay(); }
});
function openOverlay(title, html){
  if (!$("overlay").classList.contains("open")) {
    lastFocus = document.activeElement;
    if (!overlayInHistory) { history.pushState({ trzOverlay: 1 }, ""); overlayInHistory = true; }
  }
  $("oTitle").textContent = title;
  $("oBody").innerHTML = html;
  const o = $("overlay");
  o.classList.add("open"); o.scrollTop = 0;
  document.body.style.overflow = "hidden";
  $("closeBtn").focus();
}
function hideOverlay(){
  $("overlay").classList.remove("open");
  document.body.style.overflow = "";
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}
function closeOverlay(){
  hideOverlay();
  if (overlayInHistory) { overlayInHistory = false; ignoreNextPop = true; history.back(); }
}
// Optional steps advance every few seconds with a progress bar, so a long wait feels like progress.
let loadTimer = null;
function loadingHTML(msg, steps){
  clearInterval(loadTimer);
  if (!steps || !steps.length) return '<div class="loading" aria-busy="true"><div class="spinner" aria-hidden="true"></div><p id="loadMsg">' + esc(msg) + "</p></div>";
  let i = 0;
  loadTimer = setInterval(() => {
    const m = $("loadMsg"), bar = $("loadBar");
    if (!m || !bar) { clearInterval(loadTimer); return; }
    i = Math.min(i + 1, steps.length - 1);
    m.textContent = steps[i]; bar.style.width = Math.round((i + 1) / (steps.length + 1) * 100) + "%";
    if (i === steps.length - 1) clearInterval(loadTimer);
  }, 5000);
  return '<div class="loading" aria-busy="true"><div class="spinner" aria-hidden="true"></div><p id="loadMsg">' + esc(steps[0]) + '</p><div class="progress" aria-hidden="true"><i id="loadBar" style="width:' + Math.round(100 / (steps.length + 1)) + '%"></i></div></div>';
}
function errorHTML(msg, retryLabel){ return '<div class="loading"><p style="color:var(--err)">' + esc(msg) + '</p><div class="o-foot" style="justify-content:center"><button class="btn btn-quiet" type="button" data-close>Close</button>' + (retryLabel ? '<button class="btn btn-primary" type="button" id="retryBtn">' + esc(retryLabel) + "</button>" : "") + "</div></div>"; }
$("closeBtn").addEventListener("click", closeOverlay);
$("oBody").addEventListener("click", e => { if (e.target.closest("[data-close]")) closeOverlay(); });
document.addEventListener("keydown", e => {
  const o = $("overlay");
  if (!o.classList.contains("open")) return;
  if (e.key === "Escape") { closeOverlay(); return; }
  if (e.key !== "Tab") return;
  const f = [...o.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),textarea,select,[tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

function ringHTML(id, value){
  const known = value !== null && value !== undefined;
  return '<div class="ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="track" cx="60" cy="60" r="52"/><circle class="val" id="' + id + 'Val" cx="60" cy="60" r="52" stroke-dasharray="326.73" stroke-dashoffset="326.73"/></svg><output id="' + id + 'Num">' + (known ? (reduceMotion ? value : 0) : "–") + "</output></div>";
}
function animateRing(id, target){
  if (target === null || target === undefined) return;
  const ring = $(id + "Val"), num = $(id + "Num"), C = 326.73;
  if (!ring || !num) return;
  const finish = () => { num.textContent = target; ring.style.strokeDashoffset = C * (1 - target / 100); };
  if (reduceMotion) { ring.style.transition = "none"; finish(); return; }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ring.style.strokeDashoffset = C * (1 - target / 100);
    const start = performance.now(), dur = 1100;
    const step = (t) => { const k = Math.min(1, (t - start) / dur); num.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); else finish(); };
    requestAnimationFrame(step);
  }));
  setTimeout(finish, 1600);
}

/* ---------- resume input ---------- */
function readAsBase64(file){
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(new Error("read")); r.readAsDataURL(file); });
}
// Outside libraries load with a fingerprint (integrity), so the browser refuses a file that was changed.
function loadScript(src, integrity){
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; if (integrity) { s.integrity = integrity; s.crossOrigin = "anonymous"; } s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
// Reads a resume file into what the server expects. Throws an Error with a readable message.
async function readResumeFile(file){
  const name = file.name || "resume";
  const ext = name.toLowerCase().split(".").pop();
  if (file.size > 3 * 1024 * 1024) throw new Error("That file is over 3 MB. Try a smaller PDF or paste the text instead.");
  let out;
  try {
    if (ext === "pdf" || file.type === "application/pdf") out = { kind: "pdf", data: await readAsBase64(file) };
    else if (ext === "docx") {
      if (!window.mammoth) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js", "sha384-nFoSjZIoH3CCp8W639jJyQkuPHinJ2NHe7on1xvlUA7SuGfJAfvMldrsoAVm6ECz");
      out = { kind: "text", text: (await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value };
    } else if (ext === "txt" || file.type === "text/plain") out = { kind: "text", text: await file.text() };
  } catch (e) { throw new Error("That file couldn't be read. Try saving it as a PDF, or paste the text instead."); }
  if (!out) throw new Error("That file type isn't supported. Use a PDF, a Word .docx file or a .txt file.");
  if (out.kind === "text" && out.text.trim().length < 80) throw new Error("That file doesn't contain enough readable text. Try a PDF or paste the text instead.");
  return out;
}
async function handleFile(file){
  const status = $("status");
  if (!file) return;
  try {
    picked = await readResumeFile(file);
    $("fileName").textContent = file.name || "resume"; $("fileName").hidden = false;
    track("resume_file");
    setStatus(status, "");
  } catch (e) { picked = null; setStatus(status, e.message, true); }
}
const drop = $("drop");
$("file").addEventListener("change", e => handleFile(e.target.files[0]));
["dragenter","dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave","drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => handleFile(e.dataTransfer.files[0]));

const STEPS = ["Step 1 of 4 · Reading your resume…", "Step 2 of 4 · Finding the evidence…", "Step 3 of 4 · Looking for hidden talent…", "Step 4 of 4 · Writing your Career DNA…"];
$("analyzeBtn").addEventListener("click", async () => {
  const btn = $("analyzeBtn"), status = $("status");
  const pasted = $("paste").value.trim();
  let payload = null;
  if (picked) payload = picked;
  else if (pasted.length >= 80) payload = { kind: "text", text: pasted };
  if (!payload) { setStatus(status, "Choose a resume file or paste at least a few lines of your resume.", true); return; }
  btn.disabled = true; track("dna_started");
  const label = btn.textContent; btn.textContent = "Building…";
  const prog = $("heroProg"), bar = $("heroBar"); prog.hidden = false; bar.style.width = "8%";
  window.Seqlay?.start(payload);
  let i = 0; setStatus(status, STEPS[0]);
  // The bar creeps toward 92% over about 30 seconds, then jumps to full when the result arrives.
  const started = Date.now();
  const ticker = setInterval(() => {
    const t = (Date.now() - started) / 1000;
    i = Math.min(Math.floor(t / 5.5), STEPS.length - 1); setStatus(status, STEPS[i]);
    bar.style.width = Math.min(92, 8 + t * 2.8) + "%";
    window.Seqlay?.step(STEPS[i], Math.min(92, 8 + t * 2.8));
  }, 500);
  try {
    const data = await api("analyze", { body: payload });
    const p = normalize(data.profile);
    if (!p.headline) throw new Error("The analysis came back incomplete. Try again, or paste the text instead.");
    resumeSrc = payload;
    if ($("saveLocal").checked) { saveProfile(p); saveResume(payload); }
    setProfile(p);
    setStatus(status, "");
    track("dna_built");
    showProfile(p);
    window.Seqlay?.finish(true);
    if (applyHomeLocation(p) && p.directions.length && !$("jq").value.trim()) { $("jq").value = p.directions[0].role; runJobSearch(true); }
  } catch (e) {
    track("dna_failed");
    window.Seqlay?.finish(false);
    setStatus(status, e.message, true);
  } finally { clearInterval(ticker); btn.disabled = false; btn.textContent = label; bar.style.width = "100%"; setTimeout(() => { prog.hidden = true; bar.style.width = "0"; }, 400); }
});

$("homeTailor").addEventListener("click", () => {
  const p = profile && !profile.isExample ? profile : loadSaved();
  if (p) openTailor(p, {});
  else { $("try").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" }); $("drop").focus({ preventScroll: true }); }
});

$("jw").addEventListener("input", () => { delete $("jw").dataset.auto; $("jwNote").hidden = true; });
$("jwChange").addEventListener("click", () => { const jw = $("jw"); delete jw.dataset.auto; $("jwNote").hidden = true; jw.select(); jw.focus(); });

/* ---------- example ---------- */
const EXAMPLE = {
  isExample: true, fullName: "Dana Whitfield", firstName: "Dana", location: "Newark, NJ",
  headline: "A sales representative whose record shows territory building, team training and consistent over-performance, closer to a sales leader than the title suggests.",
  experience: "7 years in B2B sales", stage: "Ready for a senior or first leadership role",
  evidenceScore: 78,
  scoreNote: "Adding deal sizes and the number of accounts you managed would make this stronger.",
  strengths: [
    { name: "Territory development", level: "verified", evidence: "Opened the Northeast territory and grew it to 60 active accounts." },
    { name: "Quota performance", level: "verified", evidence: "Reached 118% of annual quota in 2023 and 2024." },
    { name: "Training and onboarding", level: "verified", evidence: "Trained four new sales hires in their first 90 days." },
    { name: "Negotiation", level: "inferred", evidence: "Based on renewal and pricing work described across two roles." },
    { name: "Early team leadership", level: "inferred", evidence: "Based on training new hires and covering for the regional manager." }
  ],
  hiddenTalent: [{ title: "You may be under-labeling yourself as a leader", why: "Training people, covering for your manager and building a territory are leadership work, even without the title.", evidence: "Covered regional manager duties during a 3-month leave." }],
  directions: [
    { role: "Sales team lead", why: "Your training record and quota history are the two things hiring managers look for first.", gap: "Show a result from a team you guided, not just your own numbers." },
    { role: "Sales enablement specialist", why: "You already onboard new hires and build their habits.", gap: "Add any training materials or playbooks you created." }
  ],
  unknowns: [
    { what: "Deal sizes", how: "Say how big your typical deals or contracts were, and your largest one.", example: "Closed deals averaging [average deal size], including a [largest deal] contract with [client or industry]." },
    { what: "Budget ownership", how: "If you managed any budget, name what it covered and how much it was.", example: "Managed a [budget amount] annual budget for [what it covered] in the Northeast territory." },
    { what: "Sales tools", how: "List the CRM and forecasting tools you use day to day.", example: "Tracked the Northeast pipeline in [CRM name] and built monthly forecasts in [tool]." }
  ]
};
$("exampleBtn").addEventListener("click", () => { track("example_viewed"); showProfile(normalize(EXAMPLE)); });
$("exampleBtn2").addEventListener("click", () => $("exampleBtn").click());

/* ---------- Career DNA view ---------- */
function greeting(){ const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }

function showProfile(p){
  const ex = p.isExample;
  let h = '<div class="o-hero">';
  if (ex) h += '<span class="flag">Example profile. Build your own to see yours.</span>';
  h += '<p class="greet">' + greeting() + (p.firstName && !ex ? ", " + esc(p.firstName) : "") + ". Here is what " + (ex ? "this resume" : "your resume") + " shows.</p>";
  h += '<h2 class="o-headline">' + esc(p.headline) + "</h2>";
  const factsHTML = (p.experience || p.stage) ? '<div class="facts"><div><small>Experience</small><b>' + esc(p.experience || "Not stated") + '</b></div><div><small>Career stage</small><b>' + esc(p.stage || "Not stated") + "</b></div></div>" : "";
  const ver = p.strengths.filter(s => s.level !== "inferred").length, inf = p.strengths.length - ver;
  const tally = [ver ? '<span><i class="mark verified" aria-hidden="true"></i>' + ver + " on your resume</span>" : "", inf ? '<span><i class="mark inferred" aria-hidden="true"></i>' + inf + " between the lines</span>" : "", p.directions.length ? '<span><i class="mark potential" aria-hidden="true"></i>' + p.directions.length + (p.directions.length === 1 ? " direction" : " directions") + "</span>" : ""].join("");
  h += '<div class="dna-band"><canvas id="dnaCanvas" width="1360" height="300" aria-hidden="true"></canvas><div class="tally">' + tally + "</div></div></div>";
  h += factsHTML;
  h += '<div class="score">' + ringHTML("ev", p.evidenceScore) + '<div><h3>Clarity score</h3><p>How clearly your resume shows what you\'ve done, out of 100. We take your resume at its word. This is about the writing, not about you.</p>' + (p.scoreNote ? '<p class="tip">' + esc(p.scoreNote) + "</p>" : "") + "</div></div>";
  if (!ex) {
    h += '<div class="o-sec"><h3>What to do next</h3><div class="next-grid">';
    h += '<button type="button" class="primary" id="nxTailor"><b>Tailor my DNA</b><span>Reshape your resume for a role you want, using only your real evidence.</span></button>';
    const near = cleanLocation(p.location);
    if (p.directions.length) h += '<button type="button" data-findjobs="0"><b>Find jobs that fit</b><span>Live openings for ' + esc(p.directions[0].role) + (near ? " near " + esc(near) : "") + ", with a fit check for each.</span></button>";
    h += '<button type="button" id="nxPath"><b>Plan a path</b><span>Map the steps from where you are to a bigger goal.</span></button>';
    h += "</div></div>";
  }

  if (p.strengths.length) {
    h += '<div class="o-sec"><h3>Strengths</h3><div class="legend"><span><i class="mark verified"></i>On your resume</span><span><i class="mark inferred"></i>Between the lines</span></div><ul class="items">';
    p.strengths.forEach(s => { const lvl = s.level === "inferred" ? "inferred" : "verified";
      h += '<li><i class="mark ' + lvl + '" aria-hidden="true"></i><b>' + esc(s.name) + '</b><span class="lvl">' + (lvl === "inferred" ? "Between the lines" : "On your resume") + "</span>" + (s.evidence ? '<span class="ev">' + esc(s.evidence) + "</span>" : "") + "</li>"; });
    h += "</ul></div>";
  }
  if (p.hiddenTalent.length) {
    h += '<div class="o-sec"><h3>Hidden talent</h3><p class="hint">Strengths your experience shows that your resume doesn\'t say out loud.</p><ul class="items">';
    p.hiddenTalent.forEach(t => { h += '<li><i class="mark inferred" aria-hidden="true"></i><b>' + esc(t.title) + '</b><span class="why">' + esc(t.why) + "</span>" + (t.evidence ? '<span class="ev">' + esc(t.evidence) + "</span>" : "") + "</li>"; });
    h += "</ul></div>";
  }
  if (p.directions.length) {
    h += '<div class="o-sec"><h3>Directions worth exploring</h3><p class="hint">Suggestions based on your experience.</p><ul class="items">';
    p.directions.forEach((d, i) => { h += '<li><i class="mark potential" aria-hidden="true"></i><b>' + esc(d.role) + '</b><span class="why">' + esc(d.why) + "</span>" + (d.gap ? '<span class="gap">To get there: ' + esc(d.gap) + "</span>" : "") + (ex ? "" : '<span class="row-actions"><button class="btn btn-quiet btn-sm" type="button" data-tailor="' + i + '">Tailor my DNA for this</button> <button class="btn btn-quiet btn-sm" type="button" data-findjobs="' + i + '">Find ' + esc(d.role) + " jobs</button></span>") + "</li>"; });
    h += "</ul></div>";
  }
  if (p.unknowns.length) {
    h += '<div class="o-sec"><h3>Not shown yet</h3><p class="hint">Your resume doesn\'t show these clearly. That doesn\'t mean you haven\'t done them. Here\'s how to show them.</p><ul class="items">';
    p.unknowns.forEach((u, i) => {
      h += '<li><i class="mark unknown" aria-hidden="true"></i><b>' + esc(u.what) + "</b>";
      if (u.how) h += '<span class="how">How to show it: ' + esc(u.how) + "</span>";
      if (u.example) h += '<span class="ex-line"><small>Example line</small>' + esc(u.example).replace(/\[([^\]]{1,60})\]/g, '<mark class="blank">[$1]</mark>') + '</span><span class="row-actions"><button class="btn btn-quiet btn-sm" type="button" data-copyex="' + i + '">Copy this line</button></span>';
      h += "</li>";
    });
    h += "</ul>";
    if (!ex) h += '<p class="hint" style="margin-top:14px">Added any of these to your resume? <button class="linkish" type="button" id="rebuildBtn">Rebuild my Career DNA</button> to see your clarity score change.</p>';
    h += "</div>";
  }
  if (!ex) {
    h += '<div class="o-sec" id="pathSec"><h3>Plan a path</h3><p class="hint">Name a role you\'d like to reach and Trazerr maps the steps from here.</p>';
    h += '<form class="goal-form" id="goalForm" novalidate><input class="input" id="goalInput" type="text" placeholder="e.g. Hotel general manager" aria-label="Goal role"><button class="btn btn-primary" type="submit" id="goalBtn">Plan my path</button></form><p class="status" id="goalStatus" role="status" aria-live="polite"></p><div id="pathOut"></div></div>';
  }
  if (!ex) h += feedbackHTML("dna");
  h += '<div class="o-foot">';
  if (ex) h += '<button class="btn btn-primary" type="button" id="tryOwnBtn">Build my own Career DNA</button>';
  else {
    h += isSaved() ? '<button class="btn btn-quiet" type="button" id="unsaveBtn">Remove from this device</button>' : '<button class="btn btn-quiet" type="button" id="saveBtn">Save on this device</button>';
    if (ACCOUNTS_ON) h += '<button class="btn btn-quiet" type="button" id="acctSaveBtn">Save to my account</button><button class="btn btn-quiet" type="button" id="talentBtn">Let employers find me</button>';
    h += '<button class="btn btn-quiet" type="button" id="againBtn">Analyze another resume</button>';
  }
  h += '<button class="btn btn-quiet" type="button" id="cardBtn">' + (ex ? "Save this example card" : "Save my Career DNA card") + "</button>";
  h += "</div>";
  if (!ex && ACCOUNTS_ON) h += '<p class="o-note">"Save to my account" keeps this Career DNA and your resume in your Trazerr account, so you can use them on any device. You can delete them any time.</p>';
  h += '<p class="o-note" id="oNote" role="status" aria-live="polite"></p>';

  openOverlay(ex ? "Example Career DNA" : (p.fullName || "Your Career DNA"), h);
  animateRing("ev", p.evidenceScore);

  const body = $("oBody");
  body.querySelectorAll("[data-findjobs]").forEach(b => b.onclick = () => {
    const d = p.directions[+b.dataset.findjobs];
    closeOverlay();
    $("jq").value = d.role;
    applyHomeLocation(p);
    $("jobs").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
    runJobSearch(true);
  });
  body.querySelectorAll("[data-tailor]").forEach(b => b.onclick = () => openTailor(p, { role: p.directions[+b.dataset.tailor].role }));
  if (!ex) wireFeedback("dna", "");
  const tb = $("nxTailor"); if (tb) tb.onclick = () => openTailor(p, {});
  const np = $("nxPath"); if (np) np.onclick = () => { $("pathSec").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); $("goalInput").focus({ preventScroll: true }); };
  const dc = $("dnaCanvas"); if (dc) { const ctx = dc.getContext("2d"); drawHelix(ctx, p, 40, dc.width - 40, dc.height / 2); }
  $("oBody").querySelectorAll("[data-copyex]").forEach(b => b.onclick = async () => {
    const line = p.unknowns[+b.dataset.copyex].example;
    try { await navigator.clipboard.writeText(line); b.textContent = "Copied. Fill in the brackets"; track("gap_line_copied"); }
    catch (e) { b.textContent = "Couldn't copy. Select the line instead"; }
  });
  const rb = $("rebuildBtn"); if (rb) rb.onclick = () => { closeOverlay(); resetForm(); $("try").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); };
  const t = $("tryOwnBtn"); if (t) t.onclick = () => { closeOverlay(); $("try").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); };
  const a = $("againBtn"); if (a) a.onclick = () => { closeOverlay(); resetForm(); $("try").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); };
  const tlb = $("talentBtn"); if (tlb) tlb.onclick = async () => {
    tlb.disabled = true;
    try {
      await acct();
      saveProfile(p); if (resumeSrc) saveResume(resumeSrc);
      if (!sbUser) {
        try { localStorage.setItem(PENDING_KEY, "1"); localStorage.setItem(TALENT_PENDING, "1"); } catch (e) {}
        return openAccount({ intro: "Sign in to let employers find you. We'll email you a link. When you open it, you'll see your anonymous profile before anything is shared. There's no password." });
      }
      openAccount({ startTalent: true });
    } catch (e) { $("oNote").textContent = e.message || "Sign-in isn't available right now."; }
    finally { tlb.disabled = false; }
  };
  const as = $("acctSaveBtn"); if (as) as.onclick = async () => {
    const note = $("oNote"); as.disabled = true;
    try {
      await acct();
      if (!sbUser) {
        saveProfile(p); if (resumeSrc) saveResume(resumeSrc);
        try { localStorage.setItem(PENDING_KEY, "1"); } catch (e) {}
        return openAccount({ intro: "Sign in to save. We'll email you a link, and your Career DNA is saved to your account as soon as you open it. Until then it's kept on this device." });
      }
      const ok = await saveToAccount(p, resumeSrc || loadResume());
      note.textContent = ok ? "Saved to your account. Sign in on any device to open it." : "That didn't save. Try again in a moment.";
      if (ok) as.textContent = "Saved to your account";
    } catch (e) { note.textContent = e.message || "Sign-in isn't available right now."; }
    finally { as.disabled = false; }
  };
  const s = $("saveBtn"); if (s) s.onclick = () => { if (saveProfile(p)) { $("oNote").textContent = "Saved on this device."; s.remove(); refreshProfileUI(); } else $("oNote").textContent = "This browser blocked saving. Private browsing mode can cause this."; };
  $("cardBtn").onclick = () => saveCard(p, $("cardBtn"));
  const u = $("unsaveBtn"); if (u) u.onclick = () => { removeProfile(); refreshProfileUI(); $("oNote").textContent = "Removed from this device. It stays available until you close this page."; u.remove(); };
  const gf = $("goalForm"); if (gf) gf.onsubmit = (e) => { e.preventDefault(); planPath(p); };
}
function resetForm(){ picked = null; $("file").value = ""; $("fileName").hidden = true; $("paste").value = ""; setStatus($("status"), ""); }

/* ---------- Career DNA card ---------- */
// Drawn on the visitor's own device and saved or shared from there. Nothing is uploaded.
function loadImg(src){ return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
function wrapLines(ctx, text, maxW, maxLines){
  const words = String(text || "").split(/\s+/).filter(Boolean), lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = fitLine(ctx, lines[maxLines - 1] + "…", maxW); }
  return lines;
}
function fitLine(ctx, text, maxW){
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text.replace(/…$/, "");
  while (t && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + "…";
}

// Small seeded random generator, so each person's DNA strand has its own shape but is the same every time.
function seeded(str){
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

// The signature: a DNA strand built from this person's evidence. One highlighted rung per strength
// (solid = verified, outlined = inferred), gold rungs toward the end for directions to explore.
function drawHelix(ctx, p, x0, x1, cy){
  const rnd = seeded((p.fullName || "") + "|" + p.headline + "|" + p.strengths.map(s => s.name).join(","));
  const A = 62 + rnd() * 18, cycles = 2.1 + rnd() * 0.9, phase = rnd() * Math.PI * 2, span = x1 - x0;
  const at = (x, off) => cy + A * Math.sin(phase + off + (x - x0) / span * cycles * Math.PI * 2);
  const strengths = p.strengths.slice(0, 7), dirs = p.directions.slice(0, 3);
  const total = Math.max(15, strengths.length + dirs.length + 6) + Math.floor(rnd() * 4);
  const rungs = Array.from({ length: total }, (_, i) => ({ x: x0 + span * (i + 0.5) / total, kind: "plain" }));
  // strengths spread through the first two thirds, directions near the end
  strengths.forEach((st, i) => { const idx = Math.round((i + 0.6) * (total * 0.66) / strengths.length) - 1; rungs[Math.max(0, Math.min(total - 1, idx))].kind = st.level === "inferred" ? "inferred" : "verified"; });
  dirs.forEach((d, i) => { rungs[total - 1 - i * 2].kind = "direction"; });
  // faint particles
  for (let i = 0; i < 46; i++) { const x = x0 + rnd() * span, y = cy + (rnd() - 0.5) * A * 3.2; ctx.fillStyle = "rgba(140,196,255," + (0.08 + rnd() * 0.25) + ")"; ctx.beginPath(); ctx.arc(x, y, 1 + rnd() * 2.2, 0, Math.PI * 2); ctx.fill(); }
  // rungs
  for (const r of rungs) {
    const ya = at(r.x, 0), yb = at(r.x, Math.PI);
    ctx.save();
    if (r.kind === "plain") { ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.lineWidth = 2; }
    else if (r.kind === "direction") { ctx.strokeStyle = "#E0B25A"; ctx.lineWidth = 3; ctx.setLineDash([7, 6]); }
    else { ctx.strokeStyle = r.kind === "verified" ? "rgba(255,255,255,.85)" : "rgba(143,165,255,.9)"; ctx.lineWidth = 3; }
    ctx.beginPath(); ctx.moveTo(r.x, ya); ctx.lineTo(r.x, yb); ctx.stroke(); ctx.restore();
  }
  // strands, with a soft glow; the color shifts from blue to gold toward the future end
  const g = ctx.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, "#0A6CF0"); g.addColorStop(0.62, "#5CA8FF"); g.addColorStop(1, "#E0B25A");
  for (const [off, alpha] of [[Math.PI, 0.45], [0, 1]]) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = g; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.shadowColor = "rgba(46,139,255,.9)"; ctx.shadowBlur = 18;
    ctx.beginPath(); for (let x = x0; x <= x1; x += 4) { const y = at(x, off); x === x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke(); ctx.restore();
  }
  // nodes on the highlighted rungs
  for (const r of rungs) {
    if (r.kind === "plain") continue;
    for (const y of [at(r.x, 0), at(r.x, Math.PI)]) {
      ctx.beginPath(); ctx.arc(r.x, y, 8, 0, Math.PI * 2);
      if (r.kind === "verified") { ctx.fillStyle = "#fff"; ctx.fill(); }
      else if (r.kind === "direction") { ctx.fillStyle = "#E0B25A"; ctx.fill(); }
      else { ctx.fillStyle = "#02060F"; ctx.fill(); ctx.strokeStyle = "#6FB4FF"; ctx.lineWidth = 3; ctx.stroke(); }
    }
  }
}

async function drawCard(p){
  const W = 1080, H = 1350, M = 72, CW = W - M * 2;
  const serif = '"Instrument Sans", system-ui, sans-serif', sans = '"Instrument Sans", system-ui, sans-serif';
  try { await Promise.all([document.fonts.load('500 80px "Instrument Sans"'), document.fonts.load('600 34px "Instrument Sans"'), document.fonts.load('400 28px "Instrument Sans"')]); } catch (e) {}
  const [bg, logo] = await Promise.all([loadImg("/img/career-dna-1280.jpg").catch(() => null), loadImg("/logo.png").catch(() => null)]);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  const spaced = (px) => { if ("letterSpacing" in ctx) ctx.letterSpacing = px; };
  ctx.fillStyle = "#02060F"; ctx.fillRect(0, 0, W, H);
  // faint brand image in the top corner, faded out
  if (bg) {
    const bh = 560, scale = Math.max(W / bg.width, bh / bg.height), sw = W / scale, sh = bh / scale;
    ctx.globalAlpha = 0.32; ctx.drawImage(bg, (bg.width - sw) * 0.75, (bg.height - sh) * 0.4, sw, sh, 0, 0, W, bh); ctx.globalAlpha = 1;
    let g = ctx.createLinearGradient(0, 0, 0, bh); g.addColorStop(0, "rgba(2,6,15,.2)"); g.addColorStop(1, "#02060F"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, bh);
    g = ctx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, "rgba(2,6,15,.9)"); g.addColorStop(0.7, "rgba(2,6,15,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, bh);
  }
  // header
  if (logo) ctx.drawImage(logo, M - 6, 50, 64, 64);
  ctx.fillStyle = "#fff"; ctx.font = "500 40px " + serif; ctx.fillText("Trazerr", M + 70, 96);
  ctx.textAlign = "right"; ctx.font = "600 22px " + sans; ctx.fillStyle = "#8CC4FF"; spaced("4px");
  ctx.fillText(p.isExample ? "EXAMPLE · CAREER DNA" : "CAREER DNA", W - M, 92); spaced("0px"); ctx.textAlign = "left";
  // name and headline
  let y = 238;
  ctx.fillStyle = "#fff"; ctx.font = "500 82px " + serif;
  for (const l of wrapLines(ctx, p.fullName || "My Career DNA", CW, 2)) { ctx.fillText(l, M, y); y += 86; }
  ctx.font = "400 31px " + sans; ctx.fillStyle = "#C9D1E3"; y += 2;
  for (const l of wrapLines(ctx, p.headline, CW, 3)) { ctx.fillText(l, M, y); y += 44; }
  // signature helix
  const hy = y + 118; drawHelix(ctx, p, M, W - M, hy); y = hy + 142;
  // evidence tally and score
  const ver = p.strengths.filter(s => s.level !== "inferred").length, inf = p.strengths.length - ver;
  const parts = [];
  if (ver) parts.push([ver + " on resume", "#fff", "v"]);
  if (inf) parts.push([inf + " between the lines", "#6FB4FF", "i"]);
  if (p.directions.length) parts.push([p.directions.length + (p.directions.length === 1 ? " direction" : " directions"), "#E0B25A", "d"]);
  ctx.font = "600 26px " + sans; let x = M;
  for (const [t, col, k] of parts) {
    ctx.beginPath(); ctx.arc(x + 8, y - 9, 8, 0, Math.PI * 2);
    if (k === "i") { ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke(); } else { ctx.fillStyle = col; ctx.fill(); }
    ctx.fillStyle = "#fff"; ctx.fillText(t, x + 26, y); x += 26 + ctx.measureText(t).width + 34;
  }
  if (p.evidenceScore !== null && p.evidenceScore !== undefined) {
    ctx.textAlign = "right"; ctx.fillStyle = "#98A3BA"; ctx.font = "400 24px " + sans;
    const n = String(p.evidenceScore); ctx.font = "500 40px " + serif; ctx.fillStyle = "#fff"; ctx.fillText(n, W - M, y + 4);
    const nw = ctx.measureText(n).width; ctx.font = "400 24px " + sans; ctx.fillStyle = "#98A3BA"; ctx.fillText("Clarity score", W - M - nw - 14, y); ctx.textAlign = "left";
  }
  // top strengths, large enough to read in a feed
  const next = p.directions[0];
  const footerTop = H - 128, nextH = next ? 128 : 0;
  const top = p.strengths.slice(0, 3);
  y += 42; ctx.fillStyle = "rgba(255,255,255,.14)"; ctx.fillRect(M, y, CW, 1); y += 8;
  for (const st of top) {
    if (y + 96 > footerTop - nextH) break;
    y += 54;
    ctx.beginPath(); ctx.arc(M + 10, y - 12, 10, 0, Math.PI * 2);
    if (st.level === "inferred") { ctx.strokeStyle = "#6FB4FF"; ctx.lineWidth = 3; ctx.stroke(); } else { ctx.fillStyle = "#fff"; ctx.fill(); }
    ctx.fillStyle = "#fff"; ctx.font = "600 35px " + sans; ctx.fillText(fitLine(ctx, st.name, CW - 44), M + 40, y);
    if (st.evidence) { ctx.fillStyle = "#AEB8CC"; ctx.font = "400 25px " + sans; ctx.fillText(fitLine(ctx, st.evidence, CW - 44), M + 40, y + 38); }
    y += 50;
  }
  // next move
  if (next) {
    y = Math.max(y + 36, footerTop - nextH + 10);
    ctx.font = "600 22px " + sans; ctx.fillStyle = "#E0B25A"; spaced("4px"); ctx.fillText("NEXT MOVE", M, y); spaced("0px");
    ctx.font = "500 50px " + serif; ctx.fillStyle = "#fff"; ctx.fillText(fitLine(ctx, next.role + "  →", CW), M, y + 58);
  }
  // footer
  ctx.fillStyle = "rgba(255,255,255,.14)"; ctx.fillRect(M, H - 104, CW, 1);
  ctx.font = "400 23px " + sans; ctx.fillStyle = "#98A3BA"; ctx.fillText("Every strength backed by evidence from a real resume", M, H - 56);
  ctx.textAlign = "right"; ctx.font = "600 26px " + sans; ctx.fillStyle = "#8CC4FF"; ctx.fillText("trazerr.com", W - M, H - 56); ctx.textAlign = "left";
  return new Promise(res => c.toBlob(res, "image/png"));
}

async function saveCard(p, btn){
  const note = $("oNote"), label = btn.textContent;
  btn.disabled = true; btn.textContent = "Making your card…";
  try {
    const blob = await drawCard(p);
    const name = "Trazerr Career DNA" + (p.fullName ? " - " + p.fullName.replace(/[^\w .-]/g, "") : "") + ".png";
    const file = new File([blob], name, { type: "image/png" });
    track("card_saved");
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "My Career DNA", text: "My Career DNA, built by Trazerr: https://www.trazerr.com" }); }
      catch (e) { if (e.name !== "AbortError") throw e; }
    } else {
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      note.textContent = "Your card was saved as an image. It was made on this device and never uploaded.";
    }
  } catch (e) {
    note.textContent = "The card couldn't be made in this browser. Try another browser, or use a screenshot.";
  } finally { btn.disabled = false; btn.textContent = label; }
}

/* ---------- Tailor my DNA ---------- */
// Step 1: choose a role. Step 2: confirm skills. Step 3: the tailored resume, with blanks to fill and exports.
let tailorState = null;
const ACCEPT = ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

function openTailor(p, preset){
  track("tailor_started");
  tailorState = { p, role: preset.role || "", posting: preset.posting || "" };
  if (!resumeSrc) resumeSrc = loadResume();
  if ((tailorState.role || tailorState.posting) && resumeSrc) runTailorSkills();
  else showTailorStart();
}

function showTailorStart(){
  const st = tailorState, p = st.p;
  let h = '<span class="flag">Tailor my DNA</span><h2 class="o-headline">Shape your resume for the role you want.</h2>';
  h += '<p class="greet" style="margin-top:10px">Trazerr rewrites your resume around your real evidence for one role. It keeps every employer, title and date as written, and never adds anything you haven\'t done.</p>';
  if (!resumeSrc) h += '<div class="t-resume"><span class="saved-note" style="margin:0">To tailor, Trazerr needs your resume file again. It stays on this device.</span><label class="btn btn-quiet btn-sm" for="tFile">Choose your resume</label><input id="tFile" type="file" accept="' + ACCEPT + '" hidden><b id="tFileName"></b></div>';
  h += '<div class="t-field"><label for="tRole">Role you want</label><input class="input" id="tRole" type="text" maxlength="100" placeholder="e.g. Regional sales manager" value="' + esc(st.role) + '">';
  if (p.directions.length) h += '<div class="t-chips">' + p.directions.map((d, i) => '<button class="chip" type="button" data-trole="' + i + '">' + esc(d.role) + "</button>").join("") + "</div>";
  h += '</div><div class="t-field"><label for="tPosting">Job posting (optional, makes it more precise)</label><textarea id="tPosting" placeholder="Paste the full job posting">' + esc(st.posting) + "</textarea></div>";
  h += '<div class="o-foot"><button class="btn btn-primary" type="button" id="tGo">Find my matching skills</button><button class="btn btn-quiet" type="button" data-close>Cancel</button></div><p class="status" id="tStatus" role="status" aria-live="polite"></p>';
  openOverlay("Tailor my DNA", h);
  $("oBody").querySelectorAll("[data-trole]").forEach(b => b.onclick = () => { $("tRole").value = p.directions[+b.dataset.trole].role; });
  const f = $("tFile");
  if (f) f.onchange = async () => {
    try { resumeSrc = await readResumeFile(f.files[0]); $("tFileName").textContent = f.files[0].name; setStatus($("tStatus"), ""); }
    catch (e) { setStatus($("tStatus"), e.message, true); }
  };
  $("tGo").onclick = () => {
    st.role = $("tRole").value.trim(); st.posting = $("tPosting").value.trim();
    if (st.role.length < 2 && st.posting.length < 120) { setStatus($("tStatus"), "Type the role you want, or paste the job posting.", true); return; }
    if (!resumeSrc) { setStatus($("tStatus"), "Choose your resume file first.", true); return; }
    runTailorSkills();
  };
}

async function runTailorSkills(){
  const st = tailorState;
  openOverlay("Tailor my DNA", loadingHTML("", ["Reading your resume…", "Studying what " + (st.role || "this role") + " needs…", "Matching your evidence to each skill…", "Almost done…"]));
  try {
    const { skills } = await api("tailor", { body: { stage: "skills", role: st.role, posting: st.posting, resume: resumeSrc } });
    st.skills = skills; if (!st.role) st.role = skills.role;
    renderTailorSkills();
  } catch (e) {
    $("oBody").innerHTML = errorHTML(e.message, "Try again");
    $("retryBtn").onclick = runTailorSkills;
  }
}

function renderTailorSkills(){
  const st = tailorState, k = st.skills;
  const have = k.skills.filter(s => s.status !== "missing"), gaps = k.skills.filter(s => s.status === "missing");
  let h = '<span class="flag">Tailor my DNA</span><h2 class="o-headline">' + esc(k.role || st.role) + "</h2>";
  h += '<div class="score">' + ringHTML("tfit", k.fitNow) + '<div><h3>Your fit today</h3><p class="tip" style="margin-top:4px">' + esc(k.summary) + "</p></div></div>";
  h += '<div class="o-sec"><h3>Skills this role needs</h3><p class="hint">Skills already on your resume are checked. Check any others that describe you. Trazerr will build your resume around what\'s checked.</p><ul class="skills">';
  have.forEach((s, i) => {
    const v = s.status === "verified";
    h += '<li><label><input type="checkbox" data-sk="' + i + '"' + (v ? " checked" : "") + '><i class="mark ' + (v ? "verified" : "inferred") + '" aria-hidden="true"></i><span><b>' + esc(s.name) + "</b>" +
      (v ? "" : '<span class="q">' + esc(s.question || "Do you have this?") + "</span>") + (s.evidence ? '<span class="ev">' + esc(s.evidence) + "</span>" : "") + "</span></label></li>";
  });
  h += "</ul></div>";
  if (gaps.length) {
    h += '<div class="o-sec"><h3>Gaps for this role</h3><p class="hint">Your resume doesn\'t show these yet. They won\'t be added, but here\'s how to build them.</p><ul class="items">';
    gaps.forEach(g => { h += '<li><i class="mark potential" aria-hidden="true"></i><b>' + esc(g.name) + "</b>" + (g.how ? '<span class="gap">' + esc(g.how) + "</span>" : "") + "</li>"; });
    h += "</ul></div>";
  }
  h += '<div class="o-foot"><button class="btn btn-primary" type="button" id="tBuild">Tailor my resume</button><button class="btn btn-quiet" type="button" id="tBack">Change role</button></div>';
  openOverlay("Tailor my DNA", h);
  animateRing("tfit", k.fitNow);
  $("tBack").onclick = showTailorStart;
  $("tBuild").onclick = () => {
    const confirmed = [...$("oBody").querySelectorAll("[data-sk]:checked")].map(c => have[+c.dataset.sk].name);
    runTailorBuild(confirmed);
  };
}

async function runTailorBuild(confirmed){
  const st = tailorState; st.confirmed = confirmed;
  openOverlay("Tailor my DNA", loadingHTML("", ["Rewriting your resume for " + (st.role || "this role") + "…", "Leading each job with your most relevant results…", "Keeping every employer, title and date as written…", "Marking details worth adding…", "Checking your fit again…", "Almost done. Longer resumes can take up to a minute…"]));
  try {
    const { resume } = await api("tailor", { body: { stage: "build", role: st.role, posting: st.posting, resume: resumeSrc, confirmed } });
    st.resume = resume; st.values = {};
    track("tailor_built");
    renderTailored();
  } catch (e) {
    $("oBody").innerHTML = errorHTML(e.message, "Try again");
    $("retryBtn").onclick = () => runTailorBuild(confirmed);
  }
}

// Replaces [placeholders] with what the person typed; unfilled ones stay visible.
function fillBlanks(text, mode){
  return esc(text).replace(/\[([^\]]{1,60})\]/g, (m, ph) => {
    const v = (tailorState.values[ph] || "").trim();
    if (v) return esc(v);
    return mode === "html" ? '<span class="ph">[' + ph + "]</span>" : "[" + ph + "]";
  });
}
// Extra sections (leadership, awards, coursework…): dated entries show like jobs; a list of short items
// shows on one line, and longer items as bullets. Older saved resumes have items only.
const shortList = (items) => items.length > 1 && items.every(i => i.length <= 40);
function resumeBody(r, mode){
  const f = (t) => fillBlanks(t, mode);
  let h = "<h4>" + esc(r.name) + "</h4>" + (r.contact ? '<div class="contact">' + esc(r.contact) + "</div>" : "") + (r.headline ? '<div class="headline">' + f(r.headline) + "</div>" : "");
  if (r.summary) h += "<h5>Summary</h5><p>" + f(r.summary) + "</p>";
  if (r.skills.length) h += "<h5>Skills</h5><p>" + r.skills.map(esc).join(" · ") + "</p>";
  if (r.experience.length) {
    h += "<h5>Experience</h5>";
    r.experience.forEach(j => {
      h += '<div class="rjob"><div class="rjob-h"><b>' + esc([j.title, j.company].filter(Boolean).join(", ")) + "</b><span>" + esc([j.location, j.dates].filter(Boolean).join(" · ")) + "</span></div>";
      if (j.bullets.length) h += "<ul>" + j.bullets.map(b => "<li>" + f(b.text) + "</li>").join("") + "</ul>";
      h += "</div>";
    });
  }
  if (r.education.length) h += "<h5>Education</h5>" + r.education.map(e => "<p>" + esc(e) + "</p>").join("");
  r.extras.forEach(x => {
    h += "<h5>" + esc(x.heading) + "</h5>";
    (x.entries || []).forEach(e => {
      h += '<div class="rjob"><div class="rjob-h"><b>' + esc(e.title) + "</b>" + (e.dates ? "<span>" + esc(e.dates) + "</span>" : "") + "</div>";
      if (e.bullets.length) h += "<ul>" + e.bullets.map(b => "<li>" + esc(b) + "</li>").join("") + "</ul>";
      h += "</div>";
    });
    if (x.items.length) h += shortList(x.items) ? "<p>" + x.items.map(esc).join(" · ") + "</p>" : "<ul>" + x.items.map(i => "<li>" + esc(i) + "</li>").join("") + "</ul>";
  });
  return h;
}
function resumeText(r){
  const f = (t) => { const d = document.createElement("div"); d.innerHTML = fillBlanks(t, "text"); return d.textContent; };
  const L = [r.name, r.contact, f(r.headline)].filter(Boolean);
  if (r.summary) L.push("", "SUMMARY", f(r.summary));
  if (r.skills.length) L.push("", "SKILLS", r.skills.join(" · "));
  if (r.experience.length) { L.push("", "EXPERIENCE"); r.experience.forEach(j => { L.push("", [j.title, j.company].filter(Boolean).join(", ") + (j.location || j.dates ? " | " + [j.location, j.dates].filter(Boolean).join(" · ") : "")); j.bullets.forEach(b => L.push("• " + f(b.text))); }); }
  if (r.education.length) L.push("", "EDUCATION", ...r.education);
  r.extras.forEach(x => {
    L.push("", x.heading.toUpperCase());
    (x.entries || []).forEach(e => { L.push([e.title, e.dates].filter(Boolean).join(" | ")); e.bullets.forEach(b => L.push("• " + b)); });
    if (x.items.length) { if (shortList(x.items)) L.push(x.items.join(" · ")); else x.items.forEach(i => L.push("• " + i)); }
  });
  return L.join("\n");
}
function resumeDocHTML(r){
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(r.name || "Resume") + '</title><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.4;color:#1b2233;max-width:7.5in;margin:.6in auto}' +
    'h4{font-family:Georgia,serif;font-weight:normal;font-size:22pt;margin:0}.contact{color:#56607a;font-size:10pt}.headline{font-weight:bold;margin-top:6pt}' +
    'h5{font-size:10pt;letter-spacing:1px;text-transform:uppercase;color:#004FB0;border-bottom:1px solid #ccc;margin:14pt 0 4pt;padding-bottom:2pt}' +
    '.rjob{margin-top:8pt}.rjob-h span{color:#56607a;font-size:10pt;margin-left:8pt}ul{margin:3pt 0 0;padding-left:16pt}li{margin-top:2pt}p{margin:0 0 3pt}' +
    '@page{margin:.5in}</style></head><body>' + resumeBody(r, "text") + "</body></html>";
}

// ---- Word (.docx) export, built in the browser ----
// A .docx file is a zip of XML files. This writes an uncompressed zip with just the parts Word needs.
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes){ let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files){
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(8, 0, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cenSize = central.reduce((n, a) => n + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
function resumeDocx(r){
  const x = (t) => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
  const plain = (t) => { const d = document.createElement("div"); d.innerHTML = fillBlanks(t, "text"); return d.textContent; };
  const run = (t, o = {}) => '<w:r><w:rPr><w:rFonts w:ascii="' + (o.serif ? "Georgia" : "Arial") + '" w:hAnsi="' + (o.serif ? "Georgia" : "Arial") + '"/>' + (o.b ? "<w:b/>" : "") + (o.color ? '<w:color w:val="' + o.color + '"/>' : "") + '<w:sz w:val="' + (o.size || 21) + '"/></w:rPr><w:t xml:space="preserve">' + x(t) + "</w:t></w:r>";
  const para = (runs, o = {}) => "<w:p><w:pPr>" + (o.border ? '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="2" w:color="C8CCD6"/></w:pBdr>' : "") + '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after ?? 60) + '"/>' + (o.bullet ? '<w:ind w:left="360" w:hanging="220"/>' : "") + "</w:pPr>" + runs + "</w:p>";
  const heading = (t) => para(run(t.toUpperCase(), { b: true, size: 19, color: "1E3BB3" }), { border: true, before: 240, after: 80 });
  let b = para(run(r.name, { serif: true, size: 44 }), { after: 20 });
  if (r.contact) b += para(run(r.contact, { size: 19, color: "56607A" }));
  if (r.headline) b += para(run(plain(r.headline), { b: true }), { before: 60 });
  if (r.summary) b += heading("Summary") + para(run(plain(r.summary)));
  if (r.skills.length) b += heading("Skills") + para(run(r.skills.join(" · ")));
  if (r.experience.length) {
    b += heading("Experience");
    r.experience.forEach(j => {
      const meta = [j.location, j.dates].filter(Boolean).join(" · ");
      b += para(run([j.title, j.company].filter(Boolean).join(", "), { b: true }) + (meta ? run("   " + meta, { size: 19, color: "56607A" }) : ""), { before: 120, after: 40 });
      j.bullets.forEach(bl => { b += para(run("•  " + plain(bl.text)), { bullet: true, after: 30 }); });
    });
  }
  if (r.education.length) { b += heading("Education"); r.education.forEach(e => { b += para(run(e)); }); }
  r.extras.forEach(x => {
    b += heading(x.heading);
    (x.entries || []).forEach(e => {
      b += para(run(e.title, { b: true }) + (e.dates ? run("   " + e.dates, { size: 19, color: "56607A" }) : ""), { before: 120, after: 40 });
      e.bullets.forEach(bl => { b += para(run("•  " + bl), { bullet: true, after: 30 }); });
    });
    if (x.items.length) { if (shortList(x.items)) b += para(run(x.items.join(" · "))); else x.items.forEach(i => { b += para(run("•  " + i), { bullet: true, after: 30 }); }); }
  });
  const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + b +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1008" w:right="1080" w:bottom="1008" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>';
  return zipStore([
    { name: "[Content_Types].xml", text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: "_rels/.rels", text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: "word/document.xml", text: doc }
  ]);
}

function renderTailored(){
  const st = tailorState, r = st.resume;
  let h = '<span class="flag">Tailored for ' + esc(st.role) + '</span><h2 class="o-headline">Your resume, shaped for ' + esc(st.role) + ".</h2>";
  if (r.fitBefore !== null || r.fitAfter !== null) h += '<div class="shift"><div><small>Fit before</small><b>' + (r.fitBefore ?? "–") + '</b></div><span aria-hidden="true">→</span><div class="after"><small>Estimated fit after</small><b>' + (r.fitAfter ?? "–") + "</b></div><p>An estimate. Filling the blanks with real details makes it stronger.</p></div>";
  if (r.changes.length) h += '<div class="o-sec"><h3>What changed</h3><ul class="items">' + r.changes.map(c => '<li><i class="mark inferred" aria-hidden="true"></i><span class="why">' + esc(c) + "</span></li>").join("") + "</ul></div>";
  if (r.blanks.length) h += '<div class="o-sec"><h3>Fill in the blanks</h3><p class="hint">Add only real details. Anything you leave empty stays marked in brackets so you don\'t miss it.</p><div class="blanks">' +
    r.blanks.map((b, i) => '<div><label for="tb' + i + '">' + esc(b.question) + ' <span style="color:var(--brass)">[' + esc(b.placeholder) + ']</span></label><input class="input" id="tb' + i + '" data-ph="' + esc(b.placeholder) + '" type="text" maxlength="80"></div>').join("") + "</div></div>";
  h += '<div class="o-sec"><h3>Your tailored resume</h3><div class="paper" id="paper">' + resumeBody(r, "html") + "</div></div>";
  h += feedbackHTML("tailor");
  h += '<div class="o-foot"><button class="btn btn-primary" type="button" id="tWord">Download Word file</button><button class="btn btn-quiet" type="button" id="tPdf">Save as PDF</button><button class="btn btn-quiet" type="button" id="tCopy">Copy text</button><button class="btn btn-quiet" type="button" id="tAgain">Tailor for another role</button></div>';
  h += '<p class="o-note" id="oNote" role="status" aria-live="polite"></p>';
  openOverlay("Tailor my DNA", h);
  const body = $("oBody");
  wireFeedback("tailor", st.role);
  body.querySelectorAll("[data-ph]").forEach(inp => inp.oninput = () => { st.values[inp.dataset.ph] = inp.value; $("paper").innerHTML = resumeBody(r, "html"); });
  const left = () => { const n = (resumeText(r).match(/\[[^\]]{1,60}\]/g) || []).length; return n ? " " + n + (n === 1 ? " blank is" : " blanks are") + " still marked in [brackets]." : ""; };
  const fileBase = (r.name || "Resume") + " - " + (st.role || "tailored");
  $("tWord").onclick = () => {
    const blob = resumeDocx(r);
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = fileBase.replace(/[^\w .-]/g, "") + ".docx"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    $("oNote").textContent = "Downloaded. It opens in Word or Google Docs." + left();
  };
  $("tPdf").onclick = () => {
    const w = window.open("", "_blank");
    if (!w) { $("oNote").textContent = "Your browser blocked the print window. Allow pop-ups for this site, or use Download Word file."; return; }
    w.document.write(resumeDocHTML(r)); w.document.close(); w.focus();
    setTimeout(() => w.print(), 400);
    $("oNote").textContent = "Choose \"Save as PDF\" in the print window." + left();
  };
  $("tCopy").onclick = async () => {
    const text = resumeText(r);
    try { await navigator.clipboard.writeText(text); $("oNote").textContent = "Copied." + left(); }
    catch (e) { $("oNote").textContent = "Your browser blocked copying. Use Download Word file instead."; }
  };
  $("tAgain").onclick = () => { st.role = ""; st.posting = ""; showTailorStart(); };
}

/* ---------- feedback ---------- */
function feedbackHTML(on){
  return '<div class="fb" data-fb="' + on + '"><span>Was this accurate?</span>' +
    '<button class="fb-btn" type="button" data-rate="up" aria-pressed="false" aria-label="Yes, it was accurate">👍</button>' +
    '<button class="fb-btn" type="button" data-rate="down" aria-pressed="false" aria-label="No, something was off">👎</button>' +
    '<div class="fb-more" hidden><label class="hint" for="fbText-' + on + '">Tell us more (optional). What was off, or what helped? Please leave out personal details.</label>' +
    '<textarea class="input" id="fbText-' + on + '" maxlength="1000"></textarea><button class="btn btn-quiet btn-sm" type="button" data-fbsend>Send</button></div>' +
    '<p class="fb-done" role="status" aria-live="polite"></p></div>';
}
function wireFeedback(on, role){
  const box = document.querySelector('[data-fb="' + on + '"]');
  if (!box) return;
  let rating = "";
  const done = box.querySelector(".fb-done");
  box.querySelectorAll("[data-rate]").forEach(b => b.onclick = async () => {
    if (rating) return;
    rating = b.dataset.rate;
    box.querySelectorAll("[data-rate]").forEach(x => { x.setAttribute("aria-pressed", String(x === b)); x.disabled = true; });
    try { await api("feedback", { body: { on, rating, role: role || "" } }); } catch (e) {}
    done.textContent = rating === "up" ? "Thanks! Glad it was useful." : "Thanks for telling us. What was off?";
    box.querySelector(".fb-more").hidden = false;
  });
  box.querySelector("[data-fbsend]").onclick = async () => {
    const comment = box.querySelector("textarea").value.trim();
    if (!comment) { done.textContent = "Type a few words first, or just close this screen."; return; }
    const btn = box.querySelector("[data-fbsend]"); btn.disabled = true;
    try {
      await api("feedback", { body: { on, rating, role: role || "", comment, followup: true } });
      box.querySelector(".fb-more").hidden = true; done.textContent = "Thank you. We read every comment.";
    } catch (e) { done.textContent = e.message; btn.disabled = false; }
  };
}

/* ---------- career path ---------- */
async function planPath(p){
  const goal = $("goalInput").value.trim(), st = $("goalStatus"), btn = $("goalBtn");
  if (goal.length < 2) { setStatus(st, "Type the role you'd like to reach.", true); return; }
  btn.disabled = true; setStatus(st, "Mapping your path…"); $("pathOut").innerHTML = ""; track("path_planned");
  try {
    const { plan } = await api("path", { body: { profile: p, goal } });
    setStatus(st, "");
    let h = '<p style="margin-top:18px">' + esc(plan.outlook) + "</p>";
    if (plan.timeline) h += '<p class="hint">Realistic timeline: <b style="color:var(--ink)">' + esc(plan.timeline) + "</b></p>";
    h += '<ol class="vpath"><li class="done"><small>Where you are</small><b>' + esc(plan.current || "Today") + "</b></li>";
    arr(plan.steps).forEach((s, i, all) => {
      const last = i === all.length - 1;
      h += '<li class="' + (last ? "goal" : i === 0 ? "next" : "") + '"><small>' + (last ? "Your goal" : i === 0 ? "Next step" : "Then") + "</small><b>" + esc(s.role) + "</b>" + (s.why ? "<p>" + esc(s.why) + "</p>" : "") + (s.build ? '<p class="build">Focus: ' + esc(s.build) + "</p>" : "") + "</li>";
    });
    h += "</ol><div class=\"cols\"><div><h4>Already done</h4><ul class=\"plain\">" + arr(plan.proven).map(x => '<li><i class="mark verified" aria-hidden="true"></i>' + esc(x) + "</li>").join("") + "</ul></div>";
    h += '<div><h4>Still to build</h4><ul class="plain">' + arr(plan.missing).map(x => '<li><i class="mark potential" aria-hidden="true"></i>' + esc(x) + "</li>").join("") + "</ul></div></div>";
    $("pathOut").innerHTML = h;
  } catch (e) { setStatus(st, e.message, true); }
  finally { btn.disabled = false; }
}

/* ---------- jobs ---------- */
$("jobsForm").addEventListener("submit", e => { e.preventDefault(); runJobSearch(true); });
document.querySelectorAll("#jobsEmpty [data-q]").forEach(b => b.addEventListener("click", () => { $("jq").value = b.dataset.q; runJobSearch(true); }));
$("moreBtn").addEventListener("click", () => runJobSearch(false));

async function runJobSearch(fresh){
  const st = $("jobsStatus"), btn = $("jobsBtn"), more = $("moreBtn");
  if (fresh) {
    jobState = { q: $("jq").value.trim(), where: $("jw").value.trim(), remote: $("jr").checked, page: 1, list: [] };
    if (!jobState.q) { setStatus(st, "Enter a job title or keyword to search.", true); $("jq").focus(); return; }
    track("job_search");
  } else jobState.page += 1;
  btn.disabled = true; more.disabled = true;
  setStatus(st, fresh ? "Searching live openings…" : "Loading more…");
  try {
    const query = { q: jobState.q, page: String(jobState.page) };
    if (jobState.where) query.where = jobState.where;
    if (jobState.remote) query.remote = "1";
    const data = await api("jobs", { query });
    const seen = new Set(jobState.list.map(j => j.id));
    arr(data.jobs).forEach(j => { if (!seen.has(j.id)) jobState.list.push(j); });
    renderJobs(data);
    const count = jobState.list.length;
    let msg = count ? "" : "No openings found. Try a broader title, or remove the location.";
    if (count && data.source === "adzuna" && jobState.where) msg = "Showing openings near " + jobState.where + ".";
    if (count && data.broadened === "area") msg = "No exact matches right near " + jobState.where + ", so these are within about 30 miles.";
    if (count && data.broadened === "title") msg = "No \u201c" + jobState.q + "\u201d openings " + (jobState.where ? "near " + jobState.where : "right now") + ", so here are \u201c" + data.searchedFor + "\u201d roles instead.";
    if (count && data.source === "remotive" && jobState.where && !jobState.remote) msg = "Showing remote openings. Local results for this location aren't available right now.";
    setStatus(st, msg);
    showAlertBox(count > 0);
  } catch (e) {
    if (!fresh) jobState.page -= 1;
    setStatus(st, e.message, true);
  } finally { btn.disabled = false; more.disabled = false; }
}

function renderJobs(data){
  const listEl = $("jobList");
  $("jobsEmpty").hidden = jobState.list.length > 0;
  listEl.innerHTML = jobState.list.map((j, i) => {
    const meta = [j.company, j.location, ago(j.posted)].filter(Boolean).map(esc).join(" · ");
    return '<li class="job"><div class="job-top"><h3>' + esc(j.title) + "</h3>" + (j.salary ? '<span class="salary">' + esc(j.salary) + "</span>" : "") + "</div>" +
      (meta ? '<p class="job-meta">' + meta + "</p>" : "") +
      (j.description ? '<p class="job-snip">' + esc(snippet(j.description, 260)) + "</p>" : "") +
      '<div class="job-actions"><button class="btn btn-primary btn-sm" type="button" data-fit="' + i + '">Check my fit</button><a class="btn btn-quiet btn-sm" href="' + esc(safeUrl(j.url)) + '" target="_blank" rel="noopener noreferrer">View job</a></div></li>';
  }).join("");
  // Keep a reference to the jobs shown, so a button still works while a new search is loading.
  const shown = jobState.list;
  listEl.querySelectorAll("[data-fit]").forEach(b => b.onclick = () => { const j = shown[+b.dataset.fit]; if (j) checkFit(j); });
  const foot = $("jobsFoot");
  foot.hidden = jobState.list.length === 0;
  $("jobsSource").innerHTML = data.source === "adzuna"
    ? 'Jobs by <a href="https://www.adzuna.com" target="_blank" rel="noopener">Adzuna</a>'
    : 'Remote jobs from <a href="https://remotive.com" target="_blank" rel="noopener">Remotive</a>';
  $("moreBtn").hidden = !data.hasMore;
}

/* ---------- job alerts ---------- */
// "Email me new jobs": saves the current search as a weekly alert in the person's account.
const ALERT_PENDING = "trazerr.pendingAlert";
function currentAlert(){ return { query: jobState.q, location: jobState.remote ? "" : jobState.where, remote: !!jobState.remote }; }
function alertLabel(a){ return "\u201c" + a.query + "\u201d" + (a.remote ? " remote" : "") + " jobs" + (a.location ? " near " + a.location : ""); }
function showAlertBox(on){
  $("alertBox").hidden = !ACCOUNTS_ON || !on || !jobState.q;
  if (on && jobState.q) { $("alertTitle").textContent = "Get new " + alertLabel(currentAlert()) + " by email"; setStatus($("alertStatus"), ""); }
}
async function addAlert(a){
  const { error } = await sb.from("job_alerts").insert({ user_id: sbUser.id, query: a.query.slice(0, 100), location: (a.location || "").slice(0, 100), remote: !!a.remote });
  if (!error) { track("alert_created"); return { ok: true, text: "Done. You'll get new " + alertLabel(a) + " by email once a week. Manage your alerts from your account." }; }
  if (error.code === "23505") return { ok: true, text: "You already have this job alert." };
  if (error.code === "42501") return { ok: false, text: "You can have up to 3 job alerts. Stop one from your account to add another." };
  return { ok: false, text: "The job alert didn't save. Try again in a moment." };
}
$("alertBtn").addEventListener("click", async () => {
  const st = $("alertStatus"), btn = $("alertBtn"), a = currentAlert();
  btn.disabled = true; setStatus(st, "Saving…");
  try {
    await acct();
    if (!sbUser) {
      try { localStorage.setItem(ALERT_PENDING, JSON.stringify(a)); } catch (e) {}
      setStatus(st, "");
      return openAccount({ intro: "Enter your email and we'll send you a sign-in link. When you open it, your job alert for " + alertLabel(a) + " is turned on. There's no password." });
    }
    const r = await addAlert(a); setStatus(st, r.text, !r.ok);
  } catch (e) { setStatus(st, e.message || "That didn't go through. Try again in a moment.", true); }
  finally { btn.disabled = false; }
});

/* ---------- fit check ---------- */
function needProfileHTML(){
  return '<div class="loading"><h2 class="o-headline" style="font-size:28px">Build your Career DNA first</h2><p style="margin-top:12px">A fit check compares the job with the evidence in your resume, so Trazerr needs your Career DNA. It takes about 20 seconds.</p><div class="o-foot" style="justify-content:center"><button class="btn btn-primary" type="button" id="goBuild">Build my Career DNA</button></div></div>';
}
async function checkFit(job){
  const p = profile && !profile.isExample ? profile : null;
  if (!p) {
    openOverlay("Check my fit", needProfileHTML());
    $("goBuild").onclick = () => { closeOverlay(); $("try").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); };
    return;
  }
  track("fit_check");
  openOverlay(job.title || "Fit check", loadingHTML("", ["Reading the job…", "Comparing it with your Career DNA…", "Scoring each part of the fit…", "Writing tips for applying…"]));
  try {
    const { fit } = await api("match", { body: { profile: p, job: { title: job.title, company: job.company, location: job.location, description: job.description } } });
    renderFit(job, fit);
  } catch (e) {
    $("oBody").innerHTML = errorHTML(e.message, "Try again");
    $("retryBtn").onclick = () => checkFit(job);
  }
}
function renderFit(job, fit){
  let h = '<p class="greet">' + esc([job.company, job.location].filter(Boolean).join(" · ")) + "</p>";
  h += '<h2 class="o-headline">' + esc(job.title || "This role") + "</h2>";
  h += '<div class="score">' + ringHTML("fit", toScore(fit.fitScore)) + '<div><h3>Your fit</h3><p class="tip" style="margin-top:4px">' + esc(fit.summary) + "</p></div></div>";
  h += '<div class="o-sec"><h3>How it breaks down</h3><div class="legend"><span><i class="mark verified"></i>From your resume</span><span><i class="mark inferred"></i>Between the lines</span></div><div style="margin-top:8px">';
  arr(fit.factors).forEach(f => {
    const sc = toScore(f.score), soft = f.basis === "inferred";
    h += '<div class="fit-row' + (sc === null ? " unk" : "") + '"><b>' + esc(f.name) + '<span class="basis">' + (sc === null ? "not shown yet" : sc + (soft ? " · between the lines" : "")) + '</span></b><div class="bar' + (soft ? " soft" : "") + '">' + (sc === null ? "" : '<i data-w="' + sc + '" style="width:0%"></i>') + "</div><small>" + esc(f.note) + "</small></div>";
  });
  h += "</div></div>";
  if (arr(fit.strengths).length) {
    h += '<div class="o-sec"><h3>Why you fit</h3><ul class="items">';
    fit.strengths.forEach(s => { h += '<li><i class="mark verified" aria-hidden="true"></i><b>' + esc(s.point) + "</b>" + (s.evidence ? '<span class="ev">' + esc(s.evidence) + "</span>" : "") + "</li>"; });
    h += "</ul></div>";
  }
  if (arr(fit.gaps).length) {
    h += '<div class="o-sec"><h3>Gaps to address</h3><ul class="items">';
    fit.gaps.forEach(g => { h += '<li><i class="mark potential" aria-hidden="true"></i><span class="why">' + esc(g) + "</span></li>"; });
    h += "</ul></div>";
  }
  if (arr(fit.unknowns).length) {
    h += '<div class="o-sec"><h3>Unknowns</h3><p class="hint">Things this job may need that your resume doesn\'t show either way.</p><ul class="items">';
    fit.unknowns.forEach(u => { h += '<li><i class="mark unknown" aria-hidden="true"></i><span class="why">' + esc(u) + "</span></li>"; });
    h += "</ul></div>";
  }
  if (arr(fit.tips).length) {
    h += '<div class="o-sec"><h3>How to apply well</h3><ul class="items">';
    fit.tips.forEach(t => { h += '<li><i class="mark inferred" aria-hidden="true"></i><span class="why">' + esc(t) + "</span></li>"; });
    h += "</ul></div>";
  }
  h += feedbackHTML("fit");
  h += '<div class="o-foot">' + (job.url ? '<a class="btn btn-primary" href="' + esc(safeUrl(job.url)) + '" target="_blank" rel="noopener noreferrer">View and apply</a>' : "") + '<button class="btn btn-quiet" type="button" id="fitTailorBtn">Tailor my DNA for this job</button><button class="btn btn-quiet" type="button" data-close>Back to jobs</button></div>';
  openOverlay(job.title || "Fit check", h);
  animateRing("fit", toScore(fit.fitScore));
  $("fitTailorBtn").onclick = () => openTailor(profile, { role: job.title, posting: job.description });
  wireFeedback("fit", job.title);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $("oBody").querySelectorAll("[data-w]").forEach(el => { el.style.width = el.dataset.w + "%"; });
  }));
}

/* ---------- Role Match / Fit Analysis ---------- */

// PDF parsing setup - wait for PDF.js library to load
(function initPdfHandling() {
  function setupPdfWorker() {
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      return true;
    }
    return false;
  }

  if (!setupPdfWorker()) {
    let retries = 0;
    const checkInterval = setInterval(() => {
      if (setupPdfWorker() || retries++ > 50) clearInterval(checkInterval);
    }, 100);
  }

  async function extractPdfText(file) {
    try {
      if (!file || file.type !== 'application/pdf') throw new Error('Please select a valid PDF file');
      if (typeof pdfjsLib === 'undefined') throw new Error('PDF reader is loading. Please try again.');

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let text = '';

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(' ') + '\n';
      }

      return text.trim();
    } catch (error) {
      throw new Error('Could not read PDF: ' + (error.message || 'Unknown error'));
    }
  }

  function setupPdfUpload(fileInputId, textareaId) {
    const fileInput = $(fileInputId);
    const textarea = $(textareaId);
    if (!fileInput) return;

    let fileLabel = fileInput.nextElementSibling;
    while (fileLabel && fileLabel.tagName !== 'LABEL') fileLabel = fileLabel.nextElementSibling;

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const originalLabel = fileLabel?.textContent || '📄 Upload PDF';
      if (fileLabel) fileLabel.textContent = '⏳ Reading PDF...';

      try {
        const text = await extractPdfText(file);
        textarea.value = text;
        if (fileLabel) fileLabel.textContent = '✓ ' + originalLabel;
        setTimeout(() => { if (fileLabel) fileLabel.textContent = originalLabel; }, 2000);
      } catch (error) {
        if (fileLabel) fileLabel.textContent = originalLabel;
        setStatus($('fitStatus'), 'Error: ' + error.message, true);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setupPdfUpload('fitResumeFile', 'fitResume');
      setupPdfUpload('fitJobFile', 'fitJob');
    });
  } else {
    setupPdfUpload('fitResumeFile', 'fitResume');
    setupPdfUpload('fitJobFile', 'fitJob');
  }
})();

function analyzeFit(resumeText, jobText){
  const jobLower = jobText.toLowerCase();
  const resumeLower = resumeText.toLowerCase();

  const categories = {
    "Leadership": {
      keywords: ["lead", "leader", "leadership", "manage", "manager", "director", "head of", "chief"],
      strength: "Team leadership and management",
      gap: "Management or leadership experience"
    },
    "Technical Skills": {
      keywords: ["python", "javascript", "java", "sql", "database", "api", "aws", "azure", "cloud"],
      strength: "Technical expertise",
      gap: "Technical skills mentioned in the role"
    },
    "Communication": {
      keywords: ["present", "communication", "speak", "write", "written", "speaking", "presentation"],
      strength: "Communication and presentation skills",
      gap: "Strong communication abilities"
    },
    "Strategy": {
      keywords: ["strategy", "strategic", "plan", "planning", "roadmap", "vision"],
      strength: "Strategic planning ability",
      gap: "Strategic thinking and planning"
    },
    "Collaboration": {
      keywords: ["team", "collaborate", "collaboration", "cross-functional", "partner"],
      strength: "Team collaboration and partnership",
      gap: "Ability to work cross-functionally"
    },
    "Customer Focus": {
      keywords: ["customer", "client", "stakeholder", "sales", "revenue", "business"],
      strength: "Customer and revenue focus",
      gap: "Customer-facing or revenue experience"
    }
  };

  let score = 55;
  const strengths = [];
  const gaps = [];

  Object.entries(categories).forEach(([cat, data]) => {
    const jobNeeds = data.keywords.some(kw => jobLower.includes(kw));
    const hasMatch = data.keywords.some(kw => resumeLower.includes(kw));

    if (jobNeeds) {
      if (hasMatch) {
        score += 7;
        strengths.push({ title: cat, desc: data.strength + " shown in your experience." });
      } else {
        gaps.push({ title: cat, desc: data.gap + " would strengthen your candidacy." });
      }
    }
  });

  score = Math.min(100, Math.max(25, score));
  return { score: Math.round(score), strengths: strengths.slice(0, 4), gaps: gaps.slice(0, 4) };
}

// Attach event listener when DOM is ready
function attachFitBtnListener() {
  const btn = $("fitBtn");
  if (!btn) {
    setTimeout(attachFitBtnListener, 50);
    return;
  }

  btn.addEventListener("click", function(event) {
    event.preventDefault();
    event.stopPropagation();
    const resume = $("fitResume").value.trim();
    const job = $("fitJob").value.trim();
    const st = $("fitStatus");

    if (!resume || resume.length < 50) { setStatus(st, "Paste your resume (at least a few lines).", true); return; }
    if (!job || job.length < 50) { setStatus(st, "Paste the job posting (at least a few lines).", true); return; }

    track("fit_analysis");
    const analysis = analyzeFit(resume, job);
    const resultDiv = $("fitResult");

    const scoreColor = analysis.score >= 75 ? "var(--blue)" : analysis.score >= 60 ? "var(--gold)" : "#e74c3c";
    const scoreMessage = analysis.score >= 75 ? "Strong match" : analysis.score >= 60 ? "Good match" : "Worth considering";

    let html = '<div class="fit-actions-bar"><button class="fit-print-btn" type="button" onclick="window.print()" title="Print or save as PDF"><span>🖨</span>Print this card</button></div>';
    html += '<div class="fit-score-card" style="background:linear-gradient(135deg, rgba(0,102,224,.08) 0%, rgba(224,176,112,.04) 100%);"><div class="fit-score-header"><div class="fit-score-num" style="color:' + scoreColor + '">' + analysis.score + '%</div><div class="fit-score-info"><h3>Your Fit Score</h3><p style="margin:8px 0 0"><strong>' + scoreMessage + '.</strong> This score reflects your background against the role requirements based on experience keywords and category alignment.</p></div></div></div>';

    if (analysis.strengths.length) {
      html += '<div class="fit-section"><h3 class="fit-section-title"><span style="color:var(--blue); font-weight:700">✓</span> What You Bring (' + analysis.strengths.length + ')</h3><ul class="fit-list">';
      analysis.strengths.forEach(s => html += '<li class="fit-item"><p class="fit-item-title">' + esc(s.title) + '</p><p class="fit-item-desc">' + esc(s.desc) + ' <strong>Highlight this in your application and interview.</strong></p></li>');
      html += '</ul></div>';
    }

    if (analysis.gaps.length) {
      html += '<div class="fit-section"><h3 class="fit-section-title"><span style="color:#e74c3c; font-weight:700">●</span> Things to Address (' + analysis.gaps.length + ')</h3><ul class="fit-list">';
      analysis.gaps.forEach(g => html += '<li class="fit-item"><p class="fit-item-title">' + esc(g.title) + '</p><p class="fit-item-desc">' + esc(g.desc) + ' Be ready to explain or discuss during interviews.</p></li>');
      html += '</ul></div>';
    }

    const actionHtml = analysis.score >= 75 ? 'This is a strong match. <strong>Apply now or tailor your resume</strong> to emphasize your top strengths.' :
      analysis.score >= 60 ? 'You\'re a reasonable fit. Consider <strong>tailoring your resume</strong> to highlight the strengths above and prepare talking points about the gaps.' :
      'You have some relevant experience. <strong>Build your Career DNA</strong> for deeper analysis and personalized recommendations before applying.';

    html += '<div class="fit-section" style="margin-top:32px; padding:20px; background:var(--blue-soft); border-radius:8px; border-left:4px solid var(--blue)"><h3 style="margin:0 0 12px; font-size:14px; color:var(--ink); font-weight:700">Recommended Action</h3><p style="margin:0; color:var(--ink); line-height:1.6">' + actionHtml + '</p></div>';

    resultDiv.innerHTML = html;
    resultDiv.hidden = false;
    setStatus(st, "");
    window.scrollTo({ top: resultDiv.offsetTop - 100, behavior: "smooth" });
  });
}

// Initialize immediately and retry if needed
attachFitBtnListener();

// Also ensure it's attached when DOM is fully ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', attachFitBtnListener);
}

/* ---------- Job DNA ---------- */
// A posting can be pasted, or uploaded like a resume. Word and text files are read here and fill the box,
// so the person can check the text. A PDF is sent as is: the server reads it and sends back its text,
// which then fills the box so "Check my fit" and "Tailor" work the same way.
let postingPdf = null;
function clearPostingFile(){ postingPdf = null; $("postingFileName").hidden = true; $("postingFileName").textContent = ""; $("postingFile").value = ""; }
async function handlePostingFile(file){
  const st = $("jobdnaStatus");
  if (!file) return;
  try {
    const f = await readResumeFile(file);
    $("postingFileName").textContent = file.name || "posting"; $("postingFileName").hidden = false;
    if (f.kind === "text") { postingPdf = null; $("postingText").value = f.text.trim(); setStatus(st, "Loaded. Check the text above, then choose Build Job DNA."); }
    else { postingPdf = f; $("postingText").value = ""; setStatus(st, "Ready to read " + (file.name || "the PDF") + ". Choose Build Job DNA."); }
    track("posting_file");
  } catch (e) { clearPostingFile(); setStatus(st, e.message, true); }
}
$("postingFile").addEventListener("change", e => handlePostingFile(e.target.files[0]));
const postingDrop = $("postingDrop");
["dragenter","dragover"].forEach(t => postingDrop.addEventListener(t, e => { e.preventDefault(); postingDrop.classList.add("over"); }));
["dragleave","drop"].forEach(t => postingDrop.addEventListener(t, e => { e.preventDefault(); postingDrop.classList.remove("over"); }));
postingDrop.addEventListener("drop", e => handlePostingFile(e.dataTransfer.files[0]));
$("postingText").addEventListener("input", () => { if (postingPdf) clearPostingFile(); });

$("jobdnaBtn").addEventListener("click", async () => {
  const text = $("postingText").value.trim(), st = $("jobdnaStatus"), btn = $("jobdnaBtn");
  const usePdf = postingPdf && !text;
  if (!usePdf && text.length < 120) { setStatus(st, "Paste the full job posting, at least a few lines, or upload it.", true); return; }
  btn.disabled = true; setStatus(st, usePdf ? "Reading the PDF…" : "Reading the posting…"); track("job_dna");
  try {
    const { dna } = await api("jobdna", { body: usePdf ? { file: postingPdf } : { text } });
    if (usePdf && dna.postingText) { $("postingText").value = dna.postingText; postingPdf = null; }
    setStatus(st, "");
    renderJobDna(dna);
  } catch (e) { setStatus(st, e.message, true); }
  finally { btn.disabled = false; }
});
$("postingFitBtn").addEventListener("click", () => {
  const text = $("postingText").value.trim(), st = $("jobdnaStatus");
  if (postingPdf && !text) { setStatus(st, "Choose Build Job DNA first, so Trazerr can read the PDF.", true); return; }
  if (text.length < 120) { setStatus(st, "Paste the full job posting first, or upload it.", true); return; }
  setStatus(st, "");
  const firstLine = text.split("\n").map(s => s.trim()).find(Boolean) || "This role";
  checkFit({ title: snippet(firstLine, 90), company: "", location: "", description: text, url: "" });
});
function renderJobDna(d){
  let h = '<span class="flag">Job DNA</span><h2 class="o-headline">' + esc(d.title || "This role") + "</h2>";
  if (d.level) h += '<p class="greet" style="margin-top:8px">' + esc(d.level) + "</p>";
  h += '<p style="margin-top:14px; font-size:18px">' + esc(d.summary) + "</p>";
  const block = (title, hint, items, mark) => items.length ? '<div class="o-sec"><h3>' + title + "</h3>" + (hint ? '<p class="hint">' + hint + "</p>" : "") + '<ul class="items">' + items.join("") + "</ul></div>" : "";
  h += block("Must-haves", "Stated in the posting.", arr(d.mustHaves).map(x => '<li><i class="mark verified" aria-hidden="true"></i><span class="why">' + esc(x) + "</span></li>"));
  h += block("Nice to have", "", arr(d.niceToHaves).map(x => '<li><i class="mark unknown" aria-hidden="true"></i><span class="why">' + esc(x) + "</span></li>"));
  h += block("What it quietly expects", "Read between the lines of the posting, with the reasoning shown.", arr(d.hidden).map(x => '<li><i class="mark inferred" aria-hidden="true"></i><b>' + esc(x.item) + "</b>" + (x.why ? '<span class="ev">' + esc(x.why) + "</span>" : "") + "</li>"));
  h += block("What shows a fit", "What to look for on a resume, or show on yours.", arr(d.evidence).map(x => '<li><i class="mark potential" aria-hidden="true"></i><span class="why">' + esc(x) + "</span></li>"));
  const mine = profile && !profile.isExample;
  h += '<div class="o-foot">' + (mine ? '<button class="btn btn-primary" type="button" id="dnaFitBtn">Check my fit for this role</button><button class="btn btn-quiet" type="button" id="dnaTailorBtn">Tailor my DNA for this role</button>' : "") + '<button class="btn btn-quiet" type="button" data-close>Close</button></div>';
  openOverlay("Job DNA", h);
  const b = $("dnaFitBtn"); if (b) b.onclick = () => $("postingFitBtn").click();
  const tb = $("dnaTailorBtn"); if (tb) tb.onclick = () => openTailor(profile, { role: d.title, posting: $("postingText").value.trim() });
}

/* ---------- header shadow once the page scrolls ---------- */
const siteHead = document.querySelector(".site-head");
function syncHead(){ siteHead.classList.toggle("scrolled", window.scrollY > 8); }
window.addEventListener("scroll", syncHead, { passive: true });
syncHead();

/* ---------- light and dark themes ---------- */
function applyTheme(t){
  const root = document.documentElement;
  root.classList.add("theme-anim");
  root.dataset.theme = t;
  try { localStorage.setItem("trazerr.theme", t); } catch (e) {}
  const b = $("themeToggle");
  b.setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme");
  b.setAttribute("aria-pressed", String(t === "dark"));
  document.querySelector('meta[name="theme-color"]').content = t === "dark" ? (root.dataset.design === "1" ? "#0E1628" : "#070B14") : "#FFFFFF";
  syncHead(); readPalette(); window.dispatchEvent(new Event("themechange"));
  setTimeout(() => root.classList.remove("theme-anim"), 420);
}
$("themeToggle").addEventListener("click", () => { const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; applyTheme(t); track("theme_" + t); });
if (document.documentElement.dataset.theme === "dark") { $("themeToggle").setAttribute("aria-label", "Switch to light theme"); $("themeToggle").setAttribute("aria-pressed", "true"); }

/* ---------- signature: the sequencer ---------- */
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const seg = (p, a, b) => clamp((p - a) / (b - a));
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const lerp = (a, b, t) => a + (b - a) * t;
const F_SANS = '"Instrument Sans", system-ui, sans-serif', F_SERIF = '"Instrument Sans", system-ui, sans-serif';
// Canvas colors come from the design tokens (--cv-*), so the demo follows light and dark. "r,g,b" strings are used where the alpha changes per frame.
let P;
function readPalette(){
  const c = getComputedStyle(document.documentElement), v = k => c.getPropertyValue(k).trim();
  P = { light: true, a: v("--cv-a"), b: v("--cv-b"), rung: v("--cv-rung"), text: v("--cv-text"), text2: v("--cv-text2"),
    lvl: { verified: v("--cv-ver"), inferred: v("--cv-inf"), potential: v("--cv-pot") }, glowV: v("--cv-a"), glowI: v("--cv-a"), mode: "source-over", glowK: .4,
    dust: v("--cv-a"), dustK: .45, trail: v("--cv-a"), dot: v("--cv-inf"), dir: v("--cv-dir"), dirSolid: v("--cv-dir-solid"), cur: v("--cv-cur"), curSolid: v("--cv-cur-solid"),
    shadow: "rgba(0,0,0,.16)", edge: "rgba(0,0,0,.12)", scan: v("--cv-cur"), hot: v("--cv-a"), flash: v("--cv-a"), flashK: .1 };
}
readPalette();

// A double helix along any axis. Returns where the highlighted rungs are, so labels and flying lines can find them.
function drawDNA(ctx, o){
  const dx = o.x1 - o.x0, dy = o.y1 - o.y0, len = Math.hypot(dx, dy) || 1, px = -dy / len, py = dx / len;
  const pt = (t, off) => { const th = t * o.cycles * TAU + o.rot + off, s = Math.sin(th); return { x: o.x0 + dx * t + px * o.amp * s, y: o.y0 + dy * t + py * o.amp * s, z: Math.cos(th) }; };
  const reveal = o.reveal ?? 1, a = o.alpha ?? 1, N = 170, back = [], front = [];
  for (const off of [0, Math.PI]) for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N; if (t0 >= reveal) break;
    const p0 = pt(t0, off), p1 = pt(Math.min(t1, reveal), off), z = (p0.z + p1.z) / 2;
    (z < 0 ? back : front).push([p0, p1, z, off]);
  }
  const strands = list => { for (const [p0, p1, z, off] of list) {
    const d = (z + 1) / 2;
    ctx.strokeStyle = off ? `rgba(${P.b},${(.16 + .74 * d) * a})` : `rgba(${P.a},${(.16 + .78 * d) * a})`;
    ctx.lineWidth = 1 + 2.8 * d; ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
  } };
  ctx.lineCap = "round";
  strands(back);
  const out = [];
  const plain = o.plain || 26;
  for (let j = 0; j < plain; j++) {
    const t = (j + .5) / plain; if (t > reveal) break;
    const A = pt(t, 0), B = pt(t, Math.PI);
    ctx.strokeStyle = `rgba(${P.rung},${.12 * a})`; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  }
  for (const r of o.rungs || []) {
    if (r.t > reveal) continue;
    const A = pt(r.t, 0), B = pt(r.t, Math.PI), base = { x: o.x0 + dx * r.t, y: o.y0 + dy * r.t };
    out.push({ ...r, base, A, B });
    if (!r.on) continue;
    const col = P.lvl[r.kind] || P.text;
    ctx.save(); ctx.globalCompositeOperation = P.mode;
    const g = ctx.createRadialGradient(base.x, base.y, 0, base.x, base.y, 26 + 30 * (r.pulse || 0));
    g.addColorStop(0, r.kind === "inferred" ? `rgba(${P.glowI},${.45 * a * P.glowK})` : `rgba(${P.glowV},${.4 * a * P.glowK})`); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(base.x, base.y, 26 + 30 * (r.pulse || 0), 0, TAU); ctx.fill(); ctx.restore();
    ctx.strokeStyle = col; ctx.globalAlpha = a; ctx.lineWidth = 3;
    if (r.kind === "inferred") ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.setLineDash([]);
    for (const P of [A, B]) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(P.x, P.y, 3.2, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  strands(front);
  return { out, end: pt(1, 0), axisEnd: { x: o.x1, y: o.y1 }, px, py };
}

// Sizes can come out negative when the page is squeezed or its styles failed to load; draw nothing odd, never throw.
function roundRect(ctx, x, y, w, h, r){ w = Math.max(0, w); h = Math.max(0, h); r = Math.max(0, Math.min(r, w / 2, h / 2)); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function wrapText(ctx, text, width){ const out = []; let line = ""; for (const w of text.split(" ")) { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > width && line) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out; }
function cut(ctx, text, width){ if (ctx.measureText(text).width <= width) return text; while (text.length > 4 && ctx.measureText(text + "…").width > width) text = text.slice(0, -1); return text.trimEnd() + "…"; }
function pill(ctx, text, x, y, size, alpha, col){
  ctx.font = `500 ${size}px ${F_SANS}`; const w = ctx.measureText(text).width + size * 1.4, h = size * 2;
  const cw = ctx.canvas.width / (ctx.getTransform().a || 1); x = Math.max(w / 2 + 8, Math.min(cw - w / 2 - 8, x));
  ctx.globalAlpha = alpha; ctx.fillStyle = "rgba(11,21,40,.92)"; roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, x, y + .5);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.globalAlpha = 1;
}
function bezier(a, c1, c2, b, t){ const u = 1 - t; return { x: u*u*u*a.x + 3*u*u*t*c1.x + 3*u*t*t*c2.x + t*t*t*b.x, y: u*u*u*a.y + 3*u*u*t*c1.y + 3*u*t*t*c2.y + t*t*t*b.y }; }
function makeDust(n){ const r = seeded("trazerr-dust"); return Array.from({ length: n }, () => ({ x: r(), y: r(), s: .5 + r() * 1.6, a: .08 + r() * .3, v: .2 + r() * .8 })); }
function drawDust(ctx, dust, W, H, time, drift){
  for (const d of dust) { const y = ((d.y - time * .004 * d.v - drift * d.v * .3) % 1 + 1) % 1; ctx.fillStyle = `rgba(${P.dust},${d.a * P.dustK})`; ctx.beginPath(); ctx.arc(d.x * W, y * H, d.s, 0, TAU); ctx.fill(); }
}

(() => {
  const sec = $("sequence"); if (!sec) return;
  const cv = $("seqCanvas"), ctx = cv.getContext("2d"), steps = sec.querySelectorAll(".seq-steps li"), note = $("seqNote"), replay = $("seqReplay");
  const NOTES = ["Example: this is Dana's resume. Like most, it undersells her.", "Trazerr finds the lines that show what she can do.", "Each one becomes a strength in her Career DNA, and points to where she can go next."];
  let started = false, playing = false, elapsed = 0, last = 0;
  // Dana's resume, from the example. Evidence lines point at the strength they prove, in the order they leave the page.
  const EVID = [
    { name: "Territory development", level: "verified" },
    { name: "Quota performance", level: "verified" },
    { name: "Training and onboarding", level: "verified" },
    { name: "Early team leadership", level: "inferred" },
    { name: "Negotiation", level: "inferred" }
  ];
  const RES = [
    ["name", "Dana Whitfield"], ["sub", "Sales Representative · Newark, NJ"], ["rule"],
    ["head", "EXPERIENCE"], ["job", "Account Executive, Northline Supply", "2019 – now"],
    ["b", "Opened the Northeast territory and grew it to 60 active accounts.", 0],
    ["b", "Reached 118% of annual quota in 2023 and 2024.", 1],
    ["b", "Trained four new sales hires in their first 90 days.", 2],
    ["b", "Presented quarterly results to the regional team."],
    ["b", "Covered regional manager duties during a 3-month leave.", 3],
    ["job", "Sales Associate, Harbor Office Co.", "2017 – 2019"],
    ["b", "Managed renewals and pricing for 40 small-business clients.", 4],
    ["b", "Answered inbound leads and booked product demos."],
    ["head", "EDUCATION"], ["t", "B.A. Communications, Rutgers University"],
    ["head", "SKILLS"], ["t", "Salesforce · Outreach · Excel · Forecasting"]
  ];
  const DIRS = [
    { role: "Senior sales rep", tag: "Where you are", kind: "current" },
    { role: "Sales team lead", tag: "Worth exploring", kind: "dir" },
    { role: "Sales enablement", tag: "Worth exploring", kind: "dir" }
  ];
  const dust = makeDust(90);
  let W = 0, H = 0, dpr = 1, L = null, paper = null, visible = false, raf = 0, prog = 0, shown = -1;
  const start = performance.now();
  const isStatic = reduceMotion;
  if (isStatic) sec.classList.add("static");

  // The page is drawn once at design size (360 wide), then scaled.
  function buildPaper(pw){
    const s = pw / 360, c = document.createElement("canvas"), x = c.getContext("2d");
    const lines = []; let y = 30;
    const put = (font, text, yy, extra) => lines.push({ font, text, y: yy, ...extra });
    for (const r of RES) {
      if (r[0] === "name") { y += 24; put(`500 25px ${F_SERIF}`, r[1], y, { col: "#15203A" }); y += 18; }
      else if (r[0] === "sub") { put(`400 11.5px ${F_SANS}`, r[1], y, { col: "#4A5470" }); y += 14; }
      else if (r[0] === "rule") { lines.push({ rule: true, y }); y += 20; }
      else if (r[0] === "head") { y += 6; put(`600 9.5px ${F_SANS}`, r[1], y, { col: "#B07A28", spacing: 1.6 }); y += 18; }
      else if (r[0] === "job") { put(`600 12px ${F_SANS}`, r[1], y, { col: "#15203A", right: r[2] }); y += 17; }
      else if (r[0] === "t") { put(`400 11px ${F_SANS}`, r[1], y, { col: "#4A5470" }); y += 17; }
      else if (r[0] === "b") {
        x.font = `400 11px ${F_SANS}`; const wl = wrapText(x, r[1], 280), top = y - 11;
        wl.forEach((t, i) => put(`400 11px ${F_SANS}`, t, y + i * 15, { col: "#2A3450", indent: 14, bullet: i === 0 }));
        if (r[2] !== undefined) EVID[r[2]].rect = { x: 36, y: top, w: 292, h: wl.length * 15 + 3 }, EVID[r[2]].text = r[1];
        y += wl.length * 15 + 5;
      }
    }
    const ph = (y + 18) * s;
    c.width = Math.round(pw * dpr); c.height = Math.round(ph * dpr);
    x.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
    x.fillStyle = "#FBFAF6"; roundRect(x, 0, 0, 360, ph / s, 10); x.fill();
    for (const l of lines) {
      if (l.rule) { x.fillStyle = "#E3E1DA"; x.fillRect(30, l.y, 300, 1); continue; }
      x.font = l.font; x.fillStyle = l.col; if ("letterSpacing" in x) x.letterSpacing = (l.spacing || 0) + "px";
      if (l.bullet) { x.beginPath(); x.arc(34, l.y - 4, 1.6, 0, TAU); x.fill(); }
      x.fillText(l.text, 30 + (l.indent || 0), l.y);
      if (l.right) { x.font = `400 10.5px ${F_SANS}`; x.fillStyle = "#8A91A3"; x.textAlign = "right"; x.fillText(l.right, 330, l.y); x.textAlign = "left"; }
    }
    if ("letterSpacing" in x) x.letterSpacing = "0px";
    return { c, pw, ph, s };
  }

  function layout(){
    const r = cv.getBoundingClientRect(); W = r.width; H = r.height; dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const capB = sec.querySelector(".seq-caps").getBoundingClientRect().bottom - r.top + 22;
    const portrait = W < 1100 || W / H < 1.15;
    const avail = H - capB - 34;
    if (!portrait) {
      const ratio = buildPaper(360).ph / 360;
      let ph = Math.min(avail, 560), pw = Math.min(ph / ratio, W * .28); ph = pw * ratio;
      const cy = capB + avail / 2, px = Math.max(40, W * .06);
      paper = buildPaper(pw);
      const x0 = px + pw + Math.max(70, W * .06), x1 = W * .76;
      L = { portrait, px, py: cy - ph / 2, cy, x0, y0: cy, x1, y1: cy, amp: clamp(avail * .17, 48, 104), cycles: 2.2,
        targets: DIRS.map((d, i) => ({ x: x1 + W * .07, y: cy + (i - 1) * Math.max(110, avail * .24) })) };
    } else {
      const ratio = buildPaper(360).ph / 360;
      let pw = Math.min(W - 48, 330), ph = pw * ratio; if (ph > avail - 10) { ph = avail - 10; pw = ph / ratio; }
      paper = buildPaper(pw);
      const ax = Math.max(40, W * .15), bottom = H - Math.max(196, H * .23);
      L = { portrait, px: (W - pw) / 2, py: capB + 6, x0: ax, y0: capB + 12, x1: ax, y1: bottom, amp: clamp(W * .1, 28, 46), cycles: 2.4,
        targets: DIRS.map((d, i) => ({ x: W * (.18 + i * .32), y: H - Math.max(136, H * .16) })) };
    }
    EVID.forEach((e, k) => { e.t = .1 + k * (.8 / (EVID.length - 1)); });
  }

  function frame(now){
    raf = 0; if (!L) return;
    const dt = last ? Math.min(.1, (now - last) / 1000) : 0; last = now;
    if (playing) { elapsed += dt; if (elapsed > 10.2) { playing = false; replay.hidden = false; } }
    prog = clamp((elapsed - 1.4) / 8.4);
    const time = (now - start) / 1000, p = isStatic ? 1 : prog;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    drawDust(ctx, dust, W, H, isStatic ? 0 : time, p * 2);

    // the page
    const pa = L.portrait ? 1 - seg(p, .3, .42) : 1;
    const ox = L.portrait ? 0 : ((W - paper.pw) / 2 - L.px) * (1 - ease(seg(p, .15, .3))), rot = 0;
    const px = L.px + ox, py = L.py;
    if (pa > .01) {
      ctx.save(); ctx.globalAlpha = pa;
      ctx.translate(px + paper.pw / 2, py + paper.ph / 2); ctx.rotate(rot); ctx.translate(-paper.pw / 2, -paper.ph / 2);
      ctx.shadowColor = P.shadow; ctx.shadowBlur = 50; ctx.shadowOffsetY = 24;
      ctx.drawImage(paper.c, 0, 0, paper.pw, paper.ph); ctx.shadowColor = "transparent";
      if (P.edge) { ctx.strokeStyle = P.edge; ctx.lineWidth = 1; roundRect(ctx, .5, .5, paper.pw - 1, paper.ph - 1, 10 * paper.s); ctx.stroke(); }
      EVID.forEach((e, k) => {
        const h = seg(p, .14 + k * .03, .19 + k * .03), f = seg(p, .27 + k * .035, .4 + k * .035), R = e.rect, s = paper.s;
        const rx = R.x * s, ry = R.y * s, rw = R.w * s, rh = R.h * s;
        if (h > 0 && f < 1) { ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = `rgba(255,208,120,${.85 * h * (1 - f)})`; roundRect(ctx, rx - 3, ry, rw * h + 6, rh, 3); ctx.fill(); ctx.globalCompositeOperation = "source-over"; }
        if (f > 0) {
          ctx.fillStyle = `rgba(251,250,246,${Math.min(1, f * 1.6)})`; ctx.fillRect(rx - 4, ry - 1, rw + 8, rh + 2);
          ctx.strokeStyle = `rgba(176,122,40,${.5 * f})`; ctx.setLineDash([3, 4]); ctx.lineWidth = 1; roundRect(ctx, rx - 2, ry + 1, rw + 4, rh - 2, 3); ctx.stroke(); ctx.setLineDash([]);
        }
      });
      ctx.restore();
    }

    // the helix
    const ha = L.portrait ? ease(seg(p, .3, .44)) : ease(seg(p, .18, .36)), reveal = L.portrait ? ease(seg(p, .3, .52)) : ease(seg(p, .18, .5));
    const rungs = EVID.map((e, k) => { const land = .4 + k * .035; return { t: e.t, kind: e.level, on: p >= land, pulse: 1 - seg(p, land, land + .06), land, k }; });
    const hx = drawDNA(ctx, { x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1, amp: L.amp, cycles: L.cycles, rot: (isStatic ? 0 : time * .3) + p * 4, alpha: ha, reveal, rungs, plain: 28 });

    // strength labels
    ctx.textBaseline = "alphabetic";
    for (const r of hx.out) {
      const la = seg(p, r.land, r.land + .04) * ha; if (la <= 0) continue;
      const e = EVID[r.k], col = P.lvl[e.level];
      let lx, ly, align;
      if (L.portrait) { lx = L.x0 + L.amp + 22; ly = r.base.y + 4; align = "left"; }
      else { const side = r.k % 2 ? 1 : -1; lx = r.base.x; ly = r.base.y + side * (L.amp + 40) + (side > 0 ? 10 : 0); align = "center"; }
      ctx.globalAlpha = la * .6; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([2, 4]); ctx.beginPath();
      if (L.portrait) { ctx.moveTo(L.x0 + L.amp + 6, r.base.y); ctx.lineTo(lx - 6, r.base.y); }
      else { const side = r.k % 2 ? 1 : -1; ctx.moveTo(r.base.x, r.base.y + side * (L.amp + 6)); ctx.lineTo(r.base.x, ly - (side > 0 ? 24 : -8)); }
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = la;
      ctx.textAlign = align; ctx.font = `600 ${L.portrait ? 14 : 13.5}px ${F_SANS}`; ctx.fillStyle = P.text;
      ctx.fillText(e.name, lx, L.portrait ? ly - 4 : ly - 6);
      ctx.font = `500 11.5px ${F_SANS}`; ctx.fillStyle = col;
      ctx.fillText(e.level === "inferred" ? "Between the lines" : !L.portrait ? "On resume" : "On resume · " + (e.text || "").replace(/\.$/, "").split(" ").slice(0, 4).join(" ") + "…", lx, L.portrait ? ly + 13 : ly + 11);
      ctx.globalAlpha = 1; ctx.textAlign = "left";
    }

    // lines in flight, from the page to their rung
    EVID.forEach((e, k) => {
      const f = seg(p, .27 + k * .035, .4 + k * .035); if (f <= 0 || f >= 1) return;
      const R = e.rect, s = paper.s, from = { x: px + (R.x + 60) * s, y: py + (R.y + 7) * s };
      const to = hx.out.find(r => r.k === k)?.base || { x: L.x0, y: L.y0 };
      const c1 = L.portrait ? { x: from.x + 40, y: from.y + 40 } : { x: from.x + 120, y: from.y - 120 };
      const c2 = L.portrait ? { x: to.x + 120, y: to.y - 40 } : { x: to.x - 40, y: to.y - 140 };
      const q = bezier(from, c1, c2, to, ease(f));
      for (let i = 1; i <= 6; i++) { const tq = bezier(from, c1, c2, to, ease(Math.max(0, f - i * .025))); ctx.fillStyle = `rgba(${P.trail},${.28 - i * .04})`; ctx.beginPath(); ctx.arc(tq.x, tq.y, 3 - i * .35, 0, TAU); ctx.fill(); }
      ctx.save(); ctx.globalCompositeOperation = P.mode;
      const glow = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, 16); glow.addColorStop(0, e.level === "inferred" ? `rgba(${P.glowI},${.8 * P.glowK})` : `rgba(${P.trail},${.8 * P.glowK})`); glow.addColorStop(1, `rgba(${P.trail},0)`);
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(q.x, q.y, 16, 0, TAU); ctx.fill();
      ctx.fillStyle = P.dot; ctx.beginPath(); ctx.arc(q.x, q.y, 3.2, 0, TAU); ctx.fill(); ctx.restore();
    });

    // where it leads
    const E = { x: L.x1, y: L.y1 };
    DIRS.forEach((d, i) => {
      const b = ease(seg(p, .72 + i * .045, .86 + i * .045)); if (b <= 0) return;
      const T = L.targets[i];
      const c1 = L.portrait ? { x: E.x, y: E.y + 40 } : { x: E.x + 70, y: E.y };
      const c2 = L.portrait ? { x: T.x, y: T.y - 50 } : { x: T.x - 70, y: T.y };
      const gold = d.kind === "dir";
      for (const [w, a] of gold ? [[8, .12], [2.2, .95]] : [[1.6, .6]]) {
        ctx.strokeStyle = gold ? `rgba(${P.dir},${a})` : `rgba(${P.cur},${a})`; ctx.lineWidth = w; ctx.beginPath();
        for (let j = 0; j <= 40; j++) { const q = bezier(E, c1, c2, T, b * j / 40); j ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); } ctx.stroke();
      }
      const tip = bezier(E, c1, c2, T, b);
      ctx.fillStyle = gold ? P.dirSolid : P.curSolid; ctx.beginPath(); ctx.arc(tip.x, tip.y, 4.5, 0, TAU); ctx.fill();
      if (!isStatic && b >= 1) { const q = bezier(E, c1, c2, T, (time * .45 + i * .3) % 1); ctx.fillStyle = gold ? `rgba(${P.dir},.9)` : `rgba(${P.cur},.7)`; ctx.beginPath(); ctx.arc(q.x, q.y, 2, 0, TAU); ctx.fill(); }
      const la = seg(b, .8, 1); if (la <= 0) return;
      ctx.globalAlpha = la;
      if (L.portrait) {
        ctx.textAlign = "center"; ctx.font = `500 ${W < 420 ? 14.5 : 16}px ${F_SERIF}`; ctx.fillStyle = P.text; ctx.fillText(d.role, T.x, T.y + 24);
        ctx.font = `600 10.5px ${F_SANS}`; ctx.fillStyle = gold ? P.dirSolid : P.text2; ctx.fillText(d.tag.toUpperCase(), T.x, T.y + 40); ctx.textAlign = "left";
      } else {
        ctx.font = `600 11px ${F_SANS}`; ctx.fillStyle = gold ? P.dirSolid : P.text2; ctx.fillText(d.tag.toUpperCase(), T.x + 16, T.y - 8);
        ctx.font = `500 22px ${F_SERIF}`; ctx.fillStyle = P.text; ctx.fillText(d.role, T.x + 16, T.y + 14);
      }
      ctx.globalAlpha = 1;
    });

    // which step we're on
    const idx = isStatic ? 2 : p < .14 ? 0 : p < .56 ? 1 : 2;
    if (idx !== shown) { shown = idx; steps.forEach((li, i) => { li.classList.toggle("on", i === idx); li.classList.toggle("done", i < idx); }); note.textContent = NOTES[idx]; }
    if (visible && !isStatic) raf = requestAnimationFrame(frame); else last = 0;
  }

  function kick(){ if (!raf) raf = requestAnimationFrame(frame); }
  // Plays once, by itself, when most of it is on screen. It pauses while scrolled away.
  const io = new IntersectionObserver(es => {
    const e = es[es.length - 1]; visible = e.isIntersecting;
    if (!started && e.intersectionRatio >= .45) { started = true; playing = true; }
    if (visible) kick();
  }, { threshold: [0, .45] });
  io.observe(sec);
  replay.addEventListener("click", () => { elapsed = 0; playing = true; replay.hidden = true; kick(); });
  window.addEventListener("resize", () => { layout(); kick(); });
  window.addEventListener("themechange", () => { if (L) kick(); });
  const go = () => { layout(); kick(); };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(go); else go();
})();

/* ---------- signature: your own resume, sequenced while you wait ---------- */
window.Seqlay = (() => {
  const el = $("seqlay"); if (!el || reduceMotion) return null;
  const cv = $("seqlayCanvas"), ctx = cv.getContext("2d"), dust = makeDust(70);
  const PROOF = /\d|\b(led|lead|built|grew|grow|managed|trained|launched|increased|reduced|cut|created|designed|developed|improved|delivered|opened|won|saved|owned|shipped|started|founded|negotiat|mentor|coached|supervis|oversaw|achiev|exceed|award|certif|licensed)/i;
  let W, H, dpr, lines = [], running = false, t0 = 0, raf = 0, flyers = [], lit = [], nextRung = 0, fired = new Set(), done = 0, loopN = 0, found = 0;
  const RUNGS = 22;

  function prepare(payload){
    let src = [];
    if (payload && payload.kind === "text") src = payload.text.split(/\r?\n/).map(s => s.replace(/\s+/g, " ").trim()).filter(s => s.length > 2);
    if (src.length < 6) { const r = seeded("pdf"); src = Array.from({ length: 36 }, (_, i) => ({ bar: .35 + r() * .6, proof: i % 3 === 1 })); }
    lines = src.map(s => typeof s === "string" ? { text: s.length > 90 ? s.slice(0, 88) + "…" : s, proof: PROOF.test(s) && s.length > 24 } : s);
  }
  function size(){ const r = el.getBoundingClientRect(); W = r.width; H = r.height; dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  function geo(){
    const wide = W >= 900;
    return wide ? { lx0: W * .08, lx1: W * .42, ly0: H * .3, ly1: H * .92, scan: H * .62, hx0: W * .52, hx1: W * .92, hy: H * .62, amp: Math.min(80, H * .1) }
                : { lx0: 22, lx1: W - 22, ly0: H * .27, ly1: H * .56, scan: H * .5, hx0: W * .08, hx1: W * .92, hy: H * .75, amp: Math.min(48, W * .11) };
  }
  function frame(now){
    raf = 0; if (!running) return;
    const t = (now - t0) / 1000, g = geo();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    drawDust(ctx, dust, W, H, t * 6, 0);
    // the resume scrolling past the scan line
    const LH = W >= 900 ? 22 : 19, total = lines.length * LH, off = t * (W >= 900 ? 34 : 28) + (g.ly1 - g.ly0) * .55;
    ctx.save(); ctx.beginPath(); ctx.rect(g.lx0 - 10, g.ly0, g.lx1 - g.lx0 + 20, g.ly1 - g.ly0); ctx.clip();
    ctx.font = `400 ${W >= 900 ? 13 : 12}px ${F_SANS}`;
    const first = Math.floor((off - (g.ly1 - g.ly0)) / LH) - 1;
    for (let n = Math.max(0, first); n < first + Math.ceil((g.ly1 - g.ly0) / LH) + 3; n++) {
      const i = n % lines.length, ln = lines[i], y = g.ly1 - (off - n * LH);
      if (y < g.ly0 - LH || y > g.ly1 + LH) continue;
      const near = 1 - Math.min(1, Math.abs(y - g.scan) / (H * .25));
      const passed = y < g.scan;
      const key = n;
      if (ln.proof && passed && !fired.has(key) && y > g.scan - LH * 2) {
        fired.add(key); found++;
        flyers.push({ text: ln.text || "", from: { x: g.lx0 + 60, y }, t: t, rung: nextRung, inf: found % 3 === 0 });
        nextRung = (nextRung + 7) % RUNGS;
      }
      const hot = ln.proof && passed;
      if (ln.bar) { ctx.fillStyle = hot ? `rgba(${P.hot},.55)` : `rgba(${P.scan},${.1 + .25 * near})`; roundRect(ctx, g.lx0, y - 9, (g.lx1 - g.lx0) * ln.bar, 7, 3.5); ctx.fill(); }
      else { ctx.fillStyle = hot ? `rgba(${P.hot},.95)` : `rgba(${P.scan},${.28 + .55 * near})`; ctx.fillText(cut(ctx, ln.text, g.lx1 - g.lx0), g.lx0, y); }
    }
    ctx.restore();
    const sg = ctx.createLinearGradient(g.lx0, 0, g.lx1, 0); sg.addColorStop(0, "rgba(92,168,255,0)"); sg.addColorStop(.5, "rgba(92,168,255,.8)"); sg.addColorStop(1, "rgba(92,168,255,0)");
    ctx.fillStyle = sg; ctx.fillRect(g.lx0 - 10, g.scan, g.lx1 - g.lx0 + 20, 1.5);
    // the helix, lighting up as evidence arrives
    const rungs = Array.from({ length: RUNGS }, (_, i) => ({ t: (i + .5) / RUNGS, kind: lit[i] || "verified", on: !!lit[i] || done > 0, pulse: 0 }));
    const hx = drawDNA(ctx, { x0: g.hx0, y0: g.hy, x1: g.hx1, y1: g.hy, amp: g.amp * (1 + .15 * ease(Math.min(1, done))), cycles: 2.6, rot: t * .9, alpha: seg(t, 0, 1.2), reveal: ease(seg(t, .1, 2.4)), rungs, plain: 1 });
    flyers = flyers.filter(f => {
      const k = (t - f.t) / 1.15; if (k >= 1) { lit[f.rung] = f.inf ? "inferred" : "verified"; return false; }
      const target = hx.out[f.rung]?.base || { x: g.hx0, y: g.hy };
      const c1 = W >= 900 ? { x: f.from.x + 200, y: f.from.y - 160 } : { x: f.from.x + 60, y: f.from.y + 60 }, c2 = { x: target.x, y: target.y - (W >= 900 ? 160 : 60) };
      const q = bezier(f.from, c1, c2, target, ease(k)), sh = ease(seg(k, .5, 1));
      ctx.font = `500 12px ${F_SANS}`;
      if (f.text && sh < .9) pill(ctx, cut(ctx, f.text, W >= 900 ? 280 : W * .6), q.x, q.y, lerp(12, 7, sh), 1 - sh, f.inf ? P.lvl.inferred : P.dirSolid);
      ctx.save(); ctx.globalCompositeOperation = P.mode; ctx.fillStyle = P.light ? P.dot : "rgba(255,220,160,.95)"; ctx.beginPath(); ctx.arc(q.x, q.y, 2 + 3 * sh, 0, TAU); ctx.fill(); ctx.restore();
      return true;
    });
    $("seqlayCount").textContent = found ? `${found} ${found === 1 ? "strength" : "strengths"} spotted` : "";
    if (done) { done = Math.min(1.001, done + .03); ctx.fillStyle = `rgba(${P.flash},${P.flashK * Math.sin(Math.min(1, done) * Math.PI)})`; ctx.fillRect(0, 0, W, H); }
    raf = requestAnimationFrame(frame);
  }
  function start(payload){
    prepare(payload); flyers = []; lit = []; nextRung = 3; fired = new Set(); done = 0; found = 0;
    $("seqlayStep").textContent = "Reading your resume"; $("seqlayBar").style.width = "6%";
    el.hidden = false; size(); running = true; t0 = performance.now(); raf = requestAnimationFrame(frame);
    requestAnimationFrame(() => el.classList.add("on"));
  }
  function step(text, pct){ if (!running) return; $("seqlayStep").textContent = text.replace(/^Step \d of \d · /, "").replace(/…$/, ""); $("seqlayBar").style.width = pct + "%"; }
  function stop(){ running = false; cancelAnimationFrame(raf); el.classList.remove("on"); setTimeout(() => { if (!running) el.hidden = true; }, 460); }
  function finish(ok){
    if (!running) return;
    if (!ok) { stop(); return; }
    $("seqlayStep").textContent = "Your Career DNA is ready"; $("seqlayBar").style.width = "100%"; done = .001;
    setTimeout(stop, 900);
  }
  $("seqlayHide").addEventListener("click", stop);
  window.addEventListener("resize", () => { if (running) size(); });
  return { start, step, finish };
})();

/* ---------- accounts: optional saving to a Trazerr account (Supabase) ----------
   Sign-in is an emailed link, no password. Nothing is stored in an account until the person chooses
   "Save to my account". The database only lets each signed-in person read and change their own row. */
// Accounts stay hidden until Supabase setup is finished (return addresses, table, email sender). Then set to true.
const ACCOUNTS_ON = true;
const SB_LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js", SB_LIB_SRI = "sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok";
const SB_STORE = "trazerr.auth", PENDING_KEY = "trazerr.pendingAccountSave", TALENT_PENDING = "trazerr.pendingTalent";
const linkHash = /access_token=|error_description=/.test(location.hash) ? new URLSearchParams(location.hash.slice(1)) : null;
let sb = null, sbUser = null, sbLoading = null, acctRecord, signinHandled = false;
function hadSession(){ try { return !!localStorage.getItem(SB_STORE); } catch (e) { return false; } }
function acct(){
  if (!sbLoading) sbLoading = (async () => {
    const cfg = await api("authconfig");
    if (!window.supabase) { try { await loadScript(SB_LIB, SB_LIB_SRI); } catch (e) { throw new Error("Sign-in couldn't load. Check your connection and try again."); } }
    sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { storageKey: SB_STORE, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" } });
    const { data } = await sb.auth.getSession();
    sbUser = data && data.session ? data.session.user : null;
    sb.auth.onAuthStateChange((event, session) => {
      sbUser = session ? session.user : null; paintAcctBtn();
      if (event === "SIGNED_OUT") acctRecord = undefined;
    });
    paintAcctBtn();
    return sb;
  })().catch(e => { sbLoading = null; throw e; });
  return sbLoading;
}
function paintAcctBtn(){
  const b = $("acctBtn"), i = $("acctInitial");
  const email = sbUser && sbUser.email ? sbUser.email : "";
  b.classList.toggle("on", !!sbUser);
  b.setAttribute("aria-label", sbUser ? "Your account, signed in as " + email : "Sign in");
  i.textContent = email ? email[0].toUpperCase() : ""; i.hidden = !sbUser;
}
async function fetchRecord(withResume){
  const { data, error } = await sb.from("career_records").select(withResume ? "career_dna, resume, updated_at" : "career_dna, updated_at").maybeSingle();
  if (error) throw new Error("Your saved Career DNA couldn't be loaded. Try again in a moment.");
  if (!withResume) acctRecord = data || null;
  return data || null;
}
async function saveToAccount(p, resume){
  if (!sbUser) return false;
  const row = { user_id: sbUser.id, career_dna: p, resume: resume || null, updated_at: new Date().toISOString() };
  const { error } = await sb.from("career_records").upsert(row, { onConflict: "user_id" });
  if (error) return false;
  acctRecord = { career_dna: p, updated_at: row.updated_at }; track("account_saved");
  return true;
}
// Back from the emailed link: finish a save that was waiting, or bring saved work to this device.
async function afterSignIn(){
  if (signinHandled) return; signinHandled = true;
  let back = ""; try { back = localStorage.getItem("trazerr.signinReturn") || ""; localStorage.removeItem("trazerr.signinReturn"); } catch (e) {}
  if (back === "/employers.html") return location.replace(back);
  track("account_signed_in");
  let alertNote = "", pa = null;
  try { pa = JSON.parse(localStorage.getItem(ALERT_PENDING) || "null"); localStorage.removeItem(ALERT_PENDING); } catch (e) {}
  if (pa && pa.query) alertNote = " " + (await addAlert(pa)).text;
  let pending = false; try { pending = localStorage.getItem(PENDING_KEY) === "1"; localStorage.removeItem(PENDING_KEY); } catch (e) {}
  const local = loadSaved();
  let talent = false; try { talent = localStorage.getItem(TALENT_PENDING) === "1"; localStorage.removeItem(TALENT_PENDING); } catch (e) {}
  if (pending && local) return openAccount({ startTalent: talent, note: ((await saveToAccount(local, loadResume())) ? "You're signed in, and your Career DNA is saved to your account." : "You're signed in, but the save didn't go through. Try Save again below.") + alertNote });
  try {
    const rec = await fetchRecord(true);
    if (rec && !local) { saveProfile(normalize(rec.career_dna)); if (rec.resume) saveResume(rec.resume); resumeSrc = loadResume(); setProfile(loadSaved()); }
  } catch (e) {}
  openAccount({ note: "You're signed in." + alertNote, tab: alertNote ? "alerts" : undefined });
}
function fmtDate(iso){ try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }); } catch (e) { return ""; } }
async function openAccount(o){
  o = o || {};
  if (!sbUser) {
    let h = '<span class="flag">Your account</span><h2 class="o-headline">Sign in to Trazerr</h2>';
    h += '<p class="greet" style="margin-top:10px">' + esc(o.intro || "Save your Career DNA and resume to an account and use them on any device. We'll email you a sign-in link, so there's no password to remember.") + "</p>";
    if (o.note) h += '<p class="saved-note">' + esc(o.note) + "</p>";
    h += '<form class="t-field" id="signinForm" novalidate><label for="siEmail">Email address</label><div class="goal-form"><input class="input" id="siEmail" type="email" autocomplete="email" required placeholder="you@example.com"><button class="btn btn-primary" type="submit" id="siBtn">Email me a sign-in link</button></div></form>';
    h += '<p class="status" id="siStatus" role="status" aria-live="polite"></p>';
    h += '<p class="o-note">Nothing goes into your account until you choose "Save to my account" on a result, and you can delete it all any time. <a href="/privacy.html">Privacy policy</a></p>';
    openOverlay("Your account", h);
    $("signinForm").onsubmit = async e => {
      e.preventDefault();
      const email = $("siEmail").value.trim(), st = $("siStatus"), btn = $("siBtn");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setStatus(st, "Enter a valid email address, like name@example.com.", true); $("siEmail").focus(); return; }
      btn.disabled = true; setStatus(st, "Sending…");
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
      btn.disabled = false;
      const why = String(error && error.message || "").toLowerCase();
      if (error) setStatus(st, error.status === 429 || /security purposes|rate limit|seconds/.test(why) ? "A sign-in link was sent just now. Wait a minute, then try again."
        : !error.status ? "Couldn't connect. Check your internet connection and try again."
        : /invalid|email/.test(why) && error.status === 400 ? "That email address doesn't look right. Check it and try again."
        : "That didn't go through. Try again in a moment.", true);
      else setStatus(st, "Check your email. We sent a sign-in link to " + email + ". Open it on this device. It works once and expires after an hour.");
    };
    return;
  }
  let rec = acctRecord;
  if (rec === undefined) { openOverlay("Your account", loadingHTML("Loading your account…")); try { rec = await fetchRecord(false); } catch (e) { rec = null; o.note = e.message; } }
  const local = loadSaved();
  let h = '<span class="flag">Your account</span><h2 class="o-headline">Signed in</h2><p class="greet" style="margin-top:6px">as <b>' + esc(sbUser.email || "") + "</b></p>";
  if (o.note) h += '<p class="saved-note">' + esc(o.note) + "</p>";
  // Four tabs keep the panel short: what's saved, employers, job alerts, and account settings.
  const tab = o.tab || (o.startTalent || o.focus === "requests" ? "employers" : "dna");
  const TABS = [["dna", "Career DNA"], ["employers", "Employers"], ["alerts", "Job alerts"], ["settings", "Settings"]];
  h += '<div class="acct-tabs" role="tablist" aria-label="Your account">' + TABS.map(([k, l]) => '<button type="button" role="tab" id="tab-' + k + '" aria-controls="panel-' + k + '" aria-selected="' + (k === tab) + '" tabindex="' + (k === tab ? 0 : -1) + '">' + l + (k === "employers" ? '<span class="tab-badge" id="reqBadge" hidden></span>' : "") + "</button>").join("") + "</div>";
  h += '<p class="o-note acct-note" id="acctNote" role="status" aria-live="polite"></p>';
  const panel = (k, inner) => '<div class="acct-panel" role="tabpanel" id="panel-' + k + '" aria-labelledby="tab-' + k + '" tabindex="0"' + (k === tab ? "" : " hidden") + ">" + inner + "</div>";
  let dnaH = '<div class="o-sec"><h3>Saved to your account</h3>';
  if (rec) {
    const p = normalize(rec.career_dna);
    dnaH += '<div class="acct-rec"><div><b>' + esc(p.fullName || "Your Career DNA") + "</b><span>" + esc(p.headline).slice(0, 140) + '</span><small>Saved ' + esc(fmtDate(rec.updated_at)) + '</small></div><div class="acct-actions"><button class="btn btn-primary btn-sm" type="button" id="acctOpen">Open it</button><button class="btn btn-quiet btn-sm" type="button" id="acctDownload">Download my data</button></div></div>';
  } else {
    dnaH += '<p class="hint">Nothing saved yet. Build your Career DNA, then choose "Save to my account" on the result.</p>';
    if (local) dnaH += '<div class="o-foot" style="margin-top:14px"><button class="btn btn-primary" type="button" id="acctSaveLocal">Save the Career DNA on this device to my account</button></div>';
  }
  dnaH += "</div>";
  h += panel("dna", dnaH);
  h += panel("employers", '<div class="o-sec" id="requestsSec"><h3>Contact requests</h3><div id="acctRequests"><p class="hint">Loading…</p></div></div><div class="o-sec" id="talentSec"><h3>Let employers find you</h3><div id="acctTalent"><p class="hint">Loading…</p></div></div>');
  h += panel("alerts", '<div class="o-sec"><h3>Job alerts</h3><div id="acctAlerts"><p class="hint">Loading…</p></div></div>');
  h += panel("settings", '<div class="o-sec"><h3>Signed in</h3><p class="hint">as <b>' + esc(sbUser.email || "") + '</b></p><div class="o-foot" style="margin-top:12px"><button class="btn btn-quiet" type="button" id="signOutBtn">Sign out</button></div></div>' +
    '<div class="o-sec"><h3>Delete everything</h3><p class="hint">Permanently deletes your saved Career DNA, your resume, your employer profile, your job alerts and your account, and removes them from this device too. This can\'t be undone.</p>' +
    '<div class="o-foot" style="margin-top:14px"><button class="btn btn-quiet btn-danger" type="button" id="delAsk">Delete everything</button></div>' +
    '<div class="acct-confirm" id="delConfirm" hidden><p><b>Delete your account and everything saved in it?</b></p><div class="o-foot" style="margin-top:12px"><button class="btn btn-danger-solid" type="button" id="delYes">Yes, delete everything</button><button class="btn btn-quiet" type="button" id="delNo">Keep my account</button></div></div></div>');
  openOverlay("Your account", h);
  const note = $("acctNote");
  const tabBtns = [...document.querySelectorAll(".acct-tabs [role=tab]")];
  const show = (btn, focus) => {
    tabBtns.forEach(b => { const on = b === btn; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; $(b.getAttribute("aria-controls")).hidden = !on; });
    if (focus) btn.focus();
  };
  tabBtns.forEach((b, i) => {
    b.onclick = () => show(b);
    b.onkeydown = e => {
      const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabBtns.length - 1 : null;
      if (n === null) return; e.preventDefault(); show(tabBtns[(n + tabBtns.length) % tabBtns.length], true);
    };
  });
  loadAlerts(); loadRequests();
  loadTalent(o.startTalent ? (rec && rec.career_dna ? normalize(rec.career_dna) : local) : null);
  const op = $("acctOpen"); if (op) op.onclick = () => showProfile(normalize(rec.career_dna));
  const dl = $("acctDownload"); if (dl) dl.onclick = async () => {
    try { const full = await fetchRecord(true); const blob = new Blob([JSON.stringify({ email: sbUser.email, savedAt: full.updated_at, careerDNA: full.career_dna, resume: full.resume }, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "trazerr-my-data.json"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      note.textContent = "Downloaded trazerr-my-data.json."; } catch (e) { note.textContent = e.message; }
  };
  const sl = $("acctSaveLocal"); if (sl) sl.onclick = async () => { sl.disabled = true; const ok = await saveToAccount(local, loadResume()); openAccount({ note: ok ? "Saved to your account." : "That didn't save. Try again in a moment." }); };
  $("delAsk").onclick = () => { $("delConfirm").hidden = false; $("delAsk").hidden = true; $("delYes").focus(); };
  $("delNo").onclick = () => { $("delConfirm").hidden = true; $("delAsk").hidden = false; $("delAsk").focus(); };
  $("delYes").onclick = async () => {
    const y = $("delYes"); y.disabled = true; y.textContent = "Deleting…";
    try {
      const { data } = await sb.auth.getSession(); const token = data && data.session ? data.session.access_token : "";
      const r = await fetch(API + "?action=deleteaccount", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: "{}" });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || "That didn't go through. Try again in a moment.");
      await sb.auth.signOut({ scope: "local" }).catch(() => {});
      sbUser = null; acctRecord = undefined; paintAcctBtn(); removeProfile(); profile = null; resumeSrc = null; refreshProfileUI(); track("account_deleted");
      openAccount({ note: "Everything is deleted: your account, your saved Career DNA and your resume, including the copy on this device." });
    } catch (e) { y.disabled = false; y.textContent = "Yes, delete everything"; note.textContent = e.message; }
  };
  $("signOutBtn").onclick = async () => { await sb.auth.signOut().catch(() => {}); sbUser = null; acctRecord = undefined; paintAcctBtn(); openAccount({ note: "You're signed out. Anything saved on this device stays here until you remove it." }); };
}
/* ---------- talent pool (candidate side) ---------- */
// Signed-in requests to the server that need to know who is asking.
async function authed(action, body){
  const { data } = await sb.auth.getSession();
  const token = data && data.session ? data.session.access_token : "";
  let r;
  try { r = await fetch(API + "?action=" + action, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }); }
  catch (e) { throw new Error("Couldn't connect. Check your internet connection and try again."); }
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || "That didn't go through. Try again in a moment.");
  return out;
}
function talentCardHTML(t){
  let h = '<div class="talent-card"><b>' + esc(t.headline) + "</b>";
  const meta = [t.experience, t.education].filter(Boolean).join(" · ");
  if (meta) h += '<small>' + esc(meta) + "</small>";
  if (t.summary) h += "<p>" + esc(t.summary) + "</p>";
  if (arr(t.strengths).length) h += '<ul class="plain">' + t.strengths.map(x => '<li><i class="mark verified" aria-hidden="true"></i><span><b>' + esc(x.name) + "</b>" + (x.evidence ? " " + esc(x.evidence) : "") + "</span></li>").join("") + "</ul>";
  if (arr(t.roles).length) h += '<p class="talent-roles"><b>Good fit for:</b> ' + t.roles.map(esc).join(", ") + "</p>";
  if (arr(t.skills).length) h += '<p class="talent-roles"><b>Skills:</b> ' + t.skills.map(esc).join(" · ") + "</p>";
  return h + "</div>";
}
async function loadTalent(startWith){
  const box = $("acctTalent"); if (!box) return;
  const { data, error } = await sb.from("talent_profiles").select("public_id, visible, profile, location, remote_ok, updated_at").maybeSingle();
  if (!$("acctTalent")) return;
  if (error) { $("talentSec").hidden = true; $("requestsSec").hidden = true; return; }
  const dna = () => { const l = loadSaved(); return l && !l.isExample ? l : acctRecord && acctRecord.career_dna ? normalize(acctRecord.career_dna) : null; };
  if (startWith && !data) return draftTalent(startWith);
  if (!data) {
    box.innerHTML = '<p class="hint">Employers on Trazerr describe a job and see the candidates who fit it best. They see an anonymous profile: your strengths and experience, but not your name, contact details or where you worked. If one wants to talk, you get an email and choose whether to share your details. Only employers Trazerr has approved can search.</p><div class="o-foot" style="margin-top:14px"><button class="btn btn-primary" type="button" id="talentStart">Create my anonymous profile</button></div>';
    $("talentStart").onclick = () => { const d = dna(); if (!d) { $("acctNote").textContent = "Build your Career DNA first, then come back here."; return; } draftTalent(d); };
    return;
  }
  box.innerHTML = '<p class="talent-status ' + (data.visible ? "on" : "") + '"><b>' + (data.visible ? "Employers can find you" : "Your profile is hidden") + "</b>" + (data.location ? " · " + esc(data.location) : "") + (data.remote_ok ? " · open to remote" : "") + "</p>" +
    '<p class="hint">This is what approved employers see:</p>' + talentCardHTML(data.profile) +
    '<div class="o-foot" style="margin-top:14px"><button class="btn btn-quiet btn-sm" type="button" id="talentToggle">' + (data.visible ? "Hide my profile" : "Show my profile again") + '</button><button class="btn btn-quiet btn-sm" type="button" id="talentRefresh">Update from my latest Career DNA</button><button class="btn btn-quiet btn-sm" type="button" id="talentRemove">Remove my profile</button></div>';
  $("talentToggle").onclick = async () => { const { error } = await sb.from("talent_profiles").update({ visible: !data.visible, updated_at: new Date().toISOString() }).eq("user_id", sbUser.id); if (error) $("acctNote").textContent = "That didn't go through. Try again in a moment."; else { track(data.visible ? "talent_opt_out" : "talent_opt_in"); loadTalent(); } };
  $("talentRefresh").onclick = () => { const d = dna(); if (!d) { $("acctNote").textContent = "Build your Career DNA first."; return; } draftTalent(d, data); };
  $("talentRemove").onclick = async () => { const { error } = await sb.from("talent_profiles").delete().eq("user_id", sbUser.id); if (error) $("acctNote").textContent = "That didn't go through. Try again in a moment."; else { track("talent_opt_out"); loadTalent(); } };
}
async function draftTalent(dna, existing){
  const box = $("acctTalent"); if (!box) return;
  box.innerHTML = '<p class="hint">Writing your anonymous profile… This takes about 15 seconds.</p>';
  try {
    const { profile: t } = await authed("talentdraft", { profile: dna });
    if (!$("acctTalent")) return;
    const loc = existing ? existing.location : cleanLocation(dna.location);
    box.innerHTML = '<p class="hint">Here\'s what approved employers would see. Your name, contact details and employer names are left out.</p>' + talentCardHTML(t) +
      '<div class="t-field" style="margin-top:14px"><label for="talentLoc">Where you want to work</label><input class="input" id="talentLoc" type="text" maxlength="100" value="' + esc(loc) + '" placeholder="City, State"></div>' +
      '<label class="check" style="margin-top:10px"><input type="checkbox" id="talentRemote"' + (existing && existing.remote_ok ? " checked" : "") + '> Open to remote work</label>' +
      '<div class="o-foot" style="margin-top:14px"><button class="btn btn-primary" type="button" id="talentSave">Let employers find me</button><button class="btn btn-quiet" type="button" id="talentCancel">Not now</button></div>';
    $("talentCancel").onclick = () => loadTalent();
    $("talentSave").onclick = async () => {
      const btn = $("talentSave"); btn.disabled = true;
      if (!acctRecord) await saveToAccount(dna, loadResume()); // so your name can be shared if you accept a request
      const row = { user_id: sbUser.id, visible: true, profile: t, location: $("talentLoc").value.trim().slice(0, 100), remote_ok: $("talentRemote").checked, updated_at: new Date().toISOString() };
      const { error } = await sb.from("talent_profiles").upsert(row, { onConflict: "user_id" });
      if (error) { btn.disabled = false; $("acctNote").textContent = "That didn't save. Try again in a moment."; return; }
      track("talent_opt_in"); loadTalent();
      $("acctNote").textContent = "Done. Approved employers can now find your anonymous profile. You'll get an email if one wants to talk.";
    };
  } catch (e) { if ($("acctTalent")) box.innerHTML = '<p class="hint">' + esc(e.message) + '</p><div class="o-foot" style="margin-top:12px"><button class="btn btn-quiet btn-sm" type="button" id="talentRetry">Try again</button></div>'; const rt = $("talentRetry"); if (rt) rt.onclick = () => draftTalent(dna, existing); }
}
// Waiting contact requests show as a number on the Employers tab and a dot on the account button.
function paintRequestBadge(n){
  const b = $("reqBadge"); if (b) { b.textContent = n; b.hidden = !n; b.setAttribute("aria-label", n + " waiting"); }
  $("acctBtn").classList.toggle("has-news", n > 0);
  if (sbUser) $("acctBtn").setAttribute("aria-label", "Your account, signed in as " + (sbUser.email || "") + (n ? ", " + n + " contact request" + (n === 1 ? "" : "s") + " waiting" : ""));
}
async function checkRequests(){
  try { const out = await authed("myrequests"); paintRequestBadge(out.requests.filter(r => r.status === "pending").length); } catch (e) {}
}
async function loadRequests(){
  const box = $("acctRequests"); if (!box) return;
  let out; try { out = await authed("myrequests"); } catch (e) { if ($("acctRequests")) box.innerHTML = '<p class="hint">' + esc(e.message) + "</p>"; return; }
  if (!$("acctRequests")) return;
  paintRequestBadge(out.requests.filter(r => r.status === "pending").length);
  if (!out.requests.length) { box.innerHTML = '<p class="hint">No contact requests yet. When an approved employer wants to talk to you, it shows here and you get an email.</p>'; return; }
  box.innerHTML = '<ul class="acct-alerts">' + out.requests.map(r => '<li><div><b>' + esc(r.company) + " · " + esc(r.jobTitle) + "</b>" +
    (r.message ? "<p class=\"hint\" style=\"margin:4px 0\">" + esc(r.message) + "</p>" : "") +
    "<small>" + (r.status === "accepted" ? "Accepted. Contact: " + esc([r.contactName, r.email].filter(Boolean).join(", ")) : r.status === "declined" ? "Declined" : "Sent " + esc(fmtDate(r.createdAt))) + (r.website ? ' · <a href="' + esc(safeUrl(/^https?:/.test(r.website) ? r.website : "https://" + r.website)) + '" target="_blank" rel="noopener noreferrer">Their website</a>' : "") + "</small></div>" +
    (r.status === "pending" ? '<div class="acct-actions"><button class="btn btn-primary btn-sm" type="button" data-req="' + esc(r.id) + '" data-accept="1">Accept and share my details</button><button class="btn btn-quiet btn-sm" type="button" data-req="' + esc(r.id) + '" data-accept="0">Decline</button></div>' : "") + "</li>").join("") + "</ul>";
  box.querySelectorAll("[data-req]").forEach(b => b.onclick = async () => {
    box.querySelectorAll("[data-req]").forEach(x => x.disabled = true);
    try { await authed("respondrequest", { id: b.dataset.req, accept: b.dataset.accept === "1" }); $("acctNote").textContent = b.dataset.accept === "1" ? "Accepted. We've emailed you both each other's details." : "Declined. They won't see your details."; }
    catch (e) { $("acctNote").textContent = e.message; }
    loadRequests();
  });
}

async function loadAlerts(){
  const box = $("acctAlerts"); if (!box) return;
  const { data, error } = await sb.from("job_alerts").select("id, query, location, remote, active, last_sent").order("created_at");
  if (!$("acctAlerts")) return;
  if (error) { box.innerHTML = '<p class="hint">Your job alerts couldn\'t be loaded. Try again in a moment.</p>'; return; }
  if (!data.length) { box.innerHTML = '<p class="hint">No job alerts yet. Search for jobs, then choose "Email me new jobs" under the results.</p>'; return; }
  box.innerHTML = '<ul class="acct-alerts">' + data.map(a => '<li><div><b>' + esc(alertLabel(a)) + "</b><small>" + (a.active ? "Weekly" + (a.last_sent ? " · last checked " + esc(fmtDate(a.last_sent)) : " · first email within a day") : "Stopped") + '</small></div><button class="btn btn-quiet btn-sm" type="button" data-alert="' + esc(a.id) + '" data-act="' + (a.active ? "stop" : "resume") + '">' + (a.active ? "Stop" : "Turn back on") + "</button></li>").join("") + "</ul>";
  box.querySelectorAll("[data-alert]").forEach(b => b.onclick = async () => {
    b.disabled = true;
    const q = b.dataset.act === "stop" ? sb.from("job_alerts").delete().eq("id", b.dataset.alert) : sb.from("job_alerts").update({ active: true }).eq("id", b.dataset.alert);
    const { error } = await q;
    if (error) { b.disabled = false; $("acctNote").textContent = "That didn't go through. Try again in a moment."; return; }
    if (b.dataset.act === "stop") track("alert_stopped");
    loadAlerts();
  });
}
$("acctBtn").addEventListener("click", async () => {
  try { await acct(); openAccount(); }
  catch (e) { openOverlay("Your account", errorHTML(e.message || "Sign-in isn't available right now. Try again in a moment.")); }
});
// Only load sign-in when it's needed: returning from an emailed link, or someone who signed in before.
$("acctBtn").hidden = !ACCOUNTS_ON;
// Links in emails to /#account open the account panel (for example to answer a contact request).
if (ACCOUNTS_ON && location.hash === "#account" && !linkHash) {
  acct().then(() => { history.replaceState(history.state, "", location.pathname + location.search); openAccount({ focus: "requests" }); }).catch(() => {});
} else if (ACCOUNTS_ON && (linkHash || hadSession())) {
  acct().then(() => {
    if (!linkHash) { if (sbUser) checkRequests(); return; }
    if (sbUser) return afterSignIn();
    history.replaceState(history.state, "", location.pathname + location.search);
    const expired = /expired|invalid/i.test(linkHash.get("error_description") || "");
    openAccount({ note: expired ? "That sign-in link has expired or was already used. Enter your email to get a new one." : "That sign-in link didn't work. Enter your email to get a new one." });
  }).catch(() => {});
}

/* ---------- start ---------- */
setProfile(loadSaved());
resumeSrc = loadResume();
track("visit");
// A link from a job alert email (/?q=…&where=…#jobs) runs that search straight away.
(function searchFromLink(){
  const u = new URLSearchParams(location.search), q = (u.get("q") || "").trim();
  if (!q) return;
  $("jq").value = q.slice(0, 100);
  const jw = $("jw"); jw.value = (u.get("where") || "").slice(0, 80); delete jw.dataset.auto; $("jwNote").hidden = true;
  $("jr").checked = u.get("remote") === "1";
  if (u.get("src") === "alert") track("alert_opened");
  runJobSearch(true);
  $("jobs").scrollIntoView();
})();

/* Count-up animation for numbers in Career DNA results */
function animateNumbers(){
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting || entry.target.dataset.animated) return;
      entry.target.dataset.animated = "1";
      const final = parseInt(entry.target.dataset.target || entry.target.textContent, 10);
      if (isNaN(final)) return;
      let current = 0;
      const duration = 600;
      const start = performance.now();
      const animate = (now) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        current = Math.floor(final * progress);
        entry.target.textContent = current;
        if (progress < 1) requestAnimationFrame(animate);
        else entry.target.textContent = final;
      };
      requestAnimationFrame(animate);
    });
  }, { threshold: 0.5 });
  document.querySelectorAll(".dm-ring b, .emp-score b, .ba-row b, .proof-stats .count").forEach(el => observer.observe(el));
}
animateNumbers();
