import { describe, expect, it } from "vitest";
import { shouldFlushLatestSave } from "@/lib/autosave";

describe("latest-state autosave", () => {
  it("flushes again when state changes during an in-flight request", () => {
    expect(shouldFlushLatestSave({
      pendingSave: true,
      pendingOptions: false,
      startedRevision: 4,
      currentRevision: 5,
    })).toBe(true);
  });

  it("flushes text-only edits even when no analysis or image options changed", () => {
    expect(shouldFlushLatestSave({
      pendingSave: false,
      pendingOptions: false,
      startedRevision: 7,
      currentRevision: 8,
    })).toBe(true);
  });

  it("does not create an endless save loop for an unchanged revision", () => {
    expect(shouldFlushLatestSave({
      pendingSave: false,
      pendingOptions: false,
      startedRevision: 9,
      currentRevision: 9,
    })).toBe(false);
  });
});
