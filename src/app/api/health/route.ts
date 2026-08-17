import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { hasDedicatedDreamEncryptionKey } from "@/lib/dreamTextEncryption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    await getPool().query("SELECT 1");
    const dedicatedEncryptionKey = hasDedicatedDreamEncryptionKey();
    return NextResponse.json(
      {
        status: dedicatedEncryptionKey ? "ok" : "degraded",
        database: "reachable",
        encryption: dedicatedEncryptionKey ? "dedicated" : "transition",
        latencyMs: Date.now() - startedAt,
      },
      {
        status: dedicatedEncryptionKey ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    console.error("GET /api/health database check failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      code: typeof error === "object" && error && "code" in error ? String(error.code) : undefined,
    });
    return NextResponse.json(
      { status: "degraded", database: "unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
