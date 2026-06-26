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
})
