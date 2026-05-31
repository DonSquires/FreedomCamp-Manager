-- B-58 Gap #3: Store audio evidence URL on noise_assessments
-- Officers can attach an audio sample during field assessment; this column
-- holds the Supabase Storage public URL after the file is uploaded.

ALTER TABLE noise_assessments
  ADD COLUMN IF NOT EXISTS audio_sample_url TEXT;

COMMENT ON COLUMN noise_assessments.audio_sample_url IS
  'URL of audio evidence file uploaded to noise-evidence storage bucket (RMA s.326-328 evidential chain).';
