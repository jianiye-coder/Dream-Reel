// Usage: node scripts/prune-unused-css.mjs . src/app/globals.css src/app/notebook.css
// Removes rules whose selectors target classes no file in src/ or tests/ mentions.
// Check the result visually: dynamic class names (PROTECTED prefixes) and :is/:where/:not are left alone.
// Remove CSS rules whose selectors only target classes that nothing in src/ or tests/ references.
import postcss from "postcss";
import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";
const root = process.argv[2], files = process.argv.slice(3);
const code = globSync(["src/**/*.{ts,tsx}", "tests/**/*.ts"], { cwd: root }).map((f) => readFileSync(`${root}/${f}`, "utf8")).join("\n");
const PROTECTED = ["nb-page-", "journal-tab-", "frag-", "empty-", "analysis-", "tail-"];
const used = new Map();
const isUsed = (c) => {
  if (used.has(c)) return used.get(c);
  const ok = PROTECTED.some((p) => c.startsWith(p)) || new RegExp(`(?<![\\w-])${c.replace(/[-]/g, "\\-")}(?![\\w-])`).test(code);
  used.set(c, ok); return ok;
};
// :is()/:where() match if any alternative matches and :not() matches when its class is absent,
// so a dead class inside them does not make the selector dead. Leave those selectors alone.
const deadSelector = (sel) => {
  if (/:(is|where|not|has)\(/.test(sel) && !/^body:has\(\.[\w-]+\)/.test(sel)) return false; const cls = [...sel.replace(/url\([^)]*\)/g, "").matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]); return cls.length > 0 && cls.some((c) => !isUsed(c)); };
for (const f of files) {
  const css = readFileSync(`${root}/${f}`, "utf8");
  const ast = postcss.parse(css);
  let removedRules = 0, trimmedSelectors = 0;
  ast.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes/.test(rule.parent.name)) return;
    const keep = rule.selectors.filter((s) => !deadSelector(s));
    if (keep.length === 0) { const pc = rule.prev(); if (pc?.type === "comment") pc.__describesRemoved = true; rule.remove(); removedRules++; }
    else if (keep.length < rule.selectors.length) { trimmedSelectors += rule.selectors.length - keep.length; rule.selectors = keep; }
  });
  // drop keyframes that no surviving animation declaration (or script) names
  const animated = new Set();
  ast.walkDecls(/^(-webkit-)?animation(-name)?$/, (d) => d.value.split(/[\s,]+/).forEach((t) => animated.add(t)));
  let removedKeyframes = 0;
  ast.walkAtRules(/keyframes$/, (at) => {
    const name = at.params.trim();
    if (!animated.has(name) && !new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(code)) { const pc = at.prev(); if (pc?.type === "comment") pc.__describesRemoved = true; at.remove(); removedKeyframes++; }
  });
  let changed = true;
  while (changed) { changed = false; ast.walkAtRules((at) => { if (at.nodes && at.nodes.length === 0) { at.remove(); changed = true; } }); }
  // comments: one written for a removed rule goes with it; a section heading (──/══ rule) goes only
  // when its whole section is gone; comments inside declaration blocks are never touched
  const heading = (c) => /──|══|═══|---/.test(c.text);
  let orphans = 0, again = true;
  while (again) {
    again = false;
    ast.walkComments((c) => {
      if (c.parent?.type === "rule") return;
      const n = c.next();
      const subheading = (x) => /\n[ \t]+$/.test(x.raws.before ?? "");   // an indented heading belongs to the one above
      const drop = heading(c) ? (!n || (n.type === "comment" && heading(n) && !subheading(n))) : c.__describesRemoved;
      if (drop) { const pc = c.prev(); if (pc?.type === "comment" && !heading(pc) && c.__describesRemoved) pc.__describesRemoved = true; c.remove(); orphans++; again = true; }
    });
  }
  console.log(f, "orphan comments removed:", orphans);
  const outCss = ast.toString().replace(/\n{3,}/g, "\n\n");
  writeFileSync(`${root}/${f}`, outCss);
  console.log(f, { lines: `${css.split("\n").length} -> ${outCss.split("\n").length}`, removedRules, trimmedSelectors, removedKeyframes });
}
