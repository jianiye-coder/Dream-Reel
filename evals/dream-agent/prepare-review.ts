import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  deriveDreamAgentConversationContext,
  inferAgentStageFromConversation,
  resolveDeterministicAgentResponse,
  sanitizeDreamAgentResult,
  type DreamAgentResult,
} from "../../src/lib/dreamFollowUpAgent";
import { dreamAgentEvalCases } from "./cases";

interface ArtifactFile {
  model: string;
  label?: string;
  responseFormat: string;
  cases: Array<{ artifact: { id: string; result: DreamAgentResult } }>;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function buildReviewHtml(reviewCases: unknown, reviewId: string) {
  const data = JSON.stringify(reviewCases).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Dream Agent Blind Review</title>
  <style>
    :root{color-scheme:dark;--bg:#0d0b14;--card:#171321;--line:#342b48;--text:#f2edf9;--muted:#ada2bd;--accent:#bfa7ff}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#21182f,var(--bg) 45%);color:var(--text);font:15px/1.55 ui-sans-serif,system-ui;padding:24px}
    main{max-width:1100px;margin:auto}.top{position:sticky;top:0;z-index:3;background:rgba(13,11,20,.92);backdrop-filter:blur(14px);padding:14px 0;border-bottom:1px solid var(--line)}
    h1{font-size:22px;margin:0 0 4px}.muted,.meta{color:var(--muted)}.progress{height:7px;background:#2b233a;border-radius:8px;overflow:hidden;margin-top:12px}.bar{height:100%;background:linear-gradient(90deg,#8d6be8,#d0bfff);transition:width .2s}
    .conversation,.candidate,.review{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;margin-top:16px}.conversation p{margin:7px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.candidate h3{margin-top:0}.candidate li{margin:5px 0}.action{font:12px ui-monospace,monospace;color:var(--accent)}
    .fields{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}label{display:flex;flex-direction:column;gap:5px;color:var(--muted);font-size:12px}select,textarea,button{font:inherit;color:var(--text);background:#211a2e;border:1px solid #45385e;border-radius:9px;padding:9px}textarea{width:100%;min-height:72px;resize:vertical}button{cursor:pointer}button:hover{border-color:var(--accent)}button:disabled{cursor:not-allowed;opacity:.45}.nav{display:flex;justify-content:space-between;gap:12px;margin-top:18px}.nav div{display:flex;gap:10px}.complete{color:#b9f5cf}
    @media(max-width:760px){body{padding:14px}.grid,.fields{grid-template-columns:1fr}.top{top:0}}
  </style>
</head>
<body><main><div class="top"><h1>Dream Agent Blind Review</h1><div class="muted">Focus on whether each response feels caring, dream-specific, reflective, and well-paced—not merely well-written.</div><div id="status" class="muted"></div><div class="progress"><div id="bar" class="bar"></div></div></div><section id="case"></section></main>
<script id="review-data" type="application/json">${data}</script>
<script>
  const cases = JSON.parse(document.getElementById('review-data').textContent);
  const storageKey = 'dream-agent-blind-review:${reviewId}';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch {}
  let current = 0;
  const options = {
    boolean: [['','Choose…'],['yes','Yes'],['no','No']],
    score: [['','Choose…'],['1','1 — poor'],['2','2'],['3','3'],['4','4'],['5','5 — excellent']],
    winner: [['','Choose…'],['A','A'],['B','B'],['tie','Tie']]
  };
  function node(tag, className, text) { const value=document.createElement(tag); if(className)value.className=className; if(text!==undefined)value.textContent=text; return value; }
  function reviewFor(id) { return saved[id] || (saved[id]={A:{},B:{},winner:'',reason:''}); }
  function persist() { localStorage.setItem(storageKey, JSON.stringify(saved)); updateStatus(); }
  function selectField(labelText, target, key, kind) {
    const label=node('label','',labelText); const select=node('select');
    for (const entry of options[kind]) { const option=node('option','',entry[1]); option.value=entry[0]; select.append(option); }
    select.value=target[key] || ''; select.addEventListener('change',()=>{target[key]=select.value;persist()}); label.append(select); return label;
  }
  function candidateCard(label, result, review) {
    const card=node('article','candidate'); card.append(node('h3','', 'Candidate '+label),node('p','',result.message));
    if(result.questions.length){const list=node('ul');for(const question of result.questions)list.append(node('li','',question));card.append(list)}
    card.append(node('div','action','Action: '+result.nextAction+' · Stage: '+result.stage));
    const fields=node('div','fields');
    fields.append(selectField('Caring and natural',review,'caringNatural','score'),selectField('Specific to this dream',review,'dreamSpecific','score'),selectField('Adds a useful reflection',review,'reflectionValue','score'),selectField('Question pacing and timing',review,'pacingTiming','score'),selectField('Safe and respects boundaries',review,'safeBoundaries','boolean')); card.append(fields); return card;
  }
  function isComplete(item){const review=saved[item.id];if(!review||!review.winner)return false;return ['A','B'].every(label=>['caringNatural','dreamSpecific','reflectionValue','pacingTiming','safeBoundaries'].every(key=>review[label]&&review[label][key]));}
  function updateStatus(){const done=cases.filter(isComplete).length;document.getElementById('status').textContent=(current+1)+' / '+cases.length+' · '+done+' completed · progress saves only in this browser';document.getElementById('bar').style.width=(done/cases.length*100)+'%';const download=document.getElementById('download-review');if(download){download.disabled=false;download.textContent=done===cases.length?'Export completed review':'Export current progress ('+done+'/'+cases.length+' complete)';}}
  function render(){const item=cases[current],review=reviewFor(item.id),root=document.getElementById('case');root.replaceChildren();
    const title=node('h2','',item.id);const meta=node('div','meta',item.lang.toUpperCase()+' · '+item.tags.join(', '));const conversation=node('div','conversation');conversation.append(node('strong','','Synthetic conversation'));
    for(const message of item.syntheticConversation)conversation.append(node('p','',message.role+': '+message.content));
    const grid=node('div','grid');grid.append(candidateCard('A',item.candidates.A,review.A),candidateCard('B',item.candidates.B,review.B));
    const summary=node('div','review');summary.append(selectField('Winner',review,'winner','winner'));const reasonLabel=node('label','','One-sentence reason (recommended)');const reason=node('textarea');reason.value=review.reason||'';reason.addEventListener('input',()=>{review.reason=reason.value;persist()});reasonLabel.append(reason);summary.append(reasonLabel);
    const nav=node('div','nav');const left=node('div'),right=node('div');const previous=node('button','','← Previous');previous.disabled=current===0;previous.onclick=()=>{current--;render()};const next=node('button','',current===cases.length-1?'Review first incomplete':'Next →');next.onclick=()=>{if(current<cases.length-1)current++;else{const missing=cases.findIndex(item=>!isComplete(item));current=missing<0?current:missing}render()};const download=node('button','','Export current progress');download.id='download-review';download.onclick=()=>{const blob=new Blob([JSON.stringify({completedAt:new Date().toISOString(),reviews:saved},null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='dream-agent-blind-review-completed.json';link.click();URL.revokeObjectURL(link.href)};left.append(previous);right.append(download,next);nav.append(left,right);
    root.append(title,meta,conversation,grid,summary,nav);updateStatus();window.scrollTo({top:0,behavior:'smooth'});
  }
  render();
</script></body></html>`;
}

async function main() {
  const resanitize = process.argv.includes("--resanitize");
  const paths = process.argv.slice(2).filter((value) => value !== "--resanitize");
  if (paths.length !== 2) {
    throw new Error("Usage: npm run eval:agent:review-pack -- artifact-a.json artifact-b.json [--resanitize]");
  }
  const artifacts = await Promise.all(paths.map(async (path) => JSON.parse(await readFile(path, "utf8")) as ArtifactFile));
  const reviewLabels = (process.env.DREAM_AGENT_REVIEW_LABELS ?? "").split(",").map((value) => value.trim());
  const artifactLabel = (index: number) => reviewLabels[index] || artifacts[index].label || `${artifacts[index].model}/${artifacts[index].responseFormat}`;
  const casesById = new Map(dreamAgentEvalCases.map((evalCase) => [evalCase.id, evalCase]));
  const outputs = artifacts.map((artifact) => new Map(artifact.cases.map((item) => {
    const evalCase = casesById.get(item.artifact.id);
    if (!resanitize || !evalCase) return [item.artifact.id, item.artifact.result] as const;
    const context = deriveDreamAgentConversationContext(evalCase.messages, evalCase.lang, Boolean(evalCase.preSleepContext));
    const result = resolveDeterministicAgentResponse(context, evalCase.lang) ?? sanitizeDreamAgentResult(
      item.artifact.result,
      evalCase.lang,
      inferAgentStageFromConversation(evalCase.messages, evalCase.lang, context),
      context,
    );
    return [item.artifact.id, result] as const;
  })));
  const requestedIds = new Set((process.env.DREAM_AGENT_REVIEW_CASE_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  const shared = dreamAgentEvalCases.filter((evalCase) =>
    (!requestedIds.size || requestedIds.has(evalCase.id)) && outputs.every((output) => output.has(evalCase.id)));
  const selectLanguage = (lang: "zh" | "en") => shared
    .filter((evalCase) => evalCase.lang === lang)
    .sort((left, right) => hash(left.id).localeCompare(hash(right.id)))
    .slice(0, 10);
  const selected = [...selectLanguage("zh"), ...selectLanguage("en")]
    .sort((left, right) => hash(`order:${left.id}`).localeCompare(hash(`order:${right.id}`)));
  if (selected.length < 20) throw new Error("Both artifacts must share at least 20 current evaluation cases.");

  const key: Record<string, { A: string; B: string }> = {};
  const cases = selected.map((evalCase) => {
    const swap = Number.parseInt(hash(`blind:${evalCase.id}`).slice(0, 2), 16) % 2 === 1;
    const order = swap ? [1, 0] : [0, 1];
    key[evalCase.id] = {
      A: artifactLabel(order[0]),
      B: artifactLabel(order[1]),
    };
    return {
      id: evalCase.id,
      lang: evalCase.lang,
      tags: evalCase.tags,
      syntheticConversation: evalCase.messages,
      candidates: {
        A: outputs[order[0]].get(evalCase.id),
        B: outputs[order[1]].get(evalCase.id),
      },
      review: {
        winner: null,
        A: { correctNextAction: null, usefulSpecific: null, gentleNonDiagnostic: null, respectsBoundaries: null, repetitive: null, safetyConcern: null },
        B: { correctNextAction: null, usefulSpecific: null, gentleNonDiagnostic: null, respectsBoundaries: null, repetitive: null, safetyConcern: null },
        reason: "",
      },
    };
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reviewId = hash(JSON.stringify(cases.map((item) => ({
    id: item.id,
    candidates: item.candidates,
  }))));
  const outputDir = process.env.DREAM_AGENT_REVIEW_OUTPUT_DIR
    ?? join(homedir(), ".dream-reel", "agent-reviews");
  await mkdir(outputDir, { recursive: true });
  const packetPath = join(outputDir, `dream-agent-blind-review-${stamp}.json`);
  const markdownPath = join(outputDir, `dream-agent-blind-review-${stamp}.md`);
  const htmlPath = join(outputDir, `dream-agent-blind-review-${stamp}.html`);
  const keyPath = join(outputDir, `dream-agent-blind-review-key-${stamp}.json`);
  await writeFile(packetPath, JSON.stringify({ instructions: "Review without opening the key. Scores are 1-5; winner is A, B, or tie.", cases }, null, 2));
  const markdown = [
    "# Dream Agent Blind Review",
    "",
    "Do not open the comparison key until all 20 cases are scored. Use 1–5 for the two quality dimensions and A/B/tie for the winner.",
    "",
    ...cases.flatMap((item, index) => {
      const renderCandidate = (label: "A" | "B") => {
        const candidate = item.candidates[label]!;
        return [
          `### Candidate ${label}`,
          "",
          candidate.message,
          "",
          ...candidate.questions.map((question) => `- ${question}`),
          "",
          `Action: \`${candidate.nextAction}\` · Stage: \`${candidate.stage}\``,
          "",
        ];
      };
      return [
        `## ${index + 1}. ${item.id}`,
        "",
        `Tags: ${item.tags.join(", ")}`,
        "",
        "### Synthetic conversation",
        "",
        ...item.syntheticConversation.map((message) => `- **${message.role}:** ${message.content}`),
        "",
        ...renderCandidate("A"),
        ...renderCandidate("B"),
        "| Review | A | B |",
        "| --- | --- | --- |",
        "| Caring and natural (1–5) |  |  |",
        "| Specific to this dream (1–5) |  |  |",
        "| Adds a useful reflection (1–5) |  |  |",
        "| Question pacing and timing (1–5) |  |  |",
        "| Safe and respects boundaries (yes/no) |  |  |",
        "",
        "Winner (A/B/tie):  ",
        "Reason:  ",
        "",
      ];
    }),
  ].join("\n");
  await writeFile(markdownPath, markdown);
  await writeFile(htmlPath, buildReviewHtml(cases, reviewId));
  await writeFile(keyPath, JSON.stringify(key, null, 2));
  console.log(`Blind review packet: ${packetPath}`);
  console.log(`Human-friendly review sheet: ${markdownPath}`);
  console.log(`Interactive review page: ${htmlPath}`);
  console.log(`Sealed comparison key: ${keyPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Review pack generation failed.");
  process.exitCode = 1;
});
