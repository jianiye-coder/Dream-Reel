---
version: "2.0"
name: dream-reel
description: |
  Dream Reel is a bedside notebook (清晨枕边笔记本) seen in early morning light:
  an open book lying on a desk, ruled paper, black type, a blue-black
  fountain-pen hand for the dreamer's words, and one accent, red ink. Nothing
  looks like a UI kit: no pills, cards, rounded inputs or drop-shadowed
  buttons. Actions are words with a pen line under them; Dream Reel's own
  voice is a small slip of paper laid on the page.
---

# Dream Reel · 清晨枕边笔记本

The whole design system lives in `src/app/notebook.css`. Every class is
prefixed `nb-` and every surface effect and token is scoped to `.nb-root`, the
element `NotebookShell` renders around each page. `src/app/globals.css` only
holds what sits outside the notebook: Tailwind base, the page canvas colour,
`::selection`, the skip link and its focus ring, and the iOS rule that keeps
form fields at 16px on phones (≤520px) so Safari doesn't zoom.

## Tokens

Declared on `.nb-root`; use them by name, never as raw hex.

| Token | Value | Use |
| --- | --- | --- |
| `--desk`, `--desk-2` | `#d8cdb9`, `#cbbfa8` | the desk under the book |
| `--paper` | `#f5efe3` | pages and paper surfaces |
| `--paper-shade` | `#e7dece` | paper in shadow |
| `--ink` | `#1f1c17` | type |
| `--ink-soft` | `#5d574c` | body copy, quiet actions |
| `--ink-faint` | `#9b9384` | kickers, labels, folios |
| `--hand-ink` | `#1d2a50` | blue-black fountain-pen ink: everything the dreamer writes |
| `--red-ink` | `#b0432e` | the one accent: notes, red-ink actions, current page, focus |
| `--rule`, `--margin` | `#cdd5dc`, `#dc9a8a` | ruled lines, the red margin line |
| `--nb-red-underline` | SVG | the firm hand-drawn red underline under what is current or chosen (nav, ink tabs, contents, tools) |
| `--nb-red-underline-fine` | SVG | the finer stroke under red-ink actions |
| `--line` | `34px` | ruled line height; handwriting sits on it |

Type tokens: `--serif` (headings and body), `--latin` (italic numerals,
folios, brand), `--hand` (the dreamer's hand), `--script` (the cover title),
`--mono` (kickers, labels, quiet actions).

## Fonts

All self-hosted at build time, because the CSP only allows same-origin fonts
(`font-src 'self' data:` in `next.config.ts`). No font is fetched from a CDN.

- `next/font/google` in `src/app/layout.tsx`: Noto Serif SC (`--font-nb-serif`),
  Noto Serif (`--font-nb-serif-latin`, placed first on English pages so
  apostrophes and dashes aren't set full-width), Instrument Serif
  (`--font-nb-latin`), IBM Plex Mono (`--font-nb-mono`), Pinyon Script
  (`--font-nb-script`), and Work Sans 700 for the skip link only.
- `lxgw-wenkai-webfont` (霞鹜文楷) for `--hand`, imported in the layout.

## Surfaces and components

- **`NotebookShell`** (`src/components/notebook/NotebookShell.tsx`): `.nb-root`
  plus the top bar (brand, running-head nav with the red underline under the
  current page, language toggle), the phone contents sheet, and the sound switch
  (声音 开 / 关, Sound on / off; in the contents sheet on phones).
  `surface="desk"` (default) shows the desk with paper grain and soft window
  light; `surface="paper"` makes the whole page one sheet.
  `lean` lays the book out at one fixed size (1021 × 690 book px) and zooms
  the stage to fill the window (`--lean`), so type, photos and turns scale
  together; working pages use it.
- **`Book` / `BookPage`** (`src/components/notebook/Book.tsx`): an open book
  seen from above: cloth boards, a page block under each page (the top page
  lies on the stack; the sheets' edges run down the fore-edge, round the
  corners and along head and tail, drawn on canvases by `edgeTextures`), spine
  crease, ribbon, optional fountain pen (`pen`), optional pointer tilt (`tilt`).
  `BookPage side="l" | "r"` with `ruled`, `indent`, `folio`, `curl` (the
  bottom corner peels up a little on hover), `corner` (a `PageCorner` instead);
  pass page-module classes through `className` / `padClassName`.
- **`PageCorner`** (`src/components/notebook/PageCorner.tsx`): the right page's
  bottom corner as the way to turn it (the archive's open night). A small
  dog-ear at rest; hovering or keyboard focus peels it up (the paper's back over
  a soft shadow, `.nb-curl`), moving away lets it fall back. One click, tap or
  Enter/Space turns the page; a tap plays the lift quickly first. Focus also
  writes what it does above it in red ink. On phones it stays as a small folded
  corner at the bottom of that sheet and opens without a turn.
- **`PhotoLightbox`** (`src/components/notebook/PhotoLightbox.tsx`): wraps a
  dream photo's image in a zoom-in button; opens the photo enlarged as a print
  on the softly blurred desk (warm, never a black overlay) with date and title.
  A native modal `<dialog>` portalled to `.nb-root`; ×, Escape or a click on the
  desk put it down and focus returns to the print.
- **`edgeFade`** (`src/lib/edgeFade.ts`): ref callback for a scroll pane on a
  page: `data-fade-top` / `data-fade-bottom` for a mask that fades into the paper
  only where there is more to read (`focusable` adds a tab stop while it
  scrolls).
- **`TurnLink`** (`src/components/notebook/TurnLink.tsx`): a link between book
  pages (`/`, `/journal`, `/morning-pages`, `/archive`) turns the right-hand
  page instead of navigating flat; off-book links and phones navigate normally.
- **`flipPage`** (`src/lib/notebookFlip.ts`): the page turn itself: a snapshot
  of the right page cut into strips that bend as the sheet travels, with
  shadows and the page-turn sound.
- **`handwrite`** (`src/lib/notebookHandwriting.ts`): writes text one character
  at a time in fountain-pen ink (`.nb-wet` dries into the page), with pauses
  and a word crossed out (`.nb-struck`); with reduced motion the page is simply
  already written.
- **`notebookSound`** (`src/lib/notebookSound.ts`): see Sounds.

## Shared classes (notebook.css)

- Type: `nb-kicker` (uppercase mono label), `nb-body`, `nb-hand` (fountain-pen
  hand on the line), `nb-note` (red-ink handwritten note), `nb-mono`,
  `nb-date-line`, `nb-struck`, `nb-wet`, `nb-caret`.
- Actions: `nb-act` (the primary action: a word in ink over a ruled line, an
  arrow after it), `nb-act-quiet` (mono, underline on hover), `nb-red-act` (red-ink
  handwriting over `--nb-red-underline-fine`, which thickens on hover),
  `nb-ink-tabs` (words as tabs; the selected one in ink with the firm red
  underline), `nb-stamp` (a red rubber stamp).
- Paper: `nb-slip` + `nb-slip-label` (Dream Reel's voice: a slip of paper
  signed DREAM REEL in mono), `nb-print` + `nb-tape` + `nb-cap` (a taped photo
  print), `nb-ruled` (ruled paper with a margin line).
- Forms: `nb-field` (label in mono, input written in the hand on a single
  line), `nb-msg` (red-ink message; `nb-ok` for success).
- Utilities: `nb-sr-only` (screen readers only), `nb-on` (the on/current
  state everywhere), `nb-fade-in`.
- Focus: one keyboard focus mark for the whole notebook, a thin line of red
  ink (`.nb-root :where(a, button, …):focus-visible`). Writing fields show
  focus with their own line or margin mark instead.

Page-specific sections (landing, login, pricing, account) also live in
notebook.css under their own headings.

## Page CSS modules

Working pages keep their own layout in a CSS module next to the page:
`src/app/journal/journal.module.css`, `src/app/morning-pages/page.module.css`,
`src/app/archive/archive.module.css`,
`src/components/DreamConversationControls.module.css`,
`src/app/blog/dreams-and-consciousness/page.module.css`.

- They use the `.nb-root` tokens and the shared classes; they don't redefine
  them. A page that deliberately differs (size, rotation, pen weight) adds a
  small modifier class next to the shared one, e.g.
  `className={\`nb-red-act ${css.redAct}\`}` (the journal's red-ink actions
  are a size smaller in a finer pen; the archive's slips are roomier).
- `notebook.css` resets every `button` inside `.nb-root` (`font: inherit`,
  no background or border). Module rules must outrank it, so they are scoped:
  `:global(.nb-root) .x` (journal), `.ar .x` (archive), `.book .x`
  (morning pages). A modifier that overrides a shared class must be more
  specific than it (e.g. `:global(.nb-root) .redAct:global(.nb-red-act)`).
- Sizes in lean pages are book px: they scale with the zoom.

## Phones (≤900px)

No book, no cards: one continuous sheet of paper with room to breathe. The
boards, edges, spine, ribbon, pen, folios and page curl disappear, pages stack
(a small ◆ between them; `nb-r-first` puts the right page first), the nav
folds into a full-screen contents sheet (`nb-toc`), the sound switch hides,
`lean` zoom is 1, and page turns become plain navigation. Page modules that
lay out a book (journal, morning pages, archive) add their own
`@media (max-width: 900px)` block.

## Page map

| Route | Surface | Layout |
| --- | --- | --- |
| `/` | desk | closed hardcover that opens into the hero spread (once per session, `dr-cover-seen`), then paper sections below |
| `/journal` | desk, lean | book: the dream in hand on the left; what Dream Reel read, or the conversation, on the right; the developing room is a dark `<dialog>` |
| `/morning-pages` | desk, lean | book: date, about and contents on the left; the ruled sheet (text or drawing) on the right |
| `/archive` | desk, lean | book with paper bookmarks: calendar, 人物与地点, recent dreams; the editor opens as a second book over the desk |
| `/login`, `/pricing`, `/account`, `/blog/…` | paper | one sheet (`nb-auth` on login, `nb-paper-main` on pricing/account, the blog's own module) |

## Sounds

Off until the first gesture (browser autoplay rules) and switchable from the
shell (`dr-sound` in localStorage). The fountain-pen writing sound belongs to
the landing page only: grains of a real recording played as the demo dream is
handwritten (`writeChar` from `handwrite`). Where people actually write (journal,
morning pages) typing is silent. The tap and the page turn are synthesised with
Web Audio.

Recording: "Writing with Fountain Pen Nib" by black_trillium on Freesound
(https://freesound.org/s/397282/), CC0 1.0. Processing notes and files:
`public/sounds/CREDITS.md`, `public/sounds/pen-sprite.mp3`,
`public/sounds/pen-grains.json`.

## Motion

Quiet and physical: ink drying, a page turning, the cover falling open, light
drifting through blinds. With `prefers-reduced-motion` the page is already
written (no handwriting), links don't turn the page, the book doesn't tilt and
the cover opens at once.

## i18n

All user-facing strings live in `src/lib/i18n.ts`, in both `zh` and `en`.
English pages switch `--serif` to the Latin serif first (`html[lang="en"]`).
