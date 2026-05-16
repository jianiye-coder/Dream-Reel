# Dream Reel

**[English](#english) · [中文](#中文)**

---

## English

Turn dreams into memory, image, and pattern.

Dream Reel is an AI-powered dream journal. Record what you dreamed, develop it through chat, generate an image from its atmosphere, and watch recurring symbols, people, places, moods, and sleep context surface over time. The app supports a full Chinese / English interface.

### Creator Note

Dream Reel grew out of my own habit of recording dreams. I used to keep them in my notes app, but those fragments always felt too scattered. So I made Dream Reel as a kind of nighttime journal: a place to turn fleeting dreams into memory pieces that can be saved and visualized. It also records what I did before bed and what I ate at night, helping me look for small connections between waking life and dreams.

Dream Reel also helps me organize the people, places, and images that appear in my dreams. After using it for a while, I noticed that as a junior in college, the people I dream about most are classmates from middle school. Some similar places also return across different nights, like the same mall or alley. In dreams, I often want to run but cannot, or want to type but can never get the words right.

This project hopes to turn scattered dream notes into a private archive that can be revisited, organized, and understood: preserving both the dreams themselves and the clues between dreams and waking life.

### Features

- **Quick Record / Chat mode** — write, dictate, or explore a dream conversationally with an AI companion
- **AI analysis** — extracts title, mood, stress score, people, locations, symbols, follow-up questions, visual brief, and sleep insight
- **Dream image generation** — creates an image from the dream text, visual brief, atmosphere, and optional profile context
- **Sleep log** — optional bedtime context: sleep/wake time, quality rating, pre-sleep meal, and activity
- **Archive** — browse entries by date, edit any dream, re-analyze it, and regenerate its image
- **Weekly recap** — aggregates mood, people, locations, and symbols for the current week
- **Bilingual UI** — Chinese / English toggle persists across pages

### Stack

- **Framework**: Next.js 16 (App Router)
- **Database**: PostgreSQL via `pg` (no ORM)
- **Auth**: Auth.js v5 with PostgreSQL adapter, JWT sessions, and email/password credentials
- **AI**: OpenAI text and image generation APIs
- **Styling**: Tailwind CSS + custom CSS design system
- **Language**: TypeScript

### Running Locally

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` in the project root:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/dream_web
AUTH_SECRET=your_auth_secret
DREAM_TEXT_ENCRYPTION_KEY=your_32_byte_or_long_random_secret
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5.5
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

3. Start the dev server:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000)

### Notes

- `OPENAI_MODEL` controls the dream chat model and defaults to `gpt-5.5`.
- Dream analysis currently uses `gpt-4o-mini`.
- Image generation currently uses `gpt-image-2`.

---

## 中文

把梦境变成记忆、画面与隐藏的规律。

Dream Reel 是一款 AI 梦境日记应用。你可以记录梦境、通过 Chat 继续展开、根据梦境氛围生成图像，并在时间中看见反复出现的意象、人物、地点、情绪与睡眠前情。应用支持完整中文 / English 双语界面。

### 创作者想法

Dream Reel 起源于我自己记录梦境的习惯。以前我的梦都记在备忘录里，但那些文字太碎片化。于是我做了 Dream Reel，它像是我的一本夜间日志，帮我把那些转瞬即逝的梦境，变成可以保存和视觉化的记忆片段。同时，它也会把我睡前在做的事情、晚上吃了什么一起记录进去，帮我寻找现实与梦境之间的微小联系。

Dream Reel 还帮我整理梦里出现的人物、场景和意象。用了一段时间后我发现：作为一个大三的学生，我最常梦见的人是初中同学；有些相似的场景也会在不同的夜里反复重现，比如我会频繁进入同一个商场和巷子；在梦里，我经常想跑却跑不动，想打字却怎么也输不对。

这个项目希望把零散的梦境记录变成一种可以回看、整理和理解的私人档案：既保存梦本身，也保存梦与现实生活之间的线索。

### 功能

- **快速记录 / Chat 模式** — 用文字、语音，或与 AI 对话的方式记录和探索梦境
- **AI 分析** — 自动提取标题、情绪、压力分数、人物、地点、意象、追问、视觉摘要与睡眠洞察
- **梦境图像生成** — 根据梦境文本、视觉摘要、氛围和可选个人资料生成图像
- **睡眠日志** — 可选填入睡/清醒时间、睡眠质量评分、睡前饮食与活动
- **梦境档案** — 按时间浏览记录，支持编辑、重新分析和重新生成图像
- **周报统计** — 聚合本周的情绪、人物、地点与意象
- **中英双语** — 全界面支持中文 / English 切换，并跨页面保持

### 技术栈

- **框架**：Next.js 16 (App Router)
- **数据库**：PostgreSQL（无 ORM，直接使用 `pg`）
- **认证**：Auth.js v5，PostgreSQL Adapter，JWT Session，邮箱密码登录
- **AI**：OpenAI 文本与图像生成 API
- **样式**：Tailwind CSS + 自定义 CSS 设计系统
- **语言**：TypeScript

### 本地运行

1. 安装依赖：

```bash
npm install
```

2. 在项目根目录创建 `.env.local`：

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/dream_web
AUTH_SECRET=your_auth_secret
DREAM_TEXT_ENCRYPTION_KEY=your_32_byte_or_long_random_secret
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5.5
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

3. 启动开发服务器：

```bash
npm run dev
```

4. 打开 [http://localhost:3000](http://localhost:3000)

### 说明

- `OPENAI_MODEL` 控制梦境 Chat 模型，默认是 `gpt-5.5`。
- 梦境分析当前使用 `gpt-4o-mini`。
- 图像生成当前使用 `gpt-image-2`。
