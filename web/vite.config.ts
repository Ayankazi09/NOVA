import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const backend = process.env.NOVA_BACKEND ?? 'http://127.0.0.1:8010'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    proxy: { '/api': { target: backend, changeOrigin: true } },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
