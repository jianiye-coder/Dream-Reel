import type { Metadata } from "next";
import "./globals.css";
import { Outfit, Work_Sans } from "next/font/google";
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
      className={`h-full antialiased ${outfit.variable} ${workSans.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <SessionProvider>
          <LanguageProvider>{children}</LanguageProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
