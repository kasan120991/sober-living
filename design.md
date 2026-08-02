# SoberLife — Design System

**Stack:** Nuxt 4 · Nuxt UI v4 · Tailwind CSS v4 · plain JavaScript
**Applies to:** both `admin/` and `client/`. They are separate apps that share these tokens
by **copy, not import** — the `@theme` block lives in each app's own `main.css`.
**Derived from:** Vercel's Geist system (`DESIGN-vercel.md`), adapted for an operations app.

Read this before writing any component, page, or CSS.

---

## 1. The decision

**Use Nuxt UI v4, themed with our tokens. Do not hand-build a component kit.**

```
design tokens  (@theme block in app/assets/css/main.css)
   ├──▶ Tailwind v4 utilities   ← layouts, the census board, one-off chrome
   └──▶ Nuxt UI v4              ← reads the same tokens
          ├── ui.colors aliases        (app.config.ts)
          ├── --ui-primary / --ui-radius  (main.css)
          ├── component slot overrides (app.config.ts)
          └── `ui` prop                (one-off overrides)
```

Why, for this app specifically:

- SoberLife is overwhelmingly **tables, forms, modals, and toasts** — census grids, apartment-check
  checklists, med-pass logs, pass approval queues. `UTable`, `UFormField`, `USlideover`,
  `UModal`, `UToast` are exactly the components that take weeks to build and are easy to get
  subtly wrong.
- **Accessibility is a compliance surface here.** Nuxt UI sits on Reka UI primitives — focus
  traps, keyboard nav, ARIA. Hand-rolling that for an app that may face a licensing audit is
  avoidable risk.
- A tech doing med pass on a phone needs correct touch targets and focus behavior, not a
  distinctive aesthetic. Custom kits pay off when being memorable *is* the product. This is an
  internal ops tool: clarity and speed win.

Build custom **only** where Nuxt UI has no equivalent. The expected case is the **census board** —
a bed grid is not a table.

---

## 2. What we take from Geist, and what we drop

Geist is achromatic by construction: near-black ink on a near-white canvas, with 1px hairlines
doing all the structural work. Color is rare.

**That restraint is the whole reason we chose it.** When the chrome has no color of its own, a
failed drug screen or an overdue resident becomes the only colored thing on the page and reads
instantly. A branded accent would fight those signals.

| Taken | Dropped |
|---|---|
| Ink-on-canvas palette, hairline borders | Hero mesh gradient |
| 6px square buttons (app chrome) | 100px marketing CTA pills |
| Hairline cards, flat elevation | Logo strips, pricing cards, 128px section bands |
| Geist Sans / Geist Mono | 48px display type |
| 4px-base spacing scale | The 64–128px end of that scale |

`DESIGN-vercel.md` is an analysis of a **marketing site**. It notes the split itself: pills for
marketing, 6px squares for app chrome. SoberLife is all app chrome.

> **Note:** line 60 of `DESIGN-vercel.md` is corrupted — stray text inside the `label-sm`
> `fontWeight` value. Tokens below were transcribed and corrected by hand. Do not machine-parse
> that file's frontmatter.

---

## 3. Tokens — `app/assets/css/main.css`

```css
@import "tailwindcss";
@import "@nuxt/ui";

@theme {
  /* ── Ink & surface (Geist) ── */
  --color-ink:            #171717;  /* headings, primary fill, high-emphasis text */
  --color-body:           #4d4d4d;  /* paragraphs, table cells, nav links */
  --color-mute:           #8f8f8f;  /* captions, metadata */
  --color-faint:          #a1a1a1;  /* placeholders, disabled */
  --color-hairline:       #ebebeb;  /* the 1px workhorse border */
  --color-hairline-soft:  #f2f2f2;  /* inset wells, alternating rows */
  --color-canvas:         #fafafa;  /* page background */
  --color-elevated:       #ffffff;  /* cards, inputs, modals */

  /* ── Neutral scale (Nuxt UI `neutral` — named "geist", NOT "slate": Tailwind ships a built-in
     slate that is blue-tinted, and reusing the name silently loses our greys) ── */
  --color-geist-50:  #fafafa;
  --color-geist-100: #f2f2f2;
  --color-geist-200: #ebebeb;
  --color-geist-300: #d4d4d4;
  --color-geist-400: #a1a1a1;
  --color-geist-500: #8f8f8f;
  --color-geist-600: #4d4d4d;
  --color-geist-700: #333333;
  --color-geist-800: #262626;
  --color-geist-900: #171717;
  --color-geist-950: #0a0a0a;

  /* ── Status (see §4 — success is OURS, not Vercel's) ── */
  --color-success:      #16a34a;
  --color-success-soft: #dcfce7;
  --color-success-deep: #15803d;

  --color-warning:      #f5a623;
  --color-warning-soft: #ffefcf;
  --color-warning-deep: #ab570a;

  --color-error:        #ee0000;
  --color-error-soft:   #ffe5e5;
  --color-error-deep:   #c50000;

  --color-info:         #0070f3;
  --color-info-soft:    #d3e5ff;
  --color-info-deep:    #0761d1;

  /* ── Type ── */
  --font-sans: 'Geist', 'Inter', system-ui, sans-serif;
  --font-mono: 'Geist Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace;
}

:root {
  /* Geist's primary is a flat near-black. Nuxt UI cannot express this via
     app.config.ts — `primary: 'black'` is rejected because it has no shade
     ladder — so it is set here directly. Hover/active derive via alpha. */
  --ui-primary: var(--color-ink);

  --ui-radius: 6px;      /* Geist app chrome: tight 6px squares */
  --ui-container: 90rem; /* wide — this app is data-dense */
}

body {
  background-color: var(--color-canvas);
  color: var(--color-body);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

:focus-visible {
  outline: 2px solid var(--color-ink);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### `app.config.ts`

```ts
export default defineAppConfig({
  ui: {
    colors: {
      neutral: 'geist',   // our Geist grey ladder
      success: 'green',
      warning: 'amber',
      error:   'red',
      info:    'blue',
      // primary is NOT set here — see --ui-primary in main.css
      // secondary is unused — we have no second accent
    },
  },
})
```

---

### Five things that silently break this setup

All five were hit while building the login screen, and none produced a warning.

1. **Base styles must live inside `@layer base`.** Cascade layers rank *unlayered* rules
   above layered ones, and Tailwind/Nuxt UI put every utility in a layer. An unlayered
   `body { color }` therefore outranks the entire component library — inputs lose their
   ring color and fall back to `currentColor`, `text-muted` stops working, and everything
   quietly renders in body grey.
2. **Don't name the neutral scale `slate`.** Tailwind ships a built-in blue-tinted `slate`
   and the name collides. Ours is `geist`.
3. **`app.config.ts` must be inside `app/`, and must be `.ts`.** A `.js` file, or a `.ts`
   at the project root, is ignored without warning — Nuxt UI then uses its defaults
   (`primary: green`, `neutral: slate`). This is the one TypeScript file in the project;
   Nuxt gives no alternative.
4. **Nuxt UI's largest size is 40px**, under our 44px floor. `app.config.ts` sets
   `min-h-11` on every input, button, select and textarea so `size` cannot undercut it.
   **Always pair `min-h-*` with `items-center`** — raising a row's minimum height alone
   leaves its icon and label pinned to the top of the taller box, which reads as broken
   alignment rather than as generous spacing.

5. **Light-on-dark text needs `-webkit-font-smoothing: auto`.** Our base layer sets
   `antialiased`, which is right for dark text on the light canvas but thins glyphs on a
   near-black fill — pure `#fff` then reads grey. Both Safari and Chrome honor the
   property (Firefox uses `-moz-osx-font-smoothing`), and Safari renders it thinnest.
   `app.config.ts` overrides it on buttons rather than reaching for a heavier weight,
   which would break the weight-500 button spec below.

Map the Nuxt UI semantic tokens (`--ui-bg`, `--ui-border`, `--ui-text-*`) to ours
explicitly rather than letting them derive from the neutral ramp — otherwise a Nuxt UI
upgrade can restyle every surface in the app.

Note `--ui-bg` is the surface components sit **on** (white), not the page canvas. The page
background comes from the `@layer base` rule.

---

## 4. Status color system

This is the part that is **not** inherited from Vercel, and it matters most.

**Vercel maps success to blue `#0070f3`.** We do not. Green/red is the expected convention for a
screen result — blue-as-success next to a red failure would genuinely confuse a tech reading a
list at speed. Blue is demoted to links and informational states only.

### The governing rule

> **The normal state gets no color.**

Most residents, most of the time, are fine. If "in residence" or "screen negative" carries a
color, the exceptions drown. Normal is ink-on-white. Color means *look at this*.

### Domain mappings

| Domain | State | Treatment |
|---|---|---|
| **Census** | In residence | No color — ink on white |
| | Signed out, within expected return | `info` — subtle |
| | Out on travel pass | `info` — subtle, bed shown as held |
| | **Overdue return** | **`error`, solid fill, top of list, always visible** |
| | Bed out of service | `neutral` muted, hatched or dimmed |
| | Bed held | `warning` |
| **Drug screen** | Negative | `success` |
| | Positive | `error` |
| | Refusal | `error`, distinct label — never collapsed into "positive" |
| | Dilute | `warning`, distinct label |
| | Pending lab confirmation | `neutral` + mono timestamp |
| **Apartment check** | Pass | `success` |
| | Fail | `error` |
| | Follow-up open | `warning` |
| **Med pass** | Given | `success` |
| | Refused | `warning` |
| | Missed | `error` |
| | Held | `neutral` |
| **Community service** | On track | No color |
| | Behind target | `warning` |

**An overdue resident is the highest-urgency state in the app.** It outranks every other signal
on the census screen. It does not share visual weight with anything else, and it must survive
scrolling — pin it.

Refusals and dilutes are **distinct outcomes, not "fail."** They get their own labels and their
own colors. Collapsing them loses information the record may later need to defend.

---

## 5. Density

Vercel's rhythm is a marketing rhythm — 96–128px between bands. A census screen showing 40 beds
needs the opposite end of the same scale.

| Context | Value |
|---|---|
| Base unit | 4px |
| App scale | 4 · 8 · 12 · 16 · 24 · 32 |
| Card padding | 16px (not Vercel's 24–32px) |
| Table cell padding | 8px 12px |
| Gap between cards in a grid | 12px |
| Page gutter — desktop | 24px |
| Page gutter — mobile | 16px |
| Max section gap | 32px |

Do not use 64/96/128px spacing. Those tokens are marketing furniture and are deliberately absent.

---

## 6. Touch targets & mobile

`DESIGN-vercel.md` claims 44px targets but specifies `padding: 0px 6px` on app buttons at a 20px
line-height — that is nowhere near 44px. **We override this.**

- **Minimum 44×44px** for anything a tech taps: form controls, row actions, checklist items,
  sign-out return acknowledgement.
- **Table rows on mobile: 48px minimum.** An apartment-check list is tapped, not read.
- Vercel's tight `0px 6px` chrome is **desktop-only** — dense toolbars and nav.
- Primary actions on mobile go full-width.
- Checklist pass/fail controls are large and thumb-reachable — an apartment sweep is one-handed.

Mobile-first CSS for every screen a tech touches in a hallway. Desktop refinements come after.

---

## 7. Interaction states

`DESIGN-vercel.md` documents **no hover states and no dark mode** (see its Components note). We
author both. Defined here, applied globally via `app.config.ts`.

| State | Treatment |
|---|---|
| Hover — solid | `bg-primary/90` |
| Hover — ghost / outline | Background `--color-hairline-soft`, border `--color-geist-300` |
| Active / pressed | `bg-primary/80` |
| Focus-visible | 2px `--color-ink` outline, 2px offset — never removed |
| Disabled | 40% opacity, `pointer-events: none` |
| Loading | Nuxt UI `loading` prop — never a custom spinner |

**Dark mode is deferred.** Light canvas is correct for a phone in a bright hallway or outdoors
during a sign-out return. Revisit only if staff working night shifts ask for it.

---

## 8. Typography

Geist Sans and Geist Mono, both open-source. Fallbacks: Inter, JetBrains Mono.

| Token | Size | Weight | Tracking | Use |
|---|---|---|---|---|
| `heading-lg` | 32px | 600 | -1.28px | Page titles (largest in the app) |
| `heading-md` | 20px | 600 | -0.4px | Section and card headings |
| `label-sm` | 14px | 500 | -0.28px | Strong labels, nav emphasis |
| `mono-eyebrow` | 12px | 500 | 0 | Uppercase section eyebrows |
| `body-lg` | 16px | 400 | 0 | Lead text |
| `body-md` | 14px | 400 | 0 | **Default** — body, table cells, nav |
| `body-sm` | 12px | 400 | 0 | Captions, metadata |

The 48px display size is dropped — it is hero type for a marketing page. **32px is our ceiling.**

Weight is binary: 600 for headings, 500 for buttons and labels, 400 for everything else. No light
weights, no italics.

### Where mono earns its place

Geist Mono is not decoration here. Use it for anything scanned in a column or read aloud:

- Bed labels — `4B`
- Times — `21:45`
- Dates in records
- Record and resident IDs
- Screen result codes

This is a genuine fit: monospace makes a column of times and bed numbers scannable, which is
exactly what a tech does with the census.

---

## 9. Component rules

- **Prefer Nuxt UI (`U*`) always.** Fall back to custom only when no component covers the pattern.
- **Forms: always `UFormField`.** Never a bare `<label>` next to an input. It wires up
  label/description/error/ARIA correctly.
- **Icons: `i-*` strings via `@nuxt/icon`.** Do not install a per-icon Vue package.
  Icon-only buttons always need `aria-label`.
- **Elevation is flat.** 1px hairline + white-on-canvas step. Shadows only for genuinely floating
  surfaces — menus, modals, tooltips — and then whisper-soft and layered, never one heavy drop.
- **Toasts (`useToast`) confirm writes.** A tech needs to know the log saved before moving on.
- **Destructive and corrective actions confirm.** Amendments capture a reason — see CLAUDE.md.

### What NOT to do

```
✗ No hand-built replacements for components Nuxt UI already provides
✗ No marketing pills (rounded-full) on app chrome — 6px squares
✗ No hero gradients, mesh or otherwise — anywhere
✗ No second brand accent — ink is the only non-status color
✗ No hardcoded hex — always var(--color-*)
✗ No color on normal/healthy states — color means exception
✗ No collapsing refusal or dilute into "fail"
✗ No 64/96/128px spacing — marketing rhythm
✗ No tap target under 44px on any staff-facing control
✗ No removing focus outlines
✗ No resident names or screen results in URLs, logs, or analytics — see CLAUDE.md
```

---

## 10. Open items

1. **Geist licensing/hosting** — self-host via `@nuxt/fonts` rather than a third-party CDN. No
   requests carrying app URLs to outside hosts. (See CLAUDE.md compliance posture.)
2. **Census board layout** — grid vs. list on mobile. Needs the facility's real apartment and bed counts to decide.
3. **Print/export styling** — licensing audits and referral sources will want paper. Not designed
   yet.
4. **Resident-facing tone** — staff screens are dense and tool-like. Resident screens may need to
   be warmer and calmer. Decide when we build resident views.
5. **Dark mode** — deferred, see §7.
