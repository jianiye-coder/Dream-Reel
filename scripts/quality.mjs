#!/usr/bin/env node
// npm run quality — deterministic checks for the golden principles (docs/golden-principles.md).
//
// Writes quality/score.json (a 0–100 score per principle, an overall score and the top violations
// with file paths) and quality/REPORT.md. Heuristic by design: fast (a few seconds), no network, no
// dependencies beyond knip and tsx. It never fails the build; CI gates live in ci.yml. Raising a
// baseline in quality/baseline.json is a deliberate, reviewed change.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "quality");
const baseline = JSON.parse(fs.readFileSync(path.join(OUT, "baseline.json"), "utf8"));

// tracked + new (not ignored) files, so an uncommitted fix is scored too
const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8" })
  .split("\n").filter((f) => f && fs.existsSync(f));
const cache = new Map();
const read = (f) => { if (!cache.has(f)) cache.set(f, fs.readFileSync(f, "utf8")); return cache.get(f); };
const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const lineCount = (text) => text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
const inSrc = (re) => files.filter((f) => f.startsWith("src/") && re.test(f));
const srcCode = inSrc(/\.(ts|tsx)$/);
const serverCode = srcCode.filter((f) => /^src\/(app\/api\/|lib\/|auth|middleware)/.test(f) && f !== "src/lib/i18n.ts");
const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** text between the parentheses of a call starting at `open` (the index of "(") */
function callArgs(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}
const stripStrings = (s) => s.replace(/`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');

const principles = [];
function principle(id, title, check) {
  const violations = [];
  const metrics = {};
  const add = (file, line, message, penalty) => violations.push({ file, line, message, penalty });
  const result = check({ add, metrics }) ?? {};
  const scored = result.score !== null;
  const penalty = violations.reduce((sum, v) => sum + v.penalty, 0);
  const score = !scored ? null : result.score ?? Math.max(0, Math.round(100 - penalty));
  principles.push({ id, title, score, metrics, violations });
}

// 1 ── notebook design system ───────────────────────────────────────────────────────────────────
principle(1, "Notebook design system only", ({ add, metrics }) => {
  const globals = lineCount(read("src/app/globals.css"));
  metrics.globalsCssLines = globals;
  metrics.globalsCssBaseline = baseline.globalsCssLines;
  if (globals > baseline.globalsCssLines) {
    add("src/app/globals.css", baseline.globalsCssLines, `globals.css grew to ${globals} lines (baseline ${baseline.globalsCssLines}); page styles belong in notebook.css (nb- classes) or a CSS module`, Math.min(40, 2 * (globals - baseline.globalsCssLines)));
  }
  for (const f of inSrc(/\.css$/)) {
    if (f === "src/app/globals.css" || f === "src/app/notebook.css" || f.endsWith(".module.css")) continue;
    add(f, 1, "global stylesheet outside notebook.css / globals.css; use a CSS module", 25);
  }
  const nb = read("src/app/notebook.css");
  for (const m of stripStrings(nb.replace(/\/\*[\s\S]*?\*\//g, "")).matchAll(/(?<![\w-])\.([a-zA-Z][\w-]*)/g)) {
    if (!m[1].startsWith("nb-")) add("src/app/notebook.css", lineOf(nb, m.index), `.${m[1]}: notebook classes are prefixed nb-`, 5);
  }
  let inline = 0;
  for (const f of inSrc(/^src\/app\/.*\.tsx$/)) {
    for (const m of read(f).matchAll(/style=\{\{/g)) {
      inline++;
      if (inline <= 10) add(f, lineOf(read(f), m.index), "inline style object; prefer a class (tokens via var(--…))", 1);
    }
  }
  metrics.inlineStyles = inline;
});

// 2 ── i18n parity, no dead keys ───────────────────────────────────────────────────────────────
principle(2, "zh + en parity, no dead keys", ({ add, metrics }) => {
  const r = run("npx", ["--no-install", "tsx", "scripts/i18n-audit.ts"]);
  if (r.status !== 0) { add("scripts/i18n-audit.ts", 1, "i18n audit failed to run: " + (r.stderr || "").split("\n")[0], 100); return; }
  const audit = JSON.parse(r.stdout);
  Object.assign(metrics, { parity: audit.parity.length, placeholders: audit.placeholders.length, deadKeys: audit.deadKeys.length });
  for (const p of audit.parity) add("src/lib/i18n.ts", 1, `parity: ${p}`, 25);
  for (const p of audit.placeholders) add("src/lib/i18n.ts", 1, `placeholders differ: ${p}`, 10);
  for (const k of audit.deadKeys) add("src/lib/i18n.ts", 1, `dead key (no source reads it): ${k}`, 5);
});

// 3 ── no dead code, deps or loose ends ────────────────────────────────────────────────────────
principle(3, "No dead code or dependencies", ({ add, metrics }) => {
  const r = run("npx", ["--no-install", "knip", "--reporter", "json", "--no-exit-code"]);
  let issues = [];
  try { issues = JSON.parse(r.stdout).issues ?? []; } catch { add("knip.json", 1, "knip failed to run: " + (r.stderr || "").split("\n")[0], 100); return; }
  let count = 0;
  for (const issue of issues) {
    for (const [type, list] of Object.entries(issue)) {
      if (!Array.isArray(list) || !list.length) continue;
      for (const item of list) {
        count++;
        const heavy = type === "files" || /dependencies|unlisted|binaries/i.test(type);
        add(issue.file, item.line ?? 1, `knip ${type}: ${item.name ?? issue.file}`, heavy ? 10 : 5);
      }
    }
  }
  metrics.knipIssues = count;
  let todos = 0;
  for (const f of files.filter((x) => /^(src|scripts|evals|tests)\/.*\.(ts|tsx|mjs|css)$/.test(x) && x !== "scripts/quality.mjs")) {
    for (const m of read(f).matchAll(/\b(TODO|FIXME|XXX|HACK)\b/g)) {
      todos++;
      add(f, lineOf(read(f), m.index), `${m[1]} left in the code (fix it or open an issue)`, 2);
    }
  }
  metrics.todos = todos;
});

// 4 ── file size ───────────────────────────────────────────────────────────────────────────────
principle(4, "Files in src/app stay under ~800 lines", ({ add, metrics }) => {
  const big = [];
  for (const f of inSrc(/^src\/app\/.*\.(ts|tsx|css)$/)) {
    const n = lineCount(read(f));
    if (n > 800) { big.push(`${f} (${n})`); add(f, 800, `${n} lines (warn above 800): split by concern`, Math.min(30, Math.ceil((n - 800) / 50))); }
  }
  metrics.filesOver800 = big;
});

// 5 ── dream text encrypted, never logged ──────────────────────────────────────────────────────
principle(5, "Dream text is encrypted and never logged", ({ add, metrics }) => {
  let rawErrors = 0;
  for (const f of srcCode) {
    const text = read(f);
    // SQL that writes journal text must go through dreamTextEncryption
    for (const m of text.matchAll(/(INSERT INTO|UPDATE)\s+(dream_entries|morning_pages)\b([\s\S]{0,400}?)(`|;)/g)) {
      if (/\b(raw_text|clean_text|content)\b/.test(m[3]) && !/dreamTextEncryption/.test(text)) {
        add(f, lineOf(text, m.index), `writes ${m[2]} text without importing dreamTextEncryption`, 50);
      }
    }
    for (const m of text.matchAll(/console\.(log|info|debug|warn|error)\s*\(/g)) {
      const line = lineOf(text, m.index);
      if (m[1] === "log") { add(f, line, "console.log in src (debug output; remove it)", 10); continue; }
      const args = stripStrings(callArgs(text, m.index + m[0].length - 1));
      if (/\b(rawText|cleanText|raw_text|clean_text|dreamText|content|prompt|transcript|messages)\b/.test(args)) {
        add(f, line, "a log call references journal text, prompts or messages", 25);
      } else if (serverCode.includes(f) && /(^|,)\s*(error|err|e|cause)\s*(,|$)/.test(args.replace(/\s+/g, " ")) && !/safeErrorMetadata/.test(args)) {
        rawErrors++;
        add(f, line, "server logs a raw error object (database errors can echo values); wrap it in safeErrorMetadata()", 4);
      }
    }
  }
  metrics.rawErrorLogs = rawErrors;
});

// 6 ── no env var names or raw provider errors in responses ────────────────────────────────────
principle(6, "Users see error codes, never env names or raw errors", ({ add, metrics }) => {
  let raw = 0;
  for (const f of srcCode.filter((x) => x.startsWith("src/app/api/"))) {
    const text = read(f);
    for (const m of text.matchAll(/error:\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`|[\w.]+(\([^)]*\))?)/g)) {
      const value = m[1];
      const line = lineOf(text, m.index);
      if (/^["'`]/.test(value)) {
        const literal = value.slice(1, -1);
        if (/^[A-Z][A-Z0-9_]+$/.test(literal)) continue; // an API error code
        if (/\b[A-Z][A-Z0-9]*_[A-Z0-9_]*(KEY|SECRET|TOKEN|URL|ID|USD|CNY)\b|api key/i.test(literal)) add(f, line, `response names configuration: "${literal}"`, 25);
        else { raw++; add(f, line, `response sends a sentence instead of an API_ERROR_CODES code: "${literal}"`, 3); }
      } else if (/(\b(error|err|e)\.message\b|String\((error|err|e)\))/.test(value)) {
        add(f, line, `response passes a raw error through: ${value}`, 20);
      }
    }
  }
  metrics.rawMessages = raw;
});

// 7 ── payments and auth are tested ────────────────────────────────────────────────────────────
principle(7, "Payments and auth changes come with tests", ({ add, metrics }) => {
  const critical = srcCode.filter((f) => !f.includes("[...nextauth]") && /^src\/(app\/api\/(billing|auth|user)\/|lib\/(billing|stripe|session|authRateLimit|dreamTextEncryption)\.ts$|auth(\.config)?\.ts$|middleware\.ts$)/.test(f));
  const tests = files.filter((f) => /^tests\/(unit|integration)\/.*\.test\.ts$/.test(f)).map(read).join("\n");
  const imported = new Set();
  for (const m of tests.matchAll(/(?:from\s+|import\(\s*)["']([^"']+)["']/g)) imported.add(m[1].replace(/^@\//, "src/"));
  let covered = 0;
  for (const f of critical) {
    const mod = f.replace(/\.tsx?$/, "");
    if (imported.has(mod) || imported.has(mod.replace(/\/index$/, ""))) covered++;
    else add(f, 1, "payments/auth module without a test that imports it", 100 / critical.length);
  }
  metrics.critical = critical.length;
  metrics.tested = covered;
  return { score: critical.length ? Math.round((100 * covered) / critical.length) : 100 };
});

// 8 ── small focused PRs (process; checked by the auto-merge gate and review) ─────────────────
principle(8, "Small, focused PRs", () => ({ score: null }));

// 9 ── reduced motion and accessible names ─────────────────────────────────────────────────────
principle(9, "Reduced motion and accessible names", ({ add }) => {
  for (const f of inSrc(/\.css$/)) {
    const css = read(f);
    const moves = /@keyframes|animation\s*:|transition[^;]*\b(transform|translate|top|left|right|bottom|height|width|margin|all)\b|transition\s*:\s*all/.test(css);
    if (moves && !/prefers-reduced-motion/.test(css)) add(f, 1, "moves things but has no prefers-reduced-motion rule", 10);
  }
  for (const f of inSrc(/\.tsx$/)) {
    const text = read(f);
    for (const m of text.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      const [, attrs, body] = m;
      if (/aria-label(ledby)?=|title=/.test(attrs)) continue;
      const visible = body.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[A-Z]\w*[^>]*\/>/g, "").replace(/<[^>]+>/g, "").trim();
      if (!visible) add(f, lineOf(text, m.index), "icon-only <button> without aria-label", 10);
    }
    for (const m of text.matchAll(/<(img|Image)\b(?![^>]*\balt=)[^>]*>/g)) add(f, lineOf(text, m.index), `<${m[1]}> without alt`, 10);
  }
});

// 10 ── one helper per concern ─────────────────────────────────────────────────────────────────
principle(10, "One helper per concern", ({ add, metrics }) => {
  const defs = new Map();
  for (const f of srcCode) {
    const text = read(f);
    for (const m of text.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([a-z]\w*)|^(?:export\s+)?const\s+([a-z]\w*)\s*=\s*(?:async\s*)?\(/gm)) {
      const name = m[1] ?? m[2];
      if (!defs.has(name)) defs.set(name, []);
      defs.get(name).push({ f, line: lineOf(text, m.index) });
    }
  }
  const dupes = [...defs].filter(([, at]) => new Set(at.map((a) => a.f)).size > 1);
  for (const [name, at] of dupes) add(at[1].f, at[1].line, `${name}() is also defined in ${at.filter((a) => a.f !== at[1].f).map((a) => a.f).join(", ")}: share one helper`, 10);
  metrics.duplicateHelpers = dupes.map(([name]) => name);
  // known concerns with a home: a copy elsewhere is drift
  const homes = [
    [/(Number|parseInt|parseUserId|safeParse)\(\s*\(?\s*session\b[^)]*\.user\??\.id/, "src/lib/session.ts", "parses the session user id (use requireUserId / sessionUserId)"],
    [/getFullYear\(\)\}-\$\{String\([^)]*getMonth\(\) \+ 1\)\.padStart/, "src/lib/dates.ts", "formats a local YYYY-MM-DD (use localDayKey)"],
    [/〇一二三四五六七八九|零一二三四五六七八九/, "src/lib/dates.ts", "writes Chinese numerals (use cnNumber / writtenDate)"],
    [/toggleAttribute\("data-fade-/, "src/lib/edgeFade.ts", "fades scroll edges (use edgeFade)"],
  ];
  for (const f of srcCode) {
    const text = read(f);
    for (const [re, home, what] of homes) {
      if (f === home) continue;
      const m = text.match(re);
      if (m) add(f, lineOf(text, m.index), `${what}; the helper lives in ${home}`, 10);
    }
  }
});

// ── score, report ───────────────────────────────────────────────────────────────────────────
const scored = principles.filter((p) => p.score !== null);
const overall = Math.round(scored.reduce((s, p) => s + p.score, 0) / scored.length);
const top = principles.flatMap((p) => p.violations.map((v) => ({ principle: p.id, ...v, penalty: Math.round(v.penalty * 10) / 10 })))
  .sort((a, b) => b.penalty - a.penalty || a.file.localeCompare(b.file) || a.line - b.line);
const commit = run("git", ["rev-parse", "--short", "HEAD"]).stdout.trim();
const score = {
  commit,
  overall,
  principles: principles.map(({ id, title, score: s, metrics, violations }) => ({
    id, title, score: s, metrics, violationCount: violations.length,
    violations: violations.slice(0, 50).map((v) => ({ ...v, penalty: Math.round(v.penalty * 10) / 10 })),
  })),
  topViolations: top.slice(0, 25),
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "score.json"), JSON.stringify(score, null, 2) + "\n");

const md = [
  `# Quality report`,
  ``,
  `Overall **${overall}/100** at \`${commit}\` — principles in [docs/golden-principles.md](../docs/golden-principles.md); \`npm run quality\` regenerates this.`,
  ``,
  `| # | Principle | Score | Violations |`,
  `| - | --------- | ----- | ---------- |`,
  ...principles.map((p) => `| ${p.id} | ${p.title} | ${p.score ?? "n/a (review)"} | ${p.violations.length} |`),
  ``,
  `## Top violations`,
  ``,
  ...(top.length ? top.slice(0, 15).map((v) => `- **P${v.principle}** \`${v.file}:${v.line}\` — ${v.message} (−${v.penalty})`) : ["None."]),
  ``,
].join("\n");
fs.writeFileSync(path.join(OUT, "REPORT.md"), md);
console.log(md);
