import { test, expect } from "@playwright/test";
import { mockSite } from "./helpers.js";

// A made-up tailored resume, as the server returns it.
const RESUME = {
  name: "Alex Doe", contact: "alex@example.com", headline: "Lab research · Sales", summary: "Scientist with sales experience.",
  skills: ["IHC", "SAS"], experience: [{ title: "Research Assistant", company: "University", location: "", dates: "2025 – 2026", bullets: [{ text: "Ran experiments.", from: "" }] }],
  education: ["M.S. Pharmacology, 2026"],
  extras: [
    { heading: "Leadership", entries: [{ title: "Team Captain, Basketball", dates: "2020 – 2024", bullets: ["Named team MVP.", "Built teamwork and time management skills."] }], items: [] },
    { heading: "Coursework", entries: [], items: ["Biochemistry, Biostatistics, Cellular and Molecular Biology, Chemistry, Ecology, Oceanography, Plant Biology, Toxicology"] },
    { heading: "Languages", entries: [], items: ["French (conversational)", "Spanish (basic)"] }
  ],
  blanks: [], changes: [], fitBefore: 50, fitAfter: 60
};

test("extra sections show as entries and lists in the preview, copied text and Word file", async ({ page }) => {
  await mockSite(page);
  await page.goto("/", { waitUntil: "networkidle" });
  const out = await page.evaluate(async (r) => {
    const box = document.createElement("div"); box.className = "paper"; box.innerHTML = resumeBody(r, "html"); document.body.append(box);
    const docx = await resumeDocx(r).arrayBuffer();
    return {
      entryTitle: box.querySelector(".rjob-h b:not(:first-child), .rjob:last-of-type b") && [...box.querySelectorAll(".rjob-h b")].map(b => b.textContent),
      lists: [...box.querySelectorAll("ul")].map(u => u.children.length),
      shortLine: [...box.querySelectorAll("p")].map(p => p.textContent).find(t => t.includes("French")),
      text: resumeText(r),
      word: new TextDecoder().decode(docx)
    };
  }, RESUME);
  expect(out.entryTitle).toEqual(["Research Assistant, University", "Team Captain, Basketball"]);
  expect(out.lists).toEqual([1, 2, 1]); // job bullets, leadership bullets, the long coursework item as a bullet
  expect(out.shortLine).toBe("French (conversational) · Spanish (basic)");
  expect(out.text).toContain("Team Captain, Basketball | 2020 – 2024\n• Named team MVP.");
  expect(out.text).toContain("• Biochemistry, Biostatistics");
  expect(out.word).toContain("Team Captain, Basketball");
  expect(out.word).toContain("Toxicology");
});

test("resumes saved before this change (items only) still show", async ({ page }) => {
  await mockSite(page);
  await page.goto("/", { waitUntil: "networkidle" });
  const html = await page.evaluate(() => resumeBody({ name: "A", contact: "", headline: "", summary: "", skills: [], experience: [], education: [], extras: [{ heading: "Awards", items: ["Dean's List", "MVP"] }] }, "html"));
  expect(html).toContain("Dean&#39;s List · MVP");
});
