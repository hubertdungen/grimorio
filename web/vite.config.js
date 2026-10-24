import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Em dev, /api e /data vão para o servidor Python (porta 8107).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { proxy: { '/api': 'http://127.0.0.1:8107', '/data': 'http://127.0.0.1:8107' } },
})
