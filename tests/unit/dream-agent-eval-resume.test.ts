import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const runner = join(process.cwd(), "node_modules", ".bin", "tsx");
const runnerArgs = [join(process.cwd(), "evals", "dream-agent", "run.ts")];

describe("dream agent live-eval resume", () => {
  it("keeps checkpoints ineligible, skips completed cases, and fails closed on drift", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "dream-agent-eval-resume-"));
    const env = {
      ...process.env,
      OPENAI_API_KEY: "deterministic-test-only",
      DREAM_AGENT_EVAL_PROVIDER: "openai",
      DREAM_AGENT_EVAL_MODEL: "resume-test-model",
      DREAM_AGENT_EVAL_CASE_IDS: "zh-privacy-control",
      DREAM_AGENT_EVAL_OUTPUT_DIR: outputDir,
      DREAM_AGENT_EVAL_LABEL: "resume-test",
      DREAM_AGENT_EVAL_CONCURRENCY: "1",
      DREAM_AGENT_EVAL_BATCH_DELAY_MS: "0",
    };

    await execFileAsync(runner, runnerArgs, { env });
    const files = await readdir(outputDir);
    const checkpointName = files.find((file) => file.endsWith(".in-progress.json"));
    const finalName = files.find((file) => file.endsWith(".json") && !file.endsWith(".in-progress.json"));
    expect(checkpointName).toBeTruthy();
    expect(finalName).toBeTruthy();

    const checkpointPath = join(outputDir, checkpointName!);
    const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
    const final = JSON.parse(await readFile(join(outputDir, finalName!), "utf8"));
    expect(checkpoint).toMatchObject({ complete: false, expectedCases: 1 });
    expect(checkpoint.cases).toHaveLength(1);
    expect(final).toMatchObject({ complete: true, expectedCases: 1 });
    expect(final.cases).toHaveLength(1);

    const resumed = await execFileAsync(runner, runnerArgs, {
      env: { ...env, DREAM_AGENT_EVAL_RESUME_FROM: checkpointPath },
    });
    expect(resumed.stdout).not.toContain("PASS zh-privacy-control");

    await expect(execFileAsync(runner, runnerArgs, {
      env: {
        ...env,
        DREAM_AGENT_EVAL_LABEL: "drifted-label",
        DREAM_AGENT_EVAL_RESUME_FROM: checkpointPath,
      },
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("Resume artifact label does not match this run."),
    });
  });
});
