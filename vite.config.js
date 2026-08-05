import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest (not the default generateSW) because the hunter
      // live-tracking SOS feature needs a custom `push` / `notificationclick`
      // handler in the service worker — generateSW gives no hook for that.
      // See src/sw.js.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        // keep the precache list small — this app is mostly server-rendered
        // data, not an offline-first app; we're not building offline
        // navigation support (out of scope, see the tracking-PWA plan)
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
      // A hunter may be mid-session with GPS actively streaming when a new
      // version deploys — force-reloading the tab to install an update
      // would be actively harmful. 'prompt' surfaces a dismissible "update
      // available" toast (via the virtual:pwa-register/react hook) instead
      // of auto-reloading.
      registerType: 'prompt',
      // We register the SW ourselves via the virtual:pwa-register/react
      // hook (so we can show a dismissible update-available toast instead
      // of a raw script tag doing it silently) — turn off the auto-injected
      // registration script to avoid double-registering.
      injectRegister: false,
      devOptions: {
        enabled: true,
        type: 'module',
      },
      manifest: {
        name: 'The Muster',
        short_name: 'Muster',
        description: 'Connecting Victorian farmers with licensed hunters for pest control.',
        theme_color: '#37452F',
        background_color: '#F6F3EC',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          // maskable: Android adapts this to whatever shape the device's
          // icon grid uses (circle, squircle, etc.) instead of clipping a
          // regular icon unpredictably.
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          // SVG fallback — apple-touch-icon (index.html) covers iOS separately.
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
})
