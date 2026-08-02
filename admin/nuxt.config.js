// Plain JavaScript, not TypeScript — see CLAUDE.md.
export default defineNuxtConfig({
  compatibilityDate: '2026-08-01',
  devtools: { enabled: true },

  modules: ['@nuxt/ui', '@nuxt/fonts'],

  css: ['~/assets/css/main.css'],

  // Light only, per design.md §7 — a light canvas is correct for a phone held
  // in a bright hallway. Without pinning this, @nuxtjs/color-mode follows the
  // OS preference and Nuxt UI renders its dark tokens (dark borders, dark
  // surfaces) on top of our hardcoded light background.
  colorMode: { preference: 'light', fallback: 'light' },

  // SSR off: data comes from the Express API, and rendering resident data on a
  // Nuxt server would put PHI through a second process for no benefit.
  ssr: false,

  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || 'http://localhost:3001',
    },
  },

  // Self-hosted, so no request carrying our URLs reaches a font CDN.
  fonts: {
    families: [
      { name: 'Geist', provider: 'google' },
      { name: 'Geist Mono', provider: 'google' },
    ],
  },

  devServer: { port: 3000 },
})
