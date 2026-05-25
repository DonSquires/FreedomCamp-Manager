import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'
import { routeManifest } from './src/navigation/routeManifest'
import { validateRouteManifest } from './src/navigation/routeManifestValidator'

const manifestValidation = validateRouteManifest(routeManifest)
if (!manifestValidation.valid) {
  throw new Error(`Route manifest preflight failed:\n${manifestValidation.errors.join('\n')}`)
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Raise the warning threshold slightly for large pages (maps, charts).
    // Pages are already split by React.lazy so per-chunk sizes are acceptable.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {},
    },
  },
})
