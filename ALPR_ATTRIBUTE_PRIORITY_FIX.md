# Plate & Attribute Source Rules

## Final Implemented Behavior

### 1) Plate recognition
- Inference runs first.
- ALPR runs only as fallback when inference returns no plate.
- ALPR is not used to write make/model/year/color.

### 2) Visual attribute writes
- `vehicle_make`, `vehicle_model`, `vehicle_year`, `vehicle_color` are inference-only write sources.
- Confidence thresholds used before writing:
  - make >= 0.72
  - model >= 0.68
  - color >= 0.60

### 3) Sticker writes
- `sticker_presence`, `sticker_color`, `sticker_detection_confidence` are inference-only.

### 4) NZSCV & canonical roles
- NZSCV remains authoritative for `self_contained` and `self_contained_expiry`.
- Canonical and NZSCV are used for mismatch/discrepancy checks and operational context.
- Canonical is updated with resolved values after scan processing, but visual write source remains inference.

## Why this design
- Fresh image understanding comes from inference.
- ALPR is strongest at plate fallback.
- NZSCV is strongest for SC certification authority.
- Canonical remains useful for historical comparison and quality controls.
