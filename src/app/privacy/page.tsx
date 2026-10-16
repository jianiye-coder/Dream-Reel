import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal/LegalDoc";

export const metadata: Metadata = { title: "Privacy · 隐私政策 — Dream Reel" };

export default function PrivacyPage() {
  return <LegalDoc doc="privacy" />;
}
