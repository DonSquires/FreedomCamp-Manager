import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', '.bun', 'mobile-app', 'proxy-server', 'inference-service', 'supabase/functions', 'tests'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: [
      'src/components/features/BulkActionToolbar.tsx',
      'src/components/features/BulkOperationToolbar.tsx',
      'src/components/features/EmptyState.tsx',
      'src/components/features/HelpTooltip.tsx',
      'src/components/features/QuickActions.tsx',
      'src/components/features/ToastManager.tsx',
      'src/components/ui/badge.tsx',
      'src/components/ui/button.tsx',
      'src/components/ui/form.tsx',
      'src/components/ui/navigation-menu.tsx',
      'src/components/ui/sidebar.tsx',
      'src/components/ui/sonner.tsx',
      'src/components/ui/toggle.tsx',
    ],
    rules: {
      // These files intentionally co-locate small utility exports with component exports.
      'react-refresh/only-export-components': 'off',
    },
  },
)
