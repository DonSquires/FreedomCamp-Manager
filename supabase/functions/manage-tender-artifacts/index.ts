import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders } from '../_shared/withCors.ts'

type TenderArtifactAction =
  | 'create_reference_material'
  | 'update_reference_material'
  | 'create_reference_version'
  | 'update_tender_document'
  | 'add_tender_comment'
  | 'add_tender_collaborator'
  | 'remove_tender_collaborator'

interface TenderArtifactRequest {
  action: TenderArtifactAction
  referenceMaterialId?: string
  documentId?: string
  collaboratorId?: string
  payload?: Record<string, unknown>
}

const ADMIN_ROLES = new Set(['admin', 'admin_officer', 'master', 'grand_master'])

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeReferenceCreatePayload(payload: Record<string, unknown>, userId: string): Record<string, unknown> {
  const allowed = [
    'organization_id', 'title', 'description', 'material_type', 'file_name', 'file_path',
    'file_public_url', 'file_kind', 'extracted_text', 'extraction_status', 'extraction_notes',
    'is_active', 'version', 'previous_version_id',
  ]

  const next: Record<string, unknown> = { uploaded_by: userId }
  for (const key of allowed) {
    if (payload[key] !== undefined) next[key] = payload[key]
  }
  return next
}

function sanitizeReferenceUpdatePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    'title', 'description', 'material_type', 'file_name', 'file_path', 'file_public_url',
    'file_kind', 'extracted_text', 'extraction_status', 'extraction_notes', 'is_active',
    'version', 'previous_version_id', 'uploaded_by',
  ]

  const next: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (payload[key] !== undefined) next[key] = payload[key]
  }
  return next
}

function sanitizeReferenceVersionPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    'reference_material_id', 'version', 'file_name', 'file_path', 'file_kind', 'extracted_text', 'replaced_by',
  ]

  const next: Record<string, unknown> = {}
  for (const key of allowed) {
    if (payload[key] !== undefined) next[key] = payload[key]
  }
  return next
}

function sanitizeDocumentUpdatePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    'status', 'owner_id', 'approved_by', 'approved_at', 'approval_notes', 'training_outcome_reason',
    'rejection_category', 'response_sections', 'generated_html', 'file_name', 'file_kind', 'file_path',
    'file_public_url', 'extracted_text',
  ]

  const next: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (payload[key] !== undefined) next[key] = payload[key]
  }
  return next
}

async function getDocumentAccess(adminClient: ReturnType<typeof createClient>, documentId: string, userId: string) {
  const { data: doc, error: docError } = await adminClient
    .from('tender_documents')
    .select('*')
    .eq('id', documentId)
    .single()

  if (docError || !doc) {
    return { error: 'Tender document not found', status: 404 as const }
  }

  const { data: collaborator } = await adminClient
    .from('tender_collaborators')
    .select('id, role')
    .eq('document_id', documentId)
    .eq('user_id', userId)
    .maybeSingle()

  const isOwner = doc.owner_id === userId
  const collabRole = collaborator?.role ?? null
  const canEdit = isOwner || collabRole === 'editor' || collabRole === 'approver'
  const canView = isOwner || !!collaborator

  return {
    doc,
    collaborator,
    isOwner,
    canEdit,
    canView,
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser()

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: caller } = await adminClient
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single()

    if (!caller) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = (await req.json()) as TenderArtifactRequest
    if (!body.action) {
      return new Response(JSON.stringify({ error: 'action is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const isAdmin = ADMIN_ROLES.has(caller.role)

    if (body.action === 'create_reference_material') {
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const payload = sanitizeReferenceCreatePayload(isObject(body.payload) ? body.payload : {}, user.id)
      const orgId = toText(payload.organization_id)
      if (!orgId || !toText(payload.title)) {
        return new Response(JSON.stringify({ error: 'organization_id and title are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (caller.role !== 'master' && caller.role !== 'grand_master' && caller.organization_id !== orgId) {
        return new Response(JSON.stringify({ error: 'Cannot create reference materials for another organization' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: created, error } = await adminClient
        .from('tender_reference_materials')
        .insert(payload)
        .select('*')
        .single()

      if (error || !created) throw new Error(error?.message ?? 'Failed to create reference material')

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: created.organization_id,
        action: 'tender_reference_material_created',
        entity_type: 'tender_reference_material',
        entity_id: created.id,
        performed_by: user.id,
        new_values: created,
      })
      if (auditError) throw new Error(`Reference created but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true, data: created }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'update_reference_material') {
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const referenceId = toText(body.referenceMaterialId)
      if (!referenceId) {
        return new Response(JSON.stringify({ error: 'referenceMaterialId is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: existing, error: existingError } = await adminClient
        .from('tender_reference_materials')
        .select('*')
        .eq('id', referenceId)
        .single()

      if (existingError || !existing) {
        return new Response(JSON.stringify({ error: 'Reference material not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (caller.role !== 'master' && caller.role !== 'grand_master' && caller.organization_id !== existing.organization_id) {
        return new Response(JSON.stringify({ error: 'Cannot update reference materials for another organization' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const payload = sanitizeReferenceUpdatePayload(isObject(body.payload) ? body.payload : {})
      const { data: updated, error } = await adminClient
        .from('tender_reference_materials')
        .update(payload)
        .eq('id', referenceId)
        .select('*')
        .single()

      if (error || !updated) throw new Error(error?.message ?? 'Failed to update reference material')

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: updated.organization_id,
        action: 'tender_reference_material_updated',
        entity_type: 'tender_reference_material',
        entity_id: updated.id,
        performed_by: user.id,
        old_values: existing,
        new_values: updated,
      })
      if (auditError) throw new Error(`Reference updated but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true, data: updated }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'create_reference_version') {
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const payload = sanitizeReferenceVersionPayload(isObject(body.payload) ? body.payload : {})
      if (!toText(payload.reference_material_id)) {
        return new Response(JSON.stringify({ error: 'reference_material_id is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: created, error } = await adminClient
        .from('tender_reference_versions')
        .insert(payload)
        .select('*')
        .single()

      if (error || !created) throw new Error(error?.message ?? 'Failed to create reference version')

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: caller.organization_id,
        action: 'tender_reference_version_created',
        entity_type: 'tender_reference_version',
        entity_id: created.id,
        performed_by: user.id,
        new_values: created,
      })
      if (auditError) throw new Error(`Reference version created but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true, data: created }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'update_tender_document') {
      const documentId = toText(body.documentId)
      if (!documentId) {
        return new Response(JSON.stringify({ error: 'documentId is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const access = await getDocumentAccess(adminClient, documentId, user.id)
      if ('error' in access) {
        return new Response(JSON.stringify({ error: access.error }), {
          status: access.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!isAdmin && !access.canEdit) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const payload = sanitizeDocumentUpdatePayload(isObject(body.payload) ? body.payload : {})
      if (!access.isOwner && payload.owner_id !== undefined) {
        return new Response(JSON.stringify({ error: 'Only document owner can transfer ownership' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: updated, error } = await adminClient
        .from('tender_documents')
        .update(payload)
        .eq('id', documentId)
        .select('*')
        .single()

      if (error || !updated) throw new Error(error?.message ?? 'Failed to update tender document')

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: updated.organization_id,
        action: 'tender_document_updated',
        entity_type: 'tender_document',
        entity_id: updated.id,
        performed_by: user.id,
        old_values: access.doc,
        new_values: updated,
      })
      if (auditError) throw new Error(`Tender document updated but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true, data: updated }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'add_tender_comment') {
      const documentId = toText(body.documentId)
      if (!documentId) {
        return new Response(JSON.stringify({ error: 'documentId is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const access = await getDocumentAccess(adminClient, documentId, user.id)
      if ('error' in access) {
        return new Response(JSON.stringify({ error: access.error }), {
          status: access.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!isAdmin && !access.canView) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const content = toText(body.payload?.content)
      const isApprovalNote = Boolean(body.payload?.is_approval_note)
      if (!content) {
        return new Response(JSON.stringify({ error: 'content is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: created, error } = await adminClient
        .from('tender_comments')
        .insert({
          document_id: documentId,
          user_id: user.id,
          content,
          is_approval_note: isApprovalNote,
        })
        .select('*')
        .single()

      if (error || !created) throw new Error(error?.message ?? 'Failed to add tender comment')

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: access.doc.organization_id,
        action: 'tender_comment_added',
        entity_type: 'tender_comment',
        entity_id: created.id,
        performed_by: user.id,
        new_values: created,
      })
      if (auditError) throw new Error(`Comment added but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true, data: created }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'add_tender_collaborator') {
      const documentId = toText(body.documentId)
      const targetUserId = toText(body.payload?.user_id)
      const role = toText(body.payload?.role)
      if (!documentId || !targetUserId || !role) {
        return new Response(JSON.stringify({ error: 'documentId, user_id and role are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const access = await getDocumentAccess(adminClient, documentId, user.id)
      if ('error' in access) {
        return new Response(JSON.stringify({ error: access.error }), {
          status: access.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!isAdmin && !access.isOwner) {
        return new Response(JSON.stringify({ error: 'Only document owner can invite collaborators' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: created, error } = await adminClient
        .from('tender_collaborators')
        .insert({
          document_id: documentId,
          user_id: targetUserId,
          role,
          invited_by: user.id,
        })
        .select('*')
        .single()

      if (error || !created) throw new Error(error?.message ?? 'Failed to add collaborator')

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: access.doc.organization_id,
        action: 'tender_collaborator_added',
        entity_type: 'tender_collaborator',
        entity_id: created.id,
        performed_by: user.id,
        new_values: created,
      })
      if (auditError) throw new Error(`Collaborator added but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true, data: created }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'remove_tender_collaborator') {
      const collaboratorId = toText(body.collaboratorId)
      if (!collaboratorId) {
        return new Response(JSON.stringify({ error: 'collaboratorId is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: collaborator, error: collabError } = await adminClient
        .from('tender_collaborators')
        .select('*')
        .eq('id', collaboratorId)
        .single()

      if (collabError || !collaborator) {
        return new Response(JSON.stringify({ error: 'Collaborator not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const access = await getDocumentAccess(adminClient, collaborator.document_id, user.id)
      if ('error' in access) {
        return new Response(JSON.stringify({ error: access.error }), {
          status: access.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!isAdmin && !access.isOwner) {
        return new Response(JSON.stringify({ error: 'Only document owner can remove collaborators' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { error } = await adminClient
        .from('tender_collaborators')
        .delete()
        .eq('id', collaboratorId)

      if (error) throw new Error(error.message ?? 'Failed to remove collaborator')

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: access.doc.organization_id,
        action: 'tender_collaborator_removed',
        entity_type: 'tender_collaborator',
        entity_id: collaboratorId,
        performed_by: user.id,
        old_values: collaborator,
      })
      if (auditError) throw new Error(`Collaborator removed but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: `Unsupported action: ${body.action}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
