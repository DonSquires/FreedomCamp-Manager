# Bob Redacted Sample-Set Format

This folder defines the canonical redacted sample-set format for PM-facing evidence packs.

Use these files:

1. `alpr-redacted-sample.schema.json`
2. `alpr-redacted-sample-template.json`
3. `face-review-redacted-sample.schema.json`
4. `face-review-redacted-sample-template.json`

Rules:

1. Do not include personal names, full plates, exact GPS, or direct person identifiers.
2. Use stable redaction IDs (e.g. `alpr_redacted_001`, `face_redacted_001`).
3. Keep unknown/inconclusive states explicit.
4. Any adjudication decision must include reviewer role and timestamp metadata.