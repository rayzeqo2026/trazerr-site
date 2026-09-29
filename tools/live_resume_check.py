# Live resume check: runs resumes through the live site (Career DNA, then Tailor my DNA for a
# chosen role) and flags any employer, date or number in the tailored resume that isn't in the original.
# Usage: python3 tools/live_resume_check.py <folder-with-resume-pdfs> <report.json>
# Needs network access to www.trazerr.com and `pip install pymupdf`. Resumes are not stored in the repo.
import base64, json, re, sys, time, urllib.request, pymupdf
BASE = "https://www.trazerr.com/api/app?action="
U = sys.argv[1]; OUT = sys.argv[2]
# (label, file-name ending, role to tailor for). Files are matched by how their names end,
# so uploads with a random prefix still work.
CASES = [
  ("Michael Lee", "ResumeMichaelLee.pdf", "Pharmaceutical sales representative"),
  ("Victor Bernardo", "ResumeVictorBernardo_1.pdf", "Ophthalmic technician"),
  ("Julia Blanck", "ResumeJuliaBlanck.pdf", "Clinical research coordinator"),
  ("Nasir Wimberly", "ResumeNasirWimberly.pdf", "Pharmaceutical sales representative"),
  ("Clyde McAllister", "ResumeClydeMcAllister.pdf", "Account executive"),
  ("Eric Jiang", "Resume-Eric-Jiang-9-26.pdf", "Construction project manager"),
  ("Hima Jagadish", "ResumeHimaJagadish.pdf", "Laboratory technician"),
]
import os
def find(folder, ending):
    hits = [f for f in os.listdir(folder) if f.endswith(ending)]
    return hits[0] if hits else None
def post(action, body):
    req = urllib.request.Request(BASE + action, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=90) as r: return r.status, json.load(r), time.time() - t
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}"), time.time() - t
def norm(s): return re.sub(r"[^a-z0-9]", "", s.lower())
report = []
for name, ending, role in CASES:
    f = find(U, ending)
    if not f: print(name, "| skipped: no file ending in", ending); continue
    pdf = open(f"{U}/{f}", "rb").read(); text = "".join(p.get_text() for p in pymupdf.open(f"{U}/{f}"))
    resume = {"kind": "pdf", "data": base64.b64encode(pdf).decode()}
    row = {"name": name, "role": role}
    c, d, t = post("analyze", resume); row["dna"] = {"status": c, "seconds": round(t, 1), "error": d.get("error"), "profile": d.get("profile")}
    c, d, t = post("tailor", {"stage": "skills", "role": role, "posting": "", "resume": resume}); row["skills"] = {"status": c, "seconds": round(t, 1), "error": d.get("error"), "data": d.get("skills")}
    confirmed = [k["name"] for k in (d.get("skills") or {}).get("skills", []) if k["status"] == "verified"]
    c, d, t = post("tailor", {"stage": "build", "role": role, "posting": "", "resume": resume, "confirmed": confirmed}); row["build"] = {"status": c, "seconds": round(t, 1), "error": d.get("error"), "resume": d.get("resume")}
    issues = []
    r = d.get("resume") or {}
    if len(text.strip()) < 200:  # scanned image: no text to compare against, review by hand
        row["accuracy_issues"] = ["scanned PDF: automatic check skipped, review by hand"]
        report.append(row); print(name, "| DNA", row["dna"]["status"], row["dna"]["seconds"], "s | skills", row["skills"]["status"], "| build", row["build"]["status"], row["build"]["seconds"], "s | scanned: manual review"); sys.stdout.flush()
        time.sleep(2); continue
    src = norm(text)
    for j in r.get("experience", []):
        for field in ("title", "company", "dates"):
            v = j.get(field, "")
            if v and norm(v) not in src: issues.append(f"{field} not in original: {v!r}")
        for b in j.get("bullets", []):
            plain = re.sub(r"\[[^\]]*\]", "", b["text"])
            for num in re.findall(r"\d[\d,.%+]*", plain):
                if norm(num) not in src: issues.append(f"number not in original: {num!r} in {b['text'][:80]!r}")
    row["accuracy_issues"] = issues
    report.append(row); print(name, "| DNA", row["dna"]["status"], row["dna"]["seconds"], "s | skills", row["skills"]["status"], "| build", row["build"]["status"], row["build"]["seconds"], "s | issues", len(issues)); sys.stdout.flush()
    time.sleep(2)
json.dump(report, open(OUT, "w"), indent=1)
