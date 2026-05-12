-- Bob persistent user memory + tactical actuation support tables.

CREATE TABLE IF NOT EXISTS public.bob_user_memory (
  user_id uuid NOT NULL,
  context_key text NOT NULL,
  context_value text NOT NULL,
  last_interaction timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bob_user_memory_pkey PRIMARY KEY (user_id, context_key),
  CONSTRAINT bob_user_memory_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS bob_user_memory_last_interaction_idx
  ON public.bob_user_memory (user_id, last_interaction DESC);

ALTER TABLE public.bob_user_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bob_user_memory_owner_select" ON public.bob_user_memory;
CREATE POLICY "bob_user_memory_owner_select"
  ON public.bob_user_memory
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "bob_user_memory_owner_upsert" ON public.bob_user_memory;
CREATE POLICY "bob_user_memory_owner_upsert"
  ON public.bob_user_memory
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "bob_user_memory_owner_update" ON public.bob_user_memory;
CREATE POLICY "bob_user_memory_owner_update"
  ON public.bob_user_memory
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  address text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clients_pkey PRIMARY KEY (id),
  CONSTRAINT clients_org_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT clients_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS clients_org_idx ON public.clients (organization_id);
CREATE INDEX IF NOT EXISTS clients_name_idx ON public.clients (name);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clients_org_select" ON public.clients;
CREATE POLICY "clients_org_select"
  ON public.clients
  FOR SELECT
  TO authenticated
  USING (public.user_can_read_organization(organization_id));

DROP POLICY IF EXISTS "clients_org_insert" ON public.clients;
CREATE POLICY "clients_org_insert"
  ON public.clients
  FOR INSERT
  TO authenticated
  WITH CHECK (organization_id = ANY(public.get_user_organization_ids()));

DROP POLICY IF EXISTS "clients_org_update" ON public.clients;
CREATE POLICY "clients_org_update"
  ON public.clients
  FOR UPDATE
  TO authenticated
  USING (organization_id = ANY(public.get_user_organization_ids()))
  WITH CHECK (organization_id = ANY(public.get_user_organization_ids()));

DROP POLICY IF EXISTS "clients_org_delete" ON public.clients;
CREATE POLICY "clients_org_delete"
  ON public.clients
  FOR DELETE
  TO authenticated
  USING (organization_id = ANY(public.get_user_organization_ids()));
