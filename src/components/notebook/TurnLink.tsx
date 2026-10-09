"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { flipPage } from "@/lib/notebookFlip";
import { unlock } from "@/lib/notebookSound";

/** Navigate by turning the current right-hand page; falls back to a plain push off-book or on phones. */
export function useTurnTo() {
  const router = useRouter();
  return useCallback((href: string) => {
    const book = document.querySelector<HTMLElement>(".nb-book:not(.nb-closed)");
    if (!book || matchMedia("(max-width: 900px)").matches) { router.push(href); return; }
    unlock();
    router.prefetch(href);
    flipPage(book, { dur: 760, onEnd: () => router.push(href) });
  }, [router]);
}

export function TurnLink({ href, className, children, ...rest }: React.ComponentProps<typeof Link> & { href: string }) {
  const turnTo = useTurnTo();
  return (
    <Link
      href={href}
      className={className}
      {...rest}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        turnTo(href);
      }}
    >
      {children}
    </Link>
  );
}
