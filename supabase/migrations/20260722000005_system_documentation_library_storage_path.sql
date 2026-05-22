alter table public.system_documentation_library
  add column if not exists storage_object_path text;

create index if not exists idx_system_documentation_library_storage_object_path
  on public.system_documentation_library (storage_object_path);
