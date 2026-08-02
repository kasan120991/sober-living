# SoberLife — Design System

**Stack:** Nuxt 4 · shadcn-vue · Tailwind CSS v4 · plain JavaScript
**Theme:** the `a6OmWiie` preset owns colour, typography and component look.
**Applies to:** `admin/`, and `client/` when it exists.

Read this before writing any component, page, or CSS.

---

## 1. The preset owns the look

```
npx shadcn-vue@latest init --preset a6OmWiie --template nuxt
```

| | |
|---|---|
| Style | `reka-luma` |
| Primary | teal — `oklch(0.511 0.096 186.391)` |
| Base colour | neutral |
| Body font | Inter |
| Heading font | Geist Sans (`font-heading`) |
| Icons | Lucide, via `@lucide/vue` |
| Themes | light **and** dark |

Components are **vendored** into `admin/app/components/ui/`. We own them — restyling means
editing the component, not fighting it from the call site. That is the whole point of the
copy-in model and it replaces the `app.config.ts` slot overrides Nuxt UI needed.

Use `bg-card`, `text-muted-foreground`, `border`, `text-destructive` and the rest of the
preset's semantic classes. **Do not reintroduce hand-rolled colour tokens.**

### Two things we changed, and why

**Fonts are self-hosted.** The preset shipped `@import url('https://fonts.googleapis.com/…')`,
which sends a request carrying this app's URL to a third party on every page load. CLAUDE.md
is explicit that nothing about this app goes to an outside service. `@nuxt/fonts` downloads
the same families at build time and serves them from our origin.

**`--success` and `--warning` were added.** shadcn ships `destructive` and nothing else,
which is not enough for this domain — see §2. They are written in the preset's oklch idiom,
in both themes, with the dark values lifted and desaturated so they hold on a dark ground.

---

## 2. Status colour

The preset owns colour, with one domain constraint layered on top: **certain states must
stay visually distinct from each other**, because conflating them loses information a record
may later need to defend.

| Domain | Must be distinguishable |
|---|---|
| Drug screen | negative · positive · **refusal** · **dilute** — CLAUDE.md forbids collapsing refusal or dilute into "fail" |
| Med log | given · refused · missed · held — four outcomes, not two |
| Bed | occupied · available · out of service |
| Maintenance | urgent vs everything else |

Current mapping: `success` for a good outcome, `warning` for out-of-service and refusals,
`destructive` for a positive screen or a missed medication, plain/muted for the ordinary
case.

**Overdue residents are the loudest thing in the app** once sign-outs land. Nothing else
competes with an unreturned resident.

> **Dropped deliberately.** The previous system had a rule that *the normal state gets no
> colour* — occupied beds and negative screens stayed achromatic so exceptions stood out.
> The preset owns status colour now, so that rule is gone. If the census board later reads
> as noise, this is the thing to reinstate.

---

## 3. Tap targets — 44px minimum

Non-negotiable for anything a tech touches in a hallway. shadcn defaults to 36px, so the
floor is baked into the vendored source:

| Component | Change |
|---|---|
| `button/index.ts` | `default` `h-11`, `sm` `h-11`, `lg` `h-12`, `icon`/`icon-sm` `size-11` |
| `input/Input.vue` | `h-11` |
| `select/SelectTrigger.vue` | `h-11` both sizes |
| `switch/Switch.vue` | `after:-inset-y-3` — a 20px track with a 44px hit area |

`sm` is not shorter than `default`. It has tighter padding and smaller type; the floor is
about the finger, not the label.

Note the Switch: its tap area comes from an `::after` pseudo-element, so
`getBoundingClientRect()` **under-reports it**. Any assertion has to add the pseudo-element
inset or it will report a false failure.

---

## 4. Density and type

- Base unit 4px; app scale 4 · 8 · 12 · 16 · 24 · 32. No 64/96/128 — that is marketing rhythm.
- Table rows 48px, cells `px-3`.
- **There is no monospace in this app.** Not on labels, not on bed labels, dates, IDs or
  phone numbers. `font-mono` appears nowhere outside the vendored `ui/` folder, and adding
  it back is a deliberate decision, not a default.
  Two things made it worth removing rather than merely restricting. It resolved to the
  system monospace stack, which is a different typeface on a manager's Mac than on a tech's
  Android — so a screen that was tuned in one place was never quite right in the other.
  And it cost roughly a point of size to sit beside Inter without looking oversized, which
  is how the fact grid on a resident's record ended up with dates a point smaller than the
  facts next to them.
- **Column alignment comes from `tabular-nums`, which is what was actually wanted.**
  Inter's tabular figures are fixed-width, so a column of dates still scans as a column.
  Use it on dates, times, counts, currency and anything else read down a column. It is the
  whole benefit mono was carrying, without the typeface change.
- One family for text, then: Inter, with Geist Sans (`font-heading`) for headings.
  Emphasis inside a sentence — a bed label, a generated name — is `font-medium`.
- `font-heading` (Geist) for page and section headings; Inter everywhere else.
- Wide tables scroll inside their own `overflow-x-auto` container — the page never scrolls
  sideways.

---

## 5. Component rules

- **Prefer the vendored components.** Add new ones with `shadcn-vue add`, do not hand-roll.
- **Forms use `AppField`**, not shadcn's `Form`. That one is vee-validate based, and this
  app validates server-side with zod — adding a second validation stack to get a label is
  the wrong trade. `AppField` supplies label, description, error and a generated id.
- **Toasts go through `useNotify()`**, not `toast` from vue-sonner directly, so swapping
  the library again is one edit.
- **Icons are imported**, not named: `import { Plus } from '@lucide/vue'`.
- Destructive and corrective actions confirm, and amendments capture a reason — see CLAUDE.md.

### Four things that will trip you up

1. **`components.json` has `typescript: true`, but the app is JavaScript.** The vendored
   `ui/` folder is TS because shadcn's sidebar does not survive the CLI's TS→JS conversion.
   Our own code stays JS. Do not "fix" this by regenerating in JS — the sidebar will break.
2. **Composables exported from a component barrel are not auto-imported.** `useSidebar` has
   to be imported from `~/components/ui/sidebar` explicitly; Nuxt only scans `composables/`
   and `utils/`.
3. **`components:` in `nuxt.config.js` needs `extensions: ['vue']`** on the `ui` folder.
   Each shadcn folder has an `index.ts` barrel, and without this Nuxt registers the barrel
   as a component too — two files resolving to the same name, for every component.
4. **Reka's `Select` rejects an empty-string item value.** It reserves `''` for "selection
   cleared". Use a sentinel like `'all'` and map it to `undefined` at the query boundary.
