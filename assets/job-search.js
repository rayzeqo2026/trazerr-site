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
  let bookmarkedJobs = JSON.parse(localStorage.getItem("trazerr.bookmarks") || "[]");

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

            // Update resume section to show it's loaded
            const resumeSection = document.getElementById("resumeSection");
            const statusEl = document.getElementById("resumeStatus");
            console.log("🔍 Resume section element:", resumeSection ? "found" : "NOT FOUND");
            console.log("🔍 Resume status element:", statusEl ? "found" : "NOT FOUND");

            if (resumeSection) {
              // Update the section to show resume is loaded instead of upload prompt
              resumeSection.style.pointerEvents = "none";
              resumeSection.style.opacity = "0.7";
              resumeSection.style.cursor = "default";

              const heading = resumeSection.querySelector("h3");
              const description = resumeSection.querySelector("p");

              if (heading) heading.textContent = "✓ Resume Already Loaded";
              if (description) description.textContent = `${candidateSkills.length} skills detected • Ready to match with jobs`;

              console.log("✓ Resume section updated to show loaded state");

              if (statusEl) {
                statusEl.innerHTML = `
                  <div class="resume-status ready">
                    <strong>✓ Resume Connected</strong><br>
                    Using your saved resume with <strong>${candidateSkills.length} skills</strong> detected
                  </div>
                `;
                console.log("✓ Resume status updated");
              }
            }

            // Update profile strength and re-render with match scores
            updateProfileStrength();
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

      // Setup onboarding tips close
      const onboardingTips = document.getElementById("onboardingTips");
      const closeTipsBtn = document.getElementById("closeTipsBtn");
      if (localStorage.getItem("trazerr.hideTips")) {
        if (onboardingTips) onboardingTips.style.display = "none";
      }
      if (closeTipsBtn) {
        closeTipsBtn.addEventListener("click", () => {
          if (onboardingTips) onboardingTips.style.display = "none";
          localStorage.setItem("trazerr.hideTips", "true");
          Toast.info("Tips hidden - click the tips button if you want to see them again");
        });
      }

      // Setup filter controls
      const filterContainer = document.getElementById("filtersContainer");
      const matchFilter = document.getElementById("matchFilter");
      const experienceFilter = document.getElementById("experienceFilter");
      const locationFilter = document.getElementById("locationFilter");
      const clearFiltersBtn = document.getElementById("clearFiltersBtn");

      if (allJobs.length > 0 && filterContainer) {
        filterContainer.style.display = "block";
      }

      if (matchFilter) {
        matchFilter.addEventListener("change", performSearch);
      }
      if (experienceFilter) {
        experienceFilter.addEventListener("change", performSearch);
      }
      if (locationFilter) {
        locationFilter.addEventListener("change", performSearch);
      }
      if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener("click", () => {
          if (matchFilter) matchFilter.value = "";
          if (experienceFilter) experienceFilter.value = "";
          if (locationFilter) locationFilter.value = "";
          performSearch();
          Toast.info("Filters cleared", "");
        });
      }

      console.log("✅ Job search initialized successfully");
    } catch (e) {
      console.error("❌ Failed to initialize:", e);
      Toast.error(e.message || "Unknown error", "Failed to initialize");
      const resultsEl = document.getElementById("results");
      if (resultsEl) {
        resultsEl.innerHTML = `<div class="empty-state"><p style="color:red;"><strong>Error:</strong> ${esc(e.message)}</p><p><a href="javascript:location.reload()">Reload page to try again</a></p></div>`;
      }
    }
  }

  function showJobSkeletons() {
    const container = document.getElementById("results");
    if (!container) return;

    let html = '';
    for (let i = 0; i < 5; i++) {
      html += `
        <div class="skeleton-job">
          <div class="skeleton-job-match"></div>
          <div class="skeleton-job-title"></div>
          <div class="skeleton-job-meta"></div>
          <div class="skeleton-job-desc"></div>
          <div class="skeleton-job-desc" style="width: 90%;"></div>
          <div class="skeleton-job-skills">
            <div class="skeleton-job-skill"></div>
            <div class="skeleton-job-skill"></div>
            <div class="skeleton-job-skill"></div>
          </div>
        </div>
      `;
    }
    container.innerHTML = html;
  }

  async function loadAllJobs() {
    try {
      if (!sb) throw new Error("Supabase not initialized");

      showJobSkeletons();

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
      Toast.error(e.message || "Failed to load jobs", "Error loading jobs");
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
    Toast.info("Reading your resume...", "Processing");

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

      if (candidateSkills.length > 0) {
        statusEl.innerHTML = `
          <div class="resume-status ready">
            ✓ Resume loaded with <strong>${candidateSkills.length} skills</strong> detected
          </div>
        `;
        Toast.success(`Detected ${candidateSkills.length} skills from your resume`, "Resume loaded");
      } else {
        statusEl.innerHTML = `
          <div class="resume-status ready">
            ✓ Resume loaded (tip: include known skills to see match scores)
          </div>
        `;
        Toast.info("Include known skills in your resume to see match scores", "Resume loaded");
      }

      updateProfileStrength();
      renderResults(allJobs);
    } catch (err) {
      statusEl.innerHTML = '<div style="color: #ef4444;">✗ Error reading file. Make sure it\'s a text or PDF file.</div>';
      Toast.error("Make sure it's a text or PDF file", "Error reading file");
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

  function calculateProfileStrength() {
    if (!candidateResume) return 0;

    let strength = 0;
    const resumeLength = candidateResume.length;

    // Length check (up to 30%)
    if (resumeLength >= 500) strength += 10;
    if (resumeLength >= 1000) strength += 10;
    if (resumeLength >= 2000) strength += 10;

    // Skills check (up to 30%)
    const skillsCount = candidateSkills.length;
    if (skillsCount >= 3) strength += 10;
    if (skillsCount >= 6) strength += 10;
    if (skillsCount >= 10) strength += 10;

    // Resume text quality (up to 40%)
    const hasExperience = /experience|worked|role|position|project/i.test(candidateResume);
    const hasEducation = /education|degree|university|college|certificate/i.test(candidateResume);
    const hasSkills = candidateSkills.length > 0;
    const hasContact = /email|phone|linkedin|github/i.test(candidateResume);

    if (hasExperience) strength += 10;
    if (hasEducation) strength += 10;
    if (hasSkills) strength += 10;
    if (hasContact) strength += 10;

    return Math.min(100, strength);
  }

  function updateProfileStrength() {
    const container = document.getElementById("profileStrengthContainer");
    const score = calculateProfileStrength();

    if (container) {
      if (score > 0) {
        container.style.display = "block";
        document.getElementById("profileStrengthScore").textContent = score + "%";
        document.getElementById("profileStrengthBar").style.width = score + "%";

        let text = "";
        if (score < 30) text = "Add more details to your resume";
        else if (score < 60) text = "Good start! Add more experience and skills";
        else if (score < 90) text = "Strong resume! Keep adding relevant skills";
        else text = "Excellent profile! Ready for job matching";

        document.getElementById("profileStrengthText").textContent = text;
      } else {
        container.style.display = "none";
      }
    }
  }

  function applyFilters(jobs) {
    const matchFilter = document.getElementById("matchFilter")?.value;
    const experienceFilter = document.getElementById("experienceFilter")?.value;
    const locationFilter = document.getElementById("locationFilter")?.value;

    return jobs.filter(job => {
      if (matchFilter !== "" && matchFilter !== undefined) {
        const matchScore = calculateMatch(job);
        if (matchScore === null) return false;
        const threshold = parseInt(matchFilter);
        if (matchScore < threshold) return false;
      }

      if (experienceFilter && job.experience_level?.toLowerCase() !== experienceFilter) {
        return false;
      }

      if (locationFilter === "remote" && !job.remote_ok) {
        return false;
      }

      if (locationFilter === "onsite" && job.remote_ok) {
        return false;
      }

      return true;
    });
  }

  function performSearch() {
    const searchInput = document.getElementById("searchInput");
    const query = searchInput ? searchInput.value.trim().toUpperCase() : "";
    console.log("🔍 Performing search with query:", query || "(all jobs)");

    let filtered = allJobs;

    if (query) {
      filtered = allJobs.filter(job =>
        job.company_code?.includes(query) ||
        job.title?.toUpperCase().includes(query) ||
        job.description?.toUpperCase().includes(query)
      );
    }

    filtered = applyFilters(filtered);
    console.log("📊 Filtered to", filtered.length, "jobs");
    renderResults(filtered);
  }

  function updateJobStats(jobs) {
    const statsContainer = document.getElementById("jobStats");
    if (!statsContainer) return;

    if (jobs.length === 0) {
      statsContainer.style.display = "none";
      return;
    }

    statsContainer.style.display = "grid";

    const jobsCount = jobs.length;
    const bookmarkedCount = jobs.filter(j => bookmarkedJobs.includes(j.id)).length;
    const matchedJobs = jobs.filter(j => {
      const score = calculateMatch(j);
      return score !== null && score >= 75;
    });
    const matchedCount = matchedJobs.length;

    const matchScores = jobs.map(j => calculateMatch(j)).filter(s => s !== null);
    const avgMatch = matchScores.length > 0 ? Math.round(matchScores.reduce((a, b) => a + b, 0) / matchScores.length) : 0;

    document.getElementById("statsJobsCount").textContent = jobsCount;
    document.getElementById("statsMatchedCount").textContent = matchedCount;
    document.getElementById("statsBookmarkedCount").textContent = bookmarkedCount;
    document.getElementById("statsAvgMatch").textContent = avgMatch + "%";
  }

  function renderResults(jobs) {
    const container = document.getElementById("results");
    if (!container) return;

    if (!jobs || jobs.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No jobs found matching your search.</p><p><a href="javascript:void(0);" onclick="if(window.performSearch) window.performSearch();">View all jobs</a></p></div>';
      updateJobStats([]);
      return;
    }

    updateJobStats(jobs);

    container.innerHTML = jobs.map(job => {
      const matchScore = calculateMatch(job);
      const matchClass = matchScore >= 75 ? 'high' : matchScore >= 50 ? 'medium' : 'low';
      const isBookmarked = bookmarkedJobs.includes(job.id);

      return `
        <div class="job-item" data-job-id="${esc(job.id)}" style="position: relative; cursor: pointer;" onclick="if(window.selectJob) window.selectJob('${esc(job.id)}'); return false;">
          ${isBookmarked ? '<div style="position: absolute; top: 12px; right: 12px; color: #ef4444; font-size: 20px;">♥</div>' : ''}
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

    // Attach click event listeners to job items as fallback
    setTimeout(() => {
      const jobItems = container.querySelectorAll(".job-item");
      jobItems.forEach(item => {
        if (!item.hasAttribute("data-listener-attached")) {
          item.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const jobId = item.getAttribute("data-job-id");
            console.log("🖱️ Job item clicked:", jobId);
            if (window.selectJob) {
              window.selectJob(jobId);
            }
          });
          // Also add touchend for mobile
          item.addEventListener("touchend", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const jobId = item.getAttribute("data-job-id");
            console.log("👆 Job item touched:", jobId);
            if (window.selectJob) {
              window.selectJob(jobId);
            }
          });
          item.setAttribute("data-listener-attached", "true");
          console.log("✓ Job item listener attached:", jobId);
        }
      });
    }, 100);
  }

  function toggleBookmark() {
    if (!selectedJob) return;

    const index = bookmarkedJobs.indexOf(selectedJob.id);
    if (index > -1) {
      bookmarkedJobs.splice(index, 1);
      Toast.info("Removed from bookmarks");
    } else {
      bookmarkedJobs.push(selectedJob.id);
      Toast.success("Added to bookmarks");
    }

    localStorage.setItem("trazerr.bookmarks", JSON.stringify(bookmarkedJobs));
    updateBookmarkButton();
  }

  function updateBookmarkButton() {
    const btn = document.getElementById("bookmarkBtn");
    if (!btn || !selectedJob) return;

    if (bookmarkedJobs.includes(selectedJob.id)) {
      btn.innerHTML = "♥ Bookmarked";
      btn.style.borderColor = "#ef4444";
      btn.style.color = "#ef4444";
    } else {
      btn.innerHTML = "♡ Bookmark";
      btn.style.borderColor = "var(--border)";
      btn.style.color = "var(--ink-2)";
    }
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
      updateBookmarkButton();
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
      Toast.error("Please sign in to apply for jobs");
      setTimeout(() => window.location.href = "/", 1500);
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
        Toast.error("Please build your Career DNA first before applying");
        setTimeout(() => window.location.href = "/", 1500);
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
        Toast.warning("You've already applied for this job");
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

      Toast.success("Application submitted!", "Your application has been received and the employer will be notified of your match score");
      closeJobModal();
      await loadAllJobs();
    } catch (e) {
      console.error("Failed to apply:", e);
      Toast.error(e.message || "Unknown error", "Failed to submit application");
    }
  }

  // Export global API
  // Export all functions to global scope for direct access
  window.selectJob = selectJob;
  window.closeJobModal = closeJobModal;
  window.applyForJob = applyForJob;
  window.performSearch = performSearch;
  window.toggleBookmark = toggleBookmark;
  window.loadAllJobs = loadAllJobs;

  window.jobSearch = {
    selectJob,
    closeJobModal: closeJobModal,
    applyForJob,
    performSearch,
    loadAllJobs
  };

  console.log("✅ Job Search functions exported to window:", Object.keys(window).filter(k => k.match(/selectJob|performSearch|closeJobModal|applyForJob|toggleBookmark|loadAllJobs/)));

  // Attach event listeners even if initialization fails
  function setupEventListeners() {
    const resumeFile = document.getElementById("resumeFile");
    const searchBtn = document.getElementById("searchBtn");
    const searchInput = document.getElementById("searchInput");
    const modalCloseBtn = document.querySelector(".modal-close");
    const applyBtn = document.getElementById("applyBtn");
    const bookmarkBtn = document.getElementById("bookmarkBtn");

    if (resumeFile && !resumeFile.hasAttribute("data-listener-attached")) {
      resumeFile.addEventListener("change", handleResumeUpload);
      resumeFile.setAttribute("data-listener-attached", "true");
      console.log("✓ Resume upload handler attached");
    }

    if (searchBtn && !searchBtn.hasAttribute("data-listener-attached")) {
      searchBtn.addEventListener("click", (e) => {
        e.preventDefault();
        performSearch();
      });
      searchBtn.setAttribute("data-listener-attached", "true");
      console.log("✓ Search button handler attached");
    }

    if (searchInput && !searchInput.hasAttribute("data-listener-attached")) {
      searchInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          performSearch();
        }
      });
      searchInput.setAttribute("data-listener-attached", "true");
      console.log("✓ Search input handler attached");
    }

    if (modalCloseBtn && !modalCloseBtn.hasAttribute("data-listener-attached")) {
      modalCloseBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("🔘 Modal close button clicked");
        closeJobModal();
      });
      // Also add touchend for better mobile support
      modalCloseBtn.addEventListener("touchend", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("🔘 Modal close button touched");
        closeJobModal();
      });
      modalCloseBtn.setAttribute("data-listener-attached", "true");
      console.log("✓ Modal close button handler attached");
    }

    if (applyBtn && !applyBtn.hasAttribute("data-listener-attached")) {
      applyBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("🔘 Apply button clicked");
        applyForJob();
      });
      // Also add touchend for better mobile support
      applyBtn.addEventListener("touchend", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("🔘 Apply button touched");
        applyForJob();
      });
      applyBtn.setAttribute("data-listener-attached", "true");
      console.log("✓ Apply button handler attached");
    }

    if (bookmarkBtn && !bookmarkBtn.hasAttribute("data-listener-attached")) {
      bookmarkBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("🔘 Bookmark button clicked");
        toggleBookmark();
      });
      // Also add touchend for better mobile support
      bookmarkBtn.addEventListener("touchend", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("🔘 Bookmark button touched");
        toggleBookmark();
      });
      bookmarkBtn.setAttribute("data-listener-attached", "true");
      console.log("✓ Bookmark button handler attached");
    }

    // Keyboard navigation for modal
    document.addEventListener("keydown", (e) => {
      const modal = document.getElementById("jobModal");
      if (modal && modal.classList.contains("active") && e.key === "Escape") {
        closeJobModal();
      }
    });

    console.log("✅ All event listeners attached");
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
