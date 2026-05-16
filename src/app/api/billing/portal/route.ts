import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getStripeCustomerId } from "@/lib/billing";

export const runtime = "nodejs";

function parseUserId(id: string | undefined) {
  if (!id) return null;
  const value = Number(id);
  return Number.isFinite(value) ? value : null;
}

export async function POST(request: NextRequest) {
  const session = await auth() as { user?: { id?: string } } | null;
  const userId = parseUserId(session?.user?.id);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "缺少 STRIPE_SECRET_KEY。" }, { status: 500 });
  }

  const customerId = await getStripeCustomerId(userId);
  if (!customerId) {
    return NextResponse.json({ error: "还没有可管理的订阅。" }, { status: 400 });
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const params = new URLSearchParams();
  params.set("customer", customerId);
  params.set("return_url", `${origin}/archive`);

  const stripeResponse = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const payload = (await stripeResponse.json()) as { url?: string; error?: { message?: string } };
  if (!stripeResponse.ok || !payload.url) {
    return NextResponse.json(
      { error: payload.error?.message || "Stripe Portal 创建失败。" },
      { status: 502 },
    );
  }

  return NextResponse.json({ url: payload.url });
}
