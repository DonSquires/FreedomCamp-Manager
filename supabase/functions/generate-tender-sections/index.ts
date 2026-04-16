/**
 * generate-tender-sections
 *
 * Calls the Railway Bob inference service POST /tender/generate to produce
 * AI-drafted sections for a tender application or response.
 * Fully self-hosted — Ollama → writing model → secondary Railway assistant → heuristic.
 * No cloud AI is used.
 *
 * Required body fields:
 *   document_id      UUID of the tender_documents row
 *   generation_type  'application' | 'response'
 *
 * Optional body fields:
 *   organization_context  { name, psa_licence, nzbn }
 *   trigger_training      boolean — set true when approving a tender to send
 *                          outcome back to Bob for self-learning
 *   outcome               'approved' | 'rejected' | 'shortlisted'  (for training)
 *   outcome_notes         string  (for training)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { withCors, getCorsHeaders } from '../_shared/withCors.ts'

const INFERENCE_SERVICE_URL = (Deno.env.get('INFERENCE_SERVICE_URL') || '').replace(/\/$/, '')
const INFERENCE_API_KEY = Deno.env.get('INFERENCE_API_KEY') || ''

function inferenceHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (INFERENCE_API_KEY) h['Authorization'] = `Bearer ${INFERENCE_API_KEY}`
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
}> {
  if (!INFERENCE_SERVICE_URL) throw new Error('INFERENCE_SERVICE_URL is not configured')

  const resp = await fetch(`${INFERENCE_SERVICE_URL}/tender/generate`, {
    method: 'POST',
    headers: inferenceHeaders(),
    body: JSON.stringify({
      generation_type: generationType,
      context,
      organization_context: orgContext,
    }),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`Bob /tender/generate error ${resp.status}: ${errText.slice(0, 200)}`)
  }

  const json = await resp.json()
  if (!json.success) throw new Error('Bob tender generation returned success=false')

  return {
    sections: json.sections || {},
    provider: json.provider || 'heuristic',
    model_used: json.model_used || 'template',
  }
}

async function callTenderTrain(payload: Record<string, unknown>): Promise<void> {
  if (!INFERENCE_SERVICE_URL) return
  try {
    await fetch(`${INFERENCE_SERVICE_URL}/tender/train`, {
      method: 'POST',
      headers: inferenceHeaders(),
      body: JSON.stringify(payload),
    })
  } catch {
    // Training is best-effort — don't block the response
  }
}

export default withCors(async (req: Request) => {
  const corsHeaders = corsHeaders

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  // Authenticate the calling user
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', ''),
  )
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const documentId = body.document_id as string
  const generationType = body.generation_type === 'application' ? 'application' : 'response'
  const orgContext = (body.organization_context as Record<string, string>) || {}
  const triggerTraining = body.trigger_training === true
  const outcome = body.outcome as string | undefined
  const outcomeNotes = body.outcome_notes as string | undefined

  if (!documentId) {
    return new Response(JSON.stringify({ error: 'document_id is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Fetch the tender document
  const { data: doc, error: docErr } = await supabase
    .from('tender_documents')
    .select('id, extracted_text, assessment, issuing_body, reference_number, due_date, key_services, key_requirements, key_dates, organization_id')
    .eq('id', documentId)
    .single()

  if (docErr || !doc) {
    return new Response(JSON.stringify({ error: 'Tender document not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Verify the user belongs to the same organisation
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.organization_id !== doc.organization_id) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // --- Training path: trigger Bob self-learning from an approved tender ---
  if (triggerTraining && outcome) {
    // Fetch current draft sections to include in the training payload
    const { data: currentDraft } = await supabase
      .from('tender_documents')
      .select('draft_sections')
      .eq('id', documentId)
      .single()

    await callTenderTrain({
      generation_type: generationType,
      issuing_body: doc.issuing_body || '',
      key_services: doc.key_services || [],
      outcome,
      outcome_notes: outcomeNotes || '',
      sections: currentDraft?.draft_sections || {},
    })

    return new Response(JSON.stringify({ success: true, trained: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // --- Generation path ---
  const assessment = doc.assessment || {}
  const context: Record<string, unknown> = {
    extracted_text: (doc.extracted_text || '').slice(0, 12000),
    issuing_body: doc.issuing_body || assessment.issuing_body || '',
    reference_number: doc.reference_number || assessment.reference_number || '',
    due_date: doc.due_date || assessment.due_date || '',
    key_services: doc.key_services || assessment.key_services || [],
    key_requirements: doc.key_requirements || assessment.key_requirements || [],
    key_dates: doc.key_dates || assessment.key_dates || [],
    document_type: assessment.document_type || 'rfp',
  }

  let result: { sections: Record<string, string>; provider: string; model_used: string }
  try {
    result = await callTenderGenerate(generationType, context, orgContext)
  } catch (err: unknown) {
    return new Response(
      JSON.stringify({ error: 'Generation failed', message: (err as Error).message }),
      {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }

  // Persist generated sections to the document
  const { error: updateErr } = await supabase
    .from('tender_documents')
    .update({
      draft_sections: result.sections,
      generation_provider: result.provider,
      generation_model: result.model_used,
      last_generated_at: new Date().toISOString(),
      last_generated_by: user.id,
      generation_type: generationType,
      status: 'drafting',
    })
    .eq('id', documentId)

  if (updateErr) {
    console.error('Failed to persist generated sections:', updateErr.message)
  }

  return new Response(
    JSON.stringify({
      success: true,
      sections: result.sections,
      provider: result.provider,
      model_used: result.model_used,
    }),
    {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  )
})
