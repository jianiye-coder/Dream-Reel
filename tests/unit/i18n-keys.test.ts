import { describe, expect, it } from "vitest";
import { auditI18n, auditRepo, resolveAliases } from "../../scripts/i18n-audit";

// Golden principle 2 (docs/golden-principles.md): zh and en carry the same keys, and every key is read.
describe("i18n dictionary", () => {
  const audit = auditRepo();

  it("zh and en have the same keys and shapes", () => {
    expect(audit.parity).toEqual([]);
  });

  it("zh and en use the same {placeholders}", () => {
    expect(audit.placeholders).toEqual([]);
  });

  it("has no keys that no source file reads (delete them from both languages)", () => {
    expect(audit.deadKeys).toEqual([]);
  });
});

describe("i18n audit", () => {
  const dict = {
    zh: { a: { used: "x", viaAlias: "x", viaDestructure: "x", dead: "x" }, b: { c: { d: "x" } }, n: "{count} 条" },
    en: { a: { used: "x", viaAlias: "x", viaDestructure: "x", dead: "x" }, b: { c: { d: "x" } }, n: "{count} items" },
  };

  it("resolves const and destructured aliases", () => {
    const aliases = resolveAliases("const A = T.a; const { b: B } = T; const C = B.c;");
    expect(Object.fromEntries(aliases)).toEqual({ T: "", A: "a", B: "b", C: "b.c" });
  });

  it("finds dead keys through aliases and counts whole-object hand-offs as reads", () => {
    const sources = [
      { path: "x.tsx", text: "const { lang, T } = useLanguage(); const A = T.a; <p>{T.a.used}{A.viaAlias}{T.n}</p>" },
      { path: "y.tsx", text: "const { a: Z } = T; Z.viaDestructure; <Sub labels={T.b.c} />" },
    ];
    const audit = auditI18n(dict, sources);
    expect(audit.deadKeys).toEqual(["a.dead"]);
    expect(audit.wholeObjectUses).toEqual(["b.c (y.tsx)"]);
    expect(audit.parity).toEqual([]);
  });

  it("reports missing keys, shape and placeholder mismatches", () => {
    const audit = auditI18n(
      { zh: { a: "x", b: { c: "x" }, p: "{n} 个" }, en: { b: "x", extra: "y", p: "{count} items" } },
      [],
    );
    expect(audit.parity).toEqual(["a (missing in en)", "b (zh is object, en is string)", "extra (missing in zh)"]);
    expect(audit.placeholders).toEqual(["p (zh {n} vs en {count})"]);
  });
});
