"use client";

import Image from "next/image";
import Link from "next/link";
import { LangToggle } from "@/components/LangToggle";
import { useLanguage } from "@/contexts/LanguageContext";

const morningSteps = {
  zh: [
    { n: "01", title: "先留下碎片", copy: "一句话、一个场景或一种感觉都够。文字和语音会自动保存。" },
    { n: "02", title: "和 Agent 一起回忆", copy: "直接对话，沿着人物、动作和转折，慢慢找回梦的轮廓。" },
    { n: "03", title: "等你准备好再分析", copy: "提取情绪、地点与重复意象，把梦整理成可回看的记忆。" },
  ],
  en: [
    { n: "01", title: "Catch the fragment", copy: "A sentence, a scene, or a feeling is enough. Text and voice save automatically." },
    { n: "02", title: "Recall with the Agent", copy: "Talk it through and gently recover people, movement, and turning points." },
    { n: "03", title: "Analyze when you are ready", copy: "Surface mood, places, and recurring symbols in a memory you can revisit." },
  ],
};

export default function LandingPage() {
  const { lang, T } = useLanguage();
  const L = T.landing;
  const steps = morningSteps[lang];

  return (
    <main className="morning-landing">
      <nav className="morning-nav" aria-label={lang === "zh" ? "主导航" : "Main navigation"}>
        <Link href="/" className="morning-brand" aria-label="Dream Reel home">
          <Image src="/dream-reel-logo.png" width={40} height={40} alt="" aria-hidden />
          <span>Dream Reel</span>
        </Link>
        <div className="morning-nav-links">
          <Link href="/journal">{T.nav.journal}</Link>
          <Link href="/archive">{T.nav.archive}</Link>
          <Link href="/blog/dreams-and-consciousness">{lang === "zh" ? "博客" : "Blog"}</Link>
        </div>
        <div className="morning-nav-actions">
          <LangToggle className="morning-language" />
          <Link href="/journal" className="morning-nav-cta">{L.heroCta1}</Link>
        </div>
      </nav>

      <section className="morning-hero" aria-labelledby="morning-hero-title">
        <div className="morning-hero-copy">
          <p className="morning-eyebrow">{lang === "zh" ? "AI 梦境日记与自我反思工具" : "An AI dream journal for morning reflection"}</p>
          <h1 id="morning-hero-title">{lang === "zh" ? "趁梦还在，先把它留下。" : "Before the dream fades, leave it here."}</h1>
          <p className="morning-lede">
            {lang === "zh"
              ? "快速记录刚醒来的梦，与 AI 一起回忆，并通过温和的提问，把散落的片段变成属于你的长期线索。"
              : "Capture what you just dreamed, recall it with AI, and use gentle questions to turn fragments into patterns that belong to you."}
          </p>
          <div className="morning-hero-actions">
            <Link href="/journal" className="morning-button morning-button-primary">
              {lang === "zh" ? "记录刚醒来的梦" : "Record this morning’s dream"}
            </Link>
            <Link href="/journal" className="morning-button morning-button-secondary">
              {lang === "zh" ? "直接与 Agent 对话" : "Chat with the Agent"}
            </Link>
          </div>
          <p className="morning-trust-line">
            <span aria-hidden>●</span>
            {lang === "zh" ? "自动保存 · 支持语音 · 由你决定何时分析" : "Autosave · Voice input · You choose when to analyze"}
          </p>
        </div>

        <div className="morning-hero-visual" aria-label={lang === "zh" ? "晨间梦境记录示例" : "Morning dream capture example"}>
          <div className="morning-photo-frame">
            <Image
              src="/dream-photo-2.jpg"
              alt={lang === "zh" ? "清晨醒来后，现实与梦境重叠的画面" : "A waking morning where dream and reality overlap"}
              fill
              priority
              sizes="(max-width: 900px) 92vw, 46vw"
              className="morning-photo"
            />
            <span className="morning-photo-time">06:42</span>
          </div>
          <article className="morning-capture-card">
            <div className="morning-capture-topline">
              <span>{lang === "zh" ? "刚刚醒来" : "Just woke up"}</span>
              <span>{lang === "zh" ? "已自动保存" : "Autosaved"}</span>
            </div>
            <p>{lang === "zh" ? "我坐在一辆车里，窗外像海底，但天已经亮了……" : "I was sitting in a train. Outside felt underwater, but the sun was already up…"}</p>
            <div className="morning-capture-actions" aria-hidden>
              <span>{lang === "zh" ? "继续说" : "Keep talking"}</span>
              <span>{lang === "zh" ? "与 Agent 回忆" : "Recall with Agent"}</span>
            </div>
          </article>
        </div>
      </section>

      <section className="morning-process" aria-labelledby="morning-process-title">
        <div className="morning-section-heading">
          <p className="morning-eyebrow">{lang === "zh" ? "低负担的晨间流程" : "A low-friction morning ritual"}</p>
          <h2 id="morning-process-title">{lang === "zh" ? "不必先理解，先不要忘记。" : "You do not need to understand it yet."}</h2>
        </div>
        <div className="morning-step-grid">
          {steps.map((step) => (
            <article key={step.n} className="morning-step-card">
              <span>{step.n}</span>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="morning-studio" aria-labelledby="morning-studio-title">
        <div className="morning-studio-copy">
          <p className="morning-eyebrow">{lang === "zh" ? "从碎片到记忆" : "From fragment to memory"}</p>
          <h2 id="morning-studio-title">{lang === "zh" ? "一场梦，可以有很多种入口。" : "A dream can be entered in more than one way."}</h2>
          <p>{lang === "zh" ? "先聊天、先分析、先生成画面，或者只存下一句话。Dream Reel 不要求你按固定顺序理解自己。" : "Chat first, analyze first, develop an image, or save one sentence. Dream Reel never forces a single path into your inner life."}</p>
          <Link href="/journal" className="morning-text-link">{lang === "zh" ? "打开晨间记录 →" : "Open morning capture →"}</Link>
        </div>
        <div className="morning-bento">
          {L.features.slice(0, 4).map((feature, index) => (
            <article key={feature.title} className={`morning-bento-card morning-bento-${index + 1}`}>
              <p>{feature.eyebrow}</p>
              <h3>{feature.title}</h3>
              <span>{feature.copy}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="morning-archive" aria-labelledby="morning-archive-title">
        <div className="morning-section-heading morning-section-heading-row">
          <div>
            <p className="morning-eyebrow">{lang === "zh" ? "慢慢形成的档案" : "An archive that grows slowly"}</p>
            <h2 id="morning-archive-title">{L.archiveIntroTitle}</h2>
          </div>
          <p>{L.archiveIntroBody}</p>
        </div>
        <div className="morning-archive-grid">
          {L.archiveNodes.map((node, index) => (
            <article key={node.title} className="morning-dream-card">
              <div><span>{node.time}</span><span>0{index + 1}</span></div>
              <h3>{node.title}</h3>
              <p>{node.fragment}</p>
              <strong>{node.signal}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="morning-privacy" aria-labelledby="morning-privacy-title">
        <div>
          <p className="morning-eyebrow">{L.privacyEyebrow}</p>
          <h2 id="morning-privacy-title">{L.privacyTitle}</h2>
          <p>{L.privacyBody}</p>
        </div>
        <ul>{L.privacyNotes.map((note) => <li key={note}>{note}</li>)}</ul>
      </section>

      <footer className="morning-footer">
        <div><Image src="/dream-reel-logo.png" width={36} height={36} alt="" aria-hidden /><span>Dream Reel</span></div>
        <p>{lang === "zh" ? "在梦消失之前，留住第一帧。" : "Keep the first frame before it fades."}</p>
        <div>
          <Link href="/journal">{T.nav.journal}</Link>
          <Link href="/archive">{T.nav.archive}</Link>
          <Link href="/blog/dreams-and-consciousness">{lang === "zh" ? "梦与意识" : "Dreams & consciousness"}</Link>
        </div>
      </footer>
    </main>
  );
}
