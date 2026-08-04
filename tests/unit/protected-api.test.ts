import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const dreams = vi.hoisted(() => ({
  createDreamEntry: vi.fn(),
  deleteDreamEntry: vi.fn(),
  updateDreamEntry: vi.fn(),
  listDreamEntries: vi.fn(),
  dreamEntryInputSchema: { safeParse: vi.fn() },
  dreamEntryUpdateSchema: { safeParse: vi.fn() },
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/dreams", () => dreams);
vi.mock("@/lib/billing", () => ({
  checkAndConsumeUsage: vi.fn(),
  refundConsumedUsage: vi.fn(),
}));

import { POST } from "@/app/api/dreams/route";

describe("protected dream APIs", () => {
  it("rejects an anonymous write before parsing or database access", async () => {
    const response = await POST(new NextRequest("http://localhost/api/dreams", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    }));
    expect(response.status).toBe(401);
    expect(dreams.dreamEntryInputSchema.safeParse).not.toHaveBeenCalled();
    expect(dreams.createDreamEntry).not.toHaveBeenCalled();
  });
});
