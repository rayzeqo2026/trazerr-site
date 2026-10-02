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
  let modalElement = null;

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

      // Sign out
      document.getElementById("signOut").addEventListener("click", async () => {
        await sb.auth.signOut().catch(() => {});
        window.location.href = "/employers.html";
      });

      // Sidebar navigation
      document.querySelectorAll(".dash-sidebar nav a[data-section]").forEach(link => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          const section = link.dataset.section;
          showSection(section);
        });
      });

      // Search input listener
      const searchInput = document.getElementById("jobSearchInput");
      if (searchInput) {
        searchInput.addEventListener("input", () => {
          loadJobsList();
        });
      }

      // Job form is now on post-job.html, so no need to attach listener here
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
    const searchInput = document.getElementById("jobSearchInput");

    console.log("📋 loadJobsList called, currentJobs count:", currentJobs.length);

    if (!currentJobs.length) {
      container.innerHTML = "<p style='color: var(--ink-2);'>No job postings yet. <a href='#' onclick='window.dashboard.showSection(\"create\");return false'>Create one</a></p>";
      return;
    }

    // Filter jobs by search term
    const searchTerm = (searchInput?.value || "").toLowerCase();
    const filteredJobs = searchTerm ? currentJobs.filter(j => j.company_code.toLowerCase().includes(searchTerm)) : currentJobs;
    console.log("🔍 Filtered jobs count:", filteredJobs.length, "searchTerm:", searchTerm);

    if (!filteredJobs.length) {
      container.innerHTML = `<p style='color: var(--ink-2);'>No jobs match "${esc(searchTerm)}"</p>`;
      return;
    }

    container.innerHTML = filteredJobs.map((job, idx) => {
      const appCount = currentApplications.filter(a => a.job_id === job.id).length;
      return `
        <div class="job-card" data-job-index="${idx}">
          <div class="job-card-header">
            <div class="job-card-clickable" style="cursor: pointer; flex: 1;">
              <h3 class="job-card-title">${esc(job.title)}</h3>
              <span class="job-card-code">${esc(job.company_code)}</span>
            </div>
            <button class="job-card-delete" style="background: #c00; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;">Delete</button>
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

    // Add event listeners to job cards
    container.querySelectorAll(".job-card").forEach(card => {
      const idx = parseInt(card.dataset.jobIndex, 10);
      const job = filteredJobs[idx];
      if (!job) {
        console.warn("Job not found at index", idx);
        return;
      }

      card.querySelector(".job-card-clickable").addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showJobModal(job);
      });

      card.querySelector(".job-card-delete").addEventListener("click", () => {
        console.log("Deleting job:", job.id, job.title);
        deleteJob(job.id, job.title);
      });
    });
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
    window.location.href = "/job-detail.html?id=" + encodeURIComponent(jobId);
  }

  function showAppDetail(appId) {
    const app = currentApplications.find(a => a.id === appId);
    if (!app) return;

    const gaps = app.gaps && app.gaps.length ? app.gaps.join(", ") : "None";
    alert(`Match: ${app.match_score}%\n\n${app.match_summary}\n\nGaps: ${gaps}`);
  }

  async function deleteJob(jobId, jobTitle) {
    if (!confirm(`Are you sure you want to delete "${jobTitle}"? This cannot be undone.`)) {
      return;
    }

    try {
      const result = await api("jobdelete", { job_id: jobId });
      currentJobs = currentJobs.filter(j => j.id !== jobId);
      currentApplications = currentApplications.filter(a => a.job_id !== jobId);
      loadJobsList();
      loadOverview();
    } catch (e) {
      showError(e.message || "Failed to delete job");
    }
  }

  /* ========== Helpers ========== */

  function showJobModal(job) {
    const dna = (typeof job.job_dna === "string" ? JSON.parse(job.job_dna) : job.job_dna) || {};
    const coreSkills = (dna.core_skills || job.required_skills || []).filter(Boolean);
    const requirements = (dna.must_have || []).filter(Boolean);
    const nice = (dna.nice_to_have || []).filter(Boolean);
    const experience = (dna.experience_areas || []).filter(Boolean);
    const resp = (dna.key_responsibilities || []).filter(Boolean);

    // Create modal only once
    if (!modalElement) {
      const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() ||
                      (document.documentElement.dataset.theme === 'dark' ? '#0E1628' : '#FFFFFF');

      modalElement = document.createElement("div");
      modalElement.id = "jobModal";
      modalElement.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: ${bgColor}; z-index: 10001; overflow-y: auto;
        padding: 20px; margin: 0; display: none;
      `;

      modalElement.addEventListener('click', (e) => {
        if (e.target === modalElement) modalElement.style.display = 'none';
      });

      document.body.appendChild(modalElement);
    }

    // Update modal content and show it
    modalElement.style.display = 'block';
    modalElement.innerHTML = `
      <div style="position: sticky; top: 0; z-index: 2; background: rgba(244,245,241,.96); backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); padding: 12px 20px;">
        <div style="max-width: 760px; margin: 0 auto; display: flex; align-items: center; gap: 12px;">
          <button onclick="document.getElementById('jobModal').style.display='none'" style="background: none; border: none; font-size: 20px; cursor: pointer; color: var(--ink); padding: 0;">← Back</button>
          <span style="font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(job.title)}</span>
        </div>
      </div>

      <div style="max-width: 760px; margin: 0 auto; padding: 28px 20px 72px;">
        <div style="background: linear-gradient(135deg, #001a4d 0%, #003d99 100%); color: white; border-radius: 16px; padding: 26px; border-top: 3px solid #D4AF37; margin-bottom: 32px;">
          <h1 style="font-family: Georgia, serif; font-size: 32px; line-height: 1.15; margin: 0 0 16px; font-weight: 500;">${esc(job.title)}</h1>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; border-top: 1px solid rgba(255,255,255,0.2); border-bottom: 1px solid rgba(255,255,255,0.2); padding: 14px 0; font-size: 14px; color: #AEB8CC;">
            <div><span style="display: block; color: rgba(255,255,255,0.6); font-size: 13px; margin-bottom: 4px;">Company Code</span><b style="color: white;">${esc(job.company_code)}</b></div>
            <div><span style="display: block; color: rgba(255,255,255,0.6); font-size: 13px; margin-bottom: 4px;">Location</span><b style="color: white;">${esc(job.location || "Not specified")}</b></div>
          </div>
          <div style="margin-top: 14px; font-size: 14px; color: #AEB8CC;">📍 ${esc(job.location || "Not specified")} ${job.remote_ok ? "• 🌐 Remote available" : "• On-site only"}</div>
        </div>

        <div style="margin-bottom: 32px;">
          <h2 style="font-size: 18px; font-weight: 600; padding-bottom: 10px; border-bottom: 1px solid var(--border); margin: 0 0 16px;">About This Role</h2>
          <p style="color: var(--ink-2); line-height: 1.6; margin: 0; font-size: 15px;">${esc(job.description || "No description").split('\n').join('<br>')}</p>
        </div>

        ${coreSkills.length > 0 ? `
        <div style="margin-bottom: 32px;">
          <h3 style="font-size: 13px; font-weight: 700; color: #0066ff; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.5px;">✓ Core Skills</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            ${coreSkills.map(s => `<span style="display: inline-block; background: #0066ff; color: white; padding: 8px 14px; border-radius: 20px; font-size: 13px; font-weight: 500;">${esc(s)}</span>`).join("")}
          </div>
        </div>
        ` : ""}

        ${requirements.length > 0 ? `
        <div style="margin-bottom: 32px;">
          <h3 style="font-size: 13px; font-weight: 700; color: #f59e0b; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.5px;">⭐ Requirements</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            ${requirements.map(s => `<span style="display: inline-block; background: #f59e0b; color: white; padding: 8px 14px; border-radius: 20px; font-size: 13px; font-weight: 500;">${esc(s)}</span>`).join("")}
          </div>
        </div>
        ` : ""}

        ${nice.length > 0 ? `
        <div style="margin-bottom: 32px;">
          <h3 style="font-size: 13px; font-weight: 700; color: #22c55e; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.5px;">★ Nice to Have</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            ${nice.map(s => `<span style="display: inline-block; background: #22c55e; color: white; padding: 8px 14px; border-radius: 20px; font-size: 13px; font-weight: 500;">${esc(s)}</span>`).join("")}
          </div>
        </div>
        ` : ""}

        ${experience.length > 0 ? `
        <div style="margin-bottom: 32px;">
          <h3 style="font-size: 13px; font-weight: 700; color: #8b5cf6; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.5px;">📊 Experience Areas</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            ${experience.map(s => `<span style="display: inline-block; background: #8b5cf6; color: white; padding: 8px 14px; border-radius: 20px; font-size: 13px; font-weight: 500;">${esc(s)}</span>`).join("")}
          </div>
        </div>
        ` : ""}

        ${resp.length > 0 ? `
        <div style="margin-bottom: 32px;">
          <h3 style="font-size: 18px; font-weight: 600; padding-bottom: 10px; border-bottom: 1px solid var(--border); margin: 0 0 16px;">Key Responsibilities</h3>
          <ul style="list-style: none; padding: 0; margin: 0;">
            ${resp.map(r => `<li style="display: grid; grid-template-columns: 22px 1fr; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--border-soft); font-size: 15px; color: var(--ink);"><span style="font-weight: 700; color: var(--blue); text-align: center;">•</span><span>${esc(r)}</span></li>`).join("")}
          </ul>
        </div>
        ` : ""}

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 32px;">
          <button onclick="document.getElementById('jobModal').style.display='none'" style="padding: 14px; border: 1px solid var(--border); background: var(--bg); color: var(--ink); border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 15px; font-family: inherit;">← Back</button>
          <button onclick="window.dashboard.deleteJob('${job.id}', '${job.title.replace(/'/g, "\\'")}'); document.getElementById('jobModal').style.display='none';" style="padding: 14px; background: #ef4444; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 15px; font-family: inherit;">Delete Job</button>
        </div>
      </div>
    `;
  }

  function generateCompanyCode(companyName) {
    // Generate code like "WM1002" (2 letters + month + day)
    const words = (companyName || "XX").trim().split(/\s+/);
    let code = words.map(w => w[0].toUpperCase()).join("");
    if (code.length > 2) code = code.slice(0, 2);
    while (code.length < 2) code += "X";

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
    showAppDetail,
    deleteJob
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
