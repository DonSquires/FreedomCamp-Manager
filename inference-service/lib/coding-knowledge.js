/**
 * Coding Knowledge Module
 *
 * Trains Bob with the same contextual coding knowledge that the Copilot coding
 * agent (Claude Opus 4.5) uses when working on FieldOps Manager. Enables Bob
 * to assist with coding tasks — creating pages, hooks, Edge Functions, migrations,
 * components, and stores — without routing questions to GitHub.
 *
 * Source of truth: the same custom_instruction context that Claude Opus 4.5
 * receives plus real code patterns extracted from the codebase.
 *
 * Covers:
 *   Tech Stack        - React 18, TypeScript, Vite, Tailwind, shadcn/ui, Supabase, Railway
 *   Project Layout    - Directory structure, file placement, naming conventions
 *   Build / Dev       - bun run dev/build/lint, supabase CLI, EAS, env vars
 *   Code Patterns     - Pages, hooks, mutations, Edge Functions, SQL migrations, stores
 *   Conventions       - TypeScript config, timezone, roles, path alias, CORS
 */

// ---------------------------------------------------------------------------
// TECH STACK
// ---------------------------------------------------------------------------

const TECH_STACK = {
  frontend: {
    framework: 'React 18',
    language: 'TypeScript',
    bundler: 'Vite',
    styling: 'Tailwind CSS v3',
    components: 'shadcn/ui (Radix UI)',
    state: 'Zustand (src/stores/) + TanStack Query v5',
    forms: 'react-hook-form + zod',
    charts: 'recharts',
    routing: 'react-router-dom v6',
    package_manager: 'bun (bun.lock at root)',
  },
  backend: {
    platform: 'Supabase',
    database: 'PostgreSQL 17',
    functions: 'Supabase Edge Functions (Deno TypeScript)',
    auth: 'Supabase Auth (GoTrue)',
    storage: 'Supabase Storage',
    realtime: 'Supabase Realtime',
  },
  services: {
    inference: 'inference-service/ — Node/Express + ONNX AI (Bob)',
    proxy: 'proxy-server/ — Node/Express (NZSCV plate lookup)',
    ptt: 'ptt-server/ — Node/Express + ws (WebSocket voice)',
    ollama: 'ollama/ — Local LLM on Railway',
  },
  hosting: {
    frontend: 'Vercel (fcmanager.co.nz)',
    microservices: 'RunPod (Bob+Ollama), Railway (Proxy), VPS 72.61.123.97 (PTT+TURN)',
    mobile: 'Expo EAS (React Native)',
  },
  path_alias: '@/* → ./src/*  (defined in tsconfig.json and vite.config.ts)',
};

// ---------------------------------------------------------------------------
// PROJECT LAYOUT
// ---------------------------------------------------------------------------

const PROJECT_LAYOUT = {
  root: {
    'src/': 'Main React application source',
    'src/App.tsx': 'Main router — Login → PortalSelection → Field/Admin portals',
    'src/main.tsx': 'Vite entry point',
    'src/pages/': '80+ page components (AdminPortal, FieldOfficerPortal, …)',
    'src/components/ui/': 'shadcn/ui primitives — Button, Dialog, Form, Table, Card, …',
    'src/components/features/': 'App-specific feature components (PTTBar, …)',
    'src/components/layout/': 'Navigation, sidebar, containers',
    'src/hooks/': 'Custom React hooks — useVehicles, usePatrols, useCompliance, …',
    'src/stores/': 'Zustand stores — authStore.ts, globalFiltersStore.ts',
    'src/lib/': 'Utilities — supabase.ts client, fileUpload.ts, geocoding.ts, …',
    'src/types/': 'database.ts (generated Supabase types), index.ts',
    'supabase/': 'Supabase backend',
    'supabase/functions/': '47 Edge Functions in <name>/index.ts (Deno TypeScript)',
    'supabase/functions/_shared/': 'Shared utilities — withCors.ts, compliance.ts, alpr.ts, orgConfig.ts',
    'supabase/migrations/': '70+ SQL migration files (YYYYMMDD_* prefix)',
    'supabase/templates/': 'Auth email templates — invite, recovery, confirmation, magic_link',
    'inference-service/': 'Bob AI service (Node/Express, ONNX, Ollama)',
    'proxy-server/': 'NZSCV proxy (Node/Express)',
    'ptt-server/': 'Push-to-Talk WebSocket server',
    'mobile-app/': 'React Native Expo app',
    '.github/workflows/': '25 GitHub Actions workflows',
    'index.html': 'Vite HTML entry',
    'tailwind.config.ts': 'Tailwind configuration',
    'tsconfig.json': 'References tsconfig.app.json + tsconfig.node.json',
    'bun.lock': 'Bun lockfile — must be committed (Railway uses --frozen-lockfile)',
    'vercel.json': 'Vercel config — SPA rewrites, security headers',
  },
};

// ---------------------------------------------------------------------------
// BUILD AND DEV COMMANDS
// ---------------------------------------------------------------------------

const BUILD_COMMANDS = {
  install: 'bun install',
  dev: 'bun run dev                   # http://localhost:5173',
  build: 'bun run build               # TypeScript check + Vite build → dist/',
  lint: 'bun run lint                 # ESLint 9 flat config',
  preview: 'bun run preview           # Preview production build',
  supabase_types: 'supabase gen types typescript --project-ref kxwjcupuxnnbnzcgmkoi > src/types/database.ts',
  supabase_db_push: 'supabase db push --project-ref kxwjcupuxnnbnzcgmkoi',
  supabase_deploy_fn: 'supabase functions deploy <name> --project-ref kxwjcupuxnnbnzcgmkoi',
  sub_services: {
    proxy: 'cd proxy-server && npm install && npm run dev',
    inference: 'cd inference-service && npm install && node server.js',
  },
  env: {
    required: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    note: 'Copy .env and set both vars. All client env vars must be prefixed VITE_.',
  },
  lockfile_note: 'bun.lock must be regenerated (bun install) and committed whenever package.json changes. Railway runs bun install --frozen-lockfile and fails if out of sync.',
};

// ---------------------------------------------------------------------------
// KEY PATTERNS — with code templates
// ---------------------------------------------------------------------------

const CODE_PATTERNS = {

  // -------------------------------------------------------------------------
  // Supabase client
  // -------------------------------------------------------------------------
  supabase_client: {
    summary: 'Always import the typed Supabase client from @/lib/supabase.',
    template: `import { supabase } from '@/lib/supabase'`,
    notes: [
      'The client is typed with Database from @/types/database.',
      'createClient<Database>(url, anonKey, { global: { headers: { "X-Client-Timezone": "Pacific/Auckland" } } })',
      'Uses sessionStorage (not localStorage) for auth persistence.',
      'Anon key respects RLS (use for frontend). Service role bypasses RLS (use in Edge Functions only).',
    ],
  },

  // -------------------------------------------------------------------------
  // Database types
  // -------------------------------------------------------------------------
  database_types: {
    summary: 'Use generated Database types from @/types/database.ts for row types.',
    template: `import type { Database } from '@/types/database'

type Vehicle = Database['public']['Tables']['vehicles']['Row']
type VehicleInsert = Database['public']['Tables']['vehicles']['Insert']
type VehicleUpdate = Database['public']['Tables']['vehicles']['Update']`,
    notes: [
      'Types generated by: supabase gen types typescript → src/types/database.ts',
      'After adding a migration, regenerate types to stay in sync.',
      'Also import named types from @/types (index.ts) for domain types like BreachAlert, Severity.',
    ],
  },

  // -------------------------------------------------------------------------
  // React hook (useQuery + useMutation)
  // -------------------------------------------------------------------------
  hook: {
    summary: 'Custom hooks in src/hooks/useXxx.ts use TanStack Query for data fetching.',
    template: `import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { Database } from '@/types/database'

type Row = Database['public']['Tables']['my_table']['Row']

interface UseMyTableOptions {
  organizationId?: string | null
}

export function useMyTable({ organizationId }: UseMyTableOptions = {}) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['my_table', organizationId],
    queryFn: async () => {
      let q = supabase.from('my_table').select('*').order('created_at', { ascending: false })
      if (organizationId) q = q.eq('organization_id', organizationId)
      const { data, error } = await q
      if (error) throw error
      return data as Row[]
    },
    enabled: !!organizationId,
  })

  const create = useMutation({
    mutationFn: async (values: Partial<Row>) => {
      const { data, error } = await supabase.from('my_table').insert(values).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my_table'] })
      toast.success('Created successfully')
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  return { ...query, create }
}`,
    notes: [
      'queryKey must include all variables that affect the query (org id, filters).',
      'invalidateQueries after mutations to keep cache fresh.',
      'Use toast from sonner for success/error notifications.',
      'Never call useQuery inside a conditional — always at the top level of the hook.',
    ],
  },

  // -------------------------------------------------------------------------
  // Page component
  // -------------------------------------------------------------------------
  page: {
    summary: 'Page components live in src/pages/. Use shadcn/ui primitives, never re-implement them.',
    template: `import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useMyTable } from '@/hooks/useMyTable'
import { useAuthStore } from '@/stores/authStore'

export default function MyPage() {
  const { user } = useAuthStore()
  const [search, setSearch] = useState('')

  const { data: rows = [], isLoading, create } = useMyTable({
    organizationId: user?.organization_id,
  })

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">My Page</h1>
      <Card>
        <CardHeader>
          <CardTitle>Records</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {isLoading && <p>Loading…</p>}
          {rows.map((row) => (
            <div key={row.id}>{String(row.name ?? '')}</div>
          ))}
        </CardContent>
      </Card>
      <Button onClick={() => create.mutate({ name: 'New', organization_id: user?.organization_id })}>
        Add
      </Button>
    </div>
  )
}`,
    notes: [
      'Import shadcn/ui from @/components/ui/button, @/components/ui/card, etc.',
      'Never re-implement shadcn/ui primitives — always use from src/components/ui/.',
      'Get the current user from useAuthStore() for organization_id scoping.',
      'Feature-specific sub-components go in src/components/features/.',
    ],
  },

  // -------------------------------------------------------------------------
  // Route registration in App.tsx
  // -------------------------------------------------------------------------
  route: {
    summary: 'Routes are registered in src/App.tsx using react-router-dom v6 with role guards.',
    template: `// Inside the router in App.tsx — add alongside similar routes:
<Route
  path="/my-page"
  element={
    <RoleRoute roles={['admin', 'admin_officer', 'master']}>
      <MyPage />
    </RoleRoute>
  }
/>

// For officer-only routes:
<Route
  path="/my-officer-page"
  element={
    <RoleRoute roles={['officer', 'admin_officer']}>
      <MyOfficerPage />
    </RoleRoute>
  }
/>`,
    notes: [
      'Four roles: admin, master, officer, admin_officer.',
      'RoleRoute enforces role. ProtectedRoute enforces auth (any logged-in user). AreaRoute enforces portal area.',
      'Import the new page at the top of App.tsx.',
      'Also add the route to stack-navigation.js ROUTE_MAP for Bob to know about it.',
    ],
  },

  // -------------------------------------------------------------------------
  // Zustand store
  // -------------------------------------------------------------------------
  store: {
    summary: 'Zustand stores live in src/stores/. Use persist middleware for durable state.',
    template: `import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

interface MyStoreState {
  value: string
  setValue: (v: string) => void
  reset: () => void
}

export const useMyStore = create<MyStoreState>()(
  persist(
    (set) => ({
      value: '',
      setValue: (v) => set({ value: v }),
      reset: () => set({ value: '' }),
    }),
    {
      name: 'my-store',
      storage: createJSONStorage(() => sessionStorage),
    }
  )
)`,
    notes: [
      'authStore.ts and globalFiltersStore.ts are the main existing stores.',
      'Use sessionStorage (not localStorage) for security-sensitive state.',
      'Keep stores small — put data fetching logic in hooks, not stores.',
    ],
  },

  // -------------------------------------------------------------------------
  // Supabase Edge Function
  // -------------------------------------------------------------------------
  edge_function: {
    summary: 'Edge Functions in supabase/functions/<name>/index.ts. Deno TypeScript. Use withCors from _shared/withCors.ts.',
    template: `import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts'

Deno.serve(async (req) => {
  // Always handle OPTIONS preflight first
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  try {
    // Validate auth
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) {
      return errorResponse('Missing Authorization header', req, 401)
    }

    // Admin client (bypasses RLS) — use only for admin operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // User client (respects RLS) — validate caller identity
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user?.id) {
      return errorResponse('Invalid or expired session', req, 401)
    }

    // Parse body
    const body = await req.json()
    const { someParam } = body

    if (!someParam) {
      return errorResponse('someParam is required', req, 400)
    }

    // Database operation
    const { data, error } = await supabaseAdmin
      .from('my_table')
      .insert({ some_column: someParam, organization_id: user.user_metadata?.organization_id })
      .select()
      .single()

    if (error) throw error

    return jsonResponse({ success: true, data }, req)

  } catch (err: any) {
    return errorResponse(err.message ?? 'Internal error', req)
  }
})`,
    notes: [
      'Always import from ../_shared/withCors.ts — provides withCors, jsonResponse, errorResponse, getCorsHeaders.',
      'Always handle OPTIONS preflight (return 200 with corsHeaders).',
      'SUPABASE_SERVICE_ROLE_KEY bypasses RLS — use only for privileged operations.',
      'Use user client to validate the caller before trusting them.',
      'Deploy: supabase functions deploy <name> --project-ref kxwjcupuxnnbnzcgmkoi',
      'Set secrets: supabase secrets set KEY=value --project-ref kxwjcupuxnnbnzcgmkoi',
    ],
  },

  // -------------------------------------------------------------------------
  // SQL migration
  // -------------------------------------------------------------------------
  migration: {
    summary: 'Migrations in supabase/migrations/ with YYYYMMDD_HHMMSS_description.sql prefix.',
    template: `-- supabase/migrations/20260414120000_add_my_table.sql

-- Create table with standard org-scoped pattern
create table if not exists public.my_table (
  id          uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  description text,
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Indexes for common query patterns
create index if not exists my_table_organization_id_idx on public.my_table(organization_id);
create index if not exists my_table_created_at_idx on public.my_table(created_at desc);

-- Enable RLS (required on every table)
alter table public.my_table enable row level security;

-- RLS: users see only their org's rows
create policy "my_table_org_select"
  on public.my_table for select
  using (
    organization_id = (
      select organization_id from public.user_profiles where id = auth.uid()
    )
  );

-- RLS: only admin/admin_officer/master can insert
create policy "my_table_admin_insert"
  on public.my_table for insert
  with check (
    exists (
      select 1 from public.user_profiles
      where id = auth.uid()
        and role in ('admin', 'admin_officer', 'master')
        and organization_id = my_table.organization_id
    )
  );

-- Auto-update updated_at
create trigger my_table_updated_at
  before update on public.my_table
  for each row execute procedure public.update_updated_at_column();`,
    notes: [
      'File prefix must be YYYYMMDD_HHMMSS_description.sql (lexicographic order = apply order).',
      'RLS must be enabled on every table — no exceptions.',
      'Always include organization_id for multi-tenant scoping.',
      'Apply with: supabase db push --project-ref kxwjcupuxnnbnzcgmkoi',
      'After applying, regenerate TypeScript types: supabase gen types typescript → src/types/database.ts',
    ],
  },

  // -------------------------------------------------------------------------
  // Form with react-hook-form + zod
  // -------------------------------------------------------------------------
  form: {
    summary: 'Forms use react-hook-form + zod for validation. Use shadcn/ui Form components.',
    template: `import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'

const formSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().optional(),
})

type FormValues = z.infer<typeof formSchema>

interface MyFormProps {
  onSubmit: (values: FormValues) => Promise<void>
  isSubmitting?: boolean
}

export function MyForm({ onSubmit, isSubmitting }: MyFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', description: '' },
  })

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Enter name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </Form>
  )
}`,
    notes: [
      'Always use zod schemas for form validation.',
      'Use zodResolver from @hookform/resolvers/zod.',
      'FormField, FormItem, FormLabel, FormMessage, FormControl all come from @/components/ui/form.',
      'Disable the submit button while isSubmitting to prevent double-submits.',
    ],
  },
};

// ---------------------------------------------------------------------------
// CONVENTIONS
// ---------------------------------------------------------------------------

const CONVENTIONS = {
  typescript: {
    summary: 'Lenient TypeScript settings — do not tighten them.',
    settings: {
      noImplicitAny: false,
      strictNullChecks: false,
      skipLibCheck: true,
    },
    note: 'Do NOT change these settings when making changes. The codebase relies on them.',
  },
  timezone: {
    summary: 'All datetimes are NZ timezone (Pacific/Auckland).',
    client_header: 'X-Client-Timezone: Pacific/Auckland sent by Supabase client in src/lib/supabase.ts',
    note: 'Format dates for display with toLocaleString("en-NZ", { timeZone: "Pacific/Auckland" }).',
  },
  roles: {
    summary: 'Four user roles: admin, master, officer, admin_officer.',
    hierarchy: 'master > admin = admin_officer > officer',
    source: 'authStore.ts (Zustand) + route guards in App.tsx (RoleRoute, ProtectedRoute, AreaRoute)',
    note: 'master role has cross-org access. All other roles are scoped to organization_id.',
  },
  path_alias: {
    summary: '@/* resolves to ./src/*',
    examples: [
      '@/lib/supabase',
      '@/components/ui/button',
      '@/hooks/useBreaches',
      '@/stores/authStore',
      '@/types/database',
    ],
  },
  naming: {
    pages: 'PascalCase.tsx in src/pages/ (e.g. VehiclesPage.tsx, BreachesPage.tsx)',
    hooks: 'camelCase starting with "use" in src/hooks/ (e.g. useVehicles.ts, useBreaches.ts)',
    components: 'PascalCase.tsx in src/components/features/ or src/components/ui/',
    stores: 'camelCase ending in "Store" (e.g. authStore.ts, globalFiltersStore.ts)',
    edge_functions: 'kebab-case directory name under supabase/functions/ (e.g. create-user/index.ts)',
    migrations: 'YYYYMMDD_HHMMSS_snake_case_description.sql under supabase/migrations/',
  },
  shadcn_ui: {
    summary: 'shadcn/ui components are the sole UI primitive library. Never re-implement them.',
    location: 'src/components/ui/',
    import_pattern: "@/components/ui/<component>  (e.g. '@/components/ui/button')",
    available: [
      'button', 'card', 'dialog', 'form', 'input', 'label', 'select', 'table',
      'badge', 'alert', 'toast', 'tabs', 'dropdown-menu', 'sheet', 'tooltip',
      'calendar', 'checkbox', 'radio-group', 'switch', 'textarea', 'slider',
    ],
  },
  cors: {
    edge_functions: 'Import getCorsHeaders/withCors from ../_shared/withCors.ts',
    always_options: 'Always handle OPTIONS preflight — return 200 with corsHeaders',
    ptt_server: 'ptt-server/ uses its own corsOptions in server.js',
  },
  supabase_rls: {
    summary: 'Every table must have RLS enabled. Policies scope by organization_id + auth.uid().',
    pattern: 'anon key (frontend) respects RLS; service role (Edge Functions) bypasses RLS',
    note: 'If a query returns no data unexpectedly, check RLS policies in Supabase dashboard.',
  },
};

// ---------------------------------------------------------------------------
// COMMON TASKS — step-by-step guides
// ---------------------------------------------------------------------------

const COMMON_TASKS = {
  add_page: [
    '1. Create src/pages/MyPage.tsx as a default-exported React component.',
    '2. Import shadcn/ui components from @/components/ui/.',
    '3. Create src/hooks/useMyData.ts with TanStack Query for data.',
    '4. Add route in src/App.tsx wrapped in RoleRoute with appropriate roles.',
    '5. Run bun run build to check TypeScript.',
  ],
  add_edge_function: [
    '1. Create supabase/functions/my-function/index.ts using Edge Function template.',
    '2. Import withCors and helpers from ../_shared/withCors.ts.',
    '3. Add CORS preflight handler (OPTIONS check).',
    '4. Deploy: supabase functions deploy my-function --project-ref kxwjcupuxnnbnzcgmkoi',
    '5. Set secrets if needed: supabase secrets set KEY=value --project-ref kxwjcupuxnnbnzcgmkoi',
  ],
  add_table: [
    '1. Create supabase/migrations/YYYYMMDD_HHMMSS_add_my_table.sql.',
    '2. Include organization_id FK, RLS enable, and RLS policies.',
    '3. Apply: supabase db push --project-ref kxwjcupuxnnbnzcgmkoi',
    '4. Regenerate types: supabase gen types typescript > src/types/database.ts',
    '5. Update @/types/index.ts if you add domain types.',
  ],
  add_hook: [
    '1. Create src/hooks/useMyData.ts.',
    '2. Import supabase from @/lib/supabase and useQuery/useMutation from @tanstack/react-query.',
    '3. Include organizationId in queryKey for multi-tenant correctness.',
    '4. Invalidate query cache on mutation success.',
  ],
  fix_rls: [
    '1. Open Supabase dashboard → Table Editor → find table.',
    '2. Check RLS policies — ensure a SELECT policy exists for the user role.',
    '3. Test in SQL editor: set local role to anon; select * from public.my_table.',
    '4. Policies use auth.uid() and user_profiles.organization_id.',
  ],
  fix_type_drift: [
    '1. Run supabase db push if there are unapplied migrations.',
    '2. Run supabase gen types typescript > src/types/database.ts',
    '3. Fix TypeScript errors from the updated types.',
    '4. Run bun run build to validate.',
  ],
  fix_lockfile: [
    '1. Run bun install (no --frozen-lockfile flag).',
    '2. Commit the updated bun.lock.',
    '3. Railway will now accept the deploy.',
  ],
};

// ---------------------------------------------------------------------------
// QUICK REFERENCE — file-to-feature mapping
// ---------------------------------------------------------------------------

const FILE_GUIDE = {
  'src/lib/supabase.ts': 'Typed Supabase client. Import: import { supabase } from "@/lib/supabase"',
  'src/types/database.ts': 'Generated DB types. Regenerate with supabase gen types typescript.',
  'src/types/index.ts': 'Domain types — BreachAlert, Severity, Zone, Observation, etc.',
  'src/stores/authStore.ts': 'Auth state — current user, role, organization_id, login/logout.',
  'src/stores/globalFiltersStore.ts': 'Global filter state — date range, zone, org filters.',
  'src/App.tsx': 'Main router with ProtectedRoute, RoleRoute, AreaRoute guards.',
  'supabase/functions/_shared/withCors.ts': 'CORS helpers for Edge Functions — withCors, getCorsHeaders, jsonResponse, errorResponse.',
  'supabase/functions/_shared/compliance.ts': 'Breach calculation logic.',
  'supabase/functions/_shared/alpr.ts': 'ALPR plate recognition shared logic.',
  'supabase/functions/_shared/orgConfig.ts': 'Per-org SMTP config retrieval.',
  'vercel.json': 'SPA rewrites, security headers, CSP, caching rules.',
  'tailwind.config.ts': 'Tailwind config with HSL custom properties for themes.',
  'inference-service/server.js': 'Bob AI service — chat, learn, assess, navigate endpoints.',
};

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------

function getTechStack() {
  return TECH_STACK;
}

function getProjectLayout() {
  return PROJECT_LAYOUT;
}

function getBuildCommands() {
  return BUILD_COMMANDS;
}

function getCodePattern(patternKey) {
  const key = String(patternKey || '').toLowerCase().replace(/[-\s]/g, '_');
  return CODE_PATTERNS[key] || null;
}

function getAllPatterns() {
  return CODE_PATTERNS;
}

function getConventions() {
  return CONVENTIONS;
}

function getCommonTask(taskKey) {
  const key = String(taskKey || '').toLowerCase().replace(/[-\s]/g, '_');
  return COMMON_TASKS[key] || null;
}

function getAllCommonTasks() {
  return COMMON_TASKS;
}

function getFileGuide() {
  return FILE_GUIDE;
}

/**
 * Answer a natural language coding question about FieldOps.
 * Returns a structured answer with template, steps, and notes.
 */
function answerCodingQuestion(question) {
  const q = String(question || '').toLowerCase();

  // Action verbs: any of these counts as "create/build"
  const actionVerb = q.includes('create') || q.includes('add') || q.includes('write') ||
    q.includes('make') || q.includes('build') || q.includes('generate') ||
    q.includes('implement') || q.includes('develop');

  // Page / component creation
  if (actionVerb && (q.includes('page') || q.includes('screen'))) {
    return { pattern: CODE_PATTERNS.page, task: COMMON_TASKS.add_page };
  }
  if (actionVerb && (q.includes('hook') || q.includes('usequery') || q.includes('usemutation') || q.includes('data fetch') || q.includes('fetching'))) {
    return { pattern: CODE_PATTERNS.hook, task: COMMON_TASKS.add_hook };
  }
  if (actionVerb && (q.includes('edge function') || q.includes('supabase function') || q.includes('deno'))) {
    return { pattern: CODE_PATTERNS.edge_function, task: COMMON_TASKS.add_edge_function };
  }
  if (actionVerb && (q.includes('migration') || q.includes('table') || (q.includes('database') && q.includes('schema')))) {
    return { pattern: CODE_PATTERNS.migration, task: COMMON_TASKS.add_table };
  }
  if (actionVerb && q.includes('form')) {
    return { pattern: CODE_PATTERNS.form, task: null };
  }
  if (actionVerb && (q.includes('store') || q.includes('zustand'))) {
    return { pattern: CODE_PATTERNS.store, task: null };
  }
  if ((actionVerb || q.includes('register')) && q.includes('route')) {
    return { pattern: CODE_PATTERNS.route, task: COMMON_TASKS.add_page };
  }

  // Conventions & config
  if (q.includes('typescript') || q.includes('tsconfig') || q.includes('strict')) {
    return { pattern: null, convention: CONVENTIONS.typescript };
  }
  if (q.includes('timezone') || q.includes('nzt') || q.includes('pacific/auckland')) {
    return { pattern: null, convention: CONVENTIONS.timezone };
  }
  if (q.includes('role') || q.includes('permission') || q.includes('admin') || q.includes('officer')) {
    return { pattern: null, convention: CONVENTIONS.roles };
  }
  if (q.includes('naming') || q.includes('convention') || q.includes('where to put') || q.includes('where do')) {
    return { pattern: null, convention: CONVENTIONS.naming };
  }
  if (q.includes('@/') || q.includes('path alias') || q.includes('import path')) {
    return { pattern: null, convention: CONVENTIONS.path_alias };
  }
  if (q.includes('shadcn') || q.includes('ui component') || q.includes('button') || q.includes('card') || q.includes('dialog')) {
    return { pattern: CODE_PATTERNS.page, convention: CONVENTIONS.shadcn_ui };
  }
  if (q.includes('cors')) {
    return { pattern: CODE_PATTERNS.edge_function, convention: CONVENTIONS.cors };
  }
  if (q.includes('rls') || q.includes('row level') || q.includes('permission') || q.includes('access denied')) {
    return { pattern: null, task: COMMON_TASKS.fix_rls, convention: CONVENTIONS.supabase_rls };
  }

  // Fixes
  if (q.includes('lockfile') || q.includes('bun.lock') || q.includes('frozen')) {
    return { task: COMMON_TASKS.fix_lockfile };
  }
  if (q.includes('type') && (q.includes('drift') || q.includes('mismatch') || q.includes('regenerate') || q.includes('out of sync'))) {
    return { task: COMMON_TASKS.fix_type_drift };
  }

  // Build / run
  if (q.includes('build') || q.includes('dev server') || q.includes('how to run') || q.includes('start')) {
    return { commands: BUILD_COMMANDS };
  }

  // Structure / layout
  if (q.includes('structure') || q.includes('layout') || q.includes('directory') || q.includes('folder') || q.includes('where is')) {
    return { layout: PROJECT_LAYOUT, file_guide: FILE_GUIDE };
  }

  return null;
}

module.exports = {
  getTechStack,
  getProjectLayout,
  getBuildCommands,
  getCodePattern,
  getAllPatterns,
  getConventions,
  getCommonTask,
  getAllCommonTasks,
  getFileGuide,
  answerCodingQuestion,
  TECH_STACK,
  PROJECT_LAYOUT,
  BUILD_COMMANDS,
  CODE_PATTERNS,
  CONVENTIONS,
  COMMON_TASKS,
  FILE_GUIDE,
};
