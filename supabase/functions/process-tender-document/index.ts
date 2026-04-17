/**
 * process-tender-document
 *
 * Analyses a tender/RFP document with Bob (Railway inference-service /chat),
 * extracts structured information, optionally auto-creates a CRM client organisation,
 * updates the tender_document record, and returns the assessment.
 *
 * Required body fields:
 *   document_id   UUID of the tender_documents row
 *
 * Optional body fields:
 *   extracted_text  Pre-extracted text (if not present, uses tender_documents.extracted_text)
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

async function callBobChat(systemPrompt: string, userMessage: string): Promise<string> {
  if (!INFERENCE_SERVICE_URL) {
    throw new Error('INFERENCE_SERVICE_URL is not configured')
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (INFERENCE_API_KEY) {
    headers['Authorization'] = `Bearer ${INFERENCE_API_KEY}`
  }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 110_000) // 110s — leave headroom before 150s edge fn limit
  let resp: Response
  try {
    resp = await fetch(`${INFERENCE_SERVICE_URL}/chat`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        message: userMessage,
        system_prompt: systemPrompt,
        provider_preference: 'auto',
        response_format: 'json',
        timeout: 100,
      }),
    })
  } finally {
    clearTimeout(timeoutId)
  }
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

Deno.serve(withCors(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(req) })
  }

  const corsHeaders = getCorsHeaders(req)

  try {
    // Auth
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

    const body = await req.json()
    const { document_id, extracted_text: bodyText, force_enrich } = body

    if (!document_id) {
      return new Response(JSON.stringify({ error: 'document_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch existing document record
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

    // Mark as processing immediately so the UI can detect the function was invoked
    await (supabase as any).from('tender_documents').update({ status: 'staged', bob_assessment_summary: '⏳ Bob is analysing…' }).eq('id', document_id)

    // --- Bob Assessment -------------------------------------------------
    const systemPrompt = `You are Bob, a procurement analyst for Iron Eagle Security NZ. Return ONLY a valid JSON object with these exact keys: document_type (rfp/rfi/rfq/rfip/tender_application/tender_response/proposal/other), issuing_body, reference_number, due_date (YYYY-MM-DD or null), key_services (array), key_requirements (array), key_dates (array of {label,date}), assessment_summary (2-4 sentences), enrichment_queries (array), response_outline ({cover_letter,executive_summary,services_offered,pricing_notes,team_qualifications,health_and_safety,declaration}). No text outside the JSON.`

    // Keep prompt short — llama3.1:8b on Railway needs <4000 chars to respond within edge fn timeout
    const userMessage = `Analyse this procurement document and return the JSON assessment:\n\n---\n${textToAnalyse.slice(0, 4000)}\n---`

    let rawResponse: string
    let usedFallback = false
    try {
      rawResponse = await callBobChat(systemPrompt, userMessage)
    } catch (inferenceErr: any) {
      console.error('Inference service error (using heuristic fallback):', inferenceErr.message)
      // Heuristic fallback — extract what we can from the text directly
      usedFallback = true
      rawResponse = ''
    }

    // Parse JSON from Bob's response (may be wrapped in markdown code fences)
    let assessment: AssessmentResult
    try {
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/)
      const jsonStr = jsonMatch ? jsonMatch[0] : rawResponse
      assessment = JSON.parse(jsonStr)
    } catch {
      // Heuristic fallback — extract basic info directly from text
      const refMatch = textToAnalyse.match(/\b(\d{2}-\d{3,})\b/)
      const dueDateMatch = textToAnalyse.match(/(\d{1,2}\s+\w+\s+20\d{2})/i)
      assessment = {
        document_type: doc.document_type || 'rfip',
        issuing_body: doc.issuing_body || '',
        reference_number: refMatch ? refMatch[1] : (doc.reference_number || ''),
        due_date: null,
        key_services: [],
        key_requirements: [],
        key_dates: dueDateMatch ? [{ label: 'Mentioned date', date: dueDateMatch[1] }] : [],
        assessment_summary: usedFallback
          ? 'Bob could not complete AI analysis within the time limit. Basic document details have been extracted. Please review the extracted text and try again, or proceed to Draft Response manually.'
          : rawResponse.slice(0, 800),
        enrichment_queries: [],
        response_outline: {},
      }
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
          console.warn('Could not auto-create CRM organisation:', createOrgError?.message)
        }
      }
    }

    // --- Build default response sections ----------------------------------
    const defaultResponseSections = doc.response_sections || {
      cover_letter: assessment.response_outline?.cover_letter || '',
      executive_summary: assessment.response_outline?.executive_summary || '',
      services_offered: assessment.response_outline?.services_offered || '',
      pricing_notes: assessment.response_outline?.pricing_notes || '',
      team_qualifications: assessment.response_outline?.team_qualifications || '',
      health_and_safety: assessment.response_outline?.health_and_safety || '',
      declaration: assessment.response_outline?.declaration || '',
    }

    // --- Persist to tender_documents -------------------------------------
    const updates: Record<string, any> = {
      bob_assessment: assessment,
      bob_assessment_summary: assessment.assessment_summary,
      key_services: assessment.key_services,
      key_requirements: assessment.key_requirements,
      key_dates: assessment.key_dates,
      status: 'assessed',
      response_sections: defaultResponseSections,
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

    await (supabase as any)
      .from('tender_documents')
      .update(updates)
      .eq('id', document_id)

    return new Response(
      JSON.stringify({
        success: true,
        assessment,
        crm_client_organization_id: crmClientOrgId,
        document_id,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err: any) {
    console.error('process-tender-document error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}))
