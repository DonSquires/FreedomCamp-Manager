# FreedomCamp Manager — React Native Mobile App

Native iOS and Android app for field officers. Built with **Expo** (React Native) and backed by the **same Supabase project** as the web admin portal.

Connected to: **https://expo.dev/accounts/iron-eagle-security/projects/freedomcamp-manager**

---

## Features

| Screen | What it does |
|---|---|
| **Login** | Supabase email/password auth — same credentials as web portal |
| **Home** | Today's scan count, active breach count, current zone, enforcement mode badge |
| **Scan** | Full-screen camera with plate-framing overlay → fires ALPR pipeline (same as web) |
| **My Scans** | List of officer's recent observations with photo thumbnail, plate, compliance badge |
| **Breach Alerts** | Org-scoped breach alerts; officer can acknowledge; auto-refreshes every 30 s |
| **Enforcement Actions** | View + complete enforcement actions; shows current enforcement workflow mode |

### Enforcement Workflow
The app reads `organizations.enforcement_workflow` on login and adapts:
- **`officer_direct`** — Warning and Notice to Vacate buttons shown on-site
- **`hybrid`** — Warning button only; admin handles notices
- **`admin_first`** — Read-only "Reported to admin" badge

---

## Prerequisites

- **Node.js 18+** and **npm** (or Bun)
- **Expo CLI**: `npm install -g expo-cli`
- **EAS CLI** (for app store builds): `npm install -g eas-cli`
- On macOS: Xcode 15+ for iOS simulator
- Android Studio for Android emulator

---

## Quick Start (Development)

```bash
cd mobile-app

# 1. Install dependencies
npm install

# 2. Create environment file
cp .env.example .env
# Edit .env and fill in EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY

# 3. Start Expo dev server
npx expo start

# 4. Open on device
#    iOS simulator:     press i
#    Android emulator:  press a
#    Physical device:   scan QR code with Expo Go app
```

---

## Environment Variables

Create a `.env` file in the `mobile-app/` directory:

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...YOUR_ANON_KEY
```

Get these from: **Supabase Dashboard → Project Settings → API**

---

## Building for Production

### iOS (TestFlight / App Store)
```bash
eas build --platform ios --profile production
eas submit --platform ios
```

### Android (Google Play)
```bash
eas build --platform android --profile production
eas submit --platform android
```

### Internal distribution (no app store)
```bash
# iOS — creates .ipa for direct install
eas build --platform ios --profile preview

# Android — creates .apk for sideloading
eas build --platform android --profile preview --output-format=apk
```

---

## EAS Setup (first time only)

The project is linked to the Expo account `iron-eagle-security` and project `freedomcamp-manager`.

**First, get the real Expo project ID:**

1. Login to Expo:
   ```bash
   # Login to Expo account (requires iron-eagle-security access)
   eas login
   ```

2. Get the project UUID from the Expo dashboard:
   - Go to https://expo.dev/accounts/iron-eagle-security/projects/freedomcamp-manager
   - Click **Project Settings** (gear icon)
   - Copy the **Project ID** (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

**Then update `app.json`:**

Replace `REPLACE_WITH_YOUR_EXPO_PROJECT_UUID` with the real UUID in both places:
- Line 68: `extra.eas.projectId`
- Line 75: `updates.url` → `https://u.expo.dev/YOUR_UUID_HERE`

⚠️ **Important:** Both UUIDs must be identical!

**Configure credentials (for production builds):**
```bash
eas credentials
```

The `eas.json` defines three build profiles:
- **development** — For development clients with debugging enabled
- **preview** — For internal testing (APK for Android)
- **production** — For App Store / Play Store submission

---

## Push Notifications

The app uses **Expo Push Notifications** via the `send-push-notification` Supabase edge function.

On first launch after login, the app requests notification permission and registers the Expo push token:

```ts
// The token is saved to user_profiles.expo_push_token
// so the edge function can target this device
```

To test: send a breach alert from the web admin portal — the officer's phone should receive a push within seconds.

---

## Project Structure

```
mobile-app/
├── App.tsx                          # Root: navigation + providers
├── app.json                         # Expo config (permissions, icons, bundle IDs)
├── package.json
└── src/
    ├── lib/
    │   └── supabase.ts              # Supabase client (uses AsyncStorage for session)
    ├── stores/
    │   └── authStore.ts             # Zustand auth store (mirrors web app)
    └── screens/
        ├── LoginScreen.tsx
        ├── HomeScreen.tsx
        ├── ScanScreen.tsx           # Camera + ALPR pipeline
        ├── RecentScansScreen.tsx
        ├── BreachAlertsScreen.tsx
        └── EnforcementActionsScreen.tsx
```

---

## Shared Backend

The mobile app connects to the **exact same Supabase project** as the web admin portal:

- Same `observations` table, same ALPR edge functions
- Same `breach_alerts`, same `enforcement_actions`
- Same `organizations.enforcement_workflow` setting
- Same JWT-based RLS policies (officer role restrictions apply)

No backend changes are needed to support the mobile app.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Camera black screen | Check `expo-camera` permission in `app.json` + iOS Info.plist |
| GPS permission denied | User must grant in device Settings → Location |
| Login error "Invalid JWT" | Check EXPO_PUBLIC_SUPABASE_ANON_KEY in .env |
| Upload fails | Verify the `scans` storage bucket exists with public access |
| No push notifications | Ensure `expo_push_token` is saved in user_profiles |
