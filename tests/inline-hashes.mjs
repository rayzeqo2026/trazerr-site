// Prints the fingerprint of every inline <script> in the site's pages. The security header in
// vercel.json (Content-Security-Policy) must list each one, or the browser won't run that script.
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const ROOT = new URL("..", import.meta.url);
export function inlineHashes() {
  const out = [];
  for (const f of readdirSync(ROOT).filter(f => f.endsWith(".html"))) {
    const html = readFileSync(new URL(f, ROOT), "utf8");
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      out.push({ file: f, hash: "'sha256-" + createHash("sha256").update(m[1], "utf8").digest("base64") + "'" });
    }
  }
  return out;
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  for (const { file, hash } of inlineHashes()) console.log(hash, " ", file);
}
