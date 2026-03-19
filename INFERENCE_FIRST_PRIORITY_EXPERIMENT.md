# Inference-Only Visual Attribute Experiment

## Objective
Validate the production rule that visual fields are written only from inference outputs, while ALPR remains plate fallback and canonical/NZSCV remain comparison sources.

## Active Rule Set

### Plate
- Inference first
- ALPR fallback only if inference has no plate

### Visual attributes
- Inference-only writes for:
  - `vehicle_make`
  - `vehicle_model`
  - `vehicle_year`
  - `vehicle_color`

### Sticker
- Inference-only writes for:
  - `sticker_presence`
  - `sticker_color`
  - `sticker_detection_confidence`

### SC certification
- NZSCV authoritative for:
  - `self_contained`
  - `self_contained_expiry`

### Canonical/NZSCV role in visuals
- Used for mismatch/discrepancy detection and admin review context.
- Not used as primary write source for make/model/year/color.

## Acceptance Checks

1) Inference has plate + attributes
- Expect plate from inference.
- Expect make/model/year/color from inference.
- Expect sticker from inference.

2) Inference has no plate
- Expect ALPR plate fallback.
- Expect make/model/year/color still from inference only (or null if not accepted).

3) Canonical/NZSCV disagreement
- Expect discrepancy rows/flags.
- Expect visual write source to remain inference.

4) SC certification
- Expect `self_contained` and expiry from NZSCV regardless of inference sticker result.
