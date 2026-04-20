# Inference Service Contract — v1

This document describes the response fields produced by the Bob ORC/AI inference service (`POST /infer`) and how they map to columns in the `observations` table.

---

## Inference Response Shape (`/infer`)

```json
{
  "success": true,
  "data": {
    "embedding": [/* 384 floats */],
    "embedding_quality": 0.82,
    "embedding_model_version": "yolov8n_mobilenetv3_v1.0",

    "detection": {
      "confidence": 0.91,
      "bbox": { "x": 120, "y": 40, "width": 320, "height": 200 },
      "class": 2
    },

    "plate_number": "ABC123",

    "vehicle_make":  "Toyota",
    "vehicle_model": "HiAce",
    "vehicle_colour": "White",
    "vehicle_make_confidence":  0.88,
    "vehicle_model_confidence": 0.76,
    "vehicle_colour_confidence": 0.91,

    "sticker": {
      "presence": true,
      "color": "blue",
      "bbox": { "x": 10, "y": 5, "width": 60, "height": 30 },
      "detection_confidence": 0.94,
      "color_confidence": 0.87
    },

    "movement": {
      "moved": false,
      "background_similarity": 0.96,
      "vehicle_bbox_iou": 0.91,
      "decision": "stationary"
    },

    "metadata": {
      "norm": 12.4,
      "dimension": 384,
      "processing_time_ms": 220
    }
  }
}
```

---

## Sticker Detection (`sticker`)

| Field | Type | Notes |
|---|---|---|
| `presence` | `boolean \| null` | `true` = sticker present, `false` = absent, `null` = inconclusive — **requires manual review** |
| `color` | `"blue" \| "green" \| "unknown"` | Set to `"unknown"` when `presence` is null or colour is ambiguous |
| `bbox` | `{x, y, width, height}` | Pixel coordinates of the detected sticker in the original image |
| `detection_confidence` | `0–1` | Confidence that a sticker is (or is not) present |
| `color_confidence` | `0–1` | Confidence in the reported colour |

**Important**: when `presence` is `null`, the `color` field **must** be `"unknown"`. The UI/backend should surface these observations for forced human review before any compliance decision is made.

---

## Movement Comparison (`movement`)

Movement comparison is computed by the inference service by comparing the current photo against the `previous_observation_id` photo from the same incident/case.

| Field | Type | Notes |
|---|---|---|
| `moved` | `boolean \| null` | `true` = vehicle moved, `false` = stationary, `null` = comparison not run |
| `background_similarity` | `0–1` | Cosine / SSIM similarity of background regions between the two photos |
| `vehicle_bbox_iou` | `0–1` | Intersection-over-union of vehicle bounding boxes |
| `decision` | `string` | Human-readable outcome: `"moved"`, `"stationary"`, or `"inconclusive"` |

The caller supplies `previous_observation_id` in the `POST /alpr-process` request to trigger movement comparison.

---

## Vehicle Attributes

| Inference field | DB column | Notes |
|---|---|---|
| `vehicle_make` | `vehicle_make` | |
| `vehicle_model` | `vehicle_model` | |
| `vehicle_colour` | `vehicle_color` | |
| `vehicle_make_confidence` | `vehicle_make_confidence` | |
| `vehicle_model_confidence` | `vehicle_model_confidence` | |
| `vehicle_colour_confidence` | `vehicle_color_confidence` | |

---

## ALPR Plate Confidence

| Inference field | DB column | Notes |
|---|---|---|
| `detection.confidence` (Stage 2) | `plate_confidence` | Also populated from Plate Recognizer (Stage 1) confidence |

---

## Database Columns Added (migration `20260308_v1_inference_outputs.sql`)

| Column | Type | Description |
|---|---|---|
| `incident_id` | `uuid FK → incidents` | Optional link to the parent incident/case |
| `plate_confidence` | `real` | Confidence for recognised plate number |
| `vehicle_make_confidence` | `real` | Confidence for make inference |
| `vehicle_model_confidence` | `real` | Confidence for model inference |
| `vehicle_color_confidence` | `real` | Confidence for colour inference |
| `sticker_presence` | `boolean` (nullable) | Tri-state sticker detection result |
| `sticker_color` | `text` | `blue \| green \| unknown` (constrained) |
| `sticker_bbox` | `jsonb` | Pixel bounding box of sticker |
| `sticker_detection_confidence` | `real` | Sticker presence confidence |
| `sticker_color_confidence` | `real` | Sticker colour confidence |
| `previous_observation_id` | `uuid FK → observations` | Reference observation for movement comparison |
| `movement_moved` | `boolean` (nullable) | Movement result |
| `movement_background_similarity` | `real` | Background similarity score |
| `movement_vehicle_bbox_iou` | `real` | Vehicle bbox overlap between photos |
| `movement_decision` | `text` | `moved \| stationary \| inconclusive` |

---

## Constraints / Design Decisions

- **GPS stays with the officer phone** — GPS coordinates are captured by the mobile app and never sourced from inference.
- **NZSCV and MotorWeb integrations are unchanged** — these run independently of inference outputs.
- **Sticker `presence = null`** is treated as unknown/inconclusive. The backend should never auto-approve compliance based on a null sticker result; it must be flagged for officer review.
- **Movement comparison is opt-in** — pass `previous_observation_id` in the `alpr-process` request. Absence of the field means movement columns remain `null`.
