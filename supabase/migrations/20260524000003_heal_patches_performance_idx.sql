create index if not exists idx_heal_patches_created_at_desc
  on public.heal_patches (created_at desc);