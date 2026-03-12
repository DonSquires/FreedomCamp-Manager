-- ============================================================================
-- PHASE 1: ORC/AI DATABASE SETUP - VEHICLE FINGERPRINTING
-- ============================================================================
-- Migration: Add pgvector support for vehicle embeddings
-- Created: 2026-02-20
-- Purpose: Replace ALPR with vehicle fingerprinting using cosine similarity
--
-- What This Does:
-- 1. Enables pgvector extension for vector similarity search
-- 2. Adds embedding columns to observations
-- 3. Creates IVFFlat index for fast top-k similarity queries
-- 4. Creates match_vehicle() RPC for finding similar vehicles
--
-- Model: MobileNetV3 + ArcFace (256-512D embeddings)
-- Similarity: Cosine distance (pgvector <=> operator)
-- Index: IVFFlat (lists=100) - requires table with data before creating
-- ============================================================================

-- Step 1: Enable required extensions
-- ============================================================================
-- Enable cube (required by earthdistance)
create extension if not exists cube;

-- Enable earthdistance (for GPS distance calculations)
create extension if not exists earthdistance;

-- Enable pgvector (for cosine similarity search)
create extension if not exists vector;

-- Verify extensions are enabled
comment on extension vector is 'ORC/AI vehicle fingerprinting - cosine similarity search';


-- Step 2: Add embedding columns to observations
-- ============================================================================
-- Using 384 dimensions (default MobileNetV3 output size)
-- Can be changed to 256, 512, or 1024 based on model selection
alter table observations
  add column if not exists vehicle_embedding vector(384),
  add column if not exists embedding_quality real check (embedding_quality >= 0 and embedding_quality <= 1),
  add column if not exists embedding_model_version text,
  add column if not exists embedding_created_at timestamptz;

-- Add comments for documentation
comment on column observations.vehicle_embedding is 'Vehicle visual fingerprint (384D vector from MobileNetV3)';
comment on column observations.embedding_quality is 'Quality score 0-1 (based on detection confidence + embedding norm)';
comment on column observations.embedding_model_version is 'Model version string (e.g., yolov8n_mobilenetv3_v1.0)';
comment on column observations.embedding_created_at is 'When the embedding was generated';


-- Step 3: Create indices for vector similarity search
-- ============================================================================
-- NOTE: IVFFlat index requires populated table - uncomment after data exists
-- create index if not exists idx_obs_embed_ivfflat
--   on observations using ivfflat (vehicle_embedding vector_cosine_ops)
--   with (lists = 100);

-- Time-based filtering index (for match_vehicle time bounds)
create index if not exists idx_obs_embedding_created_at 
  on observations(embedding_created_at)
  where vehicle_embedding is not null;

-- Quality filtering index (for excluding low-quality embeddings)
create index if not exists idx_obs_embedding_quality
  on observations(embedding_quality)
  where vehicle_embedding is not null;

-- Composite index for common queries (org + time + quality)
create index if not exists idx_obs_embed_composite
  on observations(organization_id, embedding_created_at)
  where vehicle_embedding is not null and embedding_quality >= 0.7;


-- Step 4: Create match_vehicle RPC function
-- ============================================================================
-- Returns top-k most similar vehicles by cosine similarity
-- Filters by time, organization, zone, and minimum quality
create or replace function match_vehicle(
  p_obs_id uuid,                                          -- Observation ID to find matches for
  p_k int default 5,                                      -- Number of top matches to return
  p_since timestamptz default now() - interval '90 days', -- Only match within this time window
  p_org uuid default null,                                -- Optional: filter by organization
  p_zone uuid default null,                               -- Optional: filter by zone
  p_min_quality real default 0.7                          -- Minimum embedding quality threshold
) returns table (
  match_observation_id uuid,
  score real,                    -- Cosine similarity (0-1, higher is more similar)
  recorded_at timestamptz,
  zone_id uuid,
  plate_number text,
  embedding_quality real,
  distance_m numeric             -- GPS distance in meters (if both have GPS)
) language sql stable as $$
  with q as (
    -- Get query observation's embedding
    select 
      vehicle_embedding as emb,
      gps_latitude as q_lat,
      gps_longitude as q_lng
    from observations
    where observation_id = p_obs_id 
      and vehicle_embedding is not null
  )
  select 
    o.observation_id,
    1 - (o.vehicle_embedding <=> q.emb) as score,  -- Convert distance to similarity
    o.recorded_at,
    o.zone_id,
    o.plate_number,
    o.embedding_quality,
    -- Calculate GPS distance if both observations have coordinates
    case 
      when o.gps_latitude is not null 
           and o.gps_longitude is not null 
           and q.q_lat is not null 
           and q.q_lng is not null
      then round(
        earth_distance(
          ll_to_earth(o.gps_latitude, o.gps_longitude),
          ll_to_earth(q.q_lat, q.q_lng)
        )::numeric,
        2
      )
      else null
    end as distance_m
  from observations o, q
  where o.observation_id <> p_obs_id
    and o.vehicle_embedding is not null
    and o.embedding_quality >= p_min_quality
    and o.recorded_at >= p_since
    and (p_org is null or o.organization_id = p_org)
    and (p_zone is null or o.zone_id = p_zone)
  order by o.vehicle_embedding <=> q.emb asc  -- Order by similarity (lower distance = more similar)
  limit p_k;
$$;

-- Add function comment
comment on function match_vehicle is 'Find top-k most similar vehicles using cosine similarity (ORC/AI fingerprinting)';


-- Step 5: Create helper function to check embedding readiness
-- ============================================================================
-- Utility to check if a table is ready for IVFFlat index creation
-- IVFFlat requires at least 'lists' rows with non-null embeddings
create or replace function check_embedding_readiness(
  p_lists int default 100
) returns table (
  total_observations bigint,
  with_embeddings bigint,
  ready_for_index boolean,
  recommendation text
) language sql stable as $$
  with stats as (
    select 
      count(*) as total,
      count(vehicle_embedding) as with_emb
    from observations
  )
  select 
    total,
    with_emb,
    with_emb >= p_lists as ready,
    case 
      when with_emb >= p_lists then 
        'Ready! Run: CREATE INDEX idx_obs_embed_ivfflat ON observations USING ivfflat (vehicle_embedding vector_cosine_ops) WITH (lists = 100);'
      else 
        'Need ' || (p_lists - with_emb)::text || ' more observations with embeddings before creating IVFFlat index'
    end as rec
  from stats;
$$;


-- Step 6: Create maintenance function to rebuild IVFFlat index
-- ============================================================================
-- IVFFlat index degrades over time - rebuild periodically for optimal performance
create or replace function rebuild_embedding_index()
returns text language plpgsql as $$
begin
  -- Drop existing index if it exists
  drop index if exists idx_obs_embed_ivfflat;
  
  -- Recreate with current optimal lists value (sqrt of embedding count)
  execute format(
    'create index idx_obs_embed_ivfflat on observations using ivfflat (vehicle_embedding vector_cosine_ops) with (lists = %s)',
    greatest(10, least(1000, floor(sqrt((select count(*) from observations where vehicle_embedding is not null)))))
  );
  
  return 'IVFFlat index rebuilt successfully';
end;
$$;

comment on function rebuild_embedding_index is 'Rebuild IVFFlat index for optimal performance (run monthly or after bulk imports)';


-- Step 7: Create analytics view for embedding quality monitoring
-- ============================================================================
create or replace view embedding_quality_stats as
select 
  organization_id,
  date_trunc('day', embedding_created_at) as date,
  count(*) as total_embeddings,
  avg(embedding_quality) as avg_quality,
  percentile_cont(0.5) within group (order by embedding_quality) as median_quality,
  percentile_cont(0.95) within group (order by embedding_quality) as p95_quality,
  count(*) filter (where embedding_quality >= 0.9) as excellent_count,
  count(*) filter (where embedding_quality >= 0.7 and embedding_quality < 0.9) as good_count,
  count(*) filter (where embedding_quality < 0.7) as poor_count,
  embedding_model_version
from observations
where vehicle_embedding is not null
group by organization_id, date_trunc('day', embedding_created_at), embedding_model_version
order by date desc;

comment on view embedding_quality_stats is 'Daily embedding quality metrics by organization (ORC/AI monitoring)';


-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these after migration to verify setup:

-- 1. Check pgvector extension
-- select * from pg_extension where extname = 'vector';

-- 2. Check new columns exist
-- \d observations

-- 3. Check index readiness
-- select * from check_embedding_readiness();

-- 4. Test match_vehicle function (will return empty until embeddings exist)
-- select * from match_vehicle(
--   p_obs_id := (select observation_id from observations limit 1),
--   p_k := 5
-- );


-- ============================================================================
-- ROLLBACK INSTRUCTIONS (if needed)
-- ============================================================================
-- WARNING: This will delete all embedding data!
--
-- alter table observations 
--   drop column vehicle_embedding,
--   drop column embedding_quality,
--   drop column embedding_model_version,
--   drop column embedding_created_at;
--
-- drop function if exists match_vehicle;
-- drop function if exists check_embedding_readiness;
-- drop function if exists rebuild_embedding_index;
-- drop view if exists embedding_quality_stats;
-- drop extension if exists vector cascade;
-- ============================================================================


-- Migration complete!
select 'Phase 1 ORC/AI database setup complete! ✅' as status;
