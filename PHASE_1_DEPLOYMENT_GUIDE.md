# 🚀 **Phase 1 Deployment Guide**

**Migration:** `20260220_phase1_orc_ai_vector_support.sql`  
**Status:** Ready to Deploy  
**Estimated Time:** 2-3 minutes

---

## ⚡ **Quick Deploy (Recommended)**

### **Method 1: Supabase CLI**

```bash
# Navigate to your project root
cd /path/to/your/project

# Deploy the migration
supabase db push

# Expected output:
# ✅ Applying migration 20260220_phase1_orc_ai_vector_support.sql...
# ✅ Migration applied successfully
```

**That's it!** The migration will automatically execute.

---

## 🖥️ **Alternative: Manual Deploy via SQL Editor**

If CLI fails or you prefer manual deployment:

### **Step 1: Open Supabase Dashboard**
1. Go to https://supabase.com/dashboard
2. Select your project
3. Navigate to **SQL Editor** (left sidebar)

### **Step 2: Run Migration SQL**

**Option A: Copy from Migration File**
```bash
# Copy the SQL content from:
cat supabase/migrations/20260220_phase1_orc_ai_vector_support.sql
```

**Option B: Use This Direct SQL** (same content):

```sql
-- ============================================================================
-- PHASE 1: ORC/AI DATABASE SETUP - VEHICLE FINGERPRINTING
-- ============================================================================

-- Step 1: Enable pgvector
create extension if not exists vector;
comment on extension vector is 'ORC/AI vehicle fingerprinting - cosine similarity search';

-- Step 2: Add embedding columns
alter table vehicle_observations_v2
  add column if not exists vehicle_embedding vector(384),
  add column if not exists embedding_quality real check (embedding_quality >= 0 and embedding_quality <= 1),
  add column if not exists embedding_model_version text,
  add column if not exists embedding_created_at timestamptz;

comment on column vehicle_observations_v2.vehicle_embedding is 'Vehicle visual fingerprint (384D vector from MobileNetV3)';
comment on column vehicle_observations_v2.embedding_quality is 'Quality score 0-1 (based on detection confidence + embedding norm)';
comment on column vehicle_observations_v2.embedding_model_version is 'Model version string (e.g., yolov8n_mobilenetv3_v1.0)';
comment on column vehicle_observations_v2.embedding_created_at is 'When the embedding was generated';

-- Step 3: Create indices
create index if not exists idx_obs_embedding_created_at 
  on vehicle_observations_v2(embedding_created_at)
  where vehicle_embedding is not null;

create index if not exists idx_obs_embedding_quality
  on vehicle_observations_v2(embedding_quality)
  where vehicle_embedding is not null;

create index if not exists idx_obs_embed_composite
  on vehicle_observations_v2(organization_id, embedding_created_at)
  where vehicle_embedding is not null and embedding_quality >= 0.7;

-- Step 4: Create match_vehicle RPC
create or replace function match_vehicle(
  p_obs_id uuid,
  p_k int default 5,
  p_since timestamptz default now() - interval '90 days',
  p_org uuid default null,
  p_zone uuid default null,
  p_min_quality real default 0.7
) returns table (
  match_observation_id uuid,
  score real,
  recorded_at timestamptz,
  zone_id uuid,
  plate_number text,
  embedding_quality real,
  distance_m numeric
) language sql stable as $$
  with q as (
    select 
      vehicle_embedding as emb,
      gps_latitude as q_lat,
      gps_longitude as q_lng
    from vehicle_observations_v2
    where observation_id = p_obs_id 
      and vehicle_embedding is not null
  )
  select 
    o.observation_id,
    1 - (o.vehicle_embedding <=> q.emb) as score,
    o.recorded_at,
    o.zone_id,
    o.plate_number,
    o.embedding_quality,
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
  from vehicle_observations_v2 o, q
  where o.observation_id <> p_obs_id
    and o.vehicle_embedding is not null
    and o.embedding_quality >= p_min_quality
    and o.recorded_at >= p_since
    and (p_org is null or o.organization_id = p_org)
    and (p_zone is null or o.zone_id = p_zone)
  order by o.vehicle_embedding <=> q.emb asc
  limit p_k;
$$;

comment on function match_vehicle is 'Find top-k most similar vehicles using cosine similarity (ORC/AI fingerprinting)';

-- Step 5: Helper function - check readiness
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
    from vehicle_observations_v2
  )
  select 
    total,
    with_emb,
    with_emb >= p_lists as ready,
    case 
      when with_emb >= p_lists then 
        'Ready! Run: CREATE INDEX idx_obs_embed_ivfflat ON vehicle_observations_v2 USING ivfflat (vehicle_embedding vector_cosine_ops) WITH (lists = 100);'
      else 
        'Need ' || (p_lists - with_emb)::text || ' more observations with embeddings before creating IVFFlat index'
    end as rec
  from stats;
$$;

-- Step 6: Index rebuild function
create or replace function rebuild_embedding_index()
returns text language plpgsql as $$
begin
  drop index if exists idx_obs_embed_ivfflat;
  
  execute format(
    'create index idx_obs_embed_ivfflat on vehicle_observations_v2 using ivfflat (vehicle_embedding vector_cosine_ops) with (lists = %s)',
    greatest(10, least(1000, floor(sqrt((select count(*) from vehicle_observations_v2 where vehicle_embedding is not null)))))
  );
  
  return 'IVFFlat index rebuilt successfully';
end;
$$;

comment on function rebuild_embedding_index is 'Rebuild IVFFlat index for optimal performance (run monthly or after bulk imports)';

-- Step 7: Quality monitoring view
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
from vehicle_observations_v2
where vehicle_embedding is not null
group by organization_id, date_trunc('day', embedding_created_at), embedding_model_version
order by date desc;

comment on view embedding_quality_stats is 'Daily embedding quality metrics by organization (ORC/AI monitoring)';

-- Done!
select 'Phase 1 ORC/AI database setup complete! ✅' as status;
```

### **Step 3: Execute**
1. Paste the SQL into the SQL Editor
2. Click **Run** (or press Ctrl/Cmd + Enter)
3. Wait for confirmation message

---

## ✅ **Post-Deployment Verification**

Run these queries in **SQL Editor** to verify deployment:

### **1. Check pgvector Extension**
```sql
select * from pg_extension where extname = 'vector';
```

**Expected Output:**
```
extname | extversion | ...
--------|------------|-----
vector  | 0.5.0      | ...
```

### **2. Check New Columns**
```sql
select 
  column_name, 
  data_type, 
  is_nullable
from information_schema.columns
where table_name = 'vehicle_observations_v2'
  and column_name in (
    'vehicle_embedding', 
    'embedding_quality', 
    'embedding_model_version', 
    'embedding_created_at'
  );
```

**Expected Output:**
```
column_name              | data_type | is_nullable
-------------------------|-----------|-------------
vehicle_embedding        | USER-DEFINED | YES
embedding_quality        | real      | YES
embedding_model_version  | text      | YES
embedding_created_at     | timestamp | YES
```

### **3. Check Indices**
```sql
select indexname 
from pg_indexes 
where tablename = 'vehicle_observations_v2' 
  and indexname like '%embed%';
```

**Expected Output:**
```
indexname
---------------------------------
idx_obs_embedding_created_at
idx_obs_embedding_quality
idx_obs_embed_composite
```

### **4. Test match_vehicle() Function**
```sql
select * from match_vehicle(
  p_obs_id := (select observation_id from vehicle_observations_v2 limit 1),
  p_k := 5
);
```

**Expected Output:**
- Should execute **without errors** (may return empty if no embeddings exist yet)
- If it errors, check function creation

### **5. Check Readiness for IVFFlat**
```sql
select * from check_embedding_readiness();
```

**Expected Output:**
```
total_observations | with_embeddings | ready_for_index | recommendation
-------------------|-----------------|-----------------|----------------
12345              | 0               | false           | Need 100 more observations...
```

### **6. Check Monitoring View**
```sql
select * from embedding_quality_stats limit 5;
```

**Expected Output:**
- Should execute without errors (empty results expected if no embeddings yet)

---

## 🎯 **Success Criteria**

Mark these checkboxes after verification:

- [ ] pgvector extension enabled (version ≥ 0.5.0)
- [ ] 4 new columns added to vehicle_observations_v2
- [ ] 3 indices created successfully
- [ ] match_vehicle() function executes without errors
- [ ] check_embedding_readiness() returns results
- [ ] embedding_quality_stats view accessible
- [ ] No database errors in Supabase logs

---

## 🚨 **If Deployment Fails**

### **Common Issues & Fixes**

**Issue 1: "extension vector does not exist"**
```sql
-- Fix: Enable pgvector manually
create extension vector;
```

**Issue 2: "column already exists"**
```sql
-- Safe: Migration uses IF NOT EXISTS clauses
-- Just re-run the migration
```

**Issue 3: "function earth_distance does not exist"**
```sql
-- Fix: Enable earthdistance extension
create extension if not exists cube;
create extension if not exists earthdistance;
```

**Issue 4: Migration file not found**
```bash
# Fix: Check file exists
ls -l supabase/migrations/20260220_phase1_orc_ai_vector_support.sql

# If missing, create it manually in SQL Editor
```

---

## 📊 **After Successful Deployment**

### **Immediate Next Steps:**

1. **Verify all checks passed** ✅
2. **Screenshot verification queries** (for documentation)
3. **Notify team**: Database ready for ORC/AI embeddings
4. **Proceed to Phase 2**: Inference Service training

### **Do NOT Yet:**
- ❌ Create IVFFlat index (need ≥100 embeddings first)
- ❌ Deploy orc-ingest Edge Function (need inference service first)
- ❌ Update frontend code (wait for Phase 3)

---

## 🔄 **Rollback (Emergency Only)**

If something goes catastrophically wrong:

```sql
-- WARNING: This deletes all embedding data!

alter table vehicle_observations_v2 
  drop column vehicle_embedding,
  drop column embedding_quality,
  drop column embedding_model_version,
  drop column embedding_created_at;

drop function if exists match_vehicle;
drop function if exists check_embedding_readiness;
drop function if exists rebuild_embedding_index;
drop view if exists embedding_quality_stats;
drop extension if exists vector cascade;
```

---

## 📞 **Ready to Deploy?**

**Choose your method:**

### **Option A: CLI (Recommended)**
```bash
supabase db push
```

### **Option B: SQL Editor**
1. Copy SQL from migration file or this guide
2. Paste into Supabase SQL Editor
3. Execute
4. Verify with queries above

---

**Let me know when deployment is complete, and I'll guide you through Phase 2 setup!** 🚀
