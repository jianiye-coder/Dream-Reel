import type { Metadata } from "next";
import "./globals.css";
import "./notebook.css";
// Fonts ship from node_modules (Fontsource and lxgw-wenkai-webfont): woff2 sliced by unicode-range and
// served from our own origin (the CSP only allows same-origin fonts), so the build never downloads a
// font. fonts.css names the families for the --font-* variables notebook.css reads.
import "@fontsource-variable/noto-serif-sc/wght.css"; // --font-nb-serif: 400/600/900 from one variable file per slice
import "@fontsource-variable/noto-serif/wght.css"; // --font-nb-serif-latin: English pages, so apostrophes and dashes aren't set full-width by the CJK face
import "@fontsource/instrument-serif/400.css"; // --font-nb-latin
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource/ibm-plex-mono/400.css"; // --font-nb-mono
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/pinyon-script/400.css"; // --font-nb-script
import "@fontsource/work-sans/700.css"; // --font-sub: outside .nb-root only the bold skip link uses it
import "lxgw-wenkai-webfont/lxgwwenkai-regular.css"; // --hand
import "./fonts.css";
import { SessionProvider } from "next-auth/react";
import { LanguageProvider } from "@/contexts/LanguageContext";

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
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body>
        <a className="skip-link" href="#main-content">跳至主要内容</a>
        <SessionProvider>
          <LanguageProvider><div id="main-content" tabIndex={-1}>{children}</div></LanguageProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
