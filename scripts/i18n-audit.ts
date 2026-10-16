// i18n audit: zh/en parity and dead translation keys (golden principle 2, docs/golden-principles.md).
// Used by tests/unit/i18n-keys.test.ts (a CI gate) and scripts/quality.mjs (`npx tsx scripts/i18n-audit.ts`
// prints the audit as JSON).
//
// Components read strings as `T.section.key`, usually through short aliases
// (`const J = T.journal;`, `const { archive: A } = T;`). This module resolves those aliases
// per file and reports every leaf key in the zh dictionary that no source file reads.
// Arrays are leaves (their items are read by index or `.map`). A whole sub-object handed
// on (`labels={M.draw}`) or indexed dynamically (`J.nb[key]`) counts every key below it as
// used; those spots are listed in `wholeObjectUses` so a reviewer can check them by eye.
import fs from "node:fs";
import path from "node:path";
import { translations as repoTranslations } from "../src/lib/i18n";

type Dict = { [key: string]: unknown };
export type SourceFile = { path: string; text: string };
export type I18nAudit = {
  /** keys present in one language but not the other, or with a different shape */
  parity: string[];
  /** `{name}` placeholders that differ between zh and en */
  placeholders: string[];
  /** leaf keys (dot paths) that no source file reads */
  deadKeys: string[];
  /** sub-objects used as a whole or indexed dynamically — every key below counts as used */
  wholeObjectUses: string[];
};

const isDict = (v: unknown): v is Dict => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function shapeDiff(a: unknown, b: unknown, at: string, out: string[]) {
  if (isDict(a) && isDict(b)) {
    for (const k of Object.keys(a)) {
      if (!(k in b)) out.push(`${at}${k} (missing in en)`);
      else shapeDiff(a[k], b[k], `${at}${k}.`, out);
    }
    for (const k of Object.keys(b)) if (!(k in a)) out.push(`${at}${k} (missing in zh)`);
    return;
  }
  const kind = (v: unknown) => (Array.isArray(v) ? "array" : isDict(v) ? "object" : typeof v);
  if (kind(a) !== kind(b)) out.push(`${at.slice(0, -1)} (zh is ${kind(a)}, en is ${kind(b)})`);
  else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${at.slice(0, -1)} (zh has ${a.length} items, en has ${b.length})`);
    else a.forEach((item, i) => shapeDiff(item, b[i], `${at}${i}.`, out));
  }
}

function placeholderDiff(a: unknown, b: unknown, at: string, out: string[]) {
  if (typeof a === "string" && typeof b === "string") {
    const names = (s: string) => [...new Set([...s.matchAll(/\{(\w+)[}:]/g)].map((m) => m[1]))].sort().join(",");
    if (names(a) !== names(b)) out.push(`${at.slice(0, -1)} (zh {${names(a)}} vs en {${names(b)}})`);
    return;
  }
  if ((isDict(a) && isDict(b)) || (Array.isArray(a) && Array.isArray(b))) {
    for (const k of Object.keys(a)) placeholderDiff((a as Dict)[k], (b as Dict)[k], `${at}${k}.`, out);
  }
}

function leafPaths(o: Dict, prefix: string[] = []): string[][] {
  return Object.entries(o).flatMap(([k, v]) => (isDict(v) ? leafPaths(v, [...prefix, k]) : [[...prefix, k]]));
}

const toT = (text: string) => text.replace(/\btranslations(?:\.(?:zh|en)\b|\[\w+\])/g, "T");
const ALIAS_DECL = /const\s+(?:\w+|\{[^}]*\})\s*=\s*(?:\w+(?:\.\w+)*|translations\[\w+\])\s*;/g;

/** alias name -> dictionary path it points at ("" = the root `T`) */
export function resolveAliases(text: string): Map<string, string> {
  // `T` from useLanguage(); `translations.zh` / `translations[lang]` are rewritten to `T` (see toT)
  const al = new Map<string, string>([["T", ""]]);
  const join = (base: string, rest: string) => [base, rest].filter(Boolean).join(".");
  for (let pass = 0; pass < 4; pass++) {
    // const J = T.journal;   const N = J.nb;
    for (const m of text.matchAll(/const\s+(\w+)\s*=\s*(\w+)((?:\.\w+)+)\s*;/g)) {
      const base = al.get(m[2]);
      if (base !== undefined) al.set(m[1], join(base, m[3].slice(1)));
    }
    // const { archive: A, nb } = T;
    for (const m of text.matchAll(/const\s*\{([^}]*)\}\s*=\s*(\w+)((?:\.\w+)*)\s*;/g)) {
      const base = al.get(m[2]);
      if (base === undefined) continue;
      const from = join(base, m[3].slice(1));
      for (const part of m[1].split(",")) {
        const pm = part.trim().match(/^(\w+)(?:\s*:\s*(\w+))?$/);
        if (pm) al.set(pm[2] ?? pm[1], join(from, pm[1]));
      }
    }
  }
  return al;
}

export function auditI18n(translations: { zh: Dict; en: Dict }, sources: SourceFile[]): I18nAudit {
  const parity: string[] = [];
  shapeDiff(translations.zh, translations.en, "", parity);
  const placeholders: string[] = [];
  placeholderDiff(translations.zh, translations.en, "", placeholders);

  // the alias declarations themselves (`const J = T.journal;`) are not reads
  const files = sources.map((s) => {
    const text = toT(s.text);
    return { path: s.path, aliases: [...resolveAliases(text)], text: text.replace(ALIAS_DECL, "") };
  });
  const whole = new Set<string>();
  const deadKeys: string[] = [];

  for (const leaf of leafPaths(translations.zh)) {
    const dotted = leaf.join(".");
    const used = files.some(({ text, aliases, path: file }) =>
      aliases.some(([name, at]) => {
        if (at && dotted !== at && !dotted.startsWith(at + ".")) return false;
        const rest = (at ? dotted.slice(at.length + 1) : dotted).split(".").filter(Boolean);
        if (rest.length === 0) return new RegExp(`\\b${esc(name)}\\b`).test(text);
        // direct read: J.toolbar.voice (optional chaining allowed)
        const chain = (parts: string[]) => `\\b${esc(name)}${parts.map((p) => `\\??\\.${esc(p)}`).join("")}`;
        if (new RegExp(`${chain(rest)}(?![\\w$])`).test(text)) return true;
        // an ancestor handed on whole or indexed dynamically: labels={M.draw}, J.nb[key]
        for (let i = rest.length - 1; i >= 0; i--) {
          const prefix = rest.slice(0, i);
          if (i === 0 && !at) continue; // T itself is always passed around
          const re = new RegExp(`${chain(prefix)}(?:\\s*\\[|\\s*[}),;]|\\s*$)`, "m");
          if (re.test(text)) {
            whole.add(`${[at, ...prefix].filter(Boolean).join(".")} (${file})`);
            return true;
          }
        }
        return false;
      }),
    );
    if (!used) deadKeys.push(dotted);
  }
  return { parity, placeholders, deadKeys, wholeObjectUses: [...whole].sort() };
}

/** every .ts/.tsx under src/ except the dictionary itself */
export function loadSources(root: string): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !p.endsWith(path.join("lib", "i18n.ts"))) {
        out.push({ path: path.relative(root, p), text: fs.readFileSync(p, "utf8") });
      }
    }
  };
  walk(path.join(root, "src"));
  return out;
}

/** The audit of this repository's dictionary against its own sources. */
export function auditRepo(root: string = process.cwd()): I18nAudit {
  return auditI18n(repoTranslations, loadSources(root));
}

// CLI: `npx tsx scripts/i18n-audit.ts` prints the audit as JSON
if (process.argv[1] && /i18n-audit\.ts$/.test(process.argv[1])) {
  console.log(JSON.stringify(auditRepo(), null, 2));
}
