# Android Auto — Patch Application Guide

This directory contains committed config fragments that must be merged into the
generated `mobile-app/android/` tree **after** running Expo prebuild.

> `android/` is gitignored in this Expo managed-workflow project.
> These patch files are the source of truth for the native Android Auto
> configuration and must be re-applied every time the prebuild is regenerated.

---

## Step 1 — Generate the native Android tree

```bash
cd mobile-app
npm install          # ensure react-native-android-auto is in node_modules
npx expo prebuild --platform android --clean
```

Expected output directories (after prebuild):
```
mobile-app/android/
├── app/
│   ├── build.gradle
│   └── src/
│       └── main/
│           ├── AndroidManifest.xml
│           ├── java/
│           └── res/
└── build.gradle
```

---

## Step 2 — Apply build.gradle changes

Edit `mobile-app/android/app/build.gradle`:

1. Set `compileSdkVersion 34`, `minSdkVersion 23`, `targetSdkVersion 34`
2. Set `applicationId "com.ironeagle.security.ops"`
3. Add `packagingOptions` block (see `build_gradle_additions.txt`)
4. Add Automotive dependencies (see `build_gradle_additions.txt`)

---

## Step 3 — Apply AndroidManifest changes

Edit `mobile-app/android/app/src/main/AndroidManifest.xml`:

Copy the fragments from `AndroidManifest_automotive_additions.xml` into the
correct positions (permissions inside `<manifest>`, service + meta-data inside
`<application>`).

---

## Step 4 — Add the automotive_app_desc.xml resource

```bash
mkdir -p mobile-app/android/app/src/main/res/xml
cp mobile-app/android-patches/automotive_app_desc.xml \
   mobile-app/android/app/src/main/res/xml/automotive_app_desc.xml
```

---

## Step 5 — Create IronEagleCarService.kt

Create `mobile-app/android/app/src/main/java/com/ironeagle/security/ops/IronEagleCarService.kt`:

```kotlin
package com.ironeagle.security.ops

import androidx.car.app.CarAppService
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

class IronEagleCarService : CarAppService() {
    override fun createHostValidator(): HostValidator =
        HostValidator.ALLOW_ALL_HOSTS_VALIDATOR

    override fun onCreateSession(): Session =
        IronEagleCarSession()
}
```

Create `IronEagleCarSession.kt` in the same package:

```kotlin
package com.ironeagle.security.ops

import androidx.car.app.Screen
import androidx.car.app.Session

class IronEagleCarSession : Session() {
    override fun onCreateScreen(intent: android.content.Intent): Screen =
        IronEagleCarMainScreen(carContext)
}
```

---

## Step 6 — Verify the build

```bash
cd mobile-app/android
./gradlew assembleDebug
```

A successful build will produce an APK at:
`android/app/build/outputs/apk/debug/app-debug.apk`

---

## Notes

- `react-native-android-auto` is the bridge between the TypeScript car screen
  logic in `src/automotive/CarIncidentScreen.tsx` and the native Automotive OS
  template renderer.
- The Supabase Realtime subscription is started in `CarSocketListener.ts` and
  must be called after the user authenticates (in the Expo App.tsx auth flow).
- CRITICAL and HIGH severity incidents are forwarded to the car screen; lower
  severities are ignored to keep the driving interface uncluttered.
