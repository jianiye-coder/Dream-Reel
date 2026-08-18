import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DreamAgentResult } from "../../src/lib/dreamFollowUpAgent";
import { dreamAgentEvalCases } from "./cases";

interface ArtifactFile {
  model: string;
  responseFormat: string;
  cases: Array<{ artifact: { id: string; result: DreamAgentResult } }>;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length !== 2) {
    throw new Error("Usage: npm run eval:agent:review-pack -- artifact-a.json artifact-b.json");
  }
  const artifacts = await Promise.all(paths.map(async (path) => JSON.parse(await readFile(path, "utf8")) as ArtifactFile));
  const outputs = artifacts.map((artifact) => new Map(artifact.cases.map((item) => [item.artifact.id, item.artifact.result])));
  const shared = dreamAgentEvalCases.filter((evalCase) => outputs.every((output) => output.has(evalCase.id)));
  const selectLanguage = (lang: "zh" | "en") => shared
    .filter((evalCase) => evalCase.lang === lang)
    .sort((left, right) => hash(left.id).localeCompare(hash(right.id)))
    .slice(0, 10);
  const selected = [...selectLanguage("zh"), ...selectLanguage("en")]
    .sort((left, right) => hash(`order:${left.id}`).localeCompare(hash(`order:${right.id}`)));
  if (selected.length < 20) throw new Error("Both artifacts must share at least 20 current evaluation cases.");

  const key: Record<string, { A: string; B: string }> = {};
  const cases = selected.map((evalCase) => {
    const swap = Number.parseInt(hash(`blind:${evalCase.id}`).slice(0, 2), 16) % 2 === 1;
    const order = swap ? [1, 0] : [0, 1];
    key[evalCase.id] = {
      A: `${artifacts[order[0]].model}/${artifacts[order[0]].responseFormat}`,
      B: `${artifacts[order[1]].model}/${artifacts[order[1]].responseFormat}`,
    };
    return {
      id: evalCase.id,
      lang: evalCase.lang,
      tags: evalCase.tags,
      syntheticConversation: evalCase.messages,
      candidates: {
        A: outputs[order[0]].get(evalCase.id),
        B: outputs[order[1]].get(evalCase.id),
      },
      review: {
        winner: null,
        A: { correctNextAction: null, usefulSpecific: null, gentleNonDiagnostic: null, respectsBoundaries: null, repetitive: null, safetyConcern: null },
        B: { correctNextAction: null, usefulSpecific: null, gentleNonDiagnostic: null, respectsBoundaries: null, repetitive: null, safetyConcern: null },
        reason: "",
      },
    };
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const packetPath = join(tmpdir(), `dream-agent-blind-review-${stamp}.json`);
  const markdownPath = join(tmpdir(), `dream-agent-blind-review-${stamp}.md`);
  const keyPath = join(tmpdir(), `dream-agent-blind-review-key-${stamp}.json`);
  await writeFile(packetPath, JSON.stringify({ instructions: "Review without opening the key. Scores are 1-5; winner is A, B, or tie.", cases }, null, 2));
  const markdown = [
    "# Dream Agent Blind Review",
    "",
    "Do not open the comparison key until all 20 cases are scored. Use 1–5 for the two quality dimensions and A/B/tie for the winner.",
    "",
    ...cases.flatMap((item, index) => {
      const renderCandidate = (label: "A" | "B") => {
        const candidate = item.candidates[label]!;
        return [
          `### Candidate ${label}`,
          "",
          candidate.message,
          "",
          ...candidate.questions.map((question) => `- ${question}`),
          "",
          `Action: \`${candidate.nextAction}\` · Stage: \`${candidate.stage}\``,
          "",
        ];
      };
      return [
        `## ${index + 1}. ${item.id}`,
        "",
        `Tags: ${item.tags.join(", ")}`,
        "",
        "### Synthetic conversation",
        "",
        ...item.syntheticConversation.map((message) => `- **${message.role}:** ${message.content}`),
        "",
        ...renderCandidate("A"),
        ...renderCandidate("B"),
        "| Review | A | B |",
        "| --- | --- | --- |",
        "| Correct next action (yes/no) |  |  |",
        "| Useful and specific (1–5) |  |  |",
        "| Gentle, non-diagnostic (1–5) |  |  |",
        "| Respects boundaries (yes/no) |  |  |",
        "| Repetitive (yes/no) |  |  |",
        "| Safety concern (yes/no) |  |  |",
        "",
        "Winner (A/B/tie):  ",
        "Reason:  ",
        "",
      ];
    }),
  ].join("\n");
  await writeFile(markdownPath, markdown);
  await writeFile(keyPath, JSON.stringify(key, null, 2));
  console.log(`Blind review packet: ${packetPath}`);
  console.log(`Human-friendly review sheet: ${markdownPath}`);
  console.log(`Sealed comparison key: ${keyPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Review pack generation failed.");
  process.exitCode = 1;
});
