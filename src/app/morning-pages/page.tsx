"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LangToggle } from "@/components/LangToggle";
import { useLanguage } from "@/contexts/LanguageContext";
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

  async function selectDay(next: string) {
    if (!next || next === date || switching || loading) return;
    setSwitching(true);
    if (await save()) await loadDay(next);
    setSwitching(false);
  }

  async function leave(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (switching) return;
    setSwitching(true);
    if (await save()) router.push(href);
    else setSwitching(false);
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

  const statusText = M.status[status];

  return (
    <div className={styles.page}>
      <nav className={styles.header} aria-label={M.mainNav}>
        <Link href="/" className={styles.brand} onClick={(e) => void leave(e, "/")}>
          <Image src="/dream-reel-logo.png" alt="" width={36} height={36} />
          <span>Dream Reel</span>
        </Link>
        <div className={styles.navigation}>
          <LangToggle className={styles.button} />
          <Link href="/journal" onClick={(e) => void leave(e, "/journal")}>{T.nav.journal}</Link>
          <Link href="/archive" onClick={(e) => void leave(e, "/archive")}>{T.nav.archive}</Link>
        </div>
      </nav>
      <main className={styles.main}>
        <header className={styles.heading}>
          <div><p className={styles.eyebrow}>{M.eyebrow}</p><h1>{M.title}</h1></div>
          <span className={styles.privateLabel}>{M.privateLabel}</span>
        </header>
        <div className={styles.workspace}>
          <aside className={styles.history} aria-label={M.datesLabel}>
            <button className={styles.button} disabled={loading || switching} onClick={() => void selectDay(localDate())}>{M.today}</button>
            <label className={styles.dateLabel}>{M.date}
              <input type="date" value={date} disabled={loading || switching} onChange={(e) => void selectDay(e.target.value)} />
            </label>
            <h2>{M.recent}</h2>
            {historyError ? <button className={styles.textButton} onClick={() => void refreshHistory()}>{M.historyRetry}</button> : null}
            {!historyError && days.length === 0 && <p>{M.noPages}</p>}
            <ul>{days.map((day) => <li key={day.date}><button aria-current={day.date === date ? "date" : undefined} disabled={loading || switching} onClick={() => void selectDay(day.date)}>{formatDate(day.date)}</button></li>)}</ul>
          </aside>
          <section className={styles.writing} aria-label={M.writingLabel}>
            <div className={styles.toolbar}><h2>{date ? formatDate(date) : M.today}</h2><span>{M.characters.replace("{count}", String(Array.from(content).length))}</span></div>
            {!loading && !loadError && !finished && <div className={styles.modes} role="group" aria-label={M.modeLabel}>
              <button aria-pressed={mode === "text"} onClick={() => setMode("text")}>{M.modeText}{content ? " ·" : ""}</button>
              <button aria-pressed={mode === "draw"} onClick={() => setMode("draw")}>{M.modeDraw}{drawing.length ? " ·" : ""}</button>
            </div>}
            {loading ? <p role="status" className={styles.empty}>{M.loading}</p> : loadError ? (
              <div className={styles.empty} role="alert"><p>{M.loadError}</p><button className={styles.button} onClick={() => void loadDay(date)}>{M.retry}</button></div>
            ) : finished ? (
              <div className={styles.empty}><h2>{M.finishedTitle}</h2><p>{M.finishedBody}</p><button className={styles.button} onClick={() => { setFinished(false); requestAnimationFrame(() => editor.current?.focus()); }}>{M.keepWriting}</button><Link href="/archive">{T.nav.archive}</Link></div>
            ) : (
              <><div hidden={mode !== "text"}><textarea ref={editor} aria-label={M.contentLabel} placeholder={M.placeholder} value={content} maxLength={50000} readOnly={switching} spellCheck onChange={(e) => {
                draft.current.content = e.target.value;
                setContent(e.target.value);
                setStatus(conflict.current ? "conflict" : "dirty");
              }} onBlur={() => { if (!conflict.current) void save(); }} /></div>
              <div hidden={mode !== "draw"}><DrawingBoard key={canvasVersion} date={date} labels={M.draw} strokes={drawing} disabled={switching} onChange={(strokes) => {
                draft.current.drawing = strokes;
                setDrawing(strokes);
                setStatus(conflict.current ? "conflict" : "dirty");
              }} /></div></>
            )}
            {!loading && !loadError && <footer className={styles.footer}>
              <div role={status === "error" || status === "conflict" ? "alert" : "status"} className={status === "error" || status === "conflict" ? styles.error : styles.saveStatus}>{statusText}</div>
              <div className={styles.actions}>
                {status === "error" && <button className={styles.button} disabled={switching} onClick={() => void save()}>{M.retrySave}</button>}
                {status === "conflict" && <button className={styles.button} onClick={() => {
                  if (window.confirm(M.discardConfirm)) void loadDay(date);
                }}>{M.loadLatest}</button>}
                <button className={styles.textButton} disabled={!content} onClick={download}>{M.downloadText}</button>
                {exists && <button className={styles.textButton} disabled={switching || status === "conflict"} onClick={() => void remove()}>{M.delete}</button>}
                {!finished && <button className={styles.primary} disabled={switching || (!content.trim() && !drawing.length) || status === "conflict"} onClick={() => void finish()}>{M.finish}</button>}
              </div>
            </footer>}
          </section>
        </div>
      </main>
    </div>
  );
}
