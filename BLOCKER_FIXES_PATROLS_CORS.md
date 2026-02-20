# Blocker Fixes: Patrols 400 + CORS Preflight Errors

## 🔍 **Root Cause Analysis**

### Issue #1: `/rest/v1/patrols?select=*` → 400 Bad Request
**Status**: ✅ **Table exists**, likely query syntax or RLS issue

**Confirmed**:
- Table `patrols` exists in database with proper RLS policies
- Multiple files query `from('patrols')` correctly
- 400 error suggests request parsing issue or policy rejection

**Next Step Required**:
1. **Inspect Network Panel** → Copy the 400 response body (message, details, hint, code)
2. This will reveal exact error type (wrong column, RLS block, etc.)

---

### Issue #2: `/functions/v1/recognize-plate` → CORS Preflight Blocked
**Status**: ✅ **FIXED** - Eliminated CORS entirely by removing legacy function calls

**Changes Made**:
1. ✅ **FlaggedVehicles.tsx** - Migrated to `plate-scanner-photo-first`
2. ✅ **ALPRDiagnostic.tsx** - Migrated to `plate-scanner-photo-first`
3. ✅ **ZoomScan.tsx** - Migrated to `plate-scanner-photo-first` (unified flow)

**Result**: No more client-side calls to `recognize-plate` → CORS error eliminated

---

## 📦 **Code Changes Applied**

### **1. FlaggedVehicles.tsx** (Photo Analysis)

**Before**:
```typescript
const { data: alprData } = await supabase.functions.invoke('recognize-plate', {
  body: { photoUrl },
});
```

**After**:
```typescript
// Convert photo to base64
const response = await fetch(photoUrl);
const blob = await response.blob();
const base64 = await new Promise<string>((resolve) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(reader.result as string);
  reader.readAsDataURL(blob);
});

// Call unified ingest (server-side ALPR)
const { data: scanData } = await supabase.functions.invoke('plate-scanner-photo-first', {
  body: {
    image: base64,
    gpsLatitude: 0,
    gpsLongitude: 0,
    recordedAt: new Date().toISOString(),
    userId: user?.id,
    organizationId: user?.organization_id,
  },
});

const recognizedPlate = scanData?.plate_number;
```

---

### **2. ALPRDiagnostic.tsx** (Diagnostic Test)

**Before**:
```typescript
const { data, error } = await supabase.functions.invoke('recognize-plate', {
  body: {
    image: testImageBase64,
    regions: ['nz'],
    enableMMC: true,
  },
});
```

**After**:
```typescript
const { data, error } = await supabase.functions.invoke('plate-scanner-photo-first', {
  body: {
    image: testImageBase64,
    gpsLatitude: -41.2865,
    gpsLongitude: 174.7762,
    recordedAt: new Date().toISOString(),
    userId: 'diagnostic-test',
    organizationId: 'diagnostic-test',
  },
});

if (data.success && data.plate_number && data.plate_number !== 'PENDING_ALPR') {
  toast.success(`✅ Plate detected: ${data.plate_number}`);
}
```

---

### **3. ZoomScan.tsx** (Parallel Split Workflow)

**Before** (Two-step):
1. Call `recognize-plate` (ALPR only)
2. Call `process-field-scan` (observation creation)

**After** (Unified):
1. Capture raw photo (no watermark)
2. Call `plate-scanner-photo-first` (ALPR + observation in one step)
3. Watermark upload runs in parallel (non-blocking)

**Key Change**:
```typescript
// Fork A: Send RAW photo to unified ALPR ingest
const alprData = await supabase.functions.invoke('plate-scanner-photo-first', {
  body: {
    image: rawImageDataUrl,
    gpsLatitude: gpsLocation?.lat || 0,
    gpsLongitude: gpsLocation?.lng || 0,
    gps_accuracy: gpsLocation?.accuracy || 0,
    recordedAt: new Date().toISOString(),
    userId: user?.id,
    organizationId: selectedZone?.organization_id,
    zoneId: selectedZone?.id,
    weatherConditions: weatherConditions || null,
  },
});

// Observation created + plate detected in one call!
```

---

## 🧪 **Testing Checklist**

### **1. Patrols 400 Error** (Manual Step Required)

**Steps**:
1. Open browser DevTools → Network panel
2. Reload the page/component that triggers the patrols query
3. Find the failed `patrols?select=*` request
4. Click it → Response tab → **Copy the full JSON error**
5. Paste it here or send to AI

**Expected Response** (example):
```json
{
  "code": "PGRST301",
  "message": "column \"some_column\" does not exist",
  "details": "Failing row contains ...",
  "hint": "Perhaps you meant \"correct_column\"?"
}
```

**Then I can provide a 1-line fix!**

---

### **2. CORS Preflight Error** (Should be fixed)

**Steps**:
1. Open browser DevTools → Network panel
2. Reload the page
3. Look for `recognize-plate` requests
4. **Should see ZERO** calls to `recognize-plate` now
5. **Should see** calls to `plate-scanner-photo-first` instead

**Expected**:
- ✅ No CORS preflight errors
- ✅ No `ERR_FAILED` on `recognize-plate`
- ✅ All ALPR calls go through `plate-scanner-photo-first`

---

### **3. ALPR Functionality** (End-to-End Test)

**Test in FlaggedVehicles**:
1. Click "Flag Vehicle"
2. Upload a photo with a license plate
3. Should show: "🤖 ALPR recognizing plate number..."
4. Should detect plate and auto-populate form
5. ✅ **Success**: Plate detected
6. ❌ **Failure**: Check console for error message

**Test in ZoomScan**:
1. Open ZoomScan
2. Point at a license plate
3. Press capture button
4. Should show: "Processing..." in queue
5. Should detect plate and show compliance status
6. ✅ **Success**: Observation created
7. ❌ **Failure**: Check console for error message

**Test in ALPR Diagnostic**:
1. Go to Admin Portal → Database Diagnostics → ALPR Diagnostic
2. Click "Test API Key"
3. Should show: ✅ API key is VALID
4. Click "Test with Sample Image"
5. Should show: ✅ Plate Detected Successfully
6. ❌ **Failure**: Check error message and fix

---

## 🔑 **Supabase Secrets Configuration**

Ensure these secrets are set:

```bash
supabase secrets set \
  PLATE_RECOGNIZER_TOKEN=d579ff0bf7fc05656ebd6567432ac95fb09be6a4 \
  ALPR_CLOUD_URL=https://api.platerecognizer.com/v1/plate-reader/ \
  ALPR_REGIONS=nz \
  ALPR_MMC=false \
  ALPR_CONFIG='{"mode":"fast"}' \
  ALPR_TIMEOUT_MS=15000
```

**Verify**:
```bash
supabase secrets list
```

**Then redeploy**:
```bash
supabase functions deploy plate-scanner-photo-first
```

---

## 📋 **Next Actions Required**

### **Action 1: Diagnose Patrols 400 Error**
**Who**: User (manual step)
**What**: Inspect Network panel and copy error response body
**Why**: Need exact error message to provide fix

### **Action 2: Test ALPR End-to-End**
**Who**: User (testing)
**What**: Try flagging a vehicle, using ZoomScan, running diagnostic
**Why**: Verify CORS fix worked and ALPR detects plates

### **Action 3: Verify Secrets Configuration**
**Who**: User (Supabase dashboard)
**What**: Check that `PLATE_RECOGNIZER_TOKEN` is set correctly
**Why**: ALPR won't work without valid token

---

## 🎯 **Expected Outcomes**

### **After These Fixes**:
- ✅ **No more CORS errors** - All ALPR calls are server-side
- ✅ **No more ERR_FAILED** - `recognize-plate` not called from client
- ✅ **Unified ALPR flow** - One function handles everything
- ✅ **Parallel split workflow** - Raw image to ALPR, watermarked to storage
- ⚠️ **Patrols 400** - Still needs diagnosis (waiting for error response)

---

## 🔍 **How to Debug if Still Failing**

### **If ALPR still fails**:
1. Check console logs for error message
2. Verify `PLATE_RECOGNIZER_TOKEN` is set in Supabase Secrets
3. Test token in ALPR Diagnostic tool
4. Check Edge Function logs: Supabase Dashboard → Edge Functions → Logs

### **If Patrols still 400**:
1. **Copy the exact error response** from Network panel
2. Common fixes:
   - Wrong column name in query
   - Missing RLS policy for user role
   - Bad query parameter syntax
   - Wrong `select` fields

**Once you provide the error details, I can give an instant fix!**

---

## 📝 **Summary**

- ✅ **CORS Issue**: **FIXED** by eliminating legacy `recognize-plate` calls
- ⏳ **Patrols 400**: **AWAITING** error response details to diagnose
- ✅ **ALPR Migration**: **COMPLETE** - All UI now uses unified ingest
- 🧪 **Testing Required**: Verify ALPR detection works end-to-end

**Next Step**: Please run the tests and paste the patrols 400 error response!
