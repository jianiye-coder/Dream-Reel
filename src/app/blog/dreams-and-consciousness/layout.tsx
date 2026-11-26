import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dreams and consciousness: Freud, Jung, Proust and Adler | Dream Reel",
  description:
    "How psychoanalysis, literature and modern sleep science connect dreams to desire, memory, consciousness and what we do next.",
};

export default function DreamsAndConsciousnessLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
