function trimText(value, maxLen = 1200) {
  const text = String(value || '').trim();
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

const KNOWLEDGE_PACKS = {
  build_context: {
    name: 'fieldops-build-context',
    summary: 'React + TypeScript frontend, Supabase backend, Railway inference microservice, with explicit self-contained and build-training modes.',
    key_points: [
      'Frontend stack: React 18, TypeScript, Vite, Tailwind, shadcn/ui.',
      'Backend stack: Supabase Postgres + Edge Functions + RLS.',
      'Inference stack: Node/Express + ONNX + OCR with local-first pathways.',
      'Operating modes: self-contained blocks outbound cloud egress; build-training enables external providers and JWKS auth for build and training work.',
      'CI gates should validate build, API behavior, and mobile compatibility.',
    ],
  },
  nz_compliance_context: {
    name: 'nz-compliance-context',
    summary: 'Operational guidance for privacy-by-design and evidence handling in New Zealand deployments.',
    key_points: [
      'Minimize personal data collection and retain only what is operationally necessary.',
      'Apply access controls, audit logging, and least privilege for enforcement data.',
      'Treat legal/compliance output as engineering guidance, not formal legal advice.',
      'Prefer deterministic local processing for sensitive imagery and identifiers.',
      'Ensure traceability of automated decisions and allow human review.',
    ],
  },
  nz_legal_framework: {
    name: 'nz-legal-framework',
    summary: 'Comprehensive NZ legal knowledge for Bob and Ollama. Both MUST abide by these rules and help humans work within them.',
    key_points: [
      'Privacy Act 2020: 13 Information Privacy Principles (IPPs). Minimise collection (IPP 1), ensure security (IPP 5), limit use (IPP 10), limit disclosure (IPP 11), restrict cross-border transfers (IPP 12). Mandatory breach reporting for serious harm.',
      'NZBORA 1990: Fundamental rights including freedom of movement (s 18), unreasonable search protection (s 21), right to natural justice (s 27). All enforcement actions must respect these rights. Automated decisions require human review.',
      'Freedom Camping Act 2011: Permits camping unless restricted by bylaw. Officers can issue infringement notices (≤$200), NTV, request name/address. Officers CANNOT arrest, detain, use force, or enter vehicles. Only Police have those powers.',
      'RMA 1991: Sustainable management of resources. Freedom camping must not cause environmental damage. Māori cultural sites need special consideration. Track environmental impact alongside compliance.',
      'Search and Surveillance Act 2012: Observation from public places is lawful. ALPR scanning from public roads is lawful. Entering vehicles/tents requires warrant or consent. Covert surveillance requires authorisation.',
      'Evidence Act 2006: Computer-generated evidence (ALPR, breach detection) is admissible if system reliability is established (s 137). Chain of custody must be documented. Improperly obtained evidence may be excluded.',
      'Policing Act 2008: Police have arrest powers — camping enforcement officers do not. Involve Police for threats, violence, refusal to identify, stolen vehicles, criminal activity. Share only necessary information, log all disclosures.',
      'NZDF: Defence land is outside council jurisdiction. NZDF may assist in civil emergencies. Military personnel subject to NZ law. Do not share surveillance data with NZDF without authorisation.',
      'AI guardrails (G1-G12): Privacy by design, lawful evidence only, human review required, proportionate enforcement, no Police powers, full audit trail, no cross-border leakage, data security, breach notification, respect for rights, not legal advice, vulnerable persons consideration.',
      'Criminal Procedure Act 2011: Infringement notices must include all required particulars. Individuals can challenge notices in court. Evidence integrity must be maintained. OIA 1982: Public can request enforcement data — store in retrievable format, separate personal data for redaction.',
    ],
  },
  coding_context: {
    name: 'solution-engineering-context',
    summary: 'Structured debugging and remediation planning for production systems.',
    key_points: [
      'Reproduce first, isolate root cause, then apply minimal targeted fix.',
      'Prioritize severity-based mitigation: security, data integrity, availability, UX.',
      'Add tests for regression prevention before shipping high-risk fixes.',
      'Prefer reversible rollout with feature flags when impact is uncertain.',
      'Document assumptions and unknowns in every remediation plan.',
    ],
  },
  codebase_coding: {
    name: 'fieldops-codebase-coding-knowledge',
    summary: 'Full coding knowledge for FieldOps Manager — same context as the Copilot coding agent. Enables Bob to guide code creation without GitHub.',
    key_points: [
      'Tech stack: React 18 + TypeScript + Vite + Tailwind CSS v3 + shadcn/ui. State: Zustand + TanStack Query v5. Forms: react-hook-form + zod. Package manager: bun.',
      'Project layout: pages in src/pages/, hooks in src/hooks/, stores in src/stores/, shadcn primitives in src/components/ui/, feature components in src/components/features/. Path alias @/* → ./src/*.',
      'Supabase client: always import { supabase } from "@/lib/supabase". Typed with Database from @/types/database. DB row types via Database["public"]["Tables"]["table"]["Row"].',
      'Edge Functions: supabase/functions/<name>/index.ts, Deno runtime, withCors + getCorsHeaders + jsonResponse + errorResponse from ../_shared/withCors.ts. Always handle OPTIONS preflight.',
      'Migrations: supabase/migrations/YYYYMMDD_HHMMSS_description.sql. Every table needs RLS enabled. Policies scope by auth.uid() + organization_id. After migration: regenerate types.',
      'Hooks pattern: useQuery for reads, useMutation for writes, invalidateQueries on success, toast from sonner for notifications. queryKey must include all filter variables.',
      'User roles: admin, master, officer, admin_officer. Route guards: RoleRoute, ProtectedRoute, AreaRoute in App.tsx. authStore.ts has current user + organization_id.',
      'TypeScript: noImplicitAny=false, strictNullChecks=false, skipLibCheck=true. Do NOT tighten. All datetimes in Pacific/Auckland timezone.',
      'shadcn/ui: import from @/components/ui/<component>. Never re-implement. Available: button, card, dialog, form, input, label, select, table, badge, alert, tabs, sheet, tooltip.',
      'Build: bun run build (tsc + vite). Dev: bun run dev. Lint: bun run lint. bun.lock must be committed — Railway uses --frozen-lockfile. Use POST /code/assist for coding guidance.',
    ],
  },
  ui_design_context: {
    name: 'ui-ux-design-assessment',
    summary: 'UI visualisation, layout analysis, colour assessment, accessibility auditing, and human-friendliness evaluation for FieldOps Manager pages.',
    key_points: [
      'Design system: Tailwind CSS v3 + shadcn/ui (Radix). HSL CSS variables for theming. Four themes: light, dark, high-contrast, night-patrol.',
      'Primary colour: teal (HSL 187 72% 37%). Accent: amber (HSL 48 96% 53%). Destructive: red (HSL 0 84% 60%). All from CSS custom properties.',
      'Night-patrol mode: pure black background, bright cyan primary, 56px min button height, 52px min input height, 17px base font — designed for gloves and low-light.',
      'WCAG accessibility: minimum AA contrast (4.5:1 text, 3:1 large text). Use ARIA attributes, semantic HTML, focus-visible rings, sr-only labels.',
      'Responsive breakpoints: sm 640px, md 768px, lg 1024px, xl 1280px. Mobile-first layout with flex/grid containers.',
      'Component patterns: dashboard (grid cards + table), form (labelled inputs + validation), list (virtualized + empty states), detail (hero + tabs), map (full-height + overlays).',
      'Spacing rhythm: consistent padding/margin scale (Tailwind p-2/p-4/p-6). Cards use rounded-lg (0.75rem). Elevated cards have multi-layer box-shadow.',
      'Typography hierarchy: headings (text-lg to text-3xl, font-semibold/bold), body (text-sm/text-base), muted captions (text-muted-foreground).',
      'Human-friendliness rubric: accessibility (35% weight), responsiveness (30% weight), design consistency (35% weight). Score 80+ is good.',
      'Image analysis: assess whitespace (15-40% ideal), colour variety (5-15 significant buckets), contrast ratio, visual complexity via edge density.',
    ],
  },
  ptt_comms_context: {
    name: 'push-to-talk-communications',
    summary: 'Push-to-Talk (PTT) subsystem: WebRTC signaling, WebSocket channels, half-duplex voice, VOX, Bluetooth, and Railway deployment.',
    key_points: [
      'Architecture: PTTBar.tsx (UI) → ptt.ts (WebSocket + WebRTC) → pttBackground.ts (auto-connect service) → pttStore.ts (Zustand state) → ptt-signaling-token Edge Function → ptt-server (Railway WebSocket server).',
      'Channel scopes: org:<uuid> (org-wide), team:<uuid>, deployment:<uuid>, incident:<uuid>, direct:<uuid> (1:1). Scope determines who can join. validated by Edge Function against user_profiles.organization_id.',
      'Token flow: PTTBar → requestPTTToken() → edgeFunctions.pttSignalingToken({channelScope}) → ptt-signaling-token Edge Function → validates auth + org + role → POST /api/token/mint on ptt-server → JWT signed with PTT_JWT_SECRET → returns token + wsUrl + iceServers → connect WebSocket with ?token=jwt.',
      'Connection lifecycle: usePTTAutoConnect hook in App.tsx → startPTTBackgroundService() on login → connectToOrgChannel() → WebSocket /ws?token=jwt → server sync (presence, speakerId) → ping/pong heartbeat every 30s → auto-reconnect on drop (3s delay, then 30s steady-state).',
      'Speaking flow (half-duplex): hold PTT button → handlePttDown() → startSpeaking() → getUserMedia(audio) → MediaRecorder starts → ws.send({type:"start_speaking"}) → server broadcasts speaking:start → on release: stopSpeaking() → MediaRecorder stops → upload clip to ptt-clips bucket → ws.send({type:"stop_speaking",clipUrl,duration}).',
      'Input modes: PTT (hold button to talk, release to stop), Toggle (click to start, click to stop), VOX (voice-operated, auto-transmit when audio > threshold). VOX uses AudioContext + AnalyserNode at 50ms intervals, 500ms silence delay before stopping.',
      'Common PTT failures: (1) "PTT unavailable" — ptt-signaling-token Edge Function not deployed or PTT_SERVER_URL not set. (2) WebSocket 4001/4002 — token/auth failure, re-login needed. (3) WebSocket 4003 — channel full (>50 participants). (4) CHANNEL_BUSY error — another user is speaking (half-duplex). (5) Microphone denied — browser permission prompt was rejected.',
      'PTT server (ptt-server/): Node.js + Express + ws. Deployed on VPS 72.61.123.97 (srv1601189.hstgr.cloud, Ubuntu 22.04, Malaysia/KL) via deploy-voice-server.yml. TURN also on same VPS port 3478. Env: PTT_JWT_SECRET (required), PROXY_SECRET (required, shared with Edge Function), PORT 8080, TURN_URL=turn:72.61.123.97:3478 + TURN_USERNAME + TURN_CREDENTIAL. Health: GET /health.',
      'Database tables: ptt_messages (clip metadata for replay/audit), ptt_presence (user online status cache), ptt_channels (channel config). All org-scoped with RLS. Cleanup: cleanup_old_ptt_clips(retention_days) function deletes clips older than N days (default 30).',
      'Privacy: Audio clips stored in ptt-clips Supabase Storage bucket with 24h signed URLs. PTT tokens expire in 10 minutes. Recordings limited to 60s / 3MB. All voice data is org-scoped and auditable. Privacy Act IPP 5 requires security safeguards on voice data.',
    ],
  },
  supabase_platform: {
    name: 'supabase-platform-knowledge',
    summary: 'Complete Supabase knowledge: Auth, PostgreSQL, Edge Functions, Storage, Realtime, RLS, migrations, secrets, and common issues.',
    key_points: [
      'Project ref: kxwjcupuxnnbnzcgmkoi. URL: https://kxwjcupuxnnbnzcgmkoi.supabase.co. Region: AWS ap-southeast-2 (Sydney). PostgreSQL 17.',
      'Auth: JWT expiry 3600s. Refresh token rotation on. Redirect URLs: fcmanager.co.nz, *.onspace.build, *.vercel.app, localhost:5173. Email templates in supabase/templates/.',
      'RLS on every table: policies use auth.uid() + organization_id. Anon key respects RLS (frontend). Service role bypasses RLS (Edge Functions only).',
      'Edge Functions: 47 functions in supabase/functions/<name>/index.ts. Deno runtime. Must handle OPTIONS preflight. CORS via _shared/withCors.ts. Deploy secrets via Dashboard → Settings → Edge Functions.',
      'Migrations: 70+ SQL files in supabase/migrations/ (YYYYMMDD_* prefix). Apply: supabase db push. Types: supabase gen types typescript → src/types/database.ts.',
      'Storage buckets: ptt-clips (audio), evidence-photos, vehicle-photos, report-exports. Signed URLs for private access. 24h expiry on PTT clips.',
      'Key shared modules: _shared/withCors.ts (CORS allowlist), _shared/compliance.ts (breach calc), _shared/alpr.ts (plate recognition), _shared/orgConfig.ts (per-org SMTP).',
      'Common fix: RLS blocking → check policies in dashboard. 503 Edge Function → deploy the function. Type drift → regenerate types. JWT expired → call refreshSession().',
    ],
  },
  railway_services_audit: {
    name: 'railway-services-audit-knowledge',
    summary: 'Known Railway service configuration issues and how Bob assesses, diagnoses, and fixes them. Based on April 2026 audit of all 4 Railway services.',
    key_points: [
      'Four Railway services: Bob (inference-service/), Proxy (proxy-server/), PTT (ptt-server/), Ollama (ollama/). Bob and Ollama share one Railway project for private networking. Proxy and PTT are in a separate core project.',
      'CRITICAL: Bob production should expose an explicit operating mode in /health. Use BOB_OPERATING_MODE=self-contained for locked-down production and BOB_OPERATING_MODE=build-training for internet-enabled build/training work.',
      'CRITICAL: Bob OLLAMA_BASE_URL must be http://ollama.railway.internal:<port> where <port> matches the Ollama OLLAMA_HOST setting. Check Ollama startup logs for: 🌐 Binding Ollama to 0.0.0.0:<port>. If port is 8080 use http://ollama.railway.internal:8080. If OLLAMA_BASE_URL is not set on Bob it defaults to localhost which is always unreachable.',
      'CRITICAL: DEPLOY_SIGNATURE=bob-build-training-open-v1 is hardcoded in server.js. If /health shows a different value, the running image is outdated — redeploy from DonSquires/Bob main.',
      'CRITICAL: OPENAI_API_KEY must NOT be set in self-contained mode. In build-training mode it is allowed when CHAT_PROVIDER or TABULAR_NLP_PROVIDER uses openai.',
      'PTT deploy workflow: deploy-voice-server.yml (VPS SSH deploy). deploy-proxy-railway.yml is the only remaining Railway workflow (NZSCV/MotorWeb proxy).',
      'Bob Dockerfile HEALTHCHECK uses process.env.PORT (not hardcoded 3000). ptt-server/.env.example includes NODE_ENV=production to activate HTTPS enforcement middleware.',
      'To assess Railway config: ask user for GET <BOB_URL>/health JSON. Check config.OPERATING_MODE, config.CHAT_PROVIDER, config.TABULAR_NLP_PROVIDER, config.DEPLOY_SIGNATURE, config.SUPABASE_JWT_RUNTIME_ENABLED, config.EXTERNAL_EGRESS_ALLOWED, and capabilities.chat_local_ollama_enabled.',
      'To fix Railway config: Railway Dashboard → Bob service → Variables tab → set KEY=value → Redeploy. Wait 60s. Re-run wiring audit to confirm.',
      'Wiring audit should validate URL consistency, operating mode, provider settings, DEPLOY_SIGNATURE, and auth readiness from /health. Runs every hour at :11 past.',
    ],
  },
  railway_platform: {
    name: 'railway-deployment-knowledge',
    summary: 'Railway deployment: Bob, Proxy, PTT, Ollama services. Env vars, health checks, private networking, Docker, and common issues.',
    key_points: [
      'Four Railway services: Bob (inference-service/, port 3000), Proxy (proxy-server/, port 3000), PTT (ptt-server/, port 3002), Ollama (ollama/, port depends on OLLAMA_HOST — check Ollama startup log for: 🌐 Binding Ollama to 0.0.0.0:<port>).',
      'Every service must listen on process.env.PORT. Health: /health (Bob timeout 60s, PTT 30s, Proxy 45s). /api/tags for Ollama.',
      'Deploy tokens: RAILWAY_BOB_TOKEN (Bob+Ollama shared). RAILWAY_TOKEN (Proxy+PTT). RAILWAY_PROXY_SERVICE_ID, RAILWAY_OLLAMA_SERVICE_ID for each service.',
      'Private network: Bob → Ollama via http://ollama.railway.internal:<port>. No public egress. Both must be in same Railway project.',
      'Ollama: version 0.20.2 pinned. Default port 11434 but OLLAMA_HOST env var controls the actual listening port — if set to 0.0.0.0:8080 on Railway, use port 8080. Bob circuit breaker: 3 failures → 60s cooldown.',
      'Bob Docker: multi-stage (Python ONNX export → Node builder → production image). Non-root nodejs user. 1GB+ RAM for ONNX models.',
      'Deploy workflows: deploy-proxy-railway.yml (NZSCV/MotorWeb proxy, only remaining Railway service). Bob: build-ai-worker.yml (RunPod). PTT+TURN: deploy-voice-server.yml (VPS 72.61.123.97). Bob/Ollama are NOT on Railway.',
      'Common fix: crash → check Railway logs. OOM → upgrade RAM plan. RAILWAY_TOKEN expired → regenerate in dashboard + update GitHub secret.',
    ],
  },
  github_platform: {
    name: 'github-cicd-knowledge',
    summary: '25 GitHub Actions workflows for deployment, database, operations, monitoring. Codespaces dev environment. Copilot integration.',
    key_points: [
      '25 workflows in .github/workflows/. Deploy: frontend (Vercel), Bob/Ollama/PTT/Proxy (Railway), mobile (EAS), Edge Functions (Supabase).',
      'Required secrets: RAILWAY_BOB_TOKEN, RAILWAY_PTT_SERVICE_ID, RAILWAY_PROXY_SERVICE_ID, VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, EXPO_TOKEN, INFERENCE_API_KEY.',
      'Database governance: db-push.yml (production migration, requires @DonSquires approval in "production-schema" environment).',
      'Ops crons: Bob feedback sync 03:47 NZST, self-learning pretrain 04:21 NZST, intel feed every 6h, ParkPow nightly, geofence review monthly.',
      'Codespaces: .devcontainer/devcontainer.json. Node 22, Bun, GitHub CLI, Supabase CLI 2.78.1, Deno. Ports forwarded: 5173, 3000, 3002, 8080.',
      'bun.lock must be committed — Railway runs bun install --frozen-lockfile. Outdated lockfile = deploy failure.',
      'Bob sync: sync-bob-repo.yml mirrors inference-service/ to DonSquires/Bob repo via BOB_SYNC_PAT token.',
      'Common fix: workflow failed → Actions tab → find run → read error. Lockfile stale → bun install + commit. Secrets expired → regenerate.',
    ],
  },
  vercel_platform: {
    name: 'vercel-hosting-knowledge',
    summary: 'Vercel frontend hosting: React/Vite SPA. SPA rewrites, security headers, CSP, caching, environments, domain management.',
    key_points: [
      'Vercel hosts React/Vite SPA. Build: bun run build. Output: dist/. vercel.json at root.',
      'SPA routing: rewrites [{ source: "/(.*)", destination: "/index.html" }] — all routes handled by react-router-dom.',
      'Security: HSTS 1yr, X-Frame-Options:DENY, X-Content-Type-Options, CSP (connect-src: *.supabase.co wss: *.railway.app), Permissions-Policy (geolocation, camera, microphone).',
      'Environments: production uses VITE_SUPABASE_URL_PRODUCTION. Preview uses VITE_SUPABASE_URL_PREVIEW. All client vars must be prefixed VITE_.',
      'Domains: fcmanager.co.nz (production). *.vercel.app (previews). DNS: CNAME www → cname.vercel-dns.com. A @ → 76.76.21.21.',
      'Assets cached 1 year (immutable). HTML no-cache. Service worker allowed at root.',
      'Deploy: deploy-frontend.yml on main push. Manual: vercel --prod.',
      'Common fix: build fails → bun run build locally. CSP blocks request → add domain to connect-src. Preview auth → add *.vercel.app to Supabase redirect_urls.',
    ],
  },
  expo_mobile_platform: {
    name: 'expo-mobile-app-knowledge',
    summary: 'React Native mobile app using Expo/EAS. iOS + Android. Camera, GPS, notifications, PTT audio. OTA updates.',
    key_points: [
      'Mobile app in mobile-app/. Expo SDK. EAS project: 9ec25722-38ca-44d3-a8f5-62a8d8a64e6d. Owner: iron-eagle-security.',
      'Android: com.ironeagle.fieldops.manager. Permissions: CAMERA, ACCESS_FINE/BACKGROUND_LOCATION, VIBRATE.',
      'iOS: same bundle ID. Camera usage: plate photography. Background GPS: patrol welfare tracking.',
      'Plugins: expo-secure-store, expo-camera, expo-location, expo-notifications.',
      'EAS: eas build --platform android --profile production. OTA: eas update --channel production. Store: eas submit.',
      'Secrets: EXPO_TOKEN, EXPO_PROJECT_ID, ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD. Keystore: ops-generate-keystore.yml.',
      'Deploy workflow: deploy-mobile.yml. PTT on mobile: Expo Audio + WebSocket (not WebRTC). Background PTT via Expo foreground service.',
      'Common fix: build fails → check expo.dev logs. EXPO_TOKEN expired → regenerate. OTA not received → run eas update.',
    ],
  },
  domain_dns_platform: {
    name: 'domain-dns-ssl-knowledge',
    summary: 'Domain fcmanager.co.nz, DNS records, SSL, CORS allowlists, Supabase redirect_urls, and multi-domain management.',
    key_points: [
      'Primary domain: fcmanager.co.nz (.co.nz via NZRS). Vercel frontend. Supabase site_url = https://fcmanager.co.nz.',
      'Supabase redirect_urls: fcmanager.co.nz, www.fcmanager.co.nz, freedomcampmanager.onspace.build, *.onspace.build, *.vercel.app, localhost:5173/3000.',
      'SSL: automatic Let\'s Encrypt on Vercel (auto-renewal). HSTS enforced. Railway auto-TLS on *.railway.app.',
      'DNS for Vercel: CNAME www.fcmanager.co.nz → cname.vercel-dns.com. A record @ → 76.76.21.21.',
      'DNS for email: SPF TXT (include:zoho.com include:sendgrid.net), DKIM from Zoho/Resend, DMARC (v=DMARC1; p=quarantine).',
      'CORS allowlist: _shared/withCors.ts for Edge Functions. ptt-server corsOptions. DEV_CORS=true for local development.',
      'Add new domain: (1) add to Supabase redirect_urls, (2) add to CORS allowlist, (3) DNS records, (4) SSL via Vercel/Supabase.',
      'Common fix: domain not resolving → check DNS at registrar. CORS blocked → add to withCors.ts. Auth redirect fails → add to redirect_urls.',
    ],
  },
  email_smtp_platform: {
    name: 'email-smtp-knowledge',
    summary: 'Email via Zoho SMTP and Resend API. Per-org SMTP. Auth email templates. SPF/DKIM/DMARC DNS records.',
    key_points: [
      'Primary SMTP: Zoho Mail. smtp.zoho.com:465 (SSL). Use App-Specific Password (not account password). In proxy-server/.env.',
      'Transactional email: Resend API. RESEND_API_KEY in Supabase Edge Function secrets. POST https://api.resend.com/emails.',
      'Per-org SMTP: custom SMTP per organization stored encrypted in DB. Retrieved via _shared/orgConfig.ts → getSmtpConfig(orgId). Falls back to global.',
      'Auth templates: supabase/templates/ — invite.html, recovery.html, confirmation.html, magic_link.html. Variables: {{ .Token }}, {{ .SiteURL }}, {{ .Email }}.',
      'Env vars: SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_EMAIL, SMTP_FROM_NAME, SITE_URL.',
      'Email DNS: SPF on fcmanager.co.nz, DKIM from Zoho/Resend dashboard, DMARC policy.',
      'Limits: Zoho free ~200/day. Use Resend for high volume transactional.',
      'Common fix: spam → SPF/DKIM/DMARC. Auth failed → use App Password. Templates → check {{ variable }} syntax. RESEND_API_KEY → add to Supabase secrets.',
    ],
  },
  hybrid_stack_platform: {
    name: 'hybrid-stack-architecture',
    summary: 'Complete FieldOps Manager hybrid stack: web + mobile + BaaS + microservices + AI + CI/CD. How all layers connect.',
    key_points: [
      'Layers: Web (Vercel) + Mobile (EAS) → Supabase BaaS (auth/DB/functions/storage) + Railway microservices (Bob/Proxy/PTT/Ollama).',
      'Plate scan flow: Officer scans → Edge Function → Proxy → NZSCV API → observation stored → compliance check → breach if exceeded.',
      'AI flow: Photo → Edge Function → Bob /infer/alpr → ONNX model → plate result → DB. Nightly self-learning via GitHub Actions.',
      'PTT flow: Press button → ptt-signaling-token Edge Function → PTT server JWT → WebSocket → WebRTC audio.',
      'CI/CD: 25 GitHub Actions → Vercel (frontend), Railway (microservices), Supabase (functions+migrations), EAS (mobile).',
      'Security: JWT everywhere. RLS on all DB tables. self-contained mode blocks Bob from internet; build-training mode allows external providers and research paths. PROXY_SECRET authenticates Edge Functions to services.',
      'Similar apps: ParkPow (parking violations), Genetec Security Center (surveillance), Axon Field (evidence management), Veolia SMART (environmental), Parking+Plus NZ, Connect IT NZ.',
      'Build commands: bun run dev/build/lint (web), eas build (mobile), supabase functions deploy (Edge Functions), supabase db push (migrations), node server.js (Bob).',
    ],
  },
  stack_navigation_context: {
    name: 'full-stack-navigation-debugging',
    summary: 'Navigate the full FieldOps stack (UI → hooks → Supabase → DB → Edge Functions → Railway → GitHub CI) and diagnose UI element behaviour.',
    key_points: [
      'Stack layers: React UI (src/pages/) → Zustand/TanStack Query hooks (src/hooks/) → Supabase client (src/lib/supabase.ts) → Postgres (supabase/migrations/) → Edge Functions (supabase/functions/) → Railway (inference-service/).',
      'Route system: react-router-dom v6 in App.tsx. Guards: ProtectedRoute (auth), RoleRoute (role check), AreaRoute (portal area). Roles: admin, admin_officer, officer, master.',
      'Button trace: JSX onClick → handler function → mutation.mutate() → supabase.from("table").insert/update/delete → Postgres → RLS check → response → cache invalidation → re-render.',
      'Link trace: <Link to="/path"> → Route match in App.tsx → role guard check → target page component → useParams for dynamic segments → hook fetches data.',
      'Form trace: <Form onSubmit={handleSubmit}> → react-hook-form + zod validation → onSubmit handler → mutation → supabase call → success toast + cache invalidation.',
      'Data flow: useQuery fetches from Supabase with caching (TanStack Query). useMutation writes to Supabase. invalidateQueries forces re-fetch after writes.',
      'Common failures: button not working (check onClick/disabled/mutation), link 404 (check route path in App.tsx), form error (check zod schema/RLS), blank page (check hook data loading).',
      'Debugging tools: browser DevTools Console (render errors), Network tab (API responses), Supabase dashboard (Edge Function logs), Railway dashboard (inference logs), GitHub Actions (CI/CD logs).',
      'Key tables: vehicles, observations, zones, breaches, enforcement_actions, patrols, users, organizations, incidents. All have RLS policies and organization_id scoping.',
      'Edge Functions: 70+ in supabase/functions/. Must import CORS from _shared/cors.ts and handle OPTIONS preflight. Run in Deno. Deploy via GitHub Actions.',
    ],
  },
  biosecurity_inspection: {
    name: 'biosecurity-inspection-context',
    summary: 'NZ Biosecurity Act 1993 enforcement for Chilean Needlegrass (CNG / Nassella neesiana) and other invasive weed species under Regional Pest Management Plans (RPMPs).',
    key_points: [
      'Primary target species: Chilean Needlegrass (Nassella neesiana). Identifiers: red-purple nodding spikelets (Oct–Jan), harsh yellow-green leaves (cut skin), 10mm needle awn + twisted hairy awn, basal cleistogenes (soil-level seeds).',
      'Secondary species: Nassella trichotoma (Serrated Tussock) — narrow rolled leaves, fine feathery spikelets. Nassella hyalina — smoother leaves, smaller spikelets. Distinguish from native tussock by harsh leaf texture and awn structure.',
      'RPMP lifecycle stages: seedling (spring Sept–Nov), vegetative (Nov–Jan), flowering/seeding (Nov–Feb — highest dispersal risk), dormant (May–Aug).',
      'Buffer zones: 5m from property boundaries under most RPMP rules. Buffer zone breach = elevated enforcement action.',
      'Density categories: isolated (<1 plant/m²), low (1–5/m²), medium (5–20/m²), high (20–50/m²), dense (>50/m²).',
      'Dispersal pathways: contaminated hay/silage, uncleaned machinery (harvesters, mulchers), stock movement through infested paddocks, contaminated topsoil.',
      'Recommended actions: no_action (misidentification), advisory (isolated seedlings, no prior notice), notice_of_direction (s.128 direction to control), infringement_notice (repeated non-compliance), referral_to_mpi (large-scale/cross-boundary infestation).',
      'Legal authority: Biosecurity Act 1993 s.128 (Notice of Direction to control pest). Penalties: Up to $100,000 (s.154N). Council RPMP defines duty-to-manage obligations.',
      'MPI referral threshold: >2ha dense infestation, infestation crossing regional boundaries, or failure to comply with 2+ prior NODs.',
      'Checklist must capture: species confirmed, density estimate, infestation stage, seed heads present (cleistogenes = especially high risk), buffer zone compliance, management plan on file, pathway evidence, sample taken.',
      'Sample protocol: place in sealed bag, label with GPS coords + date + officer ID + species ID. Send to AgResearch or regional council laboratory.',
    ],
  },
  smoke_complaint_ooh: {
    name: 'smoke-complaint-ooh-context',
    summary: 'NZ Resource Management Act 1991 s.17A out-of-hours smoke complaint enforcement. Smoke nuisance assessment, prohibited materials detection, and abatement notice issuance.',
    key_points: [
      'Legal authority: Resource Management Act 1991 s.17A (duty to avoid unreasonable noise and offensive/objectionable discharge). Council bylaws define OOH restrictions (typically 10pm–7am).',
      'Out-of-hours (OOH) is auto-flagged when complaint_time falls between 10:00pm and 7:00am NZST (Pacific/Auckland timezone).',
      'Smoke opacity categories: light (barely visible), moderate (clearly visible, drifts short distance), heavy (dense plume, significant drift), very_heavy (thick column, major neighbourhood impact), black (worst — likely prohibited materials).',
      'Prohibited materials under RMA and council bylaws: treated timber (arsenic/CCA), plastics (PVC releases dioxins/HCl), rubber tyres, household rubbish, chemicals/solvents. Any of these justifies infringement or prosecution referral.',
      'Fire types: residential_domestic (fireplaces, outdoor fires on private property), burn_off (land clearing), industrial (commercial premises), open_fire (unenclosed fire in prohibited period).',
      'Odor scale: none → wood_smoke (generally acceptable) → acrid_chemical (strong enforcement indicator) → plastic_like (prohibited materials likely) → noxious (formal action required).',
      'Officer professional opinion is required before issuing any notice — must document why smoke is objectionable or offensive in context of RMA s.17A.',
      'Offensive/objectionable rating (1–5): 1–2 no action, 3 verbal warning, 4 abatement notice, 5 infringement or prosecution.',
      'Penalty amounts (NZ$): verbal warning = $0, abatement notice = $0 (no fine, compliance order), infringement notice = $300–$1,000 depending on severity and history.',
      'Abatement notice (s.322 RMA): requires respondent to cease causing smoke nuisance within comply_by period. Non-compliance → s.338 prosecution.',
      'Infringement notice (s.343A RMA): on-spot fine for RMA infringement offences. Default section: RMA s.17A.',
      'Checklist must record: fire type, opacity, prohibited materials (each type), odor type, wind speed/direction, smoke drift direction, neighbours affected, road affected, duration, samples taken.',
      'Sample protocol: ash/unburnt materials collected in sealed evidence bag, photographed in-situ, chain of custody maintained. Send to council environmental team.',
    ],
  },
  tender_writing_knowledge: {
    name: 'tender-and-rfp-writing-knowledge',
    summary: 'Complete knowledge for generating NZ security-industry tender applications and RFP/RFIP responses. Covers document structure, NZ procurement rules, pricing models, H&S requirements, and common evaluation criteria.',
    key_points: [
      // ── NZ Procurement context ─────────────────────────────────────────────
      'NZ Government Procurement Rules (NZGPR): councils and Crown entities must follow Government Procurement Rules 2019 (4th edition). Rules of Sourcing include open competition (Rule 14), supplier capability assessment, and value-for-money. Security services above the prescribed threshold (currently NZD $100k) may require an RFP or GETS (Government Electronic Tender Service) listing. Iron Eagle Security should highlight NZGPR compliance readiness when responding to council RFPs.',
      'RFIP vs RFP vs RFQ: RFIP (Request for Information and Pricing) is commonly used by NZ councils as a pre-procurement market test — no contract is formed from the RFIP. RFP (Request for Proposal) is a formal procurement where a contract CAN result. RFQ (Request for Quote) is used for lower-value or prequalified supplier pools. In the tender workspace, always identify which type the document is — the response obligations differ.',
      'Assessment criteria commonly used by NZ councils: (1) Track record and experience (25–35%), (2) Service delivery capability (20–30%), (3) Price/value for money (20–30%), (4) H&S management system (10–15%), (5) Local knowledge and relationships (5–10%). When generating responses, address these criteria explicitly.',
      // ── Document structure ─────────────────────────────────────────────────
      'Tender response document structure (recommended for NZ security services): 1. Cover Letter — on letterhead, addressed to procurement contact, references tender number, confirms organisation is responding to specific services, signed by authorised signatory. 2. Executive Summary — 1 page: who Iron Eagle Security is, the specific services being offered, why you are best placed, key value propositions. 3. Organisation Profile — ABN/NZBN, company history, licence numbers (PSA Licensed Security under Private Security Personnel and Private Investigators Act 2010). 4. Services Offered — separate sub-sections for each line-item in the tender (e.g. Noise Control, Smoke Complaints, Security Patrol Parks). Use the tender\'s numbering. 5. Patrol Routes and Coverage — GPS coordinates referenced in the tender scope mapped to patrol plans. 6. Reporting Framework — incident report format, frequency, delivery method, photos. 7. Team Qualifications — officer licences, training certifications, first aid, background checks. 8. H&S Management System — H&S plan, incident reporting, subcontractor H&S. 9. Pricing Schedule — per-service, hourly, or per-patrol rates; fuel/travel allowances; call-out fees. 10. References — 2–3 current council or government clients. 11. Declarations — collusion, anti-competitive conduct per NZ Commerce Act, accuracy declaration.',
      'Tender application (when Iron Eagle is submitting TO a tender system): same structure but framed as a proposal to be shortlisted. Include expression of interest narrative. Emphasise capacity, insurance, and financial stability.',
      // ── NZ-specific compliance and licencing ──────────────────────────────
      'PSA Licencing (Private Security Personnel and Private Investigators Act 2010): All security officers and guards must hold a Certificate of Approval (CoA) issued by NZ Police. Companies must hold a Licence. Include licence numbers and CoA status in team qualifications section. Mention that all subcontractors must also comply with PSA licencing requirements (common requirement in council tenders).',
      'Health & Safety at Work Act 2015 (HSWA): Council tenders almost always require evidence of a H&S management system. Include: (1) H&S policy statement signed by director, (2) hazard register, (3) incident reporting process, (4) PCBU obligations for lone working (check-in system = welfare check — already built into FieldOps), (5) subcontractor H&S induction process. The FieldOps welfare check system is a direct H&S compliance feature and should be highlighted.',
      'Privacy Act 2020 compliance in security services: CCTV/ALPR data collection during patrols must comply with Information Privacy Principle 1 (lawful collection purpose), IPP 3 (notification where practicable), IPP 5 (security safeguards), IPP 6 (right of access). Mention ALPR system compliance in tender responses if relevant.',
      'Freedom Camping Act 2011 enforcement capability: Iron Eagle has FieldOps Manager which automates Freedom Camping Act enforcement — breach detection, NTV issue, compliance reporting. This is a significant differentiator vs competitors when tendering to councils for freedom camping patrol services. Highlight in executive summary.',
      // ── Pricing guidance ──────────────────────────────────────────────────
      'NZ security services pricing norms (2024–2026): Hourly rates for patrol officers NZD $28–38/hr (weekday), $34–46/hr (weekend), $40–55/hr (public holiday). After-hours call-out: $45–65/hr + $30–60 call-out fee. Noise control: typically $38–52/hr + reports. Vehicle patrol: $35–50/hr. Management/reporting: $45–80/hr. Note: Living Wage Foundation NZ minimum 2025 = $24.15/hr. All prices should include applicable taxes (GST) or clearly state "+GST".',
      'Pricing schedule format for NZ tenders: use a table with columns: Service Description | Unit (hr/patrol/call-out) | Rate (excl. GST) | Rate (incl. GST) | Notes. Add a separate line for call-out fees, weekend loadings, public holiday loadings. State minimum engagement period if applicable.',
      // ── Common evaluation gotchas ─────────────────────────────────────────
      'Collusion and anti-competitive declarations (NZ Commerce Act 1986, s36 and cartel prohibitions): Council tenders routinely require a declaration that the respondent has not colluded with other tenderers on pricing or submission content. This is a legal requirement under the Commerce Act. The declaration section must include this. Standard NZ wording: "The company has not entered into any arrangement, understanding or agreement with any other party to restrict or limit competitive tendering for this contract."',
      'Subcontracting requirements: Many NZ council tenders prohibit subcontracting without prior written approval, or require that subcontractors meet the same licencing and H&S standards. Clearly state subcontractor arrangements and confirm compliance.',
      'Insurance minimums common in NZ council security tenders: Public Liability ≥ NZD $5M, Employer Liability ≥ NZD $1M, Professional Indemnity ≥ NZD $1M. Include current certificate of currency with expiry date.',
      // ── How Bob should generate the document ──────────────────────────────
      'Bob tender generation instructions: When generating a tender RESPONSE, Bob should: (1) analyse the extracted tender text for each service item, (2) draft a services_offered section with a sub-section for each service in the tender (matching their numbering), (3) populate the pricing section with a table formatted as markdown, (4) write team_qualifications highlighting PSA licencing, FieldOps system, welfare check capability, (5) write health_and_safety section covering HSWA 2015 PCBU obligations and the built-in welfare check system, (6) write declaration section with NZ Commerce Act collusion wording. Use professional NZ English. Do not fabricate specific prices — use placeholder [RATE] values that the user can replace. Do not fabricate CoA numbers or insurance details.',
      'Bob tender APPLICATION instructions: When generating a tender APPLICATION (Iron Eagle is submitting an expression of interest), Bob should: (1) write a cover letter expressing interest in the contract and confirming capacity, (2) executive summary focusing on Iron Eagle\'s unique position (FieldOps Manager, NZ-built, PSA compliant), (3) organisation profile section with placeholders for NZBN, PSA licence number, years of operation, (4) highlight FieldOps Manager as a differentiator — automated breach detection, GPS patrol tracking, ALPR, welfare checks, live reporting dashboards. Frame all content as a pitch to be shortlisted.',
      'Bob multi-model routing for tender generation — fully self-hosted, no cloud AI: (1) Ollama primary model (OLLAMA_MODEL, e.g. llama3.1:8b) handles chat AND document generation. (2) Ollama writing model (OLLAMA_MODEL_WRITING — pull a larger model like qwen2.5:14b or mistral:7b into the same Ollama Railway instance). If it is the same as OLLAMA_MODEL this step is skipped. (3) Secondary Railway assistant (SECONDARY_ASSISTANT_URL + SECONDARY_ASSISTANT_API_KEY) — another Bob instance or dedicated writing service that exposes POST /tender/generate. 100% self-hosted. (4) Enriched heuristic template — always available, zero network, NZ security industry boilerplate. Bob never calls OpenAI for document tasks.',
      'POST /tender/generate endpoint: accepts {generation_type:"application"|"response", context:{extracted_text, issuing_body, key_services, key_requirements, key_dates, reference_number, due_date, document_type}, organization_context:{name, psa_licence, nzbn}}. Returns {sections:{cover_letter, executive_summary, services_offered, pricing_notes, team_qualifications, health_and_safety, declaration}, provider:"ollama"|"ollama-writing"|"secondary-assistant"|"heuristic", model_used}. Past approved tenders are injected as learning context.',
      'POST /tender/train endpoint: called when a tender is approved/rejected/shortlisted. Body: {generation_type, issuing_body, key_services, outcome, outcome_notes, sections}. Stores condensed learning in data/tender-learning.json and pushes an intel bulletin into Bob live intel feed. Bob continuously improves from real outcomes — no cloud AI. GET /health returns capabilities.tender_training_enabled.',
      'To upgrade Bob tender writing quality: (1) Pull a larger model: ollama pull qwen2.5:14b then set OLLAMA_MODEL_WRITING=qwen2.5:14b on Bob Railway service. (2) Deploy a second Railway service with large Ollama and set SECONDARY_ASSISTANT_URL + SECONDARY_ASSISTANT_API_KEY. (3) Approve more tenders — every approved tender trains Bob via POST /tender/train.',
      'Bob is the face of the app and handles 100% of AI tasks: chat, document analysis, tender generation, code assist, self-healing, patrol compliance, legal checks, PTT diagnosis, UI assessment. All self-hosted on Railway. Constant self-learning from patrol intel, approved tenders, and knowledge requests.',
    ],
  },
};

function classifyBugType(report) {
  const text = `${report.summary || ''}\n${report.stack_trace || ''}`.toLowerCase();
  if (text.includes('timeout') || text.includes('latency')) return 'performance';
  if (text.includes('permission') || text.includes('forbidden') || text.includes('unauthorized')) return 'auth';
  if (text.includes('cannot') && text.includes('module')) return 'dependency';
  if (text.includes('null') || text.includes('undefined') || text.includes('typeerror')) return 'runtime';
  if (text.includes('cors')) return 'cors';
  if (text.includes('migration') || text.includes('schema') || text.includes('column')) return 'database';
  return 'general';
}

function severityWeight(severity) {
  const value = String(severity || 'medium').toLowerCase();
  if (value === 'critical') return 4;
  if (value === 'high') return 3;
  if (value === 'low') return 1;
  return 2;
}

function buildSelfHealingPlan(report, options = {}) {
  const bugType = classifyBugType(report);
  const sev = String(report.severity || 'medium').toLowerCase();
  const weight = severityWeight(sev);
  const inSelfContainedMode = Boolean(options.selfContainedMode);

  const reproduction = [
    'Capture request payload and endpoint path from logs.',
    'Replay with minimal input that still reproduces the issue.',
    'Confirm expected vs actual behavior with one deterministic test case.',
  ];

  const remediation = [
    'Patch the smallest code path that triggers the failure.',
    'Add a regression test tied to the reproduced case.',
    'Deploy behind a guarded rollout if severity is high or critical.',
  ];

  if (bugType === 'auth') {
    remediation.unshift('Validate auth token source and required claims before handler logic.');
  }
  if (bugType === 'database') {
    remediation.unshift('Verify migration state and table/column compatibility against runtime types.');
  }
  if (bugType === 'dependency') {
    remediation.unshift('Check runtime image includes required module/native library artifacts.');
  }
  if (inSelfContainedMode) {
    remediation.push('Verify no external network dependency is introduced by the fix.');
  }

  const safeguards = [
    'Enable structured logging for this failure signature.',
    'Add alerting threshold for recurrence in 15-minute windows.',
    'Store incident timeline and final patch reference for audit.',
  ];

  const automation = [
    {
      action: 'triage',
      enabled: true,
      detail: `Classified bug type: ${bugType}`,
    },
    {
      action: 'auto_patch',
      enabled: weight <= 2,
      detail: weight <= 2
        ? 'Low/medium severity can auto-open patch task.'
        : 'High severity requires human approval before patching.',
    },
    {
      action: 'auto_deploy',
      enabled: false,
      detail: 'Require human review before production rollout.',
    },
  ];

  return {
    summary: trimText(report.summary, 500),
    severity: sev,
    bug_type: bugType,
    recommended_owner: bugType === 'database' ? 'backend-data-team' : 'platform-engineering',
    reproduction,
    remediation,
    safeguards,
    automation,
    legal_note: 'Guidance is operational and technical only; obtain legal review for statutory interpretation.',
    context_used: Object.keys(KNOWLEDGE_PACKS),
  };
}

function getKnowledgePacks() {
  return KNOWLEDGE_PACKS;
}

function buildPatchTask(report, plan) {
  const summary = trimText(report?.summary || plan?.summary || 'Unspecified incident', 300);
  const severity = String(report?.severity || plan?.severity || 'medium').toLowerCase();
  const weight = severityWeight(severity);
  const bugType = plan?.bug_type || classifyBugType(report || {});

  const riskScore = Math.max(1, Math.min(10, weight * 2 + (bugType === 'security' ? 2 : 0)));
  const requiresApproval = riskScore >= 7;

  const tasks = [
    {
      id: 'reproduce',
      title: 'Reproduce issue with deterministic input',
      status: 'pending',
    },
    {
      id: 'fix',
      title: 'Apply minimal targeted code fix',
      status: 'pending',
    },
    {
      id: 'regression-test',
      title: 'Add regression test for incident signature',
      status: 'pending',
    },
    {
      id: 'deploy-check',
      title: 'Run deployment gate checks before release',
      status: 'pending',
    },
  ];

  return {
    version: 1,
    summary,
    severity,
    bug_type: bugType,
    risk_score: riskScore,
    requires_human_approval: requiresApproval,
    owner: plan?.recommended_owner || 'platform-engineering',
    tasks,
    safeguards: plan?.safeguards || [],
    notes: [
      'No automatic production deploy without human approval.',
      'Preserve audit trace of analysis, patch, and verification.',
    ],
  };
}

module.exports = {
  buildSelfHealingPlan,
  buildPatchTask,
  getKnowledgePacks,
};
