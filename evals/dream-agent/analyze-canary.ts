import { readFile } from "node:fs/promises";
import { analyzeDreamAgentCanary } from "./canaryGate";

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main() {
  const snapshotPath = process.argv[2];
  if (!snapshotPath) {
    throw new Error("Usage: npm run eval:agent:canary -- /path/to/admin-agent-feedback.json");
  }
  const input = JSON.parse(await readFile(snapshotPath, "utf8")) as unknown;
  const report = analyzeDreamAgentCanary(input, {
    minimumEligibleInteractions: positiveNumber(process.env.DREAM_AGENT_CANARY_MIN_ELIGIBLE, 50),
    maximumLatencyRegression: positiveNumber(process.env.DREAM_AGENT_CANARY_MAX_LATENCY_REGRESSION, 0.2),
    maximumSnapshotAgeHours: positiveNumber(process.env.DREAM_AGENT_CANARY_MAX_SNAPSHOT_AGE_HOURS, 2),
    maximumErrorRateIncrease: positiveNumber(process.env.DREAM_AGENT_CANARY_MAX_ERROR_RATE_INCREASE, 0.01),
    maximumFallbackRateIncrease: positiveNumber(process.env.DREAM_AGENT_CANARY_MAX_FALLBACK_RATE_INCREASE, 0.05),
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Canary analysis failed.");
  process.exitCode = 1;
});
