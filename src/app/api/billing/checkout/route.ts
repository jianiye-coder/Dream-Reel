import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

export const runtime = "nodejs";

function parseUserId(id: string | undefined) {
  if (!id) return null;
  const value = Number(id);
  return Number.isFinite(value) ? value : null;
}

function getOrigin(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  const session = await auth() as { user?: { id?: string; email?: string | null } } | null;
  const userId = parseUserId(session?.user?.id);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "缺少 STRIPE_SECRET_KEY，暂时无法开启订阅。" }, { status: 500 });
  }

  const body = await request.json().catch(() => ({})) as { currency?: string; lang?: "zh" | "en" };
  const useCny = body.currency === "cny" || body.lang === "zh";
  const priceId = useCny
    ? process.env.STRIPE_PLUS_PRICE_ID_CNY
    : process.env.STRIPE_PLUS_PRICE_ID_USD;
  const fallbackPriceId = process.env.STRIPE_PLUS_PRICE_ID_USD || process.env.STRIPE_PLUS_PRICE_ID_CNY;

  if (!priceId && !fallbackPriceId) {
    return NextResponse.json(
      { error: "缺少 Stripe Plus price id，请配置 STRIPE_PLUS_PRICE_ID_USD 或 STRIPE_PLUS_PRICE_ID_CNY。" },
      { status: 500 },
    );
  }

  const origin = getOrigin(request);
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("line_items[0][price]", priceId || fallbackPriceId || "");
  params.set("line_items[0][quantity]", "1");
  params.set("success_url", `${origin}/journal?upgraded=1`);
  params.set("cancel_url", `${origin}/?billing=cancelled`);
  params.set("client_reference_id", String(userId));
  params.set("locale", body.lang === "en" ? "en" : "zh");
  params.set("automatic_payment_methods[enabled]", "true");
  params.set("metadata[user_id]", String(userId));
  params.set("metadata[plan]", "plus");
  params.set("subscription_data[metadata][user_id]", String(userId));
  params.set("subscription_data[metadata][plan]", "plus");
  if (session?.user?.email) {
    params.set("customer_email", session.user.email);
  }

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
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
      { error: payload.error?.message || "Stripe Checkout 创建失败。" },
      { status: 502 },
    );
  }

  return NextResponse.json({ url: payload.url });
}
