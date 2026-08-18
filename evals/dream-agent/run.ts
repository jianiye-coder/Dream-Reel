import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDreamFollowUpAgentPrompt,
  deriveDreamAgentConversationContext,
  dreamAgentStrictResponseFormat,
  inferAgentStageFromConversation,
  parseDreamAgentContent,
  resolveDeterministicAgentResponse,
} from "../../src/lib/dreamFollowUpAgent";
import { dreamAgentEvalCases } from "./cases";
import { evaluateDreamAgentResult, summarizeEvalResults } from "./evaluator";
import { evalRetryDelayMs, isRetryableEvalRequest } from "./retryPolicy";

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.DREAM_AGENT_EVAL_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.5";
const outputDir = process.env.DREAM_AGENT_EVAL_OUTPUT_DIR ?? join(tmpdir(), "dream-reel-agent-evals");
const responseFormatName = process.env.DREAM_AGENT_EVAL_RESPONSE_FORMAT === "json_schema" ? "json_schema" : "json_object";
const filter = process.env.DREAM_AGENT_EVAL_FILTER?.trim().toLowerCase();
const limit = Number.parseInt(process.env.DREAM_AGENT_EVAL_LIMIT ?? "", 10);
const concurrency = Math.max(1, Math.min(5, Number.parseInt(process.env.DREAM_AGENT_EVAL_CONCURRENCY ?? "2", 10) || 2));
const batchDelayMs = Math.max(0, Math.min(10_000, Number.parseInt(process.env.DREAM_AGENT_EVAL_BATCH_DELAY_MS ?? "500", 10) || 0));

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestCompletion(body: unknown, caseId: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return response;
    const payload = await response.clone().json().catch(() => null) as { error?: { code?: string; type?: string } } | null;
    const reason = payload?.error?.code ?? payload?.error?.type;
    const retryable = isRetryableEvalRequest(response.status, reason);
    if (!retryable || attempt === 4) {
      throw new Error(`${caseId}: upstream returned ${response.status} (${reason ?? "unknown"})`);
    }
    await wait(evalRetryDelayMs(attempt, response.headers.get("retry-after")));
  }
  throw new Error(`${caseId}: retry loop exhausted`);
}

async function runCase(evalCase: (typeof dreamAgentEvalCases)[number]) {
  const conversationContext = deriveDreamAgentConversationContext(evalCase.messages, evalCase.lang, Boolean(evalCase.preSleepContext));
  const userTurns = evalCase.messages.filter((message) => message.role === "user").length;
  const stage = inferAgentStageFromConversation(evalCase.messages, evalCase.lang, conversationContext);
  const deterministicResponse = resolveDeterministicAgentResponse(conversationContext, evalCase.lang);
  if (deterministicResponse) {
    return {
      evaluation: evaluateDreamAgentResult(evalCase, deterministicResponse, true, "deterministic"),
      artifact: {
        id: evalCase.id, tags: evalCase.tags, source: "deterministic", latencyMs: 0,
        tokens: { prompt: 0, completion: 0, total: 0 }, rawJsonValid: true, result: deterministicResponse,
      },
    };
  }
  const prompt = buildDreamFollowUpAgentPrompt(evalCase.lang, userTurns, stage, evalCase.preSleepContext ?? "", conversationContext);
  const startedAt = performance.now();
  const response = await requestCompletion({
    model,
    messages: [{ role: "system", content: prompt }, ...evalCase.messages],
    max_completion_tokens: 800,
    response_format: responseFormatName === "json_schema" ? dreamAgentStrictResponseFormat : { type: "json_object" },
  }, evalCase.id);
  const payload = await response.json() as ChatResponse;
  const raw = payload.choices?.[0]?.message?.content ?? "";
  let rawJsonValid = false;
  try { JSON.parse(raw); rawJsonValid = true; } catch { /* scored below */ }
  const result = parseDreamAgentContent(raw, evalCase.lang, stage, conversationContext);
  return {
    evaluation: evaluateDreamAgentResult(evalCase, result, rawJsonValid, "model"),
    artifact: {
      id: evalCase.id,
      tags: evalCase.tags,
      source: "model",
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
  const filteredCases = dreamAgentEvalCases
    .filter((evalCase) => !filter || evalCase.id.toLowerCase().includes(filter) || evalCase.tags.some((tag) => tag.toLowerCase().includes(filter)))
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : undefined);
  if (!filteredCases.length) throw new Error("No evaluation cases matched DREAM_AGENT_EVAL_FILTER.");
  const completed = [];
  for (let index = 0; index < filteredCases.length; index += concurrency) {
    const batch = filteredCases.slice(index, index + concurrency);
    const items = await Promise.all(batch.map(runCase));
    for (const item of items) {
      completed.push(item);
      const failed = item.evaluation.checks.filter((check) => !check.passed).map((check) => check.name);
      console.log(`${item.evaluation.passed ? "PASS" : "FAIL"} ${item.evaluation.id}${failed.length ? ` [${failed.join(", ")}]` : ""}`);
    }
    if (index + concurrency < filteredCases.length && batchDelayMs > 0) await wait(batchDelayMs);
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
  const outputPath = join(outputDir, `${timestamp}-${model.replace(/[^a-zA-Z0-9._-]/g, "_")}-${responseFormatName}.json`);
  await writeFile(outputPath, JSON.stringify({ model, responseFormat: responseFormatName, createdAt: new Date().toISOString(), summary, operations, cases: completed }, null, 2), "utf8");
  console.log(JSON.stringify({ ...summary, ...operations }, null, 2));
  console.log(`Detailed synthetic results: ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Agent evaluation failed.");
  process.exitCode = 1;
});
