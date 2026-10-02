// Trazerr job search
(function(){
  const API = "/api/app";
  const SB_LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js";
  const SB_LIB_SRI = "sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok";

  let sb = null;
  let allJobs = [];
  let selectedJob = null;
  let currentSession = null;
  let candidateSkills = [];
  let candidateResume = null;

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
      console.log("🚀 Initializing job search...");
      const cfg = await fetch(API + "?action=authconfig").then(r => {
        if (!r.ok) throw new Error("Failed to get auth config");
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
      console.log("✓ Session loaded:", currentSession?.user?.email || "Not signed in");

      if (currentSession) {
        document.getElementById("signInBtn").textContent = "Dashboard";
        document.getElementById("signInBtn").onclick = () => window.location.href = "/";
      } else {
        document.getElementById("signInBtn").onclick = () => window.location.href = "/";
      }

      // Load all jobs
      console.log("📋 Loading jobs...");
      await loadAllJobs();

      // Load user's saved resume if signed in
      if (currentSession) {
        try {
          console.log("📄 Loading saved resume for user:", currentSession.user.id);
          const { data: record, error } = await sb
            .from("career_records")
            .select("resume, career_dna")
            .eq("user_id", currentSession.user.id)
            .single();

          if (error) {
            console.warn("⚠️ Resume fetch error:", error.message);
          }

          if (record) {
            console.log("✓ Career record found", {
              hasResume: !!record.resume,
              hasCareerDna: !!record.career_dna,
              resumeLength: record.resume?.length || 0,
              dnalength: record.career_dna ? String(record.career_dna).length : 0
            });
          } else {
            console.warn("⚠️ No career record found for user");
          }

          if (record && (record.resume || record.career_dna)) {
            // Use resume field if available, otherwise extract from career_dna
            if (record.resume) {
              candidateResume = record.resume;
            } else if (record.career_dna) {
              try {
                const dnaData = typeof record.career_dna === 'string' ? JSON.parse(record.career_dna) : record.career_dna;
                candidateResume = [
                  dnaData.fullName || '',
                  dnaData.headline || '',
                  dnaData.description || '',
                  (dnaData.strengths || []).map(s => typeof s === 'string' ? s : (s.name || s.text || '')).join(' '),
                  (dnaData.highlights || []).map(h => typeof h === 'string' ? h : (h.text || h.name || '')).join(' '),
                  (dnaData.potentials || []).map(p => typeof p === 'string' ? p : (p.name || p.text || '')).join(' ')
                ].filter(Boolean).join(' ');
                console.log("✓ Extracted resume text from Career DNA");
              } catch (e) {
                console.error("Error parsing career_dna:", e);
                return;
              }
            }
            console.log("✓ Saved resume loaded");

            // Extract skills from saved resume
            const allSkillsText = candidateResume.toLowerCase();
            const commonSkills = [
              'javascript', 'python', 'java', 'c++', 'c#', 'typescript', 'react', 'angular', 'vue',
              'node.js', 'express', 'django', 'flask', 'spring', 'sql', 'mongodb', 'postgresql',
              'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'git', 'rest api', 'graphql',
              'html', 'css', 'bootstrap', 'tailwind', 'webpack', 'npm', 'yarn', 'sass',
              'agile', 'scrum', 'jira', 'confluence', 'linux', 'windows', 'macos',
              'communication', 'leadership', 'teamwork', 'problem-solving', 'project management',
              'data analysis', 'machine learning', 'ai', 'nlp', 'computer vision', 'deep learning',
              'sales', 'marketing', 'business development', 'customer service', 'negotiation',
              'financial analysis', 'accounting', 'budgeting', 'forecasting',
              'project management', 'risk management', 'quality assurance', 'testing'
            ];

            candidateSkills = commonSkills.filter(skill => {
              const regex = new RegExp(`\\b${skill.replace(/[+]/g, '\\+')}\\b`, 'gi');
              return regex.test(allSkillsText);
            });

            console.log(`✓ Extracted ${candidateSkills.length} skills from saved resume`);

            // Hide resume upload section and show status
            const resumeSection = document.getElementById("resumeSection");
            const statusEl = document.getElementById("resumeStatus");
            console.log("🔍 Resume section element:", resumeSection ? "found" : "NOT FOUND");
            console.log("🔍 Resume status element:", statusEl ? "found" : "NOT FOUND");

            if (resumeSection) {
              resumeSection.style.display = "none";
              console.log("✓ Resume upload section hidden");

              if (statusEl) {
                statusEl.innerHTML = `
                  <div class="resume-status ready">
                    ✓ Using saved resume with <strong>${candidateSkills.length} skills</strong> detected
                  </div>
                `;
                console.log("✓ Resume status updated");
              }
            }

            // Re-render with match scores
            renderResults(allJobs);
            console.log("✓ Results re-rendered with match scores");
          } else {
            console.warn("⚠️ No saved resume found in career_records");
          }
        } catch (e) {
          console.log("ℹ️ No saved resume yet, showing upload option:", e.message);
        }
      } else {
        console.log("ℹ️ User not signed in - resume upload required for match scores");
      }

      // Setup resume upload
      const resumeFile = document.getElementById("resumeFile");
      const searchBtn = document.getElementById("searchBtn");
      const searchInput = document.getElementById("searchInput");

      if (resumeFile) {
        resumeFile.addEventListener("change", handleResumeUpload);
        console.log("✓ Resume upload handler attached");

        // Drag and drop
        const resumeSection = document.getElementById("resumeSection");
        if (resumeSection) {
          resumeSection.addEventListener("dragover", (e) => {
            e.preventDefault();
            resumeSection.classList.add("active");
          });
          resumeSection.addEventListener("dragleave", () => resumeSection.classList.remove("active"));
          resumeSection.addEventListener("drop", (e) => {
            e.preventDefault();
            resumeSection.classList.remove("active");
            if (e.dataTransfer.files.length > 0) {
              handleResumeUpload({ target: { files: e.dataTransfer.files } });
            }
          });
          console.log("✓ Drag and drop handler attached");
        }
      }

      // Setup search button
      if (searchBtn) {
        searchBtn.addEventListener("click", performSearch);
        console.log("✓ Search button handler attached");
      }

      if (searchInput) {
        searchInput.addEventListener("keypress", (e) => {
          if (e.key === "Enter") performSearch();
        });
        console.log("✓ Search input handler attached");
      }

      console.log("✅ Job search initialized successfully");
    } catch (e) {
      console.error("❌ Failed to initialize:", e);
      const resultsEl = document.getElementById("results");
      if (resultsEl) {
        resultsEl.innerHTML = `<div class="empty-state"><p style="color:red;"><strong>Error:</strong> ${esc(e.message)}</p><p><a href="javascript:location.reload()">Reload page to try again</a></p></div>`;
      }
    }
  }

  async function loadAllJobs() {
    try {
      if (!sb) throw new Error("Supabase not initialized");

      const { data, error } = await sb
        .from("job_postings")
        .select("id, employer_id, company_code, title, description, required_skills, nice_to_have, experience_level, location, remote_ok, status, created_at")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        console.error("Error loading jobs:", error);
        throw error;
      }

      allJobs = data || [];
      console.log(`📊 Loaded ${allJobs.length} jobs`);
      renderResults(allJobs);
    } catch (e) {
      console.error("Failed to load jobs:", e);
      const container = document.getElementById("results");
      if (container) {
        container.innerHTML = `<div class="empty-state"><p style="color:red;">Failed to load jobs: ${esc(e.message)}</p></div>`;
      }
    }
  }

  async function handleResumeUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const statusEl = document.getElementById("resumeStatus");
    statusEl.innerHTML = '<div style="color: var(--ink-2);">📂 Reading file...</div>';

    try {
      // Read file using FileReader for better browser compatibility
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target.result);
        reader.onerror = (error) => reject(error);
        reader.readAsText(file);
      });

      // Simple skill extraction - split by common delimiters
      const allSkillsText = text.toLowerCase();
      const commonSkills = [
        'javascript', 'python', 'java', 'c++', 'c#', 'typescript', 'react', 'angular', 'vue',
        'node.js', 'express', 'django', 'flask', 'spring', 'sql', 'mongodb', 'postgresql',
        'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'git', 'rest api', 'graphql',
        'html', 'css', 'bootstrap', 'tailwind', 'webpack', 'npm', 'yarn', 'sass',
        'agile', 'scrum', 'jira', 'confluence', 'linux', 'windows', 'macos',
        'communication', 'leadership', 'teamwork', 'problem-solving', 'project management',
        'data analysis', 'machine learning', 'ai', 'nlp', 'computer vision', 'deep learning',
        'sales', 'marketing', 'business development', 'customer service', 'negotiation',
        'financial analysis', 'accounting', 'budgeting', 'forecasting',
        'project management', 'risk management', 'quality assurance', 'testing'
      ];

      candidateSkills = commonSkills.filter(skill => {
        const regex = new RegExp(`\\b${skill.replace(/[+]/g, '\\+')}\\b`, 'gi');
        return regex.test(allSkillsText);
      });

      candidateResume = text;

      console.log(`✓ Resume uploaded - ${candidateSkills.length} skills detected`);

      if (candidateSkills.length > 0) {
        statusEl.innerHTML = `
          <div class="resume-status ready">
            ✓ Resume loaded with <strong>${candidateSkills.length} skills</strong> detected
          </div>
        `;
      } else {
        statusEl.innerHTML = `
          <div class="resume-status ready">
            ✓ Resume loaded (tip: include known skills to see match scores)
          </div>
        `;
      }

      renderResults(allJobs);
    } catch (err) {
      statusEl.innerHTML = '<div style="color: #ef4444;">✗ Error reading file. Make sure it\'s a text or PDF file.</div>';
      console.error("Resume upload error:", err);
    }
  }

  function calculateMatch(job) {
    if (candidateSkills.length === 0) return null;

    const jobSkills = (job.required_skills || []).map(s => s.toLowerCase());
    if (jobSkills.length === 0) return null;

    const matched = jobSkills.filter(skill =>
      candidateSkills.some(cSkill => skill.includes(cSkill) || cSkill.includes(skill))
    ).length;

    return Math.round((matched / jobSkills.length) * 100);
  }

  function performSearch() {
    const searchInput = document.getElementById("searchInput");
    const query = searchInput ? searchInput.value.trim().toUpperCase() : "";
    console.log("🔍 Performing search with query:", query || "(all jobs)");

    if (!query) {
      console.log("📊 Showing all", allJobs.length, "jobs");
      renderResults(allJobs);
      return;
    }

    const filtered = allJobs.filter(job =>
      job.company_code?.includes(query) ||
      job.title?.toUpperCase().includes(query) ||
      job.description?.toUpperCase().includes(query)
    );

    console.log("📊 Filtered to", filtered.length, "jobs");
    renderResults(filtered);
  }

  function renderResults(jobs) {
    const container = document.getElementById("results");
    if (!container) return;

    if (!jobs || jobs.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No jobs found matching your search.</p><p><a href="javascript:void(0);" onclick="document.getElementById(\'searchInput\').value=\'\'; window.jobSearch.performSearch();">View all jobs</a></p></div>';
      return;
    }

    container.innerHTML = jobs.map(job => {
      const matchScore = calculateMatch(job);
      const matchClass = matchScore >= 75 ? 'high' : matchScore >= 50 ? 'medium' : 'low';

      return `
        <div class="job-item" data-job-id="${esc(job.id)}">
          ${matchScore !== null ? `
            <div class="job-item-match">
              <div class="match-score ${matchClass}">${matchScore}%</div>
              <div class="match-label">
                <div class="match-label-score">Match Score</div>
                <div class="match-label-text">${matchScore >= 75 ? 'Excellent fit' : matchScore >= 50 ? 'Good fit' : 'Potential match'}</div>
              </div>
            </div>
          ` : ''}
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
      `;
    }).join("");

    // Attach click handlers to job items using event delegation
    container.addEventListener("click", (e) => {
      const jobItem = e.target.closest(".job-item");
      if (jobItem && jobItem.dataset.jobId) {
        console.log("📍 Job item clicked:", jobItem.dataset.jobId);
        selectJob(jobItem.dataset.jobId);
      }
    });
  }

  function selectJob(jobId) {
    console.log("🎯 Selecting job:", jobId);
    selectedJob = allJobs.find(j => j.id === jobId);
    if (!selectedJob) {
      console.error("❌ Job not found:", jobId);
      return;
    }

    document.getElementById("modalJobTitle").textContent = selectedJob.title;
    document.getElementById("modalJobCompany").textContent = selectedJob.location + (selectedJob.remote_ok ? " · Remote OK" : "");
    document.getElementById("modalJobDesc").textContent = selectedJob.description;

    const requiredContainer = document.getElementById("modalJobRequired");
    requiredContainer.innerHTML = (selectedJob.required_skills || []).map(skill =>
      `<span class="skill-badge">${esc(skill)}</span>`
    ).join("");

    // Show match analysis if resume is uploaded
    const matchScoreEl = document.getElementById("modalMatchScore");
    const analysisEl = document.getElementById("modalSkillsAnalysis");

    const matchScore = calculateMatch(selectedJob);
    if (matchScore !== null) {
      const matchClass = matchScore >= 75 ? 'high' : matchScore >= 50 ? 'medium' : 'low';
      matchScoreEl.innerHTML = `
        <div style="display: flex; align-items: center; gap: 16px; padding: 16px; background: ${matchClass === 'high' ? 'rgba(34, 197, 94, 0.1)' : matchClass === 'medium' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; border-radius: 8px; border-left: 4px solid ${matchClass === 'high' ? '#22c55e' : matchClass === 'medium' ? '#f59e0b' : '#ef4444'};">
          <div style="font-size: 40px; font-weight: 700; color: ${matchClass === 'high' ? '#22c55e' : matchClass === 'medium' ? '#f59e0b' : '#ef4444'};">${matchScore}%</div>
          <div>
            <div style="font-weight: 700; color: var(--ink);">Match Score</div>
            <div style="font-size: 14px; color: var(--ink-2);">${matchScore >= 75 ? 'Excellent fit - you have most required skills' : matchScore >= 50 ? 'Good fit - you have many required skills' : 'Potential match - some skills align with requirements'}</div>
          </div>
        </div>
      `;

      // Show skill analysis
      const jobSkills = (selectedJob.required_skills || []).map(s => s.toLowerCase());
      const hasSkills = jobSkills.filter(skill =>
        candidateSkills.some(cSkill => skill.includes(cSkill) || cSkill.includes(skill))
      );
      const missingSkills = jobSkills.filter(skill =>
        !candidateSkills.some(cSkill => skill.includes(cSkill) || cSkill.includes(skill))
      );

      if (hasSkills.length > 0 || missingSkills.length > 0) {
        analysisEl.innerHTML = `
          <div>
            <strong style="font-size: 14px; color: var(--ink-2); text-transform: uppercase;">Skill Analysis</strong>
            ${hasSkills.length > 0 ? `
              <div style="margin-top: 8px;">
                <div style="font-size: 13px; font-weight: 600; color: #22c55e; margin-bottom: 6px;">✓ You have ${hasSkills.length} required skill${hasSkills.length !== 1 ? 's' : ''}:</div>
                <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                  ${hasSkills.slice(0, 5).map(s => `<span class="skill-badge" style="background: #22c55e; color: white;">${esc(s)}</span>`).join("")}
                </div>
              </div>
            ` : ''}
            ${missingSkills.length > 0 ? `
              <div style="margin-top: 12px;">
                <div style="font-size: 13px; font-weight: 600; color: #f59e0b; margin-bottom: 6px;">⚡ Skills to develop:</div>
                <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                  ${missingSkills.slice(0, 5).map(s => `<span class="skill-badge" style="background: #f59e0b; color: white;">${esc(s)}</span>`).join("")}
                  ${missingSkills.length > 5 ? `<span class="skill-badge" style="background: #f59e0b; color: white;">+${missingSkills.length - 5} more</span>` : ''}
                </div>
              </div>
            ` : ''}
          </div>
        `;
      }
    } else {
      matchScoreEl.innerHTML = '';
      analysisEl.innerHTML = '';
    }

    const modal = document.getElementById("jobModal");
    if (modal) {
      modal.classList.add("active");
      document.body.classList.add("modal-open");
      console.log("✅ Modal opened for job:", selectedJob.title);
    } else {
      console.error("❌ Modal element not found!");
    }
  }

  function closeJobModal() {
    const modal = document.getElementById("jobModal");
    if (modal) {
      modal.classList.remove("active");
      document.body.classList.remove("modal-open");
      console.log("✅ Modal closed");
    }
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
          match_score: 0,
          status: "new"
        }])
        .select();

      if (error && error.code === "23505") {
        alert("You've already applied for this job.");
        closeJobModal();
        return;
      }

      if (error) throw error;

      const appId = application[0]?.id;
      if (appId) {
        try {
          const token = currentSession.access_token;
          await fetch(API + "?action=jobmatch", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + token,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              application_id: appId,
              job_id: selectedJob.id,
              candidate_id: currentSession.user.id
            })
          });

          await fetch(API + "?action=appAlert", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + token,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ application_id: appId })
          }).catch(() => {});
        } catch (e) {
          console.error("Failed to calculate match or send alert:", e);
        }
      }

      alert("Application submitted! The employer will be notified of your match score.");
      closeJobModal();
      await loadAllJobs();
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

  // Attach event listeners even if initialization fails
  function setupEventListeners() {
    const resumeFile = document.getElementById("resumeFile");
    const searchBtn = document.getElementById("searchBtn");
    const searchInput = document.getElementById("searchInput");

    if (resumeFile && !resumeFile.hasAttribute("data-listener-attached")) {
      resumeFile.addEventListener("change", handleResumeUpload);
      resumeFile.setAttribute("data-listener-attached", "true");
      console.log("✓ Resume upload handler attached (fallback)");
    }

    if (searchBtn && !searchBtn.hasAttribute("data-listener-attached")) {
      searchBtn.addEventListener("click", performSearch);
      searchBtn.setAttribute("data-listener-attached", "true");
      console.log("✓ Search button handler attached (fallback)");
    }

    if (searchInput && !searchInput.hasAttribute("data-listener-attached")) {
      searchInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") performSearch();
      });
      searchInput.setAttribute("data-listener-attached", "true");
      console.log("✓ Search input handler attached (fallback)");
    }
  }

  // Initialize immediately if DOM is already loaded, otherwise wait for event
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setupEventListeners();
      initialize().catch(e => {
        console.error("Initialization failed:", e);
        setupEventListeners(); // Try again as fallback
      });
    });
  } else {
    setupEventListeners();
    initialize().catch(e => {
      console.error("Initialization failed:", e);
      setupEventListeners(); // Try again as fallback
    });
  }
})();
