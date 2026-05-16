# Dream Reel

**[English](#english) · [中文](#中文)**

---

## English

Turn dreams into memory, image, and pattern.

An AI-powered dream journal — record what you dreamed, generate an image from it, and watch recurring symbols, people, and places surface over time. Full bilingual support (Chinese / English).

> Built with [Claude Code](https://claude.ai/code) and [OpenAI Codex](https://openai.com/codex).

### Features

- **Quick Record / Chat mode** — write or dictate a dream, or explore it conversationally with an AI companion
- **AI analysis** — extracts mood, people, locations, and symbols; generates a sleep insight
- **Dream image generation** — produces a visual from the dream's content and atmosphere
- **Sleep log** — optional bedtime context: sleep/wake time, quality rating, pre-sleep meal and activity
- **Archive** — browse all entries by date, edit and re-analyze any dream
- **Weekly recap** — aggregated mood, people, locations, and symbols across the week
- **Auth** — email/password sign-up and login; each user's data is private
- **Bilingual** — full zh/en UI toggle that persists across all pages

### Stack

- **Framework**: Next.js 16 (App Router)
- **Database**: PostgreSQL via `pg` (no ORM)
- **Auth**: Auth.js v5 — JWT strategy, email + password credentials
- **Styling**: Tailwind CSS v4 + custom CSS design system
- **Language**: TypeScript

### Running locally

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
OPENAI_MODEL=gpt-4o          # optional, defaults to gpt-4o
```

3. Start the dev server:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000)

---

## 中文

把梦境变成记忆、画面与隐藏的规律。

一款 AI 梦境日记应用，支持中英双语。记录梦境、生成图像、发现跨越时间的模式。

> 本项目使用 [Claude Code](https://claude.ai/code) 与 [OpenAI Codex](https://openai.com/codex) 构建。

### 功能

- **快速记录 / Chat 模式** — 用文字或语音记录梦境，或与 AI 对话式深入探索
- **AI 分析** — 自动提取情绪、人物、地点、意象，生成睡眠洞察
- **梦境图像生成** — 根据梦境内容与氛围生成图像
- **睡眠日志** — 可选填入睡/清醒时间、睡眠质量评分、睡前饮食与活动
- **梦境档案** — 按时间浏览所有记录，支持编辑与重新分析
- **周报统计** — 情绪、人物、地点、意象的每周聚合
- **账号系统** — 邮箱注册与登录，数据按账号隔离
- **中英双语** — 全界面支持中文 / English 切换，跨页面保持

### 技术栈

- **框架**：Next.js 16 (App Router)
- **数据库**：PostgreSQL（无 ORM，直接使用 `pg`）
- **认证**：Auth.js v5（JWT 策略，邮箱密码）
- **样式**：Tailwind CSS v4 + 自定义 CSS 设计系统
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
OPENAI_MODEL=gpt-4o          # 可选，默认使用 gpt-4o
```

3. 启动开发服务器：

```bash
npm run dev
```

4. 打开 [http://localhost:3000](http://localhost:3000)
