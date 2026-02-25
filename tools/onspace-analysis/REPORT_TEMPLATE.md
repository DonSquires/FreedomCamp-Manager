# Onspace Integration Analysis Report

**Date:**  
**Analyst:**  
**Onspace repo / archive:**  
**FreedomCamp-Manager commit:**  

---

## 1. Repository Summary

> Brief description of what the Onspace codebase does, its primary language(s),
> and how it relates to FreedomCamp-Manager.

- **Primary language(s):**
- **Package manager:**
- **Entry points / top-level directories:**

---

## 2. Language Composition

> Output of `tokei`, `cloc`, or equivalent – paste table here.

```
(paste language stats here)
```

---

## 3. Code Areas of Interest

### 3.1 Edge Functions

| Function name | File path | Description |
|---------------|-----------|-------------|
|               |           |             |

### 3.2 Background Workers / Queues

| Worker name | File path | Trigger mechanism | Description |
|-------------|-----------|-------------------|-------------|
|             |           |                   |             |

### 3.3 Database Access Layer

| Pattern | File(s) | Notes |
|---------|---------|-------|
| `supabase.from(…)` | | |
| `supabase.rpc(…)` | | |
| Raw SQL / pg driver | | |
| ORM (if any) | | |

---

## 4. Files Referencing Observations / Enrichment

> Populated from `lexical_results.txt`.

| Symbol searched | Matching files | Notes |
|-----------------|----------------|-------|
| `observations_v2` | | |
| `vehicle_enrichment_jobs` | | |
| `process-vehicle-enrichment` | | |
| `canonical_vehicles` | | |
| `compliance_results` | | |
| `breach_alerts` | | |

---

## 5. Function Signatures of Interest

> Copy relevant function/method signatures from the Onspace source here.

```typescript
// example
export async function processVehicleEnrichment(jobId: string): Promise<void> { … }
```

---

## 6. Environment Variables Used

| Variable name | Where referenced | Purpose |
|---------------|-----------------|---------|
| `SUPABASE_URL` | | |
| `SUPABASE_ANON_KEY` | | |
| `SUPABASE_SERVICE_ROLE_KEY` | | |
| `DATABASE_URL` | | |
| *(add more)* | | |

---

## 7. Gaps / Discrepancies Found

> List any places where the Onspace code references tables, columns, or RPC
> names that do not match the current FreedomCamp-Manager schema.

- [ ] (item 1)
- [ ] (item 2)

---

## 8. Next Steps

- [ ] Confirm schema alignment between `observations_v2` columns and Onspace expectations.
- [ ] Verify `vehicle_enrichment_jobs` queue contract (status values, payload shape).
- [ ] Check RLS policies allow Onspace service-role key to read/write required tables.
- [ ] Agree on environment variable names and document them in both repos.
- [ ] Schedule a follow-up review once schema extraction output is available.
