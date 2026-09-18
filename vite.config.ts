import { delimiter } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { runCatalogPlugin } from './scripts/run-catalog'
import { progressPlugin } from './scripts/progress'

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')
  const roots = (environment.FLOW_RUN_ROOTS ?? '')
    .split(delimiter)
    .map((root) => root.trim())
    .filter(Boolean)

  return {
    server: { host: '127.0.0.1', cors: false },
    plugins: [react(), progressPlugin(environment.FLOW_PROGRESS_RUN ?? ''), runCatalogPlugin(roots)],
  }
})
