import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [preact()],
  server: { proxy: { '/api': { target: process.env.RAMIFY_API ?? 'http://127.0.0.1:5190', changeOrigin: false } } },
})
