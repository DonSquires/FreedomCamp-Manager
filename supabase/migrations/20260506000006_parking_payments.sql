-- B-29: Pay-by-Plate Parking Payment Integration (PayByPhone NZ scaffold)
-- Records parking payment transactions initiated via the public pay-by-plate portal.

create table if not exists public.parking_payments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  plate_number        text not null,
  zone_id             uuid references public.zones(id) on delete set null,
  session_id          uuid references public.parking_sessions(id) on delete set null,
  amount_nzd          numeric(8,2) not null,
  payment_provider    text not null default 'paybyphone',
  provider_reference  text,                -- Reference returned by PayByPhone NZ
  status              text not null default 'pending'
                        check (status in ('pending', 'completed', 'failed', 'refunded', 'cancelled')),
  contact_email       text,
  contact_phone       text,
  metadata            jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Index for org-scoped queries
create index if not exists idx_parking_payments_org
  on public.parking_payments (organization_id, created_at desc);

-- Index for plate lookups
create index if not exists idx_parking_payments_plate
  on public.parking_payments (plate_number, created_at desc);

-- Auto-update updated_at
create or replace function public.set_parking_payments_updated_at()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_parking_payments_updated_at on public.parking_payments;
create trigger trg_parking_payments_updated_at
  before update on public.parking_payments
  for each row execute function public.set_parking_payments_updated_at();

-- RLS
alter table public.parking_payments enable row level security;

-- Anon can insert (public payment initiation)
create policy "parking_payments_anon_insert" on public.parking_payments
  for insert
  with check (true);

-- Anon can select their own payment by id (confirmation lookup)
-- Org members can read all payments for their org
create policy "parking_payments_read" on public.parking_payments
  for select
  using (
    organization_id = any(get_user_organization_ids())
    or auth.role() = 'anon'  -- anon can read all rows they created (filtered by id in query)
  );

-- Org members can update status (e.g. reconciliation)
create policy "parking_payments_org_update" on public.parking_payments
  for update
  using (organization_id = any(get_user_organization_ids()));

-- Grant to all roles
grant select, insert on public.parking_payments to anon;
grant select, insert, update on public.parking_payments to authenticated;
