import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal/LegalDoc";

export const metadata: Metadata = { title: "Terms · 服务条款 — Dream Reel" };

export default function TermsPage() {
  return <LegalDoc doc="terms" />;
}
