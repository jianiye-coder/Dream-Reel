"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LangToggle } from "@/components/LangToggle";
import { Book, BookPage } from "@/components/notebook/Book";
import { NotebookShell } from "@/components/notebook/NotebookShell";
import { useLanguage } from "@/contexts/LanguageContext";
import { tap, writeChar } from "@/lib/notebookSound";
import styles from "./page.module.css";
import { DrawingBoard } from "./DrawingBoard";
import type { DrawingStroke } from "@/lib/morningDrawing";

type Entry = { date: string; content: string; drawing: DrawingStroke[]; revision: number; updatedAt: string };
type Day = Pick<Entry, "date" | "updatedAt">;
type Draft = { date: string; content: string; savedContent: string; drawing: DrawingStroke[]; savedDrawing: DrawingStroke[]; revision: number };
type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Cameron's three pages come to roughly 750 words; Chinese, Japanese kana and Hangul count per character,
// other scripts count words
const PAGE_WORDS = 250;
function countWords(text: string) {
  return (text.match(/[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]|(?:(?![\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff])[\p{L}\p{N}])(?:(?![\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff])[\p{L}\p{N}'’-])*/gu) ?? []).length;
}

// mark which edges of the sheet have text scrolled past them, so the CSS can fade just those edges
function markEdges(el: HTMLTextAreaElement) {
  const top = el.scrollTop > 1;
  // more than the bottom padding still below: a line is actually cut off there
  const bottom = el.scrollHeight - (el.scrollTop + el.clientHeight) > 20;
  el.dataset.edge = [top && "top", bottom && "bottom"].filter(Boolean).join(" ");
}

// a date as you would write it at the top of a page: 十月十五日 周四 / October 15 Thursday
const CN_DIGITS = "零一二三四五六七八九十";
function cnNumber(n: number) {
  if (n <= 10) return CN_DIGITS[n];
  if (n < 20) return `十${CN_DIGITS[n - 10]}`;
  return `${CN_DIGITS[Math.floor(n / 10)]}十${n % 10 ? CN_DIGITS[n % 10] : ""}`;
}

export default function MorningPages() {
  const { lang, T } = useLanguage();
  const router = useRouter();
  const M = T.morningPages;
  const [date, setDate] = useState("");
  const [content, setContent] = useState("");
  const [drawing, setDrawing] = useState<DrawingStroke[]>([]);
  const [mode, setMode] = useState<"text" | "draw">("text");
  const [canvasVersion, setCanvasVersion] = useState(0);
  const [days, setDays] = useState<Day[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [exists, setExists] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [finished, setFinished] = useState(false);
  const draft = useRef<Draft>({ date: "", content: "", savedContent: "", drawing: [], savedDrawing: [], revision: 0 });
  const conflict = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const requestId = useRef(0);
  const editor = useRef<HTMLTextAreaElement>(null);
  const switchingNow = useRef(false);
  const passThrough = useRef(false);
  const leaving = useRef(false);
  const mounted = useRef(false);
  const composing = useRef(false);
  const lastSound = useRef(0);

  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/morning-pages", { cache: "no-store" });
      if (!res.ok) throw new Error("history");
      const data = await res.json() as { entries: Day[] };
      setDays(data.entries);
      setHistoryError(false);
    } catch {
      setHistoryError(true);
    }
  }, []);

  const loadDay = useCallback(async (next: string) => {
    const id = ++requestId.current;
    setLoading(true);
    setLoadError(false);
    setDate(next);
    setFinished(false);
    try {
      const res = await fetch(`/api/morning-pages?date=${next}`, { cache: "no-store" });
      if (!res.ok) throw new Error("load");
      const { entry } = await res.json() as { entry: Entry | null };
      if (id !== requestId.current) return;
      const text = entry?.content ?? "";
      const strokes = entry?.drawing ?? [];
      draft.current = { date: next, content: text, savedContent: text, drawing: strokes, savedDrawing: strokes, revision: entry?.revision ?? 0 };
      conflict.current = false;
      setContent(text);
      setDrawing(strokes);
      setCanvasVersion((version) => version + 1);
      setExists(Boolean(entry));
      setStatus(entry ? "saved" : "idle");
    } catch {
      if (id === requestId.current) setLoadError(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDay(localDate());
    void refreshHistory();
    return () => { requestId.current += 1; };
  }, [loadDay, refreshHistory]);

  const save = useCallback((): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    if (conflict.current) return Promise.resolve(false);
    // Serialize writes and flush edits made while the previous request was in flight.
    const task = async () => {
      while (draft.current.content !== draft.current.savedContent || draft.current.drawing !== draft.current.savedDrawing) {
        const snapshot = { ...draft.current };
        setStatus("saving");
        try {
          const res = await fetch("/api/morning-pages", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: snapshot.date, content: snapshot.content, drawing: snapshot.drawing, revision: snapshot.revision }),
          });
          if (res.status === 409) {
            conflict.current = true;
            setStatus("conflict");
            return false;
          }
          if (!res.ok) throw new Error("save");
          const { entry } = await res.json() as { entry: Entry };
          draft.current.savedContent = snapshot.content;
          draft.current.savedDrawing = snapshot.drawing;
          draft.current.revision = entry.revision;
          setExists(true);
          setDays((current) => [entry, ...current.filter((day) => day.date !== entry.date)]
            .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 90));
        } catch {
          setStatus("error");
          return false;
        }
      }
      setStatus(draft.current.revision > 0 ? "saved" : "idle");
      return true;
    };
    inFlight.current = task().finally(() => { inFlight.current = null; });
    return inFlight.current;
  }, []);

  useEffect(() => {
    if (loading || loadError || status !== "dirty") return;
    const timer = window.setTimeout(() => { void save(); }, 800);
    return () => window.clearTimeout(timer);
  }, [content, drawing, status, loading, loadError, save]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (draft.current.content !== draft.current.savedContent || draft.current.drawing !== draft.current.savedDrawing) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => { switchingNow.current = switching; }, [switching]);

  // keep the scroll-edge fades in step with the text (loaded pages, edits, switching back to the text tab)
  useEffect(() => { if (editor.current) markEdges(editor.current); }, [content, mode, loading, finished]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Links in the notebook shell (top bar, contents, brand) leave only after the page is safely saved,
  // as the old header did. Once saved, the original click is replayed so book links still turn a page.
  useEffect(() => {
    const intercept = (event: MouseEvent) => {
      if (passThrough.current || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      const unsaved = draft.current.content !== draft.current.savedContent || draft.current.drawing !== draft.current.savedDrawing;
      if (!leaving.current && !switchingNow.current && !unsaved && !inFlight.current && !conflict.current) return;
      event.preventDefault();
      // a link in the phone contents sheet still runs its own handler, which closes the sheet so the save
      // status is in view; Next's <Link> skips navigating because the default was prevented
      const inContents = Boolean(link.closest(".nb-toc"));
      if (!inContents) event.stopPropagation();
      if (leaving.current || switchingNow.current) return;
      leaving.current = true;
      const go = () => {
        if (!mounted.current) return;
        if (inContents) { router.push(url.pathname + url.search + url.hash); return; }
        if (!link.isConnected) return;
        passThrough.current = true;
        try { link.click(); } finally { passThrough.current = false; }
      };
      if (conflict.current) {
        // the other window's version is on the server; leaving only drops this window's edits
        leaving.current = false;
        if (window.confirm(M.leaveConfirm)) go();
        return;
      }
      setSwitching(true);
      void save().then((saved) => {
        leaving.current = false;
        if (!saved) { if (mounted.current) setSwitching(false); return; }
        go();
      });
    };
    window.addEventListener("click", intercept, true);
    return () => window.removeEventListener("click", intercept, true);
  }, [save, router, M.leaveConfirm]);

  async function selectDay(next: string) {
    if (!next || next === date || switching || loading) return;
    setSwitching(true);
    if (await save()) await loadDay(next);
    setSwitching(false);
  }

  async function finish() {
    setSwitching(true);
    if (await save()) setFinished(true);
    setSwitching(false);
  }

  async function remove() {
    if (!window.confirm(M.deleteConfirm)) return;
    setSwitching(true);
    if (!(await save())) { setSwitching(false); return; }
    try {
      const res = await fetch("/api/morning-pages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, revision: draft.current.revision }),
      });
      if (res.status === 409) {
        conflict.current = true;
        setStatus("conflict");
      } else if (!res.ok) {
        throw new Error("delete");
      } else {
        await loadDay(date);
        await refreshHistory();
      }
    } catch {
      setStatus("error");
    } finally {
      setSwitching(false);
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `morning-pages-${draft.current.date}.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function formatDate(value: string) {
    return new Date(`${value}T12:00:00`).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "short", day: "numeric" });
  }

  const locale = lang === "zh" ? "zh-CN" : "en-US";
  function dateLine(value: string) {
    const day = new Date(`${value}T12:00:00`);
    return {
      day: lang === "zh" ? `${cnNumber(day.getMonth() + 1)}月${cnNumber(day.getDate())}日` : day.toLocaleDateString(locale, { month: "long", day: "numeric" }),
      weekday: day.toLocaleDateString(locale, { weekday: lang === "zh" ? "short" : "long" }),
      year: String(day.getFullYear()),
    };
  }
  function tocDate(value: string) {
    const day = new Date(`${value}T12:00:00`);
    const sameYear = value.slice(0, 4) === localDate().slice(0, 4);
    return {
      day: day.toLocaleDateString(locale, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }),
      weekday: day.toLocaleDateString(locale, { weekday: "short" }),
    };
  }

  // the pen sounds as each character lands; IME candidates are silent until committed
  function penSound(text: string) {
    const now = performance.now();
    if (now - lastSound.current < 45) return;
    lastSound.current = now;
    let when = 0;
    for (const ch of Array.from(text).slice(0, 4)) when += Math.max(writeChar(ch, when), 0.06);
  }

  const statusText = M.status[status];
  const alertStatus = status === "error" || status === "conflict";
  const words = countWords(content);
  const page = Math.min(3, Math.floor(words / PAGE_WORDS) + 1);
  const progressText = words >= PAGE_WORDS * 3 ? M.progressDone : M.progress.replace("{page}", String(page));
  // dates depend on the reader's clock, so they appear once the page has loaded on the client
  const heading = date ? dateLine(date) : null;
  const isToday = Boolean(date) && date === localDate();
  const writable = !loading && !loadError && !finished;
  // every morning is its own spread: folios follow the day of the year
  const dayOfYear = date ? Math.round((Date.parse(`${date}T12:00:00`) - Date.parse(`${date.slice(0, 4)}-01-01T12:00:00`)) / 864e5) + 1 : 0;

  const progress = (
    <span className={styles.progress} title={progressText} aria-hidden>
      {["i", "ii", "iii"].map((mark, index) => (
        <span key={mark} className={words >= PAGE_WORDS * (index + 1) ? styles.pageDone : index + 1 === page ? styles.pageNow : undefined}>{mark}</span>
      ))}
    </span>
  );

  return (
    <NotebookShell lean>
      <main className="nb-stage" id="main">
        <Book className={styles.book} tilt={false}>
          <BookPage side="l" padClassName={styles.leftPad} folio={dayOfYear ? M.folio.replace("{n}", String(dayOfYear * 2)) : undefined}>
            <header>
              <div className={styles.kickerRow}>
                <span className="nb-kicker">{M.eyebrow}<span aria-hidden> · </span>{M.privateLabel}</span>
                <LangToggle className={styles.phoneLang} />
              </div>
              <h1 className={styles.title}>{M.title}</h1>
              <p className={`nb-date-line ${styles.dateLine}`}>
                {heading ? <><b>{heading.day}</b><span>{heading.weekday}</span><span className="nb-mono">{heading.year}</span></> : "\u00a0"}
                {isToday && <span className={`nb-note ${styles.todayNote}`} aria-hidden>{M.todayNote}</span>}
              </p>
            </header>

            <details className={styles.about}>
              <summary>
                <span>{M.aboutLead}</span>{" "}
                <span className={styles.aboutToggle}>{M.aboutToggle}</span>
              </summary>
              <div className={styles.aboutBody}>
                <section><h2>{M.aboutWhatTitle}</h2><p>{M.aboutWhat}</p></section>
                <section><h2>{M.aboutWhyTitle}</h2><ul>{M.aboutWhy.map((line) => <li key={line}>{line}</li>)}</ul></section>
                <p className={styles.aboutHere}>{M.aboutHere}{" "}
                  <a href="https://juliacameronlive.com/" target="_blank" rel="noreferrer">{M.aboutSource}<span aria-hidden> ↗</span><span className={styles.srOnly}>{M.opensNewTab}</span></a>
                </p>
              </div>
            </details>

            <aside className={styles.dates} aria-label={M.datesLabel}>
              <div className={styles.pick}>
                <button type="button" className={styles.todayButton} disabled={loading || switching} onClick={() => void selectDay(localDate())}>{M.today}</button>
                <label className={styles.dateField}><span>{M.date}</span>
                  <input type="date" value={date} disabled={loading || switching} onChange={(e) => void selectDay(e.target.value)} />
                </label>
              </div>
              <h2 className={`nb-kicker ${styles.recentTitle}`}>{M.recent}</h2>
              {historyError ? <button type="button" className={`nb-act-quiet ${styles.quiet} ${styles.historyRetry}`} onClick={() => void refreshHistory()}>{M.historyRetry}</button> : null}
              {!historyError && days.length === 0 && <p className={styles.noPages}>{M.noPages}</p>}
              <ul className={styles.toc}>{days.map((day) => {
                const label = tocDate(day.date);
                return (
                  <li key={day.date}>
                    <button type="button" aria-label={formatDate(day.date)} aria-current={day.date === date ? "date" : undefined} disabled={loading || switching} onClick={() => void selectDay(day.date)}>
                      <span className={styles.tocDay}>{label.day}</span><span className={styles.tocLead} aria-hidden /><span className={styles.tocWeekday} aria-hidden>{label.weekday}</span>
                    </button>
                  </li>
                );
              })}</ul>
            </aside>
          </BookPage>

          <BookPage side="r" className={styles.right} padClassName={styles.rightPad} folio={dayOfYear ? M.folio.replace("{n}", String(dayOfYear * 2 + 1)) : undefined} aria-label={M.writingLabel}>
            {writable && (
              <div className={styles.toolbar}>
                <div className={`nb-ink-tabs ${styles.modes}`} role="group" aria-label={M.modeLabel}>
                  <button type="button" aria-pressed={mode === "text"} onClick={() => { setMode("text"); tap(); }}>{M.modeText}{content ? <i className={styles.dot} aria-hidden /> : null}</button>
                  <button type="button" aria-pressed={mode === "draw"} onClick={() => { setMode("draw"); tap(); }}>{M.modeDraw}{drawing.length ? <i className={styles.dot} aria-hidden /> : null}</button>
                </div>
                <span className={`nb-mono ${styles.count}`}>{M.words.replace("{count}", String(words))}<span className={styles.srOnly}> · {progressText}</span></span>
              </div>
            )}
            {loading ? <p role="status" className={styles.empty}>{M.loading}</p> : loadError ? (
              <div className={styles.empty} role="alert"><p>{M.loadError}</p><button type="button" className={`nb-act ${styles.finish}`} onClick={() => void loadDay(date)}>{M.retry}</button></div>
            ) : finished ? (
              <div className={styles.finished}>
                <svg className={styles.tick} viewBox="0 0 40 30" aria-hidden><path d="M3 17 C 8 20, 11 24, 14 27 C 20 16, 28 8, 37 3" /></svg>
                <h2>{M.finishedTitle}</h2>
                <p className="nb-hand">{M.finishedBody}</p>
                <div className={styles.finishedActions}>
                  <button type="button" className={`nb-act ${styles.finish}`} onClick={() => { setFinished(false); requestAnimationFrame(() => editor.current?.focus()); }}>{M.keepWriting} <span aria-hidden>→</span></button>
                  <Link className="nb-act-quiet" href="/archive">{T.nav.archive}</Link>
                </div>
              </div>
            ) : (
              <>
                <div className={styles.surface} hidden={mode !== "text"}>
                  <textarea ref={editor} className={styles.editor} aria-label={M.contentLabel} placeholder={M.placeholder} value={content} maxLength={50000} readOnly={switching} spellCheck
                    onScroll={(e) => markEdges(e.currentTarget)}
                    onCompositionStart={() => { composing.current = true; }}
                    onCompositionEnd={(e) => { composing.current = false; penSound(e.data); }}
                    onChange={(e) => {
                      const input = e.nativeEvent as InputEvent;
                      if (!composing.current && !input.isComposing && input.inputType === "insertText" && input.data) penSound(input.data);
                      draft.current.content = e.target.value;
                      setContent(e.target.value);
                      setStatus(conflict.current ? "conflict" : "dirty");
                    }} onBlur={() => { if (!conflict.current) void save(); }} />
                </div>
                <div className={styles.surface} hidden={mode !== "draw"}>
                  <DrawingBoard key={canvasVersion} date={date} labels={M.draw} strokes={drawing} disabled={switching} onChange={(strokes) => {
                    draft.current.drawing = strokes;
                    setDrawing(strokes);
                    setStatus(conflict.current ? "conflict" : "dirty");
                  }} />
                </div>
              </>
            )}
            {!loading && !loadError && <footer className={styles.footer}>
              <div className={styles.meta}>
                <div role={alertStatus ? "alert" : "status"} className={alertStatus ? styles.error : styles.saveStatus}>{statusText}</div>
                {progress}
              </div>
              <div className={styles.actions}>
                {status === "error" && <button type="button" className={styles.fix} disabled={switching} onClick={() => void save()}>{M.retrySave}</button>}
                {status === "conflict" && <button type="button" className={styles.fix} onClick={() => {
                  if (window.confirm(M.discardConfirm)) void loadDay(date);
                }}>{M.loadLatest}</button>}
                <button type="button" className={`nb-act-quiet ${styles.quiet}`} disabled={!content} onClick={download}>{M.downloadText}</button>
                {exists && <button type="button" className={`nb-act-quiet ${styles.quiet}`} disabled={switching || status === "conflict"} onClick={() => void remove()}>{M.delete}</button>}
                {!finished && <button type="button" className={`nb-act ${styles.finish}`} disabled={switching || (!content.trim() && !drawing.length) || status === "conflict"} onClick={() => void finish()}>{M.finish} <span aria-hidden>→</span></button>}
              </div>
            </footer>}
          </BookPage>
        </Book>
      </main>
    </NotebookShell>
  );
}
