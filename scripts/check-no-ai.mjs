// Fails if any AI SDK, AI API host or AI key name appears in the app's code, config or dependencies.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const scan = ["src", "public", "spec", "package.json", ".env.example", "render.yaml"];
const banned = [
  /openai/i, /anthropic/i, /@google\/generative-ai/i, /generativelanguage\.googleapis/i, /cohere/i, /mistral/i,
  /groq/i, /replicate/i, /huggingface/i, /langchain/i, /llamaindex/i, /ollama/i, /OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY/,
];
const files = [];
const walk = (p) => (statSync(p).isDirectory() ? readdirSync(p).forEach((f) => walk(path.join(p, f))) : files.push(p));
for (const s of scan) { try { walk(path.join(root, s)); } catch {} }

// Also check every installed package name (direct and transitive).
const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
const pkgs = Object.keys(lock.packages ?? {}).map((k) => k.replace(/^.*node_modules\//, "")).filter(Boolean);

let hits = 0;
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const re of banned) if (re.test(text)) { console.log(`AI reference: ${path.relative(root, f)} matches ${re}`); hits++; }
}
for (const p of pkgs) for (const re of banned) if (re.test(p)) { console.log(`AI package installed: ${p}`); hits++; }
console.log(hits ? `\n${hits} AI reference(s) found.` : `No AI SDKs, AI API hosts or AI keys: scanned ${files.length} files and ${pkgs.length} installed packages.`);
process.exit(hits ? 1 : 0);
