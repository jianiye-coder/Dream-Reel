import type { Metadata } from "next";
import "./globals.css";
import "./notebook.css";
import "lxgw-wenkai-webfont/lxgwwenkai-regular.css";
import { IBM_Plex_Mono, Instrument_Serif, Noto_Serif, Noto_Serif_SC, Outfit, Pinyon_Script, Work_Sans } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { LanguageProvider } from "@/contexts/LanguageContext";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-serif",
  display: "swap",
});

const workSans = Work_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sub",
  display: "swap",
});

// notebook design: self-hosted at build time (the CSP only allows same-origin fonts)
const nbSerif = Noto_Serif_SC({ weight: ["400", "600", "900"], variable: "--font-nb-serif", display: "swap", preload: false });
// English pages put a Latin serif first so apostrophes and dashes aren't set full-width by the CJK face
const nbSerifLatin = Noto_Serif({ weight: ["400", "600", "900"], subsets: ["latin"], variable: "--font-nb-serif-latin", display: "swap" });
const nbLatin = Instrument_Serif({ weight: "400", style: ["normal", "italic"], subsets: ["latin"], variable: "--font-nb-latin", display: "swap" });
const nbMono = IBM_Plex_Mono({ weight: ["400", "500"], subsets: ["latin"], variable: "--font-nb-mono", display: "swap" });
const nbScript = Pinyon_Script({ weight: "400", subsets: ["latin"], variable: "--font-nb-script", display: "swap" });

export const metadata: Metadata = {
  title: "Dream Reel — Dream Journal · 梦境日记",
  description:
    "AI-powered dream journaling, image generation, and sleep pattern analysis. / AI 梦境记录、图像生成与睡眠洞察。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`h-full antialiased ${outfit.variable} ${workSans.variable} ${nbSerif.variable} ${nbSerifLatin.variable} ${nbLatin.variable} ${nbMono.variable} ${nbScript.variable}`}
      suppressHydrationWarning
    >
      <head>
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="min-h-full flex flex-col">
        <a className="skip-link" href="#main-content">跳至主要内容</a>
        <SessionProvider>
          <LanguageProvider><div id="main-content" tabIndex={-1}>{children}</div></LanguageProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
