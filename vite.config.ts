import { delimiter } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { runCatalogPlugin } from './scripts/run-catalog'

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')
  const roots = (environment.FLOW_RUN_ROOTS ?? '')
    .split(delimiter)
    .map((root) => root.trim())
    .filter(Boolean)

  return {
    plugins: [react(), runCatalogPlugin(roots)],
  }
})
