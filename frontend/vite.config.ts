import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const configuredBasePath = process.env.VITE_BASE_PATH?.trim() || '/'
const basePath = configuredBasePath.endsWith('/') ? configuredBasePath : `${configuredBasePath}/`

// https://vite.dev/config/
export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon-32.png', 'favicon-96.png', 'apple-touch-icon.png', 'pwa-192.png', 'pwa-512.png', 'maskable-512.png'],
      manifest: {
        name: 'Aeon',
        short_name: 'Aeon',
        description: 'Explore focused anime feeds, Fan Rank signals, powerful search, and personal title collections.',
        theme_color: '#11131a',
        background_color: '#08090d',
        display: 'standalone',
        orientation: 'portrait',
        scope: basePath,
        start_url: basePath,
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: `${basePath}index.html`,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.includes('img.anili.st') || url.hostname.includes('anilist.co'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'aeon-anime-covers',
              expiration: {
                maxEntries: 800,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
    }),
  ],
})
