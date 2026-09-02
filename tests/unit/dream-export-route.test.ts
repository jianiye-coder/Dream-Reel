import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const dreams = vi.hoisted(() => ({
  listDreamEntries: vi.fn(),
}));
const auth = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/dreams", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/dreams")>();
  return { ...original, listDreamEntries: dreams.listDreamEntries };
});

import { GET } from "@/app/api/dreams/export/route";

describe("GET /api/dreams/export", () => {
  beforeEach(() => {
    auth.mockResolvedValue({ user: { id: "42" } });
    dreams.listDreamEntries.mockResolvedValue([]);
  });

  it("requires authentication", async () => {
    auth.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/dreams/export"));

    expect(response.status).toBe(401);
    expect(dreams.listDreamEntries).not.toHaveBeenCalled();
  });

  it("exports only the authenticated user's archive as a private download", async () => {
    const response = await GET(new NextRequest(
      "http://localhost/api/dreams/export?format=json&lang=en",
    ));

    expect(response.status).toBe(200);
    expect(dreams.listDreamEntries).toHaveBeenCalledWith(42, 10_000);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="dream-reel-export-/);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("X-Dream-Count")).toBe("0");
    await expect(response.json()).resolves.toMatchObject({ schemaVersion: 1, dreamCount: 0 });
  });

  it("rejects unsupported export formats", async () => {
    const response = await GET(new NextRequest(
      "http://localhost/api/dreams/export?format=pdf",
    ));

    expect(response.status).toBe(400);
    expect(dreams.listDreamEntries).not.toHaveBeenCalled();
  });
});
