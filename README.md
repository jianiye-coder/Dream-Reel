# Dream Reel

An AI-assisted dream journal for capturing fragments, exploring them through conversation, and revisiting them as text and images.

[Live App](https://dream-reel.vercel.app/) · [English](#english) · [中文](#中文)

## English

### Why Dream Reel

Dream Reel started with my own habit of recording dreams in a notes app. The fragments were easy to collect but difficult to revisit together. I wanted a place to preserve those memories, visualize them, and notice recurring people, places, and connections with waking life.

The application is for personal journaling and reflection.

### What It Does

- **Capture and revisit:** quick text entry, browser-based voice dictation, autosaving, and optional sleep/wake times, sleep quality, pre-sleep meals, and activities.
- **Guided recall:** an AI conversation asks contextual follow-up questions and helps expand incomplete memories before analysis.
- **Optional emotional support:** switch from recall to reflection on waking feelings, sleep impact, and possible next steps, even without a remembered dream. Download a personal consultation-preparation note containing only your own statements; nothing is automatically sent to a clinician. This mode uses the existing analysis quota and is not therapy or diagnosis.
- **Structured analysis:** suggested titles, emotions, stress scores, people, locations, symbols, sleep insights, and visual briefs remain editable.
- **Morning Pages:** a separate private daily journal at `/morning-pages` — freewriting, editable handwriting and sketches, autosave, date history, text/PNG downloads, and deletion. Text and strokes are encrypted together and never sent for AI analysis; concurrent edits in two windows produce a conflict instead of silently overwriting. Morning Pages reuse the dream-text encryption keyring: during key rotation, keep previous keys until existing pages have been re-saved under the current key (the batch migration covers dream entries only).
- **Dream imagery:** content-specific prompts and lighting descriptions, an animated film-frame generation view, image download, and next steps to open the archive or continue the conversation.
- **Searchable archive:** calendar, people/place exploration, recent entries, keyword search, editing, re-analysis, image regeneration, Markdown export, and weekly aggregates.
- **Accounts and plans:** email/password authentication, profile and password updates, usage quotas, and optional Stripe subscriptions and customer portal.
- **Chinese and English:** localized interface and AI instructions with a persistent language preference.

Voice input uses the browser's `SpeechRecognition` / `webkitSpeechRecognition` API, not a server-side audio transcription service. Availability and permissions depend on the browser.

### Stack

| Layer | Implementation |
| --- | --- |
| Application | Next.js 16 App Router, React 19, TypeScript |
| Styling | Plain CSS notebook design system (`notebook.css` + per-page CSS modules, see [DESIGN.md](DESIGN.md)); a small base reset in `globals.css`; no CSS framework |
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
| `STRIPE_SECRET_KEY`, `STRIPE_PLUS_PRICE_ID_USD`, `STRIPE_WEBHOOK_SECRET` | Plus subscriptions; see [Payments (Stripe)](#payments-stripe). All three or none |

### Payments (Stripe)

Stripe is called through the official Node SDK (`stripe`, pinned exactly), one client created lazily in `src/lib/stripe.ts`. The client pins API version `2026-08-26.dahlia` (`STRIPE_API_VERSION`), so the response shapes the code reads don't follow the account's default version; change it only together with the parsing in `stripe.ts`, after reading the [changelog](https://docs.stripe.com/changelog). Create the webhook endpoint on the same API version. Until **all four** of these are set (and, in production, `NEXT_PUBLIC_APP_URL`), `/api/billing/status` reports `checkoutAvailable: false`, every upgrade button shows "Plus 即将开放 / Plus is coming soon", and checkout answers `503 BILLING_UNAVAILABLE`. No setting name ever reaches the browser.

| Variable | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | A **restricted key** (`rk_live_…` / `rk_test_…`), not the account's `sk_` secret key; see [Keys and secrets](#keys-and-secrets) |
| `STRIPE_PLUS_PRICE_ID_USD` | The Plus price for everyone: recurring, monthly, USD 1.99 |
| `STRIPE_WEBHOOK_SECRET` | Signing secret (`whsec_…`) of the webhook endpoint below |
| `NEXT_PUBLIC_APP_URL` | Public origin for Stripe's return URLs, e.g. `https://dream-reel.vercel.app`. **Required in production and must be `https://`** (the request Host header is not trusted); locally the request origin is used |
| `STRIPE_PLUS_PRICE_IDS_LEGACY` | Optional comma list of earlier Plus price ids that still grant Plus. **If you ever change a price id above, move the old one here**, or every reader still billed on it silently drops to Free at their next webhook |

Everyone pays the same USD price, whatever language they read in; Chinese pages show `$1.99` too. (Alipay and WeChat Pay don't support Checkout in subscription mode, so a CNY price wouldn't reach readers who only use them; cards in other currencies are converted by the reader's bank.) A reader who already has a Stripe customer (from an earlier subscription) checks out on that customer.

Webhook endpoint: `https://<your domain>/api/billing/webhook`, subscribed to exactly

- `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`
- `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
- `invoice.paid` (Stripe's recommended signal to provision and extend access), `invoice.payment_failed`
- `charge.refunded`
- `charge.dispute.created`, `radar.early_fraud_warning.created`

Readers are found from Stripe ids: Checkout Session events link the new customer to the reader who opened the session (`client_reference_id`, trusted only on sessions this app created: `metadata.plan=plus` and our `integration_identifier`); every other event is mapped through the exact subscription already linked in our database, else its customer, with subscription metadata only as a fallback. A linked subscription never changes hands, and a customer linked to two readers is not guessed at; both are recorded as `needs_action`. `async_payment_succeeded` fulfils only when `payment_status` is `paid`. Subscription, invoice and checkout events all go through the same locked re-sync: the subscription (found on the invoice via `parent.subscription_details.subscription`) is read back from Stripe. A **full** refund of a subscription payment (`charge.refunded`, resolved charge → PaymentIntent → invoice payments → invoice → subscription) cancels that subscription immediately, as the refund policy says; partial refunds and one-off charges are left alone. Disputes and early fraud warnings are recorded as `needs_action` rows (ids only) for the owner.

Dream Reel sends no billing emails itself. In Dashboard → Billing → Revenue recovery, turn on **Smart Retries** and Stripe's customer emails for failed payments and expiring cards (and the upcoming-renewal reminder if you want one).

The handler verifies the signature (raw body, 5-minute tolerance, any of several `v1` signatures), records each event id once in `payment_events` (a failed event is not recorded, so Stripe's retry runs it again), and reads the subscription back from Stripe instead of trusting event order. Only a subscription billing one of the two configured price ids grants Plus; any other subscription is recorded as `free` and logged by id. If a reader ends up with two active Plus subscriptions (two Checkout tabs both paid), they keep the one that is paid and staying (active, no cancellation scheduled, not in trial; then the older), and the other is cancelled immediately. It is refunded (reason `duplicate`) only if the charge is its first invoice (`billing_reason=subscription_create`). Anything the code won't settle alone (a duplicate found after a renewal, a refund or cancel Stripe refuses, a payment it can't find) is still cancelled where possible, returns 2xx so later events keep flowing, and is recorded for the owner: `SELECT * FROM payment_events WHERE status = 'needs_action';`. Only transient Stripe failures (network, timeouts, 409/429, 5xx) and 401/403 make the webhook fail so Stripe retries; a 401/403 usually means the restricted key lacks a permission, so the log says so (code only) and Stripe emails the owner about the failing endpoint. `active` and `trialing` mean Plus until `current_period_end`; `past_due`, `unpaid`, `incomplete`, `incomplete_expired`, `paused` and `canceled` do not. The billing period is read from the subscription items (`items.data[].current_period_*`). Plan limits and usage periods are defined in `src/lib/billing.ts`.

Readers manage and cancel in the Stripe customer portal (Account → Manage Subscription), which needs a saved portal configuration in **both** test and live mode. **Turn plan switching (and quantity changes) off** in the portal: a reader switched to any other price would lose Plus, and there is nothing else to switch to. Stripe also asks for the policy pages at `/terms`, `/privacy` and `/refund` before activation. Their text is a draft the owner must review.

**Before going live, do a duplicate-refund dry run in test mode**: open Checkout in two tabs, pay both with a test card, and check that one subscription is cancelled and its payment refunded in the Dashboard (this exercises the invoice/payment shapes of your account's API version for real).

Test renewals, failed renewals and cancellation at period end with **test clocks** in the sandbox (Billing → Subscriptions → Test clocks): create a customer on a clock, subscribe via Checkout, then advance the clock past the period end and watch `invoice.paid` / `invoice.payment_failed` arrive.

#### Keys and secrets

- **Restricted key, least privilege.** In Developers → API keys → Create restricted key, give it only what the code calls (everything else **None**):

  | Resource | Access | Used for |
  | --- | --- | --- |
  | Checkout Sessions | Write | `checkout.sessions.create` |
  | Customer portal | Write | `billingPortal.sessions.create` |
  | Subscriptions | Write | `subscriptions.retrieve`, `subscriptions.cancel` (duplicates, refunded subscriptions) |
  | Invoices | Read | `invoices.retrieve` (with `expand[]=payments`) |
  | Invoice payments | Read | `invoicePayments.list` (charge → invoice, refund lookup) |
  | Refunds | Write | `refunds.create` (duplicate subscriptions) |

  Write includes Read. Webhook verification needs no API permission (only the signing secret). Dashboard labels can differ slightly from these names; build and exercise the key in a sandbox first and add exactly what a `403` names (for example Customers: Read if Checkout asks for it when reusing a customer), then create the live key and expire any `sk_` key in use.
- **Vercel:** store `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as **Sensitive** environment variables (write-only once saved), with live values only in the Production environment.
- **Sandboxes:** use separate [sandboxes](https://docs.stripe.com/sandboxes) rather than the shared test mode: one for local development (with `stripe listen`), one for the owner's acceptance tests (test clocks, the duplicate dry run). CI needs no Stripe key at all (every Stripe call in the test suite is mocked); if that ever changes, give CI its own sandbox and key.
- **GitHub:** keep secret scanning and push protection on (Settings → Code security), so a pushed Stripe key is blocked or flagged. Never commit `.env*` files or paste keys into issues.
- **Tax:** US sales tax and EU/UK VAT can apply to digital subscriptions. `automatic_tax` stays **off** on purpose: with Stripe Tax but no active registration Stripe collects nothing while it looks switched on. Before turning it on, add registrations under Tax → Registrations, then enable `automatic_tax` (and address collection) in `checkout/route.ts` together with prices set to the right tax behaviour.

Local check with the Stripe CLI: `stripe listen --forward-to localhost:3000/api/billing/webhook` prints a `whsec_…` for `STRIPE_WEBHOOK_SECRET`.

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
    notebook.css          Notebook design system (see DESIGN.md); globals.css holds only the base outside it
  auth.ts                 Credentials authentication and JWT sessions
  lib/
    db.ts                 Shared connection pool, versioned schema initialization
    dreams.ts             Validation, user-scoped SQL, row mapping
    dreamTextEncryption.ts Narrative encryption and key rotation
    dreamFollowUpAgent.ts Conversation state and recall policy
    dreamSupport.ts       Optional emotional support and self-report notes
    imagePrompt.ts        Content-specific image prompt assembly
    billing.ts            Subscriptions, quotas, usage refunds, webhook deduplication
    dreamAgentTelemetry.ts Feedback tokens and interaction telemetry
tests/                    Unit, database integration, and browser tests
evals/dream-agent/         Synthetic evaluations, replay, review and canary tools
docs/                     Agent evaluation and design documentation
```

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

CI uses Node.js 22 and the PostgreSQL preinstalled on the GitHub Ubuntu runner (16 on `ubuntu-latest`) to run lint, type checking (with unused locals and parameters as errors), knip, unit tests (including the i18n parity and dead-key test), integration tests, and a production build. A separate workflow runs a high-severity dependency audit. Browser tests and live AI evaluations are not part of that CI workflow.

`npm run eval:agent` makes real provider calls on synthetic cases and may incur charges. It defaults to OpenAI; set `DREAM_AGENT_EVAL_PROVIDER=groq` to use Groq. Evaluation artifacts default to a temporary directory outside the repository. Additional commands support replay, blind review, and canary checks.

See [Agent Improvement Loop](docs/agent-improvement-loop.md) and [Evaluation Baseline](docs/agent-eval-baseline.md) for the procedures and limitations. As the configured administrator, `/api/admin/agent-feedback?days=14&download=1` exports content-free aggregate metrics for `npm run eval:agent:canary -- snapshot.json`.

### Code quality

[docs/golden-principles.md](docs/golden-principles.md) lists ten rules for this codebase (the notebook design system only, zh/en parity with no dead keys, no dead code, files under ~800 lines, dream text encrypted and never logged, error codes instead of internals, tested payments and auth, small PRs, reduced motion and accessible names, one helper per concern), each with how it is checked.

```bash
npm run knip      # unused files, exports and dependencies (a CI gate)
npm run quality   # writes quality/score.json and quality/REPORT.md: a 0–100 score per principle
```

Every day at 13:00 UTC (or by hand from the Actions tab), `.github/workflows/quality-sweep.yml` scores `main` and, unless a `quality-sweep` PR is already open, runs Claude through `anthropics/claude-code-action` with a read-only token. Main is scored first in a job without secrets; the sweep job then holds only the checkout, that score and the action, so no repository code runs next to the token. Claude can only read the checkout and edit files under `src/`, `docs/` and `tests/unit/` (plus its PR or issue draft); it has no shell, git, GitHub access or web. Its diff and drafts are size-limited and scanned for secret-like strings before they leave the job. A separate job with no secrets and no npm cache applies the diff and runs lint, tsc, knip, the unit tests and the score; that is the only place the agent's code runs. A third job, which runs no repository code, checks the diff against an allowlist (`src/`, `docs/`, new files in `tests/unit/`, minus API routes, server entry points, billing, auth, data and privacy modules, `package.json` files, `CLAUDE.md` / `AGENTS.md` and the gates; regular ASCII-named text files only; at most 150 lines in 10 files; no edited or deleted tests), commits it as `github-actions[bot]`, pushes `quality-sweep/<date>-<slug>`, opens the PR labelled `quality-sweep` and dispatches CI and the merge gate with the run's id. When the fix needs a protected path it files Claude's drafted issue instead. Full lists: `.github/quality-sweep-prompt.md` and the `ALLOWED` / `PROTECTED` patterns in both workflows.

`.github/workflows/quality-automerge.yml` is the merge gate. It always runs from `main`'s copy, never checks out the PR, switches auto-merge off first on every run, and turns it back on (squash, pinned to the checked head commit) only when the PR provably comes from that sweep run (the run is `quality-sweep.yml` on `main`, named in the PR body, and the PR's single commit sits on the commit the run started from), every commit belongs to the GitHub-linked `github-actions[bot]` account, and the same path, mode and size rules hold. Any human push, label or reopen on a sweep PR leaves auto-merge off with a comment asking for review. A last job fails the run if `main` was force-pushed or gained a commit that did not come through a merged PR while the sweep ran.

**Branch protection on `main` is the backstop for all of this**: nothing above should be able to land code on `main` without a pull request and a green CI run, and nothing (not GitHub Actions, not the Claude GitHub App) may be on the bypass list.

Owner setup (once):

1. Run `claude setup-token` locally (Claude Pro or Max) and add the token as the repository secret `CLAUDE_CODE_OAUTH_TOKEN` (Settings → Secrets and variables → Actions). Sweep runs draw from that subscription's usage limits. Until the secret exists, the sweep skips itself with a notice instead of failing. The Claude GitHub App (https://github.com/apps/claude) is not needed for the sweep, which runs Claude with the workflow's own read-only token; install it only if you also want `@claude` on issues and PRs.
2. Settings → Actions → General → Workflow permissions: enable **Allow GitHub Actions to create and approve pull requests** (the publish job opens the PR with the workflow token).
3. Settings → General → enable **Allow auto-merge**.
4. Settings → Branches (or Rules) → protect `main`: **Require a pull request before merging** and **Require status checks to pass** with the check **verify** (the CI job); no bypass for anyone automated. Auto-merge only waits for required checks. Requiring one approval instead of zero keeps every sweep PR waiting for you, which is a fine stricter setting.

Merges done by auto-merge are made with the workflow token, so the `push` run of CI on `main` does not start for them; the PR's dispatched CI run is the check.

---

## 中文

### 项目缘起

Dream Reel 起源于我自己记录梦境的习惯。过去散落在备忘录里的片段很难一起回看，所以我希望做一个地方，保存梦境、把记忆变成画面，并整理反复出现的人物、地点，以及它们与现实生活的联系。

这是一个用于个人记录与自我回顾的应用。

### 当前功能

- **记录与保存**：文字输入、浏览器语音听写、自动保存，可选记录入睡/醒来时间、睡眠质量、睡前饮食与活动。
- **对话回忆**：Agent 根据上下文追问，帮助补充梦境细节，再进入分析。
- **可选情绪支持**：切换后可以从醒来后的感受、睡眠影响或当下困扰开始，无需记起梦境。可下载仅含用户自述的咨询准备记录，不会自动发送给医生；使用现有分析额度，不提供心理治疗或诊断。
- **结构化整理**：生成可编辑的标题、情绪、压力分数、人物、地点、意象、睡眠洞察与视觉描述。
- **晨间书写（Morning Pages）**：`/morning-pages` 提供独立的私人晨间日记，支持打字、手写涂画、自动保存、按日期回看、文字/PNG 下载与删除。正文和可编辑笔迹一起加密，不发送给 AI 分析；多窗口修改冲突时提示处理，不静默覆盖。晨间书写复用梦境正文的加密密钥：轮换密钥时，旧晨间记录重新保存到当前密钥之前必须保留旧密钥（现有批量迁移只处理梦境记录）。
- **梦境图像**：根据梦境内容调整提示词与光线描述，提供胶片显影动效；生成后可下载图片、进入档案或继续对话。
- **梦境档案**：日历、人物/地点探索、最近记录、关键词搜索、编辑、重新分析、生图、Markdown 导出与本周统计。
- **账号与订阅**：邮箱密码登录、个人资料与密码管理、用量限制，以及可选的 Stripe 订阅和客户门户。
- **中英双语**：界面与 AI 指令支持中文和英文。

语音录入依赖浏览器的 `SpeechRecognition` / `webkitSpeechRecognition`，不是服务端音频转写。浏览器兼容性和麦克风权限会影响可用性。

### 技术栈与后端

Next.js 16 App Router、React 19、TypeScript、纯 CSS 笔记本设计系统（不用 CSS 框架）；后端是运行于 Node.js 的 Next.js Route Handlers。数据库通过 `pg` 直接连接 PostgreSQL，无 ORM，使用 Zod 校验输入。认证采用 Auth.js v5 beta、PostgreSQL Adapter、JWT Session 和 bcrypt 密码哈希。

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
| 订阅支付 | `STRIPE_SECRET_KEY`、`STRIPE_PLUS_PRICE_ID_USD`（所有语言统一 USD 1.99/月）、`STRIPE_WEBHOOK_SECRET` 三项缺一不可，否则升级按钮显示“Plus 即将开放”；`NEXT_PUBLIC_APP_URL` 用于跳转。webhook 订阅 `checkout.session.completed` 与 `customer.subscription.created/updated/deleted`，详见上方 [Payments (Stripe)](#payments-stripe) |

图片提示词会随梦境字段更新；手动编辑后，自动更新暂停，直到恢复自动填充。另需注意：图片接口收到超过 200 字符的视觉描述时，会优先使用该描述，并附加原始梦境及可选性别信息，而不是直接使用编辑框里的组装提示词。

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

CI 当前运行 lint、类型检查、knip、单元测试（含 i18n 中英一致与无用键检查）、数据库集成测试、构建和独立的依赖审计；不自动运行浏览器测试或付费模型评测。代码原则见 [docs/golden-principles.md](docs/golden-principles.md)，`npm run quality` 给出每条原则的分数；每日质量巡检与自动合并的设置见 [Code quality](#code-quality)。Agent 评测、人工评审和灰度流程见 [相关文档](docs/agent-improvement-loop.md)。

---

## License and Contact

[MIT License](LICENSE) · Copyright (c) 2026 Jiani Ye

Contact: [yejiani0831@gmail.com](mailto:yejiani0831@gmail.com)
