"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DreamEntry } from "@/lib/dreams";
import { buildDreamImagePrompt } from "@/lib/imagePrompt";
import {
  buildDreamExport,
  sanitizeDreamExportFilename,
  type DreamExportFormat,
} from "@/lib/dreamExport";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatDateTime, formatMonthLabel, type Lang } from "@/lib/i18n";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { Book, BookPage } from "@/components/notebook/Book";
import { PageCorner } from "@/components/notebook/PageCorner";
import { PhotoLightbox } from "@/components/notebook/PhotoLightbox";
import { TurnLink } from "@/components/notebook/TurnLink";
import { edgeFade } from "@/lib/edgeFade";
import { flipPage } from "@/lib/notebookFlip";
import { pageTurn, tap, unlock } from "@/lib/notebookSound";
import s from "./archive.module.css";

export type ArchiveTab = "calendar" | "tags" | "recent";
export type ArchiveExporter = { run: (format: "markdown" | "json") => void; busy: boolean; error: string };

type DayBucket = {
  date: Date;
  entries: DreamEntry[];
};

type CalendarCell = {
  key: string;
  date: Date | null;
  entries: DreamEntry[];
  isToday: boolean;
};

type DreamEditForm = {
  title: string;
  rawText: string;
  cleanText: string;
  mood: string;
  stressScore: string;
  tags: string;
  people: string;
  locations: string;
  symbols: string;
  dreamDate: string;
  sleepStart: string;
  wakeTime: string;
  sleepQuality: number | null;
  preSleepMeal: string;
  preSleepActivity: string;
  sleepInsight: string;
  imageUrl: string | null;
  assetStatus: string | null;
};

type KeywordArchiveKind = "people" | "locations";

type KeywordArchiveItem = {
  kind: KeywordArchiveKind;
  label: string;
  count: number;
  entries: DreamEntry[];
  moods: { item: string; count: number }[];
  symbols: { item: string; count: number }[];
};

const PHONE = "(max-width: 900px)";
// the open night's dream scrolls inside the page; it can take keyboard focus while it does
const dreamScroll = (el: HTMLElement | null) => edgeFade(el, { focusable: true });

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** "{count}" inserts a value; "{count:dream|dreams}" picks singular/plural; "{count:ord}" gives 1st, 2nd… */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)(?::([^}|]*)(?:\|([^}]*))?)?\}/g, (match, key: string, one?: string, other?: string) => {
    if (!(key in values)) return match;
    const value = values[key];
    if (one === undefined) return String(value);
    if (one === "ord" && other === undefined) return ordinal(Number(value));
    return Number(value) === 1 ? one : other ?? one;
  });
}

/** The reader's own today, read after mount so server and browser render the same markup. */
type Clock = { todayKey: string; todayUtc: number; year: number };
function readClock(): Clock {
  const now = new Date();
  return { todayKey: localDayKey(now), todayUtc: Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()), year: now.getFullYear() };
}

function formatDayKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** "10.07" — dates are stored at UTC midnight, so read them in UTC. */
function shortDate(value: string): string {
  const date = new Date(value);
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}.${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** "10.07", or "2025.10.07" when the dream is from another year. */
function dateLabel(value: string, thisYear: number): string {
  const year = new Date(value).getUTCFullYear();
  return year === thisYear ? shortDate(value) : `${year}.${shortDate(value)}`;
}

/** Date for list rows: the year (when it differs) sits small above the day. */
function DateMark({ value, thisYear, className }: { value: string; thisYear: number; className?: string }) {
  const year = new Date(value).getUTCFullYear();
  return <span className={className}>{year !== thisYear ? <small>{year}</small> : null}{shortDate(value)}</span>;
}

function weekdayLabel(value: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(value));
}

function truncate(value: string, length: number): string {
  if (value.length <= length) return value;
  return `${value.slice(0, length).trim()}...`;
}

function dreamDisplayTitle(entry: Pick<DreamEntry, "title" | "cleanText" | "rawText">): string {
  const explicitTitle = entry.title?.trim();
  if (explicitTitle) return explicitTitle;
  const text = (entry.cleanText || entry.rawText).replace(/\s+/g, " ").trim();
  return truncate(text, 32);
}

function dreamText(entry: Pick<DreamEntry, "cleanText" | "rawText">): string {
  return (entry.cleanText || entry.rawText).replace(/\s+/g, " ").trim();
}

/** The whole dream as written, for reading it on its page: its paragraphs kept, stray spaces tidied. */
function dreamFullText(entry: Pick<DreamEntry, "cleanText" | "rawText">): string {
  return (entry.cleanText || entry.rawText).replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function downloadDreamFile(content: string, filename: string, format: DreamExportFormat) {
  const blob = new Blob([content], {
    type: format === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8",
  });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
}

function splitCommaList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitMood(value: string): string[] {
  return value.split(/[、,，/·;；]+/).map((item) => item.trim()).filter(Boolean);
}

function normalizeKeyword(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function topCounts(values: string[], limit = 4): { item: string; count: number }[] {
  const counts = new Map<string, { item: string; count: number }>();

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalizeKeyword(trimmed);
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { item: trimmed, count: 1 });
    }
  }

  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.item.localeCompare(b.item))
    .slice(0, limit);
}

function buildKeywordArchive(entries: DreamEntry[], kind: KeywordArchiveKind, aliases: Record<string, string> = {}): KeywordArchiveItem[] {
  const groups = new Map<string, { label: string; entries: DreamEntry[] }>();

  for (const entry of entries) {
    const values = kind === "people" ? entry.people : entry.locations;
    const seenInEntry = new Set<string>();

    for (const value of values) {
      const trimmed = value.trim();
      if (!trimmed) continue;
      // Resolve alias: if this keyword has been merged into another, use canonical label
      const canonical = aliases[normalizeKeyword(trimmed)] ?? trimmed;
      const key = normalizeKeyword(canonical);
      if (seenInEntry.has(key)) continue;
      seenInEntry.add(key);

      const existing = groups.get(key);
      if (existing) {
        existing.entries.push(entry);
      } else {
        groups.set(key, { label: canonical, entries: [entry] });
      }
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      kind,
      label: group.label,
      count: group.entries.length,
      entries: group.entries,
      moods: topCounts(group.entries.map((entry) => entry.mood).filter(Boolean)),
      symbols: topCounts(group.entries.flatMap((entry) => entry.symbols)),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildCalendarCells(monthKey: string, buckets: Map<string, DayBucket>, todayKey: string | null): CalendarCell[] {
  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText) - 1;
  // Dream dates are stored at UTC midnight; build the month in UTC so a reader east of UTC
  // doesn't see every dream one square early.
  const firstDay = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const leading = (firstDay.getUTCDay() + 6) % 7;
  const cells: CalendarCell[] = [];

  for (let i = 0; i < leading; i += 1) {
    cells.push({ key: `empty-${monthKey}-${i}`, date: null, entries: [], isToday: false });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(Date.UTC(year, month, day));
    const key = formatDayKey(date);
    cells.push({
      key,
      date,
      entries: buckets.get(key)?.entries ?? [],
      isToday: key === todayKey,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `tail-${monthKey}-${cells.length}`, date: null, entries: [], isToday: false });
  }

  return cells;
}

function formatDateInputValue(value: string): string {
  const date = new Date(value);
  if (isNaN(date.getTime())) return "";
  // Use UTC methods to match the UTC midnight stored in the database,
  // avoiding a one-day shift for timezones behind UTC.
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function toEditForm(entry: DreamEntry): DreamEditForm {
  return {
    title: entry.title,
    rawText: entry.rawText,
    cleanText: entry.cleanText,
    mood: entry.mood,
    stressScore: entry.stressScore == null ? "" : String(entry.stressScore),
    tags: entry.tags.join(", "),
    people: entry.people.join(", "),
    locations: entry.locations.join(", "),
    symbols: entry.symbols.join(", "),
    dreamDate: formatDateInputValue(entry.capturedAt),
    sleepStart: entry.sleepStart ?? "",
    wakeTime: entry.wakeTime ?? "",
    sleepQuality: entry.sleepQuality,
    preSleepMeal: entry.preSleepMeal ?? "",
    preSleepActivity: entry.preSleepActivity ?? "",
    sleepInsight: entry.sleepInsight ?? "",
    imageUrl: entry.imageUrl,
    assetStatus: entry.assetStatus,
  };
}

type UpdateBody = ReturnType<typeof updateBodyFor>;
function updateBodyFor(id: number, currentForm: DreamEditForm, visualBrief: string | null) {
  return {
    id,
    title: currentForm.title,
    inputMode: "text" as const,
    rawText: currentForm.rawText,
    cleanText: currentForm.cleanText.trim() || currentForm.rawText.trim(),
    mood: currentForm.mood,
    stressScore: currentForm.stressScore ? Number(currentForm.stressScore) : null,
    tags: splitCommaList(currentForm.tags),
    people: splitCommaList(currentForm.people),
    locations: splitCommaList(currentForm.locations),
    symbols: splitCommaList(currentForm.symbols),
    capturedAt: currentForm.dreamDate || undefined,
    imageUrl: currentForm.imageUrl,
    assetStatus: currentForm.imageUrl ? (currentForm.assetStatus ?? "generated") : null,
    sleepStart: currentForm.sleepStart || null,
    wakeTime: currentForm.wakeTime || null,
    sleepQuality: currentForm.sleepQuality,
    preSleepMeal: currentForm.preSleepMeal || null,
    preSleepActivity: currentForm.preSleepActivity || null,
    sleepInsight: currentForm.sleepInsight || null,
    // saves only happen once the full entry is loaded (see `ready`), so this is never the list
    // copy's missing value
    visualBrief,
  };
}

const SAVE_TIMEOUT_MS = 20_000;

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("hidden") && !element.closest("[inert]") && element.getClientRects().length > 0);
}

function useModalFocus(isOpen: boolean, onClose: () => void, initialFocusRef?: React.RefObject<HTMLElement | null>, restoreFocus?: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => {
      (initialFocusRef?.current ?? dialogRef.current)?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (restoreFocus) restoreFocus();
      else returnFocusRef.current?.focus();
    };
  }, [initialFocusRef, isOpen, restoreFocus]);

  // A button that disables itself while it works (analyse, generate) drops focus to <body>, where the
  // dialog's own key handler can't hear Escape or Tab. Catch those at the document and bring focus back.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!isOpen) return;
    const onDocumentKey = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.contains(document.activeElement)) return;
      // a photo held up over the editor (PhotoLightbox, a modal <dialog>) takes its own keys
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      } else if (event.key === "Tab") {
        event.preventDefault();
        (initialFocusRef?.current ?? dialog).focus();
      }
    };
    document.addEventListener("keydown", onDocumentKey);
    return () => document.removeEventListener("keydown", onDocumentKey);
  }, [initialFocusRef, isOpen]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = getFocusableElements(dialogRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return { dialogRef, onKeyDown };
}

/* How often a name or symbol turns up: a numeral in red ink, read out in full ("出现 3 次" / "appears 3 times"). */
function Count({ count, label }: { count: number; label: string }) {
  return <span className={s.count}><span aria-hidden>{count}</span><span className="nb-sr-only">{label}</span></span>;
}

function TagChipInput({
  value,
  onChange,
  placeholder,
  name,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  name: string;
  ariaLabel: string;
}) {
  const { T } = useLanguage();
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const chips = value.split(",").map((s) => s.trim()).filter(Boolean);

  function addChip(text: string) {
    const trimmed = text.replace(/,/g, "").trim();
    if (!trimmed || chips.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return;
    onChange([...chips, trimmed].join(", "));
    setInputValue("");
  }

  function removeChip(index: number) {
    onChange(chips.filter((_, i) => i !== index).join(", "));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addChip(inputValue);
    } else if (event.key === "Backspace" && !inputValue && chips.length > 0) {
      removeChip(chips.length - 1);
    }
  }

  return (
    <div className={s.chips} onClick={() => inputRef.current?.focus()}>
      {chips.map((chip, i) => (
        <span key={`${chip}-${i}`} className={s.chip}>
          {chip}
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); removeChip(i); }}
            aria-label={fill(T.modal.removeChip, { chip })}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        name={name}
        aria-label={ariaLabel}
        autoComplete="off"
        value={inputValue}
        onChange={(event) => setInputValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (inputValue.trim()) addChip(inputValue); }}
        placeholder={chips.length === 0 ? placeholder : ""}
      />
    </div>
  );
}

function DreamEditorModal({
  entry,
  ready,
  loadError,
  onRetry,
  thisYear,
  restoreFocus,
  onNotice,
  onClose,
  onSaved,
  onDeleted,
}: {
  entry: DreamEntry | null;
  /** false until the full entry (with its image and visual brief) has arrived; editing waits for it */
  ready: boolean;
  loadError?: string;
  onRetry: () => void;
  thisYear: number;
  restoreFocus: () => void;
  /** a message about a dream that isn't open (e.g. its new picture couldn't be filed) */
  onNotice: (message: string) => void;
  onClose: () => void;
  onSaved: (entry: DreamEntry) => void;
  onDeleted: (id: number) => void;
}) {
  const { lang, T } = useLanguage();
  const M = T.modal;
  const router = useRouter();
  const [form, setForm] = useState<DreamEditForm | null>(null);
  const [imagePrompt, setImagePrompt] = useState("");
  const [imagePromptEdited, setImagePromptEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formDirtyRef = useRef(false);
  const formRevisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const [deleting, setDeleting] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [downloadingImage, setDownloadingImage] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [followUpAnswers, setFollowUpAnswers] = useState<Record<number, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [localVisualBrief, setLocalVisualBrief] = useState<string | null>(null);
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // the dream the editor is showing, and the analysis / image requests running for it; both are
  // dropped when another dream opens or the editor closes
  const entryIdRef = useRef<number | null>(null);
  const readyRef = useRef(ready);
  useEffect(() => { readyRef.current = ready; }, [ready]);
  const opsRef = useRef<{ analyze: object | null; image: object | null }>({ analyze: null, image: null });
  const formRef = useRef<DreamEditForm | null>(null);
  useEffect(() => { formRef.current = form; }, [form]);
  // Pictures made for a dream after it was closed: still being filed in the background, or failed to
  // file. Reopening that dream shows the picture; a failed one is saved again through the normal flow.
  const pendingImagesRef = useRef(new Map<number, { imageUrl: string; failed: boolean }>());

  // the brief is read from a ref so a save started in one render (e.g. after an image finished)
  // still sends the newest one, even if an analysis replaced it meanwhile
  const visualBriefRef = useRef<string | null>(null);
  const setBrief = useCallback((value: string | null) => {
    visualBriefRef.current = value;
    setLocalVisualBrief(value);
  }, []);
  const buildUpdateBody = useCallback((currentForm: DreamEditForm) => (
    entry ? updateBodyFor(entry.id, currentForm, visualBriefRef.current) : null
  ), [entry]);

  // Saves go out one at a time, in order, so an older PUT still in flight can never land after a
  // newer one (autosave, close, flush) and overwrite it.
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueueSave = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = saveChainRef.current.then(task, task);
    saveChainRef.current = run.catch(() => undefined);
    return run;
  }, []);

  // one PUT; a request that hangs gives up after 20 s so the queue moves on and an error shows
  const putNow = useCallback(async (body: UpdateBody): Promise<DreamEntry> => {
    let response: Response;
    try {
      response = await fetch("/api/dreams", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
      });
    } catch {
      throw new Error(M.updateFailed);
    }

    const payload = (await response.json()) as {
      entry?: DreamEntry;
      error?: string;
      details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] };
    };

    if (!response.ok || !payload.entry) {
      const fieldErrors = Object.entries(payload.details?.fieldErrors ?? {})
        .flatMap(([field, messages]) => messages.map((message) => `${field}: ${message}`));
      const formErrors = payload.details?.formErrors ?? [];
      const detailText = [...fieldErrors, ...formErrors].join("；");
      const message = getApiErrorMessage(payload.error, lang, M.updateFailed);
      throw new Error(detailText ? `${message}: ${detailText}` : message);
    }

    return payload.entry;
  }, [lang, M.updateFailed]);
  const putEntry = useCallback((body: UpdateBody) => enqueueSave(() => putNow(body)), [enqueueSave, putNow]);

  const updateEntry = useCallback(async (currentForm: DreamEditForm): Promise<DreamEntry> => {
    const body = buildUpdateBody(currentForm);
    if (!body) throw new Error(M.updateFailed);
    return putEntry(body);
  }, [buildUpdateBody, putEntry, M.updateFailed]);

  // the save queued by autosave, kept so it can be sent right away if the editor goes before it fires
  const pendingBodyRef = useRef<ReturnType<typeof buildUpdateBody>>(null);
  const cancelPendingSave = useCallback(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = null;
    pendingBodyRef.current = null;
  }, []);
  const flushPendingSave = useCallback((leavingPage = false) => {
    const body = pendingBodyRef.current;
    cancelPendingSave();
    if (!body) return;
    const json = JSON.stringify(body);
    // keepalive lets the request outlive the page, but browsers cap its body at 64 KB
    const send = () => fetch("/api/dreams", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: json,
      keepalive: new Blob([json]).size < 60_000,
      signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
    }).then(() => undefined, () => undefined);
    if (leavingPage) {
      // The page is going away: a request queued behind one in flight would never be sent, so
      // this one goes out now (keepalive). It is the newest edit; the rare reorder is accepted.
      void send();
    } else {
      void enqueueSave(send);
    }
  }, [cancelPendingSave, enqueueSave]);

  const closeEditor = useCallback(async () => {
    if (!entry || !form || saving) return;
    // nothing can have been edited before the full entry arrived; never save the list copy
    if (!ready || formRevisionRef.current === savedRevisionRef.current) {
      onClose();
      return;
    }

    cancelPendingSave();
    setSaving(true);
    setAutoSaveStatus("saving");
    setError("");
    try {
      const updatedEntry = await updateEntry(form);
      formDirtyRef.current = false;
      savedRevisionRef.current = formRevisionRef.current;
      onSaved(updatedEntry);
      onClose();
    } catch (saveError) {
      setAutoSaveStatus("error");
      setError(saveError instanceof Error ? saveError.message : M.updateFailed);
    } finally {
      setSaving(false);
    }
  }, [entry, form, onClose, onSaved, saving, ready, cancelPendingSave, updateEntry, M.updateFailed]);

  const { dialogRef, onKeyDown } = useModalFocus(Boolean(entry && form), () => void closeEditor(), closeButtonRef, restoreFocus);

  useEffect(() => {
    // the entry changed under the editor (opened, closed, or its full copy arrived): a save still
    // queued for the one before goes out now rather than being lost
    flushPendingSave();
    const id = entry?.id ?? null;
    if (id !== entryIdRef.current) {
      // Requests already running are not aborted: the server finishes (and charges) them anyway.
      // Their results are routed by the dream they were started for (see generateImage / analyzeAndAsk).
      opsRef.current = { analyze: null, image: null };
      entryIdRef.current = id;
      setIsAnalyzing(false);
      setGeneratingImage(false);
    }
    formDirtyRef.current = false;
    setDownloadError("");
    formRevisionRef.current = 0;
    savedRevisionRef.current = 0;
    if (!entry) {
      setForm(null);
      setImagePrompt("");
      setImagePromptEdited(false);
      setMessage("");
      setError("");
      return;
    }
    const pendingImage = pendingImagesRef.current.get(entry.id);
    setForm(pendingImage ? { ...toEditForm(entry), imageUrl: pendingImage.imageUrl, assetStatus: "generated" } : toEditForm(entry));
    setBrief(entry.visualBrief ?? null);
    setImagePromptEdited(false);
    setFollowUpQuestions([]);
    setFollowUpAnswers({});
    setMessage("");
    setError("");
    setAutoSaveStatus("idle");
  }, [entry, flushPendingSave, setBrief]);

  useEffect(() => {
    if (!ready || !entry) return;
    const pendingImage = pendingImagesRef.current.get(entry.id);
    if (!pendingImage?.failed) return;
    pendingImagesRef.current.delete(entry.id);
    formDirtyRef.current = true;
    formRevisionRef.current += 1;
    setForm((prev) => (prev ? { ...prev, imageUrl: pendingImage.imageUrl, assetStatus: "generated" } : prev));
  }, [ready, entry]);

  // leaving the page (Back, closing the tab) inside the 1.5 s autosave delay still saves the edit;
  // coming back from the back/forward cache, a "Saving…" left from that moment is stale
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setAutoSaveStatus((current) => (current === "saving" ? "idle" : current));
    };
    const onHide = () => flushPendingSave(true);
    addEventListener("pagehide", onHide);
    addEventListener("pageshow", onShow);
    return () => {
      removeEventListener("pagehide", onHide);
      removeEventListener("pageshow", onShow);
      flushPendingSave();
    };
  }, [flushPendingSave]);

  useEffect(() => {
    if (!entry || formRevisionRef.current === savedRevisionRef.current) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (formRevisionRef.current === savedRevisionRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [entry, form]);

  function updateForm(patch: Partial<DreamEditForm>) {
    if (!ready) return;
    formDirtyRef.current = true;
    formRevisionRef.current += 1;
    setForm((prev) => prev ? { ...prev, ...patch } : prev);
  }

  // Debounced auto-save: fires 1.5s after the last form change
  const triggerAutoSave = useCallback((currentForm: DreamEditForm) => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    const body = buildUpdateBody(currentForm);
    if (!body) return;
    setAutoSaveStatus("saving");
    pendingBodyRef.current = body;
    const savingRevision = formRevisionRef.current;
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      pendingBodyRef.current = null;
      void (async () => {
        try {
          const updatedEntry = await putEntry(body);
          onSaved(updatedEntry);
          if (savingRevision === formRevisionRef.current) {
            savedRevisionRef.current = savingRevision;
            formDirtyRef.current = false;
          }
          setAutoSaveStatus("saved");
          setTimeout(() => setAutoSaveStatus((s) => s === "saved" ? "idle" : s), 2000);
        } catch {
          setAutoSaveStatus("error");
        }
      })();
    }, 1500);
  }, [buildUpdateBody, putEntry, onSaved]);

  useEffect(() => {
    if (!form || !formDirtyRef.current || !ready) return;
    triggerAutoSave(form);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  useEffect(() => {
    if (!form || imagePromptEdited) return;
    if (!form.rawText.trim()) {
      setImagePrompt("");
      return;
    }
    // Mirror journal logic: use comprehensive visualBrief if available
    if (localVisualBrief && localVisualBrief.length > 200) {
      setImagePrompt(localVisualBrief);
      return;
    }
    setImagePrompt(
      buildDreamImagePrompt({
        rawText: form.rawText,
        mood: form.mood,
        people: splitCommaList(form.people),
        locations: splitCommaList(form.locations),
        symbols: splitCommaList(form.symbols),
        tags: splitCommaList(form.tags),
      }),
    );
  }, [form, imagePromptEdited, localVisualBrief]);

  if (!entry || !form) return null;

  async function deleteEntry() {
    if (!entry || deleting) return;
    if (!window.confirm(M.deleteConfirm)) return;

    setDeleting(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/dreams", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(getApiErrorMessage(payload.error, lang, M.updateFailed));

      cancelPendingSave();
      onDeleted(entry.id);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : M.updateFailed);
    } finally {
      setDeleting(false);
    }
  }

  async function generateImage() {
    const prompt = imagePrompt.trim();
    if (!prompt) {
      setError(M.noImageError);
      return;
    }

    const startedFor = entryIdRef.current;
    const op = {};
    opsRef.current.image = op;
    const stillHere = () => entryIdRef.current === startedFor;
    setGeneratingImage(true);
    setMessage("");
    setError("");

    try {
      // Build gender context from people in this dream
      const dreamPeople = splitCommaList(form?.people ?? "");
      const userGender = (() => { try { return localStorage.getItem("dreamReel_userGender") ?? ""; } catch { return ""; } })();
      const pgRaw = (() => { try { const s = localStorage.getItem("dreamReel_personGenders"); return s ? JSON.parse(s) as Record<string, string> : {}; } catch { return {}; } })();
      const genderParts: string[] = [];
      if (userGender) genderParts.push(lang === "zh" ? `做梦者：${userGender === "male" ? "男性" : userGender === "female" ? "女性" : "其他"}` : `Dreamer: ${userGender}`);
      for (const person of dreamPeople) {
        const g = pgRaw[normalizeKeyword(person)];
        if (g) genderParts.push(lang === "zh" ? `${person}：${g === "male" ? "男性" : g === "female" ? "女性" : "其他"}` : `${person}: ${g}`);
      }
      const genderContext = genderParts.join("；");

      const response = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          size: "1024x1024",
          visualBrief: visualBriefRef.current,
          dreamText: form?.rawText ?? null,
          genderContext: genderContext || null,
        }),
      });
      const payload = (await response.json()) as { imageUrl?: string; revisedPrompt?: string | null; error?: string };
      if (!stillHere()) {
        // the picture was paid for and made for a dream that is no longer open: file it onto that
        // dream (only its image fields change) without touching the form now on screen
        if (response.ok && payload.imageUrl && startedFor != null) {
          const imageUrl = payload.imageUrl;
          const title = form?.title || entry?.title || "";
          pendingImagesRef.current.set(startedFor, { imageUrl, failed: false });
          void enqueueSave(async () => {
            const res = await fetch(`/api/dreams?id=${startedFor}`, { cache: "no-store", signal: AbortSignal.timeout(SAVE_TIMEOUT_MS) });
            const full = ((await res.json()) as { entry?: DreamEntry }).entry;
            if (!res.ok || !full) throw new Error(M.updateFailed);
            const saved = await putNow(updateBodyFor(full.id, { ...toEditForm(full), imageUrl, assetStatus: "generated" }, full.visualBrief));
            onSaved(saved);
            return saved;
          }).then(
            () => {
              pendingImagesRef.current.delete(startedFor);
              // reopened meanwhile: show the filed picture (already saved, so not an edit)
              if (entryIdRef.current === startedFor) {
                setForm((prev) => (prev ? { ...prev, imageUrl, assetStatus: "generated" } : prev));
              }
            },
            () => {
              if (entryIdRef.current === startedFor && readyRef.current) {
                // open again: let the normal save (with its own error display) carry the picture
                pendingImagesRef.current.delete(startedFor);
                formDirtyRef.current = true;
                formRevisionRef.current += 1;
                setForm((prev) => (prev ? { ...prev, imageUrl, assetStatus: "generated" } : prev));
              } else {
                pendingImagesRef.current.set(startedFor, { imageUrl, failed: true });
                onNotice(fill(T.archive.nb.imageFileFailed, { title }));
              }
            },
          );
        }
        return;
      }
      if (response.status === 402) { router.push("/pricing"); return; }
      if (!response.ok || !payload.imageUrl) {
        throw new Error(getApiErrorMessage(payload.error, lang, M.noImageError));
      }

      // keep anything typed while the picture was being made
      const latest = formRef.current;
      if (!latest) return;
      const nextForm: DreamEditForm = { ...latest, imageUrl: payload.imageUrl ?? null, assetStatus: "generated" };
      setForm(nextForm);
      setImagePrompt(payload.revisedPrompt ?? prompt);
      setImagePromptEdited(true);
      const updatedEntry = await updateEntry(nextForm);
      onSaved(updatedEntry);
      if (stillHere()) setMessage(M.imageSaved);
    } catch (generateError) {
      if (stillHere()) setError(generateError instanceof Error ? generateError.message : M.noImageError);
    } finally {
      if (opsRef.current.image === op) {
        opsRef.current.image = null;
        setGeneratingImage(false);
      }
    }
  }

  async function analyzeAndAsk() {
    if (!form?.rawText.trim()) {
      setError(M.dreamError);
      return;
    }
    const startedFor = entryIdRef.current;
    const op = {};
    opsRef.current.analyze = op;
    // Analysis rewrites the reader's own fields (title, mood, people…) as suggestions to look over,
    // so a result for a dream that was closed meanwhile is dropped rather than written unseen.
    const stillHere = () => entryIdRef.current === startedFor;
    setIsAnalyzing(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/analyze-dream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: form.rawText,
          lang,
          preSleepMeal: form.preSleepMeal || undefined,
          preSleepActivity: form.preSleepActivity || undefined,
        }),
      });
      const payload = (await response.json()) as {
        title?: string;
        mood?: string;
        stressScore?: number | null;
        people?: string[];
        locations?: string[];
        symbols?: string[];
        sleepInsight?: string;
        followUpQuestions?: string[];
        visualBrief?: string;
        error?: string;
      };
      if (!stillHere()) return; // closed, or another dream opened: these findings aren't for it
      if (response.status === 402) { router.push("/pricing"); return; }
      if (!response.ok) throw new Error(getApiErrorMessage(payload.error, lang, M.analyzeError));

      // the filled-in fields are an edit like any other: autosave them and save them on close
      formDirtyRef.current = true;
      formRevisionRef.current += 1;
      setForm((current) => {
        if (!current) return current;
        return {
          ...current,
          ...(payload.title ? { title: payload.title } : {}),
          ...(payload.mood ? { mood: payload.mood } : {}),
          ...(payload.stressScore != null ? { stressScore: String(payload.stressScore) } : {}),
          ...(payload.people?.length ? { people: payload.people.join(", ") } : {}),
          ...(payload.locations?.length ? { locations: payload.locations.join(", ") } : {}),
          ...(payload.symbols?.length ? { symbols: payload.symbols.join(", ") } : {}),
          ...(payload.sleepInsight ? { sleepInsight: payload.sleepInsight } : {}),
        };
      });

      if (payload.visualBrief) setBrief(payload.visualBrief);
      if (payload.followUpQuestions?.length) {
        setFollowUpQuestions(payload.followUpQuestions);
        setFollowUpAnswers({});
      }
      setMessage(M.analyzed);
    } catch (analyzeError) {
      if (stillHere()) setError(analyzeError instanceof Error ? analyzeError.message : M.analyzeError);
    } finally {
      if (opsRef.current.analyze === op) {
        opsRef.current.analyze = null;
        setIsAnalyzing(false);
      }
    }
  }

  function exportCurrentDream(format: DreamExportFormat) {
    if (!entry || !form) return;
    const capturedAt = form.dreamDate && form.dreamDate !== entry.capturedAt.slice(0, 10)
      ? `${form.dreamDate}T00:00:00.000Z`
      : entry.capturedAt;
    const currentEntry: DreamEntry = {
      ...entry,
      title: form.title,
      capturedAt,
      rawText: form.rawText,
      cleanText: form.cleanText.trim() || form.rawText.trim(),
      mood: form.mood,
      stressScore: form.stressScore ? Number(form.stressScore) : null,
      tags: splitCommaList(form.tags),
      people: splitCommaList(form.people),
      locations: splitCommaList(form.locations),
      symbols: splitCommaList(form.symbols),
      imageUrl: form.imageUrl,
      thumbnailUrl: form.imageUrl === entry.imageUrl ? entry.thumbnailUrl : form.imageUrl,
      assetStatus: form.assetStatus,
      sleepStart: form.sleepStart || null,
      wakeTime: form.wakeTime || null,
      sleepQuality: form.sleepQuality,
      preSleepMeal: form.preSleepMeal || null,
      preSleepActivity: form.preSleepActivity || null,
      sleepInsight: form.sleepInsight || null,
      visualBrief: localVisualBrief,
    };
    const extension = format === "json" ? "json" : "md";
    const filename = `${currentEntry.capturedAt.slice(0, 10)}-${sanitizeDreamExportFilename(dreamDisplayTitle(currentEntry))}.${extension}`;
    downloadDreamFile(buildDreamExport([currentEntry], format, lang), filename, format);
  }

  function appendAnswer(index: number) {
    const answer = followUpAnswers[index]?.trim();
    if (!answer) return;
    const appended = `\n\n${followUpQuestions[index]}\n${answer}`;
    formDirtyRef.current = true;
    formRevisionRef.current += 1;
    setForm((current) => {
      if (!current) return current;
      const next = current.rawText.trim() + appended;
      return { ...current, rawText: next, cleanText: next };
    });
    setFollowUpAnswers((prev) => { const next = { ...prev }; delete next[index]; return next; });
  }

  async function downloadImage() {
    if (!form?.imageUrl || downloadingImage || !entry) return;
    setDownloadingImage(true);
    setDownloadError("");
    try {
      // Cross-origin image links ignore `download`; a local blob URL saves the file.
      const response = await fetch(form.imageUrl, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("Image download failed");
      const blob = await response.blob();
      if (!blob.size || !blob.type.startsWith("image/")) throw new Error("Invalid image");
      const extension = ({ "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" } as Record<string, string>)[blob.type] ?? "png";
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `${(form.title || dreamDisplayTitle(entry) || "dream").replace(/[\\/:*?"<>|]/g, "_")}.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch {
      setDownloadError(M.downloadFailed);
    } finally {
      setDownloadingImage(false);
    }
  }

  const dateIso = form.dreamDate ? `${form.dreamDate}T00:00:00.000Z` : entry.capturedAt;
  const stress = form.stressScore ? Number(form.stressScore) : 0;
  const charCount = Array.from(form.rawText.replace(/\s/g, "")).length;
  const statusText = !ready ? (loadError ? "" : T.archive.nb.opening)
    : autoSaveStatus === "saving" ? M.autoSaving
    : autoSaveStatus === "saved" ? M.autoSaved
    : autoSaveStatus === "error" ? M.autoSaveFailed : "";

  return (
    <div
      className={`${s.ar} ${s.editorLayer}`}
      data-backdrop="true"
      onClick={(event) => {
        // only the dimmed desk around the book closes it; on phones the sheet fills the screen.
        // Clicks on the (inert, still loading) book fall through to the backdrop, so test the point too.
        if (!(event.target as HTMLElement).dataset.backdrop || matchMedia(PHONE).matches) return;
        const book = dialogRef.current?.querySelector(".nb-book")?.getBoundingClientRect();
        if (book && event.clientX >= book.left && event.clientX <= book.right && event.clientY >= book.top && event.clientY <= book.bottom) return;
        void closeEditor();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={s.editorDialog}
        data-backdrop="true"
      >
        <div className={s.editorTop}>
          {loadError ? (
            <p className={s.loadFail} role="alert">
              {loadError}
              <button type="button" onClick={() => { closeButtonRef.current?.focus(); onRetry(); }}>{T.archive.nb.retry}</button>
            </p>
          ) : null}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => void closeEditor()}
            disabled={saving}
            className={s.editorClose}
          >
            {M.closeBtn} <span aria-hidden>×</span>
          </button>
        </div>

        <div className={s.bookWrap} inert={!ready} aria-busy={!ready}>
        <Book tilt={false} className={s.editorBook}>
          {/* ── left: the dream as written ── */}
          <BookPage side="l" folio="p. 218" padClassName={s.scrollPad}>
            <h2 id={titleId} className="nb-kicker">{M.spreadKicker} · {dateLabel(dateIso, thisYear)}</h2>
            <input
              name="dreamTitle"
              aria-label={M.dreamTitle}
              placeholder={M.dreamTitle}
              autoComplete="off"
              value={form.title}
              onChange={(event) => updateForm({ title: event.target.value })}
              className={s.titleInput}
            />
            <div className={s.metaRow}>
              <label className={s.dateField}>
                <span className="nb-sr-only">{M.date}</span>
                <input
                  type="date"
                  name="dreamDate"
                  autoComplete="off"
                  value={form.dreamDate}
                  onChange={(event) => updateForm({ dreamDate: event.target.value })}
                />
              </label>
              <span>{weekdayLabel(dateIso, lang)}</span>
              <span>{fill(M.wordCount, { count: charCount })}</span>
              <span className={autoSaveStatus === "error" ? s.statusErr : s.status} aria-live="polite">{statusText}</span>
            </div>

            <label className={s.textField}>
              <span className="nb-sr-only">{M.dreamContent}</span>
              <textarea
                name="dreamText"
                autoComplete="off"
                value={form.rawText}
                onChange={(event) => updateForm({ rawText: event.target.value, cleanText: event.target.value })}
                rows={7}
                className={`nb-hand ${s.dreamTextarea}`}
              />
            </label>
            <button
              type="button"
              onClick={analyzeAndAsk}
              disabled={isAnalyzing || !form.rawText.trim() || saving}
              className={`nb-red-act ${s.redAct}`}
            >
              {isAnalyzing ? M.analyzingBtn : M.analyzeBtn}
            </button>

            {followUpQuestions.length > 0 && (
              <div className={`nb-slip ${s.slip}`}>
                <div className={s.slipHead}>
                  <span className={`nb-slip-label ${s.slipLabel}`}>{M.slipLabel} · {M.followUpTitle}</span>
                  <button type="button" onClick={() => setFollowUpQuestions([])} className={s.quiet}>
                    {M.followUpClose}
                  </button>
                </div>
                <p className={s.slipHint}>{M.followUpHint}</p>
                <ol className={s.questions}>
                  {followUpQuestions.map((q, i) => (
                    <li key={i}>
                      <p>{q}</p>
                      <textarea
                        name={`followUpAnswer-${i}`}
                        aria-label={`${q} ${M.answerPlaceholder}`}
                        autoComplete="off"
                        value={followUpAnswers[i] ?? ""}
                        onChange={(e) => setFollowUpAnswers((prev) => ({ ...prev, [i]: e.target.value }))}
                        placeholder={M.answerPlaceholder}
                        rows={2}
                        className="nb-hand"
                      />
                      {followUpAnswers[i]?.trim() && (
                        <button type="button" onClick={() => appendAnswer(i)} className={`nb-red-act ${s.redAct}`}>
                          {M.appendBtn}
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <fieldset className={s.sleepGrid}>
              <legend className="nb-sr-only">{M.sleepTitle}</legend>
              <label>
                <span>{M.sleepStart}</span>
                <input type="time" name="sleepStart" autoComplete="off" value={form.sleepStart} onChange={(event) => updateForm({ sleepStart: event.target.value })} />
              </label>
              <label>
                <span>{M.wakeTime}</span>
                <input type="time" name="wakeTime" autoComplete="off" value={form.wakeTime} onChange={(event) => updateForm({ wakeTime: event.target.value })} />
              </label>
              <div className={s.dotsField}>
                <span id={`${titleId}-quality`}>{M.sleepQuality}</span>
                <div className={s.dots} role="group" aria-labelledby={`${titleId}-quality`}>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-label={fill(M.qualityValue, { count: value })}
                      aria-pressed={form.sleepQuality === value}
                      className={form.sleepQuality != null && value <= form.sleepQuality ? s.dotOn : undefined}
                      onClick={() => updateForm({ sleepQuality: form.sleepQuality === value ? null : value })}
                    />
                  ))}
                </div>
              </div>
              <label className={s.span2}>
                <span>{M.activity}</span>
                <input name="preSleepActivity" autoComplete="off" value={form.preSleepActivity} onChange={(event) => updateForm({ preSleepActivity: event.target.value })} />
              </label>
              <label>
                <span>{M.meal}</span>
                <input name="preSleepMeal" autoComplete="off" value={form.preSleepMeal} onChange={(event) => updateForm({ preSleepMeal: event.target.value })} />
              </label>
            </fieldset>
          </BookPage>

          {/* ── right: what it read, the picture, and the AI's note ── */}
          <BookPage side="r" folio="p. 219" padClassName={s.scrollPad}>
            <p className="nb-kicker">{M.readKicker}</p>
            <div className={s.readGrid}>
              <div className={s.readFields}>
                <label className={s.field}>
                  <span>{M.mood}</span>
                  <input name="mood" autoComplete="off" value={form.mood} onChange={(event) => updateForm({ mood: event.target.value })} />
                </label>
                <div className={s.field}>
                  <span id={`${titleId}-stress`}>{M.stress}</span>
                  <div className={s.stress} role="group" aria-labelledby={`${titleId}-stress`}>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-label={fill(M.stressValue, { count: value })}
                        aria-pressed={stress === value}
                        className={value <= stress ? s.dashOn : undefined}
                        onClick={() => updateForm({ stressScore: stress === value ? "" : String(value) })}
                      />
                    ))}
                    <b aria-hidden>{stress ? `${stress} / 5` : ""}</b>
                  </div>
                </div>
                <div className={s.field}>
                  <span>{M.people}</span>
                  <TagChipInput value={form.people} onChange={(value) => updateForm({ people: value })} placeholder={M.tagPlaceholder} name="people" ariaLabel={M.people} />
                </div>
                <div className={s.field}>
                  <span>{M.locations}</span>
                  <TagChipInput value={form.locations} onChange={(value) => updateForm({ locations: value })} placeholder={M.tagPlaceholder} name="locations" ariaLabel={M.locations} />
                </div>
                <label className={s.field}>
                  <span>{M.symbols}</span>
                  <input name="symbols" autoComplete="off" value={form.symbols} onChange={(event) => updateForm({ symbols: event.target.value })} />
                </label>
                <label className={s.field}>
                  <span>{M.tags}</span>
                  <input name="tags" autoComplete="off" value={form.tags} onChange={(event) => updateForm({ tags: event.target.value })} />
                </label>
              </div>

              <div className={s.photoCol}>
                <figure className={`nb-print ${s.polaroid} ${form.imageUrl ? "" : s.polaroidEmpty}`}>
                  <span className="nb-tape" aria-hidden />
                  {form.imageUrl ? (
                    <PhotoLightbox src={form.imageUrl} alt={form.title ? `${M.imageAlt} · ${form.title}` : M.imageAlt} date={`${dateLabel(dateIso, thisYear)} · ${weekdayLabel(dateIso, lang)}`} title={form.title}>
                      <Image src={form.imageUrl} alt={M.imageAlt} width={1024} height={1024} unoptimized />
                    </PhotoLightbox>
                  ) : (
                    <div className={s.noPhoto}>{M.noImage}</div>
                  )}
                  <figcaption className="nb-cap">{dateLabel(dateIso, thisYear)}{form.title ? ` — ${form.title}` : ""}</figcaption>
                </figure>
                {form.imageUrl ? (
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); void downloadImage(); }}
                    disabled={downloadingImage}
                    aria-busy={downloadingImage}
                    className={s.inkAct}
                  >
                    <span aria-hidden>↓</span> {downloadingImage ? M.downloading : M.downloadFrame}
                  </button>
                ) : null}
                {downloadError && <p role="alert" className={s.err}>{downloadError}</p>}
                <button type="button" onClick={generateImage} disabled={generatingImage} className={`nb-red-act ${s.redAct}`}>
                  {generatingImage ? M.generating : form.imageUrl ? M.replaceImage : M.addImage}
                </button>
                <details className={s.promptBox}>
                  <summary>{M.promptLabel}</summary>
                  <p>{M.imageHint}</p>
                  <textarea
                    name="imagePrompt"
                    aria-label={M.promptLabel}
                    autoComplete="off"
                    rows={6}
                    value={imagePrompt}
                    onChange={(event) => {
                      setImagePrompt(event.target.value);
                      setImagePromptEdited(true);
                    }}
                  />
                  <button type="button" onClick={() => setImagePromptEdited(false)} className={s.quiet}>
                    {M.resetPrompt}
                  </button>
                </details>
              </div>
            </div>

            <label className={`nb-slip ${s.slip} ${s.insightSlip}`}>
              <span className={`nb-slip-label ${s.slipLabel}`}>{M.slipLabel} · {M.insight}</span>
              <textarea
                name="sleepInsight"
                autoComplete="off"
                rows={3}
                value={form.sleepInsight}
                placeholder={M.insightPlaceholder}
                onChange={(event) => updateForm({ sleepInsight: event.target.value })}
              />
            </label>

            {message ? <p className={s.ok} aria-live="polite">{message}</p> : null}
            {error ? <p className={s.err} role="alert">{error}</p> : null}

            <div className={s.pageFoot}>
              <button type="button" className="nb-act" onClick={() => void closeEditor()} disabled={saving}>
                {saving ? M.saving : M.keepBtn} <span aria-hidden>→</span>
              </button>
              <div className={s.quietRow}>
                <button type="button" onClick={() => exportCurrentDream("markdown")} className={s.quiet}>
                  ↓ {M.exportMarkdown}
                </button>
                <button type="button" onClick={deleteEntry} disabled={deleting} className={s.quietDanger}>
                  {deleting ? M.deleting : M.deleteBtn}
                </button>
              </div>
            </div>
          </BookPage>
        </Book>
        </div>
      </div>
    </div>
  );
}

type EditingTag = { kind: KeywordArchiveKind; label: string; draft: string };
type AddingTag = { kind: KeywordArchiveKind; draft: string; selectedIds: Set<number> };
type MergingTag = { kind: KeywordArchiveKind; label: string };
type KeywordAliases = { people: Record<string, string>; locations: Record<string, string> };

const TAG_UPDATE_CONCURRENCY = 4;

async function updateInBatches<T>(items: T[], update: (item: T) => Promise<void>): Promise<void> {
  for (let index = 0; index < items.length; index += TAG_UPDATE_CONCURRENCY) {
    const results = await Promise.allSettled(items.slice(index, index + TAG_UPDATE_CONCURRENCY).map(update));
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
}

/** Monday-to-Sunday week (UTC dates) that holds `date`. */
function weekRange(date: Date): [number, number] {
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - ((date.getUTCDay() + 6) % 7) * 86_400_000;
  return [start, start + 7 * 86_400_000];
}

export default function DreamGrid({
  entries,
  nextCursor: initialNextCursor,
  activeTab,
  onTabChange,
  exporter,
  dataError,
}: {
  entries: DreamEntry[];
  nextCursor: string | null;
  activeTab: ArchiveTab;
  onTabChange: (tab: ArchiveTab) => void;
  exporter: ArchiveExporter;
  dataError: string;
}) {
  const { lang, T } = useLanguage();
  const A = T.archive;
  const G = A.grid;
  const N = A.nb;
  const [localEntries, setLocalEntries] = useState(entries);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");
  const [selected, setSelected] = useState<DreamEntry | null>(null);
  const [openingEntryId, setOpeningEntryId] = useState<number | null>(null);
  // The calendar's selected night (shown on the right-hand page) and which of its dreams is open there.
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [selectedDayEntryId, setSelectedDayEntryId] = useState<number | null>(null);
  const [activeKeyword, setActiveKeyword] = useState<KeywordArchiveItem | null>(null);
  const [editingTag, setEditingTag] = useState<EditingTag | null>(null);
  const [addingTag, setAddingTag] = useState<AddingTag | null>(null);
  const [mergingTag, setMergingTag] = useState<MergingTag | null>(null);
  const [tagActionMenu, setTagActionMenu] = useState<string | null>(null);
  const [tagBusy, setTagBusy] = useState(false);
  const [tagError, setTagError] = useState("");
  const bookRef = useRef<HTMLDivElement>(null);
  // the fields list pages leave out (inline image, visual brief), per dream, once a full copy was seen;
  // the editor can then open it straight away without a refetch
  const fullCopies = useRef(new Map<number, Pick<DreamEntry, "imageUrl" | "thumbnailUrl" | "assetStatus" | "visualBrief">>());
  const rememberFull = (full: DreamEntry) => {
    fullCopies.current.set(full.id, { imageUrl: full.imageUrl, thumbnailUrl: full.thumbnailUrl, assetStatus: full.assetStatus, visualBrief: full.visualBrief });
  };
  // each open gets a number; a late reply for an earlier open is ignored
  const openSeq = useRef(0);
  const openerRef = useRef<HTMLElement | null>(null);
  const turning = useRef(false);
  // while the right-hand page turns over to open a dream, the page beneath reads as a fresh sheet
  const [turningAway, setTurningAway] = useState(false);
  const [readyId, setReadyId] = useState<number | null>(null);
  const [openError, setOpenError] = useState("");
  const [notice, setNotice] = useState("");
  const [clock, setClock] = useState<Clock | null>(null);
  const uid = useId();
  const tabId = (tab: ArchiveTab) => `${uid}-tab-${tab}`;
  const leftPageId = `${uid}-left`;
  const rightPageId = `${uid}-right`;

  // Keyword aliases — when a keyword is merged into another, store the alias for future normalization
  const [keywordAliases, setKeywordAliasesState] = useState<KeywordAliases>({ people: {}, locations: {} });

  // Person relationships — stored in localStorage, keyed by normalized name
  const [personRelationships, setPersonRelationshipsState] = useState<Record<string, string>>({});
  const [editingRelKey, setEditingRelKey] = useState<string | null>(null);
  const [relDraft, setRelDraft] = useState("");

  // Person genders — stored in localStorage, keyed by normalized name
  const [personGenders, setPersonGendersState] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const stored = localStorage.getItem("dreamReel_personRelationships");
      if (stored) setPersonRelationshipsState(JSON.parse(stored) as Record<string, string>);
    } catch {}
    try {
      const stored = localStorage.getItem("dreamReel_personGenders");
      if (stored) setPersonGendersState(JSON.parse(stored) as Record<string, string>);
    } catch {}
    try {
      const stored = localStorage.getItem("dreamReel_keywordAliases");
      if (stored) setKeywordAliasesState(JSON.parse(stored) as KeywordAliases);
    } catch {}
  }, []);

  // a tag's action menu closes on Escape or a click anywhere else
  useEffect(() => {
    if (!tagActionMenu) return;
    const onPointer = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest("[data-tag-menu]")) setTagActionMenu(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setTagActionMenu(null); };
    addEventListener("pointerdown", onPointer);
    addEventListener("keydown", onKey);
    return () => { removeEventListener("pointerdown", onPointer); removeEventListener("keydown", onKey); };
  }, [tagActionMenu]);

  function saveKeywordAlias(kind: KeywordArchiveKind, fromLabel: string, intoLabel: string) {
    setKeywordAliasesState((prev) => {
      const next = { ...prev, [kind]: { ...prev[kind], [normalizeKeyword(fromLabel)]: intoLabel } };
      try { localStorage.setItem("dreamReel_keywordAliases", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function savePersonRelationship(personKey: string, value: string) {
    setPersonRelationshipsState((prev) => {
      const next = value.trim() ? { ...prev, [personKey]: value.trim() } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== personKey));
      localStorage.setItem("dreamReel_personRelationships", JSON.stringify(next));
      return next;
    });
    setEditingRelKey(null);
  }

  function savePersonGender(personKey: string, value: string) {
    setPersonGendersState((prev) => {
      const next = value ? { ...prev, [personKey]: value } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== personKey));
      localStorage.setItem("dreamReel_personGenders", JSON.stringify(next));
      return next;
    });
  }

  useEffect(() => {
    setLocalEntries(entries);
    fullCopies.current.clear();
  }, [entries]);

  useEffect(() => {
    setClock(readClock());
  }, []);

  const { monthKeys, buckets, totalDays } = useMemo(() => {
    const dayBuckets = new Map<string, DayBucket>();

    for (const entry of localEntries) {
      const date = new Date(entry.capturedAt);
      const key = formatDayKey(date);
      const existing = dayBuckets.get(key);

      if (existing) {
        existing.entries.push(entry);
      } else {
        dayBuckets.set(key, {
          date,
          entries: [entry],
        });
      }
    }

    const sortedMonthKeys = Array.from(
      new Set(
        Array.from(dayBuckets.values()).map((bucket) => {
          const year = bucket.date.getUTCFullYear();
          const month = String(bucket.date.getUTCMonth() + 1).padStart(2, "0");
          return `${year}-${month}`;
        }),
      ),
    ).sort((a, b) => (a < b ? 1 : -1));

    for (const bucket of dayBuckets.values()) {
      bucket.entries.sort((a, b) => +new Date(a.capturedAt) - +new Date(b.capturedAt));
    }

    return {
      monthKeys: sortedMonthKeys,
      buckets: dayBuckets,
      totalDays: dayBuckets.size,
    };
  }, [localEntries]);

  const [activeMonth, setActiveMonth] = useState(monthKeys[0] ?? localDayKey(new Date()).slice(0, 7));
  const visibleMonth = activeMonth;
  const selectableMonths = Array.from(new Set([...monthKeys, visibleMonth])).sort().reverse();

  function changeMonth(offset: number) {
    if (turning.current) return; // the page is in the air
    tap();
    setActiveMonth((current) => {
      const [year, month] = current.split("-").map(Number);
      return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
    });
  }
  const calendarCells = useMemo(
    () => (visibleMonth ? buildCalendarCells(visibleMonth, buckets, clock?.todayKey ?? null) : []),
    [visibleMonth, buckets, clock],
  );
  const keywordArchives = useMemo(
    () => ({
      people: buildKeywordArchive(localEntries, "people", keywordAliases.people),
      locations: buildKeywordArchive(localEntries, "locations", keywordAliases.locations),
    }),
    [localEntries, keywordAliases],
  );
  const symbolCounts = useMemo(() => topCounts(localEntries.flatMap((entry) => Array.from(new Set(entry.symbols))), 8), [localEntries]);

  // ── calendar: the month's nights, the one on the right-hand page, and the month's recurring image ──
  const monthCells = calendarCells.filter((cell) => cell.entries.length > 0);
  const monthEntryCount = monthCells.reduce((sum, cell) => sum + cell.entries.length, 0);
  const dayKey = selectedDayKey && monthCells.some((cell) => cell.key === selectedDayKey)
    ? selectedDayKey
    : monthCells[monthCells.length - 1]?.key ?? null;
  const dayEntries = dayKey ? buckets.get(dayKey)?.entries ?? [] : [];
  const shownEntry = dayEntries.find((entry) => entry.id === selectedDayEntryId) ?? dayEntries[0] ?? null;
  const monthTop = topCounts(monthCells.flatMap((cell) => cell.entries.flatMap((entry) => Array.from(new Set(entry.symbols)))), 1)[0];
  const monthSymbol = monthTop && monthTop.count >= 2 ? monthTop.item : null;
  const hasSymbol = (entry: DreamEntry, symbol: string) => entry.symbols.some((item) => normalizeKeyword(item) === normalizeKeyword(symbol));

  // List pages leave out inline (data URL) images. Fetch them for the open night so its photo can be
  // taped on, and merge only the image fields: anything edited meanwhile (autosave, rename, merge) stays.
  const shownId = shownEntry?.id ?? null;
  const shownOmitted = Boolean(shownEntry?.imageUrlOmitted) && activeTab === "calendar";
  useEffect(() => {
    if (shownId == null || !shownOmitted) return;
    const controller = new AbortController();
    fetch(`/api/dreams?id=${shownId}`, { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ entry?: DreamEntry }> : null))
      .then((payload) => {
        const full = payload?.entry;
        if (!full || controller.signal.aborted) return;
        setLocalEntries((current) => current.map((item) => (
          // a newer full copy (e.g. from a save) already replaced the list version: leave it alone
          item.id === full.id && item.imageUrlOmitted
            ? { ...item, imageUrl: full.imageUrl, thumbnailUrl: full.thumbnailUrl, imageUrlOmitted: undefined, assetStatus: full.assetStatus, visualBrief: full.visualBrief }
            : item
        )));
        rememberFull(full);
      })
      .catch(() => {}); // stays omitted; the next visit to this night tries again
    return () => controller.abort();
  }, [shownId, shownOmitted]);

  /** How many times this symbol had appeared by this dream (inclusive), across the loaded archive. */
  function symbolOrdinal(entry: DreamEntry, symbol: string): number {
    const at = +new Date(entry.capturedAt);
    return localEntries.filter((item) => +new Date(item.capturedAt) <= at && hasSymbol(item, symbol)).length;
  }

  // ── recent: newest first, and a recap of the week holding the newest dream ──
  const recentEntries = useMemo(
    () => [...localEntries].sort((a, b) => +new Date(b.capturedAt) - +new Date(a.capturedAt)),
    [localEntries],
  );
  // the year shown dates are compared against: the reader's year once mounted, the newest dream's before
  const thisYear = clock?.year ?? (recentEntries[0] ? new Date(recentEntries[0].capturedAt).getUTCFullYear() : 0);
  const recap = useMemo(() => {
    const latest = recentEntries[0];
    if (!latest) return null;
    const [start, end] = weekRange(new Date(latest.capturedAt));
    const inRange = (from: number, to: number) => recentEntries.filter((entry) => {
      const t = +new Date(entry.capturedAt);
      return t >= from && t < to;
    });
    const week = inRange(start, end);
    const previous = inRange(start - 7 * 86_400_000, start);
    // the recap reads loaded dreams only; it is exact once they reach back past last week
    const oldest = recentEntries[recentEntries.length - 1];
    const complete = !nextCursor || +new Date(oldest.capturedAt) < start - 7 * 86_400_000;
    const moods = topCounts(week.flatMap((entry) => splitMood(entry.mood)), 2);
    const places = topCounts(week.flatMap((entry) => entry.locations), 2);
    const symbols = topCounts(week.flatMap((entry) => Array.from(new Set(entry.symbols))), 1);
    const person = topCounts(week.flatMap((entry) => Array.from(new Set(entry.people))), 1)[0];
    // the symbol and place that shared the most nights this week
    let pair: { a: string; b: string; n: number } | null = null;
    const pairCounts = new Map<string, { a: string; b: string; n: number }>();
    for (const entry of week) {
      for (const symbol of new Set(entry.symbols)) {
        for (const place of new Set(entry.locations)) {
          const key = `${normalizeKeyword(symbol)}|${normalizeKeyword(place)}`;
          const item = pairCounts.get(key) ?? { a: symbol, b: place, n: 0 };
          item.n += 1;
          pairCounts.set(key, item);
          if (!pair || item.n > pair.n) pair = item;
        }
      }
    }
    const slip = [
      moods[0] ? fill(N.slipMood, { mood: moods[0].item }) : "",
      pair && (pair as { n: number }).n >= 2
        ? fill(N.slipPair, { a: (pair as { a: string }).a, b: (pair as { b: string }).b })
        : person && person.count >= 2 ? fill(N.slipPerson, { person: person.item, count: person.count }) : "",
    ].filter(Boolean);
    if (slip.length === 0) slip.push(fill(N.slipCount, { count: week.length }));
    return {
      // "this week" means the week holding the reader's own today (as a UTC date, like the dreams)
      current: clock ? clock.todayUtc >= start && clock.todayUtc < end : false,
      complete,
      range: `${dateLabel(new Date(start).toISOString(), thisYear)} – ${shortDate(new Date(end - 86_400_000).toISOString())}`,
      count: week.length,
      diff: week.length - previous.length,
      moods,
      places,
      symbol: symbols[0] ?? null,
      slip,
    };
  }, [recentEntries, N, clock, nextCursor, thisYear]);

  async function patchEntryTag(entry: DreamEntry, patch: { people?: string[]; locations?: string[] }) {
    const res = await fetch("/api/dreams", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: entry.id,
        ...patch,
      }),
    });
    if (!res.ok) throw new Error("Update failed");
  }

  // one request per dream at a time: a turn's prefetch and the open that follows it share it
  const inflight = useRef(new Map<number, Promise<{ ok: boolean; entry?: DreamEntry; error?: string }>>());
  function fetchFull(id: number) {
    let pending = inflight.current.get(id);
    if (!pending) {
      pending = fetch(`/api/dreams?id=${id}`, { cache: "no-store" })
        .then(async (response) => ({ ok: response.ok, ...((await response.json()) as { entry?: DreamEntry; error?: string }) }))
        .finally(() => inflight.current.delete(id));
      inflight.current.set(id, pending);
    }
    return pending;
  }

  /** Opens the editor. "turned": the page already turned over (and made its sound) on the way here. */
  async function openEntry(entry: DreamEntry, mode: "open" | "retry" | "turned" = "open") {
    const seq = ++openSeq.current;
    if (mode === "open") {
      // remember who opened it before the button disables itself while loading
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      unlock();
      pageTurn({ dur: 0.7 });
    }
    setOpenError("");
    setOpeningEntryId(null);
    const known = fullCopies.current.get(entry.id);
    if (known) {
      setSelected({ ...entry, ...known, imageUrlOmitted: undefined });
      setReadyId(entry.id);
      return;
    }
    // the list copy lacks inline images and the visual brief; the editor stays read-only until the
    // full entry arrives, so no save can overwrite those fields with nulls
    setSelected(entry);
    setReadyId(null);
    setOpeningEntryId(entry.id);
    try {
      const payload = await fetchFull(entry.id);
      if (seq !== openSeq.current) return; // closed, or another dream was opened meanwhile
      if (!payload.ok || !payload.entry) throw new Error(getApiErrorMessage(payload.error, lang, N.openFailed));
      const full = payload.entry;
      rememberFull(full);
      setSelected(full);
      setReadyId(full.id);
      setLocalEntries((current) => current.map((item) => (item.id === full.id ? full : item)));
    } catch (error) {
      if (seq === openSeq.current) setOpenError(error instanceof Error ? error.message : N.openFailed);
    } finally {
      if (seq === openSeq.current) setOpeningEntryId(null);
    }
  }

  async function handleRenameTag(kind: KeywordArchiveKind, oldLabel: string, newLabel: string) {
    const trimmed = newLabel.trim();
    if (!trimmed || normalizeKeyword(trimmed) === normalizeKeyword(oldLabel)) {
      setEditingTag(null);
      return;
    }
    const item = keywordArchives[kind].find((i) => normalizeKeyword(i.label) === normalizeKeyword(oldLabel));
    if (!item) { setEditingTag(null); return; }
    setTagBusy(true);
    setTagError("");
    try {
      await updateInBatches(item.entries, async (entry) => {
        const field = kind === "people" ? entry.people : entry.locations;
        await patchEntryTag(entry, { [kind]: field.map((t) => normalizeKeyword(t) === normalizeKeyword(oldLabel) ? trimmed : t) });
      });
      setLocalEntries((prev) => prev.map((entry) => {
        const field = kind === "people" ? entry.people : entry.locations;
        if (!field.some((t) => normalizeKeyword(t) === normalizeKeyword(oldLabel))) return entry;
        return { ...entry, [kind]: field.map((t) => normalizeKeyword(t) === normalizeKeyword(oldLabel) ? trimmed : t) };
      }));
      setEditingTag(null);
      if (activeKeyword?.kind === kind && normalizeKeyword(activeKeyword.label) === normalizeKeyword(oldLabel)) setActiveKeyword(null);
    } catch (e) { console.error(e); setTagError(N.tagFailed); } finally { setTagBusy(false); }
  }

  async function handleMergeTag(kind: KeywordArchiveKind, fromLabel: string, intoLabel: string) {
    if (normalizeKeyword(fromLabel) === normalizeKeyword(intoLabel)) { setMergingTag(null); return; }
    const item = keywordArchives[kind].find((i) => normalizeKeyword(i.label) === normalizeKeyword(fromLabel));
    if (!item) { setMergingTag(null); return; }
    const msg = fill(N.mergeConfirm, { from: fromLabel, count: item.count, into: intoLabel });
    if (!window.confirm(msg)) return;
    setTagBusy(true);
    setTagError("");
    try {
      await updateInBatches(item.entries, async (entry) => {
        const field = kind === "people" ? entry.people : entry.locations;
        await patchEntryTag(entry, { [kind]: field.map((t) => normalizeKeyword(t) === normalizeKeyword(fromLabel) ? intoLabel : t) });
      });
      setLocalEntries((prev) => prev.map((entry) => {
        const field = kind === "people" ? entry.people : entry.locations;
        if (!field.some((t) => normalizeKeyword(t) === normalizeKeyword(fromLabel))) return entry;
        return { ...entry, [kind]: field.map((t) => normalizeKeyword(t) === normalizeKeyword(fromLabel) ? intoLabel : t) };
      }));
      // Store alias so future auto-saved dreams get remapped
      saveKeywordAlias(kind, fromLabel, intoLabel);
      // Transfer relationship/gender metadata to canonical if not already set
      if (kind === "people") {
        const fromKey = normalizeKeyword(fromLabel);
        const intoKey = normalizeKeyword(intoLabel);
        if (personRelationships[fromKey] && !personRelationships[intoKey]) savePersonRelationship(intoKey, personRelationships[fromKey]);
        if (personGenders[fromKey] && !personGenders[intoKey]) savePersonGender(intoKey, personGenders[fromKey]);
      }
      setMergingTag(null);
      if (activeKeyword?.kind === kind && normalizeKeyword(activeKeyword.label) === normalizeKeyword(fromLabel)) setActiveKeyword(null);
    } catch (e) { console.error(e); setTagError(N.tagFailed); } finally { setTagBusy(false); }
  }

  async function handleDeleteTag(item: KeywordArchiveItem) {
    const msg = fill(N.deleteTagConfirm, { count: item.count, label: item.label });
    if (!window.confirm(msg)) return;
    setTagBusy(true);
    setTagError("");
    try {
      await updateInBatches(item.entries, async (entry) => {
        const field = item.kind === "people" ? entry.people : entry.locations;
        await patchEntryTag(entry, { [item.kind]: field.filter((t) => normalizeKeyword(t) !== normalizeKeyword(item.label)) });
      });
      setLocalEntries((prev) => prev.map((entry) => {
        const field = item.kind === "people" ? entry.people : entry.locations;
        if (!field.some((t) => normalizeKeyword(t) === normalizeKeyword(item.label))) return entry;
        return { ...entry, [item.kind]: field.filter((t) => normalizeKeyword(t) !== normalizeKeyword(item.label)) };
      }));
      if (activeKeyword?.kind === item.kind && normalizeKeyword(activeKeyword.label) === normalizeKeyword(item.label)) setActiveKeyword(null);
    } catch (e) { console.error(e); setTagError(N.tagFailed); } finally { setTagBusy(false); }
  }

  async function handleAddTag() {
    if (!addingTag || !addingTag.draft.trim() || addingTag.selectedIds.size === 0) return;
    const newLabel = addingTag.draft.trim();
    const { kind, selectedIds } = addingTag;
    const targets = localEntries.filter((e) => selectedIds.has(e.id));
    setTagBusy(true);
    setTagError("");
    try {
      await updateInBatches(targets, async (entry) => {
        const field = kind === "people" ? entry.people : entry.locations;
        if (field.some((t) => normalizeKeyword(t) === normalizeKeyword(newLabel))) return;
        await patchEntryTag(entry, { [kind]: [...field, newLabel] });
      });
      setLocalEntries((prev) => prev.map((entry) => {
        if (!selectedIds.has(entry.id)) return entry;
        const field = kind === "people" ? entry.people : entry.locations;
        if (field.some((t) => normalizeKeyword(t) === normalizeKeyword(newLabel))) return entry;
        return { ...entry, [kind]: [...field, newLabel] };
      }));
      setAddingTag(null);
    } catch (e) { console.error(e); setTagError(N.tagFailed); } finally { setTagBusy(false); }
  }

  function handleSaved(updatedEntry: DreamEntry) {
    rememberFull(updatedEntry);
    setLocalEntries((current) => current.map((item) => (item.id === updatedEntry.id ? updatedEntry : item)));
  }

  function handleDeleted(id: number) {
    setLocalEntries((current) => current.filter((item) => item.id !== id));
    setSelected(null);
    setActiveKeyword((current) => {
      if (!current) return current;
      const remainingEntries = current.entries.filter((entry) => entry.id !== id);
      if (remainingEntries.length === 0) return null;
      return { ...current, count: remainingEntries.length, entries: remainingEntries };
    });
  }

  async function loadMoreEntries() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError("");
    try {
      const response = await fetch(`/api/dreams?limit=24&cursor=${encodeURIComponent(nextCursor)}`);
      const payload = await response.json() as {
        entries?: DreamEntry[];
        nextCursor?: string | null;
        error?: string;
      };
      if (!response.ok || !payload.entries) {
        throw new Error(getApiErrorMessage(payload.error, lang, N.loadMoreFailed));
      }
      setLocalEntries((current) => {
        const knownIds = new Set(current.map((entry) => entry.id));
        return [...current, ...payload.entries!.filter((entry) => !knownIds.has(entry.id))];
      });
      setNextCursor(payload.nextCursor ?? null);
    } catch (error) {
      setLoadMoreError(error instanceof Error ? error.message : N.loadMoreFailed);
    } finally {
      setLoadingMore(false);
    }
  }

  // back to whatever opened the editor; if it is gone or still disabled, the open night, then the tab
  const restoreFocus = useCallback(() => {
    // Safari leaves activeElement on <body> after a mouse click, so body never counts as the opener
    const usable = (el: HTMLElement | null | undefined): el is HTMLElement =>
      Boolean(el && el !== document.body && el.isConnected && !(el as HTMLButtonElement).disabled);
    const candidates = [
      openerRef.current,
      document.querySelector<HTMLElement>(".nb-stage [aria-current='true']"),
      document.querySelector<HTMLElement>(".nb-stage [role='tab'][aria-selected='true']"),
    ];
    candidates.find(usable)?.focus();
  }, []);

  // ── turning between the bookmarks: the right-hand page lifts and turns on desktop ──
  function turnTo(tab: ArchiveTab) {
    if (tab === activeTab || turning.current) return;
    const book = bookRef.current;
    if (!book || matchMedia(PHONE).matches) { tap(); onTabChange(tab); return; }
    unlock();
    turning.current = true; // one sheet in the air at a time
    flipPage(book, { dur: 720, onStart: () => onTabChange(tab), onEnd: () => { turning.current = false; } });
  }

  // ── turning to a dream's own spread: the right-hand page turns over on desktop, then the editor opens ──
  function turnToEntry(entry: DreamEntry) {
    if (turning.current) return;
    const book = bookRef.current;
    if (!book || matchMedia(`${PHONE}, (prefers-reduced-motion: reduce)`).matches) { void openEntry(entry); return; }
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    unlock();
    turning.current = true;
    prefetchFull(entry); // fetched while the sheet is in the air, so the spread opens ready
    flipPage(book, {
      dur: 760,
      onStart: () => setTurningAway(true),
      onEnd: () => { turning.current = false; void openEntry(entry, "turned"); setTurningAway(false); },
    });
  }

  function prefetchFull(entry: DreamEntry) {
    if (fullCopies.current.has(entry.id)) return;
    fetchFull(entry.id)
      .then((payload) => { if (payload.ok && payload.entry && !fullCopies.current.has(entry.id)) rememberFull(payload.entry); })
      .catch(() => {}); // openEntry tries again and shows the error
  }

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, tab: ArchiveTab) {
    const order: ArchiveTab[] = ["calendar", "tags", "recent"];
    const at = order.indexOf(tab);
    const target = event.key === "ArrowDown" || event.key === "ArrowRight" ? order[(at + 1) % order.length]
      : event.key === "ArrowUp" || event.key === "ArrowLeft" ? order[(at + order.length - 1) % order.length]
      : event.key === "Home" ? order[0]
      : event.key === "End" ? order[order.length - 1]
      : null;
    if (!target) return;
    event.preventDefault();
    if (turning.current || target === tab) return;
    document.getElementById(tabId(target))?.focus();
    turnTo(target);
  }

  function selectDay(cell: CalendarCell) {
    const lead = cell.entries[0];
    if (!lead || turning.current) return;
    // a second tap on the open night turns to its page
    if (cell.key === dayKey) { turnToEntry(shownEntry ?? lead); return; }
    tap();
    setSelectedDayKey(cell.key);
    setSelectedDayEntryId(null);
    if (matchMedia(PHONE).matches) {
      requestAnimationFrame(() => document.getElementById(rightPageId)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  const tabLabel = (tab: ArchiveTab) => tab === "calendar" ? G.tabCalendar : tab === "tags" ? G.tabTags : G.tabRecent;
  const timesLabel = (count: number) => fill(N.timesAria, { count });
  const oldestMonth = monthKeys[monthKeys.length - 1];

  // ── small shared pieces ──
  const exportLinks = (withJson: boolean) => (
    <>
      <button type="button" className={s.quiet} onClick={() => exporter.run("markdown")} disabled={exporter.busy}>
        {exporter.busy ? A.export.exporting : `↓ ${A.export.markdown}`}
      </button>
      {withJson ? (
        <button type="button" className={s.quiet} onClick={() => exporter.run("json")} disabled={exporter.busy}>
          {A.export.json}
        </button>
      ) : null}
    </>
  );
  const exportError = exporter.error ? <p className={s.err} role="alert">{exporter.error}</p> : null;
  const loadMore = nextCursor || loadMoreError ? (
    <div className={s.loadMore}>
      {nextCursor ? (
        <button type="button" onClick={() => void loadMoreEntries()} disabled={loadingMore} className={s.quiet}>
          {loadingMore ? N.loadingMore : `↓ ${N.loadMore}`}
        </button>
      ) : null}
      {loadMoreError ? <p className={s.err} role="alert">{loadMoreError}</p> : null}
    </div>
  ) : null;
  const dataNotice = dataError ? (
    <div className={s.notice} role="alert">
      <p className={s.noticeTitle}>{A.dbErrorTitle}</p>
      <p>{dataError}</p>
      <p className={s.noticeHint}>{A.dbErrorHint}</p>
    </div>
  ) : null;

  const tabs = (
    <div className={s.bookmarks} role="tablist" aria-label={N.tabsLabel} aria-orientation="vertical">
      {(["calendar", "tags", "recent"] as const).map((tab) => (
        <button
          key={tab}
          id={tabId(tab)}
          type="button"
          role="tab"
          aria-selected={activeTab === tab}
          aria-controls={`${leftPageId} ${rightPageId}`}
          tabIndex={activeTab === tab ? 0 : -1}
          onClick={() => turnTo(tab)}
          onKeyDown={(event) => onTabKeyDown(event, tab)}
          className={activeTab === tab ? s.bookmarkOn : s.bookmark}
        >
          {tabLabel(tab)}
        </button>
      ))}
    </div>
  );

  const pageProps = (side: "l" | "r") => ({
    id: side === "l" ? leftPageId : rightPageId,
    role: "tabpanel",
    "aria-labelledby": tabId(activeTab),
  });

  // ── empty archive ──
  if (localEntries.length === 0) {
    return (
      <main className={`nb-stage ${s.ar}`} id="main">
        <Book ref={bookRef} tilt={false}>
          <BookPage side="l" folio="p. 1" padClassName={s.pad}>
            <span className="nb-kicker">{N.emptyKicker}</span>
            <h1 className={s.bigTitle}>{N.emptyTitle}</h1>
            <p className={`nb-hand ${s.emptyBody}`}>{N.emptyBody}</p>
            {dataNotice}
          </BookPage>
          <BookPage side="r" folio="p. 2" padClassName={s.pad}>
            <p className={s.emptyNote}>{G.empty}</p>
            <div className={s.pageFoot}>
              <TurnLink href="/journal" className="nb-act">{N.newDream} <span aria-hidden>→</span></TurnLink>
              <div className={s.quietRow}>
                <TurnLink href="/morning-pages" className={s.quiet}>{T.nav.morningPages}</TurnLink>
              </div>
            </div>
          </BookPage>
        </Book>
      </main>
    );
  }

  // ── people / places row ──
  function keywordRow(item: KeywordArchiveItem, items: KeywordArchiveItem[]) {
    const menuKey = `${item.kind}-${item.label}`;
    const isEditing = editingTag?.kind === item.kind && normalizeKeyword(editingTag.label) === normalizeKeyword(item.label);
    const isActive = activeKeyword?.kind === item.kind && normalizeKeyword(activeKeyword.label) === normalizeKeyword(item.label);
    const isMerging = mergingTag?.kind === item.kind && normalizeKeyword(mergingTag.label) === normalizeKeyword(item.label);
    const personKey = normalizeKeyword(item.label);
    const rel = item.kind === "people" ? personRelationships[personKey] : undefined;
    const gender = item.kind === "people" ? personGenders[personKey] : undefined;
    const genderOpts = [{ v: "male", label: N.genderMale }, { v: "female", label: N.genderFemale }, { v: "other", label: N.genderOther }];
    const genderText = genderOpts.find((o) => o.v === gender)?.label;
    const isEditingRel = item.kind === "people" && editingRelKey === personKey;

    return (
      <li key={menuKey} className={isActive ? s.rowOn : s.row}>
        {isEditing ? (
          <div className={s.inlineEdit}>
            <input
              value={editingTag.draft}
              aria-label={N.renameLabel}
              onChange={(e) => setEditingTag({ ...editingTag, draft: e.target.value })}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleRenameTag(item.kind, item.label, editingTag.draft);
                if (e.key === "Escape") setEditingTag(null);
              }}
            />
            <button type="button" className={`nb-red-act ${s.redAct}`} onClick={() => void handleRenameTag(item.kind, item.label, editingTag.draft)} disabled={tagBusy}>
              {tagBusy ? N.saving : N.save}
            </button>
            <button type="button" className={s.quiet} onClick={() => setEditingTag(null)}>{N.cancel}</button>
          </div>
        ) : (
          <div className={s.rowMain}>
            <button type="button" className={s.rowName} aria-pressed={isActive} onClick={() => setActiveKeyword(isActive ? null : item)}>
              {item.label}
              {rel || genderText ? <small>{[rel, genderText].filter(Boolean).join(" · ")}</small> : null}
            </button>
            <Count count={item.count} label={timesLabel(item.count)} />
            <div className={s.menuWrap} data-tag-menu>
              <button
                type="button"
                className={s.menuBtn}
                aria-label={fill(N.manage, { label: item.label })}
                aria-expanded={tagActionMenu === menuKey}
                onClick={() => setTagActionMenu((current) => current === menuKey ? null : menuKey)}
                disabled={tagBusy}
              >
                <span aria-hidden>⋯</span>
              </button>
              {tagActionMenu === menuKey ? (
                <div className={s.menu}>
                  <button type="button" onClick={() => { setEditingTag({ kind: item.kind, label: item.label, draft: item.label }); setMergingTag(null); setTagActionMenu(null); }} disabled={tagBusy}>
                    {N.rename}
                  </button>
                  <button type="button" onClick={() => { setMergingTag(isMerging ? null : { kind: item.kind, label: item.label }); setEditingTag(null); setTagActionMenu(null); }} disabled={tagBusy || items.length < 2}>
                    {N.mergeInto}
                  </button>
                  {item.kind === "people" ? (
                    <button type="button" onClick={() => { setRelDraft(rel ?? ""); setEditingRelKey(personKey); setTagActionMenu(null); }}>
                      {N.relation}
                    </button>
                  ) : null}
                  <button type="button" className={s.menuDanger} onClick={() => { setTagActionMenu(null); void handleDeleteTag(item); }} disabled={tagBusy}>
                    {N.deleteTag}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {isMerging && !isEditing ? (
          <div className={s.subPanel}>
            <span className={s.subLabel}>{N.mergeLabel}</span>
            <div className={s.wordList}>
              {items
                .filter((other) => normalizeKeyword(other.label) !== normalizeKeyword(item.label))
                .map((other) => (
                  <button key={other.label} type="button" onClick={() => void handleMergeTag(item.kind, item.label, other.label)} disabled={tagBusy}>
                    {other.label}
                  </button>
                ))}
            </div>
            <button type="button" className={s.quiet} onClick={() => setMergingTag(null)}>{N.cancel}</button>
          </div>
        ) : null}

        {isEditingRel && !isEditing ? (
          <div className={s.subPanel}>
            <span className={s.subLabel}>{N.relationLabel}</span>
            <div className={s.wordList} role="group" aria-label={N.relationLabel}>
              {N.relationOptions.map((opt) => (
                <button key={opt} type="button" aria-pressed={relDraft === opt} onClick={() => setRelDraft(relDraft === opt ? "" : opt)}>{opt}</button>
              ))}
            </div>
            <div className={s.inlineEdit}>
              <input
                value={relDraft}
                aria-label={N.relationPlaceholder}
                onChange={(e) => setRelDraft(e.target.value)}
                placeholder={N.relationPlaceholder}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") savePersonRelationship(personKey, relDraft);
                  if (e.key === "Escape") setEditingRelKey(null);
                }}
              />
            </div>
            <span className={s.subLabel}>{N.genderLabel}</span>
            <div className={s.wordList}>
              {genderOpts.map(({ v, label }) => (
                <button key={v} type="button" aria-pressed={gender === v} onClick={() => savePersonGender(personKey, gender === v ? "" : v)}>{label}</button>
              ))}
            </div>
            <div className={s.inlineActions}>
              <button type="button" className={`nb-red-act ${s.redAct}`} onClick={() => savePersonRelationship(personKey, relDraft)}>{N.done}</button>
              <button type="button" className={s.quiet} onClick={() => setEditingRelKey(null)}>{N.cancel}</button>
            </div>
          </div>
        ) : null}
      </li>
    );
  }

  function addPanel(kind: KeywordArchiveKind) {
    if (addingTag?.kind !== kind) return null;
    return (
      <div className={s.addPanel}>
        <div className={s.inlineEdit}>
          <input
            value={addingTag.draft}
            aria-label={N.newTagLabel}
            onChange={(e) => setAddingTag({ ...addingTag, draft: e.target.value })}
            placeholder={N.newTagPlaceholder}
            autoFocus
            onKeyDown={(e) => e.key === "Escape" && setAddingTag(null)}
          />
        </div>
        {addingTag.draft.trim() && (
          <>
            <span className={s.subLabel}>{N.selectDreams}</span>
            <ul className={s.pickList}>
              {recentEntries.map((entry) => {
                const on = addingTag.selectedIds.has(entry.id);
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        const next = new Set(addingTag.selectedIds);
                        if (on) next.delete(entry.id); else next.add(entry.id);
                        setAddingTag({ ...addingTag, selectedIds: next });
                      }}
                    >
                      <i aria-hidden>{on ? "✓" : ""}</i>
                      <DateMark value={entry.capturedAt} thisYear={thisYear} className={s.pickDate} />
                      {dreamDisplayTitle(entry)}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className={s.inlineActions}>
              <button type="button" className={`nb-red-act ${s.redAct}`} onClick={() => void handleAddTag()} disabled={tagBusy || addingTag.selectedIds.size === 0}>
                {tagBusy ? N.saving : fill(N.addTo, { count: addingTag.selectedIds.size })}
              </button>
              <button type="button" className={s.quiet} onClick={() => setAddingTag(null)}>{N.cancel}</button>
            </div>
          </>
        )}
      </div>
    );
  }

  function keywordSection(kind: KeywordArchiveKind, kicker: string, empty: string, title?: string) {
    const items = keywordArchives[kind];
    return (
      <section className={s.kwSection} aria-busy={tagBusy}>
        <div className={s.secHead}>
          <h2 className="nb-kicker">{kicker}</h2>
          <button
            type="button"
            className={s.quietRed}
            onClick={() => setAddingTag(addingTag?.kind === kind ? null : { kind, draft: "", selectedIds: new Set() })}
            disabled={tagBusy}
            aria-expanded={addingTag?.kind === kind}
          >
            {addingTag?.kind === kind ? N.closeAdd : N.add}
          </button>
        </div>
        {title ? <p className={s.bigTitle} aria-hidden>{title}</p> : null}
        {addPanel(kind)}
        {items.length > 0
          ? <ul className={s.kwList}>{items.map((item) => keywordRow(item, items))}</ul>
          : <p className={s.emptyNote}>{empty}</p>}
      </section>
    );
  }

  function entryList(list: DreamEntry[]) {
    return (
      <ul className={s.entryList}>
        {list.map((entry) => (
          <li key={entry.id}>
            <button type="button" onClick={() => void openEntry(entry)} disabled={openingEntryId === entry.id}>
              <DateMark value={entry.capturedAt} thisYear={thisYear} className={s.entryDate} />
              <span className={s.entryBody}>
                <span className={s.entryTitle}>{dreamDisplayTitle(entry)}</span>
                <span className={s.entryExcerpt}>{dreamText(entry) || N.noText}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  const folios = activeTab === "calendar" ? ["p. 246", "p. 247"] : activeTab === "tags" ? ["p. 248", "p. 249"] : ["p. 250", "p. 251"];
  const [yearText, monthText] = visibleMonth.split("-");
  const monthDisplay = lang === "en"
    ? <>{new Date(Date.UTC(Number(yearText), Number(monthText) - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} {yearText}</>
    : <>{yearText}<small>{N.yearMark}</small>{Number(monthText)}<small>{N.monthMark}</small></>;
  const shownImage = shownEntry ? shownEntry.thumbnailUrl || shownEntry.imageUrl : null;

  return (
    <>
      <main className={`nb-stage ${s.ar}`} id="main">
        <Book ref={bookRef} tilt={false}>
          {tabs}

          {/* ═════════ left-hand page ═════════ */}
          <BookPage side="l" folio={folios[0]} padClassName={s.pad} {...pageProps("l")}>
            <h1 className="nb-sr-only">{A.title}</h1>
            {dataNotice}

            {activeTab === "calendar" && (
              <>
                <div className={s.monthHead}>
                  <label className={s.monthPick}>
                    <span className={s.monthTitle} aria-hidden>{monthDisplay}</span>
                    <select value={visibleMonth} onChange={(event) => { if (turning.current) return; tap(); setActiveMonth(event.target.value); }} aria-label={G.monthFilter}>
                      {selectableMonths.map((monthKey) => (
                        <option key={monthKey} value={monthKey}>{formatMonthLabel(monthKey, lang)}</option>
                      ))}
                    </select>
                  </label>
                  <div className={s.monthArrows}>
                    <button type="button" onClick={() => changeMonth(-1)} aria-label={G.prev}>←</button>
                    <button type="button" onClick={() => changeMonth(1)} aria-label={G.next}>→</button>
                  </div>
                </div>
                <p className={s.monthStats}>
                  <span>{fill(N.monthStats, { count: monthEntryCount, days: monthCells.length })}</span>
                  <span title={`${G.total} · ${G.dreamDays} · ${G.months}`}>{fill(N.totals, { total: localEntries.length, days: totalDays, months: monthKeys.length })}</span>
                  {monthSymbol ? <span className={s.legend}><i aria-hidden />{fill(N.legend, { symbol: monthSymbol })}</span> : null}
                </p>
                {nextCursor && visibleMonth <= oldestMonth ? loadMore : null}

                <div className={s.weekdays} aria-hidden>
                  {G.weekLabels.map((label) => <span key={label}>{label}</span>)}
                </div>
                <div key={visibleMonth} className={s.calGrid}>
                  {calendarCells.map((cell) => {
                    if (!cell.date) return <div key={cell.key} className={s.cellBlank} />;
                    const lead = cell.entries[0] ?? null;
                    const day = cell.date.getUTCDate();
                    if (!lead) {
                      return (
                        <div key={cell.key} className={s.cell}>
                          <span className={cell.isToday ? s.dayToday : s.day}>{day}</span>
                        </div>
                      );
                    }
                    const circled = monthSymbol ? cell.entries.some((entry) => hasSymbol(entry, monthSymbol)) : false;
                    const dayLabel = formatDateTime(cell.date.toISOString(), lang);
                    const isSel = cell.key === dayKey;
                    return (
                      <button
                        key={cell.key}
                        type="button"
                        className={isSel ? s.cellOn : s.cellHas}
                        aria-current={isSel ? "true" : undefined}
                        aria-label={`${dayLabel} · ${cell.entries.map(dreamDisplayTitle).join(N.listSep)}${cell.entries.length > 1 ? ` · ${fill(N.dayCount, { count: cell.entries.length })}` : ""}`}
                        disabled={openingEntryId === lead.id}
                        onClick={() => selectDay(cell)}
                      >
                        <span className={`${cell.isToday ? s.dayToday : s.day} ${circled ? s.circled : ""}`}>{day}</span>
                        <span className={s.cellTitle}>{dreamDisplayTitle(lead)}</span>
                        {cell.entries.length > 1 ? <span className={s.cellMore}>+{cell.entries.length - 1}</span> : null}
                        <i className={s.cellDot} aria-hidden />
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {activeTab === "tags" && (
              <>
                {tagError ? <p className={s.err} role="alert">{tagError}</p> : null}
                {keywordSection("people", N.peopleKicker, N.emptyPeople, N.peopleTitle)}
                {keywordArchives.people.length > 0 ? <p className={`nb-note ${s.hint}`}>{N.peopleHint}</p> : null}
              </>
            )}

            {activeTab === "recent" && (
              <>
                <h2 className="nb-kicker">{N.recentKicker}</h2>
                <div className={s.scrollList}>
                  {entryList(recentEntries)}
                  {loadMore}
                </div>
              </>
            )}
          </BookPage>

          {/* ═════════ right-hand page ═════════ */}
          <BookPage
            side="r"
            folio={folios[1]}
            curl
            className={turningAway ? s.turningAway : undefined}
            padInert={turningAway}
            padClassName={`${s.pad} ${s.padScroll}`}
            {...pageProps("r")}
            corner={activeTab === "calendar" && shownEntry ? (
              <PageCorner
                key={shownEntry.id}
                label={`${N.openPage} · ${dreamDisplayTitle(shownEntry)}`}
                hint={N.openPage}
                liftedNote={N.cornerLifted}
                busy={openingEntryId === shownEntry.id}
                onTurn={() => turnToEntry(shownEntry)}
              />
            ) : null}
          >
            {activeTab === "calendar" && (
              shownEntry ? (
                <>
                  <p className="nb-kicker">{dateLabel(shownEntry.capturedAt, thisYear)} · {weekdayLabel(shownEntry.capturedAt, lang)}</p>
                  {dayEntries.length > 1 ? (
                    <div className={s.dayPicker} role="group" aria-label={N.dayPicker}>
                      {dayEntries.map((entry, i) => (
                        <button key={entry.id} type="button" aria-pressed={entry.id === shownEntry.id} onClick={() => { tap(); setSelectedDayEntryId(entry.id); }}>
                          {i + 1} · {dreamDisplayTitle(entry)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <h2 className={s.dreamTitle}>{dreamDisplayTitle(shownEntry)}</h2>
                  <p key={shownEntry.id} ref={dreamScroll} className={`nb-hand ${s.excerpt}`}>{dreamFullText(shownEntry) || N.noText}</p>
                  {shownEntry.people.length || shownEntry.locations.length || shownEntry.symbols.length ? (
                    <p className={`nb-note ${s.clues}`}>
                      {shownEntry.people.length ? <span>{N.cluePeople} · {shownEntry.people.join(N.listSep)}</span> : null}
                      {shownEntry.locations.length ? <span>{N.clueLocations} · {shownEntry.locations.join(N.listSep)}</span> : null}
                      {shownEntry.symbols[0] ? (
                        <span>
                          {N.clueSymbols} · {shownEntry.symbols[0]}
                          {symbolOrdinal(shownEntry, shownEntry.symbols[0]) > 1 ? fill(N.ordinal, { count: symbolOrdinal(shownEntry, shownEntry.symbols[0]) }) : ""}
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                  {shownImage ? (
                    <figure className={`nb-print ${s.dayPhoto}`}>
                      <span className="nb-tape" aria-hidden />
                      <PhotoLightbox
                        src={shownEntry.imageUrl || shownImage}
                        alt={`${T.modal.imageAlt} · ${dreamDisplayTitle(shownEntry)}`}
                        date={`${dateLabel(shownEntry.capturedAt, thisYear)} · ${weekdayLabel(shownEntry.capturedAt, lang)}`}
                        title={dreamDisplayTitle(shownEntry)}
                      >
                        <Image src={shownImage} alt={T.modal.imageAlt} width={320} height={240} unoptimized />
                      </PhotoLightbox>
                      <figcaption className="nb-cap">{dateLabel(shownEntry.capturedAt, thisYear)}</figcaption>
                    </figure>
                  ) : null}
                  {exportError}
                  {/* the way on is the page's corner (PageCorner); the foot keeps clear of it */}
                  <div className={`${s.pageFoot} ${s.footClear}`}>
                    <div className={s.quietRow}>{exportLinks(false)}</div>
                  </div>
                </>
              ) : (
                <>
                  <p className="nb-kicker">{formatMonthLabel(visibleMonth, lang)}</p>
                  <p className={s.emptyNote}>{N.emptyMonth}</p>
                  {nextCursor && visibleMonth > oldestMonth ? loadMore : null}
                  {exportError}
                  <div className={s.pageFoot}>
                    <TurnLink href="/journal" className="nb-act">{N.newDream} <span aria-hidden>→</span></TurnLink>
                    <div className={s.quietRow}>{exportLinks(false)}</div>
                  </div>
                </>
              )
            )}

            {activeTab === "tags" && (
              <>
                {activeKeyword ? (
                  <section className={s.kwDetail} aria-live="polite">
                    <div className={s.secHead}>
                      <h2 className="nb-kicker">
                        {activeKeyword.kind === "people" ? N.peopleKicker : N.locationsKicker} · {fill(N.keywordMeta, { count: activeKeyword.count })}
                      </h2>
                      <button type="button" className={s.quiet} onClick={() => setActiveKeyword(null)}>{N.closeDetail} ×</button>
                    </div>
                    <p className={s.bigTitle}>{activeKeyword.label}</p>
                    {activeKeyword.moods.length || activeKeyword.symbols.length ? (
                      <p className={s.kwMeta}>
                        {activeKeyword.moods.length ? <span>{N.moodLabel} · {activeKeyword.moods.map((m) => m.item).join(" / ")}</span> : null}
                        {activeKeyword.symbols.length ? <span>{N.themesLabel} · {activeKeyword.symbols.map((m) => m.item).join(" / ")}</span> : null}
                      </p>
                    ) : null}
                    <h3 className={s.subLabel}>{N.relatedLabel}</h3>
                    <div className={s.scrollList}>{entryList(activeKeyword.entries)}</div>
                  </section>
                ) : (
                  <>
                    {keywordSection("locations", N.locationsKicker, N.emptyLocations)}
                    <section className={`${s.kwSection} ${s.symbolsSection}`}>
                      <div className={s.secHead}><h2 className="nb-kicker">{N.symbolsKicker}</h2></div>
                      {symbolCounts.length > 0 ? (
                        <ul className={s.kwList}>
                          {symbolCounts.slice(0, 6).map((item) => (
                            <li key={item.item} className={s.row}>
                              <div className={s.rowMain}>
                                <span className={s.rowName}>{item.item}</span>
                                <Count count={item.count} label={timesLabel(item.count)} />
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : <p className={s.emptyNote}>{N.emptySymbols}</p>}
                    </section>
                  </>
                )}
                {exportError}
                <div className={s.pageFoot}>
                  <span className={s.footStats}>
                    {fill(N.footStats, { count: localEntries.length, month: formatMonthLabel(oldestMonth, lang) })}
                    {loadMore}
                  </span>
                  <div className={s.quietRow}>{exportLinks(false)}</div>
                </div>
              </>
            )}

            {activeTab === "recent" && recap && (
              <>
                <h2 className="nb-kicker">{recap.current ? N.recapThisWeek : N.recapLatestWeek} · {recap.range}</h2>
                <dl className={s.recap}>
                  <dt>{N.recapEntries}</dt>
                  <dd>
                    {fill(N.recapCount, { count: recap.count })}
                    {recap.diff > 0 ? fill(N.recapMore, { count: recap.diff }) : recap.diff < 0 ? fill(N.recapFewer, { count: -recap.diff }) : N.recapSame}
                  </dd>
                  <dt>{N.recapMoods}</dt>
                  <dd>{recap.moods.length ? recap.moods.map((m) => m.item).join(N.listSep) : N.recapNone}</dd>
                  <dt>{N.recapPlaces}</dt>
                  <dd>{recap.places.length ? recap.places.map((m) => m.item).join(N.listSep) : N.recapNone}</dd>
                  <dt>{N.recapSymbols}</dt>
                  <dd>
                    {recap.symbol ? recap.symbol.item : N.recapNone}
                    {recap.symbol && recap.symbol.count > 1 ? <span className="nb-note">{fill(N.recapSymbolNote, { count: recap.symbol.count })}</span> : null}
                  </dd>
                </dl>
                {!recap.complete ? (
                  <p className={s.recapScope}>{fill(N.recapPartial, { count: localEntries.length })}</p>
                ) : null}
                <div className={`nb-slip ${s.slip} ${s.recapSlip}`}>
                  <span className={`nb-slip-label ${s.slipLabel}`}>{T.modal.slipLabel}</span>
                  {recap.slip.map((line) => <p key={line}>{line}</p>)}
                </div>
                {exportError}
                <div className={s.pageFoot}>
                  <TurnLink href="/journal" className="nb-act">{N.newDream} <span aria-hidden>→</span></TurnLink>
                  <div className={s.quietRow}>
                    <Link href="/morning-pages" className={s.quiet}>{T.nav.morningPages}</Link>
                    {exportLinks(true)}
                  </div>
                </div>
              </>
            )}
          </BookPage>
        </Book>
      </main>

      {notice ? (
        <div className={`${s.ar} ${s.noticeSlip}`} role="alert">
          <p>{notice}</p>
          <button type="button" onClick={() => setNotice("")}>{N.closeDetail} ×</button>
        </div>
      ) : null}

      <DreamEditorModal
        entry={selected}
        ready={selected != null && readyId === selected.id && !selected.imageUrlOmitted}
        loadError={openError}
        onRetry={() => { if (selected) void openEntry(selected, "retry"); }}
        thisYear={thisYear}
        restoreFocus={restoreFocus}
        onNotice={setNotice}
        onClose={() => { openSeq.current += 1; setSelected(null); setReadyId(null); setOpenError(""); setOpeningEntryId(null); }}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />
    </>
  );
}
