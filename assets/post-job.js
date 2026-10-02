const API = "/api/app";
const SB_LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js";
const SB_LIB_SRI = "sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok";

let sb = null;
let currentEmployer = null;
let selectedFile = null;

function showError(msg) {
  const el = document.getElementById("errorMsg");
  el.innerHTML = "⚠️ " + msg;
  el.style.display = "block";
  document.getElementById("successMsg").style.display = "none";
}

function showSuccess(msg) {
  const el = document.getElementById("successMsg");
  el.innerHTML = "✓ " + msg;
  el.style.display = "block";
  document.getElementById("errorMsg").style.display = "none";
}

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

function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const validTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'text/plain'];
  if (!validTypes.includes(file.type)) {
    showError("Please upload a PDF, Word, or text file");
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    showError("File must be less than 10MB");
    return;
  }

  selectedFile = file;
  updateFileList();
  document.getElementById("errorMsg").style.display = "none";
}

function updateFileList() {
  const list = document.getElementById("fileList");
  if (!selectedFile) {
    list.innerHTML = "";
    return;
  }

  list.innerHTML = `
    <div class="file-tag">
      📄 ${escapeHtml(selectedFile.name)}
      <button type="button" onclick="selectedFile=null; updateFileList();">×</button>
    </div>
  `;
}

function clearForm() {
  document.getElementById("jobDesc").value = "";
  document.getElementById("jobTitle").value = "";
  document.getElementById("location").value = "";
  document.getElementById("remoteOk").checked = false;
  selectedFile = null;
  updateFileList();
  document.getElementById("skillsDisplay").innerHTML = "";
  document.getElementById("errorMsg").style.display = "none";
  document.getElementById("successMsg").style.display = "none";
}

async function initAuth() {
  try {
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
    if (!session) {
      showError("You need to sign in first. Redirecting...");
      setTimeout(() => window.location.href = "/employers.html", 2000);
      return false;
    }

    // Load employer profile
    const { data: employer, error } = await sb
      .from("employers")
      .select("*")
      .eq("user_id", session.user.id)
      .single();

    if (error || !employer) {
      showError("Could not load your employer profile. Please go to employers page first.");
      setTimeout(() => window.location.href = "/employers.html", 2000);
      return false;
    }

    if (employer.status !== "approved") {
      showError("Your employer profile is not yet approved. Please wait for admin approval.");
      return false;
    }

    currentEmployer = employer;
    return true;
  } catch (e) {
    showError("Auth error: " + (e.message || e));
    return false;
  }
}

async function extractAndPost() {
  const desc = document.getElementById("jobDesc").value.trim();
  const title = document.getElementById("jobTitle").value.trim();
  const location = document.getElementById("location").value.trim();
  const remoteOk = document.getElementById("remoteOk").checked;
  const btn = document.getElementById("extractBtn");
  const btnText = document.getElementById("btnText");

  if (!desc) {
    showError("Please paste a job description");
    return;
  }

  if (!title) {
    showError("Please enter a job title");
    return;
  }

  btn.disabled = true;
  btnText.innerHTML = '<span class="loading-spinner"></span> Analyzing with AI...';

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      showError("Session expired. Redirecting...");
      setTimeout(() => window.location.href = "/employers.html", 2000);
      return;
    }

    const token = session.access_token;
    const companyCode = generateCompanyCode(currentEmployer.company);

    // Call API to extract Job DNA and post job
    const r = await fetch(API + "?action=jobpost", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        company_code: companyCode,
        title,
        description: desc,
        location,
        remote_ok: remoteOk,
        required_skills: [],
        nice_to_have: [],
        document_name: selectedFile ? selectedFile.name : null
      })
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || "Failed to post job");
    }

    const job = await r.json();

    // Show extracted skills
    const skills = job.job_dna || {};
    let html = `<div class="skills-display">
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 20px;">
        <div>
          <h3 style="margin: 0 0 8px; font-size: 18px;">🎯 AI-Extracted Skills</h3>
          <p style="color: var(--ink-2); font-size: 13px; margin: 0;">Here's what we found in your job description:</p>
        </div>
        <div class="company-badge">${escapeHtml(companyCode)}</div>
      </div>`;

    if (skills.required_skills && skills.required_skills.length) {
      html += `<div class="skills-section">
        <div class="skills-title">✓ Required Skills</div>`;
      skills.required_skills.forEach(s => {
        html += `<span class="skill-tag">${escapeHtml(s)}</span>`;
      });
      html += `</div>`;
    }

    if (skills.nice_to_have && skills.nice_to_have.length) {
      html += `<div class="skills-section">
        <div class="skills-title">★ Nice to Have</div>`;
      skills.nice_to_have.forEach(s => {
        html += `<span class="skill-tag">${escapeHtml(s)}</span>`;
      });
      html += `</div>`;
    }

    if (skills.experience_level) {
      html += `<div class="skills-section">
        <div class="skills-title">📊 Experience Level</div>
        <span class="skill-tag">${escapeHtml(skills.experience_level)}</span>
      </div>`;
    }

    html += `<div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border);">
      <p style="margin: 0; color: var(--ink-2); font-size: 13px;">
        <strong>Job posted successfully!</strong><br>
        Candidates can search for jobs using the company code <strong>${escapeHtml(companyCode)}</strong>
      </p>
    </div></div>`;

    document.getElementById("skillsDisplay").innerHTML = html;
    showSuccess("✨ Perfect! Your job has been posted. Candidates can now search and apply.");

    // Clear form after 1.5 seconds
    setTimeout(() => {
      clearForm();
    }, 1500);

  } catch (e) {
    showError(e.message || e);
  } finally {
    btn.disabled = false;
    btnText.innerHTML = "✨ Extract Skills & Post Job";
  }
}

function generateCompanyCode(companyName) {
  const words = companyName.trim().split(/\s+/);
  let code = words.map(w => w[0].toUpperCase()).join("");
  if (code.length > 3) code = code.slice(0, 3);

  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return code + month + day;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// Drag and drop support
document.addEventListener("DOMContentLoaded", async () => {
  const uploadArea = document.querySelector(".upload-area");
  if (uploadArea) {
    uploadArea.addEventListener("dragover", (e) => {
      e.preventDefault();
      uploadArea.style.borderColor = "var(--blue)";
      uploadArea.style.background = "rgba(0, 102, 224, 0.08)";
    });

    uploadArea.addEventListener("dragleave", () => {
      uploadArea.style.borderColor = "var(--border)";
      uploadArea.style.background = "rgba(0, 102, 224, 0.02)";
    });

    uploadArea.addEventListener("drop", (e) => {
      e.preventDefault();
      uploadArea.style.borderColor = "var(--border)";
      uploadArea.style.background = "rgba(0, 102, 224, 0.02)";

      const files = e.dataTransfer.files;
      if (files.length) {
        document.getElementById("fileInput").files = files;
        handleFileSelect({ target: { files } });
      }
    });
  }

  try {
    const ok = await initAuth();

    // Hide loading, show form
    const loading = document.getElementById("loadingMsg");
    const header = document.getElementById("header");
    const form = document.getElementById("formContainer");

    if (loading) loading.style.display = "none";
    if (header) header.style.display = "block";
    if (form) form.style.display = "block";

    if (!ok) {
      document.getElementById("extractBtn").disabled = true;
    }
  } catch (e) {
    console.error("Init error:", e);
    document.getElementById("errorMsg").style.display = "block";
    document.getElementById("errorMsg").innerHTML = "⚠️ Error: " + (e.message || e);
    document.getElementById("loadingMsg").style.display = "none";
    document.getElementById("header").style.display = "block";
    document.getElementById("formContainer").style.display = "block";
  }
});
