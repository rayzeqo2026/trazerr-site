// Trazerr employer dashboard
(function(){
  console.log("Dashboard script loaded");
  window.dashboardScriptLoaded = true;

  const API = "/api/app";
  const SB_LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js";
  const SB_LIB_SRI = "sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok";

  // State
  let sb = null;
  let requiredSkills = [];
  let niceSkills = [];
  let currentEmployer = null;
  let currentJobs = [];
  let currentApplications = [];

  // Error display
  function showError(msg) {
    console.error("Dashboard error:", msg);
    const errorEl = document.getElementById("dashboardError");
    if (errorEl) {
      errorEl.textContent = "Error: " + msg;
      errorEl.style.display = "block";
    }
    alert("Dashboard Error: " + msg);
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  function loadScript(src, integrity) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src;
      if (integrity) s.integrity = integrity;
      s.crossOrigin = "anonymous";
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  async function api(action, body) {
    const { data } = await sb.auth.getSession();
    const token = data && data.session ? data.session.access_token : "";
    let r;
    try {
      r = await fetch(API + "?action=" + action, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
      });
    } catch (e) {
      throw new Error("Couldn't connect. Check your internet connection.");
    }
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.error || "That didn't go through. Try again in a moment.");
    return out;
  }

  /* ========== Authentication ========== */

  async function checkAuth() {
    try {
      const cfg = await fetch(API + "?action=authconfig").then(r => {
        if (!r.ok) throw new Error();
        return r.json();
      });

      if (!window.supabase) await loadScript(SB_LIB, SB_LIB_SRI);

      sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: {
          storageKey: "trazerr.auth",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "implicit"
        }
      });

      const { data: { session } } = await sb.auth.getSession();

      if (location.hash.includes("access_token=") || location.hash.includes("error_description=")) {
        history.replaceState(null, "", location.pathname);
      }

      if (!session) {
        window.location.href = "/employers.html";
        return null;
      }

      // Load employer profile
      const { data: employer, error } = await sb
        .from("employers")
        .select("*")
        .eq("user_id", session.user.id)
        .single();

      if (error) {
        console.error("Employer profile query error:", error);
        document.body.innerHTML = "<main style='padding: 32px'><p style='color:red;'><b>Error:</b> " + esc(error.message) + "</p><p>Make sure your employer profile exists in Supabase.</p><p><a href='/employers.html'>Go back</a></p></main>";
        return null;
      }

      if (!employer) {
        console.error("No employer profile found for user:", session.user.id);
        document.body.innerHTML = "<main style='padding: 32px'><p style='color:red;'><b>No employer profile found.</b></p><p>Please create a profile on the employers page first.</p><p><a href='/employers.html'>Create profile</a></p></main>";
        return null;
      }

      if (employer.status !== "approved") {
        document.body.innerHTML = "<main style='padding: 32px'><h1>Waiting for approval</h1><p>Your employer profile status: <b>" + esc(employer.status) + "</b></p><p>Your employer profile is pending admin approval. We'll email you once it's ready.</p><p><a href='/employers.html'>Go back</a></p></main>";
        return null;
      }

      currentEmployer = employer;
      setupUI(session.user.email);
      await loadDashboardData();
      return session;
    } catch (e) {
      console.error("Auth check failed:", e);
      document.body.innerHTML = "<main style='padding: 32px'><p style='color:red;'>Failed to load dashboard. <a href='/employers.html'>Try again</a></p></main>";
      return null;
    }
  }

  function setupUI(email) {
    try {
      const companyNameEl = document.getElementById("companyName");
      if (!companyNameEl) {
        showError("companyName element not found");
        return;
      }

      companyNameEl.textContent = currentEmployer.company;
      document.getElementById("companyNameField").value = currentEmployer.company;
      document.getElementById("contactNameField").value = currentEmployer.contact_name;
      document.getElementById("companyCodeField").value = generateCompanyCode(currentEmployer.company);

      // Post job button in overview
      const postJobBtn = document.getElementById("postJobBtn");
      if (postJobBtn) {
        postJobBtn.addEventListener("click", (e) => {
          e.preventDefault();
          showSection("create");
        });
      }

      // Sign out
      document.getElementById("signOut").addEventListener("click", async () => {
        await sb.auth.signOut().catch(() => {});
        window.location.href = "/employers.html";
      });

      // Sidebar navigation
      document.querySelectorAll(".dash-sidebar nav a").forEach(link => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          const section = link.dataset.section;
          // Redirect to new post-job page instead of dashboard form
          if (section === "create") {
            window.location.href = "/post-job.html";
            return;
          }
          showSection(section);
        });
      });

      // Job form
      const jobForm = document.getElementById("jobForm");
      if (jobForm) {
        jobForm.addEventListener("submit", createJob);
      } else {
        showError("jobForm element not found");
      }
    } catch (e) {
      showError("setupUI error: " + (e.message || String(e)));
    }
  }

  function showSection(name) {
    try {
      const sections = document.querySelectorAll(".dash-section");
      if (!sections || sections.length === 0) {
        showError("Sections not found in DOM. Page may not be fully loaded.");
        return;
      }

      sections.forEach(s => s.classList.remove("active"));
      const target = document.getElementById(name);
      if (!target) {
        showError("Section '" + name + "' not found. Available: " + Array.from(sections).map(s => s.id).join(", "));
        return;
      }
      target.classList.add("active");

      document.querySelectorAll(".dash-sidebar nav a").forEach(a => a.classList.remove("active"));
      const link = document.querySelector(`[data-section="${name}"]`);
      if (link) link.classList.add("active");

      if (name === "overview") loadOverview();
      if (name === "jobs") loadJobsList();
      if (name === "applications") loadApplicationsList();
    } catch (e) {
      showError("showSection error: " + (e.message || String(e)));
    }
  }

  /* ========== Skills Management ========== */

  function addSkill(type) {
    try {
      const input = type === "required" ? document.getElementById("requiredSkillInput") : document.getElementById("niceSkillInput");
      const skillText = input.value.trim();

      if (!skillText) return;

      const skills = type === "required" ? requiredSkills : niceSkills;
      if (!skills.includes(skillText)) {
        skills.push(skillText);
        renderSkills(type);
      }

      input.value = "";
    } catch (e) {
      alert("Error adding skill: " + (e.message || e));
    }
  }

  function removeSkill(type, skill) {
    const skills = type === "required" ? requiredSkills : niceSkills;
    const idx = skills.indexOf(skill);
    if (idx !== -1) {
      skills.splice(idx, 1);
      renderSkills(type);
    }
  }

  function renderSkills(type) {
    const skills = type === "required" ? requiredSkills : niceSkills;
    const container = type === "required" ? document.getElementById("requiredSkillsList") : document.getElementById("niceSkillsList");

    container.innerHTML = skills.map(skill => `
      <div class="skill-tag">
        ${esc(skill)}
        <button type="button" onclick="window.dashboard.removeSkill('${type}', '${skill.replace(/'/g, "\\'")}');" title="Remove">×</button>
      </div>
    `).join("");
  }

  /* ========== Job Creation ========== */

  async function createJob(e) {
    e.preventDefault();

    const title = document.getElementById("jobTitle").value.trim();
    const description = document.getElementById("jobDesc").value.trim();
    const expLevel = document.getElementById("expLevel").value;
    const location = document.getElementById("location").value.trim();
    const remoteOk = document.getElementById("remoteOk").checked;

    if (!title || !description || !expLevel || !requiredSkills.length) {
      alert("Please fill in all required fields and add at least one skill");
      return;
    }

    const companyCode = generateCompanyCode(currentEmployer.company);

    try {
      // Create job via API (which extracts Job DNA with Claude AI)
      const { data: { session } } = await sb.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        alert("Please sign in first");
        return;
      }

      const jobPostBtn = document.querySelector('#jobForm button[type="submit"]');
      jobPostBtn.disabled = true;
      jobPostBtn.textContent = "Posting... (analyzing job with AI)";

      const r = await fetch(API + "?action=jobpost", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          company_code: companyCode,
          title,
          description,
          required_skills: requiredSkills,
          nice_to_have: niceSkills,
          experience_level: expLevel,
          location,
          remote_ok: remoteOk
        })
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || "Failed to post job");
      }

      const job = await r.json();

      alert("Job posted successfully! ✓\n\nCompany code: " + companyCode + "\n\nCandidates can now search and apply.");
      document.getElementById("jobForm").reset();
      requiredSkills = [];
      niceSkills = [];
      renderSkills("required");
      renderSkills("nice");

      jobPostBtn.disabled = false;
      jobPostBtn.textContent = "Post Job";

      showSection("jobs");
      await loadJobsList();
    } catch (e) {
      console.error("Failed to create job:", e);
      const jobPostBtn = document.querySelector('#jobForm button[type="submit"]');
      jobPostBtn.disabled = false;
      jobPostBtn.textContent = "Post Job";
      alert("Failed to create job: " + (e.message || "Unknown error"));
    }
  }

  /* ========== Load Dashboard Data ========== */

  async function loadDashboardData() {
    try {
      const { data: jobs } = await sb
        .from("job_postings")
        .select("*")
        .eq("employer_id", currentEmployer.user_id)
        .order("created_at", { ascending: false });

      currentJobs = jobs || [];

      const { data: apps } = await sb
        .from("applications")
        .select(`
          *,
          job_postings:job_id(title)
        `)
        .in("job_id", (jobs || []).map(j => j.id))
        .order("created_at", { ascending: false });

      currentApplications = apps || [];
      loadOverview();
    } catch (e) {
      console.error("Failed to load dashboard:", e);
    }
  }

  async function loadOverview() {
    const activeJobs = currentJobs.filter(j => j.status === "open").length;
    const newApps = currentApplications.filter(a => a.status === "new").length;
    const avgMatch = currentApplications.length > 0
      ? Math.round(currentApplications.reduce((sum, a) => sum + (a.match_score || 0), 0) / currentApplications.length)
      : "—";

    document.getElementById("overviewActiveJobs").textContent = activeJobs;
    document.getElementById("overviewNewApps").textContent = newApps;
    document.getElementById("overviewAvgMatch").textContent = avgMatch === "—" ? "—" : avgMatch + "%";
  }

  async function loadJobsList() {
    const container = document.getElementById("jobsList");

    if (!currentJobs.length) {
      container.innerHTML = "<p style='color: var(--ink-2);'>No job postings yet. <a href='#' onclick='window.dashboard.showSection(\"create\");return false'>Create one</a></p>";
      return;
    }

    container.innerHTML = currentJobs.map(job => {
      const appCount = currentApplications.filter(a => a.job_id === job.id).length;
      return `
        <div class="job-card" onclick="window.dashboard.showJobDetail('${job.id}')">
          <div class="job-card-header">
            <h3 class="job-card-title">${esc(job.title)}</h3>
            <span class="job-card-code">${esc(job.company_code)}</span>
          </div>
          <div class="job-card-meta">
            <span>${new Date(job.created_at).toLocaleDateString()}</span>
            <span>${appCount} application${appCount !== 1 ? "s" : ""}</span>
          </div>
          <div>
            <span class="job-card-status ${job.status}">${job.status === "open" ? "Open" : "Closed"}</span>
          </div>
        </div>
      `;
    }).join("");
  }

  async function loadApplicationsList() {
    const container = document.getElementById("applicationsList");

    if (!currentApplications.length) {
      container.innerHTML = "<p style='color: var(--ink-2);'>No applications yet.</p>";
      return;
    }

    // Group by job
    const byJob = {};
    currentApplications.forEach(app => {
      if (!byJob[app.job_id]) byJob[app.job_id] = [];
      byJob[app.job_id].push(app);
    });

    let html = "";
    for (const jobId in byJob) {
      const job = currentJobs.find(j => j.id === jobId);
      if (!job) continue;

      const apps = byJob[jobId].sort((a, b) => (b.match_score || 0) - (a.match_score || 0));

      html += `<h3 style="margin-top: 24px; margin-bottom: 12px;">${esc(job.title)}</h3>`;

      html += apps.map(app => `
        <div class="app-card" onclick="window.dashboard.showAppDetail('${app.id}')">
          <div class="app-card-header">
            <span class="app-card-name">${esc(app.career_dna?.name || "Candidate")}</span>
            <span class="match-badge">${app.match_score}% match</span>
          </div>
          <div class="app-card-summary">${esc(app.match_summary || "No summary available")}</div>
          <div style="font-size: 12px; color: var(--ink-2);">
            Applied ${new Date(app.created_at).toLocaleDateString()}
            ${app.status === "new" ? "· <strong>New</strong>" : ""}
          </div>
        </div>
      `).join("");
    }

    container.innerHTML = html || "<p style='color: var(--ink-2);'>No applications yet.</p>";
  }

  function showJobDetail(jobId) {
    const job = currentJobs.find(j => j.id === jobId);
    if (!job) return;

    alert(`Job: ${job.title}\n\n${job.description}`);
  }

  function showAppDetail(appId) {
    const app = currentApplications.find(a => a.id === appId);
    if (!app) return;

    const gaps = app.gaps && app.gaps.length ? app.gaps.join(", ") : "None";
    alert(`Match: ${app.match_score}%\n\n${app.match_summary}\n\nGaps: ${gaps}`);
  }

  /* ========== Helpers ========== */

  function generateCompanyCode(companyName) {
    // Generate code like "WLMD22" from "Wellness Medical"
    const words = companyName.trim().split(/\s+/);
    let code = words.map(w => w[0].toUpperCase()).join("");
    if (code.length > 3) code = code.slice(0, 3);

    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return code + month + day;
  }

  /* ========== Initialize ========== */

  // Export global API for onclick handlers
  window.dashboard = {
    showSection,
    addSkill,
    removeSkill,
    showJobDetail,
    showAppDetail
  };

  document.addEventListener("DOMContentLoaded", () => {
    try {
      checkAuth();
    } catch (e) {
      console.error("Dashboard init error:", e);
      alert("Dashboard error: " + (e.message || e));
    }
  });
})();
