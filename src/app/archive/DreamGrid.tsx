"use client";

import Image from "next/image";
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
import { formatDateTime, formatMonthLabel } from "@/lib/i18n";
import { getApiErrorMessage } from "@/lib/apiErrors";

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


function formatDayKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function moodAccent(mood: string): string {
  if (!mood) return "from-white/75 via-white/30 to-transparent text-[#706786]";
  const m = mood.toLowerCase();
  if (/惊|恐|害怕|噩|fear|scar|terr|night/.test(m)) return "from-[#edd2dc] via-[#f7e7ed] to-transparent text-[#9a7180]";
  if (/平|静|安|宁|calm|peace|serene|tranquil/.test(m)) return "from-[#d5e6df] via-[#edf6f2] to-transparent text-[#648475]";
  if (/兴|奋|开心|快|excit|happy|joy|elat/.test(m)) return "from-[#eddcc8] via-[#f8efe6] to-transparent text-[#9c7e61]";
  if (/怀旧|回忆|思|nostalgic|memor/.test(m)) return "from-[#e7ddd7] via-[#f5efea] to-transparent text-[#8e7c70]";
  if (/压|重|绝|沉|depress|heavy|despair/.test(m)) return "from-[#dddcea] via-[#f1f0f8] to-transparent text-[#767287]";
  if (/迷|惑|困|confus|uncertain|lost/.test(m)) return "from-[#ddd4ef] via-[#f2eef9] to-transparent text-[#7e719f]";
  return "from-[#d7cdea] via-[#ebf0f7] to-transparent text-[#7b7295]";
}

function moodGradient(mood: string): string {
  if (!mood) return "from-[#f6f0fb] via-[#efedf8] to-[#e6eef6]";
  const m = mood.toLowerCase();
  if (/惊|恐|害怕|噩|fear|scar|terr|night/.test(m)) return "from-[#f4dde4] via-[#f8ecef] to-[#f2edf4]";
  if (/平|静|安|宁|calm|peace|serene|tranquil/.test(m)) return "from-[#ddece6] via-[#eef6f2] to-[#edf3f6]";
  if (/兴|奋|开心|快|excit|happy|joy|elat/.test(m)) return "from-[#f0e3d3] via-[#faf2ea] to-[#f3eef6]";
  if (/怀旧|回忆|思|nostalgic|memor/.test(m)) return "from-[#ece2dc] via-[#f8f1ed] to-[#f1edf3]";
  if (/压|重|绝|沉|depress|heavy|despair/.test(m)) return "from-[#e7e4ef] via-[#f5f4f9] to-[#eceff5]";
  if (/迷|惑|困|confus|uncertain|lost/.test(m)) return "from-[#e3daf1] via-[#f4f0fa] to-[#edf1f7]";
  return "from-[#e6ddf1] via-[#f5f2fb] to-[#eaf1f8]";
}

function buildCalendarCells(monthKey: string, buckets: Map<string, DayBucket>): CalendarCell[] {
  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText) - 1;
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = (firstDay.getDay() + 6) % 7;
  const todayKey = formatDayKey(new Date());
  const cells: CalendarCell[] = [];

  for (let i = 0; i < leading; i += 1) {
    cells.push({ key: `empty-${monthKey}-${i}`, date: null, entries: [], isToday: false });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
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

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("hidden"));
}

function useModalFocus(isOpen: boolean, onClose: () => void, initialFocusRef?: React.RefObject<HTMLElement | null>) {
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
      returnFocusRef.current?.focus();
    };
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
    <div className="mist-input flex min-h-[2.75rem] flex-wrap items-center gap-1.5 rounded-[1rem] px-3 py-2 transition focus-within:ring-2 focus-within:ring-[#8f82bc]/50">
      {chips.map((chip, i) => (
        <span
          key={`${chip}-${i}`}
          className="flex items-center gap-1 rounded-full bg-white/60 px-2.5 py-0.5 text-xs text-[#655c79]"
        >
          {chip}
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); removeChip(i); }}
            className="flex h-5 w-5 items-center justify-center rounded-full text-[#b0a0c8] hover:text-[#6b5f80] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6b5f80]"
            aria-label={`删除 ${chip}`}
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
        className="min-w-[80px] flex-1 bg-transparent text-sm text-[#5f5673] placeholder:text-[#b0a8c0]"
      />
    </div>
  );
}

function DreamEditorModal({
  entry,
  onClose,
  onSaved,
  onDeleted,
}: {
  entry: DreamEntry | null;
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
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [followUpAnswers, setFollowUpAnswers] = useState<Record<number, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [localVisualBrief, setLocalVisualBrief] = useState<string | null>(null);
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const closeEditor = useCallback(async () => {
    if (!entry || !form || saving) return;
    if (formRevisionRef.current === savedRevisionRef.current) {
      onClose();
      return;
    }

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
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
  // updateEntry is intentionally defined below and only reads the current form state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, form, onClose, onSaved, saving]);

  const { dialogRef, onKeyDown } = useModalFocus(Boolean(entry && form), () => void closeEditor(), closeButtonRef);

  useEffect(() => {
    formDirtyRef.current = false;
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
    setForm(toEditForm(entry));
    setLocalVisualBrief(entry.visualBrief ?? null);
    setImagePromptEdited(false);
    setFollowUpQuestions([]);
    setFollowUpAnswers({});
    setMessage("");
    setError("");
    setAutoSaveStatus("idle");
  }, [entry]);

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
    formDirtyRef.current = true;
    formRevisionRef.current += 1;
    setForm((prev) => prev ? { ...prev, ...patch } : prev);
  }

  // Debounced auto-save: fires 1.5s after the last form change
  const triggerAutoSave = useCallback((currentForm: DreamEditForm) => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    setAutoSaveStatus("saving");
    const savingRevision = formRevisionRef.current;
    autoSaveTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          const updatedEntry = await updateEntry(currentForm);
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
  }, [onSaved]);

  useEffect(() => {
    if (!form || !formDirtyRef.current) return;
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

  const inputCls = "mist-input w-full rounded-[1rem] px-3.5 py-2.5 text-sm transition";

  function buildUpdateBody(currentForm: DreamEditForm) {
    if (!entry) return null;

    return {
      id: entry.id,
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
      visualBrief: entry?.visualBrief ?? null,
    };
  }

  async function updateEntry(currentForm: DreamEditForm): Promise<DreamEntry> {
    const body = buildUpdateBody(currentForm);
    if (!body) throw new Error(M.updateFailed);

    const response = await fetch("/api/dreams", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

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
  }

  async function saveEntry() {
    if (!entry || !form) return;
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const updatedEntry = await updateEntry(form);
      onSaved(updatedEntry);
      setMessage(M.savedMsg);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : M.updateFailed);
    } finally {
      setSaving(false);
    }
  }

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

    setGeneratingImage(true);
    setMessage("");
    setError("");

    try {
      // Build gender context from people in this dream
      const dreamPeople = form?.people ?? [];
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
          visualBrief: localVisualBrief,
          dreamText: form?.rawText ?? null,
          genderContext: genderContext || null,
        }),
      });
      const payload = (await response.json()) as { imageUrl?: string; revisedPrompt?: string | null; error?: string };
      if (response.status === 402) { router.push("/pricing"); return; }
      if (!response.ok || !payload.imageUrl) {
        throw new Error(getApiErrorMessage(payload.error, lang, M.noImageError));
      }

      if (!form) return;
      const nextForm: DreamEditForm = { ...form, imageUrl: payload.imageUrl ?? null, assetStatus: "generated" };
      setForm(nextForm);
      setImagePrompt(payload.revisedPrompt ?? prompt);
      setImagePromptEdited(true);
      const updatedEntry = await updateEntry(nextForm);
      onSaved(updatedEntry);
      setMessage(lang === "en" ? "New image generated and saved to this dream." : "新图片已经生成，并已保存到这条梦境档案。");
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : M.noImageError);
    } finally {
      setGeneratingImage(false);
    }
  }

  async function analyzeAndAsk() {
    if (!form?.rawText.trim()) {
      setError(M.dreamError);
      return;
    }
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
      if (response.status === 402) { router.push("/pricing"); return; }
      if (!response.ok) throw new Error(getApiErrorMessage(payload.error, lang, M.analyzeError));

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

      if (payload.visualBrief) setLocalVisualBrief(payload.visualBrief);
      if (payload.followUpQuestions?.length) {
        setFollowUpQuestions(payload.followUpQuestions);
        setFollowUpAnswers({});
      }
      setMessage(lang === "en" ? "Analysis complete. Fields filled in — adjust as needed." : "分析完成，字段已自动填入，可手动调整。");
    } catch (analyzeError) {
      setError(analyzeError instanceof Error ? analyzeError.message : M.analyzeError);
    } finally {
      setIsAnalyzing(false);
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(232,225,242,0.58)] backdrop-blur-xl sm:items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) void closeEditor();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="mist-card relative max-h-[94vh] w-full max-w-4xl overflow-y-auto overscroll-y-contain rounded-t-[2rem] p-5 sm:rounded-[2rem] sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Modal header — full width, close button always visible */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#998db9]">{M.eyebrow}</p>
            <h2 id={titleId} className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[#5f5673]">{M.title}</h2>
            <p className="mist-muted mt-2 text-sm leading-7">{M.desc}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => void closeEditor()}
            disabled={saving}
            className="mist-button-secondary shrink-0 flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-[#6b6282] transition hover:bg-white/55"
          >
            <span aria-hidden>✕</span>
            <span>{M.closeBtn}</span>
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-5">

            <label className="grid gap-2">
              <span className="mist-label text-xs font-medium">{M.dreamTitle}</span>
              <input
                name="dreamTitle"
                autoComplete="off"
                value={form.title}
                onChange={(event) => updateForm({ title: event.target.value })}
                className={inputCls}
              />
            </label>

            <label className="grid gap-2">
              <span className="mist-label text-xs font-medium">{M.dreamContent}</span>
              <textarea
                name="dreamText"
                autoComplete="off"
                value={form.rawText}
                onChange={(event) => updateForm({ rawText: event.target.value, cleanText: event.target.value })}
                rows={7}
                className="mist-input min-h-[15rem] w-full rounded-[1.6rem] px-4 py-4 text-sm leading-7 transition"
              />
              <button
                type="button"
                onClick={analyzeAndAsk}
                disabled={isAnalyzing || !form.rawText.trim() || saving}
                className="mist-button-secondary inline-flex w-fit items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-[#7690a7] transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isAnalyzing ? M.analyzingBtn : M.analyzeBtn}
              </button>
            </label>

            {followUpQuestions.length > 0 && (
              <div className="mist-card rounded-[1.6rem] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8f82bc]">{M.followUpTitle}</p>
                  <button
                    type="button"
                    onClick={() => setFollowUpQuestions([])}
                    className="mist-soft text-xs transition hover:text-[#695f80]"
                  >
                    {M.followUpClose}
                  </button>
                </div>
                <p className="mist-soft mt-1 text-xs">{M.followUpHint}</p>
                <div className="mt-3 grid gap-3">
                  {followUpQuestions.map((q, i) => (
                    <div key={i} className="rounded-[1.2rem] bg-white/30 p-3">
                      <p className="text-sm leading-6 text-[#655c79]">{q}</p>
                      <textarea
                        name={`followUpAnswer-${i}`}
                        aria-label={`${q} ${M.answerPlaceholder}`}
                        autoComplete="off"
                        value={followUpAnswers[i] ?? ""}
                        onChange={(e) => setFollowUpAnswers((prev) => ({ ...prev, [i]: e.target.value }))}
                        placeholder={M.answerPlaceholder}
                        rows={2}
                        className="mist-input mt-2 w-full resize-none rounded-[0.9rem] px-3 py-2 text-sm"
                      />
                      {followUpAnswers[i]?.trim() && (
                        <button
                          type="button"
                          onClick={() => appendAnswer(i)}
                          className="mist-button-secondary mt-2 rounded-full px-3 py-1 text-xs transition hover:bg-white/48"
                        >
                          {M.appendBtn}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="mist-label text-xs font-medium">{M.date}</span>
                <input
                  type="date"
                  name="dreamDate"
                  autoComplete="off"
                  value={form.dreamDate}
                  onChange={(event) => updateForm({ dreamDate: event.target.value })}
                  className={inputCls}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="mist-label text-xs font-medium">{M.mood}</span>
                <input
                  name="mood"
                  autoComplete="off"
                  value={form.mood}
                  onChange={(event) => updateForm({ mood: event.target.value })}
                  className={inputCls}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="mist-label text-xs font-medium">{M.stress}</span>
                <input
                  type="number"
                  name="stressScore"
                  min={1}
                  max={5}
                  value={form.stressScore}
                  onChange={(event) => updateForm({ stressScore: event.target.value })}
                  className={inputCls}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="mist-label text-xs font-medium">{M.tags}</span>
                <input
                  name="tags"
                  autoComplete="off"
                  value={form.tags}
                  onChange={(event) => updateForm({ tags: event.target.value })}
                  className={inputCls}
                />
              </label>
              <div className="grid gap-1.5">
                <span className="mist-label text-xs font-medium">{M.people}</span>
                <TagChipInput
                  value={form.people}
                  onChange={(value) => updateForm({ people: value })}
                  placeholder={M.tagPlaceholder}
                  name="people"
                  ariaLabel={M.people}
                />
              </div>
              <div className="grid gap-1.5">
                <span className="mist-label text-xs font-medium">{M.locations}</span>
                <TagChipInput
                  value={form.locations}
                  onChange={(value) => updateForm({ locations: value })}
                  placeholder={M.tagPlaceholder}
                  name="locations"
                  ariaLabel={M.locations}
                />
              </div>
              <label className="grid gap-1.5 sm:col-span-2">
                <span className="mist-label text-xs font-medium">{M.symbols}</span>
                <input
                  name="symbols"
                  autoComplete="off"
                  value={form.symbols}
                  onChange={(event) => updateForm({ symbols: event.target.value })}
                  className={inputCls}
                />
              </label>
            </div>

            <div className="mist-card rounded-[1.6rem] p-4">
              <p className="text-sm font-medium text-[#8f82bc]">{M.sleepTitle}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="mist-label text-xs font-medium">{M.sleepStart}</span>
                  <input type="time" name="sleepStart" autoComplete="off" value={form.sleepStart} onChange={(event) => updateForm({ sleepStart: event.target.value })} className={inputCls} />
                </label>
                <label className="grid gap-1.5">
                  <span className="mist-label text-xs font-medium">{M.wakeTime}</span>
                  <input type="time" name="wakeTime" autoComplete="off" value={form.wakeTime} onChange={(event) => updateForm({ wakeTime: event.target.value })} className={inputCls} />
                </label>
                <div className="grid gap-1.5">
                  <span className="mist-label text-xs font-medium">{M.sleepQuality}</span>
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => updateForm({ sleepQuality: form.sleepQuality === value ? null : value })}
                        className={form.sleepQuality === value
                          ? "mist-button flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold"
                          : "mist-button-secondary flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-[#726887]"}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="grid gap-1.5">
                  <span className="mist-label text-xs font-medium">{M.meal}</span>
                  <input name="preSleepMeal" autoComplete="off" value={form.preSleepMeal} onChange={(event) => updateForm({ preSleepMeal: event.target.value })} className={inputCls} />
                </label>
                <label className="grid gap-1.5 sm:col-span-2">
                  <span className="mist-label text-xs font-medium">{M.activity}</span>
                  <input name="preSleepActivity" autoComplete="off" value={form.preSleepActivity} onChange={(event) => updateForm({ preSleepActivity: event.target.value })} className={inputCls} />
                </label>
                <label className="grid gap-1.5 sm:col-span-2">
                  <span className="mist-label text-xs font-medium">{M.insight}</span>
                  <textarea
                    name="sleepInsight"
                    autoComplete="off"
                    rows={4}
                    value={form.sleepInsight}
                    onChange={(event) => updateForm({ sleepInsight: event.target.value })}
                    className="mist-input w-full rounded-[1.2rem] px-3.5 py-3 text-sm leading-7 transition"
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="mist-card rounded-[1.8rem] p-4">
              <p className="text-sm font-medium text-[#8f82bc]">{M.imageTitle}</p>
              <p className="mist-soft mt-1 text-xs">{M.imageHint}</p>

              <div className={`group relative mt-4 overflow-hidden rounded-[1.5rem] bg-gradient-to-br ${moodGradient(form.mood)}`}>
                {form.imageUrl ? (
                  <>
                    <Image
                      src={form.imageUrl}
                      alt="梦境图"
                      width={1024}
                      height={1024}
                      unoptimized
                      className="h-[18rem] w-full object-cover"
                    />
                    <a
                      href={form.imageUrl}
                      download={`${(form.title || dreamDisplayTitle(entry)).replace(/[\\/:*?"<>|]/g, "_")}.png`}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-base text-white/90 opacity-0 backdrop-blur-sm transition-opacity duration-200 hover:bg-black/60 group-hover:opacity-100"
                      title={M.downloadImage}
                    >
                      ↓
                    </a>
                  </>
                ) : (
                  <div className="flex h-[18rem] items-center justify-center text-sm text-[#766f8e]">
                    {M.noImage}
                  </div>
                )}
              </div>

              <label className="mt-4 grid gap-1.5">
                <span className="mist-label text-xs font-medium">{M.promptLabel}</span>
                <textarea
                  name="imagePrompt"
                  autoComplete="off"
                  rows={7}
                  value={imagePrompt}
                  onChange={(event) => {
                    setImagePrompt(event.target.value);
                    setImagePromptEdited(true);
                  }}
                  className="mist-input w-full rounded-[1.4rem] px-4 py-3 text-sm leading-7 transition"
                />
              </label>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={generateImage}
                  disabled={generatingImage}
                  className="mist-button rounded-full px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {generatingImage ? M.generating : form.imageUrl ? M.replaceImage : M.addImage}
                </button>
                <button
                  type="button"
                  onClick={() => setImagePromptEdited(false)}
                  className="mist-button-secondary rounded-full px-4 py-2 text-sm font-medium transition hover:bg-white/48"
                >
                  {M.resetPrompt}
                </button>

              </div>
            </div>

            <div className="mist-card rounded-[1.8rem] p-4">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => exportCurrentDream("markdown")}
                  className="mist-button-secondary rounded-full px-4 py-2.5 text-sm font-medium text-[#756a90] transition hover:bg-white/55"
                >
                  ↓ {M.exportMarkdown}
                </button>
                <button
                  type="button"
                  onClick={() => exportCurrentDream("json")}
                  className="mist-button-secondary rounded-full px-4 py-2.5 text-sm font-medium text-[#756a90] transition hover:bg-white/55"
                >
                  ↓ {M.exportJson}
                </button>
                <button
                  type="button"
                  onClick={deleteEntry}
                  disabled={deleting}
                  className="mist-button-secondary rounded-full border-[#b8758f]/40 px-5 py-2.5 text-sm font-medium text-[#c58aa0] transition hover:bg-[#4a1f34]/24 disabled:opacity-50"
                >
                  {deleting ? M.deleting : M.deleteBtn}
                </button>
                <span className="text-xs text-[#9d90b8]" aria-live="polite">
                  {autoSaveStatus === "saving" ? (lang === "zh" ? "保存中…" : "Saving…") :
                   autoSaveStatus === "saved" ? (lang === "zh" ? "已保存 ✓" : "Saved ✓") :
                   autoSaveStatus === "error" ? (lang === "zh" ? "保存失败" : "Save failed") : ""}
                </span>
              </div>
              {message ? <p className="mt-4 text-sm font-medium text-[#7f9c8b]" aria-live="polite">{message}</p> : null}
              {error ? <p className="mt-4 text-sm font-medium text-[#bb7f94]" role="alert">{error}</p> : null}
            </div>
          </div>
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

export default function DreamGrid({
  entries,
  nextCursor: initialNextCursor,
  activeTab,
}: {
  entries: DreamEntry[];
  nextCursor: string | null;
  activeTab: "calendar" | "tags" | "recent";
}) {
  const { lang, T } = useLanguage();
  const G = T.archive.grid;
  const [localEntries, setLocalEntries] = useState(entries);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");
  const [selected, setSelected] = useState<DreamEntry | null>(null);
  const [openingEntryId, setOpeningEntryId] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<{ label: string; entries: DreamEntry[] } | null>(null);
  const dayDialogTitleId = useId();
  const dayCloseButtonRef = useRef<HTMLButtonElement>(null);
  const closeDayDialog = useCallback(() => setSelectedDay(null), []);
  const { dialogRef: dayDialogRef, onKeyDown: onDayDialogKeyDown } = useModalFocus(Boolean(selectedDay), closeDayDialog, dayCloseButtonRef);
  const [activeKeyword, setActiveKeyword] = useState<KeywordArchiveItem | null>(null);
  const [editingTag, setEditingTag] = useState<EditingTag | null>(null);
  const [addingTag, setAddingTag] = useState<AddingTag | null>(null);
  const [mergingTag, setMergingTag] = useState<MergingTag | null>(null);
  const [tagActionMenu, setTagActionMenu] = useState<string | null>(null);
  const [tagBusy, setTagBusy] = useState(false);
  const [tagError, setTagError] = useState("");


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
  }, [entries]);

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

  const [activeMonth, setActiveMonth] = useState(monthKeys[0] ?? "");

  useEffect(() => {
    if (!monthKeys.includes(activeMonth)) {
      setActiveMonth(monthKeys[0] ?? "");
    }
  }, [activeMonth, monthKeys]);

  const activeIndex = monthKeys.indexOf(activeMonth);
  const visibleMonth = activeMonth || monthKeys[0] || "";
  const calendarCells = useMemo(
    () => (visibleMonth ? buildCalendarCells(visibleMonth, buckets) : []),
    [visibleMonth, buckets],
  );
  const keywordArchives = useMemo(
    () => ({
      people: buildKeywordArchive(localEntries, "people", keywordAliases.people),
      locations: buildKeywordArchive(localEntries, "locations", keywordAliases.locations),
    }),
    [localEntries, keywordAliases],
  );
  const keywordLabels = lang === "en"
    ? {
        eyebrow: "Structured memory index",
        title: "People & Places Archive",
        desc: "Dream Reel groups the people and locations extracted from your dream text, so recurring figures and spaces become easier to revisit.",
        people: "People",
        locations: "Places",
        appears: "appears",
        dreams: "dreams",
        mood: "mood",
        themes: "themes",
        related: "Related dreams",
        emptyPeople: "No people have been extracted yet.",
        emptyLocations: "No places have been extracted yet.",
      }
    : {
        eyebrow: "结构化记忆索引",
        title: "人物与地点标签",
        desc: "Dream Reel 会把梦境文本中识别出的人物和地点聚合起来，让反复出现的关系、空间和场景变得可以回看。",
        people: "人物",
        locations: "地点",
        appears: "出现",
        dreams: "个梦境",
        mood: "情绪",
        themes: "主题",
        related: "相关梦境",
        emptyPeople: "还没有识别到人物。",
        emptyLocations: "还没有识别到地点。",
      };

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

  async function openEntry(entry: DreamEntry) {
    setSelected(entry);
    setOpeningEntryId(entry.id);
    try {
      const response = await fetch(`/api/dreams?id=${entry.id}`, { cache: "no-store" });
      const payload = (await response.json()) as { entry?: DreamEntry; error?: string };
      if (!response.ok || !payload.entry) throw new Error(payload.error || "Could not load dream");
      setSelected((current) => (current?.id === entry.id ? payload.entry! : current));
      setLocalEntries((current) => current.map((item) => (item.id === payload.entry!.id ? payload.entry! : item)));
    } catch (error) {
      setLoadMoreError(error instanceof Error ? error.message : "Could not load dream");
    } finally {
      setOpeningEntryId((current) => (current === entry.id ? null : current));
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
    } catch (e) { console.error(e); setTagError(lang === "zh" ? "部分标签更新失败，请重试。" : "Some tag updates failed. Please try again."); } finally { setTagBusy(false); }
  }

  async function handleMergeTag(kind: KeywordArchiveKind, fromLabel: string, intoLabel: string) {
    if (normalizeKeyword(fromLabel) === normalizeKeyword(intoLabel)) { setMergingTag(null); return; }
    const item = keywordArchives[kind].find((i) => normalizeKeyword(i.label) === normalizeKeyword(fromLabel));
    if (!item) { setMergingTag(null); return; }
    const msg = lang === "zh"
      ? `将「${fromLabel}」的 ${item.count} 条梦境合并到「${intoLabel}」？此操作无法撤销。`
      : `Merge "${fromLabel}" (${item.count} dreams) into "${intoLabel}"? This cannot be undone.`;
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
    } catch (e) { console.error(e); setTagError(lang === "zh" ? "部分标签更新失败，请重试。" : "Some tag updates failed. Please try again."); } finally { setTagBusy(false); }
  }

  async function handleDeleteTag(item: KeywordArchiveItem) {
    const msg = lang === "zh"
      ? `从 ${item.count} 个梦境中移除"${item.label}"？`
      : `Remove "${item.label}" from ${item.count} dreams?`;
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
    } catch (e) { console.error(e); setTagError(lang === "zh" ? "部分标签更新失败，请重试。" : "Some tag updates failed. Please try again."); } finally { setTagBusy(false); }
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
    } catch (e) { console.error(e); setTagError(lang === "zh" ? "部分标签更新失败，请重试。" : "Some tag updates failed. Please try again."); } finally { setTagBusy(false); }
  }

  function handleSaved(updatedEntry: DreamEntry) {
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
        throw new Error(payload.error || "Could not load more dreams");
      }
      setLocalEntries((current) => {
        const knownIds = new Set(current.map((entry) => entry.id));
        return [...current, ...payload.entries!.filter((entry) => !knownIds.has(entry.id))];
      });
      setNextCursor(payload.nextCursor ?? null);
    } catch (error) {
      setLoadMoreError(error instanceof Error ? error.message : "Could not load more dreams");
    } finally {
      setLoadingMore(false);
    }
  }

  if (localEntries.length === 0) {
    return (
      <div className="mist-card flex flex-col items-center justify-center rounded-[2rem] py-32 text-center">
        <p className="text-5xl opacity-35">☾</p>
        <p className="mist-soft mt-4 text-sm">{G.empty}</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {activeTab === "calendar" && (
        <div className="archive-calendar-view">
          <div className="flex flex-col gap-5 border-b border-[rgba(176,168,197,0.22)] pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#9a8dbe]">{G.eyebrow}</p>
              <h2 className="mt-2 text-xl font-semibold text-[#5f5673]">{G.title}</h2>
              <p className="mist-muted mt-2 max-w-2xl text-sm leading-7">{G.desc}</p>
            </div>

            <div className="archive-stat-list grid grid-cols-3 gap-4 text-xs sm:min-w-[280px]">
              <div className="archive-stat px-1 py-1">
                <p className="mist-soft">{G.total}</p>
                <p className="mt-1 text-2xl font-semibold text-[#5f5673]">{localEntries.length}</p>
              </div>
              <div className="archive-stat px-1 py-1">
                <p className="mist-soft">{G.dreamDays}</p>
                <p className="mt-1 text-2xl font-semibold text-[#5f5673]">{totalDays}</p>
              </div>
              <div className="archive-stat px-1 py-1">
                <p className="mist-soft">{G.months}</p>
                <p className="mt-1 text-2xl font-semibold text-[#5f5673]">{monthKeys.length}</p>
              </div>
            </div>
          </div>

          <div className="archive-month-controls mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => activeIndex > 0 && setActiveMonth(monthKeys[activeIndex - 1])}
                disabled={activeIndex <= 0}
                className="mist-button-secondary rounded-full px-3 py-2 text-sm text-[#706786] transition disabled:cursor-not-allowed disabled:opacity-35"
              >
                {G.prev}
              </button>
              <div className="rounded-full border border-[rgba(169,157,202,0.2)] bg-[rgba(225,217,243,0.65)] px-4 py-2 text-sm font-medium text-[#756a95]">
                {formatMonthLabel(visibleMonth, lang)}
              </div>
              <button
                type="button"
                onClick={() => activeIndex < monthKeys.length - 1 && setActiveMonth(monthKeys[activeIndex + 1])}
                disabled={activeIndex === -1 || activeIndex >= monthKeys.length - 1}
                className="mist-button-secondary rounded-full px-3 py-2 text-sm text-[#706786] transition disabled:cursor-not-allowed disabled:opacity-35"
              >
                {G.next}
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {monthKeys.slice(0, 8).map((monthKey) => (
                <button
                  key={monthKey}
                  type="button"
                  onClick={() => setActiveMonth(monthKey)}
                  className={`rounded-full px-3 py-1.5 text-xs transition ${
                    monthKey === visibleMonth
                      ? "bg-[rgba(205,196,229,0.9)] text-[#5f5673]"
                      : "border border-[rgba(176,168,197,0.22)] bg-white/35 text-[#847a9a] hover:bg-white/55 hover:text-[#665d7a]"
                  }`}
                >
                  {monthKey.replace("-", ".")}
                </button>
              ))}
            </div>
          </div>

          <div className="archive-calendar-grid mt-6 overflow-hidden rounded-[0.75rem] border border-[rgba(176,168,197,0.22)] bg-white">
            <div className="grid grid-cols-7 border-b border-[rgba(176,168,197,0.2)]">
              {G.weekLabels.map((label) => (
                <div key={label} className="px-3 py-3 text-center text-[11px] font-semibold tracking-[0.18em] text-[#9b90ba]">
                  {label}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {calendarCells.map((cell) => {
                if (!cell.date) {
                  return (
                    <div
                      key={cell.key}
                      className="min-h-14 border-b border-r border-[rgba(176,168,197,0.14)] bg-[#fcfaf8] sm:min-h-[110px]"
                    />
                  );
                }

                const lead = cell.entries[0] ?? null;
                const extraCount = Math.max(0, cell.entries.length - 2);
                const dayLabel = cell.date ? formatDateTime(cell.date.toISOString(), lang) : "";

                return (
                  <button
                    key={cell.key}
                    type="button"
                    disabled={lead ? openingEntryId === lead.id : false}
                    onClick={() => {
                      if (!lead) return;
                      if (cell.entries.length > 1) {
                        setSelectedDay({ label: dayLabel, entries: cell.entries });
                      } else {
                        void openEntry(lead);
                      }
                    }}
                    className={`archive-calendar-cell group min-h-14 border-b border-r border-[rgba(176,168,197,0.14)] p-1.5 text-left transition sm:min-h-[110px] sm:p-2 ${
                      cell.entries.length > 0
                        ? "bg-[linear-gradient(180deg,rgba(255,255,255,0.34),rgba(245,241,251,0.55))] hover:bg-white/65"
                        : "bg-transparent hover:bg-white/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold sm:h-7 sm:w-7 sm:text-xs ${
                          cell.isToday ? "bg-[rgba(205,196,229,0.9)] text-[#5f5673]" : "bg-white/52 text-[#7f7694]"
                        }`}
                      >
                        {cell.date.getDate()}
                      </div>
                      {cell.entries.length > 0 ? (
                        <span className="archive-calendar-count rounded-full border border-[rgba(176,168,197,0.18)] bg-white/45 px-1.5 py-0.5 text-[10px] text-[#847b98] sm:px-2 sm:py-1">
                          {cell.entries.length}{G.countSuffix}
                        </span>
                      ) : null}
                    </div>

                    {lead ? (
                      <div className={`archive-calendar-entry mt-2 hidden rounded-md p-2 sm:block ${moodAccent(lead.mood)}`}>
                        <p className="text-[10px] font-medium">{lead.mood || G.noMood}</p>
                        <p className="mt-0.5 line-clamp-1 text-xs font-semibold opacity-90">
                          {dreamDisplayTitle(lead)}
                        </p>

                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {lead.symbols.slice(0, 2).map((item) => (
                            <span key={item} className="rounded-full bg-white/45 px-2 py-0.5 text-[10px] opacity-80">
                              {item}
                            </span>
                          ))}
                          {extraCount > 0 ? (
                            <span className="rounded-full bg-white/45 px-2 py-0.5 text-[10px] opacity-80">
                              +{extraCount}{G.moreSuffix}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        )}

        {activeTab === "tags" && (
        <div className="archive-keyword-index">
          <div className="flex flex-col gap-3 border-b border-[rgba(176,168,197,0.2)] pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#9a8dbe]">
                {keywordLabels.eyebrow}
              </p>
              <h2 className="mt-2 text-xl font-semibold text-[#5f5673]">{keywordLabels.title}</h2>
              <p className="mist-muted mt-2 max-w-2xl text-sm leading-7">{keywordLabels.desc}</p>
            </div>
          </div>
          {tagError ? <p className="mt-4 text-sm font-medium text-[#bb7f94]" role="alert">{tagError}</p> : null}

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {([
              { title: keywordLabels.people, items: keywordArchives.people, empty: keywordLabels.emptyPeople, kind: "people" as KeywordArchiveKind },
              { title: keywordLabels.locations, items: keywordArchives.locations, empty: keywordLabels.emptyLocations, kind: "locations" as KeywordArchiveKind },
            ]).map((archive) => (
              <section key={archive.title} className="archive-keyword-section rounded-lg border border-[rgba(176,168,197,0.2)] bg-white p-4">
                {/* Section header */}
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-[#665d7d]">{archive.title}</h3>
                  <div className="flex items-center gap-2">
                    <span className="mist-soft text-xs">{archive.items.length}</span>
                    <button
                      type="button"
                      onClick={() => setAddingTag(addingTag?.kind === archive.kind ? null : { kind: archive.kind, draft: "", selectedIds: new Set() })}
                      disabled={tagBusy}
                      className="mist-button-secondary rounded-full px-2.5 py-1 text-xs transition hover:bg-white/55"
                    >
                      {addingTag?.kind === archive.kind ? "✕" : (lang === "zh" ? "+ 添加" : "+ Add")}
                    </button>
                  </div>
                </div>

                {/* Add panel */}
                {addingTag?.kind === archive.kind && (
                  <div className="mt-3 rounded-[1.25rem] border border-[rgba(143,130,188,0.28)] bg-white/50 p-3">
                    <input
                      value={addingTag.draft}
                      onChange={(e) => setAddingTag({ ...addingTag, draft: e.target.value })}
                      placeholder={lang === "zh" ? "新标签名称…" : "New tag name…"}
                      autoFocus
                      className="mist-input w-full rounded-[0.9rem] px-3 py-2 text-sm"
                      onKeyDown={(e) => e.key === "Escape" && setAddingTag(null)}
                    />
                    {addingTag.draft.trim() && (
                      <>
                        <p className="mt-2 text-[11px] text-[#9a8dbe]">
                          {lang === "zh" ? "选择要添加标签的梦境：" : "Select dreams to tag:"}
                        </p>
                        <div className="mt-1.5 flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                          {localEntries.map((entry) => {
                            const selected = addingTag.selectedIds.has(entry.id);
                            return (
                              <button
                                key={entry.id}
                                type="button"
                                onClick={() => {
                                  const next = new Set(addingTag.selectedIds);
                                  selected ? next.delete(entry.id) : next.add(entry.id);
                                  setAddingTag({ ...addingTag, selectedIds: next });
                                }}
                                className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                                  selected
                                    ? "bg-[rgba(143,130,188,0.52)] text-[#3d3555] font-medium"
                                    : "bg-white/55 text-[#7d7298] hover:bg-white/75"
                                }`}
                              >
                                {dreamDisplayTitle(entry)}
                              </button>
                            );
                          })}
                        </div>
                        <div className="mt-2.5 flex gap-2">
                          <button
                            type="button"
                            onClick={() => void handleAddTag()}
                            disabled={tagBusy || addingTag.selectedIds.size === 0}
                            className="mist-button rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                          >
                            {tagBusy
                              ? (lang === "zh" ? "保存中…" : "Saving…")
                              : lang === "zh"
                                ? `添加到 ${addingTag.selectedIds.size} 个梦境`
                                : `Add to ${addingTag.selectedIds.size} dreams`}
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddingTag(null)}
                            className="mist-button-secondary rounded-full px-3 py-1.5 text-xs transition hover:bg-white/48"
                          >
                            {lang === "zh" ? "取消" : "Cancel"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Keyword cards */}
                {archive.items.length > 0 ? (
                  <div className="mt-4 grid gap-2 max-h-[32rem] overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
                    {archive.items.map((item) => {
                      const isEditing = editingTag?.kind === item.kind && normalizeKeyword(editingTag.label) === normalizeKeyword(item.label);
                      const isActive = activeKeyword?.kind === item.kind && normalizeKeyword(activeKeyword.label) === normalizeKeyword(item.label);
                      return (
                        <div
                          key={`${item.kind}-${item.label}`}
                          className={`archive-keyword-card group rounded-lg border p-3 transition ${
                            isActive
                              ? "border-[rgba(143,130,188,0.42)] bg-white/62"
                              : "border-[rgba(176,168,197,0.16)] bg-white/34 hover:bg-white/54"
                          }`}
                        >
                          {isEditing ? (
                            <div className="flex items-center gap-2">
                              <input
                                value={editingTag.draft}
                                onChange={(e) => setEditingTag({ ...editingTag, draft: e.target.value })}
                                autoFocus
                                className="mist-input min-w-0 flex-1 rounded-full px-3 py-1.5 text-sm"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void handleRenameTag(item.kind, item.label, editingTag.draft);
                                  if (e.key === "Escape") setEditingTag(null);
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => void handleRenameTag(item.kind, item.label, editingTag.draft)}
                                disabled={tagBusy}
                                className="mist-button shrink-0 rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                              >
                                {tagBusy ? "…" : (lang === "zh" ? "保存" : "Save")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingTag(null)}
                                className="mist-button-secondary shrink-0 rounded-full px-3 py-1.5 text-xs transition hover:bg-white/48"
                              >
                                {lang === "zh" ? "取消" : "Cancel"}
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-start justify-between gap-3">
                              <button
                                type="button"
                                onClick={() => setActiveKeyword(isActive ? null : item)}
                                className="min-w-0 flex-1 text-left"
                              >
                                <p className="text-sm font-semibold text-[#625976]">{item.label}</p>
                                <p className="mist-soft mt-1 text-xs">
                                  {keywordLabels.appears} {item.count} {keywordLabels.dreams}
                                </p>
                              </button>
                              <div className="relative flex shrink-0 items-center gap-1">
                                <span className="rounded-full bg-[rgba(205,196,229,0.68)] px-2.5 py-1 text-xs font-semibold text-[#655b7e]">
                                  {item.count}
                                </span>
                                <button
                                  type="button"
                                  aria-label={lang === "zh" ? `管理标签 ${item.label}` : `Manage ${item.label}`}
                                  aria-expanded={tagActionMenu === `${item.kind}-${item.label}`}
                                  onClick={() => setTagActionMenu((current) => current === `${item.kind}-${item.label}` ? null : `${item.kind}-${item.label}`)}
                                  disabled={tagBusy}
                                  className="archive-tag-menu-trigger flex h-9 w-9 items-center justify-center rounded-md text-lg text-[#6b627f] transition disabled:cursor-not-allowed"
                                >
                                  <span aria-hidden>⋯</span>
                                </button>
                                {tagActionMenu === `${item.kind}-${item.label}` ? (
                                  <div className="archive-tag-action-menu absolute right-0 top-10 z-10 w-28 rounded-md border bg-white p-1 shadow-sm">
                                    <button type="button" onClick={() => { setEditingTag({ kind: item.kind, label: item.label, draft: item.label }); setMergingTag(null); setTagActionMenu(null); }} disabled={tagBusy}>
                                      {lang === "zh" ? "重命名" : "Rename"}
                                    </button>
                                    <button type="button" onClick={() => { setMergingTag(mergingTag && normalizeKeyword(mergingTag.label) === normalizeKeyword(item.label) ? null : { kind: item.kind, label: item.label }); setEditingTag(null); setTagActionMenu(null); }} disabled={tagBusy || archive.items.length < 2}>
                                      {lang === "zh" ? "合并到…" : "Merge into…"}
                                    </button>
                                    <button type="button" onClick={() => { setTagActionMenu(null); void handleDeleteTag(item); }} disabled={tagBusy} className="archive-tag-action-danger">
                                      {lang === "zh" ? "删除" : "Delete"}
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          )}

                          {!isEditing && (
                            <>
                              {/* Relationship editor — people only */}
                              {item.kind === "people" && (() => {
                                const relKey = normalizeKeyword(item.label);
                                const rel = personRelationships[relKey];
                                const isEditingRel = editingRelKey === relKey;
                                const quickOpts = lang === "zh"
                                  ? ["朋友", "家人", "恋人", "同事", "室友", "同学", "老师"]
                                  : ["Friend", "Family", "Partner", "Colleague", "Roommate", "Classmate", "Teacher"];
                                return isEditingRel ? (
                                  <div className="mt-2.5" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex flex-wrap gap-1 mb-1.5">
                                      {quickOpts.map((opt) => (
                                        <button
                                          key={opt}
                                          type="button"
                                          onClick={() => setRelDraft(opt)}
                                          className={`rounded-full px-2.5 py-0.5 text-[10px] transition ${relDraft === opt ? "bg-[rgba(143,130,188,0.52)] text-[#3d3555] font-semibold" : "bg-white/50 text-[#7d7298] hover:bg-white/70"}`}
                                        >
                                          {opt}
                                        </button>
                                      ))}
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <input
                                        value={relDraft}
                                        onChange={(e) => setRelDraft(e.target.value)}
                                        placeholder={lang === "zh" ? "自定义关系…" : "Custom…"}
                                        autoFocus
                                        className="mist-input min-w-0 flex-1 rounded-full px-3 py-1 text-xs"
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") savePersonRelationship(relKey, relDraft);
                                          if (e.key === "Escape") setEditingRelKey(null);
                                        }}
                                      />
                                      <button type="button" onClick={() => savePersonRelationship(relKey, relDraft)} className="mist-button rounded-full px-2.5 py-1 text-[10px]">✓</button>
                                      <button type="button" onClick={() => setEditingRelKey(null)} className="mist-button-secondary rounded-full px-2 py-1 text-[10px]">✕</button>
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setRelDraft(rel ?? ""); setEditingRelKey(relKey); }}
                                    className={`mt-1.5 inline-flex rounded-full px-2.5 py-0.5 text-[10px] transition ${rel ? "bg-[rgba(143,130,188,0.2)] text-[#7a6fa5] hover:bg-[rgba(143,130,188,0.32)]" : "text-[#b0a8c0] hover:text-[#7a6fa5]"}`}
                                  >
                                    {rel ?? (lang === "zh" ? "+ 标注关系" : "+ Add relation")}
                                  </button>
                                );
                              })()}

                              {/* Person gender */}
                              {item.kind === "people" && (() => {
                                const gKey = normalizeKeyword(item.label);
                                const g = personGenders[gKey];
                                const opts = lang === "zh"
                                  ? [{ v: "male", label: "男" }, { v: "female", label: "女" }, { v: "other", label: "其他" }]
                                  : [{ v: "male", label: "M" }, { v: "female", label: "F" }, { v: "other", label: "Other" }];
                                return (
                                  <div className="mt-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                    {opts.map(({ v, label }) => (
                                      <button
                                        key={v}
                                        type="button"
                                        onClick={() => savePersonGender(gKey, g === v ? "" : v)}
                                        className={`rounded-full px-2 py-0.5 text-[10px] transition ${g === v ? "bg-[rgba(143,130,188,0.52)] text-[#3d3555] font-semibold" : "bg-white/40 text-[#9d90b8] hover:bg-white/60"}`}
                                      >
                                        {label}
                                      </button>
                                    ))}
                                  </div>
                                );
                              })()}
                              {/* Merge picker */}
                              {mergingTag && normalizeKeyword(mergingTag.label) === normalizeKeyword(item.label) && (
                                <div className="mt-2.5" onClick={(e) => e.stopPropagation()}>
                                  <p className="mb-1.5 text-[10px] font-semibold text-[#9a8dbe]">
                                    {lang === "zh" ? "合并到：" : "Merge into:"}
                                  </p>
                                  <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                                    {archive.items
                                      .filter((other) => normalizeKeyword(other.label) !== normalizeKeyword(item.label))
                                      .map((other) => (
                                        <button
                                          key={other.label}
                                          type="button"
                                          onClick={() => void handleMergeTag(item.kind, item.label, other.label)}
                                          disabled={tagBusy}
                                          className="rounded-full bg-[rgba(143,130,188,0.18)] px-2.5 py-0.5 text-[10px] text-[#7a6fa5] transition hover:bg-[rgba(143,130,188,0.38)] hover:text-[#4a3d62] disabled:opacity-40"
                                        >
                                          {other.label}
                                        </button>
                                      ))}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setMergingTag(null)}
                                    className="mt-1.5 text-[10px] text-[#b0a8c0] hover:text-[#7a6fa5]"
                                  >
                                    {lang === "zh" ? "取消" : "Cancel"}
                                  </button>
                                </div>
                              )}

                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {item.moods.slice(0, 2).map((mood) => (
                                  <span key={mood.item} className="rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-medium text-[#4a3d62]">
                                    {mood.item}
                                  </span>
                                ))}
                                {item.symbols.slice(0, 2).map((symbol) => (
                                  <span key={symbol.item} className="rounded-full bg-[#e5d8f8] px-2 py-0.5 text-[10px] font-medium text-[#3d2e5a]">
                                    {symbol.item}
                                  </span>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-4 rounded-[1.25rem] border border-dashed border-[rgba(176,168,197,0.2)] px-4 py-8 text-center text-sm text-[#9b92ad]">
                    {archive.empty}
                  </div>
                )}
              </section>
            ))}
          </div>

          {activeKeyword ? (
            <div className="mt-5 rounded-[1.6rem] border border-[rgba(176,168,197,0.2)] bg-[rgba(255,255,255,0.38)] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#9a8dbe]">
                    {activeKeyword.kind === "people" ? keywordLabels.people : keywordLabels.locations}
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold text-[#5f5673]">{activeKeyword.label}</h3>
                  <p className="mist-muted mt-2 text-sm">
                    {keywordLabels.appears} {activeKeyword.count} {keywordLabels.dreams}
                    {activeKeyword.moods.length ? ` · ${keywordLabels.mood}: ${activeKeyword.moods.map((mood) => mood.item).join(" / ")}` : ""}
                    {activeKeyword.symbols.length ? ` · ${keywordLabels.themes}: ${activeKeyword.symbols.map((symbol) => symbol.item).join(" / ")}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveKeyword(null)}
                  className="mist-button-secondary w-fit rounded-full px-3 py-1.5 text-xs transition hover:bg-white/48"
                >
                  ✕
                </button>
              </div>

              <div className="mt-4 grid gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#9a8dbe]">
                  {keywordLabels.related}
                </p>
                {activeKeyword.entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => void openEntry(entry)}
                    disabled={openingEntryId === entry.id}
                    className="rounded-2xl border border-[rgba(176,168,197,0.18)] bg-white/42 p-4 text-left transition hover:bg-white/58"
                  >
                    <div className="mist-soft flex flex-wrap items-center gap-2 text-xs">
                      <span>{formatDateTime(entry.capturedAt, lang)}</span>
                      {entry.mood ? <span className="rounded-full bg-white/62 px-2 py-0.5 text-[#7d7298]">{entry.mood}</span> : null}
                      {entry.symbols.slice(0, 3).map((symbol) => (
                        <span key={symbol} className="rounded-full bg-[#e5d8f8] px-2 py-0.5 text-[10px] font-medium text-[#3d2e5a]">
                          {symbol}
                        </span>
                      ))}
                    </div>
                    <h4 className="mt-2 text-base font-semibold text-[#5f5673]">
                      {dreamDisplayTitle(entry)}
                    </h4>
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#6b627f]">
                      {truncate(entry.cleanText.replace(/\s+/g, " "), 150)}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        )}

        {activeTab === "recent" && (
        <div className="archive-recent-view">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#9a8dbe]">{G.recentEyebrow}</p>
              <p className="mist-muted mt-2 text-sm">{G.recentDesc}</p>
            </div>
          </div>

          <div className="archive-recent-list">
            {localEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => void openEntry(entry)}
                disabled={openingEntryId === entry.id}
                className="archive-recent-entry"
              >
                <div className="archive-recent-entry-inner">
                  <div className={`archive-recent-image ${moodGradient(entry.mood)}`}>
                    {entry.thumbnailUrl || entry.imageUrl ? (
                      <Image src={entry.thumbnailUrl || entry.imageUrl!} alt="dream" width={320} height={420} unoptimized className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="archive-recent-copy">
                    <span className="archive-recent-mood">{entry.mood || (lang === "zh" ? "无情绪" : "No mood")}</span>
                    <p className="archive-recent-title">{dreamDisplayTitle(entry)}</p>
                    <p className="archive-recent-date">{formatDateTime(entry.capturedAt, lang)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
        )}

        {nextCursor ? (
          <div className="text-center">
            <button
              type="button"
              onClick={() => void loadMoreEntries()}
              disabled={loadingMore}
              className="mist-button-secondary rounded-full px-5 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {loadingMore
                ? (lang === "zh" ? "加载中…" : "Loading…")
                : (lang === "zh" ? "加载更早的梦境" : "Load older dreams")}
            </button>
            {loadMoreError ? <p className="mt-2 text-xs text-[#b88a95]">{loadMoreError}</p> : null}
          </div>
        ) : null}
      </div>

      {selectedDay && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(232,225,242,0.58)] backdrop-blur-xl sm:items-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeDayDialog();
          }}
        >
          <div
            ref={dayDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={dayDialogTitleId}
            tabIndex={-1}
            onKeyDown={onDayDialogKeyDown}
            className="mist-card relative max-h-[85vh] w-full max-w-xl overflow-y-auto overscroll-y-contain rounded-t-[2rem] p-5 sm:rounded-[2rem] sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#998db9]">
                  {selectedDay.entries.length}{lang === "zh" ? " 条梦境" : " dreams"}
                </p>
                <h2 id={dayDialogTitleId} className="mt-1 text-xl font-semibold tracking-[-0.02em] text-[#5f5673]">
                  {selectedDay.label}
                </h2>
              </div>
              <button
                ref={dayCloseButtonRef}
                type="button"
                onClick={closeDayDialog}
                aria-label={lang === "zh" ? "关闭日期详情" : "Close date details"}
                className="mist-button-secondary flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-[#6b6282] transition hover:bg-white/55"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              {selectedDay.entries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => { setSelectedDay(null); void openEntry(entry); }}
                  disabled={openingEntryId === entry.id}
                  className={`w-full rounded-[1.5rem] bg-gradient-to-br p-4 text-left transition hover:brightness-95 ${moodGradient(entry.mood)}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[#8f82bc]">{entry.mood || (lang === "zh" ? "无情绪标注" : "No mood")}</span>
                    <span className="text-xs text-[#9b90b4]">{formatDateTime(entry.capturedAt, lang)}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-[#5f5673]">{dreamDisplayTitle(entry)}</p>
                  <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[#6e667f]">
                    {truncate(entry.cleanText.replace(/\s+/g, " "), 100)}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <DreamEditorModal
        entry={selected}
        onClose={() => setSelected(null)}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />
    </>
  );
}
