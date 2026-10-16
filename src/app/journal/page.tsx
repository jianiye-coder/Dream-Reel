"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Book, BookPage } from "@/components/notebook/Book";
import { NotebookShell } from "@/components/notebook/NotebookShell";
import { TurnLink } from "@/components/notebook/TurnLink";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { DreamAgentMemory, DreamAgentNextAction, DreamAgentStage } from "@/lib/dreamFollowUpAgent";
import type { DreamAgentResponseMeta } from "@/lib/dreamAgentTelemetry";
import { needsPaymentFix, openStripe, useBillingReturn } from "@/lib/billingClient";
import { getRealityQuestion } from "@/lib/dreamQuestions";
import { buildDreamImagePrompt } from "@/lib/imagePrompt";
import { useLanguage } from "@/contexts/LanguageContext";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { shouldFlushLatestSave } from "@/lib/autosave";
import { DreamConversationControls } from "@/components/DreamConversationControls";
import type { DreamConversationGoal } from "@/lib/dreamSupport";
import css from "./journal.module.css";

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event?: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

function getTodayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const CN_DIGITS = "〇一二三四五六七八九";
function cnNum(n: number) {
  if (n <= 10) return n === 10 ? "十" : CN_DIGITS[n];
  if (n < 20) return "十" + CN_DIGITS[n % 10];
  return CN_DIGITS[Math.floor(n / 10)] + "十" + (n % 10 ? CN_DIGITS[n % 10] : "");
}

/** "2026-10-07" → the date as you'd write it at the top of a page, plus its folio number */
function pageDate(value: string, lang: "zh" | "en") {
  const [y, m, d] = value.split("-").map(Number);
  const date = y && m && d ? new Date(y, m - 1, d) : new Date();
  const dayOfYear = Math.round((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / 86_400_000) + 1;
  const short = `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
  return lang === "zh"
    ? { day: `${cnNum(date.getMonth() + 1)}月${cnNum(date.getDate())}日`, weekday: "周" + "日一二三四五六"[date.getDay()], short, folio: dayOfYear * 2 }
    : { day: date.toLocaleDateString("en-US", { month: "long", day: "numeric" }), weekday: date.toLocaleDateString("en-US", { weekday: "long" }), short, folio: dayOfYear * 2 };
}

/* Scroll panes on the page fade softly into the paper at whichever edge has more writing past it,
   instead of slicing a slip in half. (React 19 ref callback: returns its own cleanup.) */
function edgeFade(el: HTMLElement | null) {
  if (!el) return;
  const update = () => {
    const pane = getComputedStyle(el).overflowY !== "visible" && el.scrollHeight - el.clientHeight > 1;
    el.toggleAttribute("data-fade-top", pane && el.scrollTop > 1);
    el.toggleAttribute("data-fade-bottom", pane && el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  };
  update();
  el.addEventListener("scroll", update, { passive: true });
  // the content can grow without the pane resizing or the DOM changing: images arriving, a <details>
  // opening, a textarea dragged taller, a web font swapping in — watch the pane and its children
  el.addEventListener("load", update, true);
  el.addEventListener("toggle", update, true);
  const resized = new ResizeObserver(update);
  const watch = () => {
    resized.disconnect();
    resized.observe(el);
    for (const child of Array.from(el.children)) resized.observe(child);
  };
  watch();
  const changed = new MutationObserver(() => { watch(); update(); });
  changed.observe(el, { childList: true, subtree: true, characterData: true });
  let live = true;
  void document.fonts?.ready.then(() => { if (live) update(); });
  return () => {
    live = false;
    el.removeEventListener("scroll", update);
    el.removeEventListener("load", update, true);
    el.removeEventListener("toggle", update, true);
    resized.disconnect();
    changed.disconnect();
  };
}

const MicIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3Z" />
    <path d="M5.75 10.5v1a6.25 6.25 0 0 0 12.5 0v-1" />
    <path d="M12 17.75v2.75" />
    <path d="M8.75 20.5h6.5" />
  </svg>
);

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  questions?: string[];
  stage?: DreamAgentStage;
  nextAction?: DreamAgentNextAction;
  memory?: DreamAgentMemory;
  meta?: DreamAgentResponseMeta;
  feedback?: "up" | "down";
  feedbackReason?: "repetitive" | "irrelevant" | "too_many_questions" | "unsafe" | "other";
  isError?: boolean;
  retryText?: string;
  retryUserId?: string;
  isCommand?: boolean;
  goal?: DreamConversationGoal;
}

type AgentHistoryMessage = Pick<ChatMessage, "role" | "content" | "questions" | "memory">;

const CHAT_RENDER_WINDOW = 50;

interface AgentReply {
  message?: string;
  questions?: string[];
  stage?: DreamAgentStage;
  nextAction?: DreamAgentNextAction;
  memory?: DreamAgentMemory;
  meta?: DreamAgentResponseMeta;
  error?: string;
}

interface AnalysisResult {
  title: string;
  mood: string;
  stressScore: number | null;
  people: string[];
  locations: string[];
  symbols: string[];
  sleepInsight: string;
  visualBrief: string;
}

type ActivePanel = "none" | "image";
type BillingStatus = {
  plan: "free" | "plus";
  isUnlimited?: boolean;
  checkoutAvailable?: boolean;
  subscriptionStatus?: string | null;
  remaining: { dreamEntries: number; analysis: number; imageGenerations: number };
};

function isImageGenerationRequest(text: string): boolean {
  const request = text.trim();
  if (!request) return false;
  return /(?:帮我|请|想要|要|给我|可以).{0,8}(?:生成|生|画|做).{0,4}(?:图|图像|图片|画面)|(?:生成|生|画).{0,2}(?:一张|个)?(?:图|图像|图片)|生图/i.test(request)
    || /(?:generate|make|create|draw).{0,20}(?:image|picture|art|illustration)|(?:image|picture).{0,12}(?:please|now)/i.test(request);
}

export default function JournalPage() {
  const { lang, T } = useLanguage();
  const J = T.journal;
  const B = T.billing;
  const { data: session } = useSession();
  const router = useRouter();

  const [mode, setMode] = useState<"chat" | "quick">("quick");
  const [conversationGoal, setConversationGoal] = useState<DreamConversationGoal>("recall");
  const [chatUnlocked, setChatUnlocked] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [visibleChatMessageCount, setVisibleChatMessageCount] = useState(CHAT_RENDER_WINDOW);
  const [welcomed, setWelcomed] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [input, setInput] = useState("");
  const [panel, setPanel] = useState<ActivePanel>("none");
  const [step, setStep] = useState<"dream" | "sleep">("dream");
  const [quickText, setQuickText] = useState("");
  const [inputMode, setInputMode] = useState<"text" | "voice">("text");

  // Sleep context
  // filled in after mount: the server's "today" (UTC) is not the reader's today
  const [dreamDate, setDreamDate] = useState("");
  const [today, setToday] = useState("");
  const [sleepStart, setSleepStart] = useState("");
  const [wakeTime, setWakeTime] = useState("");
  const [sleepQuality, setSleepQuality] = useState<number | null>(null);
  const [stressScore, setStressScore] = useState(3);
  const [preSleepMeal, setPreSleepMeal] = useState("");
  const [preSleepActivity, setPreSleepActivity] = useState("");

  // Image
  const [imagePrompt, setImagePrompt] = useState("");
  const [imagePromptEdited, setImagePromptEdited] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
  const [isDownloadingImage, setIsDownloadingImage] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [imageError, setImageError] = useState("");
  const [isDevelopingRoomOpen, setIsDevelopingRoomOpen] = useState(false);

  // Analysis
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [showNextStep, setShowNextStep] = useState(false);
  const [lastAnalyzedText, setLastAnalyzedText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [billingMessage, setBillingMessage] = useState("");
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);

  // Dream title (auto-generated; user can override)
  const [quickTitle, setQuickTitleState] = useState("");
  const [titleEdited, setTitleEdited] = useState(false);
  const [isTitleGenerating, setIsTitleGenerating] = useState(false);
  const titleGeneratingRef = useRef(false);
  const quickTitleRef = useRef("");

  function setQuickTitle(value: string, fromUser = false) {
    quickTitleRef.current = value;
    setQuickTitleState(value);
    if (fromUser) setTitleEdited(!!value);
  }

  async function generateTitle(text: string) {
    if (titleGeneratingRef.current || titleEdited) return;
    titleGeneratingRef.current = true;
    setIsTitleGenerating(true);
    try {
      const currentAnalysis = analysis && lastAnalyzedText === text ? analysis : null;
      const res = await fetch("/api/generate-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.slice(0, 1200),
          lang,
          mood: currentAnalysis?.mood || undefined,
          people: currentAnalysis?.people?.length ? currentAnalysis.people : undefined,
          locations: currentAnalysis?.locations?.length ? currentAnalysis.locations : undefined,
          symbols: currentAnalysis?.symbols?.length ? currentAnalysis.symbols : undefined,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { title?: string };
      if (data.title && !titleEdited) setQuickTitle(data.title);
    } catch {
      // silent
    } finally {
      titleGeneratingRef.current = false;
      setIsTitleGenerating(false);
    }
  }

  // Welcome modal — shown once on first visit

  // Auto-save
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const savedEntryIdRef = useRef<number | null>(null);
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const saveRevisionRef = useRef(0);
  const autoSaveLatestRef = useRef<((opts?: {
    pendingAnalysis?: AnalysisResult;
    pendingImageUrl?: string | null;
  }) => Promise<void>) | null>(null);
  const pendingOptsRef = useRef<{ pendingAnalysis?: AnalysisResult; pendingImageUrl?: string | null }>({});
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRenderRef = useRef(true);
  const analysisAutoTriggeredRef = useRef(false);
  const isAnalyzingRef = useRef(false);
  const latestAgentInteractionIdRef = useRef<string | null>(null);

  const messagesAreaRef = useRef<HTMLElement>(null);
  const replyFormRef = useRef<HTMLFormElement>(null);
  const followRef = useRef({ count: 0, id: "", typing: false });
  const nearReplyRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const undoStack = useRef<string[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  function setJournalMode(nextMode: "chat" | "quick") {
    setMode(nextMode);
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (nextMode === "quick") params.delete("mode");
    else params.set("mode", "chat");
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }

  function handleModeTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextMode = mode === "quick" ? "chat" : "quick";
    setJournalMode(nextMode);
    window.requestAnimationFrame(() => document.getElementById(`journal-tab-${nextMode}`)?.focus());
  }

  useEffect(() => {
    const t = getTodayDate();
    setToday(t);
    setDreamDate((current) => current || t);
    // a page left open past midnight: "today" (the date input's max) moves on when it is looked at again
    const refresh = () => { if (document.visibilityState === "visible") setToday(getTodayDate()); };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);

  useEffect(() => {
    const syncModeFromUrl = () => {
      setMode(new URLSearchParams(window.location.search).get("mode") === "chat" ? "chat" : "quick");
    };
    syncModeFromUrl();
    window.addEventListener("popstate", syncModeFromUrl);
    return () => window.removeEventListener("popstate", syncModeFromUrl);
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  async function refreshBillingStatus() {
    if (!session?.user) return null;
    try {
      const res = await fetch("/api/billing/status", { cache: "no-store" });
      if (!res.ok) return null;
      const status = (await res.json()) as BillingStatus;
      setBillingStatus(status);
      return status;
    } catch {
      // Billing status is useful guidance, but it should not block dream capture.
      return null;
    }
  }

  async function openCheckout() {
    setIsCheckoutLoading(true);
    setBillingMessage("");
    try {
      await openStripe("checkout", lang, "/journal", B.checkoutError);
    } catch (error) {
      setBillingMessage(error instanceof Error ? error.message : B.checkoutError);
      setIsCheckoutLoading(false);
    }
  }

  useEffect(() => {
    void refreshBillingStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user, lang]);

  useBillingReturn({
    pending: () => setBillingMessage(B.upgradePending),
    active: () => setBillingMessage(B.upgraded),
    slow: () => setBillingMessage(B.upgradeSlow),
    cancelled: () => setBillingMessage(B.checkoutCancelled),
    isPlus: async () => (await refreshBillingStatus())?.plan === "plus",
  });

  // billing notes are a slip on the desk, not a permanent fixture
  useEffect(() => {
    if (!billingMessage) return;
    const timer = setTimeout(() => setBillingMessage(""), 7000);
    return () => clearTimeout(timer);
  }, [billingMessage]);

  // Seed or update welcome message when lang changes
  useEffect(() => {
    const content = conversationGoal === "support"
      ? J.nb.supportWelcome
      : J.welcome;
    const welcome: ChatMessage = { id: "welcome", role: "assistant", content };
    if (!welcomed) {
      setMessages([welcome]);
      setWelcomed(true);
    } else {
      setMessages((prev) =>
        prev.map((m) => (m.id === "welcome" ? { ...m, content } : m)),
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, conversationGoal]);

  // Auto-build image prompt from active content
  useEffect(() => {
    if (imagePromptEdited) return;
    const text =
      mode === "chat"
        ? messages.filter((m) => m.role === "user" && !m.isCommand).map((m) => m.content).join(" ")
        : quickText;
    if (!text.trim()) return;
    // If analysis produced a comprehensive image prompt, show it directly
    if (analysis?.visualBrief && analysis.visualBrief.length > 200) {
      setImagePrompt(analysis.visualBrief);
      return;
    }
    setImagePrompt(
      buildDreamImagePrompt({
        rawText: text,
        mood: analysis?.mood ?? "",
        people: analysis?.people ?? [],
        locations: analysis?.locations ?? [],
        symbols: analysis?.symbols ?? [],
        tags: [],
      }),
    );
  }, [messages, quickText, analysis, imagePromptEdited, mode]);

  // Latest questions from most recent AI message
  const latestQuestions = useMemo(() => {
    const latest = messages.filter((m) => m.role === "assistant").at(-1);
    if (conversationGoal === "support" || latest?.goal === "support") {
      return latest?.goal === conversationGoal ? latest.questions ?? [] : [];
    }
    const ai = messages.filter((m) => m.role === "assistant" && m.questions?.length);
    return ai[ai.length - 1]?.questions ?? [];
  }, [messages, conversationGoal]);

  const latestAgentDecision = useMemo(() => {
    const ai = messages.filter((m) => m.role === "assistant" && m.nextAction);
    return ai[ai.length - 1] ?? null;
  }, [messages]);
  const agentReadyToAnalyze = conversationGoal === "recall" && latestAgentDecision?.nextAction === "ready_to_analyze";
  const visibleMessages = useMemo(
    () => messages.slice(-visibleChatMessageCount),
    [messages, visibleChatMessageCount],
  );
  const hiddenChatMessageCount = Math.max(messages.length - visibleMessages.length, 0);
  const agentDecisionCopy = J.nb.agentDecision;
  const organizeDreamLabel = isAnalyzing ? J.analyzingBtn : J.nb.organizeDream;
  const imageGenerationStartingCopy = J.nb.imageStarting;

  const activeDreamText =
    mode === "chat"
      ? messages.filter((m) => m.role === "user" && !m.isCommand).map((m) => m.content).join("\n\n")
      : quickText;
  const hasContent = activeDreamText.trim().length > 0;
  const rawFragments = activeDreamText
    .split(/[，。,.!?！？\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const dreamFragments = rawFragments.slice(-5);
  const currentAnalysis = analysis && lastAnalyzedText === activeDreamText ? analysis : null;

  useEffect(() => { isAnalyzingRef.current = isAnalyzing; }, [isAnalyzing]);

  useEffect(() => {
    if (!quickText.trim()) {
      analysisAutoTriggeredRef.current = false;
      setShowNextStep(false);
    }
  }, [quickText]);

  // Debounced auto-save on text change
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    saveRevisionRef.current += 1;
    if (isSavingRef.current) pendingSaveRef.current = true;
    if (!hasContent) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      void autoSaveLatestRef.current?.();
      if (!titleEdited && quickText.length >= 80 && !titleGeneratingRef.current) {
        void generateTitle(quickText);
      }
      if (quickText.length >= 120 && !analysisAutoTriggeredRef.current && !isAnalyzingRef.current) {
        analysisAutoTriggeredRef.current = true;
        void analyzeDream();
      }
    }, 2000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    quickText,
    quickTitle,
    messages,
    dreamDate,
    sleepStart,
    wakeTime,
    sleepQuality,
    stressScore,
    preSleepMeal,
    preSleepActivity,
  ]);

  // phones: is the reader at the reply line? measured on scroll, so content growing below doesn't change it
  useEffect(() => {
    const check = () => {
      const form = replyFormRef.current;
      nearReplyRef.current = !!form && form.getBoundingClientRect().bottom <= window.innerHeight + 160;
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [mode]);

  // Follow the chat inside the message pane without moving the whole page.
  useEffect(() => {
    if (!hasContent) return;
    const messagesArea = messagesAreaRef.current;
    if (!messagesArea) return;
    // on phones the thread is part of the page (not its own scroll box): bring the reply line back into
    // view — but only when the conversation moved on (a message added or removed, or it started typing),
    // not when one was rewritten (feedback, goal, language), and not if the reader scrolled up to read
    const last = { count: messages.length, id: messages.at(-1)?.id ?? "", typing: isTyping };
    const before = followRef.current;
    followRef.current = last;
    if (getComputedStyle(messagesArea).overflowY === "visible") {
      const movedOn = last.count !== before.count || last.id !== before.id || (last.typing && !before.typing);
      if (movedOn && nearReplyRef.current) replyFormRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
      return;
    }
    messagesArea.scrollTo({
      top: messagesArea.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isTyping, hasContent]);

  async function requestAgentReply(history: AgentHistoryMessage[]) {
    const res = await fetch("/api/chat-dream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: history,
        lang,
        goal: conversationGoal,
        preSleepMeal: preSleepMeal || undefined,
        preSleepActivity: preSleepActivity || undefined,
      }),
    });

    const data = (await res.json()) as AgentReply;

    if (!res.ok) {
      throw new Error(getApiErrorMessage(data.error, lang, J.signalLost));
    }

    if (data.meta?.interactionId) {
      latestAgentInteractionIdRef.current = data.meta.interactionId;
    }

    return data;
  }

  function agentReplyMessage(data: AgentReply): ChatMessage {
    return {
      id: `a-${Date.now()}`,
      role: "assistant",
      content: data.message ?? "……",
      questions: data.questions ?? [],
      stage: data.stage,
      nextAction: data.nextAction,
      memory: data.memory,
      meta: data.meta,
      goal: conversationGoal,
    };
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || isTyping) return;

    undoStack.current.push(input);

    const imageRequest = isImageGenerationRequest(text) && hasContent;
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: text, isCommand: imageRequest };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";

    if (imageRequest) {
      setMessages((prev) => [
        ...prev,
        { id: `a-image-request-${Date.now()}`, role: "assistant", content: imageGenerationStartingCopy, questions: [] },
      ]);
      void generateImage();
      return;
    }

    setIsTyping(true);

    try {
      const history: AgentHistoryMessage[] = messages
        .filter((m) => m.id !== "welcome")
        .map((m) => ({
          role: m.role,
          content: m.content,
          questions: m.questions,
          memory: m.memory,
        }));
      history.push({ role: "user", content: text });
      const data = await requestAgentReply(history);

      setMessages((prev) => [
        ...prev,
        agentReplyMessage(data),
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: err instanceof Error ? err.message : J.signalLost,
          questions: [],
          isError: true,
          retryText: text,
          retryUserId: userMsg.id,
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  }

  async function startDirectDreamChat() {
    const text = quickText.trim();
    if (!text || isTyping) return;

    const userMsg: ChatMessage = { id: `u-dream-${Date.now()}`, role: "user", content: text };
    setVisibleChatMessageCount(CHAT_RENDER_WINDOW);
    setMessages([
      { id: "welcome", role: "assistant", content: J.welcome },
      userMsg,
    ]);
    setJournalMode("chat");
    setPanel("none");
    setStep("dream");
    setIsTyping(true);

    try {
      const data = await requestAgentReply([{ role: "user", content: text }]);
      setMessages((current) => [...current, agentReplyMessage(data)]);
    } catch (err) {
      setMessages((current) => [
        ...current,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: err instanceof Error ? err.message : J.signalLost,
          questions: [],
          isError: true,
          retryText: text,
          retryUserId: userMsg.id,
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  }

  function editAndRetry(message: ChatMessage) {
    setMessages((previous) => previous.filter((item) => item.id !== message.id && item.id !== message.retryUserId));
    setInput(message.retryText ?? "");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function submitAgentFeedback(
    messageId: string,
    rating: "up" | "down",
    reason?: ChatMessage["feedbackReason"],
  ) {
    const message = messages.find((item) => item.id === messageId);
    if (!message?.meta?.feedbackToken) return;
    const previousRating = message.feedback;
    const previousReason = message.feedbackReason;
    setMessages((items) => items.map((item) => item.id === messageId
      ? { ...item, feedback: rating, feedbackReason: reason }
      : item));
    try {
      const response = await fetch("/api/agent-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedbackToken: message.meta.feedbackToken,
          rating,
          reason: reason ?? null,
        }),
      });
      if (!response.ok) throw new Error("feedback_failed");
    } catch {
      setMessages((items) => items.map((item) => item.id === messageId
        ? { ...item, feedback: previousRating, feedbackReason: previousReason }
        : item));
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter that commits an IME candidate (pinyin, kana…) is not a send
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
    // Cmd+Z when empty: restore last checkpoint
    if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey && input === "") {
      e.preventDefault();
      const last = undoStack.current.pop();
      if (last !== undefined) setInput(last);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    setInputMode("text");
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 176)}px`;
  }

  function appendVoiceTranscript(transcript: string) {
    const text = transcript.trim();
    if (!text) return;

    setInputMode("voice");
    if (mode === "quick") {
      setQuickText((current) => (current.trim() ? `${current.trim()}\n${text}` : text));
      return;
    }

    setInput((current) => (current.trim() ? `${current.trim()}\n${text}` : text));
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 176)}px`;
      inputRef.current.focus();
    });
  }

  function toggleVoiceRecord() {
    setVoiceError("");

    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const SpeechRecognition =
      (window as typeof window & {
        SpeechRecognition?: SpeechRecognitionConstructor;
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
      }).SpeechRecognition ??
      (window as typeof window & {
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
      }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceError(J.toolbar.voiceUnsupported);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = lang === "zh" ? "zh-CN" : "en-US";
    recognition.interimResults = false;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .filter((result) => result.isFinal)
        .map((result) => result[0].transcript)
        .join(" ");
      appendVoiceTranscript(transcript);
    };
    recognition.onerror = (event) => {
      if (event?.error === "aborted") return;
      setVoiceError(J.toolbar.voiceError);
      setIsRecording(false);
    };
    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsRecording(true);
    } catch {
      setVoiceError(J.toolbar.voiceError);
      setIsRecording(false);
    }
  }

  // Click chip → append question text to input
  function appendQuestion(q: string) {
    undoStack.current.push(input);
    setInput((prev) => (prev ? `${prev}\n${q}` : q));
    inputRef.current?.focus();
  }

  function getDreamText() {
    return mode === "chat"
      ? messages.filter((m) => m.role === "user" && !m.isCommand).map((m) => m.content).join("\n\n")
      : quickText;
  }

  async function extractDreamElements(text: string): Promise<AnalysisResult> {
    const res = await fetch("/api/analyze-dream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        lang,
        preSleepMeal: preSleepMeal || undefined,
        preSleepActivity: preSleepActivity || undefined,
      }),
    });
    const data = (await res.json()) as {
      mood?: string; stressScore?: number | null;
      people?: string[]; locations?: string[]; symbols?: string[];
      sleepInsight?: string; title?: string; visualBrief?: string; error?: string;
    };
    if (res.status === 402) { router.push("/pricing"); return null as never; }
    if (!res.ok) throw new Error(getApiErrorMessage(data.error, lang, J.analyzeError));

    return {
      title: data.title ?? "",
      mood: data.mood ?? "",
      stressScore: data.stressScore ?? null,
      people: data.people ?? [],
      locations: data.locations ?? [],
      symbols: data.symbols ?? [],
      sleepInsight: data.sleepInsight ?? "",
      visualBrief: data.visualBrief ?? "",
    };
  }

  async function analyzeDream() {
    const text = getDreamText();
    if (!text.trim()) return;
    setIsAnalyzing(true);

    try {
      const result = await extractDreamElements(text);
      setAnalysis(result);
      void refreshBillingStatus();
      setLastAnalyzedText(text);
      if (result.title && !titleEdited) setQuickTitle(result.title);
      void autoSave({ pendingAnalysis: result });

      // In chat mode: post result as a message bubble
      if (mode === "chat") {
        const A = J.analysis;
        const lines = [`${A.title}\n`];
        if (result.title) lines.push(`${A.dreamTitle}   ${result.title}`);
        if (result.mood) lines.push(`${A.mood}   ${result.mood}`);
        if (result.stressScore != null) lines.push(`${A.stress}   ${result.stressScore} / 5`);
        if (result.people.length) lines.push(`\n${A.people}   ${result.people.join("  ·  ")}`);
        if (result.locations.length) lines.push(`${A.locations}   ${result.locations.join("  ·  ")}`);
        if (result.symbols.length) lines.push(`${A.symbols}   ${result.symbols.join("  ·  ")}`);
        if (result.sleepInsight) lines.push(`\n${result.sleepInsight}`);
        setMessages((prev) => [
          ...prev,
          { id: `analysis-${Date.now()}`, role: "assistant", content: lines.join("\n"), questions: [] },
        ]);
      }
      // In quick mode: show next-step prompt
      if (mode === "quick") setShowNextStep(true);
    } catch (err) {
      if (mode === "chat") {
        setMessages((prev) => [
          ...prev,
          {
            id: `aerr-${Date.now()}`,
            role: "assistant",
            content: err instanceof Error ? err.message : J.analyzeError,
            questions: [],
          },
        ]);
      }
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function generateImage() {
    const dreamText = getDreamText();
    const promptToUse = imagePrompt.trim() || buildDreamImagePrompt({
      rawText: dreamText,
      mood: analysis?.mood ?? "",
      people: analysis?.people ?? [],
      locations: analysis?.locations ?? [],
      symbols: analysis?.symbols ?? [],
      tags: [],
    });
    if (!dreamText.trim() || !promptToUse.trim() || isGeneratingImage) return;
    setIsGeneratingImage(true);
    setImageError("");
    setDownloadError("");
    setIsDevelopingRoomOpen(true);
    try {
      const userGender = (() => { try { return localStorage.getItem("dreamReel_userGender") ?? ""; } catch { return ""; } })();
      const personGendersRaw = (() => { try { const s = localStorage.getItem("dreamReel_personGenders"); return s ? JSON.parse(s) as Record<string, string> : {}; } catch { return {}; } })();
      const genderParts: string[] = [];
      if (userGender) genderParts.push(lang === "zh" ? `做梦者：${userGender === "male" ? "男性" : userGender === "female" ? "女性" : "其他"}` : `Dreamer: ${userGender}`);
      for (const person of (analysis?.people ?? [])) {
        const g = personGendersRaw[person.trim().toLowerCase()];
        if (g) genderParts.push(lang === "zh" ? `${person}：${g === "male" ? "男性" : g === "female" ? "女性" : "其他"}` : `${person}: ${g}`);
      }
      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptToUse,
          size: "1024x1024",
          visualBrief: analysis?.visualBrief || null,
          dreamText: dreamText || null,
          genderContext: genderParts.length ? genderParts.join("；") : null,
        }),
      });
      const data = (await res.json()) as { imageUrl?: string; error?: string };
      if (res.status === 402) { router.push("/pricing"); return; }
      if (!res.ok) {
        throw new Error(getApiErrorMessage(data.error, lang, J.nb.imageFailed));
      }
      if (data.imageUrl) {
        setGeneratedImageUrl(data.imageUrl);
        setChatUnlocked(true);
        void refreshBillingStatus();
        void autoSave({ pendingImageUrl: data.imageUrl });
      } else {
        throw new Error(J.nb.imageNone);
      }
    } catch (err) {
      console.error(err);
      setImageError(err instanceof Error ? err.message : J.nb.imageFailed);
    } finally {
      setIsGeneratingImage(false);
    }
  }

  function enterDreamChat() {
    const text = quickText.trim();
    if (!text || !generatedImageUrl) return;
    const realityQuestion = getRealityQuestion(lang);

    const contextLines = [
      lang === "zh" ? "我已经把你的梦境显影成了一张图。" : "Your dream image has finished developing.",
    ];
    if (analysis?.mood) {
      contextLines.push(lang === "zh" ? `我读到的情绪基调是：${analysis.mood}。` : `The mood I read is: ${analysis.mood}.`);
    }
    if (analysis?.locations?.length) {
      contextLines.push(lang === "zh" ? `反复浮现的地点：${analysis.locations.join("、")}。` : `Places that surfaced: ${analysis.locations.join(", ")}.`);
    }
    contextLines.push(realityQuestion);

    setVisibleChatMessageCount(CHAT_RENDER_WINDOW);
    setMessages([
      { id: "welcome", role: "assistant", content: J.welcome },
      { id: `u-dream-${Date.now()}`, role: "user", content: text },
      {
        id: `a-image-${Date.now()}`,
        role: "assistant",
        content: contextLines.join("\n\n"),
        questions: [realityQuestion],
        stage: "deepening",
        nextAction: "ask_followup",
        memory: {
          missingDetails: [
            lang === "zh" ? "现实生活关联" : "real-life connection",
          ],
          observedSignals: [
            ...(analysis?.mood ? [analysis.mood] : []),
            ...(analysis?.locations ?? []),
          ],
        },
      },
    ]);
    setJournalMode("chat");
    setPanel("none");
    setStep("dream");
  }

  async function downloadDreamImage() {
    if (!generatedImageUrl || isDownloadingImage) return;
    setIsDownloadingImage(true);
    setDownloadError("");
    try {
      const response = await fetch(generatedImageUrl);
      if (!response.ok) throw new Error("Image download failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
      anchor.href = url;
      anchor.download = `${(quickTitle || analysis?.title || "dream").replace(/[\\/:*?"<>|]/g, "_")}.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setDownloadError(J.nb.downloadFailed);
    } finally {
      setIsDownloadingImage(false);
    }
  }

  function continueFromImage() {
    setIsDevelopingRoomOpen(false);
    if (mode === "quick") {
      enterDreamChat();
    } else {
      setPanel("none");
      setStep("dream");
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function autoSave(opts?: {
    pendingAnalysis?: AnalysisResult;
    pendingImageUrl?: string | null;
  }) {
    const text = getDreamText();
    if (!text.trim()) return;

    if (isSavingRef.current) {
      pendingSaveRef.current = true;
      pendingOptsRef.current = { ...pendingOptsRef.current, ...opts };
      return;
    }

    const startedRevision = saveRevisionRef.current;
    isSavingRef.current = true;
    setAutoSaveStatus("saving");

    const effectiveAnalysis =
      opts?.pendingAnalysis ?? (lastAnalyzedText === text ? analysis : null);
    const effectiveImageUrl =
      opts?.pendingImageUrl !== undefined ? opts.pendingImageUrl : generatedImageUrl;

    // Apply keyword aliases so merged synonyms get saved under the canonical label
    const kwAliases = (() => { try { const s = localStorage.getItem("dreamReel_keywordAliases"); return s ? JSON.parse(s) as { people?: Record<string, string>; locations?: Record<string, string> } : {}; } catch { return {}; } })();
    const applyAlias = (vals: string[], kind: "people" | "locations") =>
      vals.map((v) => kwAliases[kind]?.[v.trim().toLowerCase()] ?? v);

    try {
      const body = {
        agentInteractionId: mode === "chat" ? latestAgentInteractionIdRef.current ?? undefined : undefined,
        inputMode,
        title: effectiveAnalysis?.title || quickTitleRef.current || "",
        rawText: text,
        cleanText: text,
        mood: effectiveAnalysis?.mood ?? "",
        stressScore,
        people: applyAlias(effectiveAnalysis?.people ?? [], "people"),
        locations: applyAlias(effectiveAnalysis?.locations ?? [], "locations"),
        symbols: effectiveAnalysis?.symbols ?? [],
        capturedAt: dreamDate || undefined,
        imageUrl: effectiveImageUrl,
        assetStatus: effectiveImageUrl ? "generated" : null,
        sleepStart: sleepStart || null,
        wakeTime: wakeTime || null,
        sleepQuality,
        preSleepMeal: preSleepMeal || null,
        preSleepActivity: preSleepActivity || null,
        sleepInsight: effectiveAnalysis?.sleepInsight || null,
        visualBrief: effectiveAnalysis?.visualBrief || null,
      };

      let res: Response;
      const isNewEntry = !savedEntryIdRef.current;
      if (savedEntryIdRef.current) {
        res = await fetch("/api/dreams", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, id: savedEntryIdRef.current }),
        });
      } else {
        res = await fetch("/api/dreams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      if (res.status === 402) { router.push("/pricing"); return; }
      if (res.ok) {
        const data = (await res.json()) as { entry?: { id: number } };
        if (data.entry?.id && !savedEntryIdRef.current) {
          savedEntryIdRef.current = data.entry.id;
        }
        setSavedImageUrl(effectiveImageUrl);
        if (isNewEntry) void refreshBillingStatus();
        if (saveRevisionRef.current === startedRevision) {
          setAutoSaveStatus("saved");
          setTimeout(() => setAutoSaveStatus((s) => (s === "saved" ? "idle" : s)), 3000);
        }
      } else {
        if (saveRevisionRef.current === startedRevision) setAutoSaveStatus("error");
      }
    } catch {
      if (saveRevisionRef.current === startedRevision) setAutoSaveStatus("error");
    } finally {
      isSavingRef.current = false;
      const pending = pendingOptsRef.current;
      const shouldFlushLatest = shouldFlushLatestSave({
        pendingSave: pendingSaveRef.current,
        pendingOptions: Object.keys(pending).length > 0,
        startedRevision,
        currentRevision: saveRevisionRef.current,
      });
      pendingSaveRef.current = false;
      pendingOptsRef.current = {};
      if (shouldFlushLatest) {
        setTimeout(() => void autoSaveLatestRef.current?.(pending), 80);
      }
    }
  }

  autoSaveLatestRef.current = autoSave;


  // ── notebook spread ─────────────────────────────────────────────────────────
  const N = J.nb;
  const roomRef = useRef<HTMLDialogElement>(null);
  const roomOpenerRef = useRef<HTMLElement | null>(null);
  const sleepFirstRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  // React 19 ref callback with a cleanup: it is not called again with null, so the cleanup clears the ref
  const threadRef = useCallback((el: HTMLElement | null) => {
    messagesAreaRef.current = el;
    const stopFade = edgeFade(el);
    return () => {
      stopFade?.();
      messagesAreaRef.current = null;
    };
  }, []);

  // the developing room is a native modal dialog: focus moves in, Tab stays inside, Esc closes,
  // and focus goes back to whatever opened it
  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    if (isDevelopingRoomOpen && !room.open) {
      roomOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      room.showModal();
    } else if (!isDevelopingRoomOpen && room.open) {
      room.close();
    }
  }, [isDevelopingRoomOpen]);

  function handleRoomClosed() {
    setIsDevelopingRoomOpen(false);
    const opener = roomOpenerRef.current;
    roomOpenerRef.current = null;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.id !== "main-content") return;
      // the button that opened the room may have been replaced (its step is done): land on the page's next action
      // (a button that started generating was disabled, so focus may already have fallen to <body>)
      const usable = opener && opener.isConnected && opener !== document.body && !opener.matches(":disabled") ? opener : null;
      const target = usable ?? document.querySelector<HTMLElement>(`.${css.actions} button:not(:disabled), .${css.printPhoto}, .${css.reply} textarea`);
      target?.focus();
    });
  }

  // a cleared date input still heads the page with today, as before; nothing until mount (server ≠ reader)
  const page = dreamDate || today ? pageDate(dreamDate || today, lang) : null;
  const userStatements = messages.filter((m) => m.role === "user" && !m.isCommand).map((m) => m.content);
  const writtenCount = lang === "zh"
    ? activeDreamText.replace(/\s/g, "").length
    : (activeDreamText.trim() ? activeDreamText.trim().split(/\s+/).length : 0);
  const saveText = autoSaveStatus === "error" ? N.saveError
    : autoSaveStatus === "saving" ? N.saving
      : autoSaveStatus === "saved" ? N.saved
        : hasContent ? N.autoSaving : "";
  const canEnterChat = showNextStep && chatUnlocked && !!generatedImageUrl;
  const progress = !currentAnalysis ? 0 : !generatedImageUrl ? 1 : savedImageUrl === generatedImageUrl ? 3 : 2;
  const quota = billingStatus
    ? `${B.analysisLeft.replace("{count}", String(billingStatus.remaining.analysis))} · ${B.imagesLeft.replace("{count}", String(billingStatus.remaining.imageGenerations))}`
    : "";
  const printCaption = `${page ? `${page.short} — ` : ""}${quickTitle || analysis?.title || N.room.untitled}`;
  const imageFileName = `${(quickTitle || "dream").replace(/[\\/:*?"<>|]/g, "_")}.png`;

  function openImagePrompt() {
    setPanel("image");
    requestAnimationFrame(() => promptRef.current?.focus());
  }

  function openSleepLog() {
    setStep("sleep");
    requestAnimationFrame(() => sleepFirstRef.current?.focus());
  }

  const voiceButton = (compact: boolean) => (
    <button
      type="button"
      className={`${css.voice}${compact ? ` ${css.voiceCompact}` : ""}${isRecording ? ` ${css.recording}` : ""}`}
      onClick={toggleVoiceRecord}
      aria-pressed={isRecording}
      aria-label={compact ? (isRecording ? J.toolbar.recording : J.toolbar.voice) : undefined}
      title={isRecording ? J.toolbar.recording : J.toolbar.voice}
    >
      <span className={css.mic} aria-hidden><MicIcon /></span>
      {!compact && <span>{isRecording ? N.listening : N.speak}</span>}
    </button>
  );

  const slip = (children: React.ReactNode, extra?: string, props?: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={`nb-slip ${css.slip}${extra ? ` ${extra}` : ""}`} {...props}>
      <span className="nb-slip-label" aria-hidden>{N.aiLabel}</span>
      {children}
    </div>
  );

  const inkDots = <span className={css.dots} aria-hidden><i /><i /><i /></span>;

  const imagePanel = panel === "image" && (
    <section className={css.promptPanel} aria-label={J.image.title}>
      <div className={css.promptHead}>
        <span className="nb-kicker">{J.image.title}</span>
        <span className={css.promptHeadActs}>
          {imagePromptEdited && (
            <button type="button" className="nb-act-quiet" onClick={() => setImagePromptEdited(false)}>{J.image.reset}</button>
          )}
          <button type="button" className={css.close} onClick={() => setPanel("none")} aria-label={N.closePrompt}>×</button>
        </span>
      </div>
      <textarea
        ref={promptRef}
        name="imagePrompt"
        aria-label={J.image.title}
        autoComplete="off"
        value={imagePrompt}
        onChange={(e) => { setImagePrompt(e.target.value); setImagePromptEdited(true); }}
        placeholder={J.image.placeholder}
        rows={5}
        className={css.promptText}
      />
      <div className={css.promptFoot}>
        <button
          type="button"
          className={`nb-red-act ${css.redAct}`}
          onClick={() => void generateImage()}
          disabled={isGeneratingImage || !imagePrompt.trim()}
        >
          {isGeneratingImage ? J.image.genLoading : J.image.genBtn}
        </button>
        {imageError
          ? <p className={css.err}>{imageError}</p>
          : <p className={css.hint}>{J.image.hint}{!analysis && <><br />{J.image.analyzeHint}</>}</p>}
        {generatedImageUrl && (
          <span className={css.promptImageActs}>
            <button type="button" className="nb-act-quiet" onClick={() => setIsDevelopingRoomOpen(true)}>{N.viewImage}</button>
            <a href={generatedImageUrl} download={imageFileName} className="nb-act-quiet">{J.image.download}</a>
          </span>
        )}
      </div>
    </section>
  );

  const exitLink = (label: string) => (
    <TurnLink href="/archive" className={`nb-act-quiet ${css.exit}`} title={N.exitTitle}>{label}</TurnLink>
  );

  // ── quick mode, right page ──
  const quickRight = (
    <>
      <div className={css.scroll} ref={edgeFade}>
        {!hasContent && slip(<p className={css.slipText}>{N.quickWelcome}</p>)}

        {hasContent && !currentAnalysis && slip(
          isAnalyzing
            ? <p className={css.slipText}>{N.reading} {inkDots}</p>
            : <>
              <p className={css.slipHead}>{J.quickFlow.analysisWaiting}</p>
              <p className={css.slipText}>{J.workflow.beforeAnalyze}</p>
            </>,
          undefined,
          { "aria-live": "polite" },
        )}

        {currentAnalysis && (
          <div className={`${css.read}${generatedImageUrl ? ` ${css.readWithPrint}` : ""}`} aria-live="polite">
            <dl className={css.facts}>
              {currentAnalysis.title && <div className={css.wide}><dt>{J.analysis.dreamTitle}</dt><dd>{currentAnalysis.title}</dd></div>}
              {currentAnalysis.mood && <div><dt>{J.analysis.mood}</dt><dd>{currentAnalysis.mood}</dd></div>}
              {currentAnalysis.stressScore != null && (
                <div>
                  <dt>{J.analysis.stress}</dt>
                  <dd className={css.stress}>
                    <span aria-hidden>{[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= (currentAnalysis.stressScore ?? 0) ? css.on : undefined} />)}</span>
                    <b>{N.stressValue.replace("{n}", String(currentAnalysis.stressScore))}</b>
                  </dd>
                </div>
              )}
              {currentAnalysis.people.length > 0 && <div><dt>{J.analysis.people}</dt><dd>{currentAnalysis.people.join(" · ")}</dd></div>}
              {currentAnalysis.locations.length > 0 && <div><dt>{J.analysis.locations}</dt><dd>{currentAnalysis.locations.join(" · ")}</dd></div>}
              {currentAnalysis.symbols.length > 0 && <div className={css.wide}><dt>{J.analysis.symbols}</dt><dd>{currentAnalysis.symbols.join(" · ")}</dd></div>}
            </dl>
            {generatedImageUrl && (
              <div className={css.printCol}>
                <figure className={css.print}>
                  <span className="nb-tape" aria-hidden />
                  <button type="button" className={css.printPhoto} onClick={() => setIsDevelopingRoomOpen(true)} aria-label={N.viewImage}>
                    <Image src={generatedImageUrl} alt={N.room.alt} width={512} height={512} unoptimized />
                  </button>
                  <figcaption>{printCaption}</figcaption>
                </figure>
                <button type="button" className={css.downloadFrame} onClick={() => void downloadDreamImage()} disabled={isDownloadingImage}>
                  <span aria-hidden>↓</span> {isDownloadingImage ? N.room.downloading : N.downloadFrame}
                </button>
                {downloadError && <p role="alert" className={css.err}>{downloadError}</p>}
              </div>
            )}
          </div>
        )}

        {currentAnalysis?.sleepInsight && slip(<p className={css.slipText}>{currentAnalysis.sleepInsight}</p>, css.insight)}

        {imagePanel}
      </div>

      <div className={css.foot}>
        {hasContent && (
          <ol className={css.progress} aria-label={N.steps}>
            {[J.workflow.capture, J.workflow.analyze, J.workflow.generate, J.workflow.archive].map((label, i) => (
              <li key={label} className={i <= progress ? css.reached : undefined} aria-current={i === progress ? "step" : undefined}>{label}</li>
            ))}
          </ol>
        )}
        {showNextStep && (
          <p className={css.nextNote}>
            <b>{generatedImageUrl ? J.quickFlow.imageReady : J.quickFlow.chooseNext}</b>
            {generatedImageUrl ? J.quickFlow.chatUnlocked : J.quickFlow.chooseNextDesc}
          </p>
        )}
        {hasContent && (
          <div className={css.actions}>
            {!currentAnalysis ? (
              <button type="button" className="nb-act" onClick={() => void analyzeDream()} disabled={isAnalyzing || isTyping || !hasContent}>
                {isAnalyzing ? J.analyzingBtn : N.organize} <span aria-hidden>→</span>
              </button>
            ) : canEnterChat ? (
              <button type="button" className="nb-act" onClick={enterDreamChat}>
                {J.quickFlow.enterChat} <span aria-hidden>→</span>
              </button>
            ) : (
              <button type="button" className="nb-act" onClick={() => void generateImage()} disabled={isGeneratingImage || !hasContent}>
                {isGeneratingImage ? J.image.genLoading : J.quickFlow.generateImage} <span aria-hidden>→</span>
              </button>
            )}
            <span className={css.quietActs}>
              <button type="button" className="nb-act-quiet" onClick={() => void startDirectDreamChat()} disabled={isAnalyzing || isTyping || !hasContent}>
                {N.chatAbout}
              </button>
              {canEnterChat && !currentAnalysis && (
                <button type="button" className="nb-act-quiet" onClick={enterDreamChat}>{J.quickFlow.enterChat}</button>
              )}
              {showNextStep && (!currentAnalysis || canEnterChat) && (
                <button type="button" className="nb-act-quiet" onClick={() => void generateImage()} disabled={isGeneratingImage || !hasContent}>
                  {isGeneratingImage ? J.image.genLoading : generatedImageUrl ? N.againImage : J.quickFlow.generateImage}
                </button>
              )}
              {(showNextStep || currentAnalysis) && panel !== "image" && (
                <button type="button" className="nb-act-quiet" onClick={openImagePrompt}>{N.editPrompt}</button>
              )}
              {showNextStep && step !== "sleep" && (
                <button type="button" className="nb-act-quiet" onClick={openSleepLog}>{J.toolbar.sleepNext}</button>
              )}
              {exitLink(currentAnalysis || showNextStep ? N.saveExit : N.saveOnly)}
            </span>
          </div>
        )}
      </div>
    </>
  );

  // ── chat mode, right page ──
  const feedbackReasons = ["repetitive", "irrelevant", "too_many_questions", "unsafe", "other"] as const;
  const chatRight = (
    <>
      <section className={css.scroll} ref={threadRef} aria-label={N.chatKicker}>
        <DreamConversationControls
          goal={conversationGoal}
          onGoalChange={setConversationGoal}
          disabled={isTyping}
          lang={lang}
          date={dreamDate}
          statements={userStatements}
        />
        {hiddenChatMessageCount > 0 && (
          <button
            type="button"
            className={`nb-act-quiet ${css.earlier}`}
            onClick={() => setVisibleChatMessageCount((count) => Math.min(count + CHAT_RENDER_WINDOW, messages.length))}
          >
            {N.showEarlier.replace("{count}", String(Math.min(CHAT_RENDER_WINDOW, hiddenChatMessageCount)))}
          </button>
        )}
        {visibleMessages.map((msg) => msg.role === "user" ? (
          <p key={msg.id} className={`nb-hand ${css.said}`}>{msg.content}</p>
        ) : (
          <div key={msg.id} className={`nb-slip ${css.slip}${msg.isError ? ` ${css.slipError}` : ""}`}>
            <span className="nb-slip-label" aria-hidden>{N.aiLabel}</span>
            <p className={css.slipText}>{msg.content}</p>
            {msg.isError && (
              <button type="button" className={`nb-red-act ${css.redAct}`} onClick={() => editAndRetry(msg)}>{N.editRetry}</button>
            )}
            {msg.meta?.feedbackToken && !msg.isError && (
              <div className={css.feedback} role="group" aria-label={N.rate}>
                <button type="button" aria-label={N.helpful} aria-pressed={msg.feedback === "up"} onClick={() => void submitAgentFeedback(msg.id, "up")}>↑</button>
                <button type="button" aria-label={N.notHelpful} aria-pressed={msg.feedback === "down"} onClick={() => void submitAgentFeedback(msg.id, "down")}>↓</button>
                {msg.feedback === "down" && (
                  <span className={css.reasons}>
                    {feedbackReasons.map((reason) => (
                      <button
                        type="button"
                        key={reason}
                        aria-pressed={msg.feedbackReason === reason}
                        onClick={() => void submitAgentFeedback(msg.id, "down", reason)}
                      >{N.reasons[reason]}</button>
                    ))}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}

        {isTyping && slip(<p className={css.slipText}>{inkDots}</p>, css.typing, { role: "status", "aria-label": N.thinking })}

        {agentReadyToAnalyze && (
          <div className={`nb-slip ${css.slip} ${css.decision}`}>
            <span className="nb-slip-label" aria-hidden>{N.aiLabel}</span>
            <p className={css.slipText}>{agentDecisionCopy}</p>
            <div className={css.redActs}>
              <button type="button" className={`nb-red-act ${css.redAct}`} onClick={() => void analyzeDream()} disabled={isAnalyzing}>{organizeDreamLabel}</button>
              <button type="button" className={`nb-red-act ${css.redAct}`} onClick={() => void generateImage()} disabled={isGeneratingImage || !hasContent} aria-busy={isGeneratingImage}>
                {isGeneratingImage ? J.image.genLoading : J.quickFlow.generateImage}
              </button>
              {panel !== "image" && <button type="button" className={`nb-red-act ${css.redAct}`} onClick={openImagePrompt}>{N.editPrompt}</button>}
            </div>
            {!!latestAgentDecision.memory?.observedSignals?.length && (
              <p className={css.signals}>{latestAgentDecision.memory.observedSignals.slice(0, 3).join(" · ")}</p>
            )}
          </div>
        )}

        {latestQuestions.length > 0 && (
          <div className={css.suggest}>
            <span className="nb-kicker">{N.suggestions}</span>
            <div className={css.redActs}>
              {latestQuestions.map((q, i) => (
                <button type="button" key={i} className={`nb-red-act ${css.redAct}`} onClick={() => appendQuestion(q)}>{q}</button>
              ))}
            </div>
          </div>
        )}
      </section>

      {imagePanel}

      <form ref={replyFormRef} className={css.reply} onSubmit={(e) => { e.preventDefault(); void sendMessage(); }}>
        <span className={css.replyMark} aria-hidden>{N.replyMark}</span>
        <textarea
          ref={inputRef}
          name="dreamMessage"
          aria-label={J.chatInputLabel}
          autoComplete="off"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={conversationGoal === "support" ? N.supportPlaceholder : J.placeholder}
          className={`nb-hand ${css.replyInput}`}
          rows={1}
        />
        {voiceButton(true)}
        <button type="submit" disabled={!input.trim() || isTyping} className={css.send} aria-label={N.send} title={N.send}>↵</button>
      </form>
      <div className={css.replyFoot}>
        <span className="nb-mono">{N.replyHint}</span>
        {voiceError && <span className={css.err} role="alert">{voiceError}</span>}
        {hasContent && exitLink(N.saveExit)}
      </div>
    </>
  );

  const roomFragments = dreamFragments.length ? dreamFragments : N.room.fallbackFragments;
  const developed = !!generatedImageUrl && !isGeneratingImage && !imageError;

  return (
    <NotebookShell lean>
      <main className={`nb-stage ${css.stage}`} id="main">
        <Book tilt={false}>
          {/* ── left page: the dreamer's own writing ── */}
          <BookPage side="l" indent folio={page ? `p. ${page.folio}` : undefined} className={css.left} padClassName={css.leftPad}>
            <div className={css.leftHead}>
              <div className={`nb-ink-tabs ${css.tabs}`} role="tablist" aria-label={N.modeTabs}>
                {(["quick", "chat"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    id={`journal-tab-${m}`}
                    role="tab"
                    aria-selected={mode === m}
                    aria-controls={`journal-panel-${m}`}
                    tabIndex={mode === m ? 0 : -1}
                    onClick={() => { setJournalMode(m); if (m === "chat") setStep("dream"); }}
                    onKeyDown={handleModeTabKeyDown}
                  >
                    {m === "quick" ? J.quickMode : J.chatMode}
                  </button>
                ))}
              </div>
              <Link href="/morning-pages" className={css.morningLink}>{T.morningPages.journalLink} <span aria-hidden>→</span></Link>
            </div>

            <div className={`nb-date-line ${css.dateLine}`}>
              <b>{page?.day ?? "\u3000"}</b><span>{page?.weekday}</span>
              <input
                type="date"
                name="dreamDate"
                aria-label={J.sleep.date}
                autoComplete="off"
                value={dreamDate}
                max={today || undefined}
                onFocus={() => setToday(getTodayDate())}
                onChange={(e) => setDreamDate(e.target.value)}
                className={css.dateInput}
              />
            </div>

            {mode === "quick" ? (
              <>
                <input
                  name="dreamTitle"
                  aria-label={N.titleLabel}
                  autoComplete="off"
                  value={quickTitle}
                  onChange={(e) => setQuickTitle(e.target.value, true)}
                  placeholder={isTitleGenerating ? N.titleGenerating : N.titlePlaceholder}
                  className={`${css.title}${isTitleGenerating && !quickTitle ? ` ${css.titleWaiting}` : ""}`}
                />
                <div className={css.writeWrap}>
                  <span className={css.marginNote} aria-hidden>{lang === "zh" ? "刚醒" : "just up"}</span>
                  <textarea
                    name="dreamText"
                    aria-label={J.quickTitle}
                    autoComplete="off"
                    value={quickText}
                    onChange={(e) => {
                      setQuickText(e.target.value);
                      setInputMode("text");
                    }}
                    placeholder={J.quickPlaceholder}
                    className={`quick-textarea nb-hand ${css.write}`}
                  />
                </div>
              </>
            ) : (
              <div className={css.gathered} ref={edgeFade}>
                <span className="nb-kicker">{N.gatheredKicker}</span>
                {userStatements.length
                  ? userStatements.map((text, i) => <p key={i} className={`nb-hand${i > 0 ? ` ${css.later}` : ""}`}>{text}</p>)
                  : <p className={css.gatheredEmpty}>{N.gatheredEmpty}</p>}
              </div>
            )}

            <details
              className={`sleep-context-panel ${css.sleep}`}
              open={step === "sleep"}
              onToggle={(e) => setStep(e.currentTarget.open ? "sleep" : "dream")}
            >
              <summary><span aria-hidden>{step === "sleep" ? "−" : "+"}</span> {step === "sleep" ? J.sleep.title : N.sleepToggle}</summary>
              <div className={css.sleepGrid}>
                <label>
                  <span>{J.sleep.sleepStart}</span>
                  <input ref={sleepFirstRef} type="time" name="sleepStart" autoComplete="off" value={sleepStart} onChange={(e) => setSleepStart(e.target.value)} />
                </label>
                <label>
                  <span>{J.sleep.wakeTime}</span>
                  <input type="time" name="wakeTime" autoComplete="off" value={wakeTime} onChange={(e) => setWakeTime(e.target.value)} />
                </label>
                <fieldset className={css.quality}>
                  <legend>{J.sleep.quality}</legend>
                  <div>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setSleepQuality(sleepQuality === n ? null : n)}
                        className={sleepQuality != null && n <= sleepQuality ? css.on : undefined}
                        aria-pressed={sleepQuality === n}
                        title={`${n} / 5`}
                      ><span className="nb-sr-only">{n}</span></button>
                    ))}
                  </div>
                </fieldset>
                <label>
                  <span>{J.sleep.activity}</span>
                  <input type="text" name="preSleepActivity" autoComplete="off" value={preSleepActivity} onChange={(e) => setPreSleepActivity(e.target.value)} placeholder={J.sleep.activityPlaceholder} maxLength={500} />
                </label>
                <label>
                  <span>{J.sleep.meal}</span>
                  <input type="text" name="preSleepMeal" autoComplete="off" value={preSleepMeal} onChange={(e) => setPreSleepMeal(e.target.value)} placeholder={J.sleep.mealPlaceholder} maxLength={500} />
                </label>
                <label className={css.stressField}>
                  <span>{J.sleep.stress} · {stressScore}</span>
                  <input type="range" min="1" max="5" step="1" value={stressScore} onChange={(e) => setStressScore(Number(e.target.value))} />
                  <small aria-hidden><span>{J.sleep.stressLow}</span><span>{J.sleep.stressHigh}</span></small>
                </label>
              </div>
              <div className={css.sleepFoot}>
                <span className="nb-mono">{J.toolbar.sleepOptional}</span>
                {exitLink(N.saveExit)}
              </div>
            </details>

            <div className={css.leftFoot}>
              {mode === "quick" && voiceButton(false)}
              {mode === "quick" && voiceError && <span className={css.err} role="alert">{voiceError}</span>}
              <span className={`nb-mono ${css.saveState}${autoSaveStatus === "error" ? ` ${css.saveError}` : ""}`}>
                {saveText}{hasContent && <>{saveText ? " · " : ""}{N.chars.replace("{count}", String(writtenCount))}</>}
              </span>
            </div>
          </BookPage>

          {/* ── right page: what it read, or the conversation ── */}
          <BookPage
            side="r"
            folio={page ? `p. ${page.folio + 1}` : undefined}
            padClassName={css.rightPad}
            id={`journal-panel-${mode}`}
            role="tabpanel"
            aria-labelledby={`journal-tab-${mode}`}
          >
            <header className={css.rightHead}>
              <span className="nb-kicker">{mode === "chat" ? N.chatKicker : currentAnalysis ? N.readKicker : N.quickKicker}</span>
              <span className={css.headActs}>
                {mode === "quick" && (isAnalyzing || currentAnalysis) && (<>
                  <button
                    type="button"
                    className="nb-act-quiet"
                    onClick={() => { analysisAutoTriggeredRef.current = true; void analyzeDream(); }}
                    disabled={isAnalyzing || !hasContent}
                  >
                    {isAnalyzing ? J.analyzingBtn : N.reanalyze}
                  </button>
                  {currentAnalysis && <button type="button" className="nb-act-quiet" onClick={() => setAnalysis(null)} title={N.clearTitle}>{N.clear}</button>}
                </>)}
                {billingStatus && !billingStatus.isUnlimited && (
                  <span className={css.billing}>
                    {billingStatus.plan === "plus" ? (
                      <span className="nb-mono" title={quota}>PLUS</span>
                    ) : needsPaymentFix(billingStatus) ? (
                      <Link className={css.upgrade} href="/account" title={B.pastDue}>{B.manage}</Link>
                    ) : billingStatus.checkoutAvailable === false ? (
                      <span className="nb-mono" title={quota}>{B.comingSoon}</span>
                    ) : (
                      <button type="button" className={css.upgrade} onClick={() => void openCheckout()} disabled={isCheckoutLoading} title={quota}>
                        {isCheckoutLoading ? "…" : "Free → Plus"}
                      </button>
                    )}
                  </span>
                )}
              </span>
            </header>

            {mode === "chat" ? chatRight : quickRight}

          </BookPage>
        </Book>
      </main>

      {billingMessage && <div className={css.toast} role="status">{billingMessage}</div>}

      {/* ── the developing room: a print surfacing in the tray under the safelight ── */}
      <dialog
        ref={roomRef}
        className={css.room}
        aria-label={N.room.label}
        onClose={handleRoomClosed}
      >
        {isDevelopingRoomOpen && (
          <div className={css.roomIn}>
            <button type="button" className={css.roomClose} onClick={() => setIsDevelopingRoomOpen(false)}>{N.room.close}</button>

            <div className={css.roomCopy}>
              <p className={css.roomKicker}>{N.room.label}</p>
              <h2>{isGeneratingImage ? N.room.appearing : imageError ? N.room.failed : N.room.surfaced}</h2>
            </div>

            <figure className={`${css.polaroid}${developed ? ` ${css.developed}` : ""}${isGeneratingImage ? ` ${css.developing}` : ""}`}>
              <div className={css.emulsion}>
                {generatedImageUrl
                  ? <Image src={generatedImageUrl} alt={N.room.alt} width={1024} height={1024} unoptimized />
                  : <span className={css.latent} aria-hidden />}
              </div>
              <figcaption>{printCaption}</figcaption>
            </figure>

            {isGeneratingImage && (
              <ol className={css.roomSteps} aria-live="polite">
                {N.room.steps.map((text) => <li key={text}>{text}</li>)}
              </ol>
            )}

            <div className={css.fragments} role="group" aria-label={N.room.fragmentsLabel}>
              {roomFragments.map((fragment, index) => (
                <span key={`${fragment}-${index}`} style={{ "--i": index } as React.CSSProperties}>{fragment}</span>
              ))}
            </div>

            {developed && (
              <div className={css.roomNext}>
                <p role="status">
                  {autoSaveStatus === "error" ? N.room.saveFailed : savedImageUrl === generatedImageUrl ? N.room.saved : N.room.savingImage}
                </p>
                <div className={css.roomActs}>
                  <button type="button" onClick={() => void downloadDreamImage()} disabled={isDownloadingImage}>
                    {isDownloadingImage ? N.room.downloading : N.room.download}
                  </button>
                  <button type="button" onClick={() => router.push("/archive")} disabled={savedImageUrl !== generatedImageUrl || autoSaveStatus === "saving" || autoSaveStatus === "error"}>
                    {N.room.archive}
                  </button>
                  <button type="button" className={css.roomPrimary} onClick={continueFromImage}>{N.room.continueChat}</button>
                  {autoSaveStatus === "error" && (
                    <button type="button" onClick={() => void autoSave({ pendingImageUrl: generatedImageUrl })}>{N.room.retrySave}</button>
                  )}
                </div>
                {downloadError && <p role="alert" className={css.roomError}>{downloadError}</p>}
              </div>
            )}

            {imageError && <p className={css.roomError}>{imageError}</p>}
            {imageError && !isGeneratingImage && (
              <div className={css.roomActs}>
                <button type="button" className={css.roomPrimary} onClick={() => void generateImage()}>{N.room.tryAgain}</button>
                <button type="button" onClick={() => setIsDevelopingRoomOpen(false)}>{N.room.back}</button>
              </div>
            )}
          </div>
        )}
      </dialog>
    </NotebookShell>
  );
}
