"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { LangToggle } from "@/components/LangToggle";
import { TurnLink } from "@/components/notebook/TurnLink";
import { useLanguage } from "@/contexts/LanguageContext";
import { onSoundChange, setSoundEnabled, soundEnabled, tap, unlock } from "@/lib/notebookSound";

// pages that live inside the book; links between them turn a page instead of fading
const BOOK_ROUTES = new Set(["/", "/journal", "/archive", "/morning-pages"]);

/* The page around everything: desk (book pages) or paper (flat pages), a top bar that folds
   into a table of contents on phones, and the pencil-sound switch. `lean` zooms the fixed-size
   book to fill the window on working pages. */
export function NotebookShell({ surface = "desk", lean = false, children }: {
  surface?: "desk" | "paper";
  lean?: boolean;
  children: React.ReactNode;
}) {
  const { T } = useLanguage();
  const N = T.nb;
  const pathname = usePathname();
  const { status } = useSession();
  const [sound, setSound] = useState(true);
  const [contents, setContents] = useState(false);

  useEffect(() => {
    setSound(soundEnabled());
    const off = onSoundChange(setSound);
    // the first gesture anywhere unlocks audio
    const first = () => unlock();
    addEventListener("pointerdown", first, { once: true });
    addEventListener("keydown", first, { once: true });
    return () => { off(); removeEventListener("pointerdown", first); removeEventListener("keydown", first); };
  }, []);

  useEffect(() => {
    if (!lean) return;
    const fit = () => {
      const root = document.documentElement;
      if (matchMedia("(max-width: 900px)").matches) { root.style.setProperty("--lean", "1"); return; }
      const top = document.querySelector<HTMLElement>(".nb-topbar")?.offsetHeight ?? 60;
      const z = Math.min((innerWidth * 0.95) / 1021, (innerHeight - top - 84) / 704, 1.75);
      root.style.setProperty("--lean", Math.max(0.8, z).toFixed(3));
    };
    fit();
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, [lean]);

  const links = [
    { href: "/journal", label: N.journal },
    { href: "/morning-pages", label: N.morningPages },
    { href: "/archive", label: N.archive },
    { href: "/blog/dreams-and-consciousness", label: N.blog },
    status === "authenticated" ? { href: "/account", label: N.account } : { href: "/pricing", label: N.pricing },
    ...(status === "authenticated" ? [] : [{ href: "/login", label: N.login }]),
  ];
  const linkFor = (href: string, label: string, className?: string) => {
    const on = pathname === href ? "nb-on" : undefined;
    const cls = [className, on].filter(Boolean).join(" ") || undefined;
    return BOOK_ROUTES.has(href) && BOOK_ROUTES.has(pathname)
      ? <TurnLink key={href} href={href} className={cls}>{label}</TurnLink>
      : <Link key={href} href={href} className={cls}>{label}</Link>;
  };

  return (
    <div className={`nb-root${surface === "paper" ? " nb-paper" : ""}${lean ? " nb-lean" : ""}`}>
      <header className="nb-topbar">
        {linkFor("/", "Dream Reel", "nb-brand")}
        <nav className="nb-nav" aria-label={N.mainNav}>
          {links.map((l) => linkFor(l.href, l.label))}
          <LangToggle />
        </nav>
        <button type="button" className="nb-toc-btn" aria-expanded={contents} onClick={() => { setContents(true); tap(); }}>
          <i aria-hidden />{N.contents}
        </button>
      </header>

      <div className={`nb-toc${contents ? " nb-on" : ""}`} role="dialog" aria-modal="true" aria-label={N.contents} inert={!contents}>
        <div className="nb-toc-head">
          <span className="nb-brand">Dream Reel</span>
          <button type="button" onClick={() => setContents(false)}>{N.closeContents} ×</button>
        </div>
        <ol>
          {[{ href: "/", label: N.home }, ...links].map((l, i) => (
            <li key={l.href}>
              <Link href={l.href} className={pathname === l.href ? "nb-on" : undefined} onClick={() => setContents(false)}>
                {l.label}<span className="nb-lead" /><span className="nb-pg">{["i", "12", "28", "36", "88", "120", "200"][i]}</span>
              </Link>
            </li>
          ))}
        </ol>
        <div className="nb-toc-foot">
          <span className="nb-kicker">{N.tagline}</span>
          <LangToggle />
          <button type="button" onClick={() => setSoundEnabled(!sound)}>{sound ? N.soundOn : N.soundOff}</button>
        </div>
      </div>

      {children}

      <button type="button" className={`nb-sound${sound ? " nb-on" : ""}`} aria-pressed={sound} onClick={() => setSoundEnabled(!sound)}>
        <i aria-hidden><b /><b /><b /></i><span>{sound ? N.soundOn : N.soundOff}</span>
      </button>
    </div>
  );
}
