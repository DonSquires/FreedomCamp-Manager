/**
 * Stack Navigation Module
 *
 * Teaches Bob to navigate and understand the full FieldOps Manager stack:
 *
 *   UI (React)  →  Hooks (TanStack Query)  →  Supabase Client  →  Postgres / Edge Functions
 *       ↕                                         ↕
 *   react-router-dom v6                   Railway (inference-service)
 *       ↕                                         ↕
 *   GitHub Actions CI/CD                  Ollama (local LLM)
 *
 * Capabilities:
 *   1. Trace a button/link from JSX → handler → hook → API → DB
 *   2. Read UI element code and predict expected behaviour
 *   3. Diagnose when behaviour doesn't match expectation
 *   4. Map routes, hooks, Edge Functions, and DB tables
 */

// ---------------------------------------------------------------------------
// Full route map — every path in App.tsx with role gates
// ---------------------------------------------------------------------------

const ROUTE_MAP = {
  public: [
    { path: '/login', component: 'Login', roles: 'any', description: 'Authentication page' },
    { path: '/public/dispute', component: 'PublicDisputePortal', roles: 'any', description: 'Public-facing dispute submission' },
  ],
  officer: [
    { path: '/officer-home', component: 'OfficerHome', roles: ['officer', 'admin_officer'], description: 'Officer landing page with shift status' },
    { path: '/field-officer', component: 'FieldOfficerPortal', roles: ['officer', 'admin_officer'], area: 'field_officer', description: 'Field officer operations — patrol, observations, enforcement' },
    { path: '/live-patrol', component: 'LivePatrolMap', roles: ['officer', 'admin_officer'], description: 'Real-time GPS patrol tracking on map' },
    { path: '/patrol-checkpoints', component: 'PatrolCheckpoints', roles: ['admin', 'admin_officer', 'master'], description: 'Manage patrol checkpoint locations' },
    { path: '/patrol-schedule', component: 'PatrolSchedule', roles: ['admin', 'admin_officer', 'master'], description: 'Plan and assign patrol shifts' },
    { path: '/patrol-kpis', component: 'PatrolKPIs', roles: ['admin', 'admin_officer', 'master'], description: 'Patrol performance metrics dashboard' },
    { path: '/team-chat', component: 'TeamChat', roles: ['admin', 'admin_officer', 'officer', 'master'], description: 'Internal team messaging' },
  ],
  admin: [
    { path: '/admin', component: 'AdminPortal', roles: ['admin', 'admin_officer', 'master'], description: 'Admin dashboard — stats, recent activity, system health' },
    { path: '/vehicles', component: 'VehiclesPage', roles: 'protected', description: 'Vehicle registry with search and ALPR results' },
    { path: '/vehicles/:id', component: 'VehicleDetailPage', roles: 'protected', description: 'Single vehicle detail — observations, compliance status, photos' },
    { path: '/zones', component: 'ZonesPage', roles: ['admin', 'admin_officer', 'master'], description: 'Freedom camping zone management with geofences' },
    { path: '/compliance', component: 'CompliancePage', roles: ['admin', 'admin_officer', 'master'], description: 'Compliance overview — breach lists, filters' },
    { path: '/compliance-unified', component: 'Compliance', roles: ['admin', 'admin_officer', 'master'], description: 'Unified compliance: Overview + Observations + Analytics tabs' },
    { path: '/breaches', component: 'BreachesPage', roles: ['admin', 'admin_officer', 'master'], description: 'Breach management — escalate, resolve, export' },
    { path: '/data', component: 'DataPage', roles: ['admin', 'admin_officer', 'master'], description: 'Data import/export hub' },
    { path: '/users', component: 'UsersPage', roles: ['admin', 'admin_officer', 'master'], description: 'User management — roles, invites, deactivation' },
    { path: '/incidents', component: 'IncidentsPage', roles: 'protected', description: 'Incident logging and investigation tracking' },
    { path: '/reports', component: 'ReportsPage', roles: ['admin', 'admin_officer', 'master'], description: 'Report generation hub' },
    { path: '/observations', component: 'ObservationsPage', roles: ['admin', 'admin_officer', 'master'], description: 'Browse and filter all observation records' },
    { path: '/enforcement-actions', component: 'EnforcementActionsPage', roles: ['admin', 'admin_officer', 'master'], description: 'Enforcement action register — NTV, warnings, infringements' },
    { path: '/enforcement-command-center', component: 'EnforcementCommandCenter', roles: ['admin', 'admin_officer', 'master'], description: 'Coordinated enforcement operations view' },
    { path: '/infringements', component: 'InfringementsPage', roles: ['admin', 'admin_officer', 'master'], description: 'Infringement notice management' },
    { path: '/notice-to-vacate', component: 'NoticeToVacatePage', roles: ['admin', 'admin_officer', 'master'], description: 'Issue and track Notice to Vacate documents' },
    { path: '/disputes', component: 'DisputesPage', roles: ['admin', 'admin_officer', 'master'], description: 'Manage public dispute submissions' },
    { path: '/live-tracking', component: 'LiveTrackingPage', roles: ['admin', 'admin_officer', 'master'], description: 'Live GPS tracking of all active officers' },
    { path: '/audit-log', component: 'AuditLogPage', roles: ['admin', 'admin_officer', 'master'], description: 'System audit trail — all user actions' },
    { path: '/diagnostics', component: 'DiagnosticsPage', roles: ['admin', 'admin_officer', 'master'], description: 'System diagnostics — service health, DB status' },
    { path: '/bob-assistant', component: 'BobAssistantPage', roles: ['admin', 'admin_officer', 'master'], description: 'Chat with Bob AI assistant' },
    { path: '/search', component: 'SearchPage', roles: ['admin', 'admin_officer', 'master'], description: 'Global search across vehicles, zones, observations' },
    { path: '/settings', component: 'SettingsPage', roles: 'protected', description: 'User settings and preferences' },
    { path: '/profile', component: 'ProfilePage', roles: 'protected', description: 'User profile management' },
  ],
  platform: [
    { path: '/platform', component: 'PlatformAdminPage', roles: ['master'], description: 'Master platform administration' },
    { path: '/organizations', component: 'OrganizationsPage', roles: ['admin', 'admin_officer', 'master'], description: 'Multi-org management' },
    { path: '/access-control', component: 'AccessControlPage', roles: ['admin', 'admin_officer', 'master'], description: 'Permissions and role assignment' },
    { path: '/privacy-curtain', component: 'PrivacyCurtainPage', roles: ['admin', 'admin_officer', 'master'], description: 'Data privacy controls and retention' },
  ],
  data_ops: [
    { path: '/admin/data-hub', component: 'DataHub', roles: ['admin', 'admin_officer', 'master'], description: 'Centralised data management' },
    { path: '/admin/data-cleanup', component: 'DataCleanup', roles: ['admin', 'admin_officer', 'master'], description: 'Data hygiene tools' },
    { path: '/admin/cleanup-recalculate', component: 'CleanupRecalculate', roles: ['admin', 'admin_officer', 'master'], description: 'Bulk cleanup and compliance recalculation' },
    { path: '/admin/data-integrity', component: 'DataIntegrity', roles: ['admin', 'admin_officer', 'master'], description: 'Data integrity checks' },
    { path: '/admin/discrepancies', component: 'DiscrepanciesPage', roles: ['admin', 'admin_officer', 'master'], description: 'Data discrepancy resolution' },
    { path: '/import-data', component: 'ImportDataPage', roles: ['admin', 'admin_officer', 'master'], description: 'CSV/Excel data import wizard' },
    { path: '/compliance-recalculation', component: 'ComplianceRecalculation', roles: ['admin', 'admin_officer', 'master'], description: 'Trigger compliance recalculation for zones' },
    { path: '/photo-reingest', component: 'PhotoReingestPage', roles: ['admin', 'admin_officer', 'master'], description: 'Re-process photo evidence pipeline' },
    { path: '/evidence-photo-linker', component: 'EvidencePhotoLinker', roles: ['admin', 'admin_officer', 'master'], description: 'Link photos to observation records' },
  ],
  analytics: [
    { path: '/reports-hub', component: 'ReportsHub', roles: ['admin', 'admin_officer', 'master'], description: 'All report types — compliance, patrol, incident' },
    { path: '/custom-reports', component: 'CustomReports', roles: ['admin', 'admin_officer', 'master'], description: 'Build custom report queries' },
    { path: '/ai-analysis', component: 'AIAnalysis', roles: ['admin', 'admin_officer', 'master'], description: 'AI-powered data analysis' },
    { path: '/hotspots', component: 'HotspotsPage', roles: ['admin', 'admin_officer', 'master'], description: 'Geographic hotspot analysis' },
    { path: '/spatial-compliance', component: 'SpatialCompliance', roles: ['admin', 'admin_officer', 'master'], description: 'Map-based compliance view' },
    { path: '/compliance-analytics', component: 'ComplianceAnalytics', roles: ['admin', 'admin_officer', 'master'], description: 'Compliance trend charts and stats' },
  ],
};

// ---------------------------------------------------------------------------
// Full stack topology — how layers connect
// ---------------------------------------------------------------------------

const STACK_TOPOLOGY = {
  layers: [
    {
      name: 'UI Layer',
      tech: 'React 18 + TypeScript + Vite',
      directory: 'src/',
      description: 'Single-page app. Pages in src/pages/, components in src/components/, hooks in src/hooks/.',
      navigation: 'react-router-dom v6. Routes defined in src/App.tsx with ProtectedRoute, RoleRoute, AreaRoute guards.',
    },
    {
      name: 'State Layer',
      tech: 'Zustand + TanStack Query v5',
      directory: 'src/stores/ + src/hooks/',
      description: 'Zustand for auth state (authStore) and global filters (globalFiltersStore). TanStack Query for server state with automatic caching and refetching.',
      data_flow: 'Component → useQuery/useMutation hook → supabase client → Postgres/Edge Function → response → cache → re-render.',
    },
    {
      name: 'API Layer',
      tech: 'Supabase JS Client (@supabase/supabase-js)',
      directory: 'src/lib/supabase.ts',
      description: 'Typed client created from VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY. All DB queries go through this client.',
      auth: 'JWT-based auth. supabase.auth.getSession() for tokens. Row Level Security (RLS) enforces per-row access.',
    },
    {
      name: 'Database Layer',
      tech: 'Supabase Postgres + Row Level Security',
      directory: 'supabase/migrations/',
      description: '70+ migrations. Tables: vehicles, observations, zones, breaches, patrols, users, organizations, etc. RLS policies on every table.',
      types: 'Generated types in src/types/database.ts. Use Database[\"public\"][\"Tables\"][\"table_name\"][\"Row\"] for row types.',
    },
    {
      name: 'Edge Functions',
      tech: 'Supabase Edge Functions (Deno TypeScript)',
      directory: 'supabase/functions/',
      description: '70+ Edge Functions for server-side logic. CORS from _shared/cors.ts. OPTIONS preflight handling required.',
      examples: 'recalculate-compliance, generate-infringement, import-data, check-nzscv-status, bob-learning-feedback-sync.',
    },
    {
      name: 'Inference Service (Bob)',
      tech: 'Node.js/Express + ONNX + Sharp',
      directory: 'inference-service/',
      description: 'AI microservice for vehicle detection, ALPR, face recognition, UI assessment, chat, self-healing. Deployed on Railway.',
      endpoints: '/infer, /infer/alpr, /infer/face, /infer/compare, /assess/ui, /chat, /self-heal/*, /learn/*, /intel/*',
    },
    {
      name: 'CI/CD Layer',
      tech: 'GitHub Actions',
      directory: '.github/workflows/',
      description: 'Deploy workflows for frontend (Supabase), Bob (Railway), Ollama (Railway), proxy (Railway). DB migrations via Supabase CLI.',
      key_workflows: 'deploy-frontend.yml, deploy-bob-railway.yml, deploy-edge-functions.yml, db-run-migrations.yml, sync-bob-repo.yml.',
    },
  ],
};

// ---------------------------------------------------------------------------
// UI element behaviour patterns — how buttons/links/forms work in FieldOps
// ---------------------------------------------------------------------------

const UI_ELEMENT_PATTERNS = {
  button: {
    description: 'Clickable action trigger. In FieldOps, always uses shadcn/ui <Button> component.',
    anatomy: {
      jsx: '<Button variant="default" onClick={handleClick} disabled={isLoading}>Label</Button>',
      variants: ['default (primary teal)', 'secondary (subtle)', 'destructive (red)', 'outline (border)', 'ghost (no bg)', 'link (text only)'],
      sizes: ['default', 'sm', 'lg', 'icon (square, for icon-only buttons)'],
    },
    trace_pattern: [
      '1. Find the Button in JSX — note its onClick handler name (e.g., onClick={handleDelete})',
      '2. Find the handler function in the same component (const handleDelete = () => { ... })',
      '3. The handler typically calls a mutation from a hook: deleteMutation.mutate(id)',
      '4. Find the hook (e.g., useVehicles) — it wraps supabase.from("table").delete().eq("id", id)',
      '5. The Supabase call hits Postgres — check RLS policies if 403/unauthorized',
      '6. On success, TanStack Query invalidates the cache and the list re-renders',
    ],
    common_issues: {
      not_clickable: [
        'Check disabled prop — is it tied to a loading state that never resolves?',
        'Check pointer-events CSS — is an overlay blocking clicks?',
        'Check z-index — is another element on top of the button?',
      ],
      wrong_action: [
        'Verify onClick handler — is it calling the right mutation/function?',
        'Check if the handler has stale closure over state (missing dependency in useCallback)',
        'Verify the mutation is targeting the correct table/row',
      ],
      no_feedback: [
        'Check if isLoading state is wired to button disabled/loading spinner',
        'Check if onSuccess callback triggers a toast notification',
        'Check if TanStack Query invalidation is configured to refresh the list',
      ],
    },
  },
  link: {
    description: 'Navigation element. Uses react-router-dom <Link> or <Navigate> for internal routes, <a> for external.',
    anatomy: {
      jsx_internal: '<Link to="/vehicles/123" className="text-primary hover:underline">View Vehicle</Link>',
      jsx_external: '<a href="https://..." target="_blank" rel="noopener noreferrer">External Link</a>',
      programmatic: 'const navigate = useNavigate(); navigate("/vehicles/123");',
    },
    trace_pattern: [
      '1. Find the Link/anchor in JSX — note the "to" prop (internal) or "href" prop (external)',
      '2. For internal links: match "to" value against ROUTE_MAP above to find the target page component',
      '3. Check if the route requires authentication (ProtectedRoute) or specific roles (RoleRoute)',
      '4. The target page component is in src/pages/ — find it by component name',
      '5. For dynamic routes (e.g., /vehicles/:id), the component uses useParams() to extract the ID',
      '6. That ID is then passed to a hook (e.g., useVehicles(id)) which fetches from Supabase',
    ],
    common_issues: {
      not_found_404: [
        'Verify the path matches a Route in App.tsx (case-sensitive)',
        'Check for trailing slashes — React Router is strict about these',
        'If dynamic route, ensure the param is being passed (e.g., /vehicles/ without ID)',
      ],
      access_denied: [
        'Check which roles are allowed in the RoleRoute wrapper',
        'Verify the user\'s role in authStore — it comes from Supabase auth metadata',
        'Check if AreaRoute requires a specific portal area the user hasn\'t selected',
      ],
      blank_page: [
        'Check browser console for render errors in the target component',
        'Check if the page component has a loading state that never resolves',
        'Verify the data hook isn\'t failing silently (check TanStack Query devtools)',
      ],
    },
  },
  form: {
    description: 'Data input + validation + submission. Uses react-hook-form + zod schemas.',
    anatomy: {
      library: 'react-hook-form with zodResolver for validation',
      pattern: 'const form = useForm({ resolver: zodResolver(schema) }); form.handleSubmit(onSubmit)',
      submission: 'onSubmit calls a Supabase mutation: supabase.from("table").insert(data) or .update(data)',
    },
    trace_pattern: [
      '1. Find the <Form> or <form> element and its onSubmit handler',
      '2. The handler is typically form.handleSubmit(onSubmit) from react-hook-form',
      '3. onSubmit receives validated data — find what it does with it (mutation, API call)',
      '4. Check the zod schema for validation rules (required fields, formats, min/max)',
      '5. On success: typically shows toast, navigates to list page, or closes dialog',
      '6. On error: should show inline field errors or a toast with the error message',
    ],
    common_issues: {
      validation_fails: [
        'Check the zod schema — is the field required? Is the format correct?',
        'Check if the form field "name" matches the schema key (case-sensitive)',
        'Look for transform/refine in the zod schema that may reject valid-looking input',
      ],
      submit_fails: [
        'Check browser Network tab — is the Supabase request returning 400/403/500?',
        'If 403: RLS policy is blocking the insert/update — check the table\'s policies',
        'If 400: the data doesn\'t match the DB column types or constraints',
        'If 500: check Edge Function logs in Supabase dashboard',
      ],
      stale_data: [
        'Check if queryClient.invalidateQueries is called after successful mutation',
        'The mutation\'s onSuccess should invalidate the relevant query key',
        'Verify the query key matches what was used in the useQuery call',
      ],
    },
  },
  table: {
    description: 'Data table displaying records with sort, filter, pagination.',
    anatomy: {
      component: 'shadcn/ui <Table> with <TableHeader>, <TableBody>, <TableRow>, <TableCell>',
      data_source: 'Hook returns data array: const { data, isLoading } = useVehicles(filters)',
      actions: 'Row actions via dropdown menu or inline buttons (edit, delete, view)',
    },
    trace_pattern: [
      '1. Find the <Table> — what hook provides the data? (e.g., useVehicles)',
      '2. Check the hook — what Supabase query does it run? (.from("vehicles").select("*"))',
      '3. Check filters — are they passed from the component or from globalFiltersStore?',
      '4. Check pagination — does the query use .range(from, to)?',
      '5. Row actions: each row typically has onClick or action buttons — trace those like regular buttons',
    ],
    common_issues: {
      empty_table: [
        'Check if the query is returning data (look at Network tab for Supabase response)',
        'Check filters — are they too restrictive? Try clearing all filters',
        'Check RLS — the user\'s role may not have SELECT permission on the table',
        'Check if the organization filter is applied (multi-org setup)',
      ],
      wrong_data: [
        'Check the Supabase query columns — is .select() fetching all needed fields?',
        'Check if filters are using the wrong column name',
        'Check date/timezone handling — FieldOps uses Pacific/Auckland timezone',
      ],
      slow_loading: [
        'Check if the query is missing an index (look at Supabase query plan)',
        'Check if the query is fetching too many rows (add pagination .range())',
        'Check if multiple queries are firing in parallel (waterfall in Network tab)',
      ],
    },
  },
  toast: {
    description: 'Notification popup for success/error feedback. Uses sonner toast library.',
    anatomy: {
      success: 'toast.success("Record saved") or toast("Success", { description: "..." })',
      error: 'toast.error("Failed to save") or toast("Error", { description: error.message })',
      component: '<Toaster /> mounted in App.tsx — renders all toast notifications',
    },
    trace_pattern: [
      '1. Find the toast call — it\'s typically in a mutation\'s onSuccess or onError callback',
      '2. If no toast appears after an action, check if the mutation has onSuccess/onError handlers',
      '3. Check if <Toaster /> is mounted in the app — it should be in App.tsx or a layout component',
    ],
  },
  dialog: {
    description: 'Modal popup for confirmations, forms, details. Uses shadcn/ui <Dialog>.',
    anatomy: {
      trigger: '<DialogTrigger asChild><Button>Open</Button></DialogTrigger>',
      content: '<DialogContent><DialogHeader><DialogTitle>...</DialogTitle></DialogHeader>...</DialogContent>',
      state: 'Controlled via open/onOpenChange props, or uncontrolled via DialogTrigger',
    },
    trace_pattern: [
      '1. Find the <Dialog> — is it controlled (open={isOpen}) or uncontrolled (DialogTrigger)?',
      '2. If controlled: find what sets isOpen to true (usually a button onClick)',
      '3. The dialog content is in <DialogContent> — forms, confirmations, details',
      '4. Close behavior: onOpenChange sets isOpen to false, or explicit close in form onSubmit',
    ],
    common_issues: {
      wont_open: [
        'Check if the DialogTrigger wraps the button correctly (needs asChild prop)',
        'For controlled dialogs: check if the state setter is being called',
        'Check z-index — another overlay may be preventing interaction',
      ],
      wont_close: [
        'Check onOpenChange handler — is it correctly setting state to false?',
        'For forms in dialogs: is onSubmit calling the close function after success?',
        'Check if a validation error is preventing form submission (form stays open)',
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// Hook → API → DB trace map — common data flow patterns
// ---------------------------------------------------------------------------

const DATA_FLOW_PATTERNS = {
  read: {
    description: 'Fetching data to display',
    flow: 'Component → useQuery(queryKey, queryFn) → supabase.from("table").select("*").eq("org_id", orgId) → Postgres → JSON response → cache → render',
    hooks_pattern: 'src/hooks/useXxx.ts exports a hook that wraps TanStack Query useQuery',
    cache: 'TanStack Query caches by queryKey. Automatic refetch on window focus and stale time expiry.',
  },
  create: {
    description: 'Creating a new record',
    flow: 'Form submit → useMutation → supabase.from("table").insert(data) → Postgres → 201 Created → invalidate queries → list re-renders',
    hooks_pattern: 'useMutation with onSuccess: () => queryClient.invalidateQueries({ queryKey: ["table"] })',
  },
  update: {
    description: 'Updating an existing record',
    flow: 'Form submit → useMutation → supabase.from("table").update(data).eq("id", id) → Postgres → 200 OK → invalidate queries',
    hooks_pattern: 'Same as create but with .update() and .eq("id", id)',
  },
  delete: {
    description: 'Deleting a record',
    flow: 'Confirm dialog → useMutation → supabase.from("table").delete().eq("id", id) → Postgres → 200 OK → invalidate queries',
    hooks_pattern: 'Usually behind a confirmation dialog. Destructive button variant (red).',
  },
  edge_function: {
    description: 'Calling a Supabase Edge Function',
    flow: 'Button click → supabase.functions.invoke("function-name", { body: data }) → Edge Function (Deno) → may call Postgres internally → response',
    hooks_pattern: 'supabase.functions.invoke() returns { data, error }. Check error for non-200 responses.',
  },
  inference: {
    description: 'Calling Bob (inference-service) on Railway',
    flow: 'Component → fetch("https://bob.railway.app/endpoint", { headers: { "x-inference-api-key": key } }) → Bob Express handler → ONNX/Sharp processing → JSON response',
    hooks_pattern: 'Direct fetch calls or through an Edge Function that proxies to Bob.',
  },
};

// ---------------------------------------------------------------------------
// Debugging playbook — how to diagnose common failures
// ---------------------------------------------------------------------------

const DEBUGGING_PLAYBOOK = {
  ui_not_rendering: {
    symptoms: ['Blank page', 'White screen', 'Component not visible'],
    steps: [
      '1. Open browser DevTools Console tab — look for red error messages',
      '2. Check if the error is a React render error (usually shows component stack)',
      '3. Common cause: undefined property access — add optional chaining (data?.field)',
      '4. Check the Network tab — is the data request succeeding?',
      '5. Check if the component has a loading state (isLoading from hook) that shows a skeleton',
      '6. Try clearing browser cache and hard refresh (Ctrl+Shift+R)',
    ],
  },
  button_not_working: {
    symptoms: ['Click does nothing', 'No visual feedback', 'Wrong action triggered'],
    steps: [
      '1. Inspect the button in DevTools Elements tab — check if disabled attribute is present',
      '2. Check for overlapping elements — use DevTools pointer to find what\'s on top',
      '3. Add a console.log in the onClick handler to confirm it\'s being called',
      '4. If handler fires but nothing happens: check the mutation/API call in Network tab',
      '5. If mutation fails: read the error response body for Supabase/Postgres error details',
      '6. If 403: check RLS policy. If 400: check data format. If 500: check Edge Function logs.',
    ],
  },
  link_goes_nowhere: {
    symptoms: ['404 page', 'Redirect to /', 'Blank page after click'],
    steps: [
      '1. Check the link\'s "to" prop — does it match a Route path in App.tsx?',
      '2. Check for typos in the path (paths are case-sensitive)',
      '3. Check if the Route has a role guard — does the user have the required role?',
      '4. If redirect to /: the catch-all route (*) redirects unknown paths to /',
      '5. If blank page: the target component is crashing on render — check Console for errors',
      '6. For dynamic routes: check that the URL parameter is valid (e.g., /vehicles/:id needs a real ID)',
    ],
  },
  data_not_loading: {
    symptoms: ['Table shows "No data"', 'Loading spinner never stops', 'Stale data'],
    steps: [
      '1. Check Network tab — is the Supabase request being sent? What status code?',
      '2. If no request: the query might be disabled (enabled: false in useQuery options)',
      '3. If 401: auth session expired — user needs to re-login',
      '4. If 403: RLS policy blocking access — check table policies in Supabase dashboard',
      '5. If 200 but empty: check filters/where clauses — maybe the data exists but is filtered out',
      '6. Check organization context — multi-org users need the correct org selected in globalFiltersStore',
      '7. Check timezone — date filters use Pacific/Auckland, DB stores UTC',
    ],
  },
  form_submit_fails: {
    symptoms: ['Error toast on submit', 'Form hangs', 'Validation errors'],
    steps: [
      '1. Check if it\'s a validation error (red text below fields) — read the zod schema',
      '2. Check Network tab — was the Supabase request sent?',
      '3. If 400: the request body doesn\'t match DB column types or constraints',
      '4. If 409: unique constraint violation — the record already exists',
      '5. If 413: payload too large — check file upload size limits',
      '6. Check if required columns have NOT NULL constraints in the migration',
      '7. Check if the insert includes the organization_id (required for multi-org tables)',
    ],
  },
  edge_function_error: {
    symptoms: ['500 from Edge Function', 'Timeout', 'CORS error'],
    steps: [
      '1. Check Supabase dashboard → Edge Functions → select function → Logs',
      '2. If CORS: ensure the function imports from _shared/cors.ts and handles OPTIONS preflight',
      '3. If timeout: the function is taking too long — check for long DB queries or external API calls',
      '4. If 500: read the error log — it\'s usually a JavaScript runtime error or missing env var',
      '5. Edge Functions run in Deno — check for Node.js-only APIs that aren\'t available',
      '6. Check if the function needs a secret/env var that\'s not set in Supabase dashboard',
    ],
  },
  railway_service_down: {
    symptoms: ['Bob not responding', 'Inference timeout', '/health returns error'],
    steps: [
      '1. Check Railway dashboard — is the service running? Check deploy logs for crash',
      '2. Hit /health endpoint directly — it shows service status and Ollama circuit breaker state',
      '3. Check Railway logs for OOM (out of memory) — ONNX models need sufficient RAM',
      '4. If Ollama-related: check circuit breaker state — it opens after 3 consecutive failures',
      '5. Check INFERENCE_API_KEY — both the caller and the service must agree on the key',
      '6. Check GitHub Actions deploy workflow — did the last deploy succeed?',
    ],
  },
  github_ci_failure: {
    symptoms: ['Deploy workflow failed', 'Red X on commit', 'PR checks failing'],
    steps: [
      '1. Go to Actions tab in GitHub — find the failed workflow run',
      '2. Click into the failed job — read the error output (usually near the bottom)',
      '3. Common: bun install --frozen-lockfile fails → bun.lock is out of date, regenerate it',
      '4. Common: TypeScript build fails → type error in changed file, run bun run build locally',
      '5. Common: Railway deploy fails → RAILWAY_TOKEN expired or service ID wrong',
      '6. Common: Edge Function deploy fails → Supabase CLI auth token expired',
      '7. For DB migrations: check if the migration SQL has syntax errors or conflicts',
    ],
  },
};

// ---------------------------------------------------------------------------
// Supabase-to-DB table mapping (key tables)
// ---------------------------------------------------------------------------

const KEY_TABLES = {
  vehicles: { description: 'Vehicle registry. Core entity.', key_columns: 'id, plate_number, make, model, colour, organization_id', related: 'observations, breaches, vehicle_photos' },
  observations: { description: 'Field observations — each sighting of a vehicle.', key_columns: 'id, plate_number, zone_id, recorded_at, photo_url, officer_id', related: 'vehicles, zones, observation_photos' },
  zones: { description: 'Freedom camping zones with geofences.', key_columns: 'id, name, allowed_days, max_consecutive_nights, max_nights_per_month, boundary_geojson', related: 'observations, breaches' },
  breaches: { description: 'Compliance breaches — auto-calculated when stay limits exceeded.', key_columns: 'id, vehicle_id, zone_id, breach_type, status, detected_at', related: 'vehicles, zones, enforcement_actions' },
  enforcement_actions: { description: 'NTV, warnings, infringements issued.', key_columns: 'id, breach_id, action_type, status, issued_at, officer_id', related: 'breaches, users' },
  patrols: { description: 'Active and historical patrol sessions.', key_columns: 'id, officer_id, started_at, ended_at, route_geojson', related: 'users, patrol_checkpoints' },
  users: { description: 'System users (officers, admins, masters).', key_columns: 'id, email, role, organization_id, full_name', related: 'patrols, observations, enforcement_actions' },
  organizations: { description: 'Multi-tenant organizations (councils, contractors).', key_columns: 'id, name, type, settings', related: 'users, vehicles, zones' },
  incidents: { description: 'Incident reports — safety, welfare, operational.', key_columns: 'id, title, severity, status, reported_by, created_at', related: 'users, incident_photos' },
};

// ---------------------------------------------------------------------------
// UI element trace function — analyse code to find what a button/link does
// ---------------------------------------------------------------------------

function traceUIElement(code, elementType = 'auto') {
  const analysis = { element_type: elementType, findings: [], trace: [], issues: [], recommendations: [] };

  // Auto-detect element type
  if (elementType === 'auto') {
    if (/<Button\b/i.test(code)) analysis.element_type = 'button';
    else if (/<Link\b/i.test(code) || /<a\b/i.test(code)) analysis.element_type = 'link';
    else if (/<Form\b/i.test(code) || /<form\b/i.test(code) || /onSubmit/i.test(code)) analysis.element_type = 'form';
    else if (/<Dialog\b/i.test(code)) analysis.element_type = 'dialog';
    else if (/<Table\b/i.test(code)) analysis.element_type = 'table';
    else analysis.element_type = 'unknown';
  }

  // Extract handlers
  const onClickMatches = code.match(/onClick=\{([^}]+)\}/g) || [];
  const onSubmitMatches = code.match(/onSubmit=\{([^}]+)\}/g) || [];
  const toMatches = code.match(/to=["'`]([^"'`]+)["'`]/g) || [];
  const hrefMatches = code.match(/href=["'`]([^"'`]+)["'`]/g) || [];
  const navigateMatches = code.match(/navigate\(["'`]([^"'`]+)["'`]\)/g) || [];

  // Extract mutations
  const mutationMatches = code.match(/(\w+)\.mutate\(/g) || [];
  const supabaseMatches = code.match(/supabase\.from\(["'`]([^"'`]+)["'`]\)/g) || [];
  const functionsInvokeMatches = code.match(/supabase\.functions\.invoke\(["'`]([^"'`]+)["'`]/g) || [];

  // Extract hooks
  const hookMatches = code.match(/use[A-Z]\w+\(/g) || [];

  // Build findings
  if (onClickMatches.length > 0) {
    analysis.findings.push({ type: 'click_handlers', count: onClickMatches.length, handlers: onClickMatches.map(m => m.replace(/onClick=\{|\}/g, '')) });
  }
  if (onSubmitMatches.length > 0) {
    analysis.findings.push({ type: 'submit_handlers', count: onSubmitMatches.length, handlers: onSubmitMatches.map(m => m.replace(/onSubmit=\{|\}/g, '')) });
  }
  if (toMatches.length > 0) {
    analysis.findings.push({ type: 'internal_links', count: toMatches.length, targets: toMatches.map(m => m.replace(/to=["'`]|["'`]$/g, '')) });
  }
  if (hrefMatches.length > 0) {
    analysis.findings.push({ type: 'external_links', count: hrefMatches.length, targets: hrefMatches.map(m => m.replace(/href=["'`]|["'`]$/g, '')) });
  }
  if (navigateMatches.length > 0) {
    analysis.findings.push({ type: 'programmatic_navigation', count: navigateMatches.length, targets: navigateMatches.map(m => m.replace(/navigate\(["'`]|["'`]\)/g, '')) });
  }
  if (mutationMatches.length > 0) {
    analysis.findings.push({ type: 'mutations', count: mutationMatches.length, names: mutationMatches.map(m => m.replace(/\.mutate\(/g, '')) });
  }
  if (supabaseMatches.length > 0) {
    analysis.findings.push({ type: 'supabase_queries', count: supabaseMatches.length, tables: supabaseMatches.map(m => m.replace(/supabase\.from\(["'`]|["'`]\)/g, '')) });
  }
  if (functionsInvokeMatches.length > 0) {
    analysis.findings.push({ type: 'edge_function_calls', count: functionsInvokeMatches.length, functions: functionsInvokeMatches.map(m => m.replace(/supabase\.functions\.invoke\(["'`]|["'`]/g, '')) });
  }
  if (hookMatches.length > 0) {
    analysis.findings.push({ type: 'hooks_used', count: hookMatches.length, hooks: [...new Set(hookMatches.map(m => m.replace(/\(/g, '')))] });
  }

  // Build trace based on element type
  const pattern = UI_ELEMENT_PATTERNS[analysis.element_type];
  if (pattern) {
    analysis.trace = pattern.trace_pattern;
    analysis.expected_behaviour = pattern.description;

    // Check for common issues
    if (analysis.element_type === 'button') {
      if (onClickMatches.length === 0 && !code.includes('type="submit"')) {
        analysis.issues.push({ severity: 'high', message: 'Button has no onClick handler and is not type="submit". It will do nothing when clicked.' });
      }
      if (!code.includes('disabled') && mutationMatches.length > 0) {
        analysis.issues.push({ severity: 'medium', message: 'Button triggers a mutation but has no disabled state for loading. Users might double-click.' });
      }
      if (code.includes('variant="destructive"') && !code.includes('confirm') && !code.includes('Dialog')) {
        analysis.issues.push({ severity: 'medium', message: 'Destructive button without confirmation dialog. Dangerous actions should require confirmation.' });
      }
    }

    if (analysis.element_type === 'link') {
      if (toMatches.length === 0 && hrefMatches.length === 0 && navigateMatches.length === 0) {
        analysis.issues.push({ severity: 'high', message: 'Link element found but no "to", "href", or navigate() destination. Link goes nowhere.' });
      }
      toMatches.forEach(match => {
        const target = match.replace(/to=["'`]|["'`]$/g, '');
        const allRoutes = Object.values(ROUTE_MAP).flat();
        const routeExists = allRoutes.some(r => {
          const pattern = r.path.replace(/:\w+/g, '[^/]+');
          return new RegExp(`^${pattern}$`).test(target);
        });
        if (!routeExists && !target.startsWith('/') === false) {
          analysis.issues.push({ severity: 'low', message: `Link target "${target}" — verify this path exists in App.tsx route map.` });
        }
      });
    }

    if (analysis.element_type === 'form') {
      if (onSubmitMatches.length === 0 && !code.includes('handleSubmit')) {
        analysis.issues.push({ severity: 'high', message: 'Form has no onSubmit handler. Form submission will do nothing or cause a page reload.' });
      }
      if (!code.includes('toast') && !code.includes('Toast')) {
        analysis.issues.push({ severity: 'low', message: 'No toast feedback detected. Consider adding success/error toasts after form submission.' });
      }
    }
  }

  // Accessibility checks
  if (analysis.element_type === 'button') {
    if (!code.includes('aria-label') && code.match(/<Button[^>]*>[^<]*<\/Button>/)) {
      // Button has text content, aria-label not strictly needed
    } else if (!code.includes('aria-label') && /<Button[^>]*>[\s]*<\w/i.test(code)) {
      analysis.issues.push({ severity: 'medium', message: 'Icon-only button without aria-label. Screen readers can\'t identify this button.' });
    }
  }

  if (analysis.element_type === 'link') {
    if (code.includes('target="_blank"') && !code.includes('rel=')) {
      analysis.issues.push({ severity: 'medium', message: 'External link with target="_blank" missing rel="noopener noreferrer". Security risk.' });
    }
  }

  return analysis;
}

// ---------------------------------------------------------------------------
// Stack map function — return the full system topology
// ---------------------------------------------------------------------------

function getStackMap() {
  return {
    topology: STACK_TOPOLOGY,
    route_map: ROUTE_MAP,
    data_flow: DATA_FLOW_PATTERNS,
    key_tables: KEY_TABLES,
    ui_elements: Object.fromEntries(
      Object.entries(UI_ELEMENT_PATTERNS).map(([key, val]) => [key, { description: val.description, anatomy: val.anatomy }])
    ),
    debugging: DEBUGGING_PLAYBOOK,
  };
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

function findRoute(path) {
  const allRoutes = Object.values(ROUTE_MAP).flat();
  // Exact match first
  const exact = allRoutes.find(r => r.path === path);
  if (exact) return exact;
  // Pattern match for dynamic routes
  return allRoutes.find(r => {
    const pattern = r.path.replace(/:\w+/g, '[^/]+');
    return new RegExp(`^${pattern}$`).test(path);
  }) || null;
}

function getDebuggingSteps(symptom) {
  const lowered = String(symptom || '').toLowerCase();
  const matched = [];

  for (const [key, playbook] of Object.entries(DEBUGGING_PLAYBOOK)) {
    const symptomsMatch = playbook.symptoms.some(s => lowered.includes(s.toLowerCase()));
    const keyMatch = lowered.includes(key.replace(/_/g, ' '));
    if (symptomsMatch || keyMatch) {
      matched.push({ issue: key, ...playbook });
    }
  }

  return matched.length > 0 ? matched : [{ issue: 'general', symptoms: [symptom], steps: [
    '1. Open browser DevTools Console — look for red error messages',
    '2. Check Network tab for failed requests (red entries)',
    '3. Check the component\'s hook for query/mutation errors',
    '4. Check Supabase dashboard for Edge Function logs',
    '5. Check Railway dashboard for inference-service logs',
    '6. Report to Bob via POST /self-heal/bug-report with the error details',
  ] }];
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ROUTE_MAP,
  STACK_TOPOLOGY,
  UI_ELEMENT_PATTERNS,
  DATA_FLOW_PATTERNS,
  DEBUGGING_PLAYBOOK,
  KEY_TABLES,
  traceUIElement,
  getStackMap,
  findRoute,
  getDebuggingSteps,
};
