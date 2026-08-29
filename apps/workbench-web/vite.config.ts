import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const apiTarget = process.env.CODYWORK_DEV_API_TARGET ?? 'http://127.0.0.1:3210'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 3211,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
