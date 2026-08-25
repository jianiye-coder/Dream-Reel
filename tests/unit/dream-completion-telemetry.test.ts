import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createDreamEntry: vi.fn(),
  updateDreamEntry: vi.fn(),
  inputSafeParse: vi.fn(),
  updateSafeParse: vi.fn(),
  checkAndConsumeUsage: vi.fn(),
  scheduleDreamAgentJournalSaved: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/dreams", () => ({
  createDreamEntry: mocks.createDreamEntry,
  deleteDreamEntry: vi.fn(),
  updateDreamEntry: mocks.updateDreamEntry,
  listDreamEntriesPage: vi.fn(),
  dreamEntryInputSchema: { safeParse: mocks.inputSafeParse },
  dreamEntryUpdateSchema: { safeParse: mocks.updateSafeParse },
}));
vi.mock("@/lib/billing", () => ({
  checkAndConsumeUsage: mocks.checkAndConsumeUsage,
  refundConsumedUsage: vi.fn(),
}));
vi.mock("@/lib/dreamAgentMetrics", () => ({
  scheduleDreamAgentJournalSaved: mocks.scheduleDreamAgentJournalSaved,
}));

import { POST, PUT } from "@/app/api/dreams/route";

const interactionId = "d679a3e1-470c-4936-8969-26c73713fe44";

describe("dream journal completion telemetry", () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ user: { id: "7" } });
    mocks.checkAndConsumeUsage.mockResolvedValue({ allowed: true, usagePeriodId: 3 });
    mocks.scheduleDreamAgentJournalSaved.mockReset();
  });

  it("links a newly saved entry to the latest owned agent interaction", async () => {
    const data = { agentInteractionId: interactionId, inputMode: "text", rawText: "encrypted elsewhere" };
    mocks.inputSafeParse.mockReturnValue({ success: true, data });
    mocks.createDreamEntry.mockResolvedValue({ id: 42 });
    const response = await POST(new NextRequest("http://localhost/api/dreams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }));
    expect(response.status).toBe(201);
    expect(mocks.scheduleDreamAgentJournalSaved).toHaveBeenCalledWith(7, interactionId, 42);
  });

  it("links a later autosave update when the first save preceded the agent reply", async () => {
    const data = { id: 42, agentInteractionId: interactionId, inputMode: "text", rawText: "encrypted elsewhere" };
    mocks.updateSafeParse.mockReturnValue({ success: true, data });
    mocks.updateDreamEntry.mockResolvedValue({ id: 42 });
    const response = await PUT(new NextRequest("http://localhost/api/dreams", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }));
    expect(response.status).toBe(200);
    expect(mocks.scheduleDreamAgentJournalSaved).toHaveBeenCalledWith(7, interactionId, 42);
  });
});
