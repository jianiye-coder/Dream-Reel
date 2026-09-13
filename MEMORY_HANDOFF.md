# Dream Reel — conversation handoff

Updated: 2026-09-12 (America/Los_Angeles)

## Current repository state

- Repository: `jianiye-coder/Dream-Reel`
- Primary product: Dream Reel, a Chinese-first AI dream journal built with Next.js.
- Base branch: `main`
- Active PR: [#53 — Improve archive and journal performance](https://github.com/jianiye-coder/Dream-Reel/pull/53)
- PR branch: `codex/p3-performance`
- Latest commit on the PR: `9d273b5 Simplify archive export control`
- Isolated working clone used for this PR: `/tmp/dream-reel-p3.n5KXIw/repo`

Do not work directly in a potentially dirty primary checkout. Continue from the PR branch in an isolated worktree or clone.

## What has changed in PR #53

### P3 performance

1. Journal renders only the latest 50 chat messages initially and provides a control to reveal earlier messages. Full message state remains available to the agent.
2. Archive bulk tag updates run with a concurrency limit of four, rather than creating all network requests at once. Failures are surfaced to the user.
3. Archive `DreamGrid` is dynamically imported with a loading state, so the archive shell becomes interactive sooner.

### Journal input polish

4. Removed the thick purple focus frame from both quick record and chat input surfaces.
5. Pointer focus keeps the neutral input border. Keyboard focus has a subtle, inset warm focus outline so keyboard navigation remains accessible.

### Archive readability

6. Added the scoped `archive-keyword-index` class to the people/locations tag view.
7. Its key text now uses high-contrast dark ink/gray-blue values on the light archive background. Small labels use warm brown; chip text remains dark.

### Archive visual simplification

8. The export area no longer uses a nested card or bordered pill button.
9. `导出全部梦境` remains a label, and `↓ Markdown 阅读版` is now a bordered-free text action with an understated underline and visible keyboard focus.

## Recent merged PRs / important baseline

- #49: Hide oversized quick journal scrollbar — merged (`a15e2af`)
- #50: Refine blog typography and journal navigation — merged (`47143c5`)
- #51: Web interface accessibility / archive performance baseline — merged (`c175aa9`)
- #52: Dependency security lockfile update — merged (`d76c206`)

## Verification for PR #53

Completed successfully after the previous commits:

- `npx tsc --noEmit`
- `npm run lint` — exits 0 with six existing warnings
- `npm run test` — 109 passed, 3 skipped (performed before the latest CSS-only commits)

Known lint warnings (not newly introduced):

- unused `request` in `src/app/api/admin/credits/route.ts`
- unused `openBilling` in `src/app/archive/ArchiveShell.tsx`
- existing callback/dead-code warnings in `src/app/archive/DreamGrid.tsx`
- unused `previewNodes` in `src/app/journal/page.tsx`

`npm run build` compiles and type-checks but cannot complete in the isolated environment because `DATABASE_URL` is intentionally absent and `/api/billing/checkout` loads DB-dependent configuration while collecting page data. Do not treat that environment error as a product build regression without retrying with the project’s configured environment.

After commit `9d273b5`, GitHub Actions `verify` was running again; `audit` was successful. Check current PR status before merging.

## Design direction agreed with the user

- Chinese-first UI: do not leave visible English labels such as “Chat” in the Chinese interface.
- Morning archive/journal should use a warm, light, low-noise palette.
- Essential text must have clear contrast; do not use pale lavender for operational information.
- Avoid overuse of rounded cards, double borders, pills, nested containers, and decorative frames.
- Preserve clear focus indication for keyboard users, but avoid large purple rings on pointer interaction.
- Prefer one structural surface with quiet dividers over several bordered boxes.

## Current request status

The latest user request, to reduce card and container-border usage in the Archive export control, is implemented and pushed to PR #53.

Next sensible action:

1. Wait for / inspect PR #53 checks and Vercel preview.
2. Let the user review the preview before merging unless they explicitly request the merge.
3. If continuing a broader UI pass, audit the Archive page for other nested-card patterns, but make changes sparingly and keep functionality intact.

## Privacy and safety

- Never print, commit, or expose real dream text from local data, browser storage, screenshots, exports, or database content.
- Do not inspect browser localStorage for past blind reviews.
- If AI-agent evaluation work returns, the previous quality-gate automation required completed exported blind-review JSON files, separate randomized rounds, provider capacity, and strict canary gates. The user later explicitly requested using their existing review rather than requiring another 20-question review; do not silently reintroduce that requirement.

## Useful commands

```bash
npx tsc --noEmit
npm run lint
npm run test
npm run build
gh pr view 53 --json url,state,statusCheckRollup
```

Use `apply_patch` for source/document edits. Do not use destructive Git commands. Keep untracked build artifacts (`.next/`, `node_modules/`, `next-env.d.ts`, `tsconfig.tsbuildinfo`) out of commits in isolated clones.
