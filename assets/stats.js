/* Trazerr usage page (stats.html). */
(function(){
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt = (n) => Number(n || 0).toLocaleString("en-US");
  const when = (iso) => { const t = Date.parse(iso); return t ? new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""; };
  const KEY = "trazerr.statsKey";
  let key = ""; try { key = sessionStorage.getItem(KEY) || ""; } catch (e) {}
  let days = 30;

  function setStatus(el, msg, err){ el.textContent = msg || ""; el.classList.toggle("err", !!err); }

  $("keyForm").addEventListener("submit", e => { e.preventDefault(); key = $("key").value.trim(); load(true); });
  $("forget").addEventListener("click", () => { key = ""; try { sessionStorage.removeItem(KEY); } catch (e) {} $("board").hidden = true; $("gate").hidden = false; $("key").value = ""; $("key").focus(); });
  document.querySelectorAll("[data-days]").forEach(b => b.addEventListener("click", () => {
    days = +b.dataset.days;
    document.querySelectorAll("[data-days]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    load(false);
  }));

  async function load(fromGate){
    if (!key) return;
    const st = fromGate ? $("gateStatus") : $("boardStatus");
    setStatus(st, "Loading…");
    try {
      const r = await fetch("/api/app?action=stats&days=" + days + "&key=" + encodeURIComponent(key), { cache: "no-store" });
      const data = await r.json().catch(() => ({}));
      if (r.status === 404) throw new Error("That key didn't work. Check it matches STATS_KEY in Vercel.");
      if (!r.ok) throw new Error(data.error || "Usage couldn't be loaded. Try again in a moment.");
      try { sessionStorage.setItem(KEY, key); } catch (e) {}
      $("gate").hidden = true; $("board").hidden = false;
      setStatus($("gateStatus"), ""); setStatus($("boardStatus"), "");
      render(data);
    } catch (e) {
      if (!fromGate && /key/.test(e.message)) { $("board").hidden = true; $("gate").hidden = false; }
      setStatus(fromGate || $("board").hidden ? $("gateStatus") : st, e.message, true);
    }
  }

  function dates(){ return Array.from({ length: days }, (_, i) => new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10)); }

  function render(d){
    const t = d.totals || {};
    $("visits").textContent = fmt(t.visit);
    $("period").textContent = "Last " + days + " days";
    const tiles = [
      ["Career DNAs built", t.dna_built], ["Fit checks", t.fit_check], ["Tailored resumes", t.tailor_built],
      ["Job alerts turned on", t.alert_created], ["Alert emails sent", t.alert_email_sent], ["Server errors", t.error_server]
    ];
    $("tiles").innerHTML = tiles.map(([l, v]) => '<div class="card tile"><div class="lbl">' + esc(l) + '</div><div class="v">' + fmt(v) + "</div></div>").join("");

    const ds = dates(), by = d.byDay || {};
    chart($("c1"), ds, ds.map(x => (by[x] || {}).visit || 0), "visits");
    chart($("c2"), ds, ds.map(x => (by[x] || {}).dna_built || 0), "Career DNAs");

    const cols = [["visit", "Visits"], ["dna_started", "DNAs started"], ["dna_built", "DNAs built"], ["fit_check", "Fit checks"], ["tailor_built", "Tailored"], ["alert_email_sent", "Alert emails"], ["alert_opened", "Back from alerts"], ["error_server", "Server errors"], ["error_browser", "Browser errors"]];
    $("daily").innerHTML = '<div style="overflow-x:auto"><table><thead><tr><th scope="col">Day</th>' + cols.map(c => '<th scope="col" class="n">' + c[1] + "</th>").join("") + "</tr></thead><tbody>" +
      ds.slice().reverse().map(x => "<tr><th scope=\"row\">" + x + "</th>" + cols.map(c => '<td class="n">' + fmt((by[x] || {})[c[0]]) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>";

    const f = d.funnel || {};
    $("funnel").innerHTML = "<table><tbody>" + Object.keys(f).map(k => '<tr><th scope="row" style="font-weight:400">' + esc(k.charAt(0).toUpperCase() + k.slice(1)) + '</th><td class="n"><b>' + esc(f[k]) + "</b></td></tr>").join("") + "</tbody></table>";

    const errs = d.recentErrors || [];
    $("errors").innerHTML = errs.length ? errs.slice(0, 20).map(e => '<li><div class="when">' + esc(when(e.at)) + " · " + esc(e.where === "browser" ? "Browser" : "Server") + (e.action ? " · " + esc(e.action) : "") + "</div>" + esc(e.message) + "</li>").join("") : '<li class="empty">No errors recorded.</li>';

    const fb = d.recentFeedback || [];
    $("feedback").innerHTML = fb.length ? fb.slice(0, 20).map(x => '<li><div class="when">' + esc(when(x.at)) + " · " + esc({ dna: "Career DNA", tailor: "Tailor", fit: "Fit check" }[x.on] || x.on) + (x.role ? " · " + esc(x.role) : "") + "</div><b>" + (x.rating === "up" ? "Accurate" : "Not accurate") + "</b>" + (x.comment ? ": " + esc(x.comment) : "") + "</li>").join("") : '<li class="empty">No feedback yet.</li>';

    health(d.lastKeepalive);
    employers();
  }

  // One series per chart: columns grow from the baseline, with a hover and keyboard tooltip.
  function chart(host, ds, vals, noun){
    const W = 480, H = 200, L = 34, B = 22, T = 8, max = Math.max(1, ...vals);
    const step = niceStep(max), top = Math.ceil(max / step) * step, y = v => T + (H - B - T) * (1 - v / top);
    const slot = (W - L) / ds.length, bw = Math.max(2, Math.min(24, slot - 2));
    let s = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(noun.charAt(0).toUpperCase() + noun.slice(1)) + " per day, highest " + fmt(max) + '">';
    for (let v = 0; v <= top; v += step) s += '<line class="gl" x1="' + L + '" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="axis" x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + fmt(v) + "</text>";
    vals.forEach((v, i) => {
      const x = L + i * slot + (slot - bw) / 2, h = (H - B - T) * v / top, r = Math.min(4, bw / 2, h);
      const label = new Date(ds[i] + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) + ": " + fmt(v) + " " + noun;
      s += '<rect class="hit" x="' + (L + i * slot) + '" y="' + T + '" width="' + slot + '" height="' + (H - B - T) + '" tabindex="0" data-tip="' + esc(label) + '" data-x="' + (x + bw / 2) + '" data-y="' + y(v) + '"><title>' + esc(label) + "</title></rect>";
      if (h > 0) s += '<path class="b" d="M' + x + "," + (H - B) + "V" + (H - B - h + r) + "Q" + x + "," + (H - B - h) + " " + (x + r) + "," + (H - B - h) + "H" + (x + bw - r) + "Q" + (x + bw) + "," + (H - B - h) + " " + (x + bw) + "," + (H - B - h + r) + "V" + (H - B) + 'Z"/>';
    });
    s += '<line class="base" x1="' + L + '" x2="' + W + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>';
    const lab = (i) => new Date(ds[i] + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    s += '<text class="axis" x="' + L + '" y="' + (H - 4) + '">' + lab(0) + '</text><text class="axis" x="' + W + '" y="' + (H - 4) + '" text-anchor="end">' + lab(ds.length - 1) + "</text></svg>";
    host.innerHTML = s + '<div class="tip" hidden></div>';
    const svg = host.querySelector("svg"), tip = host.querySelector(".tip");
    const show = (el) => { const k = svg.getBoundingClientRect().width / W; tip.textContent = el.dataset.tip; tip.style.left = (+el.dataset.x * k) + "px"; tip.style.top = (svg.offsetTop + +el.dataset.y * k) + "px"; tip.hidden = false; };
    host.querySelectorAll(".hit").forEach(el => { el.addEventListener("mouseenter", () => show(el)); el.addEventListener("focus", () => show(el)); el.addEventListener("mouseleave", () => tip.hidden = true); el.addEventListener("blur", () => tip.hidden = true); });
  }
  function niceStep(max){ const raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw))); const m = raw / p; return Math.max(1, (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p); }

  async function health(lastKeepalive){
    let s = null; try { const r = await fetch("/api/app?action=dbstatus&all=1", { cache: "no-store" }); s = await r.json(); } catch (e) {}
    const row = (name, ok, text, warn) => '<li><span>' + esc(name) + '</span><span class="st ' + (ok ? "ok" : warn ? "warn" : "bad") + '">' + (ok ? "✓ " : warn ? "! " : "✕ ") + esc(text) + "</span></li>";
    if (!s) { $("health").innerHTML = '<li class="empty">Health check couldn\'t be loaded.</li>'; return; }
    const sv = s.services || {}, last = lastKeepalive || sv.lastKeepalive, age = last ? (Date.now() - Date.parse(last)) / 86400000 : null;
    $("health").innerHTML =
      row("AI (Anthropic)", sv.anthropicKey, sv.anthropicKey ? "Key set" : "Key missing") +
      row("Job search (Adzuna)", sv.adzunaKeys, sv.adzunaKeys ? "Keys set" : "Using Remotive only", true) +
      row("Counts and limits (Upstash)", sv.upstashRedis === "ok", sv.upstashRedis === "ok" ? "Working" : String(sv.upstashRedis || "unknown")) +
      row("Accounts (Supabase)", s.reachable && s.tableExists, s.reachable ? (s.tableExists ? "Working" : "Table missing") : "Not reachable") +
      row("Talent pool", s.talentTablesExist, s.talentTablesExist ? "Ready" : "Run supabase/talent.sql") +
      row("Job alerts", s.alertsTableExists, s.alertsTableExists ? "Ready" : "Run supabase/job_alerts.sql") +
      row("Daily keepalive", age !== null && age < 2, last ? "Last ran " + when(last) : "Hasn't run yet", age === null) +
      row("Error alert emails", sv.errorAlerts, sv.errorAlerts ? "On" : "Off (add RESEND_API_KEY and ALERT_EMAIL)", true);
  }

  // Employers who asked to search candidates. New ones wait here for approval.
  async function employers(){
    const box = $("employers"), st = $("empStatus");
    let d;
    try { const r = await fetch("/api/app?action=adminemployers&key=" + encodeURIComponent(key), { cache: "no-store" }); d = await r.json(); if (!r.ok) throw new Error(d.error || "Employers couldn't be loaded."); }
    catch (e) { box.innerHTML = '<li class="empty">' + esc(e.message) + "</li>"; return; }
    $("poolSize").textContent = fmt(d.visibleCandidates) + " candidate" + (d.visibleCandidates === 1 ? "" : "s") + " can be found by employers.";
    const label = { pending: "Waiting for you", approved: "Approved", rejected: "Rejected" };
    box.innerHTML = d.employers.length ? d.employers.map(e => '<li><div><b>' + esc(e.company) + '</b> <span class="pill ' + esc(e.status) + '">' + label[e.status] + '</span><div class="when">' +
      esc([e.contactName, e.jobTitle, e.email, e.website].filter(Boolean).join(" · ")) + " · asked " + esc(when(e.createdAt)) + '</div></div><div class="acts">' +
      (e.status !== "approved" ? '<button class="btn btn-primary" type="button" data-emp="' + esc(e.userId) + '" data-d="approved">Approve</button>' : "") +
      (e.status !== "rejected" ? '<button class="btn btn-quiet" type="button" data-emp="' + esc(e.userId) + '" data-d="rejected">' + (e.status === "approved" ? "Remove access" : "Reject") + "</button>" : "") + "</div></li>").join("")
      : '<li class="empty">No employers yet. They sign up at trazerr.com/employers.html.</li>';
    box.querySelectorAll("[data-emp]").forEach(b => b.onclick = async () => {
      box.querySelectorAll("[data-emp]").forEach(x => x.disabled = true);
      try {
        const r = await fetch("/api/app?action=adminemployers&key=" + encodeURIComponent(key), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: b.dataset.emp, decision: b.dataset.d }) });
        const out = await r.json().catch(() => ({})); if (!r.ok) throw new Error(out.error || "That didn't go through.");
        setStatus(st, b.dataset.d === "approved" ? "Approved. They've been emailed." : "Done.");
      } catch (e) { setStatus(st, e.message, true); }
      employers();
    });
  }

  if (key) load(true);
})();
