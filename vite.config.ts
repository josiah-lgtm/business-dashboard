import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// Standard Vite build → dist/ (hashed JS/CSS assets).
export default defineConfig({
  // Served at the root of the domain (https://businessdashboard.agencyadvanta.com/).
  // If you ever host it under a sub-path instead, change this to e.g. '/dashboard/'.
  base: '/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
  // Dev only: proxy /api to the running `web` container (which injects the API
  // token and forwards to the api). This keeps `npm run dev` same-origin, so no
  // VITE_API_TOKEN is needed locally. Adjust the port to your WEB_PORT.
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:54331',
        changeOrigin: true,
      },
    },
  },
})
