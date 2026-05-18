"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { DreamAgentMemory, DreamAgentNextAction, DreamAgentStage } from "@/lib/dreamFollowUpAgent";
import { getRealityQuestion } from "@/lib/dreamQuestions";
import { buildDreamImagePrompt } from "@/lib/imagePrompt";
import { useLanguage } from "@/contexts/LanguageContext";
import { LangToggle } from "@/components/LangToggle";

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

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  questions?: string[];
  stage?: DreamAgentStage;
  nextAction?: DreamAgentNextAction;
  memory?: DreamAgentMemory;
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
  remaining: { dreamEntries: number; analysis: number; imageGenerations: number };
};

export default function JournalPage() {
  const { lang, T } = useLanguage();
  const J = T.journal;
  const B = T.billing;
  const { data: session } = useSession();
  const router = useRouter();

  const [mode, setMode] = useState<"chat" | "quick">("quick");
  const [chatUnlocked, setChatUnlocked] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [welcomed, setWelcomed] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [input, setInput] = useState("");
  const [panel, setPanel] = useState<ActivePanel>("none");
  const [step, setStep] = useState<"dream" | "sleep">("dream");
  const [quickText, setQuickText] = useState("");
  const [inputMode, setInputMode] = useState<"text" | "voice">("text");

  // Sleep context
  const [dreamDate, setDreamDate] = useState(getTodayDate);
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
  const pendingOptsRef = useRef<{ pendingAnalysis?: AnalysisResult; pendingImageUrl?: string | null }>({});
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRenderRef = useRef(true);
  const analysisAutoTriggeredRef = useRef(false);
  const isAnalyzingRef = useRef(false);

  const messagesAreaRef = useRef<HTMLElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const undoStack = useRef<string[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  async function refreshBillingStatus() {
    if (!session?.user) return;
    try {
      const res = await fetch("/api/billing/status", { cache: "no-store" });
      if (!res.ok) return;
      setBillingStatus((await res.json()) as BillingStatus);
    } catch {
      // Billing status is useful guidance, but it should not block dream capture.
    }
  }

  async function openCheckout() {
    setIsCheckoutLoading(true);
    setBillingMessage("");
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang, currency: lang === "zh" ? "cny" : "usd" }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || B.checkoutError);
      window.location.href = data.url;
    } catch (error) {
      setBillingMessage(error instanceof Error ? error.message : B.checkoutError);
    } finally {
      setIsCheckoutLoading(false);
    }
  }

  useEffect(() => {
    void refreshBillingStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user, lang]);

  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("upgraded") === "1") {
      setBillingMessage(B.upgraded);
      void refreshBillingStatus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // Seed or update welcome message when lang changes
  useEffect(() => {
    const welcome: ChatMessage = { id: "welcome", role: "assistant", content: J.welcome };
    if (!welcomed) {
      setMessages([welcome]);
      setWelcomed(true);
    } else {
      setMessages((prev) =>
        prev.map((m) => (m.id === "welcome" ? { ...m, content: J.welcome } : m)),
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // Auto-build image prompt from active content
  useEffect(() => {
    if (imagePromptEdited) return;
    const text =
      mode === "chat"
        ? messages.filter((m) => m.role === "user").map((m) => m.content).join(" ")
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, quickText, analysis, imagePromptEdited, mode]);

  // Latest questions from most recent AI message
  const latestQuestions = useMemo(() => {
    const ai = messages.filter((m) => m.role === "assistant" && m.questions?.length);
    return ai[ai.length - 1]?.questions ?? [];
  }, [messages]);

  const latestAgentDecision = useMemo(() => {
    const ai = messages.filter((m) => m.role === "assistant" && m.nextAction);
    return ai[ai.length - 1] ?? null;
  }, [messages]);
  const agentReadyToAnalyze = latestAgentDecision?.nextAction === "ready_to_analyze";
  const agentDecisionCopy = lang === "zh"
    ? "Agent 判断：这场梦的信息已经足够整理。"
    : "Agent decision: this dream is ready to organize.";
  const organizeDreamLabel = (() => {
    if (isAnalyzing) return J.analyzingBtn;
    return lang === "zh" ? "整理这场梦" : "Organize this dream";
  })();

  const activeDreamText =
    mode === "chat"
      ? messages.filter((m) => m.role === "user").map((m) => m.content).join("\n\n")
      : quickText;
  const hasContent = activeDreamText.trim().length > 0;
  const rawFragments = activeDreamText
    .split(/[，。,.!?！？\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const dreamFragments = rawFragments.slice(-5);
  const currentAnalysis = analysis && lastAnalyzedText === activeDreamText ? analysis : null;
  const memoryNodes = [
    ...(currentAnalysis?.people ?? []).map((value) => ({ value, kind: J.analysis.people })),
    ...(currentAnalysis?.locations ?? []).map((value) => ({ value, kind: J.analysis.locations })),
    ...(currentAnalysis?.symbols ?? []).map((value) => ({ value, kind: J.analysis.symbols })),
  ].slice(0, 9);
  const previewNodes = memoryNodes.length
    ? memoryNodes
    : rawFragments.slice(-6).map((value) => ({ value, kind: J.memoryPreview.fragment }));

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
    if (!hasContent) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      void autoSave();
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
  }, [quickText, messages]);

  // Follow the chat inside the message pane without moving the whole page.
  useEffect(() => {
    if (!hasContent) return;
    const messagesArea = messagesAreaRef.current;
    if (!messagesArea) return;
    messagesArea.scrollTo({
      top: messagesArea.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isTyping, hasContent]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || isTyping) return;

    undoStack.current.push(input);

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setIsTyping(true);

    try {
      const history = messages
        .filter((m) => m.id !== "welcome")
        .map((m) => ({ role: m.role, content: m.content }));
      history.push({ role: "user" as const, content: text });

      const res = await fetch("/api/chat-dream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          lang,
          preSleepMeal: preSleepMeal || undefined,
          preSleepActivity: preSleepActivity || undefined,
        }),
      });

      const data = (await res.json()) as {
        message?: string;
        questions?: string[];
        stage?: DreamAgentStage;
        nextAction?: DreamAgentNextAction;
        memory?: DreamAgentMemory;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error ?? J.signalLost);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: data.message ?? "……",
          questions: data.questions ?? [],
          stage: data.stage,
          nextAction: data.nextAction,
          memory: data.memory,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: err instanceof Error ? `${J.signalLost} ${err.message}` : J.signalLost,
          questions: [],
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
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
      ? messages.filter((m) => m.role === "user").map((m) => m.content).join("\n\n")
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
    if (!res.ok) throw new Error(data.error ?? J.analyzeError);

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
            content: `${J.analyzeError}${err instanceof Error ? err.message : lang === "zh" ? "请稍后再试" : "please try again"}`,
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
      if (!res.ok) throw new Error(data.error ?? "图片生成失败，请稍后重试。");
      if (data.imageUrl) {
        setGeneratedImageUrl(data.imageUrl);
        setChatUnlocked(true);
        void refreshBillingStatus();
        void autoSave({ pendingImageUrl: data.imageUrl });
      }
    } catch (err) {
      console.error(err);
      setImageError(err instanceof Error ? err.message : "图片生成失败，请稍后重试。");
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
    setMode("chat");
    setPanel("none");
    setStep("dream");
  }

  async function autoSave(opts?: {
    pendingAnalysis?: AnalysisResult;
    pendingImageUrl?: string | null;
  }) {
    const text = getDreamText();
    if (!text.trim()) return;

    if (isSavingRef.current) {
      pendingOptsRef.current = { ...pendingOptsRef.current, ...opts };
      return;
    }

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
        if (isNewEntry) void refreshBillingStatus();
        setAutoSaveStatus("saved");
        setTimeout(() => setAutoSaveStatus((s) => (s === "saved" ? "idle" : s)), 3000);
      } else {
        setAutoSaveStatus("error");
      }
    } catch {
      setAutoSaveStatus("error");
    } finally {
      isSavingRef.current = false;
      const pending = pendingOptsRef.current;
      if (Object.keys(pending).length > 0) {
        pendingOptsRef.current = {};
        setTimeout(() => void autoSave(pending), 80);
      }
    }
  }

  return (
    <div className="journal-root">
      <div className="grain-overlay" aria-hidden />
      <div className="dream-orb orb-1" aria-hidden />
      <div className="dream-orb orb-2" aria-hidden />
      <div className="dream-orb orb-3" aria-hidden />

      {/* Nav */}
      <nav className="journal-nav">
        <Link href="/" className="landing-logo">
          <Image src="/dream-reel-logo.png" alt="" aria-hidden width={36} height={36} className="logo-img" />
          <span>Dream Reel</span>
        </Link>

        <div className="journal-flow-label" aria-label={J.modeLabel}>
          <span>{mode === "chat" ? J.chatMode : J.quickMode}</span>
          <small>{mode === "chat" ? J.chatModeDesc : J.quickModeDesc}</small>
        </div>

        <div className="nav-actions">
          {billingStatus && !billingStatus.isUnlimited && (
            billingStatus.plan === "plus" ? (
              <span className="billing-pill" title={`${B.analysisLeft.replace("{count}", String(billingStatus.remaining.analysis))} · ${B.imagesLeft.replace("{count}", String(billingStatus.remaining.imageGenerations))}`}>
                Plus
              </span>
            ) : (
              <button
                type="button"
                className="nav-btn billing-upgrade-btn"
                onClick={() => void openCheckout()}
                disabled={isCheckoutLoading}
                title={`${B.analysisLeft.replace("{count}", String(billingStatus.remaining.analysis))} · ${B.imagesLeft.replace("{count}", String(billingStatus.remaining.imageGenerations))}`}
              >
                {isCheckoutLoading ? "…" : (lang === "zh" ? `Free → Plus` : `Free → Plus`)}
              </button>
            )
          )}
          <LangToggle className="nav-btn" />
          <Link href="/archive" className="nav-btn">{T.nav.archive}</Link>
          <Link href="/account" className="nav-btn">{lang === "zh" ? "账号" : "Account"}</Link>
          {hasContent && (
            <Link href="/archive" className="nav-btn journal-exit-btn" title={lang === "zh" ? "内容已保存，退出记录" : "Content saved — exit"}>
              ✕
            </Link>
          )}
        </div>
      </nav>

      {billingMessage && (
        <div className="billing-toast" role="status">
          {billingMessage}
        </div>
      )}


      {/* Chat mode — messages */}
      {mode === "chat" && step === "dream" && (
        <main className="messages-area" ref={messagesAreaRef}>
          <div className="messages-inner">
            {messages.map((msg, i) => (
              <div
                key={msg.id}
                className={`msg-row ${msg.role === "user" ? "msg-row-user" : "msg-row-ai"}`}
                style={{ animationDelay: `${Math.min(i * 0.04, 0.25)}s` }}
              >
                {msg.role === "assistant" && <div className="msg-avatar">☾</div>}
                <div className={`msg-bubble ${msg.role === "user" ? "bubble-user" : "bubble-ai"}`}>
                  <p className="msg-text">{msg.content}</p>
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="msg-row msg-row-ai">
                <div className="msg-avatar">☾</div>
                <div className="msg-bubble bubble-ai" style={{ padding: "0.65rem 1rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="dream-dot" style={{ animationDelay: `${i * 0.18}s` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </main>
      )}

      {/* Quick record mode */}
      {mode === "quick" && step === "dream" && (
        <main className="quick-area">
          <div className={`quick-inner${panel === "image" ? " quick-inner-wide" : ""}`}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span className="field-label">{J.sleep.date}</span>
                <input
                  type="date"
                  value={dreamDate}
                  max={getTodayDate()}
                  onChange={(e) => setDreamDate(e.target.value)}
                  className="dream-input-sm"
                  style={{ width: "auto" }}
                />
              </div>
              <input
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value, true)}
                placeholder={isTitleGenerating
                  ? (lang === "zh" ? "标题生成中…" : "Generating title…")
                  : (lang === "zh" ? "梦境标题（写完后自动填充）" : "Title (auto-fills after you write)")}
                className="dream-input-sm"
                style={{ flex: 1, minWidth: "10rem", opacity: isTitleGenerating && !quickTitle ? 0.55 : 1 }}
              />
            </div>

            {/* Dream textarea + image prompt side by side */}
            <div className={panel === "image" ? "quick-split" : ""}>
              <div className="quick-record-field">
                <textarea
                  value={quickText}
                  onChange={(e) => {
                    setQuickText(e.target.value);
                    setInputMode("text");
                  }}
                  placeholder={J.quickPlaceholder}
                  className="quick-textarea"
                />
                <button
                  type="button"
                  className={`voice-input-btn ${isRecording ? "voice-input-btn-active" : ""}`}
                  style={{ position: "absolute", right: "0.75rem", bottom: "0.75rem" }}
                  onClick={toggleVoiceRecord}
                  aria-label={isRecording ? J.toolbar.recording : J.toolbar.voice}
                  title={isRecording ? J.toolbar.recording : J.toolbar.voice}
                >
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path d="M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3Z" />
                    <path d="M5.75 10.5v1a6.25 6.25 0 0 0 12.5 0v-1" />
                    <path d="M12 17.75v2.75" />
                    <path d="M8.75 20.5h6.5" />
                  </svg>
                </button>
              </div>

              {/* Image prompt column — quick mode only, inline */}
              {panel === "image" && (
                <div className="image-prompt-col">
                  <div className="image-prompt-col-header">
                    <span className="image-prompt-col-title">{J.image.title}</span>

                    {imagePromptEdited && (
                      <button
                        type="button"
                        className="reset-btn"
                        onClick={() => setImagePromptEdited(false)}
                      >
                        {J.image.reset}
                      </button>
                    )}
                    <button
                      type="button"
                      className="panel-close"
                      onClick={() => setPanel("none")}
                    >
                      ✕
                    </button>
                  </div>
                  <textarea
                    value={imagePrompt}
                    onChange={(e) => { setImagePrompt(e.target.value); setImagePromptEdited(true); }}
                    placeholder={J.image.placeholder}
                    className="image-prompt-textarea"
                  />
                  <div className="image-prompt-col-footer">
                    <button
                      type="button"
                      onClick={() => void generateImage()}
                      disabled={isGeneratingImage || !imagePrompt.trim()}
                      className="gen-btn"
                      style={{ flexShrink: 0 }}
                    >
                      {isGeneratingImage ? J.image.genLoading : J.image.genBtn}
                    </button>
                    {imageError && <p className="save-err" style={{ margin: 0 }}>{imageError}</p>}
                    {!imageError && (
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                        <p className="hint-text" style={{ margin: 0 }}>{J.image.hint}</p>
                        {!analysis && <p className="hint-text" style={{ margin: 0, opacity: 0.7 }}>{J.image.analyzeHint}</p>}
                      </div>
                    )}
                    {generatedImageUrl && (
                      <>
                        <button
                          type="button"
                          className="developing-open-btn"
                          style={{ margin: 0 }}
                          onClick={() => setIsDevelopingRoomOpen(true)}
                        >
                          {lang === "zh" ? "查看图像" : "View Image"}
                        </button>
                        <a
                          href={generatedImageUrl}
                          download={`${(quickTitle || "dream").replace(/[\\/:*?"<>|]/g, "_")}.png`}
                          className="developing-open-btn"
                          style={{ margin: 0, textDecoration: "none" }}
                        >
                          {J.image.download}
                        </a>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>


            {hasContent && (
              <div className="quick-analysis-entry" aria-live="polite">
                <div className="quick-analysis-entry-copy">
                  <p>{currentAnalysis ? J.quickFlow.analysisReady : J.quickFlow.analysisWaiting}</p>
                  <span>
                    {currentAnalysis
                      ? J.workflow.afterAnalyze
                      : J.workflow.beforeAnalyze}
                  </span>
                </div>
                <button
                  type="button"
                  className="quick-analyze-btn"
                  onClick={() => void analyzeDream()}
                  disabled={isAnalyzing || !hasContent}
                >
                  {isAnalyzing
                    ? J.analyzingBtn
                    : currentAnalysis
                      ? J.quickFlow.reanalyze
                      : J.analyzeBtn}
                </button>
              </div>
            )}

            {/* Analysis result card */}
            {currentAnalysis && mode === "quick" && (
              <div className="quick-analysis-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.625rem" }}>
                  <p style={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(165, 148, 220, 0.7)" }}>
                    {J.analysis.title.replace("✦  ", "")}
                  </p>
                  <button type="button" className="panel-close" onClick={() => setAnalysis(null)}>✕</button>
                </div>
                {currentAnalysis.title && (
                  <div className="quick-analysis-row" style={{ marginBottom: "0.55rem" }}>
                    <span className="quick-analysis-label">{J.analysis.dreamTitle}</span>
                    <span className="quick-analysis-value">{currentAnalysis.title}</span>
                  </div>
                )}
                <div className="quick-analysis-grid">
                  {currentAnalysis.mood && (
                    <div className="quick-analysis-row">
                      <span className="quick-analysis-label">{J.analysis.mood}</span>
                      <span className="quick-analysis-value">{currentAnalysis.mood}</span>
                    </div>
                  )}
                  {currentAnalysis.stressScore != null && (
                    <div className="quick-analysis-row">
                      <span className="quick-analysis-label">{J.analysis.stress}</span>
                      <span className="quick-analysis-value">{currentAnalysis.stressScore} / 5</span>
                    </div>
                  )}
                </div>
                <div className="quick-analysis-tags">
                  {currentAnalysis.people.length > 0 && (
                    <div>
                      <span className="quick-analysis-label" style={{ marginRight: "0.5rem" }}>{J.analysis.people}</span>
                      <span className="quick-analysis-value">{currentAnalysis.people.join("  ·  ")}</span>
                    </div>
                  )}
                  {currentAnalysis.locations.length > 0 && (
                    <div>
                      <span className="quick-analysis-label" style={{ marginRight: "0.5rem" }}>{J.analysis.locations}</span>
                      <span className="quick-analysis-value">{currentAnalysis.locations.join("  ·  ")}</span>
                    </div>
                  )}
                  {currentAnalysis.symbols.length > 0 && (
                    <div>
                      <span className="quick-analysis-label" style={{ marginRight: "0.5rem" }}>{J.analysis.symbols}</span>
                      <span className="quick-analysis-value">{currentAnalysis.symbols.join("  ·  ")}</span>
                    </div>
                  )}
                </div>
                {currentAnalysis.sleepInsight && (
                  <p className="quick-analysis-insight">{currentAnalysis.sleepInsight}</p>
                )}
              </div>
            )}

            {showNextStep && mode === "quick" && (
              <div className="quick-choice-panel">
                <div>
                  <p>{generatedImageUrl ? J.quickFlow.imageReady : J.quickFlow.chooseNext}</p>
                  <span>{generatedImageUrl ? J.quickFlow.chatUnlocked : J.quickFlow.chooseNextDesc}</span>
                </div>
                <div className="quick-choice-actions">
                  <button
                    type="button"
                    className="tool-btn action-primary"
                    onClick={() => void generateImage()}
                    disabled={isGeneratingImage || !hasContent}
                  >
                    {isGeneratingImage ? J.image.genLoading : J.quickFlow.generateImage}
                  </button>
                  <Link href="/archive" className="tool-btn action-secondary" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                    {lang === "zh" ? "保存并退出" : "Save & exit"}
                  </Link>
                  {chatUnlocked && generatedImageUrl && (
                    <button
                      type="button"
                      className="tool-btn action-image"
                      onClick={enterDreamChat}
                    >
                      {J.quickFlow.enterChat}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      )}

      {/* Sleep log — step 2 */}

      {/* Question chips — chat mode only */}
      {mode === "chat" && step === "dream" && agentReadyToAnalyze && (
        <div className="chips-bar agent-decision-bar">
          <div className="chips-inner">
            <span className="agent-decision-copy">
              {agentDecisionCopy}
            </span>
            <button className="chip chip-primary" onClick={() => void analyzeDream()}>
              {organizeDreamLabel}
            </button>
            {latestAgentDecision.memory?.observedSignals?.slice(0, 3).map((signal) => (
              <span key={signal} className="chip chip-static">
                {signal}
              </span>
            ))}
          </div>
        </div>
      )}

      {mode === "chat" && step === "dream" && latestQuestions.length > 0 && (
        <div className="chips-bar">
          <div className="chips-inner">
            {latestQuestions.map((q, i) => (
              <button key={i} className="chip" onClick={() => appendQuestion(q)}>
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="input-wrapper">
        <div className="input-content">

          {/* Dream date — in bottom bar for chat mode only (quick mode has it top-left) */}
          {step === "dream" && mode === "chat" && (
            <div className="dream-date-bar">
              <span className="field-label">{J.sleep.date}</span>
              <input
                type="date"
                value={dreamDate}
                max={getTodayDate()}
                onChange={(e) => setDreamDate(e.target.value)}
                className="dream-input-sm"
                style={{ width: "auto" }}
              />
            </div>
          )}

          {/* Image panel — chat mode only (quick mode shows inline next to dream textarea) */}
          {panel === "image" && mode === "chat" && (
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">{J.image.title}</span>
                <button className="panel-close" onClick={() => setPanel("none")}>✕</button>
              </div>
              <div className="panel-body">
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <textarea
                    value={imagePrompt}
                    onChange={(e) => { setImagePrompt(e.target.value); setImagePromptEdited(true); }}
                    placeholder={J.image.placeholder}
                    rows={6}
                    className="dream-textarea"
                    style={{ flex: 1, resize: "vertical" }}
                  />
                  <button
                    onClick={() => void generateImage()}
                    disabled={isGeneratingImage || !imagePrompt.trim()}
                    className="gen-btn"
                  >
                    {isGeneratingImage ? J.image.genLoading : J.image.genBtn}
                  </button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                    <p className={imageError ? "save-err" : "hint-text"}>
                      {imageError || J.image.hint}
                    </p>
                    {!imageError && !analysis && <p className="hint-text" style={{ opacity: 0.7 }}>{J.image.analyzeHint}</p>}
                  </div>
                  {imagePromptEdited && (
                    <button className="reset-btn" onClick={() => setImagePromptEdited(false)}>
                      {J.image.reset}
                    </button>
                  )}
                </div>
                {generatedImageUrl && (
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button
                      className="developing-open-btn"
                      onClick={() => setIsDevelopingRoomOpen(true)}
                    >
                      {lang === "zh" ? "查看图像" : "View Image"}
                    </button>
                    <a
                      href={generatedImageUrl}
                      download={`${(quickTitle || "dream").replace(/[\\/:*?"<>|]/g, "_")}.png`}
                      className="developing-open-btn"
                      style={{ textDecoration: "none" }}
                    >
                      {J.image.download}
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Input form — chat mode only */}
          {mode === "chat" && step === "dream" && (
            <form
              className="input-form"
              onSubmit={(e) => { e.preventDefault(); void sendMessage(); }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={J.placeholder}
                className="main-input"
                rows={1}
                disabled={isTyping}
              />
              <button
                type="button"
                className={`voice-input-btn ${isRecording ? "voice-input-btn-active" : ""}`}
                onClick={toggleVoiceRecord}
                aria-label={isRecording ? J.toolbar.recording : J.toolbar.voice}
                title={isRecording ? J.toolbar.recording : J.toolbar.voice}
              >
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3Z" />
                  <path d="M5.75 10.5v1a6.25 6.25 0 0 0 12.5 0v-1" />
                  <path d="M12 17.75v2.75" />
                  <path d="M8.75 20.5h6.5" />
                </svg>
              </button>
              <button
                type="submit"
                disabled={!input.trim() || isTyping}
                className="send-btn"
              >
                ↑
              </button>
            </form>
          )}

          <div className="toolbar action-toolbar">
            {step === "dream" && mode === "quick" && (
              <>
                {(isAnalyzing || currentAnalysis) && (
                  <button
                    className="tool-btn action-primary"
                    onClick={() => { analysisAutoTriggeredRef.current = true; void analyzeDream(); }}
                    disabled={isAnalyzing || !hasContent}
                  >
                    {isAnalyzing ? J.analyzingBtn : (lang === "zh" ? "重新分析" : "Re-analyze")}
                  </button>
                )}
              </>
            )}
            <div className="toolbar-spacer" />
            {voiceError && <span className="save-err">{voiceError}</span>}

            {/* Auto-save status */}
            {autoSaveStatus === "error" && (
              <span className="save-err save-status-text">{lang === "zh" ? "保存失败，请重试" : "Save failed"}</span>
            )}
            {autoSaveStatus === "saving" && (
              <span className="save-ok save-status-text" style={{ opacity: 0.7 }}>{lang === "zh" ? "保存中…" : "Saving…"}</span>
            )}
            {autoSaveStatus === "saved" && (
              <span className="save-ok save-status-text">{lang === "zh" ? "已自动保存 ✓" : "Auto-saved ✓"}</span>
            )}
            {autoSaveStatus === "idle" && hasContent && (
              <span className="save-ok save-status-text" style={{ opacity: 0.8 }}>
                {lang === "zh" ? "✦ 内容自动保存中" : "✦ Auto-saving"}
              </span>
            )}
          </div>
        </div>
      </div>

      {isDevelopingRoomOpen && (
        <div className="developing-room" role="dialog" aria-modal="true" aria-label="Dream Developing Room">
          <div className="developing-atmosphere" aria-hidden>
            <span className="developing-glow glow-a" />
            <span className="developing-glow glow-b" />
            <span className="developing-particle particle-a" />
            <span className="developing-particle particle-b" />
            <span className="developing-particle particle-c" />
          </div>

          <button className="developing-close" onClick={() => setIsDevelopingRoomOpen(false)}>
            {lang === "zh" ? "关闭" : "Close"}
          </button>

          <div className="developing-copy">
            <p>{lang === "zh" ? "梦境显影室" : "Dream Developing Room"}</p>
            <h2>{isGeneratingImage
              ? (lang === "zh" ? "梦境正在慢慢浮现。" : "The dream is slowly appearing.")
              : (lang === "zh" ? "梦境已经显影。" : "The dream has surfaced.")
            }</h2>
          </div>

          <div className={`developing-image-stage ${generatedImageUrl && !isGeneratingImage ? "is-developed" : ""}`}>
            <div className={`developing-content-row ${isGeneratingImage ? "developing-content-row-split" : ""}`}>
              <div className="developing-image-shell">
                {generatedImageUrl ? (
                  <>
                    <Image
                      src={generatedImageUrl}
                      alt="梦境图"
                      width={1024}
                      height={1024}
                      unoptimized
                      className="developed-image"
                    />
                    <a
                      href={generatedImageUrl}
                      download={`${(quickTitle || "dream").replace(/[\\/:*?"<>|]/g, "_")}.png`}
                      className="developed-download-btn"
                      title={J.image.download}
                    >
                      ↓
                    </a>
                  </>
                ) : (
                  <div className="developing-placeholder" aria-hidden>
                    <span className="placeholder-moon" />
                    <span className="placeholder-window" />
                    <span className="placeholder-page" />
                  </div>
                )}
              </div>

              {isGeneratingImage && (
                <div className="developing-sleep-invite" aria-label="Sleep log">
                  <p className="developing-sleep-label">
                    {lang === "zh" ? "趁图片还在生成，记录一下昨晚的睡眠" : "While the image generates, log last night's sleep"}
                  </p>
                  <div className="developing-sleep-fields">
                    <label className="developing-sleep-field">
                      <span>{J.sleep.sleepStart}</span>
                      <input type="time" value={sleepStart} onChange={(e) => setSleepStart(e.target.value)} className="dream-input-sm" />
                    </label>
                    <label className="developing-sleep-field">
                      <span>{J.sleep.wakeTime}</span>
                      <input type="time" value={wakeTime} onChange={(e) => setWakeTime(e.target.value)} className="dream-input-sm" />
                    </label>
                    <div className="developing-sleep-field">
                      <span>{J.sleep.quality}</span>
                      <div className="quality-btns">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button key={n} type="button" onClick={() => setSleepQuality(sleepQuality === n ? null : n)} className={`quality-btn ${sleepQuality === n ? "quality-btn-active" : ""}`}>{n}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="developing-steps" aria-live="polite">
              <span>{lang === "zh" ? "正在解读意象…" : "Interpreting symbols..."}</span>
              <span>{lang === "zh" ? "正在重建记忆…" : "Reconstructing memory..."}</span>
              <span>{lang === "zh" ? "让画面找到它的光…" : "Letting the image find its light..."}</span>
            </div>

            <div className="developing-fragments" aria-label="Dream fragments being developed">
              {(dreamFragments.length ? dreamFragments : ["moonlight", "old room", "unfinished door"]).map((fragment, index) => (
                <span key={`${fragment}-${index}`} className={`developing-fragment frag-${index + 1}`}>
                  {fragment}
                </span>
              ))}
            </div>
          </div>

          {imageError ? <p className="developing-error">{imageError}</p> : null}
        </div>
      )}
    </div>
  );
}
