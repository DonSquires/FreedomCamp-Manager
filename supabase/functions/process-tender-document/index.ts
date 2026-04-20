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
const BOB_CHAT_TIMEOUT_MS = 90_000

interface AssessmentResult {
  document_type: string
  issuing_body: string
  reference_number: string
  due_date: string | null
  key_services: string[]
  key_requirements: string[]
  weighted_criteria: Array<{ criterion: string; weight_percent: number; mandatory: boolean }>
  key_dates: Array<{ label: string; date: string }>
  assessment_summary: string
  enrichment_queries: string[]
  response_outline: Record<string, string>
}

const KNOWN_NZ_LOCATIONS = [
  'Nelson',
  'Blenheim',
  'Marlborough',
  'Tasman',
  'Picton',
  'Motueka',
  'Richmond',
  'Kaikoura',
]

const OFFICIAL_LOCATION_DOMAINS: Array<{ names: string[]; domain: string }> = [
  { names: ['Nelson', 'Nelson City Council'], domain: 'ncc.govt.nz' },
  { names: ['Blenheim', 'Marlborough', 'Marlborough District Council', 'Picton'], domain: 'marlborough.govt.nz' },
  { names: ['Tasman', 'Tasman District Council', 'Motueka', 'Richmond'], domain: 'tasman.govt.nz' },
]

function extractLocationHints(text: string, issuingBody: string | null | undefined): string[] {
  const source = `${issuingBody || ''}\n${text || ''}`
  const found = new Set<string>()

  for (const name of KNOWN_NZ_LOCATIONS) {
    const re = new RegExp(`\\b${name}\\b`, 'i')
    if (re.test(source)) found.add(name)
  }

  const councilMatches = source.match(/\b([A-Z][A-Za-z ]+(?:District|City|Regional) Council)\b/g) || []
  for (const m of councilMatches) found.add(m.trim())

  return Array.from(found).slice(0, 4)
}

function buildLocationEnrichmentQueries(
  issuingBody: string | null | undefined,
  keyServices: string[] | null | undefined,
  text: string,
): string[] {
  const services = (keyServices || []).filter(Boolean)
  const fallbackServices = ['noise control', 'security patrols', 'compliance monitoring']
  const targetServices = services.length > 0 ? services.slice(0, 3) : fallbackServices
  const locations = extractLocationHints(text, issuingBody)

  const baseTargets = locations.length > 0 ? locations : [issuingBody || 'issuing council area']
  const queries: string[] = []

  const officialDomains = new Set<string>()
  const lookupSource = `${issuingBody || ''}\n${text}`
  for (const row of OFFICIAL_LOCATION_DOMAINS) {
    if (row.names.some((n) => new RegExp(`\\b${n}\\b`, 'i').test(lookupSource))) {
      officialDomains.add(row.domain)
    }
  }

  // If no direct mapping detected, still target official NZ government sources.
  if (officialDomains.size === 0) {
    officialDomains.add('govt.nz')
  }

  for (const place of baseTargets) {
    for (const svc of targetServices) {
      queries.push(`${place} ${svc} current issues 2025 2026`) 
      queries.push(`${place} ${svc} council bylaw enforcement`) 
      queries.push(`${place} ${svc} complaints incidents trends`) 
      queries.push(`${place} ${svc} local news updates`) 

      for (const domain of officialDomains) {
        queries.push(`site:${domain} ${place} ${svc} policy bylaw enforcement`) 
        queries.push(`site:${domain} ${place} ${svc} annual plan risk issues`) 
      }

      queries.push(`site:gets.govt.nz ${place} ${svc} tender contract history`) 
      queries.push(`site:procurement.govt.nz ${svc} pricing guidance New Zealand`) 
      queries.push(`site:legislation.govt.nz ${svc} law bylaw New Zealand`) 
    }
    queries.push(`${place} council annual plan long term plan community safety`) 
    queries.push(`${place} environmental health noise control policy`) 
    queries.push(`site:legislation.govt.nz ${place} bylaw local government act`) 
  }

  // Keep unique queries and cap size for UI readability.
  return Array.from(new Set(queries)).slice(0, 10)
}

function parseWeightPercent(text: string): number | null {
  const match = text.match(/(?:\[WEIGHT\s*)?(\d{1,2})\s*%\]?/i)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function deriveWeightedCriteria(
  keyRequirements: string[] | null | undefined,
  existing: Array<{ criterion: string; weight_percent: number; mandatory: boolean }> | null | undefined,
): Array<{ criterion: string; weight_percent: number; mandatory: boolean }> {
  const out: Array<{ criterion: string; weight_percent: number; mandatory: boolean }> = []

  if (Array.isArray(existing)) {
    for (const row of existing) {
      const criterion = String((row as any)?.criterion || '').trim()
      const weight = Number((row as any)?.weight_percent)
      if (!criterion || !Number.isFinite(weight)) continue
      out.push({
        criterion,
        weight_percent: weight,
        mandatory: Boolean((row as any)?.mandatory),
      })
    }
  }

  if (out.length === 0 && Array.isArray(keyRequirements)) {
    for (const req of keyRequirements) {
      const criterion = String(req || '').trim()
      if (!criterion) continue
      const weight = parseWeightPercent(criterion)
      if (weight == null) continue
      out.push({
        criterion,
        weight_percent: weight,
        mandatory: /\b(mandatory|required|must|shall|compulsory)\b/i.test(criterion),
      })
    }
  }

  const unique = new Map<string, { criterion: string; weight_percent: number; mandatory: boolean }>()
  for (const row of out) {
    const key = row.criterion.toLowerCase()
    if (!unique.has(key)) unique.set(key, row)
  }

  return Array.from(unique.values()).sort((a, b) => b.weight_percent - a.weight_percent).slice(0, 12)
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

  const inferredIssuingBody = (issuingMatch ? issuingMatch[1].trim() : doc.issuing_body) || ''
  const enrichmentQueries = buildLocationEnrichmentQueries(inferredIssuingBody, foundServices, text)

  return {
    document_type: doc.document_type || 'rfip',
    issuing_body: inferredIssuingBody,
    reference_number: refMatch ? refMatch[1] : (doc.reference_number || ''),
    due_date: null,
    key_services: foundServices,
    key_requirements: [],
    weighted_criteria: [],
    key_dates: dueDateMatch ? [{ label: 'Closing date', date: dueDateMatch[1] }] : [],
    assessment_summary:
      `⚠️ ${reason} Basic information has been extracted from the document text. ` +
      `Key services identified: ${foundServices.join(', ') || 'none detected'}. ` +
      `Please review the Intake tab and try Bob Analysis again, or proceed to Draft Response manually.`,
    enrichment_queries: enrichmentQueries,
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
// Call Bob inference service
// ---------------------------------------------------------------------------
async function callBobChat(systemPrompt: string, userMessage: string): Promise<string> {
  if (!INFERENCE_SERVICE_URL) throw new Error('INFERENCE_SERVICE_URL not configured')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (INFERENCE_API_KEY) {
    // Include both auth forms to align with Bob middleware and strict mode docs.
    headers['Authorization'] = `Bearer ${INFERENCE_API_KEY}`
    headers['x-inference-api-key'] = INFERENCE_API_KEY
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), BOB_CHAT_TIMEOUT_MS)

  let resp: Response
  try {
    resp = await fetch(`${INFERENCE_SERVICE_URL}/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: userMessage,
        system_prompt: systemPrompt,
        provider_preference: 'auto',
        response_format: 'json',
      }),
      signal: controller.signal,
    })
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`Inference service timeout after ${Math.floor(BOB_CHAT_TIMEOUT_MS / 1000)}s`)
    }
    throw err
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

// ─────────────────────────────────────────────────────────────────────────────
// doAnalysis — runs as a background task after 202 response is sent
// ─────────────────────────────────────────────────────────────────────────────

const REFERENCE_TYPE_ORDER = ['compliance', 'legal', 'policy', 'pricing', 'template', 'past_tender', 'nz_reference', 'other']

const RELEVANCE_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'have', 'has', 'will', 'shall', 'must',
  'service', 'services', 'tender', 'response', 'application', 'document', 'request', 'proposal',
])

function tokenizeForRelevance(text: string): string[] {
  return Array.from(new Set((text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [])
    .filter((t) => !RELEVANCE_STOP_WORDS.has(t))))
}

function scoreReferenceRelevance(seedTokens: Set<string>, text: string): number {
  if (seedTokens.size === 0 || !text) return 0
  const tokens = tokenizeForRelevance(text)
  if (tokens.length === 0) return 0
  let hits = 0
  for (const t of tokens) {
    if (seedTokens.has(t)) hits += 1
  }
  return hits
}

async function doAnalysis(
  supabase: ReturnType<typeof createClient>,
  doc: Record<string, any>,
  document_id: string,
  textToAnalyse: string,
  incomingRefIds: string[],
): Promise<void> {
  try {
    // --- Reference material context ---
    let referenceContextBlock = ''
    const referenceContextSnapshot: Array<{ id: string; title: string; material_type: string; chars_used: number }> = []

    if (incomingRefIds.length > 0) {
      const { data: refs } = await (supabase as any)
        .from('tender_reference_materials')
        .select('id, title, material_type, extracted_text')
        .in('id', incomingRefIds)
        .eq('organization_id', doc.organization_id)
        .eq('is_active', true)
        .eq('extraction_status', 'extracted')

      if (refs && refs.length > 0) {
        const seedSource = [
          doc?.issuing_body,
          doc?.reference_number,
          textToAnalyse.slice(0, 2500),
        ].filter(Boolean).join('\n')
        const seedTokens = new Set(tokenizeForRelevance(seedSource).slice(0, 100))
        const relevanceById = new Map<string, number>()
        for (const r of refs as Array<{ id: string; extracted_text: string | null }>) {
          relevanceById.set(r.id, scoreReferenceRelevance(seedTokens, r.extracted_text || ''))
        }

        const sorted = [...refs].sort((a: any, b: any) => {
          const ra = relevanceById.get(a.id) || 0
          const rb = relevanceById.get(b.id) || 0
          if (rb !== ra) return rb - ra

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

        // Upsert tender_document_references rows
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

    // --- Bob Assessment ---
    const systemPrompt = `You are Bob, an expert analyst for Iron Eagle Security's FieldOps Manager system in New Zealand.
Your job is to analyse tender, RFP, RFIP, and procurement documents and extract structured information
to help the team prepare competitive responses.

  RFI response operating model:
  - Act as a technical writer, data analyst, and compliance officer.
  - Ensure every mandatory requirement is identified and represented in key_requirements.
  - Prefix mandatory requirements with [MANDATORY] in key_requirements when explicit in the source.
  - Preserve stated scoring weights inside key_requirements using [WEIGHT nn%] when present.
  - Highlight unique value points for Iron Eagle (capability, platform differentiation, delivery confidence).

  When analysing this document, explicitly look for and summarize:
  - Company profile and capability expectations.
  - Technical methodology expectations (delivery approach, stack, security, governance).
  - Compliance and risk obligations (privacy, health and safety, continuity, legal/bylaw obligations).
  - Evidence requirements (case studies, references, measurable outcomes, STAR-style proof).
  - Executive summary expectations and any strict formatting/word-limit requirements.

  Assessment workflow quality bar:
  - Build a requirement mapping mindset: what must be answered vs what is optional.
  - Flag thin or missing evidence and suggest what proof should be gathered.
  - If an evaluation scorecard/weighting exists, surface it as explicit weighted requirement entries.
  - Keep outputs scannable for evaluators and aligned to buyer tone (formal government vs commercial).

Location intelligence requirement:
- Detect the likely operating area from the document (e.g. Nelson, Blenheim, Marlborough, Tasman, or issuing council area).
- Generate enrichment_queries that are location-specific and service-specific (especially for noise control where relevant).
- Prioritise official/local authority and government sources first in the query wording
  (council bylaws, annual plans, policy pages, legislation.govt.nz, procurement.govt.nz, gets.govt.nz),
  then local public chatter/current context as secondary corroboration only.
- Include queries to verify the most recent applicable laws and bylaws for the service area.
- Include queries to surface pricing context, operational risks, historical complaints/incidents,
  and prior tender/contract history where possible.
- Use organisation reference material context for capabilities, previous tenders, and service proofs.
- Include at least 6 concrete enrichment queries when possible.

You must return a single valid JSON object with EXACTLY these fields:
{
  "document_type": "rfp|rfi|rfq|rfip|tender_application|tender_response|proposal|other",
  "issuing_body": "name of the organisation issuing this document",
  "reference_number": "the document or tender reference number if present, else empty string",
  "due_date": "ISO date string YYYY-MM-DD if a deadline is mentioned, else null",
  "key_services": ["service 1", "service 2"],
  "key_requirements": ["requirement 1", "requirement 2"],
  "weighted_criteria": [{"criterion": "criterion text", "weight_percent": 30, "mandatory": true}],
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
    "declaration": "any declaration or certification requirements",
    "architecture_summary": "composed stack summary",
    "security_trust_controls": "security controls and trust boundaries",
    "delivery_workflow": "delivery and async operations model",
    "mobile_accessibility_profile": "mobile-first and accessibility expectations",
    "compliance_traceability": "mandatory requirement traceability approach",
    "risks_mitigations": "primary risks and mitigation expectations"
  }
}
Do not include any text outside the JSON object.`

    const userMessage = `Please analyse this tender/procurement document and return the structured JSON assessment:\n\n---\n${textToAnalyse.slice(0, 5000)}\n---${referenceContextBlock.slice(0, 3000)}`

    let rawResponse: string
    try {
      rawResponse = await callBobChat(systemPrompt, userMessage)
    } catch (inferenceErr: any) {
      console.error('Inference service error during background analysis:', inferenceErr)
      await (supabase as any).from('tender_documents')
        .update({ status: 'staged', bob_assessment_summary: `⚠️ Analysis failed: ${inferenceErr.message?.slice(0, 200)}` })
        .eq('id', document_id)
      return
    }

    // Parse JSON from Bob's response
    let assessment: AssessmentResult
    try {
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

    // Ensure location-aware enrichment queries are always present.
    if (!Array.isArray(assessment.enrichment_queries) || assessment.enrichment_queries.length === 0) {
      assessment.enrichment_queries = buildLocationEnrichmentQueries(
        assessment.issuing_body || doc.issuing_body,
        assessment.key_services,
        textToAnalyse,
      )
    }
    if (!Array.isArray(assessment.key_requirements)) {
      assessment.key_requirements = []
    }
    if (!Array.isArray(assessment.key_services)) {
      assessment.key_services = []
    }
    if (!Array.isArray(assessment.key_dates)) {
      assessment.key_dates = []
    }
    assessment.weighted_criteria = deriveWeightedCriteria(
      assessment.key_requirements,
      (assessment as any).weighted_criteria,
    )

    // --- CRM: auto-create client organisation if not found ---
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

    // --- Build default response sections ---
    const defaultResponseSections = doc.response_sections || {
      cover_letter: assessment.response_outline?.cover_letter || '',
      executive_summary: assessment.response_outline?.executive_summary || '',
      services_offered: assessment.response_outline?.services_offered || '',
      pricing_notes: assessment.response_outline?.pricing_notes || '',
      team_qualifications: assessment.response_outline?.team_qualifications || '',
      health_and_safety: assessment.response_outline?.health_and_safety || '',
      declaration: assessment.response_outline?.declaration || '',
      architecture_summary: assessment.response_outline?.architecture_summary || '',
      security_trust_controls: assessment.response_outline?.security_trust_controls || '',
      delivery_workflow: assessment.response_outline?.delivery_workflow || '',
      mobile_accessibility_profile: assessment.response_outline?.mobile_accessibility_profile || '',
      compliance_traceability: assessment.response_outline?.compliance_traceability || '',
      risks_mitigations: assessment.response_outline?.risks_mitigations || '',
    }

    // --- Persist to tender_documents ---
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

    await (supabase as any).from('tender_documents').update(updates).eq('id', document_id)
    console.log(`✅ Background analysis complete for tender_document ${document_id}`)
  } catch (err: any) {
    console.error('Background doAnalysis error:', err)
    await (supabase as any).from('tender_documents')
      .update({ status: 'staged', bob_assessment_summary: `⚠️ Analysis error: ${err.message?.slice(0, 200)}` })
      .eq('id', document_id)
  }
}

Deno.serve(withCors(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(req) })
  }

  const corsHeaders = getCorsHeaders(req)

  // ── Auth ──────────────────────────────────────────────────────────────────
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

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { document_id, extracted_text: bodyText, force_enrich, reference_ids } = body as any

  if (!document_id) {
    return new Response(JSON.stringify({ error: 'document_id is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ── Fetch document (fast — no AI yet) ─────────────────────────────────────
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

  // Mark as processing immediately — UI polling detects this
  await (supabase as any).from('tender_documents').update({ status: 'staged', bob_assessment_summary: '⏳ Bob is analysing…' }).eq('id', document_id)

  // ── Fire-and-forget: respond 202 immediately, run AI in background ─────────
  // EdgeRuntime.waitUntil keeps the Deno isolate alive after the response is sent.
  const backgroundWork = doAnalysis(supabase, doc, document_id, textToAnalyse, Array.isArray(reference_ids) ? reference_ids : [])

  // @ts-ignore EdgeRuntime is available in Supabase Deno runtime
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(backgroundWork)
  } else {
    // Fallback for local dev: await directly (will block)
    await backgroundWork
  }

  return new Response(
    JSON.stringify({ accepted: true, document_id, message: 'Analysis started — poll document status for completion' }),
    {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  )
}))
