# Golden principles

Ten rules that keep Dream Reel small, private and consistent. They are written
for people and for agents: the daily quality sweep (`.github/workflows/quality-sweep.yml`)
reads this file, scores the code against it with `npm run quality`, and fixes one
drift at a time.

Each principle says **why** it exists, the **rule**, and **how it's checked**:

- **CI gate**: a hard failure in `.github/workflows/ci.yml`; only cheap,
  deterministic invariants that hold today.
- **Quality score**: a heuristic in `scripts/quality.mjs`, reported in
  `quality/score.json` and `quality/REPORT.md` (0–100 per principle). It never
  fails a build; it tells the sweep and reviewers where the drift is.
- **Agent judgement**: what no script can see; reviewers (human or agent) check
  it on every PR.

The numbers match the `id`s in `quality/score.json`.

## 1. One design system: the notebook

**Why.** Dream Reel looks like a bedside notebook, not a UI kit (see
[DESIGN.md](../DESIGN.md)). Every one-off style is a second design system that
drifts from the first.

**Rule.**
- Shared looks are `nb-` classes in `src/app/notebook.css`, scoped to `.nb-root`.
  Page layout lives in a CSS module next to the page (`journal.module.css`,
  `archive.module.css`, …), using the `.nb-root` tokens (`var(--ink)`, never raw hex).
- No new rules in `src/app/globals.css`: it only holds what sits outside the
  notebook (base reset, canvas colour, selection, skip link, iOS field size).
- No CSS framework, no new global stylesheets, prefer classes over inline
  `style={{…}}` (inline is for values computed at runtime).

**How it's checked.** Quality score: `globals.css` line count against
`quality/baseline.json`, global stylesheets other than `notebook.css` /
`globals.css`, class selectors in `notebook.css` without the `nb-` prefix,
inline style objects in `src/app`. Agent judgement: does a new screen reuse
`nb-act`, `nb-slip`, `nb-field`… instead of restyling them?

## 2. Every string in both languages, and every key read

**Why.** The app is bilingual (zh / en). A key missing in one language shows
the wrong language or crashes; a key nobody reads is dead weight that
translators keep updating.

**Rule.** All user-facing strings live in `src/lib/i18n.ts`, in `zh` and `en`
with the same keys, shapes and `{placeholders}`. When a string stops being
used, delete it from both languages in the same PR.

**How it's checked.** CI gate: `tests/unit/i18n-keys.test.ts` (part of
`npm run test:unit`) runs `scripts/i18n-audit.ts`, which resolves aliases such as
`const J = T.journal` and `const { archive: A } = T`, and fails on any parity,
placeholder or dead-key finding. Quality score: the same audit.

## 3. No dead code, files or dependencies

**Why.** Unused code still has to be read, typechecked, audited and migrated.
The lean-cleanup PR removed a whole unused credits system, an API route and
Tailwind; it should not grow back.

**Rule.** Delete what nothing uses: files, exports, dependencies, CSS, i18n
keys. Don't leave `TODO`/`FIXME` behind: fix it or open an issue. Exported
types used inside their own module are fine.

**How it's checked.** CI gate: `npm run knip` (`knip` in default mode, plus
`--production` for unused files and dependencies; config in `knip.json`) and
`tsc` with `noUnusedLocals` / `noUnusedParameters`. Quality score: knip findings
and TODO/FIXME count.

## 4. Files stay small enough to hold in your head

**Why.** A 2,500-line component can't be reviewed, and every change to it
conflicts with every other change.

**Rule.** Files under `src/app/**` stay under about 800 lines. When one grows
past that, split by concern (a component, a hook, a lib helper) in its own PR —
not as a side effect of a feature.

**How it's checked.** Quality score: a warning per file over 800 lines
(`src/app/archive/DreamGrid.tsx` and `src/app/journal/page.tsx` are known
offenders and need a planned split, not a sweep).

## 5. Dream text is encrypted at rest and never logged

**Why.** Dreams are among the most personal things a person writes. The
narratives (`raw_text`, `clean_text`, morning pages' `content`) are encrypted
with AES-256-GCM (`src/lib/dreamTextEncryption.ts`); logs are not.

**Rule.**
- Every write of journal text goes through `dreamTextEncryption`.
- Logs carry operational metadata only. No dream text, prompts, model replies,
  messages or credentials in `console.*`; no `console.log` in `src`. Server code
  logs errors through `safeErrorMetadata()` (database errors can echo values).

**How it's checked.** Quality score: SQL writes to `dream_entries` /
`morning_pages` text columns in a module that doesn't import
`dreamTextEncryption`, log calls that reference text-like variables,
`console.log`, raw error objects in server logs. Agent judgement for anything
new that stores or sends text (analytics, exports, emails).

## 6. Users see error codes, never internals

**Why.** A raw provider error or an env var name (`STRIPE_SECRET_KEY`) tells an
attacker about the setup and tells the user nothing; a server sentence in one
language breaks the other.

**Rule.** API routes answer errors with a code from `API_ERROR_CODES`
(`src/lib/apiErrors.ts`); the client turns codes into localized text with
`getApiErrorMessage`. Never put `error.message`, `String(error)`, provider
responses or configuration names in a response body.

**How it's checked.** Quality score: string-literal `error:` values in
`src/app/api/**` that aren't codes, literals naming configuration, raw errors
passed through. Agent judgement on new routes.

## 7. Payments and auth changes come with tests

**Why.** A bug in billing or sign-in costs money or locks people out, and it
rarely shows up in a click-through.

**Rule.** Any change to billing (`src/lib/billing.ts`, `src/lib/stripe.ts`,
`src/app/api/billing/**`), auth (`src/auth*.ts`, `src/middleware.ts`,
`src/lib/session.ts`, `src/lib/authRateLimit.ts`, `src/app/api/auth/**`,
`src/app/api/user/**`) or dream-text encryption ships with a unit or
integration test that exercises it. These paths are off-limits to the
automated sweep.

**How it's checked.** Quality score: the share of those modules imported by a
test in `tests/unit` or `tests/integration`. Agent judgement: the PR's tests
cover the changed behaviour, not just the import.

## 8. Small, focused PRs

**Why.** Small PRs get real reviews, revert cleanly and don't conflict with the
work running beside them.

**Rule.** One concern per PR; refactors separate from features; no drive-by
changes in files another open PR owns. Automated sweep PRs stay at or under 150
changed lines.

**How it's checked.** `.github/workflows/quality-automerge.yml` only auto-merges
sweep PRs of ≤150 changed lines outside protected paths. Agent judgement for
everything else (not scored).

## 9. Motion is optional, every control has a name

**Why.** The notebook moves (ink drying, pages turning, the cover opening);
for some people motion makes the app unusable. Icon-only controls are silent
for screen readers.

**Rule.** Every animation or movement has a `prefers-reduced-motion` path (in
CSS and in JS: `matchMedia("(prefers-reduced-motion: reduce)")`); with it, the
page is simply already there. Every interactive element has an accessible name:
visible text, `aria-label` or `aria-labelledby`; images have `alt`
(`alt=""` when decorative).

**How it's checked.** Quality score: CSS files that animate or move things
without a `prefers-reduced-motion` rule, icon-only `<button>`s without a label,
`<img>` / `<Image>` without `alt`. Agent judgement: keyboard focus and
reduced-motion behaviour of new interactions.

## 10. One helper per concern

**Why.** Copies drift: the archive, journal and morning pages each had their own
Chinese-numeral date writer and the API routes parsed the session user id five
ways before the lean-cleanup PR.

**Rule.** Before writing a utility, look in `src/lib`. Known homes:
`src/lib/session.ts` (`requireUserId`, `sessionUserId`), `src/lib/dates.ts`
(`localDayKey`, `cnNumber`, `writtenDate`), `src/lib/edgeFade.ts`,
`src/lib/apiErrors.ts`, `src/lib/safeServerLog.ts`. A second copy moves to the
shared helper, with a unit test.

**How it's checked.** Quality score: lower-case helper functions defined in more
than one file under `src`, and the known patterns above appearing outside their
home. Agent judgement for near-duplicates the heuristics can't see.

## Working with the score

- `npm run quality` writes `quality/score.json` and `quality/REPORT.md` (both
  git-ignored) in a few seconds.
- `quality/baseline.json` holds the deliberate ceilings (today: the
  `globals.css` line count). Raising one is a reviewed change with a reason in
  the PR.
- The heuristics are cheap on purpose. A false positive is fixed in
  `scripts/quality.mjs`, not worked around in the code.
