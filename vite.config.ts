import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'

// Build id for the stale-bundle detector: Netlify's commit ref, else the git
// short SHA, else a timestamp. Computed once per config eval; both baked into
// the bundle (__BUILD_ID__) and written to public/version.json (which the copy
// step ships to dist/) so a long-lived tab can poll for a newer deploy.
const buildId =
  process.env.COMMIT_REF ||
  (() => {
    try {
      return execSync('git rev-parse --short HEAD').toString().trim()
    } catch {
      return String(Date.now())
    }
  })()

try {
  fs.mkdirSync(path.resolve(__dirname, 'public'), { recursive: true })
  fs.writeFileSync(
    path.resolve(__dirname, 'public/version.json'),
    JSON.stringify({ buildId }) + '\n',
  )
} catch {
  /* non-fatal — the detector just won't fire if version.json is missing */
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Split heavy libraries into separate chunks so the public marketing pages
    // load lighter and these chunks cache independently across deploys.
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['recharts'],
          'vendor-xlsx': ['xlsx'],
          'vendor-motion': ['framer-motion'],
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
})
