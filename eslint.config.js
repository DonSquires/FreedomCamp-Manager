import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist',
      '.bun',
      '.cache',
      '.npm-cache',
      '.home',
      'node_modules',
      'mobile-app',
      'proxy-server',
      'inference-service',
      'supabase/functions',
      'tests',
    ],
  },
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
      // Phase II-CI: Block calls to retired archive edge functions.
      // Add new archive names here whenever a function is moved to _archive.
      'no-restricted-syntax': [
        'error',
        // All three patterns below catch: callEdgeFunction('archived-name', ...)
        // where the first argument is a string literal matching a retired function.
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='recalculate-compliance']",
          message: "callEdgeFunction('recalculate-compliance') is retired. Use cleanup-and-recalculate with action:'compliance-recalc'.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='recalculate-compliance-v2']",
          message: "callEdgeFunction('recalculate-compliance-v2') is retired. Use cleanup-and-recalculate.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='recalculate-compliance-v3']",
          message: "callEdgeFunction('recalculate-compliance-v3') is retired. Use cleanup-and-recalculate.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='scan-breaches']",
          message: "callEdgeFunction('scan-breaches') is retired. Use cleanup-and-recalculate.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='duplicate-detection']",
          message: "callEdgeFunction('duplicate-detection') is retired. Use cleanup-and-recalculate with action:'detect-duplicates'.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='zone-correction']",
          message: "callEdgeFunction('zone-correction') is retired. Use cleanup-and-recalculate.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='correct-zone-assignments']",
          message: "callEdgeFunction('correct-zone-assignments') is retired. Use cleanup-and-recalculate.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='check-zone-corrections']",
          message: "callEdgeFunction('check-zone-corrections') is retired. Use cleanup-and-recalculate.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='check-almost-breaches']",
          message: "callEdgeFunction('check-almost-breaches') is retired. Use cleanup-and-recalculate.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='alpr-retry']",
          message: "callEdgeFunction('alpr-retry') is retired. Use process-officer-scan.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='stream-webhook']",
          message: "callEdgeFunction('stream-webhook') is retired. Use process-officer-scan.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='orc-ingest']",
          message: "callEdgeFunction('orc-ingest') is retired. Use process-officer-scan.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='plate-scanner-photo-first']",
          message: "callEdgeFunction('plate-scanner-photo-first') is retired. Use process-officer-scan.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='generate-leadership-pack']",
          message: "callEdgeFunction('generate-leadership-pack') is retired. Use send-report-email.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='generate-vehicle-report']",
          message: "callEdgeFunction('generate-vehicle-report') is retired. Use send-report-email.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='create_auth_and_profiles']",
          message: "callEdgeFunction('create_auth_and_profiles') is retired. Use create-user.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='set-user-password']",
          message: "callEdgeFunction('set-user-password') is retired. Use create-user or manage-user.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='update-user-password']",
          message: "callEdgeFunction('update-user-password') is retired. Use create-user or manage-user.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='send-invite-email']",
          message: "callEdgeFunction('send-invite-email') is retired. Invite email is sent by create-user.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='reingest-photos']",
          message: "callEdgeFunction('reingest-photos') is retired. Use process-officer-scan.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='suggest-new-zone']",
          message: "callEdgeFunction('suggest-new-zone') is retired. AI zone suggestion was removed.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='get-weather']",
          message: "callEdgeFunction('get-weather') is retired. Weather is non-core to enforcement.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='observations-export']",
          message: "callEdgeFunction('observations-export') is retired. Use send-report-email or direct DB query.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='observations-list']",
          message: "callEdgeFunction('observations-list') is retired. Query observations table directly.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='observations-in-bounds']",
          message: "callEdgeFunction('observations-in-bounds') is retired. Query observations table with spatial filter.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='check-data-integrity']",
          message: "callEdgeFunction('check-data-integrity') is retired. Use cleanup-and-recalculate with action:'integrity-check'.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='get-compliance-statistics']",
          message: "callEdgeFunction('get-compliance-statistics') is retired. Use cleanup-and-recalculate with action:'statistics'.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='update-compliance-policy']",
          message: "callEdgeFunction('update-compliance-policy') is retired. Update compliance settings via the admin UI/DB directly.",
        },
        {
          selector: "CallExpression[callee.name='callEdgeFunction'] > Literal[value='test-compliance-matrix']",
          message: "callEdgeFunction('test-compliance-matrix') is retired.",
        },
      ],
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
