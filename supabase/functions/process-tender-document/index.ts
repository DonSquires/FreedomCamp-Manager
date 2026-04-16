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

    // --- Bob Assessment -------------------------------------------------
    const systemPrompt = `You are Bob, an expert analyst for Iron Eagle Security's FieldOps Manager system in New Zealand.
Your job is to analyse tender, RFP, RFIP, and procurement documents and extract structured information
to help the team prepare competitive responses.

You must return a single valid JSON object with EXACTLY these fields:
{
  "document_type": "rfp|rfi|rfq|rfip|tender_application|tender_response|proposal|other",
  "issuing_body": "name of the organisation issuing this document",
  "reference_number": "the document or tender reference number if present, else empty string",
  "due_date": "ISO date string YYYY-MM-DD if a deadline is mentioned, else null",
  "key_services": ["service 1", "service 2"],
  "key_requirements": ["requirement 1", "requirement 2"],
  "key_dates": [{"label": "Submissions close", "date": "YYYY-MM-DD"}],
  "assessment_summary": "2-4 sentence plain-English overview of this document and what Iron Eagle needs to do",
  "enrichment_queries": ["web search query 1", "web search query 2"],
  "response_outline": {
    "cover_letter": "brief suggested content",
    "executive_summary": "suggested content",
    "services_offered": "suggested approach",
    "pricing_notes": "any pricing guidance noted in the document",
    "team_qualifications": "what credentials/experience to highlight",
    "health_and_safety": "H&S requirements mentioned",
    "declaration": "any declaration or certification requirements"
  }
}
Do not include any text outside the JSON object.`

    const userMessage = `Please analyse this tender/procurement document and return the structured JSON assessment:\n\n---\n${textToAnalyse.slice(0, 12000)}\n---`

    let rawResponse: string
    try {
      rawResponse = await callBobChat(systemPrompt, userMessage)
    } catch (inferenceErr: any) {
      console.error('Inference service error:', inferenceErr)
      return new Response(JSON.stringify({ error: `AI analysis failed: ${inferenceErr.message}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Parse JSON from Bob's response (may be wrapped in markdown code fences)
    let assessment: AssessmentResult
    try {
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/)
      const jsonStr = jsonMatch ? jsonMatch[0] : rawResponse
      assessment = JSON.parse(jsonStr)
    } catch {
      assessment = {
        document_type: doc.document_type || 'rfp',
        issuing_body: doc.issuing_body || '',
        reference_number: doc.reference_number || '',
        due_date: null,
        key_services: [],
        key_requirements: [],
        key_dates: [],
        assessment_summary: rawResponse.slice(0, 800),
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
