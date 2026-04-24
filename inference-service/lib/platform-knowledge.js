/**
 * Platform Knowledge Module
 *
 * Teaches Bob everything about the FieldOps Manager hybrid infrastructure stack.
 * Bob can run in either self-contained mode or build-training mode; this file
 * captures the platform knowledge needed in both operating profiles.
 *
 * Covers:
 *   Supabase   - Auth, Database, Edge Functions, Storage, Realtime, RLS
 *   RunPod/Railway/VPS - Bob+Ollama on RunPod, Proxy on Railway, PTT+TURN on VPS 72.61.123.97
 *   GitHub     - Actions CI/CD (25 workflows), Codespaces, Copilot, Secrets
 *   Vercel     - Frontend hosting, rewrites, CDN, security headers
 *   Expo/EAS   - Mobile app (React Native), OTA updates, build profiles
 *   Domains    - fcmanager.co.nz, SSL, CORS, DNS management
 *   Email/SMTP - Zoho SMTP, Resend API, per-org email config
 *   Hybrid     - How all layers connect in the overall system
 */

// ---------------------------------------------------------------------------
// SUPABASE KNOWLEDGE
// ---------------------------------------------------------------------------

const SUPABASE_KNOWLEDGE = {
  project: {
    ref: 'kxwjcupuxnnbnzcgmkoi',
    region: 'AWS ap-southeast-2 (Sydney)',
    url: 'https://kxwjcupuxnnbnzcgmkoi.supabase.co',
    db_version: 'PostgreSQL 17',
    site_url: 'https://fcmanager.co.nz',
  },
  auth: {
    summary: 'Supabase Auth (GoTrue) with JWT tokens. JWT expiry 3600s, refresh token rotation enabled, reuse interval 10s.',
    redirect_urls: [
      'https://fcmanager.co.nz',
      'https://www.fcmanager.co.nz',
      'https://freedomcampmanager.onspace.build',
      'https://*.onspace.build',
      'https://*.vercel.app',
      'http://localhost:5173',
      'http://localhost:3000',
    ],
    providers: 'Email/password. Magic link. Social providers configurable via dashboard.',
    anonymous_signins: false,
    email_templates: 'invite.html, recovery.html, confirmation.html, magic_link.html — all branded with Iron Eagle Security.',
    jwt_format: 'HS256 for dashboard clients. ES256 supported for Edge Function validation.',
    roles: ['admin', 'master', 'admin_officer', 'officer'],
    frontend_client: 'src/lib/supabase.ts — typed with Database from src/types/database.ts. Uses VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY.',
    rls: 'Row Level Security on every table. Policies use auth.uid() and organization_id for multi-tenant scoping.',
  },
  database: {
    summary: 'PostgreSQL 17 managed by Supabase. 70+ migration files in supabase/migrations/ prefixed YYYYMMDD_*.',
    key_tables: 'vehicles, observations, zones, breaches, enforcement_actions, patrols, users, organizations, incidents, ptt_messages, ptt_presence, ptt_channels',
    migrations: 'supabase/migrations/ — 70+ SQL files. Apply with: supabase db push --project-ref $REF',
    types: 'Generated TypeScript types in src/types/database.ts. Use Database["public"]["Tables"]["table"]["Row"] pattern.',
    local_dev: 'supabase start (starts local Postgres + Auth + Storage). supabase db reset to apply migrations. Shadow DB on separate port.',
    connection: 'Connection pooler via Supabase dashboard (Transaction mode for serverless Edge Functions, Session mode for direct scripts).',
    indexes: 'Key indexes: organization_id on all tenant tables, plate_number on vehicles/observations, zone_id+recorded_at on observations.',
  },
  edge_functions: {
    summary: '47 Edge Functions deployed to Supabase. Written in Deno TypeScript. Located in supabase/functions/<name>/index.ts.',
    cors: 'All functions import from ../_shared/withCors.ts. Must handle OPTIONS preflight: if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(req) })',
    jwt: 'Most functions use --no-verify-jwt flag (auth handled internally). ptt-signaling-token uses internal JWT validation.',
    deploy: 'supabase functions deploy <name> --project-ref $REF [--no-verify-jwt]',
    secrets: 'Set via: supabase secrets set KEY=value --project-ref $REF, or Supabase Dashboard → Settings → Edge Functions → Secrets.',
    key_functions: [
      'ptt-signaling-token — mints PTT channel JWTs, calls ptt-server /api/token/mint',
      'recalculate-compliance — computes breach status for vehicle/zone pairs',
      'generate-infringement — creates formatted infringement notice PDF/HTML',
      'check-nzscv-status — proxies to NZSCV API via proxy-server',
      'bob-learning-feedback-sync — syncs feedback events to Bob /learn/ingest-feedback',
      'import-data — bulk import vehicles/zones from CSV',
      'sync-parkpow — syncs parking lot data from ParkPow API',
    ],
    shared_modules: [
      '_shared/withCors.ts — CORS headers with strict allowlist',
      '_shared/cors.ts — simple wildcard CORS (legacy)',
      '_shared/compliance.ts — breach type calculation',
      '_shared/alpr.ts — ALPR result normalization (local Bob OR Plate Recognizer)',
      '_shared/orgConfig.ts — per-org SMTP config lookup',
      '_shared/infringement-notice.ts — HTML notice generation',
      '_shared/bugReportStatus.ts — bug report state machine',
    ],
    runtime: 'Deno 1.x. Node.js APIs NOT available — use Deno-native APIs. Timeout: 150s max.',
  },
  storage: {
    summary: 'Supabase Storage (S3-compatible). Buckets: ptt-clips, evidence-photos, vehicle-photos, report-exports.',
    access: 'Signed URLs for private access. Public buckets for public assets. RLS on storage objects for org scoping.',
    ptt_clips: 'ptt-clips bucket — audio clips from PTT. 24h signed URL expiry. 30-day retention via cleanup_old_ptt_clips().',
    upload: 'supabase.storage.from("bucket").upload(path, file, { contentType })',
    limits: 'Max file size configurable per bucket. Default ~50MB.',
  },
  realtime: {
    summary: 'Supabase Realtime (Phoenix/WebSocket). Used for live officer tracking, presence, and observations.',
    channels: 'supabase.channel("name").on("postgres_changes", ...).subscribe()',
    broadcast: 'For PTT presence and officer location updates.',
  },
  common_issues: [
    'RLS blocking query: check table policies in Supabase dashboard → Table Editor → RLS. Use auth.uid() and organization_id.',
    'Edge Function 503: function not deployed or secrets not set. Check Supabase dashboard → Edge Functions → Logs.',
    'Edge Function CORS: ensure OPTIONS preflight is handled and getCorsHeaders(req) is used.',
    'JWT expired: Supabase client auto-refreshes. If stuck, call supabase.auth.refreshSession(). Tokens expire after 3600s.',
    'Migration conflict: check supabase/migrations/ for duplicate timestamps. Run supabase db diff to compare remote vs local.',
    'Type drift: database schema changed without regenerating types. Run: supabase gen types typescript --project-ref $REF > src/types/database.ts',
    'Connection pool exhausted: use Supabase connection pooler (Transaction mode) for Edge Functions. Direct connections exhaust pool.',
    'Anon key vs service role: anon key respects RLS (use for frontend). Service role bypasses RLS (use only in Edge Functions/migrations).',
  ],
};

// ---------------------------------------------------------------------------
// RAILWAY KNOWLEDGE
// ---------------------------------------------------------------------------

const RAILWAY_KNOWLEDGE = {
  summary: 'Railway.app is used only for the proxy-server static-IP integration surface.',
  services: {
    bob_inference: {
      name: 'inference-service (Bob)',
      root: 'inference-service/',
      dockerfile: 'inference-service/Dockerfile',
      railway_json: 'deprecated (Bob now runs on RunPod)',
      port: 3000,
      health_path: '/health',
      health_timeout: 60,
      start_command: 'node server.js',
      deploy_workflow: '.github/workflows/build-ai-worker.yml',
      secrets_needed: ['INFERENCE_API_KEY', 'SUPABASE_URL', 'SUPABASE_JWKS_URL', 'SUPABASE_JWT_ISSUER', 'OLLAMA_BASE_URL', 'BOB_OPERATING_MODE'],
      notes: 'Runs on RunPod serverless endpoint. Multi-stage Docker build: Python ONNX model export → Node builder → production image. Non-root nodejs user.',
    },
    proxy_server: {
      name: 'proxy-server (NZSCV)',
      root: 'proxy-server/',
      port: 3000,
      health_path: '/health',
      deploy_workflow: '.github/workflows/deploy-proxy-railway.yml',
      secrets_needed: ['PROXY_SECRET', 'NZSCV_API_KEY', 'NZSCV_ID_KEY', 'NZSCV_ENDPOINT_URL', 'MOTORWEB_API_KEY'],
      notes: 'Proxies requests to NZ government NZSCV API and MotorWeb. PROXY_SECRET authenticates Edge Functions.',
    },
    ptt_server: {
      name: 'ptt-server (PTT Signaling)',
      root: 'ptt-server/',
      dockerfile: 'ptt-server/Dockerfile',
      railway_json: 'ptt-server/railway.json',
      port: 3002,
      health_path: '/health',
      health_timeout: 30,
      deploy_workflow: '.github/workflows/deploy-voice-server.yml',
      secrets_needed: ['PTT_JWT_SECRET', 'PROXY_SECRET', 'MAX_PARTICIPANTS_PER_CHANNEL', 'TURN_URL', 'TURN_USERNAME', 'TURN_CREDENTIAL'],
      host: 'VPS 72.61.123.97 (srv1601189.hstgr.cloud, Ubuntu 22.04, Malaysia/KL, KVM 2, 8GB RAM, 100GB disk)',
      port: 8080,
      turn_port: 3478,
      notes: 'WebSocket signaling server for PTT. In-memory state (single instance). PROXY_SECRET must match Supabase Edge Function secret.',
    },
    ollama: {
      name: 'ollama (Local LLM)',
      root: 'ollama/',
      dockerfile: 'ollama/Dockerfile',
      railway_json: 'deprecated (Ollama now runs with Bob on RunPod)',
      port: '11434 (co-located with Bob on RunPod pod)',
      health_path: '/api/tags',
      health_timeout: 300,
      deploy_workflow: '.github/workflows/build-ai-worker.yml',
      internal_url: 'http://127.0.0.1:11434 — Ollama runs on the same RunPod pod as Bob',
      notes: 'Ollama pinned at 0.20.2. OLLAMA_ORIGINS=*. OLLAMA_KEEP_ALIVE=24h. CRITICAL: Bob OLLAMA_BASE_URL must be http://127.0.0.1:11434 when Ollama runs co-located on the same RunPod pod.',
    },
  },
  deployment: {
    github_token: 'RUNPOD_API_KEY=RUNPOD_ENDPOINT_API_KEY — for Bob+Ollama on RunPod. RAILWAY_TOKEN (Proxy). PTT via SSH deploy.',
    cli: 'railway login → railway link → railway up → railway status (get URL) → railway logs (view logs)',
    env_vars: 'railway variables set KEY=value. Or Railway Dashboard → Service → Variables.',
    health_check: 'Railway calls healthcheckPath after deploy. If it returns non-200 within healthcheckTimeout seconds, deploy is marked failed.',
    restart_policy: 'ON_FAILURE with 3 max retries. Service restarts automatically on crash.',
    private_networking: 'Only proxy-server remains on Railway. Bob+Ollama on RunPod. PTT+TURN on VPS 72.61.123.97.',
    scaling: 'numReplicas: 1 (default). In-memory state (PTT, Bob self-learning) means multi-instance requires Redis for shared state.',
    ports: 'Railway auto-assigns PORT env var. Services must listen on process.env.PORT or Railway will not route traffic.',
    domains: 'Railway auto-assigns *.railway.app domains. Custom domains can be added via dashboard.',
  },
  common_issues: [
    'Service crash on startup: for proxy, check Railway logs dashboard. For Bob/Ollama, check RunPod logs and worker startup.',
    'Health check timeout: proxy uses Railway checks. Bob/Ollama use RunPod endpoint health and job status.',
    'OOM (Out of Memory): ONNX models need RAM. Bob needs at least 1GB RAM. Upgrade RunPod pod GPU/RAM if OOM errors appear.',
    'Deploy failed: check GitHub Actions logs. Bob/Ollama deploy through build-ai-worker.yml; proxy deploys via deploy-proxy-railway.yml.',
    'Ollama not responding: check circuit breaker state via GET /health on Bob. Breaker opens after 3 failures. Reset: wait 60s (OLLAMA_CB_COOLDOWN_MS) or redeploy Ollama.',
    'OLLAMA not reachable: verify OLLAMA_BASE_URL=http://127.0.0.1:11434 and that Ollama is running on the same RunPod pod.',
    'RAILWAY_TOKEN expired: regenerate in Railway dashboard → Account → Tokens. Update GitHub secret: GitHub → Settings → Secrets → RAILWAY_BOB_TOKEN.',
  ],
};

// ---------------------------------------------------------------------------
// GITHUB CI/CD KNOWLEDGE
// ---------------------------------------------------------------------------

const GITHUB_KNOWLEDGE = {
  repo: 'DonSquires/FreedomCamp-Manager',
  workflows_count: 25,
  deployment_workflows: {
    'deploy-frontend.yml': 'Deploys React/Vite admin to Vercel. Triggers on main push or workflow_dispatch. Supports production/preview environments. Uses VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID.',
    'build-ai-worker.yml': 'Active Bob/Ollama deployment workflow to RunPod serverless.',
    'deploy-railway.yml': 'DEPRECATED: Bob/inference moved to RunPod. Only proxy-server deploy (deploy-proxy-railway.yml) is active on Railway.',
    'deploy-proxy-railway.yml': 'Deploys proxy-server to Railway. Triggers on proxy-server/ changes. 45s health wait.',
    'deploy-mobile.yml': 'Deploys mobile app via Expo EAS. Requires EXPO_TOKEN, EXPO_PROJECT_ID. Builds for android/ios/all. OTA updates via EAS Update.',
    'deploy-edge-functions.yml': 'Deploys 47 Supabase Edge Functions. Triggers on supabase/functions/ changes. JWT verification auto-detected via PUBLIC_FUNCTIONS list.',
  },
  database_workflows: {
    'db-push.yml': 'Production schema migration. Manual only. Requires approval from @DonSquires. Environment: production-schema.',
    'db-migration-check.yml': 'Pre-deploy validation. Detects conflicts (short-form vs long-form names), exact duplicates, future-dated migrations.',
    'db-run-migrations.yml': 'Developer utility. Actions: list, apply-all, apply-one. Via supabase CLI or psql.',
    'db-schema-extract.yml': 'Schema introspection. Strategy 1: Supabase Management API. Strategy 2: Local migration replay. Outputs TypeScript types.',
  },
  ops_workflows: {
    'ops-bob-feedback-sync.yml': 'Daily cron (03:47 NZST). Syncs feedback events to Bob /learn/ingest-feedback.',
    'ops-nightly-self-learning-pretrain.yml': 'Daily cron (04:21 NZST). POST to Bob /learn/pretrain with nz-enforcement-v1 profile.',
    'ops-intel-feed-sync.yml': 'Every 6 hours. Harvests intel feeds, sends to Bob /intel/ingest-bulletin.',
    'ops-parkpow-sync.yml': 'Nightly 02:00 UTC. Syncs parking data from ParkPow API.',
    'ops-geofence-review.yml': 'Monthly (1st of month). Reviews zone geofences for staleness.',
    'set-ptt-secret.yml': 'One-shot manual. Sets PTT_SERVER_URL (http://72.61.123.97:8080), PROXY_SERVER_URL, INFERENCE_SERVICE_URL in Supabase Edge Function secrets.',
    'bug-report-escalator.yml': 'Every 10 minutes. Escalates stale bug reports older than configurable threshold.',
    'synthetic-monitor.yml': 'Every 30 minutes. Checks frontend, Supabase API, and Playwright render. Files bug reports on failure.',
    'sync-bob-repo.yml': 'Mirrors inference-service/ to DonSquires/Bob repo via BOB_SYNC_PAT.',
    'build-plan-crossover-gates.yml': 'Multi-stage CI gate: web build → Edge API tests → inference self-contained test → mobile Expo gate → summary.',
  },
  secrets: {
    required_secrets: [
      'RUNPOD_API_KEY — RunPod API key for Bob+Ollama pod (= RUNPOD_ENDPOINT_API_KEY)',
      'PTT_SERVER_URL — VPS PTT server URL (e.g. http://72.61.123.97:3002)',
      'RAILWAY_PROXY_SERVICE_ID — Railway service ID for proxy-server',
      'RUNPOD_ENDPOINT_ID — RunPod serverless endpoint ID for Bob',
      'VERCEL_TOKEN — Vercel deployment token',
      'VERCEL_ORG_ID — Vercel team/org ID',
      'VERCEL_PROJECT_ID — Vercel project ID',
      'SUPABASE_ACCESS_TOKEN — Supabase CLI/API access token',
      'SUPABASE_PROJECT_REF — Project ref: kxwjcupuxnnbnzcgmkoi',
      'VITE_SUPABASE_URL — https://kxwjcupuxnnbnzcgmkoi.supabase.co',
      'VITE_SUPABASE_ANON_KEY — Supabase anonymous key (frontend)',
      'EXPO_TOKEN — Expo/EAS authentication token',
      'EXPO_PROJECT_ID — 9ec25722-38ca-44d3-a8f5-62a8d8a64e6d',
      'BOB_FEEDBACK_SYNC_URL, BOB_FEEDBACK_SYNC_KEY — feedback sync endpoint',
      'BOB_SYNC_PAT — GitHub PAT for syncing to DonSquires/Bob repo',
      'INFERENCE_API_KEY — API key for Bob inference service (x-inference-api-key header)',
    ],
    set_secrets: 'GitHub → repository → Settings → Secrets and variables → Actions → New repository secret.',
    env_protection: 'db-push.yml uses "production-schema" environment which requires @DonSquires approval.',
  },
  codespaces: {
    summary: 'GitHub Codespaces configured via .devcontainer/devcontainer.json. Cloud development environment.',
    features: ['Node.js 22', 'Bun (latest)', 'GitHub CLI', 'Supabase CLI 2.78.1', 'Deno'],
    vscode_extensions: ['ESLint', 'Prettier', 'Tailwind CSS IntelliSense', 'TypeScript (next)', 'SQLTools (PostgreSQL)', 'Deno', 'GitHub Copilot', 'GitHub PR'],
    ports: { '5173': 'Vite Dev Server (auto-preview)', '3000': 'Proxy Server', '3002': 'PTT Signaling Server', '8080': 'Inference Service (Bob)' },
    setup: 'onCreateCommand copies .env.example → .env. postCreateCommand runs bun install. postStartCommand starts dev server (logs ~/vite-dev.log).',
    start_dev: 'bun run dev — starts Vite at http://localhost:5173. Codespace auto-forwards port for browser preview.',
  },
  copilot: {
    summary: 'GitHub Copilot provides AI code suggestions within VS Code/Codespaces. Copilot Agent (copilot-swe-agent) is also used for automated code changes via this task system.',
    agent_branch: 'Copilot agent creates branches named copilot/* and submits pull requests.',
    notes: 'Copilot cannot execute server-side code or access production systems — it operates on the codebase only.',
  },
  common_issues: [
    'Deploy workflow failed: go to Actions tab → find workflow run → click failed job → read error near bottom.',
    'bun install --frozen-lockfile fails: bun.lock is outdated. Run: bun install (updates lockfile) → commit bun.lock.',
    'TypeScript build fails: run bun run build locally → fix type errors → push.',
    'Railway token expired (for proxy): regenerate in Railway dashboard → update RAILWAY_TOKEN GitHub secret.',
    'Supabase CLI auth failed: regenerate in Supabase dashboard → Account → Access Tokens → update SUPABASE_ACCESS_TOKEN.',
    'Edge Function deploy 401: SUPABASE_ACCESS_TOKEN expired or wrong project ref.',
    'Workflow not triggering: check "on" conditions — path filters may not match changed files.',
  ],
};

// ---------------------------------------------------------------------------
// VERCEL KNOWLEDGE
// ---------------------------------------------------------------------------

const VERCEL_KNOWLEDGE = {
  summary: 'Vercel hosts the React/Vite frontend admin portal. SPA with rewrites to /index.html for client-side routing.',
  config_file: 'vercel.json at repo root.',
  build: {
    command: 'bun run build',
    install_command: 'bun install',
    output_directory: 'dist/',
    framework: 'Vite (React SPA)',
    env_vars: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_PROXY_SERVER_URL', 'VITE_INFERENCE_SERVICE_URL', 'VITE_ENVIRONMENT'],
  },
  routing: 'rewrites: [{ source: "/(.*)", destination: "/index.html" }] — all routes go to index.html for react-router-dom to handle.',
  security_headers: [
    'Strict-Transport-Security: max-age=31536000; includeSubDomains; preload',
    'X-Frame-Options: DENY',
    'X-Content-Type-Options: nosniff',
    'X-XSS-Protection: 1; mode=block',
    'Referrer-Policy: strict-origin-when-cross-origin',
    'Permissions-Policy: geolocation=(self), camera=(self), microphone=(self)',
    'CSP: default-src self; script-src self unsafe-inline cdn.jsdelivr.net; connect-src self *.supabase.co *.railway.app',
  ],
  caching: 'Assets (/assets/*): public, max-age=31536000, immutable (1 year). HTML: no-cache. Service worker (sw.js): Service-Worker-Allowed: /.',
  environments: {
    production: 'Deploys from main branch. Uses VITE_SUPABASE_URL_PRODUCTION + VITE_SUPABASE_ANON_KEY_PRODUCTION.',
    preview: 'Deploys from PR branches. Uses VITE_SUPABASE_URL_PREVIEW + VITE_SUPABASE_ANON_KEY_PREVIEW. URL: *.vercel.app.',
  },
  domains: {
    primary: 'fcmanager.co.nz — custom domain pointed to Vercel via DNS CNAME/A record.',
    preview: '*.vercel.app auto-generated per deployment. Listed in Supabase auth redirect_urls.',
    ssl: 'Automatic Let\'s Encrypt via Vercel. HSTS enforced via Strict-Transport-Security header.',
  },
  deploy_command: 'Triggered automatically by deploy-frontend.yml on push to main. Manual: vercel --prod (from CLI).',
  common_issues: [
    'Build fails: run bun run build locally to check TypeScript errors. Vercel mirrors local build.',
    'Routes return 404: check vercel.json rewrites section. Must have catch-all to /index.html.',
    'ENV vars missing: add in Vercel Dashboard → Project → Settings → Environment Variables. Must be prefixed VITE_ for client-side access.',
    'CSP blocking request: check Content-Security-Policy header. Add allowed domains to connect-src or script-src.',
    'Preview URL not in allowed origins: add *.vercel.app to Supabase redirect_urls in supabase/config.toml.',
    'CORS error from Supabase: check Supabase project allowed URLs. Verify VITE_SUPABASE_URL matches the project.',
  ],
};

// ---------------------------------------------------------------------------
// EXPO / MOBILE APP KNOWLEDGE
// ---------------------------------------------------------------------------

const EXPO_KNOWLEDGE = {
  summary: 'React Native mobile app using Expo framework. EAS (Expo Application Services) for builds and OTA updates.',
  config_file: 'mobile-app/app.json',
  project: {
    name: 'FieldOps Manager',
    slug: 'fieldops-manager',
    owner: 'iron-eagle-security',
    version: '1.0.0',
    eas_project_id: '9ec25722-38ca-44d3-a8f5-62a8d8a64e6d',
    updates_url: 'https://u.expo.dev/9ec25722-38ca-44d3-a8f5-62a8d8a64e6d',
  },
  android: {
    package: 'com.ironeagle.fieldops.manager',
    permissions: ['CAMERA', 'ACCESS_FINE_LOCATION', 'ACCESS_BACKGROUND_LOCATION', 'VIBRATE'],
    adaptive_icon_color: '#1e40af',
  },
  ios: {
    bundle_id: 'com.ironeagle.fieldops.manager',
    camera_usage: 'Camera is needed to photograph vehicle plates as evidence',
    location_usage: 'GPS location recorded with each scan for geofence assignment',
    background_location: 'Background GPS tracks patrol activity for lone-worker welfare',
  },
  plugins: ['expo-secure-store', 'expo-camera', 'expo-location', 'expo-notifications'],
  eas: {
    build_profiles: 'production (app store), preview (internal testing), development (dev client)',
    deploy_workflow: '.github/workflows/deploy-mobile.yml',
    required_secrets: ['EXPO_TOKEN', 'EXPO_PROJECT_ID', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'],
    ota_updates: 'Over-the-air JS updates via EAS Update. No app store submission needed for JS-only changes.',
    eas_build: 'eas build --platform android --profile production — submits to EAS Build queue.',
    eas_submit: 'eas submit --platform android — submits to Google Play (automatic store upload).',
    keystore: 'Generated via ops-generate-keystore.yml workflow. RSA 2048, 10,000 days. Store base64-encoded as ANDROID_KEYSTORE_BASE64 secret.',
  },
  ptt_mobile: 'PTT on mobile uses Expo Audio + WebSocket (not WebRTC). Mobile PTT background service implemented as Expo foreground service with persistent notification.',
  common_issues: [
    'EAS build failed: check Expo dashboard → your project → builds. Common: missing secret, keystore issue.',
    'OTA update not received: ensure eas update --channel production was run. Users need to reopen app to receive update.',
    'Location permissions denied: check iOS/Android app settings. Background location needs explicit user approval.',
    'EXPO_TOKEN expired: regenerate at expo.dev → Account → Access Tokens → update GitHub secret.',
    'Bundle ID conflict: com.ironeagle.fieldops.manager must be unique in app stores. Ensure it is not registered by another team.',
  ],
};

// ---------------------------------------------------------------------------
// DOMAIN & DNS KNOWLEDGE
// ---------------------------------------------------------------------------

const DOMAIN_DNS_KNOWLEDGE = {
  summary: 'Primary domain: fcmanager.co.nz. Hosted on Vercel (frontend) and Supabase (auth/API). SSL via Let\'s Encrypt (auto-managed).',
  primary_domain: 'fcmanager.co.nz',
  domains_in_use: {
    'fcmanager.co.nz': 'Frontend (Vercel). DNS CNAME to Vercel. Also Supabase site_url for auth.',
    'www.fcmanager.co.nz': 'Alias for main domain. Also in Supabase redirect_urls.',
    'freedomcampmanager.onspace.build': 'Onspace.ai hosted preview build. Also in Supabase redirect_urls.',
    '*.onspace.build': 'Wildcard for Onspace ephemeral preview builds.',
    '*.vercel.app': 'Vercel preview deployments (auto-generated per PR).',
    '*.railway.app': 'Railway proxy-server only (auto-assigned). Bob is on RunPod, PTT is on VPS 72.61.123.97.',
    'kxwjcupuxnnbnzcgmkoi.supabase.co': 'Supabase project URL. All Edge Functions and API calls go here.',
  },
  ssl: {
    vercel: 'Automatic TLS via Let\'s Encrypt. HSTS enforced. Renewal is fully automatic.',
    supabase: 'Automatic TLS on supabase.co subdomain and custom domain (if configured).',
    railway: 'Automatic TLS on *.railway.app. Custom domains can be added in Railway dashboard.',
    enforcement: 'ptt-server enforces HTTPS in production by checking x-forwarded-proto header. Returns 400 for plain HTTP.',
  },
  dns_management: {
    registrar: '.co.nz domains registered via NZRS (New Zealand Domain Name Commission). Common registrars: Metaname, Domainz, Cheap NZ.',
    records_for_vercel: 'Add CNAME: www → cname.vercel-dns.com. Add A record: @ → 76.76.21.21 (Vercel IP).',
    records_for_supabase: 'Supabase custom domain via Dashboard → Settings → Custom Domains. Adds a CNAME record.',
    ttl: 'Set low TTL (300s) when migrating domains to avoid downtime.',
    propagation: 'DNS changes propagate in minutes to hours. Use dig or nslookup to verify.',
  },
  cors_allowlist: {
    supabase_edge_functions: ['https://fcmanager.co.nz', 'https://www.fcmanager.co.nz', 'https://*.onspace.build'],
    ptt_server: ['https://freedomcampmanager.onspace.build', 'https://fcmanager.co.nz', 'https://www.fcmanager.co.nz', 'https://preview-react-9b4t5o-*.onspace.build'],
    vercel_csp: 'connect-src: self *.supabase.co wss://*.supabase.co *.railway.app',
  },
  common_issues: [
    'Domain not resolving: check DNS records in registrar dashboard. CNAME for www, A record for apex.',
    'SSL certificate not issued: ensure DNS propagated before Let\'s Encrypt verification. Can take up to 24h.',
    'CORS blocked by browser: add origin to allowlist in withCors.ts (Edge Functions) or ptt-server corsOptions.',
    'Redirect URL mismatch (Supabase auth): add new domain to redirect_urls in supabase/config.toml + redeploy.',
    'HSTS lock-in: if site served over HTTP by mistake, HSTS preload blocks HTTP permanently. Always use HTTPS.',
  ],
};

// ---------------------------------------------------------------------------
// EMAIL / SMTP KNOWLEDGE
// ---------------------------------------------------------------------------

const EMAIL_SMTP_KNOWLEDGE = {
  summary: 'Email sending via Zoho SMTP (primary SMTP relay) and Resend API (transactional email). Per-org SMTP configuration supported.',
  smtp_config: {
    provider: 'Zoho Mail (smtp.zoho.com)',
    host: 'smtp.zoho.com',
    port: 465,
    security: 'SSL/TLS (not STARTTLS)',
    auth: 'Username + App-Specific Password (not account password)',
    from_email: 'Configured per deployment (e.g., noreply@fcmanager.co.nz)',
    from_name: 'FieldOps Manager',
    env_vars: 'SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_EMAIL, SMTP_FROM_NAME, SITE_URL',
    config_location: 'proxy-server/.env (global SMTP). supabase Edge Functions read per-org SMTP from DB via _shared/orgConfig.ts.',
  },
  resend: {
    summary: 'Resend (resend.com) is the transactional email API. Used for infringement notices, system emails, notifications.',
    env_var: 'RESEND_API_KEY — set in Supabase Edge Function secrets.',
    api: 'POST https://api.resend.com/emails with { from, to, subject, html }. Authorization: Bearer <RESEND_API_KEY>.',
    from_domain: 'Must have SPF/DKIM records on sending domain. Add MX records for domain via Resend dashboard.',
  },
  per_org_smtp: {
    summary: 'Each organization can have its own SMTP config stored encrypted in the DB.',
    table: 'organization_smtp_config (or similar). Retrieved via _shared/orgConfig.ts: getSmtpConfig(orgId).',
    fallback: 'Falls back to global SMTP config if org-specific not configured.',
    encryption: 'SMTP passwords stored encrypted in org credentials table.',
  },
  email_templates: {
    location: 'supabase/templates/ — invite.html, recovery.html, confirmation.html, magic_link.html',
    branding: 'Iron Eagle Security branding. SITE_URL variable injected into templates.',
    customization: 'Edit HTML templates in supabase/templates/. Deploy via: supabase link + supabase db push.',
  },
  dns_for_email: {
    spf: 'SPF record on fcmanager.co.nz: v=spf1 include:zoho.com include:sendgrid.net ~all',
    dkim: 'Add DKIM TXT records from Zoho/Resend dashboard to DNS.',
    dmarc: 'Add DMARC TXT record: v=DMARC1; p=quarantine; rua=mailto:dmarc@fcmanager.co.nz',
    mx: 'MX records needed if receiving email (not just sending). Zoho MX: mx.zoho.com.',
  },
  common_issues: [
    'Emails going to spam: check SPF/DKIM/DMARC DNS records. Verify sending domain in Resend/Zoho dashboard.',
    'SMTP authentication failed: use App-Specific Password (not main account password) for Zoho. Enable in Zoho account security settings.',
    'Email template not rendering: check supabase/templates/ HTML. Variables: {{ .Token }}, {{ .SiteURL }}, {{ .Email }}.',
    'Resend API 403: RESEND_API_KEY not set or expired. Verify in Supabase dashboard → Edge Functions → Secrets.',
    'Emails bouncing: check recipient address validity. Resend dashboard shows bounce/complaint rates.',
    'Rate limiting: Zoho SMTP limits: 200 emails/day on free plan. Resend scales better for high volume.',
  ],
};

// ---------------------------------------------------------------------------
// HYBRID STACK KNOWLEDGE
// ---------------------------------------------------------------------------

const HYBRID_STACK_KNOWLEDGE = {
  summary: 'FieldOps Manager is a hybrid multi-layer system: web admin portal + mobile field app + multiple backend microservices + managed BaaS. All layers communicate via secured APIs.',
  architecture: {
    layers: [
      {
        name: 'Web Admin Portal',
        tech: 'React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui',
        host: 'Vercel (CDN)',
        url: 'https://fcmanager.co.nz',
        connects_to: ['Supabase Auth', 'Supabase Database (via REST/Realtime)', 'Supabase Edge Functions', 'Bob inference service', 'PTT signaling server'],
      },
      {
        name: 'Mobile Field App',
        tech: 'React Native + Expo SDK',
        host: 'iOS App Store + Google Play (via EAS)',
        connects_to: ['Supabase Auth', 'Supabase Database', 'Supabase Edge Functions', 'PTT signaling server (WebSocket audio)'],
      },
      {
        name: 'Supabase Backend (BaaS)',
        tech: 'PostgreSQL 17 + Supabase Auth + Edge Functions (Deno) + Storage + Realtime',
        host: 'Supabase cloud (AWS ap-southeast-2)',
        url: 'https://kxwjcupuxnnbnzcgmkoi.supabase.co',
        connects_to: ['Bob inference (via Edge Functions)', 'Proxy server (via Edge Functions)', 'PTT server (via Edge Functions)'],
      },
      {
        name: 'Bob Inference Service',
        tech: 'Node.js + Express + ONNX Runtime + Ollama',
        host: 'RunPod serverless',
        url: 'https://api.runpod.ai/v2/<RUNPOD_ENDPOINT_ID>/runsync',
        connects_to: ['Ollama LLM (co-located on RunPod pod via 127.0.0.1:11434)', 'Supabase (for JWKS validation)'],
      },
      {
        name: 'Proxy Server',
        tech: 'Node.js + Express',
        host: 'Railway',
        connects_to: ['NZSCV API (NZ vehicle registration)', 'MotorWeb API (vehicle data)', 'Supabase Edge Functions (authenticated via PROXY_SECRET)'],
      },
      {
        name: 'PTT Signaling Server',
        tech: 'Node.js + Express + WebSocket (ws)',
        host: 'VPS 72.61.123.97',
        connects_to: ['Web browser (WebSocket)', 'Mobile app (WebSocket)', 'Supabase Edge Function (ptt-signaling-token → /api/token/mint)'],
      },
      {
        name: 'Ollama LLM',
        tech: 'Ollama 0.20.2 with qwen2.5:7b',
        host: 'RunPod pod (co-located with Bob)',
        connects_to: ['Bob inference service (RunPod pod)'],
      },
    ],
  },
  data_flows: {
    officer_scan: 'Officer scans plate → Mobile app → Supabase Edge Function (check-nzscv-status) → Proxy Server → NZSCV API → returns vehicle info → stores observation → triggers compliance check',
    compliance_breach: 'Observation recorded → Edge Function (recalculate-compliance) → checks zone rules → if breach: creates breaches record → admin UI shows alert',
    ptt_call: 'Officer presses PTT → Frontend → ptt-signaling-token Edge Function → PTT server mints JWT → WebSocket connection → WebRTC audio peer-to-peer',
    ai_inference: 'Photo uploaded → Edge Function → POST to Bob /infer/alpr → ONNX model → OCR result → returned to Edge Function → stored in DB',
    self_learning: 'Daily cron (GitHub Actions) → POST to Bob /learn/pretrain → Bob updates thresholds → persisted to data/self-learning-state.json',
    bug_escalation: 'System error → synthetic-monitor.yml OR frontend catch → bug_reports table → bug-report-escalator.yml → auto-analyse-report workflow → Bob /self-heal/bug-report → analysis stored',
  },
  security_model: {
    frontend: 'JWT from Supabase Auth. All DB access via RLS policies. No direct DB connection from frontend.',
    edge_functions: 'Service role key for DB access. PROXY_SECRET for microservice auth. JWT verification optional per function.',
    microservices: 'Bob: x-inference-api-key header. Proxy: PROXY_SECRET. PTT: PTT_JWT_SECRET + PROXY_SECRET.',
    inter_service: 'Bob+Ollama co-located on same RunPod pod (loopback 127.0.0.1). No public networking required for Bob↔Ollama.',
    bob: 'Bob supports self-contained and build-training modes. Self-contained blocks outbound cloud calls; build-training enables upstream providers and JWKS auth. Knowledge remains grounded in code modules plus approved training inputs.',
  },
  similar_systems: {
    summary: 'Similar field enforcement apps for context',
    examples: [
      'ParkPow — parking violation management. Similar to FieldOps breach management. FieldOps integrates ParkPow via parkpow.ts shared module.',
      'Genetec Security Center — unified security and video surveillance platform. Similar multi-tenant officer management model.',
      'Axon Field — body camera + evidence management for law enforcement. Similar evidence chain-of-custody model.',
      'Veolia SMART — environmental enforcement platform. Similar zone-based violation detection.',
      'Parking+Plus (NZ) — NZ council parking enforcement. Similar NZ compliance/infringement notice workflow.',
      'Connect IT (NZ) — NZ field inspection software. Similar multi-org, mobile-first design.',
    ],
    differentiators: [
      'AI-first: ONNX ALPR, face recognition, and self-learning built into Bob inference service',
      'Privacy-first: explicit operating modes, NZ Privacy Act compliance, audit trails',
      'NZ-specific: NZSCV register integration, NZ legal framework (FCA 2011, NZBORA), NZ timezone',
      'PTT built-in: walkie-talkie voice comms without third-party app (unlike Zello or Teams)',
      'Multi-org: councils and contractors on same platform, org-scoped data isolation',
      'Welfare-aware: lone-worker GPS tracking, incident escalation to Police',
    ],
  },
  build_commands: {
    frontend: 'bun run dev (dev server), bun run build (production), bun run lint (ESLint), npx vitest run (unit tests)',
    mobile: 'eas build --platform android, eas update --channel production (OTA)',
    edge_functions: 'supabase functions deploy <name> --project-ref kxwjcupuxnnbnzcgmkoi',
    bob: 'node server.js (with env vars), BOB_OPERATING_MODE=self-contained CHAT_PROVIDER=heuristic node server.js, or BOB_OPERATING_MODE=build-training CHAT_PROVIDER=ollama node server.js',
    migrations: 'supabase db push --project-ref kxwjcupuxnnbnzcgmkoi',
    types: 'supabase gen types typescript --project-ref kxwjcupuxnnbnzcgmkoi > src/types/database.ts',
  },
};

// ---------------------------------------------------------------------------
// RAILWAY SERVICES AUDIT KNOWLEDGE
// Teaches Bob how to assess, detect and explain service config issues (RunPod/VPS/Railway).
// Used by POST /assess/platform and GET /platform/railway.
// ---------------------------------------------------------------------------

const RAILWAY_SERVICES_AUDIT = {
  summary: 'Self-assessment rules for verifying all Railway service configurations are correct and internally consistent.',
  last_audited: '2026-04-14',
  audit_outcome: 'All issues resolved — see findings below for reference.',

  known_issues_resolved: [
    {
      id: 'RAIL-001',
      severity: 'high',
      service: 'Bob (inference-service)',
      file: 'inference-service/RAILWAY_DEPLOY.md',
      title: 'RAILWAY_DEPLOY.md "Bob Self-Contained Mode" table listed CHAT_PROVIDER and TABULAR_NLP_PROVIDER as "heuristic"',
      root_cause: 'Documentation was written with conservative local-dev defaults instead of production values. Production Bob uses Ollama for both, which is the whole point of deploying it.',
      fix_applied: 'Updated table to show CHAT_PROVIDER=ollama, TABULAR_NLP_PROVIDER=ollama, and added OLLAMA_BASE_URL=http://127.0.0.1:11434 and OLLAMA_MODEL=qwen2.5:7b to the required variables.',
      validation: 'ops-railway-wiring-audit.yml checks CHAT_PROVIDER=ollama and TABULAR_NLP_PROVIDER=ollama. Will now pass with correct production config.',
    },
    {
      id: 'RAIL-002',
      severity: 'high',
      service: 'Bob (inference-service)',
      file: 'inference-service/RAILWAY_DEPLOY.md',
      title: 'OLLAMA_BASE_URL in Optional table showed wrong port (3000 instead of 11434)',
      root_cause: 'Ollama listens on its default port 11434, not 3000. The wrong port causes Bob to silently fail Ollama connectivity.',
      fix_applied: 'Corrected to http://127.0.0.1:11434 in RAILWAY_DEPLOY.md and platform-knowledge.js (RunPod co-located pod).',
      validation: 'Bob health endpoint GET /health shows capabilities.chat_local_ollama_enabled=true when Ollama is reachable.',
    },
    {
      id: 'RAIL-003',
      severity: 'medium',
      service: 'PTT Server (ptt-server)',
      file: 'docs/RAILWAY_SERVICES_AUTHORITY.md',
      title: 'RAILWAY_SERVICES_AUTHORITY.md PTT section said "❌ No dedicated workflow yet" and listed wrong internal port (4000 vs 3002)',
      root_cause: 'Documentation not updated after deploy-ptt-railway.yml was created. PTT server listens on 3002 by default (not 4000).',
      fix_applied: 'Updated PTT row: deploy_workflow → deploy-ptt-railway.yml, internal URL port → 3002. Removed entire "Workarounds" section.',
      validation: 'push to main touching ptt-server/ now triggers deploy-ptt-railway.yml automatically.',
    },
    {
      id: 'RAIL-004',
      severity: 'medium',
      service: 'Bob (inference-service)',
      file: 'inference-service/Dockerfile',
      title: 'Bob Dockerfile HEALTHCHECK hardcoded port 3000 instead of reading process.env.PORT',
      root_cause: 'PTT and Proxy Dockerfiles correctly use process.env.PORT, but Bob was hardcoded. Both Railway proxy and RunPod assign $PORT dynamically.',
      fix_applied: 'Changed HEALTHCHECK CMD to use process.env.PORT || 3000.',
      validation: 'Healthcheck now respects Railway-assigned PORT env var.',
    },
    {
      id: 'RAIL-005',
      severity: 'medium',
      service: 'PTT Server (ptt-server)',
      file: 'ptt-server/.env.example',
      title: 'ptt-server/.env.example missing NODE_ENV=production',
      root_cause: 'PTT server has HTTPS-only enforcement middleware that checks x-forwarded-proto header, but only activates when NODE_ENV=production. Without it, the check is silently skipped in deployments that use the .env.example as a template.',
      fix_applied: 'Added NODE_ENV=production to ptt-server/.env.example.',
      validation: 'ptt-server enforces HTTPS in production. HTTP requests return 400 (not silently allowed).',
    },
    {
      id: 'RAIL-006',
      severity: 'low',
      service: 'Proxy Server (proxy-server)',
      file: '.github/workflows/deploy-proxy-railway.yml',
      title: 'Post-deploy health check grepped for the string "proxy" — fragile and imprecise',
      root_cause: 'The check worked incidentally (the service name "NZSCV Proxy Server" contains "proxy") but was not intentional. Any service name change would silently break the check.',
      fix_applied: 'Changed grep to check for "status":"ok" (the actual field the health endpoint returns).',
      validation: 'Health check now validates the semantic payload rather than a substring match.',
    },
    {
      id: 'RAIL-007',
      severity: 'low',
      service: 'Bob (inference-service) — platform-knowledge.js',
      file: 'inference-service/lib/platform-knowledge.js',
      title: 'platform-knowledge.js had wrong Ollama port (3000 vs 11434) and wrong PTT deploy workflow',
      root_cause: 'Bob\'s own knowledge base had stale data from an earlier experimental Ollama config that remapped the port. Also deploy-railway.yml was incorrectly described as deploying PTT (it deploys the legacy inference service).',
      fix_applied: 'Corrected Ollama port to 11434 in services.ollama, deployment.private_networking, and PLATFORM_DIAGNOSTICS.railway. Fixed PTT deploy_workflow to deploy-ptt-railway.yml. Corrected deploy-railway.yml description to say it deploys the legacy ONNX inference service.',
      validation: 'Bob now provides accurate service topology when asked. POST /assess/platform returns correct service config.',
    },
  ],

  assessment_checks: [
    {
      check_id: 'CHK-01',
      description: 'Verify Bob production env has CHAT_PROVIDER=ollama',
      how_to_verify: 'GET <BOB_URL>/health → check config.CHAT_PROVIDER === "ollama". If "heuristic", update Bob pod .env and restart.',
      expected: 'ollama',
      if_wrong: 'Set CHAT_PROVIDER=ollama in Bob pod .env. Bob will fall back to heuristic if Ollama is unreachable anyway.',
    },
    {
      check_id: 'CHK-02',
      description: 'Verify Bob production env has TABULAR_NLP_PROVIDER=ollama',
      how_to_verify: 'GET <BOB_URL>/health → check config.TABULAR_NLP_PROVIDER === "ollama". Validated by ops-railway-wiring-audit.yml.',
      expected: 'ollama',
      if_wrong: 'Set TABULAR_NLP_PROVIDER=ollama in Bob pod .env.',
    },
    {
      check_id: 'CHK-03',
      description: 'Verify Bob can reach Ollama via private network',
      how_to_verify: 'GET <BOB_URL>/health → check capabilities.chat_local_ollama_enabled === true.',
      expected: true,
      if_wrong: 'Check OLLAMA_BASE_URL=http://127.0.0.1:11434 on Bob (RunPod pod). Check Ollama is running on the same pod. Check Ollama service is running (GET <OLLAMA_URL>/api/tags returns 200).',
    },
    {
      check_id: 'CHK-04',
      description: 'Verify wiring audit passes (runs every hour)',
      how_to_verify: 'GitHub → Actions → Ops Railway Wiring Audit → most recent run should be green.',
      expected: 'passing',
      if_wrong: 'Read the audit job logs. Common failures: CHAT_PROVIDER not ollama, URL mismatch (GitHub secret vs Supabase edge function), service down.',
    },
    {
      check_id: 'CHK-05',
      description: 'Verify DEPLOY_SIGNATURE is set to bob-build-training-open-v1',
      how_to_verify: 'GET <BOB_URL>/health → check config.DEPLOY_SIGNATURE === "bob-build-training-open-v1". This is hardcoded in server.js and cannot be overridden.',
      expected: 'bob-build-training-open-v1',
      if_wrong: 'If wrong, the image is outdated. Redeploy Bob from the latest DonSquires/Bob main branch.',
    },
    {
      check_id: 'CHK-06',
      description: 'Verify Bob operating mode matches the intended deployment posture',
      how_to_verify: 'GET <BOB_URL>/health → check config.OPERATING_MODE. Use self-contained for locked-down production or build-training for internet-enabled build/training work.',
      expected: 'self-contained or build-training as intended',
      if_wrong: 'Set BOB_OPERATING_MODE in Bob pod .env and restart.',
    },
    {
      check_id: 'CHK-07',
      description: 'Verify OPENAI_API_KEY posture matches the operating mode',
      how_to_verify: 'GET <BOB_URL>/health → check config.OPENAI_API_KEY_SET and config.OPERATING_MODE together.',
      expected: 'false in self-contained mode; optional in build-training mode',
      if_wrong: 'Remove OPENAI_API_KEY in self-contained mode, or set CHAT_PROVIDER/TABULAR_NLP_PROVIDER appropriately in build-training mode.',
    },
    {
      check_id: 'CHK-08',
      description: 'Verify PTT server deploy workflow is deploy-ptt-railway.yml (not deploy-railway.yml)',
      how_to_verify: 'Check .github/workflows/deploy-ptt-railway.yml exists and has paths: [\'ptt-server/**\']. deploy-railway.yml deploys the legacy ONNX inference service.',
      expected: 'deploy-ptt-railway.yml',
      if_wrong: 'This was a documentation issue now resolved. The correct workflow is deploy-ptt-railway.yml.',
    },
  ],

  how_bob_should_respond: {
    when_asked_about_railway: 'Report the service topology: Bob+Ollama (RunPod pod), Proxy (Railway), PTT+TURN (VPS 72.61.123.97). Key Ollama URL: http://127.0.0.1:11434 (co-located on same RunPod pod).',
    when_asked_to_assess: 'Run through assessment_checks CHK-01 through CHK-08. Ask the user to share GET /health response from Bob for the config fields. Report each check result and remediation if needed.',
    when_asked_to_fix: 'Guide user to update Bob pod .env file on RunPod → restart container. Provide exact key=value pairs.',
  },
};

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

const PLATFORM_DIAGNOSTICS = {
  supabase: {
    keywords: ['supabase', 'rls', 'edge function', 'migration', 'auth', 'jwt', 'postgres', 'database', 'storage', 'realtime', 'row level security'],
    diagnosis: 'Supabase platform issue',
    checks: [
      { step: 'Check Edge Function logs', detail: 'Supabase Dashboard → Edge Functions → select function → Logs tab. Shows Deno runtime errors.' },
      { step: 'Check RLS policies', detail: 'Dashboard → Table Editor → select table → RLS tab. Use "Check policies" to simulate access for a user.' },
      { step: 'Check JWT token', detail: 'Browser DevTools → Application → Local Storage → supabase.auth.token. Check exp field (expiry). Refresh: supabase.auth.refreshSession().' },
      { step: 'Check Edge Function secrets', detail: 'Dashboard → Settings → Edge Functions → Secrets. Ensure all required env vars are set.' },
      { step: 'Check migration state', detail: 'supabase db diff --project-ref kxwjcupuxnnbnzcgmkoi — shows schema drift between migrations and live DB.' },
      { step: 'Check CORS preflight', detail: 'OPTIONS request to Edge Function must return 200 with Access-Control-Allow-Origin header. Import getCorsHeaders from _shared/withCors.ts.' },
      { step: 'Check service role usage', detail: 'Service role bypasses RLS — only use in Edge Functions/migrations. Frontend must use anon key.' },
      { step: 'Check connection pool', detail: 'Use Transaction mode pooler for Edge Functions. Direct connections exhaust the 25-connection limit.' },
    ],
  },
  railway: {
    keywords: ['railway', 'deploy', 'service', 'microservice', 'container', 'docker', 'oom', 'health check', 'railway token'],
    diagnosis: 'Railway deployment issue',
    checks: [
      { step: 'Check Railway service logs', detail: 'Railway Dashboard → select service → Deployments → select deployment → View Logs.' },
      { step: 'Check env vars on Railway', detail: 'Railway Dashboard → service → Variables tab. All secrets must be present. Missing vars cause startup crashes.' },
      { step: 'Check health endpoint', detail: 'GET https://<service>.railway.app/health — should return 200 with status:ok. Non-200 means deployment failed.' },
      { step: 'Check PORT binding', detail: 'Service MUST listen on process.env.PORT. Railway sets this automatically. Hardcoded ports will not receive traffic.' },
      { step: 'Check OOM errors', detail: 'Railway logs: "OOM" or "Killed". Upgrade to higher RAM plan in Railway Dashboard → service → Settings → Resources.' },
      { step: 'Check RAILWAY_TOKEN', detail: 'If deploy workflow fails: go to Railway Dashboard → Account → Tokens. Regenerate and update GitHub secret RAILWAY_BOB_TOKEN.' },
      { step: 'Check private networking', detail: 'Bob → Ollama must use http://127.0.0.1:11434 (co-located on same RunPod pod).' },
      { step: 'Check Docker build', detail: 'Review Dockerfile. Bob uses multi-stage: Python ONNX export → Node builder → production. Build errors in Stage 0 prevent model files from being present.' },
    ],
  },
  github: {
    keywords: ['github', 'action', 'workflow', 'ci', 'secret', 'codespace', 'deploy workflow', 'github action'],
    diagnosis: 'GitHub Actions / CI issue',
    checks: [
      { step: 'Find failed workflow run', detail: 'GitHub → Actions tab → find workflow → click failed run → click failed job → read error output.' },
      { step: 'Check bun.lock', detail: 'bun install --frozen-lockfile fails if bun.lock is outdated. Run bun install locally and commit the updated bun.lock.' },
      { step: 'Check GitHub secrets', detail: 'Settings → Secrets and variables → Actions. Verify all required secrets exist and are not expired.' },
      { step: 'Check workflow trigger conditions', detail: 'Look at "on:" section. Path filters must match changed files. Branch filters must match pushed branch.' },
      { step: 'Check environment protection', detail: 'db-push.yml uses "production-schema" environment which requires @DonSquires approval before running.' },
      { step: 'Check TypeScript build', detail: 'bun run build fails on type errors. Run locally: bun run build → fix errors → push.' },
      { step: 'Check service IDs', detail: 'RAILWAY_PTT_SERVICE_ID, RAILWAY_PROXY_SERVICE_ID must match current Railway service IDs. Re-check in Railway dashboard if deploys fail.' },
    ],
  },
  vercel: {
    keywords: ['vercel', 'frontend', 'build', '404', 'csp', 'content security', 'deploy frontend', 'static'],
    diagnosis: 'Vercel frontend deployment issue',
    checks: [
      { step: 'Check Vercel build logs', detail: 'Vercel Dashboard → project → Deployments → select deployment → Build Logs.' },
      { step: 'Check TypeScript errors', detail: 'Run bun run build locally. Vercel runs same command: tsc -b && vite build.' },
      { step: 'Check environment variables', detail: 'Vercel Dashboard → project → Settings → Environment Variables. Must be prefixed VITE_ for client access.' },
      { step: 'Check SPA routing', detail: 'All routes must rewrite to /index.html. Check vercel.json rewrites section.' },
      { step: 'Check CSP header', detail: 'Browser console: "Refused to connect". Add domain to connect-src in vercel.json Content-Security-Policy header.' },
      { step: 'Check Supabase redirect URLs', detail: 'After auth callback, Supabase redirects to redirect_url. Add new Vercel URL to supabase/config.toml redirect_urls.' },
      { step: 'Clear CDN cache', detail: 'Vercel → Deployments → select deployment → Revalidate. Or add cache-busting query to assets.' },
    ],
  },
  expo: {
    keywords: ['expo', 'mobile', 'eas', 'android', 'ios', 'react native', 'ota', 'build mobile'],
    diagnosis: 'Expo / mobile app issue',
    checks: [
      { step: 'Check EAS build logs', detail: 'expo.dev → project → Builds → select build → View Logs.' },
      { step: 'Check EXPO_TOKEN', detail: 'If workflow fails: regenerate at expo.dev → Account → Access Tokens. Update GitHub secret EXPO_TOKEN.' },
      { step: 'Check Android keystore', detail: 'ANDROID_KEYSTORE_BASE64 secret must contain base64-encoded keystore file. Generate via ops-generate-keystore.yml workflow.' },
      { step: 'Check OTA update', detail: 'Run: eas update --channel production --message "description". Users get update on next app open.' },
      { step: 'Check bundle identifier', detail: 'com.ironeagle.fieldops.manager must match what\'s registered in Google Play / Apple Developer. Must not change after first release.' },
      { step: 'Check Expo SDK version', detail: 'mobile-app/package.json shows expo SDK version. Ensure plugins (expo-camera, expo-location) are compatible.' },
    ],
  },
  email: {
    keywords: ['email', 'smtp', 'mail', 'zoho', 'resend', 'notification email', 'transactional', 'invitation', 'password reset'],
    diagnosis: 'Email / SMTP configuration issue',
    checks: [
      { step: 'Check Resend API key', detail: 'Supabase Dashboard → Edge Functions → Secrets → RESEND_API_KEY. Must be set for transactional email.' },
      { step: 'Check Zoho App Password', detail: 'Zoho account → Security → App Passwords. Generate app-specific password (not account password) for SMTP.' },
      { step: 'Check SPF/DKIM/DMARC records', detail: 'Use MXToolbox to check DNS records. SPF includes zoho.com and sendgrid.net. DKIM and DMARC must be set.' },
      { step: 'Check email templates', detail: 'supabase/templates/ — verify HTML syntax. Variables: {{ .Token }}, {{ .SiteURL }}, {{ .Email }}, {{ .RedirectTo }}.' },
      { step: 'Check per-org SMTP', detail: 'If specific org emails fail: check organization_smtp_config table. Verify encrypted password is correct.' },
      { step: 'Test SMTP connection', detail: 'From proxy-server: send test email using nodemailer with configured credentials. Check port 465 (SSL) or 587 (STARTTLS).' },
      { step: 'Check Resend sender domain', detail: 'Sending domain must be verified in Resend dashboard. Add SPF/DKIM records from Resend to DNS.' },
    ],
  },
  domain: {
    keywords: ['domain', 'dns', 'ssl', 'certificate', 'cors', 'origin', 'https', 'redirect url', 'custom domain'],
    diagnosis: 'Domain / DNS / SSL issue',
    checks: [
      { step: 'Check DNS propagation', detail: 'Use dig fcmanager.co.nz or https://dnschecker.org. Allow 5-30 minutes after DNS changes.' },
      { step: 'Check Vercel domain settings', detail: 'Vercel Dashboard → project → Settings → Domains. Add fcmanager.co.nz and configure CNAME/A records as shown.' },
      { step: 'Check SSL certificate', detail: 'Browser address bar → lock icon → Certificate. Let\'s Encrypt certs expire every 90 days (auto-renewed by Vercel).' },
      { step: 'Check Supabase redirect URLs', detail: 'supabase/config.toml redirect_urls list. Add any new domain. Redeploy Edge Functions after change.' },
      { step: 'Check CORS allowlist', detail: 'ptt-server corsOptions and _shared/withCors.ts. New domains must be added to allowedOrigins.' },
      { step: 'Check HSTS preload', detail: 'If HSTS preload was submitted, browser will refuse HTTP forever. Must serve HTTPS on all domains.' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

function getPlatformKnowledge(platform) {
  const key = String(platform || '').toLowerCase();
  const map = {
    supabase: SUPABASE_KNOWLEDGE,
    railway: RAILWAY_KNOWLEDGE,
    github: GITHUB_KNOWLEDGE,
    vercel: VERCEL_KNOWLEDGE,
    expo: EXPO_KNOWLEDGE,
    mobile: EXPO_KNOWLEDGE,
    domain: DOMAIN_DNS_KNOWLEDGE,
    dns: DOMAIN_DNS_KNOWLEDGE,
    email: EMAIL_SMTP_KNOWLEDGE,
    smtp: EMAIL_SMTP_KNOWLEDGE,
    hybrid: HYBRID_STACK_KNOWLEDGE,
    stack: HYBRID_STACK_KNOWLEDGE,
  };
  return map[key] || null;
}

function diagnosePlatformIssue(symptom) {
  const lowered = String(symptom || '').toLowerCase();
  const results = [];

  for (const [platform, diag] of Object.entries(PLATFORM_DIAGNOSTICS)) {
    let score = 0;
    for (const kw of diag.keywords) {
      if (lowered.includes(kw)) score += 1;
    }
    if (score > 0) {
      results.push({ platform, score, ...diag });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.length > 0 ? results[0] : { platform: 'general', diagnosis: 'General platform issue', checks: [
    { step: 'Check relevant service logs', detail: 'Vercel (frontend), RunPod (Bob), VPS 72.61.123.97 (PTT), Railway (Proxy), Supabase (Edge Functions), GitHub Actions (CI/CD).' },
    { step: 'Check environment variables', detail: 'Verify all required env vars are set on the relevant service.' },
    { step: 'Check network connectivity', detail: 'Ensure services can reach each other. Bob ↔ Ollama via 127.0.0.1 (same RunPod pod).' },
  ] };
}

function getHybridStackOverview() {
  return {
    layers: HYBRID_STACK_KNOWLEDGE.architecture.layers,
    data_flows: HYBRID_STACK_KNOWLEDGE.data_flows,
    security: HYBRID_STACK_KNOWLEDGE.security_model,
    build_commands: HYBRID_STACK_KNOWLEDGE.build_commands,
    similar_systems: HYBRID_STACK_KNOWLEDGE.similar_systems,
  };
}

module.exports = {
  SUPABASE_KNOWLEDGE,
  RAILWAY_KNOWLEDGE,
  RAILWAY_SERVICES_AUDIT,
  GITHUB_KNOWLEDGE,
  VERCEL_KNOWLEDGE,
  EXPO_KNOWLEDGE,
  DOMAIN_DNS_KNOWLEDGE,
  EMAIL_SMTP_KNOWLEDGE,
  HYBRID_STACK_KNOWLEDGE,
  PLATFORM_DIAGNOSTICS,
  getPlatformKnowledge,
  diagnosePlatformIssue,
  getHybridStackOverview,
};
