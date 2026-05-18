const REALITY_QUESTION_ZH = "这跟你最近现实生活所发生的事情，有没有什么关系？";
const REALITY_QUESTION_EN = "Does this connect to anything that has happened in your real life recently?";

export function getRealityQuestion(lang: "zh" | "en") {
  return lang === "en" ? REALITY_QUESTION_EN : REALITY_QUESTION_ZH;
}

export function mentionsRealityContext(question: string, lang: "zh" | "en") {
  return lang === "en"
    ? question.toLowerCase().includes("real life") || question.toLowerCase().includes("recently")
    : question.includes("现实生活") || question.includes("最近");
}
