# Inference-First Vehicle Attribute Priority Experiment

## Summary

Switched vehicle attribute resolution to prefer **high-confidence AI inference first** for visual attributes (color, make, model, year) instead of canonical database.

### Rationale
- The inference service (GPT-4o vision) **can see the actual vehicle** in the photo
- It provides confidence scores for each attribute (0-1 scale)
- External registries (NZSCV, canonical DB) may have outdated or incorrect visual data
- Fresh scan-time analysis is more accurate than historical/registry data for appearance attributes

---

## New Priority

### Visual Attributes (Make, Model, Year, Color)
```
Inference (HIGH confidence) >> Canonical >> NZSCV >> Inference (low) >> ALPR >> null
```

**Confidence Thresholds:**
- Make: ≥ 0.72 (72%)
- Model: ≥ 0.68 (68%)  
- Color: ≥ 0.60 (60%)
- Year: Any value (no threshold)

### Self-Contained Certification
```
NZSCV >> All other sources
```
(Unchanged — NZSCV is authoritative for certification status)

---

## Changed File

### [supabase/functions/process-officer-scan/index.ts](supabase/functions/process-officer-scan/index.ts#L1334)

**What changed:**
- Lines 1339-1342: New confidence checks for make/model/year
- Lines 1346-1348: Inference checked FIRST for make/model/year
- Lines 1353-1379: Color priority updated — inference (high conf) > canonical > NZSCV
- Lines 1381-1387: Attribute source tracking updated

**Key decision logic:**
```typescript
// If inference has high confidence for make, use it first
const resolvedMake = hasHighConfidenceMake ? inference.inferMake : canonicalMake ?? nzscv?.make ?? inference.inferMake ?? alprMake ?? null;

// Otherwise fall back: canonical > NZSCV > low-conf inference > ALPR
```

**Color logic:**
```typescript
if (hasHighConfidenceInferenceColour) {
  // Inference is confident — trust it over canonical/NZSCV
  resolvedColour = inference.inferColour;
} else if (canonicalColour) {
  // Fall back to canonical if inference not confident
  resolvedColour = canonicalColour;
} else if (nzscv?.colour) {
  // Use NZSCV as optional enrichment (may be stale)
  resolvedColour = nzscv.colour;
}
```

---

## Expected Behavior

### Scenario 1: New Vehicle, Good Photo
```
Vehicle: Toyota HiAce (white) — first scan in zone

Inference results:
- Make "Toyota" (confidence 0.88 ✅ above 0.72 threshold)
- Model "HiAce" (confidence 0.76 ✅ above 0.68 threshold)  
- Color "White" (confidence 0.91 ✅ above 0.60 threshold)
- Year 2018

Canonical: Empty (new in zone)
NZSCV: Has "Toyota", "HiAce", Color "Black" (outdated)

Result:
✅ Make: "Toyota" (from high-conf inference)
✅ Model: "HiAce" (from high-conf inference)
✅ Color: "White" (from high-conf inference, overrides stale NZSCV "Black")
✅ Year: 2018 (from inference)
✅ Attribute sources: make→inference, model→inference, color→inference, year→inference
```

### Scenario 2: Known Vehicle, Low Confidence Inference
```
Vehicle: Red Mercedes (known in canonical DB)

Inference results:
- Make "Mercedes" (confidence 0.45 ❌ below 0.72 threshold)
- Model "C-Class" (confidence 0.52 ❌ below 0.68 threshold)
- Color "Red" (confidence 0.58 ❌ below 0.60 threshold)

Canonical: Make "Mercedes", Model "C-Class", Color "Red"
NZSCV: Make "Mercedes", Color "Blue"

Result:
✅ Make: "Mercedes" (inference below threshold → canonical)
✅ Model: "C-Class" (inference below threshold → canonical)
✅ Color: "Red" (inference below threshold → canonical)
✅ Attribute sources: make→canonical, model→canonical, color→canonical
```

### Scenario 3: Partial Inference Confidence
```
Vehicle: Subaru Outback (blue)

Inference results:
- Make "Subaru" (confidence 0.78 ✅ above 0.72)
- Model "Legacy" (confidence 0.55 ❌ below 0.68) [AI confused with similar model]
- Color "Blue" (confidence 0.92 ✅ above 0.60)

Canonical: Model "Outback"
NZSCV: Make "Subaru", Model "Outback"

Result:
✅ Make: "Subaru" (inference 0.78 ≥ 0.72)
✅ Model: "Outback" (inference 0.55 < 0.68 → canonical)
✅ Color: "Blue" (inference 0.92 ≥ 0.60)
✅ Attribute sources: make→inference, model→canonical, color→inference
```

---

## Testing

### Test Case 1: Color Accuracy
1. Scan a **white vehicle** that NZSCV incorrectly lists as "black"
2. Check the observation response for:
   ```json
   {
     "vehicle": {
       "colour": "White",
       "attribute_sources": {
         "color_source": "inference" // Should be inference if confidence >= 0.60
       }
     }
   }
   ```

### Test Case 2: Make/Model Display
1. Scan a **new vehicle** (not in canonical_vehicles)
2. Check that make/model are populated from inference (if confidence meets threshold)
3. Verify `attribute_sources` shows `inference` (not null)

### Test Case 3: Low Confidence Fallback
1. Perform a scan with **poor lighting or angle**
2. Check that inference confidence scores are low
3. Verify system falls back to canonical or NZSCV data
4. Check attribute sources show the correct fallback source

### Test Case 4: Canonical Override Safety
1. Scan a **well-known vehicle** with established canonical record
2. Intentionally blur/obstruct the vehicle in scan
3. Verify low-confidence inference doesn't override correct canonical data

---

## Monitoring

In backend logs, look for:
```
resolvedMake = "Toyota" (source: inference, confidence: 0.88)
resolvedModel = "HiAce" (source: inference, confidence: 0.76)
resolvedColour = "White" (source: inference, confidence: 0.91)
```

The `attribute_sources` field in observations will show:
```json
{
  "make_source": "inference",
  "model_source": "inference", 
  "color_source": "inference",
  "year_source": "inference"
}
```

---

## Reverting if Needed

To revert to **canonical-first priority**:
```typescript
// OLD (canonical first):
const resolvedMake = canonicalMake ?? nzscv?.make ?? inference.inferMake ?? alprMake ?? null;

// Replace with inference-first approach already applied above
```

The change is isolated to lines 1334-1387 in `process-officer-scan/index.ts`.

---

## Next Steps

1. ✅ Code deployed to `main` 
2. ⏳ Test with real vehicle scans
3. 📊 Monitor attribute_sources field in observations dashboard
4. 🔄 Adjust confidence thresholds if needed (currently: Make 0.72, Model 0.68, Color 0.60)
5. 📈 Track color accuracy improvements vs NZSCV/canonical-based system
