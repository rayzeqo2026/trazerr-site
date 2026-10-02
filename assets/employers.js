/* Trazerr for employers (employers.html): sign in, ask for approval, then search the talent pool
   and send contact requests. Candidates are anonymous until they accept. */
(function(){
  const API = "/api/app";
  const SB_LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js", SB_LIB_SRI = "sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const arr = (v) => Array.isArray(v) ? v : [];
  const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch (e) { return ""; } };
  let sb = null, me = null, lastSearch = null;

  function getApp() { return $("empApp"); }
  function hideLanding() { const el = $("empLanding"); if (el) el.style.display = "none"; }
  function showLanding() { const el = $("empLanding"); if (el) el.style.display = "block"; }

  function track(e){ try { navigator.sendBeacon && navigator.sendBeacon(API + "?action=track", new Blob([JSON.stringify({ e })], { type: "application/json" })); } catch (err) {} }
  function setStatus(el, msg, err){ if (!el) return; el.textContent = msg || ""; el.classList.toggle("err", !!err); }
  function loadScript(src, integrity){
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.integrity = integrity; s.crossOrigin = "anonymous"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  async function api(action, body){
    const { data } = await sb.auth.getSession();
    const token = data && data.session ? data.session.access_token : "";
    let r;
    try { r = await fetch(API + "?action=" + action, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }); }
    catch (e) { throw new Error("Couldn't connect. Check your internet connection and try again."); }
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.error || "That didn't go through. Try again in a moment.");
    return out;
  }

  async function start(){
    track("employer_page");
    try {
      const cfg = await fetch(API + "?action=authconfig").then(r => { if (!r.ok) throw new Error(); return r.json(); });
      if (!window.supabase) await loadScript(SB_LIB, SB_LIB_SRI);
      sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { storageKey: "trazerr.auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" } });
      const { data } = await sb.auth.getSession();
      if (/access_token=|error_description=/.test(location.hash)) history.replaceState(null, "", location.pathname);
      try { localStorage.removeItem("trazerr.signinReturn"); } catch (e) {}

      // Set up button handlers now that sb is initialized
      const profileBtn = $("empProfileBtn");
      if (profileBtn) {
        profileBtn.onclick = async () => {
          profileBtn.disabled = true;
          try {
            hideLanding();
            showSignIn();
          } catch (e) {
            getApp().innerHTML = '<p class="status err">Failed to load. Check your connection and try again.</p>';
          }
          profileBtn.disabled = false;
        };
      }
      const signInLink = $("empSignInLink");
      if (signInLink) {
        signInLink.onclick = (e) => {
          e.preventDefault();
          if (profileBtn) profileBtn.click();
        };
      }

      if (!data || !data.session) return showSignIn();
      hideLanding();
      $("empSignOut").hidden = false;
      const dashboardBtn = $("dashboardBtn");
      if (dashboardBtn) {
        dashboardBtn.hidden = false;
        dashboardBtn.onclick = () => { window.location.href = "/employer-dashboard.html"; };
      }
      await refresh();
    } catch (e) { hideLanding(); getApp().innerHTML = '<p class="status err">The employer area couldn\'t load. Check your connection and try again.</p>'; }
  }
  $("empSignOut").onclick = async () => { await sb.auth.signOut().catch(() => {}); $("empSignOut").hidden = true; showSignIn("You're signed out."); };

  // What an employer gets, shown before they sign up: one sample candidate, as search results look.
  function exampleHTML(){
    return '<aside class="emp-example" aria-label="Example search result"><p class="emp-example-tag">Example result · Operations supervisor, Newark NJ</p>' +
      '<article class="emp-cand"><div class="emp-cand-top"><div class="emp-score" aria-label="Fit 86 out of 100"><b>86</b><small>fit</small></div><div><h3>Warehouse lead who trains teams and cuts errors</h3><p class="hint">About 6 years · Newark, NJ</p></div></div>' +
      '<ul class="plain"><li><i class="mark verified" aria-hidden="true"></i>Leads a night shift of 9, the size of this team</li><li><i class="mark verified" aria-hidden="true"></i>Cut picking errors by 20%, the metric this role owns</li><li><i class="mark verified" aria-hidden="true"></i>Trains every new hire on safety procedures</li></ul>' +
      '<p class="emp-gap"><i class="mark unknown" aria-hidden="true"></i>No budget ownership shown yet</p>' +
      '<div class="emp-ask"><span class="btn btn-primary btn-sm" aria-hidden="true">Ask to talk</span></div></article>' +
      '<p class="hint emp-example-note">A title search would miss this person: they\'ve never been called a supervisor.</p></aside>';
  }
  function promisesHTML(){
    return '<ul class="emp-promises">' +
      '<li><b>Ranked by evidence</b><span>Every match comes with the reasons from their experience, and the biggest gap.</span></li>' +
      '<li><b>People who want to be found</b><span>Only candidates who chose to be visible, so your message is welcome.</span></li>' +
      '<li><b>Free while we launch</b><span>No card, no contract. Each employer is reviewed to keep candidates safe.</span></li></ul>';
  }

  function showSignIn(note){
    hideLanding();
    getApp().innerHTML = promisesHTML() + '<div class="emp-grid"><section class="emp-card"><h2>Sign in or create an employer account</h2>' +
      '<p class="hint">Use your work email. We\'ll email you a sign-in link, so there\'s no password. New employers are reviewed by the Trazerr team before they can search, usually within a day.</p>' +
      (note ? '<p class="saved-note">' + esc(note) + "</p>" : "") +
      '<form class="t-field" id="empSignin" novalidate><label for="empEmail">Work email</label><div class="goal-form"><input class="input" id="empEmail" type="email" autocomplete="email" required placeholder="you@company.com"><button class="btn btn-primary" type="submit" id="empSigninBtn">Email me a sign-in link</button></div></form>' +
      '<p class="status" id="empSigninStatus" role="status" aria-live="polite"></p></section>' + exampleHTML() + "</div>" + howItWorks();
    $("empSignin").onsubmit = async (e) => {
      e.preventDefault();
      const email = $("empEmail").value.trim(), st = $("empSigninStatus"), btn = $("empSigninBtn");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setStatus(st, "Enter a valid email address, like you@company.com.", true); return; }
      btn.disabled = true; setStatus(st, "Sending…");
      try { localStorage.setItem("trazerr.signinReturn", "/employers.html"); } catch (err) {}
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + "/employers.html", shouldCreateUser: true } });
      btn.disabled = false;
      if (error) setStatus(st, error.status === 429 ? "A sign-in link was sent just now. Wait a minute, then try again." : "That didn't go through. Check the address and try again.", true);
      else setStatus(st, "Check your email. We sent a sign-in link to " + email + ". Open it on this device.");
    };
  }
  function howItWorks(){
    return '<section class="emp-how"><h2>How it works</h2><ol>' +
      "<li><b>Describe the job.</b> A title and location, and the posting if you have it.</li>" +
      "<li><b>See who fits and why.</b> Candidates are ranked by evidence in their experience, with the reasons and the biggest gap.</li>" +
      "<li><b>Ask to talk.</b> The candidate gets your request by email. If they accept, you both get each other's name and email.</li>" +
      '</ol><p class="hint">Free while we launch. Please contact candidates only about real openings. See our <a href="/terms.html">terms</a>.</p></section>';
  }

  async function refresh(){
    hideLanding();
    getApp().innerHTML = '<p class="hint">Loading your account…</p>';
    try { me = await api("employerme"); } catch (e) { getApp().innerHTML = '<p class="status err">' + esc(e.message) + "</p>"; return; }
    if (!me.employer) return showJoin();
    if (me.employer.status === "pending") return showWaiting();
    if (me.employer.status === "rejected") { app.innerHTML = '<section class="emp-card"><h2>We couldn\'t approve this account</h2><p class="hint">If you think that\'s a mistake, email <a href="mailto:hello@trazerr.com">hello@trazerr.com</a> from your work address.</p></section>'; return; }
    showSearch();
  }

  function showJoin(){
    hideLanding();
    getApp().innerHTML = '<section class="emp-card"><h2>Tell us about your company</h2><p class="hint">Signed in as <b>' + esc(me.email) + '</b>. The Trazerr team reviews each employer before they can search candidates.</p>' +
      '<form id="empJoin" class="emp-form" novalidate>' +
      '<div class="t-field"><label for="jCompany">Company name</label><input class="input" id="jCompany" maxlength="120" required autocomplete="organization"></div>' +
      '<div class="t-field"><label for="jName">Your name</label><input class="input" id="jName" maxlength="100" required autocomplete="name"></div>' +
      '<div class="t-field"><label for="jTitle">Your job title</label><input class="input" id="jTitle" maxlength="100" autocomplete="organization-title" placeholder="e.g. Hiring manager"></div>' +
      '<div class="t-field"><label for="jSite">Company website</label><input class="input" id="jSite" maxlength="200" inputmode="url" placeholder="company.com"></div>' +
      '<p class="hint">By continuing you agree to contact candidates only about real job openings, as set out in our <a href="/terms.html">terms</a>.</p>' +
      '<div class="o-foot"><button class="btn btn-primary" type="submit" id="jBtn">Request access</button></div><p class="status" id="jStatus" role="status" aria-live="polite"></p></form></section>';
    $("empJoin").onsubmit = async (e) => {
      e.preventDefault();
      const st = $("jStatus"), btn = $("jBtn");
      btn.disabled = true; setStatus(st, "Sending…");
      try { await api("employerjoin", { company: $("jCompany").value, contactName: $("jName").value, jobTitle: $("jTitle").value, website: $("jSite").value }); refresh(); }
      catch (err) { btn.disabled = false; setStatus(st, err.message, true); }
    };
  }
  function showWaiting(){
    hideLanding();
    getApp().innerHTML = '<section class="emp-card"><h2>Thanks, ' + esc(me.employer.contactName.split(" ")[0]) + ". We're reviewing " + esc(me.employer.company) + ".</h2>" +
      '<p class="hint">You\'ll get an email at <b>' + esc(me.email) + "</b> as soon as you're approved, usually within a day. Then come back here to find candidates.</p></section>" + howItWorks();
  }

  function showSearch(){
    hideLanding();
    const e = me.employer;
    getApp().innerHTML = '<section class="emp-card"><h2>Who are you hiring?</h2><p class="hint">' + esc(e.company) + " · signed in as " + esc(me.email) + "</p>" +
      '<form id="empSearch" class="emp-form" novalidate>' +
      '<div class="emp-row"><div class="t-field"><label for="sTitle">Job title</label><input class="input" id="sTitle" maxlength="100" required placeholder="e.g. Operations supervisor"></div>' +
      '<div class="t-field"><label for="sLoc">Location</label><input class="input" id="sLoc" maxlength="100" placeholder="City, State"></div></div>' +
      '<label class="check"><input type="checkbox" id="sRemote"> This job can be done remotely</label>' +
      '<div class="t-field"><label for="sPosting">Job posting (optional, gives better matches)</label><textarea id="sPosting" rows="5" maxlength="6000" placeholder="Paste the job description"></textarea></div>' +
      '<div class="o-foot"><button class="btn btn-primary" type="submit" id="sBtn">Find candidates</button></div><p class="status" id="sStatus" role="status" aria-live="polite"></p></form></section>' +
      '<section id="results" class="emp-results" aria-live="polite"></section>' +
      '<section class="emp-card"><h2>Your contact requests</h2><div id="sent"></div></section>';
    $("empSearch").onsubmit = async (ev) => {
      ev.preventDefault();
      const st = $("sStatus"), btn = $("sBtn");
      const q = { title: $("sTitle").value.trim(), location: $("sLoc").value.trim(), remote: $("sRemote").checked, posting: $("sPosting").value.trim() };
      if (q.title.length < 2) { setStatus(st, "Enter the job title you're hiring for.", true); $("sTitle").focus(); return; }
      btn.disabled = true; setStatus(st, "Finding the best fits… This takes about 20 seconds.");
      try { const out = await api("searchtalent", q); lastSearch = q; renderResults(out); setStatus(st, ""); }
      catch (err) { setStatus(st, err.message, true); }
      finally { btn.disabled = false; }
    };
    renderSent();
  }

  function renderResults(out){
    const box = $("results");
    if (!out.poolSize) { box.innerHTML = '<p class="hint">No candidates have joined the talent pool yet. It\'s growing every day, so check back soon.</p>'; return; }
    if (!out.candidates.length) { box.innerHTML = '<p class="hint">No good fits for this role yet among ' + out.poolSize + " candidates. Try a broader title, or check back soon.</p>"; return; }
    box.innerHTML = "<h2>" + out.candidates.length + " best fit" + (out.candidates.length === 1 ? "" : "s") + ' <small class="hint">from ' + out.poolSize + " candidate" + (out.poolSize === 1 ? "" : "s") + "</small></h2>" +
      out.candidates.map((c, i) => {
        const t = c.profile || {};
        return '<article class="emp-cand"><div class="emp-cand-top"><div class="emp-score" aria-label="Fit ' + c.score + ' out of 100"><b>' + c.score + "</b><small>fit</small></div><div><h3>" + esc(t.headline) + "</h3><p class=\"hint\">" +
          esc([t.experience, t.education, c.location, c.remoteOk ? "open to remote" : ""].filter(Boolean).join(" · ")) + "</p></div></div>" +
          (arr(c.why).length ? '<ul class="plain">' + c.why.map(w => '<li><i class="mark verified" aria-hidden="true"></i>' + esc(w) + "</li>").join("") + "</ul>" : "") +
          (c.gap ? '<p class="emp-gap"><i class="mark unknown" aria-hidden="true"></i>' + esc(c.gap) + "</p>" : "") +
          (arr(t.strengths).length ? '<details><summary>See full profile</summary>' + (t.summary ? "<p>" + esc(t.summary) + "</p>" : "") + '<ul class="plain">' + t.strengths.map(x => "<li><b>" + esc(x.name) + "</b> " + esc(x.evidence) + "</li>").join("") + "</ul>" + (arr(t.skills).length ? '<p class="hint">Skills: ' + t.skills.map(esc).join(" · ") + "</p>" : "") + "</details>" : "") +
          '<div class="emp-ask" id="ask' + i + '">' + (c.requested ? '<p class="saved-note">Request ' + esc(c.requested) + "</p>" : '<button class="btn btn-primary btn-sm" type="button" data-ask="' + i + '">Ask to talk</button>') + "</div></article>";
      }).join("");
    box.querySelectorAll("[data-ask]").forEach(b => b.onclick = () => askForm(out.candidates[+b.dataset.ask], +b.dataset.ask));
  }

  function askForm(c, i){
    const box = $("ask" + i);
    box.innerHTML = '<form class="emp-form" novalidate><div class="t-field"><label for="aJob' + i + '">Job</label><input class="input" id="aJob' + i + '" maxlength="120" value="' + esc(lastSearch ? lastSearch.title : "") + '"></div>' +
      '<div class="t-field"><label for="aMsg' + i + '">Message (optional)</label><textarea id="aMsg' + i + '" rows="3" maxlength="1000" placeholder="A line about the role and why they caught your eye"></textarea></div>' +
      '<div class="o-foot"><button class="btn btn-primary btn-sm" type="submit">Send request</button></div><p class="status" role="status" aria-live="polite"></p></form>';
    const form = box.querySelector("form"), st = box.querySelector(".status");
    form.onsubmit = async (e) => {
      e.preventDefault();
      form.querySelector("button").disabled = true; setStatus(st, "Sending…");
      try {
        await api("contactrequest", { candidate: c.id, jobTitle: $("aJob" + i).value.trim(), message: $("aMsg" + i).value.trim() });
        box.innerHTML = '<p class="saved-note">Request sent. The candidate gets an email and decides whether to share their details. You\'ll get an email if they accept.</p>';
        renderSent();
      } catch (err) { form.querySelector("button").disabled = false; setStatus(st, err.message, true); }
    };
    $("aJob" + i).focus();
  }

  async function renderSent(){
    const box = $("sent"); if (!box) return;
    try { me = await api("employerme"); } catch (e) { box.innerHTML = '<p class="hint">' + esc(e.message) + "</p>"; return; }
    if (!me.requests.length) { box.innerHTML = '<p class="hint">None yet. Find candidates above, then choose "Ask to talk".</p>'; return; }
    box.innerHTML = '<ul class="acct-alerts">' + me.requests.map(r => "<li><div><b>" + esc(r.headline) + "</b><small>" + esc(r.jobTitle) + " · " + esc(fmtDate(r.createdAt)) + "</small></div><span class=\"emp-state " + esc(r.status) + "\">" +
      (r.status === "accepted" ? "Accepted: " + esc([r.name, r.email].filter(Boolean).join(", ")) : r.status === "declined" ? "Declined" : "Waiting for a reply") + "</span></li>").join("") + "</ul>";
  }

  start();
})();
