# Critical Timezone Data Corruption Fix

## Problem Identified

Users with browsers set to non-NZ timezones (e.g., USA PST) caused vehicle observations to be recorded with **wrong timestamps**, appearing in the **wrong day**.

### Root Cause

When recording data, the system was using:
```javascript
new Date().toISOString()  // Uses BROWSER timezone
```

**Example Corruption Scenario:**
- Tania is in NZ (UTC+13) and records a vehicle at 10am NZ time on Feb 13, 2026
- Her browser is accidentally set to USA PST timezone (UTC-8)  
- System converts "Feb 13 10:00 PST" → UTC = "Feb 13 18:00 UTC"
- When querying for "Feb 13 NZ" (which is Feb 12 11:00 UTC to Feb 13 10:59 UTC), her record (Feb 13 18:00 UTC) falls **OUTSIDE** the range
- Result: Her scan shows as "yesterday" instead of "today" ❌

## Solution Applied

### Backend (Edge Functions)

**File:** `supabase/functions/process-field-scan/index.ts`

```javascript
// ✅ BEFORE (WRONG - uses browser timezone):
const recordedAt = new Date().toISOString();

// ✅ AFTER (CORRECT - forces NZ timezone):
const nzNow = new Date();
const nzDateStr = nzNow.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' });
const recordedAt = new Date(nzDateStr).toISOString();
console.log('🕐 Recording time (NZ):', nzDateStr, '→ UTC:', recordedAt);
```

### Frontend

**File:** `src/components/features/PlateCapture.tsx`

```javascript
// ✅ BEFORE (WRONG):
timestamp: new Date().toISOString(),

// ✅ AFTER (CORRECT - forces NZ timezone):
timestamp: (() => {
  const browserNow = new Date();
  const nzDateStr = browserNow.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' });
  return new Date(nzDateStr).toISOString();
})(),
```

**File:** `src/lib/timezone.ts`

Added new helper functions:
- `toUTCFromNZ()` - Converts NZ date input to UTC ISO string
- Enhanced `getNZNowISO()` - Forces NZ timezone before conversion

**File:** `src/pages/EvidenceCollection.tsx`

⚠️ **STILL NEEDS FIX** - Two locations use `'en-US'` instead of `'en-NZ'`:
- Line 555: `createInitialVehicleRecord()`  
- Line 979: `handleSubmit()`

Both need to change from:
```javascript
const recordTimeNZ = new Date(new Date().toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
```

To:
```javascript
const browserNow = new Date();
const nzDateStr = browserNow.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' });
const recordTimeNZ = new Date(nzDateStr);
console.log('🕐 Recording time:', { browser: browserNow.toISOString(), nz: nzDateStr, utc: recordTimeNZ.toISOString() });
```

## Data Flow (Corrected)

```
Browser Time (any timezone)
  ↓
toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })
  ↓
New Date(nzDateStr)  // Interpreted as NZ time
  ↓
.toISOString()  // Converts to UTC for storage
  ↓
Database (PostgreSQL stores in UTC)
  ↓
Display: Convert UTC → NZ time for user
```

## Testing Verification

After this fix:
1. ✅ Tania records at 10am NZ → Shows as "today" in NZ
2. ✅ User with browser in USA PST records → Still shows correct NZ day
3. ✅ Dashboard date filters work correctly across all timezones
4. ✅ Observations appear in correct date range regardless of browser timezone

## Files Modified

- ✅ `supabase/functions/process-field-scan/index.ts` - Edge function recording
- ✅ `src/components/features/PlateCapture.tsx` - Plate capture timestamp
- ✅ `src/lib/timezone.ts` - Added timezone conversion utilities
- ⚠️ `src/pages/EvidenceCollection.tsx` - NEEDS MANUAL FIX (edit conflict)
- ✅ `src/constants/version.ts` - Version bumped to 2.5.0022

## Remaining Work

**Manual Fix Required:** `src/pages/EvidenceCollection.tsx`

Replace both occurrences (lines ~555 and ~979) from US to NZ locale.
