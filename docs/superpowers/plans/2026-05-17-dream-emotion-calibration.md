# Dream Emotion Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable Chinese dream emotion calibration examples to `/api/analyze-dream` so mood output follows one dominant dream-specific emotion and never returns `混合`.

**Architecture:** Create a focused `src/lib/dreamEmotionCalibration.ts` module exporting the calibration prompt section. Import it into `src/app/api/analyze-dream/route.ts` and interpolate it into the existing Chinese system prompt while keeping the API schema and frontend behavior unchanged.

**Tech Stack:** Next.js 16 App Router, TypeScript, Zod, OpenAI chat completions.

---

## File Structure

- Create `src/lib/dreamEmotionCalibration.ts`: owns the Chinese dream emotion labels, scoring rules, and 12 annotated examples as a prompt string.
- Modify `src/app/api/analyze-dream/route.ts`: imports the calibration string and adds it to `ZH_SYSTEM_PROMPT`.
- Create then delete `tmp/dreamEmotionCalibration.check.ts`: temporary TDD check that verifies the prompt contains required rules and excludes `混合` from final mood labels.

## Task 1: Add Calibration Module

**Files:**
- Create: `src/lib/dreamEmotionCalibration.ts`
- Temporary Test: `tmp/dreamEmotionCalibration.check.ts`

- [ ] **Step 1: Write the failing check**

Create `tmp/dreamEmotionCalibration.check.ts`:

```ts
import { ZH_DREAM_EMOTION_CALIBRATION } from "../src/lib/dreamEmotionCalibration";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(
  ZH_DREAM_EMOTION_CALIBRATION.includes("最终 mood 禁止输出「混合」"),
  "calibration must explicitly forbid 混合 as final mood",
);
assert(
  ZH_DREAM_EMOTION_CALIBRATION.includes("允许的主情绪标签"),
  "calibration must include allowed primary mood labels",
);
assert(
  ZH_DREAM_EMOTION_CALIBRATION.includes("我梦见自己回到小学教室"),
  "calibration must include the school exam example",
);
assert(
  ZH_DREAM_EMOTION_CALIBRATION.includes("我梦见小时候住过的房子"),
  "calibration must include the childhood home example",
);

const allowedLine = ZH_DREAM_EMOTION_CALIBRATION
  .split("\n")
  .find((line) => line.includes("允许的主情绪标签"));

assert(Boolean(allowedLine), "allowed label line must exist");
assert(!allowedLine?.includes("混合"), "混合 must not be an allowed primary mood label");
```

- [ ] **Step 2: Run the check to verify it fails**

Run:

```bash
npx tsc --noEmit tmp/dreamEmotionCalibration.check.ts --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck
```

Expected: FAIL because `src/lib/dreamEmotionCalibration.ts` does not exist.

- [ ] **Step 3: Create the calibration module**

Create `src/lib/dreamEmotionCalibration.ts`:

```ts
export const ZH_DREAM_EMOTION_CALIBRATION = `梦境情绪标注校准：

允许的主情绪标签：恐惧、焦虑、悲伤、愤怒、羞耻、孤独、困惑、怀旧、平静、喜悦、惊奇、渴望、安心、压抑、麻木、无助。

标注规则：
1. 最终 mood 必须只输出一个主导情绪标签，优先从“允许的主情绪标签”中选择。
2. 最终 mood 禁止输出「混合」；「混合」只能表示整体色调，不是情绪标签。
3. 如果梦里有多种情绪，选择最能解释梦者主观体验的主情绪。
4. stressScore 按主观紧张/沉重程度评分：1=很轻或舒适，2=轻度，3=明显，4=强，5=强烈且压迫。
5. 不要因为场景超现实就自动判为恐惧；如果更像奇观、探索或怀旧，应选择惊奇、渴望或怀旧等主情绪。

校准样例：
1. 梦境：我梦见自己回到小学教室，所有人都在考试，只有我没有试卷。老师一直看着我，我想解释，却说不出话。
   主情绪：焦虑；次情绪：羞耻、压抑；强度：4；色调：负向；依据：表现失败、被注视和无法解释。
2. 梦境：我梦见在一座很高的桥上走，桥下面是雾，看不到底。我知道自己不会掉下去，但还是不敢往前走。
   主情绪：恐惧；次情绪：焦虑、困惑；强度：3；色调：负向；依据：高度和未知带来威胁感，但理性知道不会掉落。
3. 梦境：我梦见去世的外婆坐在厨房里包饺子，她没有说话，只是看着我笑。我醒来以后觉得很想哭。
   主情绪：悲伤；次情绪：怀旧、安心；强度：4；色调：混合；依据：故人重逢温暖，但醒后想哭显示失去感更强。
4. 梦境：我梦见自己在机场，广播一直叫我的名字，可我怎么都找不到登机口。手机也没电了。
   主情绪：焦虑；次情绪：无助、困惑；强度：5；色调：负向；依据：被点名、找不到目的地和手机没电强化紧迫失控。
5. 梦境：我梦见一只黑色的鸟停在窗边，它好像知道我的秘密。我害怕它飞进来，但又忍不住一直看它。
   主情绪：恐惧；次情绪：羞耻、惊奇；强度：4；色调：混合；依据：害怕被侵入，也有秘密被看穿的羞耻和神秘吸引。
6. 梦境：我梦见自己躺在水底，能呼吸，周围很安静。阳光从水面照下来，我不想离开。
   主情绪：平静；次情绪：安心、渴望；强度：2；色调：正向；依据：能呼吸、安静和不想离开表示安宁。
7. 梦境：我梦见我和朋友走散了，我在人很多的商场里找他们。每个人都像认识我，但没人愿意回答我。
   主情绪：孤独；次情绪：焦虑、困惑；强度：4；色调：负向；依据：在人群中无人回应，孤立感比迷路更突出。
8. 梦境：我梦见自己在舞台上表演，台下坐满了人。我突然发现自己忘了台词，而且穿着睡衣。
   主情绪：羞耻；次情绪：焦虑、恐惧；强度：5；色调：负向；依据：公开出错和暴露，核心是出丑与被观看。
9. 梦境：我梦见家里的门怎么都锁不上，外面有人在走廊里来回走。我一直按着门把手，手很酸。
   主情绪：恐惧；次情绪：压抑、焦虑；强度：5；色调：负向；依据：家门失效和门外脚步形成持续威胁。
10. 梦境：我梦见一座城市漂浮在天上，我站在屋顶看云从脚下经过，心里又震撼又害怕。
    主情绪：惊奇；次情绪：恐惧、渴望；强度：3；色调：混合；依据：奇观感是主轴，恐惧是次级。
11. 梦境：我梦见自己一直在收拾行李，但箱子永远装不完。每次快装好，就会冒出更多东西。
    主情绪：焦虑；次情绪：压抑、无助；强度：4；色调：负向；依据：永远无法完成的任务制造压力和无力感。
12. 梦境：我梦见小时候住过的房子变得很大，里面有很多我没见过的房间。我一边害怕，一边想继续往里走。
    主情绪：怀旧；次情绪：恐惧、惊奇、渴望；强度：3；色调：混合；依据：旧房子带怀旧，未知房间同时激发害怕和探索欲。`;
```

- [ ] **Step 4: Run the check to verify it passes**

Run:

```bash
npx tsc --noEmit tmp/dreamEmotionCalibration.check.ts --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck
```

Expected: PASS with exit code 0.

- [ ] **Step 5: Remove the temporary check**

Delete `tmp/dreamEmotionCalibration.check.ts`.

## Task 2: Wire Calibration Into Analysis Prompt

**Files:**
- Modify: `src/app/api/analyze-dream/route.ts`

- [ ] **Step 1: Add the import**

At the top of `src/app/api/analyze-dream/route.ts`, add:

```ts
import { ZH_DREAM_EMOTION_CALIBRATION } from "@/lib/dreamEmotionCalibration";
```

- [ ] **Step 2: Replace the Chinese mood instructions**

In `ZH_SYSTEM_PROMPT`, replace the existing `mood（情绪）` bullet with:

```txt
- mood（情绪）：用 2–4 个字概括梦境的主导情绪。必须参考下方“梦境情绪标注校准”，并从允许的主情绪标签中选最贴切的一个。若梦境情绪复杂，仍然只输出一个主导情绪；禁止输出“混合”。若实在无法判断则返回空字符串。
```

Then insert after that bullet:

```ts
${ZH_DREAM_EMOTION_CALIBRATION}
```

- [ ] **Step 3: Verify route still compiles**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS with no TypeScript errors from the new module or route import.

## Task 3: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS or only pre-existing unrelated warnings. Any new lint errors from touched files must be fixed.

- [ ] **Step 2: Review diff**

Run:

```bash
git diff -- src/lib/dreamEmotionCalibration.ts src/app/api/analyze-dream/route.ts
```

Expected:

- New calibration module exists.
- `analyze-dream` imports the module.
- Final `mood` instructions forbid `混合`.
- API response shape is unchanged.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add src/lib/dreamEmotionCalibration.ts src/app/api/analyze-dream/route.ts docs/superpowers/plans/2026-05-17-dream-emotion-calibration.md
git commit -m "Add dream emotion calibration prompt"
```
