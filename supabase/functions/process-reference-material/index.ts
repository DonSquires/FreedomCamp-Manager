/**
 * process-reference-material
 *
 * Fire-and-forget extraction pipeline for tender reference library files.
 * Responds 202 immediately. Actual extraction runs in EdgeRuntime.waitUntil().
 * Frontend polls extraction_status for completion.
 *
 * Required body fields:
 *   reference_material_id   UUID of the tender_reference_materials row
 *
 * File types handled:
 *   pdf        → text extraction via byte scan
 *   doc/docx   → XML tag stripping
 *   xls/xlsx   → shared-string XML extraction
 *   csv/txt    → raw text (first 200 rows / 50 KB)
 *   image      → placeholder note (no server-side OCR in Deno)
 *   unknown    → raw text attempt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { withCors, getCorsHeaders } from '../_shared/withCors.ts'

const MAX_EXTRACTED_TEXT_LENGTH = 50000
const MAX_SPREADSHEET_TEXT_LENGTH = 30000
const MAX_CSV_ROWS = 200

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripXml(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ').trim()
}

async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  const matches = text.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []
  if (matches.length > 0) {
    return matches.map(m => m.replace(/<[^>]+>/g, '')).join(' ').replace(/\s{2,}/g, ' ').trim().slice(0, MAX_EXTRACTED_TEXT_LENGTH)
  }
  return stripXml(text).slice(0, MAX_EXTRACTED_TEXT_LENGTH)
}

function extractPdfText(buffer: ArrayBuffer): string {
  const raw = new TextDecoder('latin1', { fatal: false }).decode(buffer)
  const blocks: string[] = []
  const btEtRe = /BT([\s\S]*?)ET/g
  let match: RegExpExecArray | null
  while ((match = btEtRe.exec(raw)) !== null) {
    const block = match[1]
    const tjRe = /\(([^)]*)\)\s*Tj/g
    let tjMatch: RegExpExecArray | null
    while ((tjMatch = tjRe.exec(block)) !== null) blocks.push(tjMatch[1])
    const tjArrRe = /\[([^\]]*)\]\s*TJ/g
    let tjArrMatch: RegExpExecArray | null
    while ((tjArrMatch = tjArrRe.exec(block)) !== null) {
      const inner = tjArrMatch[1]
      const strRe = /\(([^)]*)\)/g
      let strMatch: RegExpExecArray | null
      while ((strMatch = strRe.exec(inner)) !== null) blocks.push(strMatch[1])
    }
  }
  const joined = blocks.join(' ').replace(/\\n/g, '\n').replace(/\s{2,}/g, ' ').trim()
  if (joined.length > 100) return joined.slice(0, MAX_EXTRACTED_TEXT_LENGTH)
  return raw.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, MAX_EXTRACTED_TEXT_LENGTH)
}

function extractCsvText(raw: string): string {
  return raw.split(/\r?\n/).filter(l => l.trim()).slice(0, MAX_CSV_ROWS).join('\n').slice(0, MAX_SPREADSHEET_TEXT_LENGTH)
}

// ─── Background extraction ────────────────────────────────────────────────────

async function doExtraction(
  supabase: ReturnType<typeof createClient>,
  ref: Record<string, any>,
  reference_material_id: string,
): Promise<void> {
  try {
    const { data: fileData, error: dlError } = await supabase
      .storage.from('evidence').download(ref.file_path)

    if (dlError || !fileData) {
      const note = `Download failed: ${dlError?.message || 'unknown error'}`
      await (supabase as any).from('tender_reference_materials')
        .update({ extraction_status: 'failed', extraction_notes: note })
        .eq('id', reference_material_id)
      return
    }

    const kind: string = ref.file_kind || 'unknown'
    let extractedText = ''
    let extractionNotes: string | null = null

    try {
      if (kind === 'pdf') {
        extractedText = extractPdfText(await fileData.arrayBuffer())
        if (extractedText.length < 50) {
          extractionNotes = 'PDF extraction yielded little text — this may be a scanned PDF. Human review recommended.'
        }
      } else if (kind === 'document') {
        extractedText = await extractDocxText(await fileData.arrayBuffer())
      } else if (kind === 'spreadsheet') {
        const buffer = await fileData.arrayBuffer()
        const rawText = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
        const sharedStrings = rawText.match(/<si>([\s\S]*?)<\/si>/g) || []
        if (sharedStrings.length > 0) {
          extractedText = sharedStrings.map(s => s.replace(/<[^>]+>/g, '').trim())
            .filter(s => s.length > 0).slice(0, 500).join(' | ').slice(0, MAX_SPREADSHEET_TEXT_LENGTH)
        } else {
          extractedText = stripXml(rawText).slice(0, MAX_SPREADSHEET_TEXT_LENGTH)
        }
        if (extractedText.length < 50) {
          extractionNotes = 'Spreadsheet extraction yielded little text. Consider converting to CSV for better results.'
        }
      } else if (kind === 'text') {
        const rawText = await fileData.text()
        const fileName = (ref.file_name || '').toLowerCase()
        extractedText = (fileName.endsWith('.csv') || fileName.endsWith('.tsv'))
          ? extractCsvText(rawText)
          : rawText.slice(0, MAX_EXTRACTED_TEXT_LENGTH)
      } else if (kind === 'image') {
        extractedText = `[Image file: ${ref.file_name || 'unknown'}]\n\nAutomatic OCR is not available server-side. Please manually enter the extracted text in the text field below.`
        extractionNotes = 'OCR — image file detected. Automatic server-side OCR is not available. Human review and manual text entry required.'
      } else {
        extractedText = (await fileData.text()).slice(0, MAX_EXTRACTED_TEXT_LENGTH)
        extractionNotes = 'Unknown file type — text extraction may be incomplete. Human review recommended.'
      }
    } catch (extractErr: any) {
      const note = `Extraction error: ${extractErr?.message || String(extractErr)}`
      await (supabase as any).from('tender_reference_materials')
        .update({ extraction_status: 'failed', extraction_notes: note })
        .eq('id', reference_material_id)
      return
    }

    const finalStatus = kind === 'image' ? 'needs_review' : (extractedText.length > 30 ? 'extracted' : 'needs_review')

    await (supabase as any).from('tender_reference_materials')
      .update({ extracted_text: extractedText, extraction_status: finalStatus, extraction_notes: extractionNotes })
      .eq('id', reference_material_id)

    console.log(`✅ Reference extraction complete: ${reference_material_id} → ${finalStatus} (${extractedText.length} chars)`)
  } catch (err: any) {
    console.error('doExtraction error:', err)
    await (supabase as any).from('tender_reference_materials')
      .update({ extraction_status: 'failed', extraction_notes: `Unexpected error: ${err?.message?.slice(0, 200)}` })
      .eq('id', reference_material_id)
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(withCors(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(req) })
  }

  const corsH = getCorsHeaders(req)
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsH, 'Content-Type': 'application/json' } })

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Authentication required' }, 401)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return json({ error: 'Invalid or expired session' }, 401)

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

  const { reference_material_id } = body
  if (!reference_material_id) return json({ error: 'reference_material_id is required' }, 400)

  // ── Fetch reference record ─────────────────────────────────────────────────
  const { data: ref, error: refError } = await (supabase as any)
    .from('tender_reference_materials').select('*').eq('id', reference_material_id).single()

  if (refError || !ref) return json({ error: 'Reference material not found' }, 404)

  if (!ref.file_path) {
    await (supabase as any).from('tender_reference_materials')
      .update({ extraction_status: 'failed', extraction_notes: 'No file path recorded.' })
      .eq('id', reference_material_id)
    return json({ error: 'No file path on record' }, 400)
  }

  // ── Mark as extracting — respond 202 immediately ───────────────────────────
  await (supabase as any).from('tender_reference_materials')
    .update({ extraction_status: 'extracting' }).eq('id', reference_material_id)

  const backgroundWork = doExtraction(supabase, ref, reference_material_id as string)

  // @ts-ignore EdgeRuntime is available in Supabase Deno runtime
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(backgroundWork)
  } else {
    await backgroundWork
  }

  return json({
    accepted: true,
    reference_material_id,
    message: 'Extraction started — poll extraction_status for completion',
  }, 202)
}))
