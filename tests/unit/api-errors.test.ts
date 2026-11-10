import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { API_ERROR_CODES, getApiErrorMessage } from "@/lib/apiErrors";

const auth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth }));

import { POST as generateTitle } from "@/app/api/generate-title/route";

describe("getApiErrorMessage", () => {
  it("never has Chinese in the English copy of a code", () => {
    for (const code of Object.values(API_ERROR_CODES)) {
      expect(getApiErrorMessage(code, "en", "fallback"), code).not.toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it("turns the account page's codes into its copy", () => {
    expect(getApiErrorMessage("WRONG_PASSWORD", "zh", "更新失败")).toBe("当前密码不正确。");
    expect(getApiErrorMessage("WRONG_PASSWORD", "en", "Update failed")).toBe("The current password is incorrect.");
    expect(getApiErrorMessage("INVALID_NAME", "en", "Update failed")).toBe("Your name needs 1 to 100 characters.");
  });

  it("never shows a server sentence in English, or a non-string anywhere", () => {
    expect(getApiErrorMessage("当前密码不正确", "en", "Update failed")).toBe("Update failed");
    expect(getApiErrorMessage(undefined, "zh", "更新失败")).toBe("更新失败");
    expect(getApiErrorMessage({ message: "x" }, "zh", "更新失败")).toBe("更新失败");
  });
});

describe("POST /api/generate-title errors", () => {
  const original = process.env.OPENAI_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
    vi.unstubAllGlobals();
  });

  function post(body: string) {
    return generateTitle(new NextRequest("http://localhost/api/generate-title", { method: "POST", body }));
  }

  it("answers with codes, never configuration names", async () => {
    auth.mockResolvedValue({ user: { id: "7" } });
    delete process.env.OPENAI_API_KEY;
    const missing = await post(JSON.stringify({ text: "a dream" }));
    expect(missing.status).toBe(500);
    expect(await missing.json()).toEqual({ error: "CONFIGURATION_ERROR" });

    process.env.OPENAI_API_KEY = "test-key";
    const invalid = await post("not json");
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "INVALID_REQUEST" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));
    const upstream = await post(JSON.stringify({ text: "a dream" }));
    expect(upstream.status).toBe(502);
    expect(await upstream.json()).toEqual({ error: "UPSTREAM_ERROR" });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")));
    const failed = await post(JSON.stringify({ text: "a dream" }));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "INTERNAL_ERROR" });
  });
});
