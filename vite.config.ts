import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: [
          'favicon.ico',
          'favicon-16x16.png',
          'favicon-32x32.png',
          'apple-touch-icon.png',
          'apple-touch-icon-180x180.png',
          'icon-48x48.png',
          'icon-72x72.png',
          'icon-96x96.png',
          'icon-144x144.png',
          'icon-192x192.png',
          'icon-384x384.png',
          'icon-512x512.png',
          'icon-maskable-192x192.png',
          'icon-maskable-512x512.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-192x192.png',
          'pwa-maskable-512x512.png',
          'images/kelid-logo-1x.webp',
          'images/kelid-logo-2x.webp',
          'images/kelid-logo-1x.png',
          'images/kelid-logo-2x.png',
          'images/kelid-badge-circle.png',
          'images/kelid-logo.jpg',
        ],
        manifest: {
          id: './',
          name: 'کلید',
          short_name: 'کلید',
          description: 'سامانه جامع CRM، بایگانی املاک لوکس، تطبیق هوشمند متقاضیان، شبکه همکاران و دستیار صوتی مشاورین املاک شمال کشور',
          dir: 'rtl',
          lang: 'fa',
          theme_color: '#050C18',
          background_color: '#050C18',
          display: 'standalone',
          orientation: 'portrait',
          start_url: './',
          scope: './',
          icons: [
            {
              src: 'icon-48x48.png',
              sizes: '48x48',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icon-72x72.png',
              sizes: '72x72',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icon-96x96.png',
              sizes: '96x96',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icon-144x144.png',
              sizes: '144x144',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icon-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icon-384x384.png',
              sizes: '384x384',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icon-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icon-maskable-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: 'icon-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,webp,woff,woff2}'],
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: false,
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
