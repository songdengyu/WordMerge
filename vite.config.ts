import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Native file notifications missed an input-module edit on this Windows workspace,
  // leaving the live server with incompatible old input and new camera code.
  server: { watch: { usePolling: process.platform === 'win32', interval: 300 } },
})
