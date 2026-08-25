import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import { evalRequestTimeoutMs, evalRetryDelayMs, isRetryableEvalRequest } from "./retryPolicy";

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

const provider = process.env.DREAM_AGENT_EVAL_PROVIDER === "groq" ? "groq" : "openai";
const apiKey = provider === "groq" ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;
const endpoint = provider === "groq"
  ? "https://api.groq.com/openai/v1/chat/completions"
  : "https://api.openai.com/v1/chat/completions";
const model = process.env.DREAM_AGENT_EVAL_MODEL
  ?? (provider === "groq" ? process.env.GROQ_MODEL ?? "openai/gpt-oss-120b" : process.env.OPENAI_MODEL ?? "gpt-5.5");
const outputDir = process.env.DREAM_AGENT_EVAL_OUTPUT_DIR ?? join(tmpdir(), "dream-reel-agent-evals");
const responseFormatName = process.env.DREAM_AGENT_EVAL_RESPONSE_FORMAT === "json_schema" ? "json_schema" : "json_object";
const filter = process.env.DREAM_AGENT_EVAL_FILTER?.trim().toLowerCase();
const selectedCaseIds = new Set((process.env.DREAM_AGENT_EVAL_CASE_IDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean));
const evaluationLabel = process.env.DREAM_AGENT_EVAL_LABEL?.trim();
const resumeFrom = process.env.DREAM_AGENT_EVAL_RESUME_FROM?.trim();
const limit = Number.parseInt(process.env.DREAM_AGENT_EVAL_LIMIT ?? "", 10);
const concurrency = Math.max(1, Math.min(5, Number.parseInt(process.env.DREAM_AGENT_EVAL_CONCURRENCY ?? "2", 10) || 2));
const batchDelayMs = Math.max(0, Math.min(10_000, Number.parseInt(process.env.DREAM_AGENT_EVAL_BATCH_DELAY_MS ?? "500", 10) || 0));
const requestTimeoutMs = evalRequestTimeoutMs(process.env.DREAM_AGENT_EVAL_REQUEST_TIMEOUT_MS);

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestCompletion(body: unknown, caseId: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      if (!timedOut || attempt === 4) {
        throw new Error(`${caseId}: ${timedOut ? `request timed out after ${requestTimeoutMs}ms` : "network request failed"}`, { cause: error });
      }
      await wait(evalRetryDelayMs(attempt));
      continue;
    }
    if (response.ok) return response;
    const payload = await response.clone().json().catch(() => null) as { error?: { code?: string; type?: string; message?: string } } | null;
    const reason = payload?.error?.code ?? payload?.error?.type;
    const retryable = isRetryableEvalRequest(response.status, reason);
    if (!retryable || attempt === 4) {
      const retryAfter = response.headers.get("retry-after");
      throw new Error(`${caseId}: upstream returned ${response.status} (${reason ?? "unknown"})${retryAfter ? `; retry-after=${retryAfter}` : ""}${payload?.error?.message ? `; ${payload.error.message}` : ""}`);
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
    max_completion_tokens: provider === "groq" ? 1600 : 800,
    reasoning_effort: provider === "groq" && model.startsWith("openai/gpt-oss-") ? "low" : undefined,
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
      rawOutput: raw,
      result,
    },
  };
}

type CompletedCase = Awaited<ReturnType<typeof runCase>>;

interface StoredEvalArtifact {
  provider: typeof provider;
  model: string;
  label?: string;
  responseFormat: string;
  createdAt: string;
  complete: boolean;
  expectedCases: number;
  caseIds: string[];
  summary: ReturnType<typeof summarizeEvalResults>;
  operations: {
    averageLatencyMs: number;
    p95LatencyMs: number;
    averageTotalTokens: number | null;
  };
  cases: CompletedCase[];
}

function buildStoredArtifact(
  completed: CompletedCase[],
  caseIds: string[],
  createdAt: string,
  complete: boolean,
): StoredEvalArtifact {
  const summary = summarizeEvalResults(completed.map((item) => item.evaluation));
  const latencies = completed.map((item) => item.artifact.latencyMs).sort((a, b) => a - b);
  const totalTokens = completed.map((item) => item.artifact.tokens.total).filter((value): value is number => value !== null);
  const operations = {
    averageLatencyMs: latencies.length
      ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
      : 0,
    p95LatencyMs: latencies.length
      ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]
      : 0,
    averageTotalTokens: totalTokens.length
      ? Math.round(totalTokens.reduce((sum, value) => sum + value, 0) / totalTokens.length)
      : null,
  };
  return {
    provider,
    model,
    label: evaluationLabel,
    responseFormat: responseFormatName,
    createdAt,
    complete,
    expectedCases: caseIds.length,
    caseIds,
    summary,
    operations,
    cases: completed,
  };
}

function validateResumeArtifact(stored: StoredEvalArtifact, caseIds: string[]) {
  if (stored.complete) throw new Error("The requested resume artifact is already complete.");
  if (stored.provider !== provider || stored.model !== model || stored.responseFormat !== responseFormatName) {
    throw new Error("Resume artifact provider, model, or response format does not match this run.");
  }
  if ((stored.label ?? "") !== (evaluationLabel ?? "")) {
    throw new Error("Resume artifact label does not match this run.");
  }
  if (stored.caseIds.length !== caseIds.length || stored.caseIds.some((id, index) => id !== caseIds[index])) {
    throw new Error("Resume artifact case selection does not match this run.");
  }
  const completedIds = stored.cases.map((item) => item.artifact.id);
  if (new Set(completedIds).size !== completedIds.length || completedIds.some((id) => !caseIds.includes(id))) {
    throw new Error("Resume artifact contains duplicate or unexpected case IDs.");
  }
}

async function main() {
  if (!apiKey) throw new Error(`${provider === "groq" ? "GROQ_API_KEY" : "OPENAI_API_KEY"} is required to run the agent evaluation.`);
  await mkdir(outputDir, { recursive: true });
  const filteredCases = dreamAgentEvalCases
    .filter((evalCase) => !selectedCaseIds.size || selectedCaseIds.has(evalCase.id))
    .filter((evalCase) => !filter || evalCase.id.toLowerCase().includes(filter) || evalCase.tags.some((tag) => tag.toLowerCase().includes(filter)))
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : undefined);
  if (!filteredCases.length) throw new Error("No evaluation cases matched DREAM_AGENT_EVAL_FILTER.");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const generatedCheckpointPath = join(outputDir, `${timestamp}-${model.replace(/[^a-zA-Z0-9._-]/g, "_")}-${responseFormatName}.in-progress.json`);
  const checkpointPath = resumeFrom ?? generatedCheckpointPath;
  const outputPath = checkpointPath.endsWith(".in-progress.json")
    ? checkpointPath.replace(/\.in-progress\.json$/, ".json")
    : `${checkpointPath}.complete.json`;
  const caseIds = filteredCases.map((evalCase) => evalCase.id);
  let createdAt = new Date().toISOString();
  let completed: CompletedCase[] = [];
  if (resumeFrom) {
    const stored = JSON.parse(await readFile(resumeFrom, "utf8")) as StoredEvalArtifact;
    validateResumeArtifact(stored, caseIds);
    completed = stored.cases;
    createdAt = stored.createdAt;
  }
  await writeFile(checkpointPath, JSON.stringify(buildStoredArtifact(completed, caseIds, createdAt, false), null, 2), "utf8");
  console.log(`Evaluation checkpoint: ${checkpointPath}`);

  const completedIds = new Set(completed.map((item) => item.artifact.id));
  const remainingCases = filteredCases.filter((evalCase) => !completedIds.has(evalCase.id));
  for (let index = 0; index < remainingCases.length; index += concurrency) {
    const batch = remainingCases.slice(index, index + concurrency);
    const settled = await Promise.allSettled(batch.map(runCase));
    const failures: unknown[] = [];
    for (const result of settled) {
      if (result.status === "rejected") {
        failures.push(result.reason);
        continue;
      }
      const item = result.value;
      completed.push(item);
      const failed = item.evaluation.checks.filter((check) => !check.passed).map((check) => check.name);
      console.log(`${item.evaluation.passed ? "PASS" : "FAIL"} ${item.evaluation.id}${failed.length ? ` [${failed.join(", ")}]` : ""}`);
    }
    await writeFile(checkpointPath, JSON.stringify(buildStoredArtifact(completed, caseIds, createdAt, false), null, 2), "utf8");
    if (failures.length) throw failures[0];
    if (index + concurrency < remainingCases.length && batchDelayMs > 0) await wait(batchDelayMs);
  }

  const finalArtifact = buildStoredArtifact(completed, caseIds, createdAt, true);
  await writeFile(outputPath, JSON.stringify(finalArtifact, null, 2), "utf8");
  console.log(JSON.stringify({ ...finalArtifact.summary, ...finalArtifact.operations }, null, 2));
  console.log(`Detailed synthetic results: ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Agent evaluation failed.");
  process.exitCode = 1;
});
