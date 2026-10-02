const API = "/api/app";
const SB_LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js";
const SB_LIB_SRI = "sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok";

let sb = null;
let currentEmployer = null;

function showError(msg) {
  const el = document.getElementById("errorMsg");
  el.textContent = msg;
  el.style.display = "block";
  document.getElementById("successMsg").style.display = "none";
}

function showSuccess(msg) {
  const el = document.getElementById("successMsg");
  el.textContent = msg;
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
      showError("Your employer profile is not yet approved.");
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

  if (!desc) {
    showError("Please paste a job description");
    return;
  }

  if (!title) {
    showError("Please enter a job title");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Analyzing with AI...";

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
        nice_to_have: []
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
      <h3 style="margin-top: 0;">AI Extracted Skills</h3>
      <p style="color: var(--ink-2); font-size: 13px; margin: 0 0 12px;">Here are the skills identified in your job description:</p>`;

    if (skills.required_skills && skills.required_skills.length) {
      html += `<div><strong>Required:</strong><br>`;
      skills.required_skills.forEach(s => {
        html += `<span class="skill-tag">${escapeHtml(s)}</span>`;
      });
      html += `</div>`;
    }

    if (skills.nice_to_have && skills.nice_to_have.length) {
      html += `<div style="margin-top: 12px;"><strong>Nice to Have:</strong><br>`;
      skills.nice_to_have.forEach(s => {
        html += `<span class="skill-tag">${escapeHtml(s)}</span>`;
      });
      html += `</div>`;
    }

    html += `<p style="margin-top: 12px; color: var(--ink-2); font-size: 13px;">
      ✓ Job posted successfully!<br>
      Company code: <strong>${escapeHtml(companyCode)}</strong><br>
      Candidates can now search and apply using this code.
    </p></div>`;

    document.getElementById("skillsDisplay").innerHTML = html;
    showSuccess("✓ Job posted successfully! Candidates can now search and apply.");

    // Clear form
    setTimeout(() => {
      document.getElementById("jobDesc").value = "";
      document.getElementById("jobTitle").value = "";
      document.getElementById("location").value = "";
      document.getElementById("remoteOk").checked = false;
    }, 1000);

  } catch (e) {
    showError("Error: " + (e.message || e));
  } finally {
    btn.disabled = false;
    btn.textContent = "Extract Skills & Post Job";
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

// Initialize on page load
document.addEventListener("DOMContentLoaded", async () => {
  const ok = await initAuth();
  if (!ok) {
    document.getElementById("extractBtn").disabled = true;
  }
});
