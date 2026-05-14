/**
 * generate-tender-sections
 *
 * Calls the Bob inference service POST /tender/generate to produce
 * AI-drafted sections for a tender application or response.
 * Fully self-hosted — Ollama → writing model → secondary assistant → heuristic.
 * No cloud AI is used.
 *
 * Required body fields:
 *   document_id      UUID of the tender_documents row
 *   generation_type  'application' | 'response'
 *
 * Optional body fields:
 *   organization_context  { name, psa_licence, nzbn }
 *   reference_ids         string[] — UUIDs of tender_reference_materials to include
 *   trigger_training      boolean — set true when approving/rejecting a tender to send
 *                          outcome back to Bob for self-learning
 *   outcome               'approved' | 'rejected' | 'shortlisted'  (for training)
 *   outcome_notes         string  (for training)
 *   rejection_reason      string  (required when outcome='rejected')
 *   rejection_category    'pricing'|'scope'|'qualifications'|'compliance'|'formatting'|'other'
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { withCors, getCorsHeaders } from '../_shared/withCors.ts'
import { collectDirectOrgIds } from '../_shared/orgAccess.ts'

const INFERENCE_SERVICE_URL = (Deno.env.get('INFERENCE_SERVICE_URL') || '').replace(/\/$/, '')
const INFERENCE_API_KEY =
  Deno.env.get('INFERENCE_API_KEY') ||
  Deno.env.get('RUNPOD_ENDPOINT_API_KEY') ||
  Deno.env.get('RUNPOD_API_KEY') ||
  Deno.env.get('BOB_INFERENCE_API_KEY') ||
  ''

function envTimeoutMs(key: string, fallback: number, min: number, max: number): number {
  const raw = Number(Deno.env.get(key) || '')
  if (!Number.isFinite(raw) || raw <= 0) return fallback
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

// Keep request timeout below platform hard limits so Edge invocations fail fast
// under heavy RunPod/Railway load instead of stalling until runtime eviction.
const INFERENCE_REQUEST_TIMEOUT_MS = envTimeoutMs('TENDER_INFERENCE_TIMEOUT_MS', 90_000, 10_000, 180_000)
const RUNPOD_EXECUTION_TIMEOUT_MS = envTimeoutMs('RUNPOD_TENDER_EXECUTION_TIMEOUT_MS', 120_000, 30_000, 300_000)
const RUNPOD_TRAIN_EXECUTION_TIMEOUT_MS = envTimeoutMs('RUNPOD_TENDER_TRAIN_TIMEOUT_MS', 60_000, 30_000, 180_000)

function isRunpodServerless(url: string): boolean {
  return url.includes('runpod.io') || url.includes('/runsync')
}

function inferenceHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (INFERENCE_API_KEY) {
    // Send both for compatibility with existing Bob auth middleware and proxies
    // that may strip Authorization in some environments.
    h['Authorization'] = `Bearer ${INFERENCE_API_KEY}`
    h['x-inference-api-key'] = INFERENCE_API_KEY
  }
  return h
}

async function callTenderGenerate(
  generationType: string,
  context: Record<string, unknown>,
  orgContext: Record<string, string>,
): Promise<{
  sections: Record<string, string>
  provider: string
  model_used: string
  references_used?: boolean
}> {
  if (!INFERENCE_SERVICE_URL) throw new Error('INFERENCE_SERVICE_URL is not configured')

  // BOB_COST_SAVER: skip inference entirely when flag is set
  const costSaverEnabled = ['1','true','yes','on'].includes(String(Deno.env.get('BOB_COST_SAVER') ?? '').trim().toLowerCase())
  if (costSaverEnabled) throw new Error('BOB_COST_SAVER enabled — tender AI generation paused to reduce spend')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), INFERENCE_REQUEST_TIMEOUT_MS)

  let resp: Response
  try {
    // Try HTTP /tender/generate endpoint (inference-service)
    if (isRunpodServerless(INFERENCE_SERVICE_URL)) {
      // RunPod serverless: forward via /runsync with tender_generate action
      resp = await fetch(`${INFERENCE_SERVICE_URL}/runsync`, {
        method: 'POST',
        headers: inferenceHeaders(),
        body: JSON.stringify({
          executionTimeout: RUNPOD_EXECUTION_TIMEOUT_MS,
          input: {
            action: 'tender_generate',
            generation_type: generationType,
            context,
            organization_context: orgContext,
          },
        }),
        signal: controller.signal,
      })
    } else {
      // inference-service HTTP route
      resp = await fetch(`${INFERENCE_SERVICE_URL}/tender/generate`, {
        method: 'POST',
        headers: inferenceHeaders(),
        body: JSON.stringify({
          generation_type: generationType,
          context,
          organization_context: orgContext,
        }),
        signal: controller.signal,
      })
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`Bob /tender/generate timed out after ${Math.floor(INFERENCE_REQUEST_TIMEOUT_MS / 1000)}s`)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }

  if (!resp.ok) {
    const errText = await resp.text()
    // If RunPod doesn't support tender_generate action, fall back to heuristic
    if (isRunpodServerless(INFERENCE_SERVICE_URL) && resp.status >= 400) {
      console.warn(`[tender] RunPod serverless does not support tender_generate action (${resp.status}), falling back to heuristic template`)
      return {
        sections: {
          cover_letter: '[Heuristic cover letter template — upgrade to inference-service for AI generation]',
          executive_summary: '[Heuristic executive summary template]',
          services_offered: '[Heuristic services offered template]',
          pricing_notes: '[Heuristic pricing notes template]',
          team_qualifications: '[Heuristic team qualifications template]',
          health_and_safety: '[Heuristic health and safety template]',
          declaration: '[Heuristic declaration template]',
        },
        provider: 'heuristic',
        model_used: 'template-fallback',
        references_used: false,
      }
    }
    throw new Error(`Bob /tender/generate error ${resp.status}: ${errText.slice(0, 200)}`)
  }

  const json = await resp.json()
  const output = json.output ?? json
  if (output?.success === false) throw new Error('Bob tender generation returned success=false')

  return {
    sections: output.sections || {},
    provider: output.provider || 'heuristic',
    model_used: output.model_used || 'template',
    references_used: output.references_used ?? false,
  }
}

async function callTenderTrain(payload: Record<string, unknown>): Promise<void> {
  if (!INFERENCE_SERVICE_URL) return
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), INFERENCE_REQUEST_TIMEOUT_MS)
  try {
    if (isRunpodServerless(INFERENCE_SERVICE_URL)) {
      // RunPod serverless: forward via /runsync with tender_train action
      await fetch(`${INFERENCE_SERVICE_URL}/runsync`, {
        method: 'POST',
        headers: inferenceHeaders(),
        body: JSON.stringify({
          executionTimeout: RUNPOD_TRAIN_EXECUTION_TIMEOUT_MS,
          input: {
            action: 'tender_train',
            payload,
          },
        }),
        signal: controller.signal,
      })
    } else {
      // inference-service HTTP route
      await fetch(`${INFERENCE_SERVICE_URL}/tender/train`, {
        method: 'POST',
        headers: inferenceHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    }
  } catch {
    // Training is best-effort — don't block the response
  } finally {
    clearTimeout(timeoutId)
  }
}

Deno.serve(withCors(async (req: Request) => {
  const corsH = getCorsHeaders(req)

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsH, 'Content-Type': 'application/json' },
    })

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  // Authenticate the calling user
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorised' }, 401)

  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', ''),
  )
  if (authError || !user) return json({ error: 'Invalid token' }, 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const documentId = body.document_id as string
  const generationType = body.generation_type === 'application' ? 'application' : 'response'
  const orgContext = (body.organization_context as Record<string, string>) || {}
  const triggerTraining = body.trigger_training === true
  const outcome = body.outcome as string | undefined
  const outcomeNotes = body.outcome_notes as string | undefined
  const rejectionReason = body.rejection_reason as string | undefined
  const rejectionCategory = body.rejection_category as string | undefined
  const referenceIds: string[] = Array.isArray(body.reference_ids) ? body.reference_ids as string[] : []

  if (!documentId) return json({ error: 'document_id is required' }, 400)

  // Fetch the tender document
  const { data: doc, error: docErr } = await supabase
    .from('tender_documents')
    .select('id, extracted_text, assessment, issuing_body, reference_number, due_date, key_services, key_requirements, key_dates, organization_id, bob_assessment')
    .eq('id', documentId)
    .single()

  if (docErr || !doc) return json({ error: 'Tender document not found' }, 404)

  // Verify the user belongs to the same organisation
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('organization_id, role, employer_organization_id, extra_organization_ids, authorized_work_locations')
    .eq('id', user.id)
    .single()

  const allowedOrganizationIds = collectDirectOrgIds(profile as any)

  if (!profile || (profile.role !== 'master' && !allowedOrganizationIds.has(doc.organization_id as string))) {
    return json({ error: 'Forbidden' }, 403)
  }

  // --- Resolve reference IDs (if not supplied, read included=true from DB) ---
  let resolvedRefIds = referenceIds
  if (resolvedRefIds.length === 0) {
    const { data: dbRefs } = await (supabase as any)
      .from('tender_document_references')
      .select('reference_material_id')
      .eq('document_id', documentId)
      .eq('included', true)
    if (dbRefs && dbRefs.length > 0) {
      resolvedRefIds = dbRefs.map((r: any) => r.reference_material_id)
    }
  }

  // --- Fetch reference context if any refs are selected ---
  let referenceContext = ''
  let usedRefs: Array<{ id: string; title: string; material_type: string }> = []

  if (resolvedRefIds.length > 0) {
    const REFERENCE_TYPE_ORDER = ['compliance', 'legal', 'policy', 'pricing', 'template', 'past_tender', 'nz_reference', 'other']
    const { data: refs } = await (supabase as any)
      .from('tender_reference_materials')
      .select('id, title, material_type, extracted_text')
      .in('id', resolvedRefIds)
      .eq('organization_id', doc.organization_id)
      .eq('is_active', true)
      .eq('extraction_status', 'extracted')

    if (refs && refs.length > 0) {
      const sorted = [...refs].sort((a: any, b: any) => {
        const ai = REFERENCE_TYPE_ORDER.indexOf(a.material_type)
        const bi = REFERENCE_TYPE_ORDER.indexOf(b.material_type)
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
      })

      const parts: string[] = []
      for (const r of sorted) {
        const snippet = (r.extracted_text || '').slice(0, 2000)
        if (!snippet) continue
        parts.push(`[${r.material_type.toUpperCase()}] ${r.title}:\n${snippet}`)
        usedRefs.push({ id: r.id, title: r.title, material_type: r.material_type })
      }
      referenceContext = parts.join('\n\n---\n')
    }
  }

  // --- Training path: synchronous (fast — no AI generation call) ---------------
  if (triggerTraining && outcome) {
    // Fetch current draft sections to include in the training payload
    const { data: currentDraft } = await supabase
      .from('tender_documents')
      .select('draft_sections')
      .eq('id', documentId)
      .single()

    // Persist training outcome fields on the document
    const trainingUpdates: Record<string, any> = {}
    if (rejectionReason) trainingUpdates.training_outcome_reason = rejectionReason
    if (rejectionCategory) trainingUpdates.rejection_category = rejectionCategory
    if (outcome === 'rejected') {
      trainingUpdates.status = 'drafting'
    }
    if (Object.keys(trainingUpdates).length > 0) {
      await supabase.from('tender_documents').update(trainingUpdates).eq('id', documentId)
    }

    await callTenderTrain({
      generation_type: generationType,
      issuing_body: doc.issuing_body || '',
      key_services: doc.key_services || [],
      outcome,
      outcome_notes: outcomeNotes || '',
      rejection_reason: rejectionReason || null,
      rejection_category: rejectionCategory || null,
      reference_ids_used: usedRefs.map(r => r.id),
      reference_titles_used: usedRefs.map(r => r.title),
      sections: currentDraft?.draft_sections || {},
    })

    return json({ success: true, trained: true })
  }

  // --- Generation path — fire-and-forget ------------------------------------
  // Mark as generating so the UI can show a spinner while polling
  await supabase.from('tender_documents').update({ status: 'drafting', draft_sections: null }).eq('id', documentId)

  const assessment = (doc as any).bob_assessment || doc.assessment || {}
  const context: Record<string, unknown> = {
    extracted_text: (doc.extracted_text || '').slice(0, 12000),
    issuing_body: doc.issuing_body || assessment.issuing_body || '',
    reference_number: doc.reference_number || assessment.reference_number || '',
    due_date: doc.due_date || assessment.due_date || '',
    key_services: doc.key_services || assessment.key_services || [],
    key_requirements: doc.key_requirements || assessment.key_requirements || [],
    weighted_criteria: assessment.weighted_criteria || [],
    key_dates: doc.key_dates || assessment.key_dates || [],
    document_type: assessment.document_type || 'rfp',
    reference_context: referenceContext,
  }

  const backgroundWork = doGeneration(supabase, documentId, user.id, generationType, orgContext, context, usedRefs)

  // @ts-ignore EdgeRuntime is available in Supabase Deno runtime
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(backgroundWork)
  } else {
    await backgroundWork
  }

  return json({
    accepted: true,
    document_id: documentId,
    message: 'Generation started — poll document last_generated_at for completion',
  }, 202)
}))

async function doGeneration(
  supabase: ReturnType<typeof import('https://esm.sh/@supabase/supabase-js@2.45.3').createClient>,
  documentId: string,
  userId: string,
  generationType: string,
  orgContext: Record<string, string>,
  context: Record<string, unknown>,
  usedRefs: Array<{ id: string; title: string; material_type: string }>,
): Promise<void> {
  try {
    const result = await callTenderGenerate(generationType, context, orgContext)

    await (supabase as any)
      .from('tender_documents')
      .update({
        draft_sections: result.sections,
        generation_provider: result.provider,
        generation_model: result.model_used,
        last_generated_at: new Date().toISOString(),
        last_generated_by: userId,
        generation_type: generationType,
        status: 'drafting',
      })
      .eq('id', documentId)

    if (usedRefs.length > 0) {
      const now = new Date().toISOString()
      for (const r of usedRefs) {
        await (supabase as any)
          .from('tender_document_references')
          .upsert({
            document_id: documentId,
            reference_material_id: r.id,
            included: true,
            used_in_generation: true,
            generation_run_at: now,
          }, { onConflict: 'document_id,reference_material_id' })
      }
    }
    console.log(`✅ Background generation complete for tender_document ${documentId} (${result.provider})`)
  } catch (err: unknown) {
    console.error('Background doGeneration error:', err)
    // Reset draft_sections to null so the UI knows generation failed
    await (supabase as any)
      .from('tender_documents')
      .update({ last_generated_at: new Date().toISOString(), generation_provider: 'failed' })
      .eq('id', documentId)
  }
}
