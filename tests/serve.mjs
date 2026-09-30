// A tiny static server for the site, used by the browser tests (no build step needed).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT) || 4173;
// The same security headers as the live site (vercel.json), so tests catch anything they would block.
// The only change: the pretend Supabase used by the account tests is allowed too.
const HEADERS = Object.fromEntries(JSON.parse(await readFile(join(ROOT, "vercel.json"), "utf8")).headers[0].headers
  .filter(h => h.key !== "Strict-Transport-Security")
  .map(h => [h.key, h.key === "Content-Security-Policy" ? h.value.replace("connect-src 'self'", "connect-src 'self' https://mock.supabase.test").replace("; upgrade-insecure-requests", "") : h.value]));
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".json": "application/json" };

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT) || /\/(tests|\.git|\.github)\//.test(file)) { res.writeHead(404).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { ...HEADERS, "Content-Type": TYPES[extname(file)] || "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end("Not found"); }
}).listen(PORT, () => console.log("Serving " + ROOT + " on http://localhost:" + PORT));
