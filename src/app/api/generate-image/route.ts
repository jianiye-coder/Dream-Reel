import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { checkAndConsumeUsage, refundConsumedUsage } from "@/lib/billing";
import { API_ERROR_CODES } from "@/lib/apiErrors";
import { put } from "@vercel/blob";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { safeErrorMetadata } from "@/lib/safeServerLog";

export const runtime = "nodejs";
export const maxDuration = 180;

const OPENAI_IMAGE_MODEL = "gpt-image-2";
const OPENAI_IMAGE_TIMEOUT_MS = 170_000;

const payloadSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  size: z.enum(["1024x1024", "1024x1536", "1536x1024"]).optional(),
  visualBrief: z.string().trim().max(3000).optional().nullable(),
  dreamText: z.string().trim().max(4000).optional().nullable(),
  genderContext: z.string().trim().max(500).optional().nullable(),
});

function buildFinalImagePrompt(
  prompt: string,
  visualBrief?: string | null,
  dreamText?: string | null,
  genderContext?: string | null,
) {
  const brief = visualBrief?.trim();
  const rawText = dreamText?.trim();
  const gender = genderContext?.trim();

  const prefix = [
    rawText ? `原始梦境描述：${rawText}` : "",
    gender ? `性别信息：${gender}` : "",
  ].filter(Boolean).join("\n");

  // Comprehensive visualBrief (>200 chars) is the full image prompt — use directly
  if (brief && brief.length > 200) {
    return prefix ? `${prefix}\n\n${brief}` : brief;
  }

  // Short brief or none — use the user's prompt as-is with minimal additions
  const parts = [
    prefix,
    brief ? `${prompt.trim()}\n\nVisual style: ${brief}` : prompt.trim(),
    "Avoid text, captions, logos, watermarks, poster borders, or typography.",
  ].filter(Boolean);
  return parts.join("\n");
}

export async function POST(request: NextRequest) {
  const session = await auth() as { user?: { id?: string } } | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: API_ERROR_CODES.unauthorized }, { status: 401 });
  }

  const userId = Number(session.user.id);
  let consumedUsagePeriodId: number | undefined;

  async function refundImageUsageOnce() {
    if (!consumedUsagePeriodId) return;
    const usagePeriodId = consumedUsagePeriodId;
    consumedUsagePeriodId = undefined;
    await refundConsumedUsage(usagePeriodId, "image_generations");
  }

  try {
    const parsed = payloadSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: API_ERROR_CODES.invalidRequest }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: API_ERROR_CODES.configurationError },
        { status: 500 },
      );
    }
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: API_ERROR_CODES.configurationError },
        { status: 503 },
      );
    }

    const usage = await checkAndConsumeUsage(userId, "image_generations");
    if (!usage.allowed) {
      return NextResponse.json(
        { error: API_ERROR_CODES.quotaExceeded, billingStatus: usage.status },
        { status: 402 },
      );
    }
    consumedUsagePeriodId = usage.usagePeriodId;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_IMAGE_TIMEOUT_MS);

    let upstreamResponse: Response;

    try {
      upstreamResponse = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: OPENAI_IMAGE_MODEL,
          prompt: buildFinalImagePrompt(parsed.data.prompt, parsed.data.visualBrief, parsed.data.dreamText, parsed.data.genderContext),
          size: parsed.data.size ?? "1024x1024",
          quality: "medium",
          n: 1,
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    const payload = (await upstreamResponse.json()) as {
      data?: Array<{ b64_json?: string }>;
      error?: { message?: string };
    };

    if (!upstreamResponse.ok) {
      await refundImageUsageOnce();
      return NextResponse.json(
        { error: API_ERROR_CODES.upstreamError },
        { status: 502 },
      );
    }

    const b64 = payload.data?.[0]?.b64_json;
    if (!b64) {
      await refundImageUsageOnce();
      return NextResponse.json({ error: API_ERROR_CODES.invalidResponse }, { status: 422 });
    }

    const imageId = randomUUID();
    const imageBuffer = Buffer.from(b64, "base64");
    const thumbnailBuffer = await sharp(imageBuffer)
      .resize({ width: 480, height: 480, fit: "cover", withoutEnlargement: true })
      .webp({ quality: 76 })
      .toBuffer();
    const [imageBlob] = await Promise.all([
      put(`dream-images/${imageId}.png`, imageBuffer, {
        access: "public",
        addRandomSuffix: false,
        contentType: "image/png",
      }),
      put(`dream-images/${imageId}-thumb.webp`, thumbnailBuffer, {
        access: "public",
        addRandomSuffix: false,
        contentType: "image/webp",
      }),
    ]);

    return NextResponse.json({
      imageUrl: imageBlob.url,
      revisedPrompt: null,
    });
  } catch (error) {
    console.error("POST /api/generate-image failed", safeErrorMetadata(error));
    await refundImageUsageOnce();
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: API_ERROR_CODES.timeout }, { status: 504 });
    }

    return NextResponse.json({ error: API_ERROR_CODES.internalError }, { status: 500 });
  }
}
