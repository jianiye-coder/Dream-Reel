import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import {
  findUserIdForStripeCustomer,
  processStripeEvent,
  upsertStripeSubscription,
} from "@/lib/billing";

export const runtime = "nodejs";

type StripeObject = Record<string, unknown> & {
  id?: string;
  customer?: string;
  subscription?: string;
  status?: string;
  current_period_start?: number;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  client_reference_id?: string;
  metadata?: Record<string, string>;
};

type StripeEvent = {
  id: string;
  type: string;
  data?: { object?: StripeObject };
};

function parseSignatureHeader(header: string) {
  return header.split(",").reduce<Record<string, string[]>>((acc, part) => {
    const [key, value] = part.split("=");
    if (!key || !value) return acc;
    acc[key] = [...(acc[key] ?? []), value];
    return acc;
  }, {});
}

function verifyStripeSignature(payload: string, header: string | null, secret: string) {
  if (!header) return false;
  const parsed = parseSignatureHeader(header);
  const timestamp = parsed.t?.[0];
  const signatures = parsed.v1 ?? [];
  if (!timestamp || signatures.length === 0) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return signatures.some((signature) => {
    const actualBuffer = Buffer.from(signature, "hex");
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  });
}

function parseUserId(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unixToDate(value: unknown) {
  return typeof value === "number" ? new Date(value * 1000) : null;
}

async function handleCheckoutCompleted(object: StripeObject, client: PoolClient) {
  const userId = parseUserId(object.client_reference_id ?? object.metadata?.user_id);
  const subscriptionId = typeof object.subscription === "string" ? object.subscription : null;
  if (!userId || !subscriptionId) return;

  await upsertStripeSubscription({
    userId,
    customerId: typeof object.customer === "string" ? object.customer : null,
    subscriptionId,
    status: "active",
    plan: "plus",
  }, client);
}

async function handleSubscriptionChanged(object: StripeObject, client: PoolClient) {
  const subscriptionId = typeof object.id === "string" ? object.id : null;
  const customerId = typeof object.customer === "string" ? object.customer : null;
  if (!subscriptionId || !customerId) return;

  const metadataUserId = parseUserId(object.metadata?.user_id);
  const userId = metadataUserId
    ?? (await findUserIdForStripeCustomer(customerId, subscriptionId, client));
  if (!userId) return;

  await upsertStripeSubscription({
    userId,
    customerId,
    subscriptionId,
    status: object.status || "incomplete",
    plan: object.metadata?.plan === "plus" ? "plus" : "plus",
    currentPeriodStart: unixToDate(object.current_period_start),
    currentPeriodEnd: unixToDate(object.current_period_end),
    cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
  }, client);
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Missing STRIPE_WEBHOOK_SECRET" }, { status: 500 });
  }

  const rawBody = await request.text();
  if (!verifyStripeSignature(rawBody, request.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  const event = JSON.parse(rawBody) as StripeEvent;
  const result = await processStripeEvent(
    { id: event.id, type: event.type, payload: event },
    async (client) => {
      const object = event.data?.object;
      if (!object) return;

      if (event.type === "checkout.session.completed") {
        await handleCheckoutCompleted(object, client);
      }

      if (
        event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted"
      ) {
        await handleSubscriptionChanged(object, client);
      }
    },
  );

  if (result === "duplicate") {
    return NextResponse.json({ received: true, duplicate: true });
  }

  return NextResponse.json({ received: true });
}
