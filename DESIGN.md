---
version: "1.0"
name: dream-reel
description: |
  Dream Reel has two distinct visual registers that never mix. The journal and
  chat surfaces use a deep navy dark theme — atmospheric, quiet, suited for
  3 AM note-taking. The landing page, archive, and account surfaces use a warm
  cream light theme — like waking up to morning light. Both registers share the
  same type system and the same principle: let content breathe. Structure
  through spacing and type hierarchy, not through cards, borders, and radii.
  Rounded corners and card shells are reserved for interactive input surfaces
  and floating overlays — not for wrapping static text or grouping information
  that could just sit on the page.
---

## Themes

Dream Reel operates in two mutually exclusive themes. A page is either
**journal-dark** or **morning-light**. Never mix their tokens on the same surface.

### journal-dark
Applied via `.journal-root` on the page shell.
Background: radial gradient from `#0c0a1e` to `#070712`.
Everything on this surface — text, inputs, nav — inherits from this context.

### morning-light
Applied via `.mist-page` or `.morning-landing` on the page shell.
Background: `--morning-bg` (`#fffbeb`), a warm cream.
Archive and landing pages use this theme.

---

## Colors

### journal-dark palette

```yaml
journal-bg-center:  "#0c0a1e"
journal-bg-edge:    "#070712"
lavender:           "#b5a7d6"    # body text, muted UI
lavender-deep:      "#8f82bc"    # secondary labels
mist-blue:          "#b9cde3"    # tags, people labels
mist-white:         "#fbf8ff"    # strong text, headings
mist-border:        "rgba(162, 154, 188, 0.20)"
mist-panel:         "rgba(255, 255, 255, 0.46)"
mist-panel-strong:  "rgba(255, 255, 255, 0.62)"
accent-purple:      "rgba(162, 120, 210, 0.55)"  # focus rings, active states
bubble-ai-bg:       "rgba(72, 52, 130, 0.22)"    # AI chat bubbles only
```

### morning-light palette

```yaml
morning-bg:           "#fffbeb"   # page background
morning-paper:        "#ffffff"   # card surfaces (use sparingly)
morning-soft:         "#f8f3f0"   # subtle hover, tab backgrounds
morning-ink:          "#0f172a"   # primary text
morning-muted:        "#475569"   # secondary text, captions
morning-faint:        "#64748b"   # placeholder, tertiary text
morning-primary:      "#92400e"   # amber-brown CTA, links
morning-border:       "#e9ded6"   # dividers, input borders
morning-shadow:       "0 24px 70px rgba(120, 53, 15, 0.10)"
```

---

## Typography

**Primary font (UI + headings):** Outfit (`--font-serif`, despite the variable
name). Used for all body copy, nav, labels, and display headlines.

**Secondary font (code, timestamps, metadata):** Work Sans (`--font-sub`).

**CJK fallback:** `"PingFang SC", "Hiragino Sans GB", sans-serif`.

All sizes are in `rem` with `clamp()` for responsive display text.

```yaml
display:
  fontFamily: Outfit
  fontSize:   "clamp(2rem, 3.4vw, 3.5rem)"
  fontWeight: 650
  letterSpacing: "-0.055em"
  lineHeight:  1.05

heading-xl:
  fontFamily: Outfit
  fontSize:   "clamp(1.6rem, 2.8vw, 2.8rem)"
  fontWeight: 600
  letterSpacing: "-0.04em"
  lineHeight:  1.1

heading-lg:
  fontFamily: Outfit
  fontSize:   "1.55rem"
  fontWeight: 600
  letterSpacing: "-0.03em"

heading-md:
  fontFamily: Outfit
  fontSize:   "1.15rem"
  fontWeight: 600

body-lg:
  fontFamily: Outfit
  fontSize:   "1.05rem"
  fontWeight: 400
  lineHeight:  1.7

body-md:
  fontFamily: Outfit
  fontSize:   "0.9rem"
  fontWeight: 400
  lineHeight:  1.82

label:
  fontFamily: Outfit
  fontSize:   "0.72rem"
  fontWeight: 700
  letterSpacing: "0.16em"
  textTransform: uppercase

caption:
  fontFamily: Work Sans
  fontSize:   "0.74rem"
  fontWeight: 500
  letterSpacing: "0.06em"
```

---

## Spacing

Base unit: `0.25rem` (4px). All spacing values are multiples of this unit.

```yaml
xs:   "0.25rem"   #  4px — tight label gaps
sm:   "0.5rem"    #  8px — inline padding, between siblings
md:   "1rem"      # 16px — default gap between elements
lg:   "1.5rem"    # 24px — between sections within a panel
xl:   "2.5rem"    # 40px — between major page sections
2xl:  "5rem"      # 80px — hero vertical padding
```

---

## Layout

Max content width: `64rem` (1024px), centered with `px-4 sm:px-8`.
Nav sits above the content at `z-10`.
No sidebar. No persistent right column. The layout is single-column with
section breaks driven by vertical space.

---

## Border Radius

**Use radius sparingly.** Every rounded surface costs visual weight. Ask: does
this shape need to announce itself as a container, or can the content sit on the
page directly?

```yaml
pill:     "9999px"   # buttons, nav chips, tags only
input:    "0.8rem"   # form fields, auth inputs
overlay:  "1.25rem"  # modals, dropdowns, floating panels
card-sm:  "1rem"     # only when a true interactive card is needed
card-lg:  "1.5rem"   # capture cards, onboarding panels — max radius ever used
```

**Never** apply `rounded-3xl`, `rounded-[2rem]`, or larger to a static
grouping of text content. The landing bento and process sections use spacing
and background tint, not a `border-radius`.

---

## Component Rules

### Buttons

Three variants only. No ghost, no text-link masquerading as a button.

**Primary** — filled, `morning-primary` background on light theme, purple
accent on dark theme. `border-radius: 9999px`. Min height 44px.

**Secondary** — `border: 1px solid morning-border`, `background: rgba(255,255,255,0.74)`.
Same pill radius. On dark theme: `rgba(255,255,255,0.08)` background.

**Text link** — no border, no background. Underline on hover only. Use for
in-paragraph navigation. Not a button element.

### Inputs and textareas

The `quick-record-field` is the only text surface with a visible card shape
(`border-radius: 1.55rem`). It earns its shape because it is the primary
interactive input. All other inputs use `border-radius: 0.8rem`.

On focus, the field border shifts to `rgba(162, 120, 210, 0.55)` with a soft
glow ring. No blue outlines — suppress browser defaults with `outline: none`.

### Cards

**Do not create a card to group information.** Information groups are separated
by margin and type hierarchy. Cards are only used when the content has a clear
interactive affordance — you can click it, expand it, or it represents a
selectable item.

When a card is justified:
- Morning-light: `background: rgba(255,255,255,0.68)`, `border: 1px solid #e9ded6`
- Journal-dark: `background: rgba(255,255,255,0.06)`, `border: 1px solid rgba(162,154,188,0.18)`
- Max `border-radius: 1.5rem`

**Never** nest a card inside a card. **Never** use `mist-card` for static page
sections or label groups.

### Chat bubbles

- User messages: `background: rgba(155, 120, 220, 0.22)`, no border, right-aligned
- AI messages: `background: rgba(72, 52, 130, 0.22)`, `border: 1px solid rgba(155,130,220,0.2)`, left-aligned
- Avatar: Dream Reel logo PNG at 22×22px, not a character or emoji
- No card shell around the message list — messages float directly on the page background

### Navigation

Journal nav (`journal-nav`): `padding: 0.75rem 1.5rem`. Inline flex with logo
left, nav pills right. Pills use the secondary button shape — pill radius,
`rgba(255,255,255,0.74)` background on light, `rgba(255,255,255,0.08)` on dark.

Nav items must be vertically centered in their pill with `display: inline-flex;
align-items: center; line-height: 1`.

### Dividers

Use `border-top: 1px solid var(--morning-border)` or `rgba(162,154,188,0.2)`.
Never use `<hr>` styled as a decorative element. Never use a shadow as a divider.

### Tabs

The archive uses `archive-tab` — plain text labels with an underline indicator on
the active state (`::after` with `background: morning-primary`). No card shell
around the tab bar. No background highlight on inactive tabs.

Journal mode tabs (`mode-tab`) use a similarly minimal treatment: faint inactive
text at `rgba(195,180,238,0.72)`, bright active at white. No pill or card
background on the tab bar itself.

---

## What NOT to do

- **Do not add `border-radius` larger than `1.5rem`** to any element. `rounded-3xl`
  and `rounded-[2rem]` have been used historically — audit and remove them.
- **Do not wrap static text sections in `mist-card`** just to give them visual
  separation. Use margin and type scale instead.
- **Do not add `box-shadow` to non-floating elements.** Shadows imply elevation.
  Use them only on modals, dropdowns, and floating panels.
- **Do not use gradient backgrounds on individual cards** unless the card is a
  featured/highlighted state. Default cards use flat fills.
- **Do not mix theme tokens.** `--morning-*` inside `.journal-root`, or
  `--mist-*` inside `.morning-landing`, will produce invisible or clashing text.
- **Do not stack more than two levels of visual container.** A page section can
  contain a card. The card does not contain another card.
- **Do not use more than four distinct border-radius values** in a single view.
  Pick from the scale above.

---

## Patterns

### Page section (landing)

```html
<section class="morning-process">
  <div class="morning-section-heading">
    <p class="morning-eyebrow">低负担的晨间流程</p>
    <h2>不必先理解，先不要忘记。</h2>
  </div>
  <!-- content sits directly on the page — no card wrapper -->
  <div class="morning-step-grid">
    ...
  </div>
</section>
```

Sections are separated by `padding: 5rem 0` and a heading hierarchy.
No card, no background tint, no rounded box.

### Floating input field (journal)

```html
<div class="quick-record-field">   <!-- this earns its shape: it is the input -->
  <textarea class="quick-textarea" />
  <div class="input-actions" />
</div>
```

The field has `border-radius: 1.55rem`. The wrapper page section does not.

### Empty state

No illustration card. A single centered `p.morning-faint` with 1–2 lines.
No icon box, no bordered container.

---

## Logo

`/dream-reel-logo.png` — the crescent/moon mark. Used at:
- Nav: 36–40px
- AI message avatar: 22px (`object-contain`, no border-radius)
- PWA icon: 192px, 512px (declared in `/public/manifest.json`)

Do not apply `border-radius` to the logo image.

---

## i18n

All user-facing strings live in `src/lib/i18n.ts`. Both `zh` and `en` keys
must be present for every string. Never hardcode Chinese or English UI text
in a component file.
