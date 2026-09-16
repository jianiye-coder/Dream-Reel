# Dream Reel

An AI-assisted dream journal for capturing fragments, exploring them through conversation, and revisiting them as text and images.

[Live App](https://dream-reel.vercel.app/) · [English](#english) · [中文](#中文)

## English

### Why Dream Reel

Dream Reel started with my own habit of recording dreams in a notes app. The fragments were easy to collect but difficult to revisit together. I wanted a place to preserve those memories, visualize them, and notice recurring people, places, and connections with waking life.

The application is for personal journaling and reflection. AI interpretations are suggestions, not clinical assessments; the project does not implement a clinician workflow or claim clinical validation.

### What It Does

- **Capture and revisit:** quick text entry, browser-based voice dictation, autosaving, and optional sleep/wake times, sleep quality, pre-sleep meals, and activities.
- **Guided recall:** an AI conversation asks contextual follow-up questions and helps expand incomplete memories before analysis.
- **Structured analysis:** suggested titles, emotions, stress scores, people, locations, symbols, sleep insights, and visual briefs remain editable.
- **Dream imagery:** content-specific prompts and lighting descriptions, an animated film-frame generation view, image download, and next steps to open the archive or continue the conversation.
- **Searchable archive:** calendar, people/place exploration, recent entries, keyword search, editing, re-analysis, image regeneration, Markdown export, and weekly aggregates.
- **Accounts and plans:** email/password authentication, profile and password updates, usage quotas, and optional Stripe subscriptions and customer portal.
- **Chinese and English:** localized interface and AI instructions with a persistent language preference.

Voice input uses the browser's `SpeechRecognition` / `webkitSpeechRecognition` API, not a server-side audio transcription service. Availability and permissions depend on the browser.

### Stack

| Layer | Implementation |
| --- | --- |
| Application | Next.js 16 App Router, React 19, TypeScript |
| Styling | Tailwind CSS 3, custom CSS design system |
| Server | Next.js Route Handlers on the Node.js runtime; Zod validation |
| Database | PostgreSQL through `pg`, parameterized SQL, no ORM |
| Authentication | Auth.js v5 beta, PostgreSQL adapter, JWT sessions, bcrypt password hashes |
| Text AI | Groq and OpenAI HTTP APIs; custom conversation and structured-output logic |
| Image AI | Flatkey or OpenAI Images API |
| Image storage | Vercel Blob, with Sharp-generated WebP thumbnails |
| Billing | Stripe REST API, signed webhooks, PostgreSQL usage accounting |
| Verification | ESLint, TypeScript, Vitest, Playwright, synthetic agent evaluations |

### Local Setup

Use Node.js 22 (the version used by CI), npm, and a PostgreSQL database. A hosted PostgreSQL service such as Supabase is compatible; the app connects directly through `DATABASE_URL`.

```bash
git clone https://github.com/jianiye-coder/Dream-Reel.git
cd Dream-Reel
npm ci
```

Create `.env.local` in the repository root. Replace the placeholders below and omit unused providers rather than keeping dummy credentials:

```dotenv
DATABASE_URL=postgresql://username:password@localhost:5432/dream_web
AUTH_SECRET=replace-with-a-random-secret
DREAM_TEXT_ENCRYPTION_KEY=replace-with-a-different-random-secret
DREAM_TEXT_ENCRYPTION_KEY_ID=primary
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Text analysis and chat prefer Groq when configured.
GROQ_API_KEY=your-groq-key

# Text fallback, standalone title generation, and optional direct image generation.
OPENAI_API_KEY=your-openai-key

# Optional: selects Flatkey instead of OpenAI for images only.
FLATKEY_API_KEY=your-flatkey-key

# Local image uploads to a public Vercel Blob store.
BLOB_READ_WRITE_TOKEN=your-blob-read-write-token
```

Generate each secret independently, for example with `openssl rand -base64 32`. Never commit `.env.local` or put API keys in `NEXT_PUBLIC_*` variables. `NEXT_PUBLIC_APP_URL` is a public origin, not a secret.

`DATABASE_URL`, `AUTH_SECRET`, and a dedicated dream encryption key are the baseline configuration. AI features require the relevant provider credentials; image generation also requires Blob storage. Stripe is optional for local journaling.

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000) and register an account. `ensureSchema()` creates and upgrades the database schema on access, so the configured database role needs schema creation/alteration permissions. There is no separate migration command. Back up an existing database before deploying schema changes.

### AI Routing and Models

These are the defaults in the source code, not a guarantee of availability from an external provider.

| Feature | Provider selection | Model configuration |
| --- | --- | --- |
| Dream analysis | Groq first; OpenAI fallback when configured | `GROQ_ANALYSIS_MODEL` → `GROQ_MODEL` → `openai/gpt-oss-120b`; `OPENAI_ANALYSIS_MODEL` → `gpt-4o-mini` |
| Dream conversation | Groq first; OpenAI fallback when configured | `GROQ_MODEL` → `openai/gpt-oss-120b`; `OPENAI_MODEL` → `gpt-5.5` |
| Standalone title generation | OpenAI only | `gpt-4o-mini` |
| Image generation | Flatkey if `FLATKEY_API_KEY` is set; otherwise OpenAI | `gpt-image-2`, medium quality, one image per request |

Flatkey uses `https://router.flatkey.ai/v1/images/generations`. It does not replace the text providers. An image request that fails through Flatkey does **not** automatically retry through OpenAI.

Image prompts are assembled from dream content and structured fields in `src/lib/imagePrompt.ts`. Manual edits stop automatic rebuilding until the user restores autofill. At the image endpoint, a visual brief longer than 200 characters takes precedence over the assembled prompt; original dream text and optional gender context are also included.

### Optional Configuration

| Variables | Purpose |
| --- | --- |
| `DREAM_TEXT_PREVIOUS_ENCRYPTION_KEYS` | Key rotation: comma-separated `old-id=old-secret` pairs; retain keys needed to read existing data |
| `DREAM_AGENT_FEEDBACK_SECRET` | Separate signing secret for short-lived, user-bound feedback tokens; otherwise falls back to the auth secret |
| `DREAM_AGENT_JSON_SCHEMA_PERCENT` | Strict-output canary allocation; defaults to `0` |
| `DREAM_AGENT_GUARDED_PERCENT` | Guarded recall-policy canary allocation; defaults to `0` |
| `ADMIN_EMAIL` | Access to administrator credit and agent-feedback endpoints |
| `ADMIN_UNLIMITED_EMAILS` | Comma-separated accounts exempt from quotas; set explicitly rather than relying on the creator-account default in `billing.ts` |
| `STRIPE_SECRET_KEY` | Stripe checkout and customer portal |
| `STRIPE_PLUS_PRICE_ID_USD`, `STRIPE_PLUS_PRICE_ID_CNY` | Plus subscription price IDs; checkout falls back to the other configured currency price if one is absent |
| `STRIPE_WEBHOOK_SECRET` | Signature verification for `/api/billing/webhook` |

Subscription handling supports `checkout.session.completed` and `customer.subscription.created`, `.updated`, and `.deleted`. Webhook processing is transactional and deduplicates committed events. Plan limits and usage periods are defined in `src/lib/billing.ts`.

### Deploying on Vercel

1. Import the repository as a Next.js project and configure the baseline and selected provider variables in that project's environment settings.
2. Configure **Production** and **Preview** separately. Check that the deployment belongs to the project where the variables were added, and create a new deployment after changing them.
3. Connect a **public** Vercel Blob store. The installed Blob SDK supports managed OIDC with `BLOB_STORE_ID` and a Vercel OIDC token, or `BLOB_READ_WRITE_TOKEN`. A store ID alone is not authentication. Local development can use a read-write token.
4. Set `NEXT_PUBLIC_APP_URL` to the appropriate deployment origin for billing redirects. If enabling payments, configure the Stripe prices and webhook endpoint for that environment.
5. Verify registration, saving and reopening a dream, analysis, image upload, and `GET /api/health`. Use separate databases and payment test credentials for non-production environments.

The image route declares a 180-second maximum duration and a 170-second upstream timeout. The hosting environment must support the required execution duration.

### Troubleshooting

| Symptom | What to check |
| --- | --- |
| `CONFIGURATION_ERROR` / service not configured during image generation | Neither `FLATKEY_API_KEY` nor `OPENAI_API_KEY` is available to that deployment. Check project, environment scope, and redeployment. |
| `UPSTREAM_ERROR` / AI temporarily unavailable | The provider returned an unsuccessful response. Check provider status, model access, account limits, and sanitized server logs; this is not the same as a missing key. |
| Image upload fails after generation | Public Blob store access and credentials, image response format, and server logs. The provider and storage are separate services. |
| Title generation fails while analysis works | The standalone title endpoint still requires `OPENAI_API_KEY`, even when analysis uses Groq. |
| `/api/health` returns `503` | PostgreSQL is unreachable or the dedicated `DREAM_TEXT_ENCRYPTION_KEY` is missing. This endpoint does not test AI, Stripe, or Blob availability. |
| `QUOTA_EXCEEDED` | Review account usage and plan state; provider credits and application quotas are separate. |

### Architecture

```text
src/
  app/
    journal/page.tsx       Capture, conversation, analysis, autosave, image workflow
    archive/              Server-loaded archive, calendar, search, editor
    account/              Profile and account management
    pricing/              Subscription plans
    api/                  Authenticated data/AI/billing routes and health check
    globals.css           Shared visual system
  auth.ts                 Credentials authentication and JWT sessions
  lib/
    db.ts                 Shared connection pool, versioned schema initialization
    dreams.ts             Validation, user-scoped SQL, row mapping, weekly recap
    dreamTextEncryption.ts Narrative encryption and key rotation
    dreamFollowUpAgent.ts Conversation state and recall policy
    imagePrompt.ts        Content-specific image prompt assembly
    billing.ts            Subscriptions, quotas, usage refunds, webhook deduplication
    dreamAgentTelemetry.ts Feedback tokens and interaction telemetry
tests/                    Unit, database integration, and browser tests
evals/dream-agent/         Synthetic evaluations, replay, review and canary tools
docs/                     Agent evaluation and design documentation
```

Primary APIs include `/api/dreams` (GET, POST, PATCH, PUT, DELETE), `/api/dreams/export`, `/api/weekly-recap`, `/api/chat-dream`, `/api/analyze-dream`, `/api/generate-title`, and `/api/generate-image`. Journal data, AI operations, and exports require a signed-in user. The export API supports Markdown and JSON, although the archive UI exposes Markdown rather than a JSON export button.

### Privacy and Limits

- Raw and cleaned dream narratives are encrypted at rest with AES-256-GCM. This is **not** end-to-end encryption: the server decrypts text for the application, and requested AI operations send relevant content to external providers.
- Structured metadata such as titles, people, locations, and analysis fields is not covered by narrative encryption. Generated images use **public Blob URLs**; anyone with the URL can access them.
- Use a dedicated encryption key independent of `AUTH_SECRET`. Without it, the app can use an auth-derived transition key, but the health check reports a degraded state. Key IDs and previous keys support batched re-encryption; do not discard old secrets before migration is complete.
- Person relationships, person genders, and keyword aliases in the archive are stored in browser `localStorage`; they are not server-synchronized records.
- Keep application logs limited to operational metadata. Do not log dream text, prompts, model responses, credentials, or encryption keys. Agent aggregates are designed to exclude journal content.
- AI-generated emotions, stress scores, images, and interpretations can be inaccurate. They are not diagnoses or validated clinical measurements.

### Tests and Evaluation

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run start
```

Integration tests require `TEST_DATABASE_URL` and are skipped without it. **They truncate application tables: use a disposable test database, never production or a database containing personal records.** Vitest does not automatically load Next.js `.env.local`; export test variables in the shell.

```bash
export TEST_DATABASE_URL=postgresql://username:password@localhost:5432/dream_reel_test
npm run test:integration

npx playwright install chromium
npm run test:e2e
```

Playwright starts a development server on port 3000 and may reuse an existing one outside CI. Stop any server connected to a real database before running it. Browser tests create users and records. `npm test` runs the Vitest unit and integration suites, not Playwright.

CI uses Node.js 22 and PostgreSQL 17 to run lint, type checking, unit tests, integration tests, and a production build. A separate workflow runs a high-severity dependency audit. Browser tests and live AI evaluations are not part of that CI workflow.

`npm run eval:agent` makes real provider calls on synthetic cases and may incur charges. It defaults to OpenAI; set `DREAM_AGENT_EVAL_PROVIDER=groq` to use Groq. Evaluation artifacts default to a temporary directory outside the repository. Additional commands support replay, blind review, and canary checks.

See [Agent Improvement Loop](docs/agent-improvement-loop.md) and [Evaluation Baseline](docs/agent-eval-baseline.md) for the procedures and limitations. As the configured administrator, `/api/admin/agent-feedback?days=14&download=1` exports content-free aggregate metrics for `npm run eval:agent:canary -- snapshot.json`.

---

## 中文

### 项目缘起

Dream Reel 起源于我自己记录梦境的习惯。过去散落在备忘录里的片段很难一起回看，所以我希望做一个地方，保存梦境、把记忆变成画面，并整理反复出现的人物、地点，以及它们与现实生活的联系。

这是一个用于个人记录与自我回顾的应用，不是临床诊断工具。目前没有医生工作流，也不宣称经过临床验证。

### 当前功能

- **记录与保存**：文字输入、浏览器语音听写、自动保存，可选记录入睡/醒来时间、睡眠质量、睡前饮食与活动。
- **对话回忆**：Agent 根据上下文追问，帮助补充梦境细节，再进入分析。
- **结构化整理**：生成可编辑的标题、情绪、压力分数、人物、地点、意象、睡眠洞察与视觉描述。
- **梦境图像**：根据梦境内容调整提示词与光线描述，提供胶片显影动效；生成后可下载图片、进入档案或继续对话。
- **梦境档案**：日历、人物/地点探索、最近记录、关键词搜索、编辑、重新分析、生图、Markdown 导出与本周统计。
- **账号与订阅**：邮箱密码登录、个人资料与密码管理、用量限制，以及可选的 Stripe 订阅和客户门户。
- **中英双语**：界面与 AI 指令支持中文和英文。

语音录入依赖浏览器的 `SpeechRecognition` / `webkitSpeechRecognition`，不是服务端音频转写。浏览器兼容性和麦克风权限会影响可用性。

### 技术栈与后端

Next.js 16 App Router、React 19、TypeScript、Tailwind CSS 3；后端是运行于 Node.js 的 Next.js Route Handlers。数据库通过 `pg` 直接连接 PostgreSQL，无 ORM，使用 Zod 校验输入。认证采用 Auth.js v5 beta、PostgreSQL Adapter、JWT Session 和 bcrypt 密码哈希。

文本 AI 接入 Groq / OpenAI，图片接入 Flatkey / OpenAI；原图与 Sharp 生成的缩略图存入 Vercel Blob。Stripe 通过 REST API 接入，订阅、额度扣减/退回与 webhook 去重由 PostgreSQL 管理。具体目录与接口见上方 [Architecture](#architecture)。

### 本地启动与配置

使用 Node.js 22、npm 和 PostgreSQL。克隆仓库后运行 `npm ci`，在根目录创建 `.env.local`，按上方 [Local Setup](#local-setup) 的示例填写真实配置，再运行 `npm run dev`，打开 [localhost:3000](http://localhost:3000) 注册账号。

基础配置为 `DATABASE_URL`、`AUTH_SECRET` 和独立的 `DREAM_TEXT_ENCRYPTION_KEY`。数据库表与版本升级由 `ensureSchema()` 在访问时执行，数据库用户需要建表/修改表权限；项目没有单独的迁移命令。已有数据的数据库应先备份。

| 功能 | 配置与实际行为 |
| --- | --- |
| 分析与对话 | 优先使用 `GROQ_API_KEY`，配置了 `OPENAI_API_KEY` 时可回退 OpenAI |
| 分析模型 | Groq：`GROQ_ANALYSIS_MODEL` → `GROQ_MODEL` → `openai/gpt-oss-120b`；OpenAI：`OPENAI_ANALYSIS_MODEL` → `gpt-4o-mini` |
| 对话模型 | Groq：`GROQ_MODEL` → `openai/gpt-oss-120b`；OpenAI：`OPENAI_MODEL` → `gpt-5.5` |
| 独立标题接口 | 仍然只使用 OpenAI 的 `gpt-4o-mini`，需要 `OPENAI_API_KEY` |
| 图片生成 | 配置 `FLATKEY_API_KEY` 时使用 Flatkey，否则使用 OpenAI；代码中的模型为 `gpt-image-2` |
| 图片存储 | 公共 Vercel Blob Store；本地可配置 `BLOB_READ_WRITE_TOKEN` |
| 订阅支付 | `STRIPE_SECRET_KEY`、Plus Price ID、`STRIPE_WEBHOOK_SECRET`，以及用于跳转的 `NEXT_PUBLIC_APP_URL` |

Flatkey 只接管图片生成，不替代文本服务；Flatkey 请求失败时不会自动切换 OpenAI。上述模型名是代码默认值，不代表第三方服务一定可用。完整可选变量见 [Optional Configuration](#optional-configuration)。

图片提示词会随梦境字段更新；手动编辑后，自动更新暂停，直到恢复自动填充。另需注意：图片接口收到超过 200 字符的视觉描述时，会优先使用该描述，并附加原始梦境及可选性别信息，而不是直接使用编辑框里的组装提示词。

### Vercel 部署与排错

在实际部署项目中分别配置 Production / Preview 环境变量，修改后重新部署。连接公共 Blob Store：当前 SDK 支持 `BLOB_STORE_ID` 配合有效 Vercel OIDC 令牌，或使用 `BLOB_READ_WRITE_TOKEN`；只有 Store ID 不足以完成认证。非生产环境应使用独立数据库与支付测试凭据。

- **“服务尚未配置”**：生图路由没有读到 Flatkey 或 OpenAI Key。检查项目、环境范围以及是否重新部署。
- **“AI 服务暂时不可用”**：上游返回失败。检查供应商日志、模型权限、余额/限额和服务状态，不应直接归因于缺少 Key。
- **生成后存图失败**：单独检查 Blob 凭据、公共访问模式和服务器日志。生图与存储是两个环节。
- **分析正常但标题失败**：独立标题接口仍需要 OpenAI Key。
- **`/api/health` 返回 503**：数据库不可达，或没有配置独立的梦境加密密钥。健康接口不会检查 AI、Blob 或 Stripe 是否可用。

### 隐私边界

梦境原文与整理后的正文使用 AES-256-GCM 静态加密，但不是端到端加密。服务端会解密使用，用户发起 AI 操作时，相关内容会传给外部供应商。标题、人物、地点和分析等结构化字段不在正文加密范围内；生成图片使用公共 Blob URL，持有链接的人可以访问。

请使用独立于 `AUTH_SECRET` 的加密密钥。轮换时设置新的 `DREAM_TEXT_ENCRYPTION_KEY_ID`，并在 `DREAM_TEXT_PREVIOUS_ENCRYPTION_KEYS` 中保留旧密钥直到重加密完成。未配置独立密钥时可使用认证密钥派生的过渡方案，但健康检查会标记为降级。

人物关系、人物性别与关键词别名保存在浏览器 `localStorage`，不是跨设备同步数据。日志仅应保留运行元数据，不应记录梦境、提示词、模型响应或密钥。AI 情绪、压力分数和解读不应被当作诊断或经过验证的临床指标。

### 测试与评测

项目已有 Vitest 单元/集成测试和 Playwright 浏览器测试，并非没有测试套件。命令和运行条件见 [Tests and Evaluation](#tests-and-evaluation)。

- `npm run lint`、`npm run typecheck`、`npm run test:unit`：静态检查与单元测试。
- `npm run test:integration`：需要 `TEST_DATABASE_URL`；未配置则跳过。**测试会清空应用表，只能使用可丢弃的测试数据库。**
- `npm run test:e2e`：先安装 Chromium；会启动或复用本地开发服务器并写入测试账号与记录，不能连接真实用户数据库。
- `npm run build`、`npm run start`：生产构建与启动。
- `npm run eval:agent`：合成梦境 Agent 评测，会真实调用模型并可能产生费用；默认 OpenAI，可通过 `DREAM_AGENT_EVAL_PROVIDER=groq` 切换。

CI 当前运行 lint、类型检查、单元测试、数据库集成测试、构建和独立的依赖审计；不自动运行浏览器测试或付费模型评测。Agent 评测、人工评审和灰度流程见 [相关文档](docs/agent-improvement-loop.md)。

---

## License and Contact

[MIT License](LICENSE) · Copyright (c) 2026 Jiani Ye

Contact: [yejiani0831@gmail.com](mailto:yejiani0831@gmail.com)
