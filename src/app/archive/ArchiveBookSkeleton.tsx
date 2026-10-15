"use client";

import { Book, BookPage } from "@/components/notebook/Book";
import { useLanguage } from "@/contexts/LanguageContext";
import s from "./archive.module.css";

/* The book, already open on the desk, while the archive's pages are still being fetched. */
export function ArchiveBookSkeleton() {
  const { T } = useLanguage();
  return (
    <main className={`nb-stage ${s.ar}`} id="main" aria-busy="true" aria-live="polite">
      <Book tilt={false}>
        <BookPage side="l" folio="p. 246">
          <span className="nb-kicker">{T.archive.eyebrow}</span>
          <p className={s.skeletonLine}>{T.archive.nb.loading}</p>
          <div className={s.skeletonRules} aria-hidden />
        </BookPage>
        <BookPage side="r" folio="p. 247">
          <div className={s.skeletonRules} aria-hidden />
        </BookPage>
      </Book>
    </main>
  );
}
