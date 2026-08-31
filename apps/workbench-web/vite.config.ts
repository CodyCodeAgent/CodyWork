import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execFileSync } from 'node:child_process'

const apiTarget = process.env.CODYWORK_DEV_API_TARGET ?? 'http://127.0.0.1:3210'
const buildRevision = (() => {
  if (process.env.CODYWORK_BUILD_REVISION) return process.env.CODYWORK_BUILD_REVISION
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'source'
  }
})()

export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-${buildRevision}.js`,
        chunkFileNames: `assets/[name]-[hash]-${buildRevision}.js`,
        assetFileNames: `assets/[name]-[hash]-${buildRevision}[extname]`,
      },
    },
  },
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
