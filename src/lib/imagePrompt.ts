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

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function buildLightingDirection({
  rawText,
  mood,
  locations,
  symbols,
}: Pick<PromptOptions, "rawText" | "mood" | "locations" | "symbols">): string {
  const context = [rawText, mood, ...(locations ?? []), ...(symbols ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const lighting: string[] = [];

  if (includesAny(context, ["清晨", "早晨", "黎明", "morning", "dawn", "sunrise"])) {
    lighting.push("以清晨低角度光为主，保留偏冷环境色与逐渐升温的高光");
  } else if (includesAny(context, ["黄昏", "傍晚", "夕阳", "dusk", "sunset", "evening"])) {
    lighting.push("以傍晚斜射光和天光余晖为主，形成拉长的阴影与冷暖交界");
  } else if (includesAny(context, ["夜晚", "深夜", "黑夜", "月亮", "月光", "night", "moon"])) {
    lighting.push("从梦中可见的月光、路灯或室内漏光建立夜间主光源，保留清楚的空间层次");
  } else if (includesAny(context, ["白天", "阳光", "太阳", "daylight", "sunlight"])) {
    lighting.push("以场景中的日光方向为主，依据窗户与遮挡关系形成自然明暗面");
  }

  if (includesAny(context, ["教室", "学校", "办公室", "医院", "商场", "机场", "车站", "classroom", "office", "hospital"])) {
    lighting.push("结合顶灯、窗光和屏幕等空间内实际存在的光源，避免无来由的泛光");
  } else if (includesAny(context, ["雨", "水", "海", "湖", "河", "泳池", "rain", "water", "ocean", "pool"])) {
    lighting.push("让水面或湿润表面的反射参与补光，并根据波动打散高光");
  } else if (includesAny(context, ["火", "蜡烛", "烟花", "霓虹", "屏幕", "fire", "candle", "neon", "screen"])) {
    lighting.push("把梦里出现的发光物作为可辨认的局部光源，让颜色与亮度影响周围人物和环境");
  } else if (includesAny(context, ["车", "地铁", "火车", "隧道", "car", "train", "subway", "tunnel"])) {
    lighting.push("利用车窗、车灯与沿途明暗变化塑造移动中的方向感和节奏");
  }

  if (includesAny(context, ["恐惧", "害怕", "焦虑", "紧张", "追", "逃", "fear", "anxious", "tense", "chase"])) {
    lighting.push("用明确的侧光或逆光与较强明暗反差强化紧张感，但暗部仍保留可读细节");
  } else if (includesAny(context, ["平静", "安心", "温暖", "快乐", "治愈", "calm", "peaceful", "warm", "happy"])) {
    lighting.push("用宽而柔和的主光与低反差过渡承接安定情绪，同时保持光源方向清晰");
  } else if (includesAny(context, ["悲伤", "难过", "孤独", "失落", "sad", "lonely", "grief"])) {
    lighting.push("用克制的侧光或背光留出较大安静暗面，让孤独感来自空间而非整体压黑");
  } else if (includesAny(context, ["困惑", "混乱", "荒诞", "不真实", "confused", "chaotic", "surreal"])) {
    lighting.push("让两种方向或色温不同的光发生轻微冲突，制造梦境失序感");
  }

  if (lighting.length === 0) {
    const anchor = locations?.[0]?.trim() || symbols?.[0]?.trim() || mood?.trim() || "梦中核心场景";
    lighting.push(`围绕「${anchor}」中真实存在或合理出现的光源确定方向、硬度和阴影关系`);
    lighting.push("让光影突出梦里最重要的动作与空间关系，而不是套用统一的柔光或薄雾效果");
  }

  return `光线方向：${lighting.slice(0, 3).join("；")}。`;
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
    buildLightingDirection({ rawText, mood, locations, symbols }),
    "构图建议：优先表现梦里最核心的瞬间，用电影感镜头、浅景深、漂浮感和轻雾氛围来处理。",
    "输出目标：只生成与梦境内容相关的纯画面，不要出现与描述无关的古风山水、建筑海报、题字封面、阴森恐怖场景或过度黑暗画面。",
  ].filter(Boolean);

  return parts.join("\n");
}
