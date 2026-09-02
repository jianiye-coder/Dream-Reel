import { readFile } from "node:fs/promises";
import {
  deriveDreamAgentConversationContext,
  inferAgentStageFromConversation,
  resolveDeterministicAgentResponse,
  sanitizeDreamAgentResult,
  type DreamAgentResult,
} from "../../src/lib/dreamFollowUpAgent";
import { dreamAgentEvalCases } from "./cases";
import { evaluateDreamAgentResult, summarizeEvalResults } from "./evaluator";

interface StoredArtifact {
  cases: Array<{
    artifact: { id: string; source?: "model" | "deterministic"; rawJsonValid: boolean; result: DreamAgentResult };
  }>;
}

async function main() {
  const artifactPath = process.argv[2];
  const resanitize = process.argv.includes("--resanitize");
  if (!artifactPath) throw new Error("Usage: npm run eval:agent:replay -- /path/to/artifact.json [--resanitize]");
  const stored = JSON.parse(await readFile(artifactPath, "utf8")) as StoredArtifact;
  const casesById = new Map(dreamAgentEvalCases.map((evalCase) => [evalCase.id, evalCase]));
  const results = stored.cases.map(({ artifact }) => {
    const evalCase = casesById.get(artifact.id);
    if (!evalCase) throw new Error(`Unknown evaluation case: ${artifact.id}`);
    if (!resanitize) {
      return evaluateDreamAgentResult(evalCase, artifact.result, artifact.rawJsonValid, artifact.source ?? "model");
    }
    const context = deriveDreamAgentConversationContext(evalCase.messages, evalCase.lang, Boolean(evalCase.preSleepContext));
    const deterministic = resolveDeterministicAgentResponse(context, evalCase.lang);
    const inferredStage = inferAgentStageFromConversation(evalCase.messages, evalCase.lang, context);
    const result = deterministic ?? sanitizeDreamAgentResult(
      artifact.result,
      evalCase.lang,
      inferredStage,
      context,
    );
    return evaluateDreamAgentResult(
      evalCase,
      result,
      artifact.rawJsonValid,
      deterministic ? "deterministic" : artifact.source ?? "model",
    );
  });
  for (const result of results.filter((item) => !item.passed)) {
    const failed = result.checks.filter((check) => !check.passed).map((check) => check.name);
    console.log(`FAIL ${result.id} [${failed.join(", ")}]`);
  }
  console.log(JSON.stringify(summarizeEvalResults(results), null, 2));
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Evaluation replay failed.");
  process.exitCode = 1;
});
