// Nuxt only loads `app.config.ts` from inside srcDir (`app/`). A `.js` file, or
// a `.ts` file at the project root, is silently ignored — Nuxt UI then falls
// back to its defaults (primary: green, neutral: slate) with no warning.
export default defineAppConfig({
  ui: {
    colors: {
      neutral: 'geist', // our grey ladder — see the note in main.css on the name
      success: 'green',
      warning: 'amber',
      error: 'red',
      info: 'blue',
      // primary is NOT set here — see --ui-primary in assets/css/main.css
      // secondary is unused — we have no second accent
    },

    // ── 44px minimum tap targets ──────────────────────────────────────────
    // design.md §6. Nuxt UI's largest built-in size is 40px, under the floor
    // for a tech tapping one-handed in a hallway. Every control the staff app
    // renders therefore gets a 44px floor (min-h-11) regardless of `size`.
    input: { slots: { base: 'min-h-11' } },

    // `[-webkit-font-smoothing:auto]` is not a nicety. Our base layer sets
    // `antialiased`, which thins glyphs — on a near-black fill that makes pure
    // white text read grey. Subpixel smoothing restores the weight so #fff
    // actually looks like #fff, without pushing buttons off design.md's
    // weight-500 spec.
    button: { slots: { base: 'min-h-11 justify-center [-webkit-font-smoothing:auto]' } },
    select: { slots: { base: 'min-h-11' } },
    textarea: { slots: { base: 'min-h-11' } },
    // Nav links are tapped too — the 44px floor is not just for form controls.
    //
    // `items-center` is not optional here. Raising a row's min-height without it
    // leaves the label and icon pinned to the top of the taller box, which reads
    // as a misalignment rather than as generous spacing.
    navigationMenu: { slots: { link: 'min-h-11 items-center' } },
    dropdownMenu: { slots: { item: 'min-h-11 items-center' } },
    checkbox: { slots: { base: 'size-5' } },
    radio: { slots: { base: 'size-5' } },
  },
})
