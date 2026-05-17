# Nelson Freedom Camping Evidence Metadata Ingest (2026-05-17)

## Scope

User clarification: the relevant photos are from Nelson freedom camping.

This ingest focused on Supabase Storage bucket `evidence`, where file/object names are mostly non-semantic and cannot reliably indicate location by path alone.

## Method

1. Enumerated all objects under `evidence` recursively.
2. Profiled folder/prefix distribution and image inventory.
3. Downloaded a recent 30-image sample to local review path:
   - `tmp/docs/storage-review/evidence-nelson-sample/`
4. Parsed embedded JPEG EXIF metadata (no external dependency parser script) for:
   - capture timestamp
   - device make/model
   - GPS latitude/longitude
5. Applied an approximate Nelson/Tasman bounding-box check to identify likely Nelson captures.
6. Copied confirmed subset into:
   - `tmp/docs/storage-review/evidence-nelson-sample/nelson-confirmed/`
7. Productized the ingest into a reusable script:
  - `scripts/index-evidence-exif.mjs`
8. Ran full-bucket EXIF indexing (all evidence images) and generated branch-aware outputs:
  - `tmp/docs/storage-review/evidence-full-index/evidence-exif-index.json`
  - `tmp/docs/storage-review/evidence-full-index/evidence-exif-index.csv`
  - `tmp/docs/storage-review/evidence-full-index/region-summary.json`
9. Built a branch-prioritized ingestion queue from the full index:
  - `scripts/build-evidence-branch-queue.mjs`
  - `tmp/docs/storage-review/evidence-full-index/evidence-branch-ingest-queue.json`
  - `tmp/docs/storage-review/evidence-full-index/evidence-branch-ingest-queue.csv`
  - `tmp/docs/storage-review/evidence-full-index/evidence-branch-ingest-summary.json`

## Grounded Findings

### Bucket Structure Snapshot

- Total files in `evidence`: 211
- Total image files in `evidence`: 205
- Largest grouped paths:
  - `recovered/11c5e4a7-dafc-48a1-b93f-8012b9addc1e` (100 JPG)
  - `recovered/486b706b-7d4c-4c6d-a602-c747ef400537` (8 JPG)
- `recovered/*` contained images only (no sidecar JSON/CSV metadata files).

### Metadata Results (30-image sample)

- EXIF detected: 28/30
- GPS detected: 28/30
- Approx Nelson/Tasman GPS matches: 7/30
- Dominant capture device on matched records: `OPPO Find N2 Flip`
- Matched capture timestamps cluster: `2026-02-01 20:29:14` to `20:30:17`

### Full Evidence Index (205 images)

- Indexed images: 205
- EXIF detected: 60
- GPS detected: 59
- Region distribution:
  - Nelson/Tasman: 7
  - Otago: 38
  - Canterbury: 12
  - West Coast: 2
  - No region inferred: 146
- First Security branch attribution (approx bbox):
  - First Security - Nelson: 7
  - First Security - Oamaru: 34
  - First Security - Christchurch: 12
  - First Security - Queenstown: 4
  - First Security - Greymouth: 2
  - No branch inferred: 146

Important operational note:
- This is a multi-branch dataset, not a Nelson-only corpus.
- Nelson freedom-camping photos are confirmed, but additional records align to Otago/Canterbury/West Coast branch geographies.

### Branch Queue Results (Operational)

- Total queued items: 205
- Priority bands:
  - P0 (branch-ready ingest): 59
  - P3 (needs enrichment/triage): 146
- Recommended actions:
  - `ingest_to_branch_pipeline`: 59
  - `run_secondary_geocoder`: 1
  - `run_ocr_and_filename_enrichment`: 145

## Artifacts

- Full sample manifest:
  - `tmp/docs/storage-review/evidence-nelson-sample/manifest.json`
- EXIF extraction output:
  - `tmp/docs/storage-review/evidence-nelson-sample/exif-metadata-summary.json`
- Full-bucket EXIF index:
  - `tmp/docs/storage-review/evidence-full-index/evidence-exif-index.json`
  - `tmp/docs/storage-review/evidence-full-index/evidence-exif-index.csv`
  - `tmp/docs/storage-review/evidence-full-index/region-summary.json`
- Branch ingest queue:
  - `tmp/docs/storage-review/evidence-full-index/evidence-branch-ingest-queue.json`
  - `tmp/docs/storage-review/evidence-full-index/evidence-branch-ingest-queue.csv`
  - `tmp/docs/storage-review/evidence-full-index/evidence-branch-ingest-summary.json`
- Nelson-confirmed subset manifest:
  - `tmp/docs/storage-review/evidence-nelson-sample/nelson-confirmed/manifest.json`
- Nelson-confirmed image files (7):
  - `tmp/docs/storage-review/evidence-nelson-sample/nelson-confirmed/01__IMG20260201203017.jpg`
  - `tmp/docs/storage-review/evidence-nelson-sample/nelson-confirmed/02__IMG20260201202936.jpg`
  - `tmp/docs/storage-review/evidence-nelson-sample/nelson-confirmed/03__IMG20260201202946.jpg`
  - `tmp/docs/storage-review/evidence-nelson-sample/nelson-confirmed/04__IMG20260201202957.jpg`
  - `tmp/docs/storage-review/evidence-nelson-sample/nelson-confirmed/12__IMG20260201202930.jpg`
  - `tmp/docs/storage-review/evidence-nelson-sample/nelson-confirmed/13__IMG20260201202924.jpg`
  - `tmp/docs/storage-review/evidence-nelson-sample/nelson-confirmed/15__IMG20260201202914.jpg`

## Interpretation

- The `evidence` bucket does contain photos with embedded metadata sufficient to ground Nelson freedom-camping context.
- Object-path naming alone is not reliable for geo attribution.
- EXIF GPS/time extraction is currently the most reliable linkage method in this bucket where relational table rows are empty in this environment.

## Recommended Next Step

- Persist queue rows into a normalized evidence-index table with fields for branch/jurisdiction/priority/action, then trigger branch-specific ingestion workers from `P0` rows first.
