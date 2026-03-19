# ALPR Attribute Priority Fix

## Issue Summary

First ALPR scans were missing vehicle make/model and color detection was incorrect (showing black when vehicle is white). Root cause: **NZSCV was given priority over canonical vehicles for attribute resolution**, which is backwards.

## Problem

### Previous Priority (WRONG):
$$\text{NZSCV} \gg \text{Canonical} \gg \text{Inference} \gg \text{ALPR}$$

**Why this failed:**
1. **Missing make/model on first scan**: If NZSCV doesn't have the attribute and canonical hasn't seen the vehicle yet, you get null even if inference/ALPR detected it
2. **Wrong color**: NZSCV data may be outdated or incorrect (e.g., showing "Black" when vehicle is actually "White"). Your canonical database has the correct color from prior verified observations.
3. **Overriding trusted local data**: NZSCV's job is to verify self-contained certification status, not be the authority on vehicle appearance attributes.

## Solution

### New Priority (CORRECT):
$$\text{Canonical} \gg \text{NZSCV} \gg \text{Inference} \gg \text{ALPR}$$

**Why this works:**
- **Canonical first**: Your local database is the trusted source built from verified observations over time
- **NZSCV second**: Optional enrichment when canonical is incomplete (but doesn't override)
- **Inference/ALPR**: Fresh scan-time detection, only used if both canonical and NZSCV are missing
- **NZSCV exception**: SC certification (`self_contained`, `self_contained_expiry`) **always** uses NZSCV — the register is the sole authoritative source for certification status

## Changes Made

### 1. [process-officer-scan/index.ts](supabase/functions/process-officer-scan/index.ts#L1324)

**Make/Model/Year Resolution** (lines 1324-1340):
```typescript
// OLD (wrong):
const resolvedMake = nzscv?.make ?? canonicalMake ?? inference.inferMake ?? alprMake ?? null;

// NEW (correct):
const resolvedMake = canonicalMake ?? nzscv?.make ?? inference.inferMake ?? alprMake ?? null;
```

**Color Resolution** (lines 1342-1368):
```typescript
// OLD (wrong): Checked NZSCV color first
if (nzscv?.colour) {
  resolvedColour = nzscv.colour;
  
// NEW (correct): Checks canonical first
if (canonicalColour) {
  resolvedColour = canonicalColour;
} else if (hasHighConfidenceInferenceColour) {
  resolvedColour = inference.inferColour;
} else if (hasHighConfidenceAlprColour) {
  resolvedColour = alprColour;
} else if (nzscv?.colour) {  // NZSCV as optional fallback
  resolvedColour = nzscv.colour;
```

**Attribute Source Tracking** (lines 1370-1372):
```typescript
// OLD (wrong):
make_source: nzscv?.make ? 'nzscv' : canonicalMake ? 'canonical' : ...

// NEW (correct):
make_source: canonicalMake ? 'canonical' : nzscv?.make ? 'nzscv' : ...
```

### 2. [AI_ATTRIBUTE_INFERENCE_SETUP.md](AI_ATTRIBUTE_INFERENCE_SETUP.md#L71)

Updated documentation to reflect correct priority and explain the rationale.

## Impact

✅ **On next scan**: Vehicle attributes (make, model, color) will now be populated from canonical_vehicles first  
✅ **Color accuracy**: Canonical color (from prior verified observations) will be used instead of potentially stale NZSCV data  
✅ **Make/Model display**: First-time vehicles will show attributes from inference/ALPR instead of being blank  
✅ **Self-contained status**: Remains authoritative from NZSCV (unchanged)  

## Example Scenario

**Vehicle**: Toyota Hiace (white) — first observation in new zone

1. **Canonical**: Empty (new in this zone)
2. **NZSCV**: Returns "Toyota", "Hiace", but color = "Black" (outdated registration)
3. **Inference**: Detects "White" at 90% confidence
4. **ALPR**: Detects "White" at 85% confidence

### Result
- Make: "Toyota" (from NZSCV, canonical empty)
- Model: "Hiace" (from NZSCV, canonical empty)
- **Color: "White"** (from inference, skipped NZSCV black) ✅
- SC Status: From NZSCV register ✅

## Testing

To verify the fix:
1. Scan a **new vehicle** in a zone (not in canonical_vehicles yet)
   - Should populate make/model from NZSCV + inference/ALPR
   - Should use fresh color detection instead of stale NZSCV data

2. Scan a **known vehicle** with color already in canonical_vehicles
   - Should use canonical color first
   - Should not override with NZSCV data even if NZSCV has different color

3. Check `attribute_sources` in observation response
   - Should show `"color_source": "canonical"` or `"color_source": "inference"` (not "nzscv" unless those are empty)
