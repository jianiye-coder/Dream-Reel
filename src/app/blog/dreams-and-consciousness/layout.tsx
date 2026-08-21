import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "梦与意识：弗洛伊德、荣格、普鲁斯特与阿德勒 | Dream Reel",
  description:
    "从心理分析、文学与现代睡眠科学理解梦如何连接欲望、记忆、意识与未来行动。",
};

export default function DreamsAndConsciousnessLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
