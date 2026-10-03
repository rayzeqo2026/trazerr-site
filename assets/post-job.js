const API = "/api/app";

let selectedFile = null;

function showError(msg) {
  const el = document.getElementById("errorMsg");
  el.innerHTML = "⚠️ " + msg;
  el.style.display = "block";
  document.getElementById("successMsg").style.display = "none";
  Toast.error(msg, "Error");
}

function showSuccess(msg) {
  const el = document.getElementById("successMsg");
  el.innerHTML = "✓ " + msg;
  el.style.display = "block";
  document.getElementById("errorMsg").style.display = "none";
  Toast.success(msg, "Success");
}


async function handleFileSelect(event) {
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

  // Extract text from PDF and auto-fill job description
  if (file.type === 'application/pdf') {
    try {
      const text = await extractPdfText(file);
      if (text) {
        document.getElementById("jobDesc").value = text;

        // Try to extract location from the PDF text
        const location = extractLocation(text);
        if (location) {
          document.getElementById("location").value = location;
        }

        showSuccess("✓ PDF uploaded! Job description auto-filled from document.");
      }
    } catch (e) {
      console.error("Error extracting PDF text:", e);
      showError("Could not extract text from PDF. Please paste the job description manually.");
    }
  }
}

async function extractPdfText(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(" ");
      fullText += pageText + "\n";
    }

    return fullText;
  } catch (e) {
    console.error("PDF extraction error:", e);
    return null;
  }
}

function extractLocation(text) {
  // Try to find common location patterns
  const locationPatterns = [
    /Location:\s*([^,\n]+(?:,\s*[A-Z]{2})?)/i,
    /(?:Based in|Located in|Location):\s*([^,\n]+)/i,
    /([A-Z][a-z]+(?:,\s*[A-Z]{2})?)\s*(?:USA|US|United States)/i,
  ];

  for (const pattern of locationPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
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
    // For Redis-based job posting, we don't need complex auth
    // Just verify the form is ready to use
    return true;
  } catch (e) {
    showError("Error: " + (e.message || e));
    return false;
  }
}

async function extractAndPost() {
  try {
    console.log("extractAndPost called");
    const desc = document.getElementById("jobDesc").value.trim();
    const title = document.getElementById("jobTitle").value.trim();
    const location = document.getElementById("location").value.trim();
    const company = "Your Company";
    const btn = document.getElementById("extractBtn");
    const btnText = document.getElementById("btnText");

    console.log("Form values:", { desc: desc.length, title, location });

    if (!title) {
      showError("Please enter a job title");
      return;
    }

    if (!btn) {
      alert("Error: Button element not found");
      return;
    }

    btn.disabled = true;
    btnText.innerHTML = '<span class="loading-spinner"></span> Posting job...';
    console.log("Button disabled, starting API call...");

    // Call API to post job to Redis
    console.log("Calling postjob API...");
    const r = await fetch(API + "?action=postjob", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title,
        company,
        description: desc,
        location: location || "Remote"
      })
    });

    console.log("API response status:", r.status);
    const result = await r.json();
    console.log("API response body:", JSON.stringify(result));

    if (!r.ok) {
      const errorMsg = result.error || result.message || "Failed to post job";
      console.error("API error response:", errorMsg);
      showError("Error: " + errorMsg);
      throw new Error(errorMsg);
    }

    const job = result.job || {};
    let html = `<div class="skills-display">
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 20px;">
        <div>
          <h3 style="margin: 0 0 8px; font-size: 18px;">✅ Job Posted Successfully!</h3>
          <p style="color: var(--ink-2); font-size: 13px; margin: 0;">Your job is now searchable by candidates</p>
        </div>
      </div>`;

    html += `<div class="skills-section">
      <div class="skills-title">Job Details</div>
      <div style="margin-top: 12px; padding: 12px; background: #f5f7fa; border-radius: 6px;">
        <p style="margin: 4px 0;"><strong>Title:</strong> ${escapeHtml(job.title || title)}</p>
        <p style="margin: 4px 0;"><strong>Location:</strong> ${escapeHtml(job.location || location || 'Remote')}</p>
        <p style="margin: 4px 0;"><strong>Posted:</strong> ${job.postedAt ? new Date(job.postedAt).toLocaleDateString() : 'Just now'}</p>
        <p style="margin: 4px 0; font-size: 12px; color: #666;"><strong>Expires:</strong> ${job.expiresAt ? new Date(job.expiresAt).toLocaleDateString() : 'In 30 days'}</p>
      </div>
    </div>`;

    html += `<div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border);">
      <p style="margin: 0; color: var(--ink-2); font-size: 13px;">
        <strong>Candidates can find this job by searching:</strong><br>
        • Job title: "${escapeHtml(title)}"<br>
        • Company/keywords in the description
      </p>
    </div></div>`;

    document.getElementById("skillsDisplay").innerHTML = html;
    showSuccess("✨ Your job has been posted! Candidates can now search and find it.");

    // Clear form after 2 seconds
    setTimeout(() => {
      clearForm();
    }, 2000);

  } catch (e) {
    console.error("Error in extractAndPost:", e);
    showError(e.message || String(e));
  } finally {
    const btn = document.getElementById("extractBtn");
    const btnText = document.getElementById("btnText");
    if (btn) {
      btn.disabled = false;
      btnText.innerHTML = "✨ Extract Skills & Post Job";
    }
  }
}

function generateCompanyCode(companyName) {
  const words = (companyName || "XX").trim().split(/\s+/);
  let code = words.map(w => w[0].toUpperCase()).join("");

  // Ensure code is exactly 2 characters (pad or truncate)
  if (code.length > 2) code = code.slice(0, 2);
  while (code.length < 2) code += "X";

  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return code + month + day;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// Initialize all button and upload handlers
document.addEventListener("DOMContentLoaded", async () => {
  // Extract button click handler
  const extractBtn = document.getElementById("extractBtn");
  if (extractBtn) {
    extractBtn.addEventListener("click", (e) => {
      e.preventDefault();
      console.log("Extract button clicked");
      extractAndPost();
    });
  }

  // Clear button click handler
  const clearBtn = document.getElementById("clearBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", (e) => {
      e.preventDefault();
      clearForm();
    });
  }

  // File input change handler
  const fileInput = document.getElementById("fileInput");
  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      console.log("File input changed");
      handleFileSelect(e);
    });
  }

  // Upload area click and drag handlers
  const uploadArea = document.getElementById("uploadArea");
  if (uploadArea) {
    uploadArea.style.cursor = "pointer";
    uploadArea.addEventListener("click", () => {
      console.log("Upload area clicked");
      const fileInput = document.getElementById("fileInput");
      if (fileInput) {
        fileInput.click();
      }
    });

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
