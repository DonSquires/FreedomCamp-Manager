# Face Review Adjudication Packet

Generated: 2026-05-18T09:36:15.219Z

- Review status: adjudication-packet-attached-case-samples-pending
- Face log surface: src/pages/FaceRecordLog.tsx

## Schema Anchors

- faceRecordsTable: supabase/migrations/20260425000002_face_records_table.sql
- matchFaceRpc: supabase/migrations/20260426000001_poi_face_matching.sql, supabase/migrations/20260426000002_poi_face_matching_v2.sql
- reviewSurface: src/pages/FaceRecordLog.tsx

## Evidence Anchors

- tests/e2e/__snapshots__/visual-regression.spec.ts/face-recognition--full-chromium.png
- tests/e2e/__snapshots__/visual-regression.spec.ts/face-recognition--header-chromium.png
- tests/e2e/__snapshots__/visual-regression.spec.ts/face-recognition--mainContent-chromium.png

## Required Decisions

1. identity_match
2. poi_status
3. image_quality
4. duplicate_face_record
5. manual_escalation_required

## Adjudication Checklist

1. Confirm embedding quality and photo evidence are sufficient before any identity link is accepted.
2. Use inconclusive when quality, angle, or occlusion prevents a defensible match.
3. Treat duplicate detection separately from identity certainty.
4. Require human confirmation for POI-sensitive or trespass-sensitive outcomes before operations use.

