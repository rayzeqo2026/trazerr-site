// Trazerr job search
(function(){
  const API = "/api/app";
  const SB_LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js";
  const SB_LIB_SRI = "sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok";

  let sb = null;
  let allJobs = [];
  let selectedJob = null;
  let currentSession = null;

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

  async function initialize() {
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
      if (location.hash.includes("access_token=")) {
        history.replaceState(null, "", location.pathname);
      }

      currentSession = session;

      if (currentSession) {
        document.getElementById("signInBtn").textContent = "Dashboard";
        document.getElementById("signInBtn").onclick = () => window.location.href = "/";
      } else {
        document.getElementById("signInBtn").onclick = () => window.location.href = "/";
      }

      // Load all jobs
      loadAllJobs();

      // Setup search
      document.getElementById("searchBtn").onclick = performSearch;
      document.getElementById("searchInput").onkeypress = (e) => {
        if (e.key === "Enter") performSearch();
      };
    } catch (e) {
      console.error("Failed to initialize:", e);
      document.getElementById("results").innerHTML = "<p style='color:red;'>Failed to load. <a href='javascript:location.reload()'>Try again</a></p>";
    }
  }

  async function loadAllJobs() {
    try {
      const { data, error } = await sb
        .from("job_postings")
        .select("id, employer_id, company_code, title, description, required_skills, nice_to_have, experience_level, location, remote_ok, status, created_at")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        console.error("Error loading jobs:", error);
        return;
      }

      allJobs = data || [];
      renderResults(allJobs);
    } catch (e) {
      console.error("Failed to load jobs:", e);
    }
  }

  function performSearch() {
    const query = document.getElementById("searchInput").value.trim().toUpperCase();
    if (!query) {
      renderResults(allJobs);
      return;
    }

    const filtered = allJobs.filter(job =>
      job.company_code?.includes(query) ||
      job.title?.toUpperCase().includes(query) ||
      job.description?.toUpperCase().includes(query)
    );

    renderResults(filtered);
  }

  function renderResults(jobs) {
    const container = document.getElementById("results");

    if (!jobs || jobs.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No jobs found matching your search.</p><p><a href="javascript:document.getElementById(\'searchInput\').value=\'\'; loadAllJobs();">View all jobs</a></p></div>';
      return;
    }

    container.innerHTML = jobs.map(job => `
      <div class="job-item" onclick="window.jobSearch.selectJob('${job.id}')">
        <div class="job-item-header">
          <h3 class="job-item-title">${esc(job.title)}</h3>
          <span class="job-item-code">${esc(job.company_code)}</span>
        </div>
        <p class="job-item-company">${esc(job.location || "Remote")}${job.remote_ok ? " · Remote OK" : ""}</p>
        <div class="job-item-meta">
          <span>${job.experience_level ? job.experience_level.charAt(0).toUpperCase() + job.experience_level.slice(1) : "Experience level"}</span>
          <span>Posted ${new Date(job.created_at).toLocaleDateString()}</span>
        </div>
        <p class="job-item-desc">${esc(job.description.slice(0, 150))}${job.description.length > 150 ? "..." : ""}</p>
        <div class="job-item-skills">
          ${(job.required_skills || []).slice(0, 3).map(skill => `<span class="skill-badge">${esc(skill)}</span>`).join("")}
          ${(job.required_skills || []).length > 3 ? `<span class="skill-badge">+${(job.required_skills || []).length - 3} more</span>` : ""}
        </div>
      </div>
    `).join("");
  }

  function selectJob(jobId) {
    selectedJob = allJobs.find(j => j.id === jobId);
    if (!selectedJob) return;

    document.getElementById("modalJobTitle").textContent = selectedJob.title;
    document.getElementById("modalJobCompany").textContent = selectedJob.location + (selectedJob.remote_ok ? " · Remote OK" : "");
    document.getElementById("modalJobDesc").textContent = selectedJob.description;

    const requiredContainer = document.getElementById("modalJobRequired");
    requiredContainer.innerHTML = (selectedJob.required_skills || []).map(skill =>
      `<span class="skill-badge">${esc(skill)}</span>`
    ).join("");

    document.getElementById("jobModal").classList.add("active");
  }

  function closeJobModal() {
    document.getElementById("jobModal").classList.remove("active");
    selectedJob = null;
  }

  async function applyForJob() {
    if (!selectedJob) return;

    if (!currentSession) {
      alert("Please sign in to apply for jobs.");
      window.location.href = "/";
      return;
    }

    // Check if candidate has a Career DNA
    try {
      const { data: careerRecord } = await sb
        .from("career_records")
        .select("career_dna")
        .eq("user_id", currentSession.user.id)
        .single();

      if (!careerRecord || !careerRecord.career_dna) {
        alert("Please build your Career DNA first before applying.");
        window.location.href = "/";
        return;
      }

      // Submit application
      const { data: application, error } = await sb
        .from("applications")
        .insert([{
          job_id: selectedJob.id,
          candidate_id: currentSession.user.id,
          career_dna: careerRecord.career_dna,
          match_score: 0, // Will be calculated by API
          status: "new"
        }])
        .select();

      if (error && error.code === "23505") {
        alert("You've already applied for this job.");
        closeJobModal();
        return;
      }

      if (error) throw error;

      alert("Application submitted! You'll see your match score shortly.");
      closeJobModal();
      loadAllJobs(); // Refresh to show updated state
    } catch (e) {
      console.error("Failed to apply:", e);
      alert("Failed to submit application: " + (e.message || "Unknown error"));
    }
  }

  // Export global API
  window.jobSearch = {
    selectJob,
    closeJobModal: closeJobModal,
    applyForJob,
    performSearch,
    loadAllJobs
  };

  window.closeJobModal = closeJobModal;
  window.applyForJob = applyForJob;

  document.addEventListener("DOMContentLoaded", initialize);
})();
