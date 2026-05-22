# Document Intelligence Pipeline

## Purpose

Compile a searchable, enriched document intelligence dataset across the full repository, including text documents and media assets, for internal research and app-side consumption.

## Supported Inputs

- Text-native: `.md`, `.txt`, `.json`, `.yaml`, `.csv`, `.sql`, `.ts`, `.tsx`, `.js`, `.html`, `.xml`, and similar text files.
- Image/media: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.bmp`, `.tif`, `.tiff`, `.heic`.
- Binary docs: `.pdf`, `.docx`, `.pptx`, `.xlsx`, and related office/document formats.

For image/binary docs, the compiler uses OCR sidecars from `tmp/docs/ocr-output` when available and falls back to metadata indexing when OCR text is unavailable.

## Outputs

- `data/internal-research/document-intelligence-index.json`
- `data/internal-research/document-intelligence-summary.md`
- `public/internal-research/document-intelligence-index.json`
- `public/internal-research/document-intelligence-summary.md`

## Commands

- `npm run docs:intelligence:compile`
- `npm run docs:intelligence:compile:no-app`

## Enrichment Included

Each indexed document includes:

- Path, extension, and category
- File size and SHA-256 fingerprint
- Extracted text or metadata text
- Keyword scoring
- Topic tags (`database`, `deployment`, `frontend`, `backend`, `ai`, `governance`, `media`)

## Notes

- This pipeline is designed for deterministic internal indexing and research synthesis.
- It does not mutate source documents.
- For deeper OCR quality on scanned PDFs/images, run `npm run docs:ocr:pictures` to refresh OCR sidecars before compile.

## Privacy and Source Governance

- Internal document intelligence is the first research source before external lookups.
- Sensitive personal data must be redacted before external escalation and before output to users.
- External research should prioritize trusted NZ and official domains first.
- Risky/adult/gambling/malware-style domains and private/local targets are blocked in research fetch paths.
