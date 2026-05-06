-- Migration: 20260506000001_add_ai_confidence_to_noise.sql
--
-- Purpose:
--   Add AI confidence scoring to noise assessments.
--   Tracks which assessments are AI-assisted with confidence 0.0–1.0,
--   helping officers assess the reliability of Bob's recommendations.

-- ── 1. Add ai_confidence_score column ──────────────────────────────────────

ALTER TABLE noise_assessments
  ADD COLUMN IF NOT EXISTS ai_confidence_score NUMERIC(3, 2) CHECK (ai_confidence_score BETWEEN 0.0 AND 1.0);

COMMENT ON COLUMN noise_assessments.ai_confidence_score IS
  'Bob AI confidence for this assessment (0.0–1.0). NULL if assessment is manual-only.';

-- ── 2. Add rationale column (optional, for AI explanation audit trail) ───────

ALTER TABLE noise_assessments
  ADD COLUMN IF NOT EXISTS ai_rationale TEXT;

COMMENT ON COLUMN noise_assessments.ai_rationale IS
  'Explanation from Bob AI for assessment recommendations. Audit trail for transparency.';
