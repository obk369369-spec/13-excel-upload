import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function listHtml(dir = ".", depth = 0) {
  if (depth > 2) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => ![".git", "node_modules"].includes(entry.name))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listHtml(full, depth + 1);
      return entry.name.toLowerCase().endsWith(".html") ? [full] : [];
    });
}

const candidates = listHtml().sort((a, b) => {
  const ai = path.basename(a).toLowerCase() === "index.html" ? 0 : 1;
  const bi = path.basename(b).toLowerCase() === "index.html" ? 0 : 1;
  return ai - bi || a.localeCompare(b);
});
if (candidates.length === 0) {
  console.error("HOLD: HTML entry file not found");
  process.exit(1);
}

const entry = candidates[0];
const html = fs.readFileSync(entry, "utf8");
const controls = {
  inputs: (html.match(/<(input|textarea|select)\b/gi) || []).length,
  buttons: (html.match(/<button\b/gi) || []).length
};
const failures = [];
if (controls.inputs === 0) failures.push("no input control");
if (controls.buttons === 0) failures.push("no button");

let classicScripts = 0;
let moduleScripts = 0;
const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
for (const match of html.matchAll(scriptRe)) {
  const attrs = match[1] || "";
  const source = match[2] || "";
  if (/\bsrc\s*=/i.test(attrs)) continue;
  const type = (attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1] || "").toLowerCase();
  if (["application/json", "application/ld+json", "importmap"].includes(type)) continue;
  if (type === "module") {
    moduleScripts += 1;
    continue;
  }
  classicScripts += 1;
  try {
    new vm.Script(source, { filename: entry });
  } catch (error) {
    failures.push(String(error.message || error));
  }
}

const evidence = {
  schema: "wic.external-evidence.v1",
  repository: process.env.GITHUB_REPOSITORY || null,
  commit: process.env.GITHUB_SHA || null,
  checkedAt: new Date().toISOString(),
  entry,
  htmlCandidates: candidates,
  bytes: Buffer.byteLength(html),
  controls,
  scripts: { classic: classicScripts, module: moduleScripts },
  result: failures.length === 0 ? "STRUCTURE_PASS" : "HOLD",
  failures
};
fs.mkdirSync("external-evidence", { recursive: true });
fs.writeFileSync("external-evidence/static-validation.json", JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
if (failures.length) process.exit(1);
