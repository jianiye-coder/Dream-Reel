import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDreamFollowUpAgentPrompt,
  deriveDreamAgentConversationContext,
  inferAgentStage,
  parseDreamAgentContent,
} from "../../src/lib/dreamFollowUpAgent";
import { dreamAgentEvalCases } from "./cases";
import { evaluateDreamAgentResult, summarizeEvalResults } from "./evaluator";

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.DREAM_AGENT_EVAL_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.5";
const outputDir = process.env.DREAM_AGENT_EVAL_OUTPUT_DIR ?? join(tmpdir(), "dream-reel-agent-evals");

async function runCase(evalCase: (typeof dreamAgentEvalCases)[number]) {
  const userTurns = evalCase.messages.filter((message) => message.role === "user").length;
  const stage = inferAgentStage(userTurns);
  const conversationContext = deriveDreamAgentConversationContext(evalCase.messages, evalCase.lang, Boolean(evalCase.preSleepContext));
  const prompt = buildDreamFollowUpAgentPrompt(evalCase.lang, userTurns, stage, evalCase.preSleepContext ?? "", conversationContext);
  const startedAt = performance.now();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: prompt }, ...evalCase.messages],
      max_completion_tokens: 800,
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) throw new Error(`${evalCase.id}: upstream returned ${response.status}`);
  const payload = await response.json() as ChatResponse;
  const raw = payload.choices?.[0]?.message?.content ?? "";
  let rawJsonValid = false;
  try { JSON.parse(raw); rawJsonValid = true; } catch { /* scored below */ }
  const result = parseDreamAgentContent(raw, evalCase.lang, stage, conversationContext);
  return {
    evaluation: evaluateDreamAgentResult(evalCase, result, rawJsonValid),
    artifact: {
      id: evalCase.id,
      tags: evalCase.tags,
      latencyMs: Math.round(performance.now() - startedAt),
      tokens: {
        prompt: payload.usage?.prompt_tokens ?? null,
        completion: payload.usage?.completion_tokens ?? null,
        total: payload.usage?.total_tokens ?? null,
      },
      rawJsonValid,
      result,
    },
  };
}

async function main() {
  if (!apiKey) throw new Error("OPENAI_API_KEY is required to run the agent evaluation.");
  await mkdir(outputDir, { recursive: true });
  const completed = [];
  for (let index = 0; index < dreamAgentEvalCases.length; index += 3) {
    const batch = dreamAgentEvalCases.slice(index, index + 3);
    const items = await Promise.all(batch.map(runCase));
    for (const item of items) {
      completed.push(item);
      const failed = item.evaluation.checks.filter((check) => !check.passed).map((check) => check.name);
      console.log(`${item.evaluation.passed ? "PASS" : "FAIL"} ${item.evaluation.id}${failed.length ? ` [${failed.join(", ")}]` : ""}`);
    }
  }

  const summary = summarizeEvalResults(completed.map((item) => item.evaluation));
  const latencies = completed.map((item) => item.artifact.latencyMs).sort((a, b) => a - b);
  const totalTokens = completed.map((item) => item.artifact.tokens.total).filter((value): value is number => value !== null);
  const operations = {
    averageLatencyMs: Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    p95LatencyMs: latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))],
    averageTotalTokens: totalTokens.length ? Math.round(totalTokens.reduce((sum, value) => sum + value, 0) / totalTokens.length) : null,
  };
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = join(outputDir, `${timestamp}-${model.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);
  await writeFile(outputPath, JSON.stringify({ model, createdAt: new Date().toISOString(), summary, operations, cases: completed }, null, 2), "utf8");
  console.log(JSON.stringify({ ...summary, ...operations }, null, 2));
  console.log(`Detailed synthetic results: ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Agent evaluation failed.");
  process.exitCode = 1;
});
