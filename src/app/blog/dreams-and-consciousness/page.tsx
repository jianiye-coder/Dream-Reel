"use client";

import Link from "next/link";
import { LangToggle } from "@/components/LangToggle";
import { useLanguage } from "@/contexts/LanguageContext";
import styles from "./page.module.css";

const sources = [
  { label: "Freud · The Interpretation of Dreams", href: "https://www.gutenberg.org/files/66048/66048-h/66048-h.htm" },
  { label: "Freud Museum · Dream-work and distortion", href: "https://www.freud.org.uk/schools/resources/the-interpretation-of-dreams/the-dream-work/" },
  { label: "Jung · Dreams (Collected Works excerpts)", href: "https://www.jstor.org/stable/j.ctt7rsm8" },
  { label: "Adler · What Life Should Mean to You", href: "https://adler.institute/wp-content/uploads/2019/01/what-life-should-mean-to-you-Adler.pdf" },
  { label: "Proust · Swann’s Way", href: "https://www.gutenberg.org/cache/epub/7178/pg7178-images.html" },
  { label: "Dream content and memory consolidation · Sleep (2023)", href: "https://pubmed.ncbi.nlm.nih.gov/37058584/" },
  { label: "Dreaming and emotional memory · Scientific Reports (2024)", href: "https://pubmed.ncbi.nlm.nih.gov/38622204/" },
  { label: "Dreams and consciousness · Stanford Encyclopedia of Philosophy", href: "https://plato.stanford.edu/entries/dreams-dreaming/" },
];

const copy = {
  zh: {
    back: "返回 Dream Reel",
    eyebrow: "梦与意识 · Dream Reel Journal",
    title: "当我们做梦时，谁在看？",
    dek: "弗洛伊德把梦读成欲望的变形，荣格把它看作意识的补偿，普鲁斯特在半梦半醒间追踪记忆如何重建自我，阿德勒则把梦放进一个人正在走向的未来。四种视角并不互相取代，它们共同提醒我们：梦不是一本符号字典，而是一段仍在发生的内在经验。",
    meta: "约 12 分钟阅读 · 心理学、文学与睡眠科学",
    contents: "本文内容",
    nav: ["梦不是谜底", "弗洛伊德", "荣格", "普鲁斯特", "阿德勒", "现代科学", "如何记录"],
    introTitle: "先放下一个误会：梦没有统一的谜底",
    intro: [
      "梦很容易诱发一种冲动：把牙齿、海水、走廊或死亡翻译成固定答案。但这四位思想家真正有价值的地方，并不是给我们一张万能对照表，而是提供四种提问方式。梦可能在隐藏什么？它在补足什么？记忆如何借梦重新排列？此刻的我正准备走向哪里？",
      "这些问题不能证明某个梦“真正意味着”什么。它们更像四束不同角度的光，让梦者自己看见原本被忽略的关系。解释的权力始终应该留在做梦的人手中。",
    ],
    people: [
      {
        id: "freud",
        number: "01",
        name: "西格蒙德·弗洛伊德",
        years: "1856—1939",
        thesis: "梦把无意识的愿望翻译成可以被睡眠容纳的画面。",
        body: [
          "在《梦的解析》中，弗洛伊德区分了梦的“显性内容”和“潜在梦思”。显性内容是醒来后记得的故事；潜在梦思则是通过自由联想逐渐浮现的欲望、冲突和记忆。两者之间并非一一对应。梦会通过凝缩、移置、视觉化与二次加工，把多条心理线索压进一个看似荒诞的场景。",
          "因此，一扇锁住的门并不自动等于压抑，一次坠落也没有通用答案。弗洛伊德的方法要求从梦者自己的联想出发：这扇门让你想到哪一扇门？坠落发生前，你在担心什么？理论的力量在于承认梦有心理结构；它的局限，则是容易把复杂经验过度收束为被压抑的愿望。",
        ],
        prompt: "可以问自己：梦里最不起眼、却让我醒后仍记得的细节，牵出了什么私人联想？",
      },
      {
        id: "jung",
        number: "02",
        name: "卡尔·荣格",
        years: "1875—1961",
        thesis: "梦不是伪装，而是心灵对清醒立场的一次补偿。",
        body: [
          "荣格反对把所有梦都压缩成欲望满足。他认为梦会呈现意识态度中缺失、被轻视或尚未发展的一面：一个白天极度理性的人，夜里可能遭遇汹涌、混乱又富有情感的世界；一个习惯顺从的人，梦里的自己也许第一次说“不”。这就是梦的补偿功能。",
          "荣格还关注原型意象与个体化过程，但他并不主张拿固定符号表机械解梦。同一片海，对不同的人可能是母亲、自由、危险或童年。理解需要在个人经验、文化背景和梦的整体情绪之间来回移动。梦不是判决，它更像心灵发来的另一份立场陈述。",
        ],
        prompt: "可以问自己：这个梦呈现了哪一种白天的我很少允许存在的态度或需要？",
      },
      {
        id: "proust",
        number: "03",
        name: "马塞尔·普鲁斯特",
        years: "1871—1922",
        thesis: "睡眠让稳定的自我松动，记忆再把世界一点点搭回来。",
        body: [
          "普鲁斯特不是临床意义上的梦理论家。他的贡献来自文学：在《追忆似水年华》的开头，叙述者从睡眠中醒来，一时不知道自己身在何处。身体姿势、房间、年代和身份彼此重叠，直到记忆像布景一样重新安放墙壁、家具和过去的自己。",
          "这使梦不再只是需要破译的内容，也成为观察意识如何成形的窗口。我们以为“我”一直完整存在，但在半梦半醒之间，自我更像由身体感觉、习惯、地点和记忆临时拼接而成。普鲁斯特式的记录，不急着解释；它先保存质地——时间错位、房间气味、醒来时尚未归位的那几秒。",
        ],
        prompt: "可以问自己：醒来的最初几秒里，哪个梦中世界仍比现实更真实？",
      },
      {
        id: "adler",
        number: "04",
        name: "阿尔弗雷德·阿德勒",
        years: "1870—1937",
        thesis: "梦把一个人的生活风格带进未来，为尚未解决的问题制造情绪。",
        body: [
          "阿德勒把人理解为朝向目标行动的整体。对他而言，梦与未来有关，但不是预言。梦可能把清醒生活中的问题排演成一个情境，并制造某种醒后仍在的情绪，使人继续沿着熟悉的生活策略前进：回避、证明自己、寻求安全，或准备面对挑战。",
          "所以，反复错过火车未必预示真正的错过。更有用的问题是：这个梦让我带着怎样的情绪醒来？这种焦急、退缩或决心，是否正好支持了我平常处理困难的方式？阿德勒的视角把重点从“这个符号代表什么”转向“这个梦正在推动我做什么”。",
        ],
        prompt: "可以问自己：梦留下的情绪，正在让我靠近问题，还是继续避开它？",
      },
    ],
    scienceTitle: "一百年后，现代科学能确认什么？",
    science: [
      "现代研究并没有证明某一种心理分析理论是梦的唯一解释。我们知道梦并不只发生在 REM 睡眠；REM 梦通常更生动、情绪更强，但 NREM 睡眠也会产生梦境体验。梦是研究意识的一种特殊窗口：外部输入减弱，主观世界仍能自行生成场景、身体与自我。",
      "证据较稳定地支持睡眠参与记忆巩固，但“睡眠帮助记忆”不等于“每一个梦都在执行明确功能”。2023 年一项元分析发现，梦到学习任务与之后更好的记忆表现相关，且这一关系在所纳入的 NREM 研究中更明显。2024 年一项实验也观察到梦境回忆与情绪记忆、次日情绪反应之间的联系。不过，相关性仍不能证明梦的故事本身就是造成改善的机制。",
      "最诚实的结论是：梦会吸收近期经验、旧记忆与情绪关注，并在睡眠中的脑活动里重新组合；它可能伴随记忆与情绪加工，但具体内容为何采取某个形状，仍没有统一答案。",
    ],
    practiceTitle: "把理论变成一种更温柔的记录方式",
    practiceIntro: "记录梦时，不必选边站。你可以按顺序经过四个问题，也可以只停在最有共鸣的一个。",
    steps: [
      ["保存画面", "先写发生了什么，不急着让它有意义。保留原话、顺序、突变和醒来的余韵。"],
      ["寻找私人联想", "像弗洛伊德一样问“它让我想到什么”，但拒绝现成符号答案。"],
      ["看见缺失的一面", "像荣格一样观察，梦是否带来了白天被忽略的情绪、角色或立场。"],
      ["留意自我如何归位", "像普鲁斯特一样记录醒来时身体、房间、时间和身份重新拼合的瞬间。"],
      ["辨认梦的方向", "像阿德勒一样问，这份情绪正推动我靠近什么，又让我避开什么。"],
    ],
    closing: "梦的价值不一定来自一个正确答案。很多时候，它来自一次足够慢的回看：你允许那段夜里的意识被保留下来，也允许今天的自己决定它意味着多少。",
    cta: "记录今晚的梦",
    sourcesTitle: "延伸阅读与资料来源",
    disclaimer: "本文介绍思想史与睡眠研究，不提供医学诊断。若噩梦持续影响睡眠、安全或日常生活，请寻求专业医疗或心理支持。",
  },
  en: {
    back: "Back to Dream Reel",
    eyebrow: "Dreams & consciousness · Dream Reel Journal",
    title: "When we dream, who is watching?",
    dek: "Freud read dreams as transformations of desire. Jung saw them as a counterweight to waking consciousness. Proust traced how memory rebuilds the self at the edge of sleep. Adler placed dreams inside the future a person is already moving toward. These views do not cancel one another. Together, they remind us that a dream is not a symbol dictionary, but an inner experience still in motion.",
    meta: "12 minute read · Psychology, literature, and sleep science",
    contents: "In this essay",
    nav: ["No single answer", "Freud", "Jung", "Proust", "Adler", "Modern science", "A practice"],
    introTitle: "Begin by dropping one misconception: dreams have no universal answer key",
    intro: [
      "Dreams invite instant translation: teeth, water, corridors, death. Yet the lasting value of these four thinkers is not a universal lookup table. It is four different ways of asking: What might the dream conceal? What might it compensate for? How is memory rearranging the self? What future stance am I rehearsing?",
      "None of these questions can prove what a dream truly means. They are angles of light. The authority to decide what resonates should remain with the dreamer.",
    ],
    people: [
      { id: "freud", number: "01", name: "Sigmund Freud", years: "1856—1939", thesis: "The dream translates unconscious wishes into images sleep can tolerate.", body: ["In The Interpretation of Dreams, Freud separated manifest content—the story remembered on waking—from latent dream-thoughts uncovered through association. Condensation, displacement, visual representation, and secondary revision compress many psychological threads into a strange scene.", "A locked door therefore has no automatic meaning. Freud’s method begins with the dreamer’s own associations. Its strength is taking dream structure seriously; its limitation is the tendency to draw diverse experience back toward repressed wishes."], prompt: "Ask: which small detail remained with me, and what private association does it open?" },
      { id: "jung", number: "02", name: "Carl Jung", years: "1875—1961", thesis: "A dream is not merely disguise; it can compensate for the one-sidedness of waking consciousness.", body: ["Jung proposed that dreams bring forward attitudes, feelings, or needs neglected by the waking personality. The relentlessly rational person may meet a turbulent emotional world at night; the compliant person may finally say no.", "Although Jung discussed archetypal imagery and individuation, his approach was not a mechanical symbol code. The same sea can mean mother, freedom, danger, or childhood. Personal history, culture, and the dream’s emotional whole all matter."], prompt: "Ask: what attitude or need appears here that daytime me rarely permits?" },
      { id: "proust", number: "03", name: "Marcel Proust", years: "1871—1922", thesis: "Sleep loosens the stable self; memory slowly rebuilds its world.", body: ["Proust was not a clinical dream theorist. His contribution is literary. At the opening of In Search of Lost Time, the narrator wakes uncertain of his room, era, and identity. Posture, rooms, and former selves overlap until memory reconstructs the scene.", "Dreaming becomes more than content to decode. It shows consciousness taking shape. A Proustian dream record preserves texture before explanation: temporal slips, the felt room, and the seconds in which the waking self has not yet returned."], prompt: "Ask: in the first seconds of waking, what part of the dream world still felt more real?" },
      { id: "adler", number: "04", name: "Alfred Adler", years: "1870—1937", thesis: "Dreams carry a person’s style of life toward the problems ahead.", body: ["For Adler, dreams relate to the future without predicting it. They stage unresolved problems and generate feelings that may support a familiar strategy: avoiding, proving oneself, seeking safety, or preparing to act.", "Repeatedly missing a train need not predict a real loss. The more useful question is what the dream’s anxiety or resolve prepares the dreamer to do. Adler shifts attention from what a symbol means to what the dream is moving us toward."], prompt: "Ask: is the feeling left by this dream helping me approach the problem or avoid it?" },
    ],
    scienceTitle: "A century later, what can modern science actually confirm?",
    science: ["No modern evidence establishes one psychoanalytic account as the single explanation of dreams. Dreams occur in both REM and NREM sleep. REM dreams are often more vivid and emotional, while dreaming itself offers consciousness research a state in which an immersive subjective world arises with reduced external input.", "Evidence strongly supports a role for sleep in memory consolidation, but that does not mean every dream performs a clear function. A 2023 meta-analysis linked task-related dreaming with better later memory, especially among included NREM studies. A 2024 experiment also connected dream recall with emotional-memory processing and next-day emotional response. Association, however, is not proof that the dream narrative itself causes these effects.", "The most defensible view is that dreams draw on recent experience, older memory, and emotional concerns, recombining them within sleeping brain activity. Their exact form still has no single settled explanation."],
    practiceTitle: "Turn theory into a gentler recording practice",
    practiceIntro: "You do not have to choose a school. Move through these questions, or keep only the one that resonates.",
    steps: [["Preserve the scene", "Write what happened before forcing it to mean anything."], ["Follow private associations", "Ask what an image evokes for you, not what a symbol list says."], ["Notice the missing side", "Look for an emotion, role, or stance neglected during the day."], ["Watch the self return", "Record how body, room, time, and identity reassembled on waking."], ["Sense the direction", "Ask what the dream’s feeling moves you toward—or helps you avoid."]],
    closing: "A dream’s value may not lie in a correct answer. It may lie in looking slowly enough to preserve a night-time form of consciousness, while letting the waking self decide how much it means.",
    cta: "Record tonight’s dream",
    sourcesTitle: "Sources and further reading",
    disclaimer: "This essay presents intellectual history and sleep research, not medical diagnosis. If nightmares persistently affect sleep, safety, or daily life, seek qualified professional support.",
  },
} as const;

export default function DreamsAndConsciousnessPage() {
  const { lang } = useLanguage();
  const C = copy[lang];

  return (
    <main className={styles.page}>
      <div className={styles.glow} aria-hidden />
      <header className={styles.header}>
        <Link href="/" className={styles.back}>← {C.back}</Link>
        <LangToggle className={styles.lang} />
      </header>

      <article className={styles.article}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>{C.eyebrow}</p>
          <h1>{C.title}</h1>
          <p className={styles.dek}>{C.dek}</p>
          <p className={styles.meta}>{C.meta}</p>
        </header>

        <nav className={styles.toc} aria-label={C.contents}>
          <span>{C.contents}</span>
          {C.nav.map((item, index) => (
            <a key={item} href={index === 0 ? "#begin" : index < 5 ? `#${C.people[index - 1].id}` : index === 5 ? "#science" : "#practice"}>{item}</a>
          ))}
        </nav>

        <section id="begin" className={styles.proseSection}>
          <p className={styles.sectionNumber}>00</p>
          <h2>{C.introTitle}</h2>
          {C.intro.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>

        {C.people.map((person) => (
          <section id={person.id} className={styles.person} key={person.id}>
            <div className={styles.personHeading}>
              <p>{person.number}</p>
              <div><h2>{person.name}</h2><span>{person.years}</span></div>
            </div>
            <p className={styles.thesis}>{person.thesis}</p>
            <div className={styles.columns}>{person.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
            <aside className={styles.prompt}>{person.prompt}</aside>
          </section>
        ))}

        <section id="science" className={styles.proseSection}>
          <p className={styles.sectionNumber}>05</p>
          <h2>{C.scienceTitle}</h2>
          {C.science.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>

        <section id="practice" className={styles.practice}>
          <p className={styles.sectionNumber}>06</p>
          <h2>{C.practiceTitle}</h2>
          <p>{C.practiceIntro}</p>
          <ol>{C.steps.map(([title, body], index) => <li key={title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{title}</h3><p>{body}</p></div></li>)}</ol>
        </section>

        <blockquote className={styles.closing}>{C.closing}</blockquote>
        <Link href="/journal" className={styles.cta}>{C.cta} →</Link>

        <footer className={styles.sources}>
          <h2>{C.sourcesTitle}</h2>
          <ul>{sources.map((source) => <li key={source.href}><a href={source.href} target="_blank" rel="noreferrer">{source.label} ↗</a></li>)}</ul>
          <p>{C.disclaimer}</p>
        </footer>
      </article>
    </main>
  );
}
