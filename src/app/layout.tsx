import type { Metadata } from "next";
import "./globals.css";
import { Cormorant_Garamond, Courier_Prime, Pinyon_Script } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { LanguageProvider } from "@/contexts/LanguageContext";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

const pinyonScript = Pinyon_Script({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-display",
  display: "swap",
});

const courierPrime = Courier_Prime({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
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
      className={`h-full antialiased ${cormorant.variable} ${courierPrime.variable} ${pinyonScript.variable}`}
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
