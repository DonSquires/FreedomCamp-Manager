import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { routeManifest } from './src/navigation/routeManifest'
import { validateRouteManifest } from './src/navigation/routeManifestValidator'

const manifestValidation = validateRouteManifest(routeManifest)
if (!manifestValidation.valid) {
  throw new Error(`Route manifest preflight failed:\n${manifestValidation.errors.join('\n')}`)
}

function resolveSupabaseEnv(mode: string) {
  const env = loadEnv(mode, process.cwd(), '')
  const allowLegacyFallback = ['1', 'true', 'yes', 'on'].includes(
    (env.VITE_ALLOW_LEGACY_SUPABASE_ENV_FALLBACK || '').toLowerCase()
  )

  return {
    supabaseUrl: env.VITE_SUPABASE_URL || (allowLegacyFallback ? env.SUPABASE_URL || '' : ''),
    supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY || (allowLegacyFallback ? env.SUPABASE_ANON_KEY || '' : ''),
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const { supabaseUrl, supabaseAnonKey } = resolveSupabaseEnv(mode)

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
    },
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
        output: {
          // Split heavy vendor libraries into named chunks so browsers can
          // cache them independently and only re-download what actually changed.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined

            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router-dom/')) {
              return 'vendor-react'
            }

            if (id.includes('/@supabase/supabase-js/')) {
              return 'vendor-supabase'
            }

            if (id.includes('/@tanstack/react-query/')) {
              return 'vendor-query'
            }

            if (id.includes('/leaflet/') || id.includes('/react-leaflet/') || id.includes('/react-leaflet-cluster/')) {
              return 'vendor-maps'
            }

            if (id.includes('/recharts/')) {
              return 'vendor-charts'
            }

            if (id.includes('/react-hook-form/') || id.includes('/@hookform/resolvers/') || id.includes('/zod/')) {
              return 'vendor-forms'
            }

            if (id.includes('/@radix-ui/')) {
              return 'vendor-radix'
            }

            if (
              id.includes('/date-fns/') ||
              id.includes('/date-fns-tz/') ||
              id.includes('/clsx/') ||
              id.includes('/tailwind-merge/') ||
              id.includes('/class-variance-authority/')
            ) {
              return 'vendor-utils'
            }

            if (id.includes('/read-excel-file/') || id.includes('/write-excel-file/') || id.includes('/jszip/')) {
              return 'vendor-spreadsheet'
            }

            return undefined
          },
        },
      },
    },
  }
})
