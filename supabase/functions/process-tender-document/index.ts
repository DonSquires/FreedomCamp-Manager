/**
 * process-tender-document
 *
 * Fire-and-forget architecture:
 *   1. Auth + validation synchronous.
 *   2. DB marked status = 'processing' immediately.
 *   3. HTTP 202 returned right away — no hanging SDK invocation.
 *   4. Actual AI analysis runs inside EdgeRuntime.waitUntil() background task.
 *   5. Frontend polls DB every 5s and detects status = 'assessed'.
 *
 * Required body fields:
 *   document_id   UUID of the tender_documents row
 *
 * Optional body fields:
 *   extracted_text  Pre-extracted text (overrides tender_documents.extracted_text)
 *   force_enrich    boolean — request web enrichment even if already done
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { withCors, getCorsHeaders } from '../_shared/withCors.ts'

const INFERENCE_SERVICE_URL = (Deno.env.get('INFERENCE_SERVICE_URL') || '').replace(/\/$/, '')
const INFERENCE_API_KEY = Deno.env.get('INFERENCE_API_KEY') || ''

interface AssessmentResult {
  document_type: string
  issuing_body: string
  reference_number: string
  due_date: string | null
  key_services: string[]
  key_requirements: string[]
  key_dates: Array<{ label: string; date: string }>
  assessment_summary: string
  enrichment_queries: string[]
  response_outline: Record<string, string>
}

// ---------------------------------------------------------------------------
// Heuristic fallback — called when Ollama fails or is unavailable
// ---------------------------------------------------------------------------
function buildHeuristicAssessment(doc: any, text: string, reason: string): AssessmentResult {
  const refMatch = text.match(/\b([A-Z]{0,4}-?\d{2}-\d{3,})\b/i)
  const issuingMatch =
    text.match(/issued by\s+([^\n.]+)/i) ||
    text.match(/([A-Z][A-Za-z ]+(?:Council|Authority|Government|Ministry|Department|Board))/m)
  const dueDateMatch =
    text.match(/clos(?:ing|e)[^\n]*?(\d{1,2}\s+\w+\s+20\d{2})/i) ||
    text.match(/due[^\n]*?(\d{1,2}\s+\w+\s+20\d{2})/i) ||
    text.match(/submission[^\n]*?(\d{1,2}\s+\w+\s+20\d{2})/i)

  const serviceKeywords = [
    'security', 'patrol', 'noise control', 'cash collection',
    'biosecurity', 'surveillance', 'CCTV', 'access control',
  ]
  const foundServices = serviceKeywords.filter(kw =>
    text.toLowerCase().includes(kw.toLowerCase())
  )

  return {
    document_type: doc.document_type || 'rfip',
    issuing_body: (issuingMatch ? issuingMatch[1].trim() : doc.issuing_body) || '',
    reference_number: refMatch ? refMatch[1] : (doc.reference_number || ''),
    due_date: null,
    key_services: foundServices,
    key_requirements: [],
    key_dates: dueDateMatch ? [{ label: 'Closing date', date: dueDateMatch[1] }] : [],
    assessment_summary:
      `⚠️ ${reason} Basic information has been extracted from the document text. ` +
      `Key services identified: ${foundServices.join(', ') || 'none detected'}. ` +
      `Please review the Intake tab and try Bob Analysis again, or proceed to Draft Response manually.`,
    enrichment_queries: [],
    response_outline: {
      cover_letter: '',
      executive_summary: '',
      services_offered: '',
      pricing_notes: '',
      team_qualifications: '',
      health_and_safety: '',
      declaration: '',
    },
  }
}

// ---------------------------------------------------------------------------
// Call Bob via Railway inference service
// ---------------------------------------------------------------------------
async function callBobChat(systemPrompt: string, userMessage: string): Promise<string> {
  if (!INFERENCE_SERVICE_URL) throw new Error('INFERENCE_SERVICE_URL not configured')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (INFERENCE_API_KEY) headers['Authorization'] = `Bearer ${INFERENCE_API_KEY}`

  const resp = await fetch(`${INFERENCE_SERVICE_URL}/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: userMessage,
      system_prompt: systemPrompt,
      provider_preference: 'auto',
      response_format: 'json',
    }),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`Inference service error ${resp.status}: ${errText.slice(0, 200)}`)
  }

  const json = await resp.json()
  return (
    json?.text ||
    json?.message?.content ||
    json?.message ||
    json?.response ||
    JSON.stringify(json)
  )
}

// ---------------------------------------------------------------------------
// Background task — all AI work runs here after HTTP response is sent
// ---------------------------------------------------------------------------
async function runAnalysis(
  supabase: any,
  doc: any,
  textToAnalyse: string,
  force_enrich: boolean,
  reference_ids: string[] = [],
) {
  const document_id = doc.id

  try {
    const systemPrompt =
      `You are Bob, a procurement analyst for Iron Eagle Security NZ. ` +
      `Return ONLY a valid JSON object with these exact keys: ` +
      `document_type (rfp/rfi/rfq/rfip/tender_application/tender_response/proposal/other), ` +
      `issuing_body, reference_number, due_date (YYYY-MM-DD or null), ` +
      `key_services (array of strings), key_requirements (array of strings), ` +
      `key_dates (array of {label,date}), assessment_summary (2-4 sentences), ` +
      `enrichment_queries (array of strings), ` +
      `response_outline ({cover_letter,executive_summary,services_offered,pricing_notes,team_qualifications,health_and_safety,declaration}). ` +
      `No text outside the JSON.`

    const userMessage =
      `Analyse this procurement document and return the JSON assessment:\n\n---\n` +
      `${textToAnalyse.slice(0, 5000)}\n---${referenceContextBlock.slice(0, 3000)}`

    // --- Reference material context (optional) --------------------------
    // Priority order for reference injection: compliance/legal > policy > pricing > template > past_tender > nz_reference > other
    const REFERENCE_TYPE_ORDER = ['compliance', 'legal', 'policy', 'pricing', 'template', 'past_tender', 'nz_reference', 'other']
    let referenceContextBlock = ''
    let referenceContextSnapshot: Array<{ id: string; title: string; material_type: string; chars_used: number }> = []

    const incomingRefIds: string[] = Array.isArray(reference_ids) ? reference_ids : []

    if (incomingRefIds.length > 0) {
      const { data: refs } = await (supabase as any)
        .from('tender_reference_materials')
        .select('id, title, material_type, extracted_text')
        .in('id', incomingRefIds)
        .eq('organization_id', doc.organization_id)
        .eq('is_active', true)
        .eq('extraction_status', 'extracted')

      if (refs && refs.length > 0) {
        // Sort by priority
        const sorted = [...refs].sort((a, b) => {
          const ai = REFERENCE_TYPE_ORDER.indexOf(a.material_type)
          const bi = REFERENCE_TYPE_ORDER.indexOf(b.material_type)
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
        })

        const parts: string[] = []
        for (const r of sorted) {
          const snippet = (r.extracted_text || '').slice(0, 2000)
          if (!snippet) continue
          parts.push(`[${r.material_type.toUpperCase()}] ${r.title}:\n${snippet}`)
          referenceContextSnapshot.push({ id: r.id, title: r.title, material_type: r.material_type, chars_used: snippet.length })
        }

        if (parts.length > 0) {
          referenceContextBlock = `\n\n--- ORGANISATION REFERENCE MATERIAL ---\nThe following reference documents from your organisation are provided for context. Use them to calibrate your assessment:\n\n${parts.join('\n\n---\n')}\n--- END REFERENCE MATERIAL ---`
        }

        // Upsert tender_document_references rows — mark used_in_analysis
        const now = new Date().toISOString()
        for (const r of sorted) {
          await (supabase as any)
            .from('tender_document_references')
            .upsert({
              document_id,
              reference_material_id: r.id,
              included: true,
              used_in_analysis: true,
              analysis_run_at: now,
            }, { onConflict: 'document_id,reference_material_id' })
        }
      }
    }

    // --- Bob Assessment -------------------------------------------------
    const systemPrompt =
      `You are Bob, an expert analyst for Iron Eagle Security's FieldOps Manager system in New Zealand. ` +
      `Return ONLY a valid JSON object with these exact keys: ` +
      `document_type (rfp/rfi/rfq/rfip/tender_application/tender_response/proposal/other), ` +
      `issuing_body, reference_number, due_date (YYYY-MM-DD or null), ` +
      `key_services (array of strings), key_requirements (array of strings), ` +
      `key_dates (array of {label,date}), assessment_summary (2-4 sentences), ` +
      `enrichment_queries (array of strings), ` +
      `response_outline ({cover_letter,executive_summary,services_offered,pricing_notes,team_qualifications,health_and_safety,declaration}). ` +
      `No text outside the JSON.`

    let assessment: AssessmentResult
    try {
      const rawResponse = await callBobChat(systemPrompt, userMessage)
      try {
        const jsonMatch = rawResponse.match(/\{[\s\S]*\}/)
        const jsonStr = jsonMatch ? jsonMatch[0] : rawResponse
        assessment = JSON.parse(jsonStr)
      } catch {
        assessment = buildHeuristicAssessment(
          doc, textToAnalyse, 'Bob returned an unexpected response format.'
        )
      }
    } catch (inferenceErr: any) {
      console.error('Bob inference failed:', inferenceErr.message)
      assessment = buildHeuristicAssessment(
        doc, textToAnalyse, 'Bob AI service was unavailable or took too long.'
      )
    }

    // --- CRM: auto-create client organisation if not found ----------------
    let crmClientOrgId: string | null = doc.crm_client_organization_id || null
    const issuingBodyName = (assessment.issuing_body || doc.issuing_body || '').trim()

    if (issuingBodyName && !crmClientOrgId) {
      const { data: existingOrg } = await supabase
        .from('organizations')
        .select('id')
        .ilike('name', issuingBodyName)
        .limit(1)
        .maybeSingle()

      if (existingOrg?.id) {
        crmClientOrgId = existingOrg.id
      } else {
        const { data: newOrg, error: createOrgError } = await supabase
          .from('organizations')
          .insert({
            name: issuingBodyName,
            organization_type: 'client',
            organization_level: 'client',
            is_active: true,
          })
          .select('id')
          .single()

        if (!createOrgError && newOrg) {
          crmClientOrgId = newOrg.id
        } else {
          console.warn('Could not auto-create CRM org:', createOrgError?.message)
        }
      }
    }

    // --- Default response sections ----------------------------------------
    const defaultResponseSections = doc.response_sections || {
      cover_letter: assessment.response_outline?.cover_letter || '',
      executive_summary: assessment.response_outline?.executive_summary || '',
      services_offered: assessment.response_outline?.services_offered || '',
      pricing_notes: assessment.response_outline?.pricing_notes || '',
      team_qualifications: assessment.response_outline?.team_qualifications || '',
      health_and_safety: assessment.response_outline?.health_and_safety || '',
      declaration: assessment.response_outline?.declaration || '',
    }

    // --- Persist results ---------------------------------------------------
    const updates: Record<string, any> = {
      bob_assessment: assessment,
      bob_assessment_summary: assessment.assessment_summary,
      key_services: assessment.key_services,
      key_requirements: assessment.key_requirements,
      key_dates: assessment.key_dates,
      status: 'assessed',
      response_sections: defaultResponseSections,
    }
    if (referenceContextSnapshot.length > 0) {
      updates.reference_context_snapshot = referenceContextSnapshot
    }
    if (assessment.issuing_body) updates.issuing_body = assessment.issuing_body
    if (assessment.reference_number) updates.reference_number = assessment.reference_number
    if (assessment.due_date) updates.due_date = assessment.due_date
    if (assessment.document_type) updates.document_type = assessment.document_type
    if (crmClientOrgId) updates.crm_client_organization_id = crmClientOrgId

    if (assessment.enrichment_queries?.length || force_enrich) {
      updates.enrichment_requested_at = new Date().toISOString()
      updates.enrichment_data = {
        queries: assessment.enrichment_queries || [],
        status: 'queued',
        requested_at: new Date().toISOString(),
      }
    }

    await supabase.from('tender_documents').update(updates).eq('id', document_id)
    console.log('process-tender-document: analysis complete for', document_id)
  } catch (err: any) {
    console.error('process-tender-document background task failed:', err.message)
    try {
      await supabase.from('tender_documents').update({
        status: 'staged',
        bob_assessment_summary: `❌ Analysis failed: ${err.message}. Please try again.`,
      }).eq('id', document_id)
    } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// HTTP handler — validates, queues background task, returns 202 immediately
// ---------------------------------------------------------------------------
Deno.serve(withCors(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(req) })
  }

  const corsHeaders = getCorsHeaders(req)

  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { document_id, extracted_text: bodyText, force_enrich = false, reference_ids = [] } = body

  if (!document_id) {
    return new Response(JSON.stringify({ error: 'document_id is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: doc, error: docError } = await (supabase as any)
    .from('tender_documents')
    .select('*')
    .eq('id', document_id)
    .single()

  if (docError || !doc) {
    return new Response(JSON.stringify({ error: 'Document not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const textToAnalyse = (bodyText || doc.extracted_text || '').trim()
  if (!textToAnalyse) {
    return new Response(JSON.stringify({ error: 'No extracted text available for analysis' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Mark as processing — frontend poll detects this immediately
  await (supabase as any)
    .from('tender_documents')
    .update({ status: 'processing', bob_assessment_summary: '⏳ Bob is analysing…' })
    .eq('id', document_id)

  // Queue AI work as background task — runs after HTTP response is returned.
  // EdgeRuntime.waitUntil keeps the isolate alive until the promise settles.
  ;(globalThis as any).EdgeRuntime?.waitUntil(
    runAnalysis(supabase, doc, textToAnalyse, force_enrich, reference_ids)
  )

  // Return immediately — supabase.functions.invoke() resolves right away
  return new Response(
    JSON.stringify({ success: true, queued: true, document_id }),
    {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  )
}))
