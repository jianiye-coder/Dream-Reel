import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal/LegalDoc";

export const metadata: Metadata = { title: "Refunds · 退款政策 — Dream Reel" };

// TODO(owner): the refund policy (7 days, full refund) is a draft; confirm it before going live.
export default function RefundPage() {
  return <LegalDoc doc="refund" />;
}
