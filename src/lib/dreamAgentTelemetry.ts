import { createHmac, timingSafeEqual } from "node:crypto";
import type { DreamAgentResult } from "./dreamFollowUpAgent";

export type DreamAgentVariant = "deterministic-v1" | "json-object-v1" | "json-schema-v1";
export type DreamAgentProvider = "deterministic" | "openai" | "groq";
export type DreamAgentPolicyVariant = "legacy-v1" | "guarded-v2";

export interface DreamAgentResponseMeta {
  interactionId: string;
  variant: DreamAgentVariant;
  policyVariant: DreamAgentPolicyVariant;
  source: "deterministic" | "model";
  provider: DreamAgentProvider;
  latencyMs: number;
  feedbackToken?: string;
}

interface FeedbackTokenPayload {
  interactionId: string;
  variant: DreamAgentVariant;
  policyVariant: DreamAgentPolicyVariant;
  expiresAt: number;
  userBinding: string;
}

function feedbackSecret() {
  return process.env.DREAM_AGENT_FEEDBACK_SECRET ?? process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
}

export function createDreamAgentResponseMeta(
  variant: DreamAgentVariant,
  source: DreamAgentResponseMeta["source"],
  latencyMs: number,
  userId: number,
  provider: DreamAgentProvider = source === "deterministic" ? "deterministic" : "openai",
  policyVariant: DreamAgentPolicyVariant = "legacy-v1",
): DreamAgentResponseMeta {
  const interactionId = crypto.randomUUID();
  const secret = feedbackSecret();
  let feedbackToken: string | undefined;
  if (secret) {
    const payload = Buffer.from(JSON.stringify({
      interactionId,
      variant,
      policyVariant,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      userBinding: createHmac("sha256", secret).update(`user:${userId}`).digest("base64url"),
    } satisfies FeedbackTokenPayload)).toString("base64url");
    const signature = createHmac("sha256", secret).update(payload).digest("base64url");
    feedbackToken = `${payload}.${signature}`;
  }
  return { interactionId, variant, policyVariant, source, provider, latencyMs, feedbackToken };
}

export function verifyDreamAgentFeedbackToken(token: string, userId: number): FeedbackTokenPayload | null {
  const secret = feedbackSecret();
  const [payload, suppliedSignature, ...extra] = token.split(".");
  if (!secret || !payload || !suppliedSignature || extra.length) return null;
  const expectedSignature = createHmac("sha256", secret).update(payload).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(suppliedSignature, "base64url"); } catch { return null; }
  if (supplied.length !== expectedSignature.length || !timingSafeEqual(supplied, expectedSignature)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<FeedbackTokenPayload>;
    if (typeof parsed.interactionId !== "string" || !/^[0-9a-f-]{36}$/i.test(parsed.interactionId)) return null;
    if (!(["deterministic-v1", "json-object-v1", "json-schema-v1"] as const).includes(parsed.variant as DreamAgentVariant)) return null;
    const policyVariant = parsed.policyVariant ?? "legacy-v1";
    if (!(["legacy-v1", "guarded-v2"] as const).includes(policyVariant as DreamAgentPolicyVariant)) return null;
    if (typeof parsed.expiresAt !== "number" || parsed.expiresAt < Date.now()) return null;
    const expectedBinding = createHmac("sha256", secret).update(`user:${userId}`).digest("base64url");
    if (parsed.userBinding !== expectedBinding) return null;
    return { ...parsed, policyVariant } as FeedbackTokenPayload;
  } catch {
    return null;
  }
}

export function selectDreamAgentModelVariant(userId: number, percentageValue?: string) {
  const parsed = Number.parseFloat(percentageValue ?? "0");
  const percentage = Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
  const bucket = ((userId * 2_654_435_761) >>> 0) % 100;
  return bucket < percentage ? "json-schema-v1" as const : "json-object-v1" as const;
}

export function selectDreamAgentPolicyVariant(userId: number, percentageValue?: string) {
  const parsed = Number.parseFloat(percentageValue ?? "0");
  const percentage = Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
  const bucket = (Math.imul(userId ^ 0x5bd1e995, 2_654_435_761) >>> 0) % 100;
  return bucket < percentage ? "guarded-v2" as const : "legacy-v1" as const;
}

export function logDreamAgentCompletion(
  result: DreamAgentResult,
  meta: DreamAgentResponseMeta,
  usage?: { promptTokens?: number; completionTokens?: number },
) {
  console.info("dream_agent_completed", {
    interactionId: meta.interactionId,
    variant: meta.variant,
    policyVariant: meta.policyVariant,
    source: meta.source,
    provider: meta.provider,
    stage: result.stage,
    nextAction: result.nextAction,
    questionCount: result.questions.length,
    latencyMs: meta.latencyMs,
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
  });
}
