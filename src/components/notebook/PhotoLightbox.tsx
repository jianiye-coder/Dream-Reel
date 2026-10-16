"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { tap } from "@/lib/notebookSound";

/* A dream photo you can pick up. The print on the page is a button (zoom-in cursor); it opens the
   same photo enlarged, as a print lying on the softly blurred desk, captioned with date and title.
   Closes with ×, Escape or a click on the desk; focus stays inside and goes back to the print.

   The dialog is a native modal <dialog> (top layer, the rest of the page inert), portalled to
   .nb-root so it keeps the notebook's tokens but not the book's zoom or tilt. Its keys are handled
   natively and stop there, so an Escape that closes the photo doesn't also close an editor behind it. */
export function PhotoLightbox({ src, alt, date, title, className, children }: {
  src: string;
  alt: string;
  date: string;
  title?: string;
  className?: string;
  /** what sits on the page: the small print's image */
  children: React.ReactNode;
}) {
  const { T } = useLanguage();
  const N = T.nb;
  // where the open dialog lives (the page's .nb-root); null while the print lies on the page
  const [host, setHost] = useState<HTMLElement | null>(null);
  const open = host !== null;
  const close = () => setHost(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const captionId = useId();
  const caption = [date, title].filter(Boolean).join(" · ");

  useEffect(() => {
    const d = dialog.current;
    if (!open || !d) return;
    if (!d.open) d.showModal();
    closeBtn.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); setHost(null); }
      // one control on the desk: Tab stays on it
      else if (event.key === "Tab") { event.preventDefault(); closeBtn.current?.focus(); }
    };
    const onCancel = (event: Event) => { event.preventDefault(); setHost(null); };
    d.addEventListener("keydown", onKey);
    d.addEventListener("cancel", onCancel);
    const opener = trigger.current;
    return () => {
      d.removeEventListener("keydown", onKey);
      d.removeEventListener("cancel", onCancel);
      if (d.open) d.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={["nb-zoom", className].filter(Boolean).join(" ")}
        aria-label={`${N.photoZoom} · ${caption}`}
        aria-haspopup="dialog"
        onClick={(event) => { event.stopPropagation(); tap(); setHost(event.currentTarget.closest<HTMLElement>(".nb-root") ?? document.body); }}
      >
        {children}
      </button>
      {host ? createPortal(
        <dialog
          ref={dialog}
          className="nb-lightbox"
          // focusable itself, so a click on the print keeps focus (and Escape) inside the dialog
          tabIndex={-1}
          aria-labelledby={captionId}
          onClick={(event) => {
            // a click on the desk around the print puts it down
            event.stopPropagation();
            if (!(event.target as HTMLElement).closest(".nb-lightbox-print")) close();
          }}
        >
          <figure className="nb-print nb-lightbox-print">
            <Image src={src} alt={alt} width={1024} height={1024} unoptimized />
            <figcaption id={captionId} className="nb-cap">{caption}</figcaption>
          </figure>
          <button ref={closeBtn} type="button" className="nb-lightbox-close" onClick={close}>
            {N.photoClose} <span aria-hidden>×</span>
          </button>
        </dialog>,
        host,
      ) : null}
    </>
  );
}
