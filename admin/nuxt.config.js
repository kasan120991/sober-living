import tailwindcss from '@tailwindcss/vite'

// Plain JavaScript, not TypeScript — see CLAUDE.md. The vendored shadcn-vue
// components under app/components/ui are the one exception: their sidebar does
// not survive the CLI's TS→JS conversion, and they are library code we own
// rather than code we write.
export default defineNuxtConfig({
  compatibilityDate: '2026-08-01',
  devtools: { enabled: true },

  modules: ['@nuxt/fonts', '@nuxtjs/color-mode'],

  // ORDER IS LOAD-BEARING, all four of them.
  //
  // FullCalendar 7 ships its themes as real stylesheets (v6 injected them from
  // JS), so pulse arrives here rather than as a side effect of an import. Our
  // palette must come AFTER theme.css to win, and fullcalendar.css stays a
  // separate file because `shadcn-vue add` rewrites main.css wholesale — see
  // CLAUDE.md. Both FullCalendar sheets are unlayered, which is what keeps them
  // ahead of Tailwind's layered rules.
  css: [
    '~/assets/css/main.css',
    '@fullcalendar/vue3/skeleton.css',
    '@fullcalendar/vue3/themes/pulse/theme.css',
    '~/assets/css/fullcalendar.css',
  ],

  vite: {
    plugins: [tailwindcss()],
  },

  // Vendored shadcn components are re-exported from an index per folder. Point
  // Nuxt at the folder with no prefix so <Button /> resolves, matching how
  // shadcn-vue is written upstream.
  components: [
    // `extensions: ['vue']` matters: each shadcn folder has an index.ts barrel,
    // and without this Nuxt registers the barrel as a component too — giving
    // two files resolving to the same name for every one of them.
    { path: '~/components/ui', pathPrefix: false, extensions: ['vue'], priority: 10 },
    { path: '~/components', pathPrefix: false, ignore: ['**/ui/**'] },
  ],

  // Self-hosted, so no request carrying our URLs reaches a font CDN. Families
  // match what the preset asked for: Inter for body, Geist for headings.
  fonts: {
    families: [
      { name: 'Inter', provider: 'google' },
      { name: 'Geist', provider: 'google' },
    ],
  },

  // SSR off: data comes from the Express API, and rendering resident data on a
  // Nuxt server would put PHI through a second process for no benefit.
  ssr: false,

  // Both themes now. `class` mode is what shadcn's `dark:` variant keys off.
  colorMode: { classSuffix: '' },

  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || 'http://localhost:3001',
    },
  },

  devServer: { port: 3000 },
})
