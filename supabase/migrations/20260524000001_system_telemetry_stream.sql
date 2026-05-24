create table if not exists public.system_telemetry_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source_layer text not null check (
    source_layer in ('SUPABASE_SCHEMA', 'API_CONTRACT', 'CONTAINER_METRICS', 'CORS_POLICY', 'ENV_VARS')
  ),
  error_signature text not null,
  payload_snapshot jsonb not null default '{}'::jsonb
);

create index if not exists idx_system_telemetry_logs_source_layer
  on public.system_telemetry_logs (source_layer);

create index if not exists idx_system_telemetry_logs_error_signature
  on public.system_telemetry_logs (error_signature);
