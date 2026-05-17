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
      output: {
        // Split heavy vendor libraries into named chunks so browsers can
        // cache them independently and only re-download what actually changed.
        manualChunks: {
          // React core — almost never changes
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Supabase client
          'vendor-supabase': ['@supabase/supabase-js'],
          // TanStack Query
          'vendor-query': ['@tanstack/react-query'],
          // Mapping libraries (leaflet is large)
          'vendor-maps': ['leaflet', 'react-leaflet', 'react-leaflet-cluster'],
          // Charts
          'vendor-charts': ['recharts'],
          // Form / validation
          'vendor-forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
          // Radix UI primitives (combined to avoid hundreds of tiny chunks)
          'vendor-radix': [
            '@radix-ui/react-accordion',
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-avatar',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-collapsible',
            '@radix-ui/react-context-menu',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-hover-card',
            '@radix-ui/react-label',
            '@radix-ui/react-menubar',
            '@radix-ui/react-navigation-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-progress',
            '@radix-ui/react-radio-group',
            '@radix-ui/react-scroll-area',
            '@radix-ui/react-select',
            '@radix-ui/react-separator',
            '@radix-ui/react-slider',
            '@radix-ui/react-slot',
            '@radix-ui/react-switch',
            '@radix-ui/react-tabs',
            '@radix-ui/react-toast',
            '@radix-ui/react-toggle',
            '@radix-ui/react-toggle-group',
            '@radix-ui/react-tooltip',
          ],
          // Misc utilities
          'vendor-utils': ['date-fns', 'date-fns-tz', 'clsx', 'tailwind-merge', 'class-variance-authority'],
          // Spreadsheet export (large — only loaded on data-export routes)
          'vendor-xlsx': ['xlsx'],
        },
      },
    },
  },
})
