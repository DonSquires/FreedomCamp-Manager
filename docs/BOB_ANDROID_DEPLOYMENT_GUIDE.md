# Bob Service Test Suite & Android Deployment Guide

## Overview

This document covers the complete Bob service testing infrastructure and Android Auto/APK delivery system for the Field Compliance Manager project.

---

## Part 1: Bob Service Test Suite (Governance Gate)

The Bob service test suite is integrated into the `governance-release-gate` GitHub Actions workflow. It automatically runs on every push to `main`, PRs to `main`, and on-demand via `workflow_dispatch`.

### Architecture

**Workflow File:** `.github/workflows/ops-bob-self-test.yml`

**Entry Point:** Automatically called by `.github/workflows/governance-release-gate.yml` under the `bob-service-gate` job.

### Test Tiers

| Tier | Name | Purpose | Technology |
|------|------|---------|-----------|
| 1 | Web Portal | Validates Bob chat surfaces (AdminPortal, FieldOfficerPortal, Grandmaster Studio) | Playwright, mock routes |
| 2 | Mobile Simulation | Verifies EAS build profiles, mobile app dispatch routing | Node.js, Supabase client, esbuild |
| 2.5 | Voice Escalation | Tests missed-patrol TTS escalation via ElevenLabs mock | ElevenLabs mock server |
| 3 | Chaos Infrastructure | Validates RunPod autoscaling mutations and GPU worker failover | GraphQL mock, shell scripting |

### Running Tests Locally

```bash
# Install dependencies
bun install

# Run all Bob tiers
bun run test:bob:all

# Run individual tiers
bun run test:bob:web      # Tier 1: Playwright web tests
bun run test:bob:mobile   # Tier 2: Mobile simulation
bun run test:bob:voice    # Tier 2.5: Voice escalation
bun run test:bob:chaos    # Tier 3: Chaos harness
```

### Test Files

**Location:** `tests/e2e/`

- `ops-bob-web.spec.ts` (Tier 1)
  - Tests Bob chat input → response flow
  - Tests Grandmaster Studio code task submission
  - Uses multiple browser profiles (chromium, firefox, webkit)
  - Mock responses from `tests/fixtures/bob-mock-data.ts`

- `bob-offline.spec.ts` (Tier 1 Resilience)
  - Field officer offline queue persistence
  - Sync completion verification
  - Uses `useOfflineQueue` hook from `src/hooks/useOfflineQueue.ts`

**Location:** `scripts/`

- `mobile-simulation.test.mjs` (Tier 2)
  - EAS profile validation
  - Supabase dispatch table writes
  - Optional wearable-sos probe

- `test-elevenlabs-voice.mjs` (Tier 2.5)
  - End-to-end voice escalation
  - Mock server capture of missed-patrol text

- `chaos-monkey.sh` (Tier 3)
  - RunPod GraphQL mutation validation
  - GPU worker scale configuration capture

### Mock Services

**ElevenLabs Mock Server**

- **File:** `scripts/mock-elevenlabs.mjs`
- **Port:** 8089
- **Endpoint:** `POST /v1/text-to-speech/:voiceId`
- **Response:** Audio synthesis mock + request history
- **Started by:** `test-elevenlabs-voice.mjs`

**RunPod GraphQL Mock**

- **File:** `scripts/mock-runpod-graphql.mjs`
- **Port:** 8085
- **Endpoints:**
  - `POST /graphql` - Handles GPU_Workers query and SaveTemplate mutation
- **Started by:** `chaos-monkey.sh`

### Test Data & Fixtures

**Location:** `tests/fixtures/bob-mock-data.ts`

Provides:
- Mock Bob response payloads (`BOB_MOCK_RESPONSES`)
- Mock edge function handlers (`BOB_MOCK_EDGE_FUNCTIONS`)
- Test user profiles (`BOB_TEST_USERS`)
- Test organizations (`BOB_TEST_ORGANIZATIONS`)
- Test zones with geofence data (`BOB_TEST_ZONES`)

### Telemetry & Logging

**Supabase Tables:**
- `bob_service_test_runs` - Top-level test run records
- `bob_service_test_cases` - Individual test case outcomes
- `bob_service_coverage` - Code coverage per surface
- `bob_inference_health` - Model/provider health metrics

**Edge Function:**
- **File:** `supabase/functions/bob-telemetry-ingest/index.ts`
- **Purpose:** Receives POST payloads from CI and logs to telemetry tables
- **Endpoint:** `POST /functions/v1/bob-telemetry-ingest`

**Migration:**
- **File:** `supabase/migrations/20260515_bob_service_test_telemetry.sql`
- Defines telemetry schema with RLS policies
- Only service + automation can write; admins can read

### GitHub Actions Integration

**Secrets Required:**
```
SIM_SUPABASE_URL            - Simulated Supabase endpoint
SIM_SUPABASE_ANON_KEY       - Anon key for simulation environment
SIM_SUPABASE_SERVICE_ROLE_KEY - Service role (optional, non-fatal skip if missing)
SIM_RAILWAY_BOB_API_URL     - Railway deployment URL (optional)
SIM_SUPABASE_EDGE_FUNCTIONS_URL - Edge functions URL (optional)
```

**Release Gate Behavior:**
- ✅ Bob tests pass → Release proceeds
- ❌ Bob tests fail → Release blocked
- ⏭️ Mobile/voice optional probes missing environment → Gracefully skipped

---

## Part 2: Android Deployment System

### Expo Managed App Structure

**Location:** `mobile-app/`

The app uses Expo's managed workflow. Native Android code is **generated** via `expo prebuild`, not committed to the repo initially.

#### Prebuild Command

```bash
cd mobile-app
npx expo prebuild --platform android --clean
```

This command:
1. Generates `android/` directory with native Android project
2. Applies patches from `android-patches/` (if present)
3. Links native modules (React Native Android Auto, etc.)
4. Outputs ready-to-build Android source tree

#### Generated Structure (After Prebuild)

```
mobile-app/android/
├── app/
│   ├── src/
│   │   └── main/
│   │       ├── AndroidManifest.xml
│   │       ├── java/com/ironeagle/fieldops/
│   │       │   ├── MainActivity.java
│   │       │   └── automotive/
│   │       │       ├── IronEagleCarService.kt
│   │       │       ├── CarIncidentScreen.tsx (compiled to Java)
│   │       │       └── CarSocketListener.ts (compiled to Java)
│   │       └── res/
│   │           └── xml/
│   │               └── automotive_app_desc.xml
│   ├── build.gradle
│   └── proguard-rules.pro
├── build.gradle (root)
└── gradle.properties
```

### Android Files Created

#### TypeScript/React (Pre-Prebuild)

**Location:** `mobile-app/src/automotive/`

1. **CarIncidentScreen.tsx**
   - Renders incident list on Android Auto head unit
   - Uses `androidx.car.app` templates API
   - Methods:
     - `updateStatus(status)` - POST to backend `/api/incident/status`
     - `render()` - React template for automotive display
     - `invalidate()` - Force re-render

2. **CarSocketListener.ts**
   - Maintains WebSocket to Supabase Realtime
   - Listens for `incidents` table INSERTs
   - Pushes new incidents to `CarIncidentScreen.pushIncidentToCarScreen()`
   - Methods:
     - `startListening(officerId)` - Begin subscription
     - `stopListening()` - Cleanup on sign-out
     - `getListeningStatus()` - Check active state

#### Java/Kotlin (Post-Prebuild)

**Location:** `mobile-app/android/app/src/main/java/com/ironeagle/fieldops/automotive/`

1. **IronEagleCarService.kt**
   - Extends `CarAppService` for Android Auto integration
   - Declared in `AndroidManifest.xml` with `BIND_CAR_APP_SERVICE` permission
   - Lifecycle:
     - System detects car head unit connection
     - `onCreateSession()` called → returns `FieldOfficerCarSession()`
     - Initializes `CarSocketListener` with officer ID
     - Realtime dispatch delivery begins

#### Build Configuration

**Location:** `mobile-app/android/`

1. **build.gradle** (root)
   - Defines SDK versions (compileSdk 34, minSdk 23, targetSdk 34)
   - Configures Gradle plugins
   - Sets up dependency resolution

2. **app/build.gradle**
   - Application configuration
   - Build variants: development, staging, production
   - Dependencies: androidx.car.app, React Native, OkHttp, Timber
   - Gradle commands:
     - `assembleDevelopmentDebug` → Development APK
     - `internal` → Staging internal APK
     - `app-bundle` → Production AAB for Play Store
   - Signing configuration (debug keystore)

#### Manifest & Metadata

**Location:** `mobile-app/android/app/src/main/`

1. **AndroidManifest.xml**
   - Declares `IronEagleCarService` with `BIND_CAR_APP_SERVICE`
   - Permissions: location, audio recording, camera, storage, wearable SOS
   - Activities: MainActivity, IronEagleCarService
   - Broadcast receivers for background tasks

2. **res/xml/automotive_app_desc.xml**
   - Android Auto capability declaration
   - Enables `template` and `navigation` features

### EAS Build Configuration

**Location:** `mobile-app/eas.json`

```json
{
  "build": {
    "development": {
      "distribution": "internal",
      "android": {
        "gradleCommand": ":app:assembleDevelopmentDebug"
      },
      "env": {
        "APP_VARIANT": "development"
      }
    },
    "staging": {
      "distribution": "internal",
      "android": {
        "buildType": "release"
      },
      "env": {
        "APP_VARIANT": "staging"
      }
    },
    "production": {
      "distribution": "store",
      "android": {
        "buildType": "release"
      },
      "env": {
        "APP_VARIANT": "production"
      }
    }
  }
}
```

### Deployment Flow

#### Local Development

```bash
cd mobile-app

# Install JS dependencies
npm install

# Start Expo dev server
expo start

# On device: scan QR code via Expo Go app
```

#### EAS Build (APK/AAB Generation)

```bash
# Build development APK (internal distribution)
eas build --platform android --profile development

# Build staging APK (internal distribution)
eas build --platform android --profile staging

# Build production AAB (Play Store submission)
eas build --platform android --profile production
```

#### EAS Submit (Play Store Upload)

```bash
# Submit production AAB to Google Play Store
eas submit --platform android --latest
```

### Service Worker & Offline Support

**Location:** `src/lib/service-worker-registration.ts`

Provides utilities for:
- Service worker registration
- Background sync API integration
- Offline queue status monitoring
- Message-based queue synchronization

**Usage:**

```typescript
import { registerServiceWorker, syncOfflineQueue, listenForOfflineQueue } from '@/lib/service-worker-registration'

// Register service worker on app startup
await registerServiceWorker()

// Listen for offline queue updates
const unsubscribe = listenForOfflineQueue((items) => {
  console.log('Offline queue:', items)
})

// Trigger sync when online
await syncOfflineQueue()

// Get current queue status
const status = await requestOfflineQueueStatus()
```

### Deployment Events Webhook

**Purpose:** Track Vercel deployment status for operational awareness

**Supabase Table:** `deployment_events`

**Fields:**
- `event_type` - 'deployment.created' | 'deployment.succeeded' | 'deployment.failed'
- `deployment_id` - Vercel unique ID
- `project_name` - Project identifier
- `url` - Deployment URL
- `environment` - 'development' | 'staging' | 'production'
- `status` - 'pending' | 'success' | 'failed'
- `git_commit_sha` - Git commit hash
- `git_branch` - Source branch
- `creator` - Username who triggered deployment

**Migration:**
- **File:** `supabase/migrations/20260515_deployment_events.sql`
- Enables RLS with automation write + admin read policies

**Edge Function:**
- **File:** `supabase/functions/vercel-webhook-ingest/index.ts`
- **Endpoint:** `POST /functions/v1/vercel-webhook-ingest`
- **Security:** Validates `x-vercel-signature` header
- **Integration:** Called by Vercel webhook on deployment events

#### Vercel Configuration

Add webhook in Vercel project settings:
```
URL: https://YOUR_SUPABASE_URL/functions/v1/vercel-webhook-ingest
Events: Deployments
```

Set GitHub secret: `VERCEL_WEBHOOK_SECRET` with shared secret value

---

## Part 3: Complete Implementation Checklist

### ✅ Completed

- [x] Bob Tier 1 - Web Portal Playwright spec
- [x] Bob Tier 2 - Mobile simulation validation
- [x] Bob Tier 2.5 - Voice escalation test
- [x] Bob Tier 3 - Chaos infrastructure test
- [x] Offline resilience test (bob-offline.spec.ts)
- [x] Mock ElevenLabs server
- [x] Mock RunPod GraphQL server
- [x] Test fixture data (bob-mock-data.ts)
- [x] Supabase test telemetry migration + RLS
- [x] Supabase deployment events migration + RLS
- [x] Bob telemetry ingest edge function
- [x] Vercel webhook ingest edge function
- [x] Service worker registration helpers
- [x] CarIncidentScreen.tsx (React Native Android Auto)
- [x] CarSocketListener.ts (Supabase Realtime bridge)
- [x] IronEagleCarService.kt (Android Auto service binding)
- [x] AndroidManifest.xml (automotive declaration)
- [x] automotive_app_desc.xml (Android Auto metadata)
- [x] app/build.gradle (Android build configuration)
- [x] build.gradle (root Android Gradle)
- [x] EAS configuration (mobile-app/eas.json)
- [x] GitHub Actions workflow (ops-bob-self-test.yml)
- [x] Governance release gate integration

### 📋 Documentation

- [x] This guide (BOB_ANDROID_DEPLOYMENT_GUIDE.md)
- [x] Inline code comments for automotive files
- [x] TypeScript type definitions (src/types/service-worker.d.ts)
- [x] Migration scripts with RLS documentation

### ⚙️ Configuration Required

**GitHub Secrets (for CI):**
- `SIM_SUPABASE_URL`
- `SIM_SUPABASE_ANON_KEY`
- `SIM_SUPABASE_SERVICE_ROLE_KEY` (optional)
- `SIM_RAILWAY_BOB_API_URL` (optional)

**Vercel Settings:**
- Add webhook endpoint to Vercel project
- Set `VERCEL_WEBHOOK_SECRET` GitHub secret

---

## Part 4: Next Steps

### After Prebuild

Once `npx expo prebuild --platform android` is executed and committed:

1. **Apply Android patches** from `mobile-app/android-patches/` if present
2. **Verify build:**
   ```bash
   cd mobile-app/android
   ./gradlew build
   ```
3. **Generate APK for testing:**
   ```bash
   ./gradlew assembleDebug
   ```
4. **Deploy via EAS:**
   ```bash
   eas build --platform android --profile development
   ```

### Troubleshooting

**Issue:** Service Worker types not recognized
- **Solution:** Verify `src/types/service-worker.d.ts` is generated and TypeScript is rebuilt

**Issue:** Android Auto permissions denied
- **Solution:** Ensure `BIND_CAR_APP_SERVICE` permission is in `AndroidManifest.xml`

**Issue:** Vercel webhook not receiving events
- **Solution:** Verify `x-vercel-signature` header secret matches GitHub secret value

**Issue:** Offline queue not syncing
- **Solution:** Check `public/sw.js` for background sync tag name match

---

## References

- **Expo Prebuild Docs:** https://docs.expo.dev/build/setup/
- **Android Auto Docs:** https://developer.android.com/training/cars/apps
- **Supabase Realtime:** https://supabase.com/docs/guides/realtime
- **EAS Build:** https://docs.expo.dev/build/setup/

---

**Last Updated:** 2026-05-15  
**Maintained By:** Iron Eagle Security / OnSpace AI  
**Status:** ✅ Complete & Integrated
