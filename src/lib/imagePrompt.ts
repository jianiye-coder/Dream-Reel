type PromptOptions = {
  rawText: string;
  mood?: string;
  people?: string[];
  locations?: string[];
  symbols?: string[];
  tags?: string[];
};

function joinList(items: string[] | undefined, label: string): string[] {
  if (!items || items.length === 0) return [];
  return [`${label}：${items.join("、")}`];
}

export function buildDreamImagePrompt({
  rawText,
  mood,
  people,
  locations,
  symbols,
  tags,
}: PromptOptions): string {
  const parts = [
    "请根据下面的梦境内容生成一幅与情节明确对应的梦境画面。",
    "画面必须优先体现梦里真实出现的场景、动作、人物和环境，不要自由发挥成无关主题。",
    `梦境原文：${rawText.trim()}`,
    mood?.trim() ? `整体情绪：${mood.trim()}` : "",
    ...joinList(people, "画面人物"),
    ...joinList(locations, "画面地点"),
    ...joinList(symbols, "关键意象"),
    ...joinList(tags, "补充关键词"),
    "视觉方向：虚幻、柔软、介于记忆与现实之间，有轻微超现实感，但仍能看出梦里的具体人物、地点和动作。",
    "色彩方向：不要昏暗，不要全黑。使用有呼吸感的梦境色彩，如雾粉、月光白、蓝紫、湖蓝、暖金、薄荷绿或柔和珊瑚色；整体明亮、发光、通透。",
    "光线方向：像梦中自然发光的空气，柔和 bloom、薄雾、散射光、微粒、胶片颗粒；避免恐怖片式低曝光和脏暗阴影。",
    "构图建议：优先表现梦里最核心的瞬间，用电影感镜头、浅景深、漂浮感和轻雾氛围来处理。",
    "严格禁止：任何中文、英文、书法、标题、印章、海报排版、logo、水印、边框装饰。",
    "输出目标：只生成与梦境内容相关的纯画面，不要出现与描述无关的古风山水、建筑海报、题字封面、阴森恐怖场景或过度黑暗画面。",
  ].filter(Boolean);

  return parts.join("\n");
}
