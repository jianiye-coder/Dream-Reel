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
DREAM_TEXT_ENCRYPTION_KEY_ID=primary
# During rotation only: old-key-id=old-secret,another-old-key-id=another-secret
DREAM_TEXT_PREVIOUS_ENCRYPTION_KEYS=
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5.5
# Optional fallback for the dream chat agent; OpenAI remains primary.
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=openai/gpt-oss-120b
DREAM_AGENT_FEEDBACK_SECRET=your_separate_feedback_signing_secret
DREAM_AGENT_JSON_SCHEMA_PERCENT=0
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

3. Start the dev server:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000)

### Notes

- Production requires `DREAM_TEXT_ENCRYPTION_KEY`; it must be different from `AUTH_SECRET`.
- Until that variable is present, production uses a domain-separated transition key so authentication remains available; `/api/health` reports this state as degraded. Treat this only as a deployment bridge and configure the dedicated key before rotating `AUTH_SECRET`.
- To rotate dream encryption, give the new key a new `DREAM_TEXT_ENCRYPTION_KEY_ID` and retain old keys temporarily in `DREAM_TEXT_PREVIOUS_ENCRYPTION_KEYS`. Reads stay compatible while stored rows are re-encrypted in batches.
- `GET /api/health` returns `503` when PostgreSQL is unavailable, without exposing connection details.
- Application logs must retain operational metadata only. Never log dream text, AI prompts/responses, generated visual briefs, credentials, or encryption material; configure the hosting provider's retention period to the shortest operationally useful window.
- Administrators can read content-free feedback aggregates at `GET /api/admin/agent-feedback?days=7` (1–90 days). The endpoint returns variant totals, positive rate, and negative reason counts only.

- `OPENAI_MODEL` controls the dream chat model and defaults to `gpt-5.5`.
- `DREAM_AGENT_FEEDBACK_SECRET` signs short-lived, user-bound feedback tokens. It falls back to `AUTH_SECRET`, but a separate secret is recommended.
- `DREAM_AGENT_JSON_SCHEMA_PERCENT` enables the strict-output canary for a stable percentage of users; keep it at `0` unless a monitored experiment is active.
- Dream analysis currently uses `gpt-4o-mini`.
- Image generation currently uses `gpt-image-2`.
- Generated images and thumbnails are stored in Vercel Blob; `BLOB_READ_WRITE_TOKEN` is required for image generation.

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
DREAM_TEXT_ENCRYPTION_KEY_ID=primary
# 仅轮换期间填写：旧密钥ID=旧密钥,另一个旧密钥ID=另一个旧密钥
DREAM_TEXT_PREVIOUS_ENCRYPTION_KEYS=
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5.5
# 梦境对话 Agent 的可选备选；OpenAI 始终优先。
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=openai/gpt-oss-120b
DREAM_AGENT_FEEDBACK_SECRET=your_separate_feedback_signing_secret
DREAM_AGENT_JSON_SCHEMA_PERCENT=0
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

3. 启动开发服务器：

```bash
npm run dev
```

4. 打开 [http://localhost:3000](http://localhost:3000)

### 说明

- 生产环境必须配置独立于 `AUTH_SECRET` 的 `DREAM_TEXT_ENCRYPTION_KEY`。
- 在该变量尚未配置时，生产环境会用域隔离的过渡密钥保持登录可用，且 `/api/health` 会报告降级状态；这只用于部署过渡，轮换 `AUTH_SECRET` 前必须补齐独立密钥。
- 轮换梦境加密密钥时，为新密钥设置新的 `DREAM_TEXT_ENCRYPTION_KEY_ID`，并暂时把旧密钥保留在 `DREAM_TEXT_PREVIOUS_ENCRYPTION_KEYS`；服务会兼容读取并分批重加密旧数据。
- `GET /api/health` 会在 PostgreSQL 不可用时返回 `503`，且不会暴露连接信息。
- 应用日志只保留运行元数据；禁止记录梦境正文、AI 提示词/响应、视觉描述、登录凭据或加密材料，并应把托管平台的日志保留期设为满足运维所需的最短时间。
- 管理员可通过 `GET /api/admin/agent-feedback?days=7`（1–90 天）查看不含内容的反馈汇总；接口只返回各 variant 的数量、好评率和负反馈原因计数。

- `OPENAI_MODEL` 控制梦境 Chat 模型，默认是 `gpt-5.5`。
- `DREAM_AGENT_FEEDBACK_SECRET` 用于签发短期、绑定用户的反馈令牌；未配置时会回退到 `AUTH_SECRET`，但推荐使用独立密钥。
- `DREAM_AGENT_JSON_SCHEMA_PERCENT` 控制严格结构化输出的稳定用户灰度比例；没有监控实验时保持为 `0`。
- 梦境分析当前使用 `gpt-4o-mini`。
- 图像生成当前使用 `gpt-image-2`。
- 生成的原图与缩略图存储在 Vercel Blob；图片生成功能需要配置 `BLOB_READ_WRITE_TOKEN`。
