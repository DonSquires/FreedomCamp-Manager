/**
 * process-reference-material
 *
 * Server-side text extraction pipeline for tender reference library files.
 * Reads a tender_reference_materials row, downloads the file from Supabase
 * Storage, extracts plain text (by file type), saves it back to the DB and
 * marks extraction_status accordingly.
 *
 * Required body fields:
 *   reference_material_id   UUID of the tender_reference_materials row
 *
 * File types handled:
 *   pdf        → text extraction via simple byte scan (Deno — no pdf-parse)
 *   doc/docx   → plain-text via mammoth-style XML stripping
 *   xls/xlsx   → first 200 rows as readable text
 *   csv/txt    → raw text (first 200 rows / 20 KB)
 *   image      → OCR note only (server-side OCR not available in Deno edge)
 *   unknown    → raw text attempt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { withCors, getCorsHeaders } from '../_shared/withCors.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip XML/HTML tags and collapse whitespace. */
function stripXml(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Extract readable text from a docx/doc ArrayBuffer (zip XML approach). */
async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  // docx is a zip containing word/document.xml — extract XML text
  // Use a basic approach: find w:t tag contents (Word run text)
  const bytes = new Uint8Array(buffer)
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)

  // Look for w:t elements (Word run text fragments)
  const matches = text.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []
  if (matches.length > 0) {
    return matches
      .map(m => m.replace(/<[^>]+>/g, ''))
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 50000)
  }

  // Fallback: strip all XML tags from whatever we decoded
  return stripXml(text).slice(0, 50000)
}

/** Extract readable text from a PDF buffer (basic text scanning). */
function extractPdfText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const raw = new TextDecoder('latin1', { fatal: false }).decode(bytes)

  // PDF text streams: extract BT ... ET blocks
  const blocks: string[] = []
  const btEtRe = /BT([\s\S]*?)ET/g
  let match: RegExpExecArray | null
  while ((match = btEtRe.exec(raw)) !== null) {
    const block = match[1]
    // Tj and TJ operators carry text strings
    const tjRe = /\(([^)]*)\)\s*Tj/g
    let tjMatch: RegExpExecArray | null
    while ((tjMatch = tjRe.exec(block)) !== null) {
      blocks.push(tjMatch[1])
    }
    const tjArrRe = /\[([^\]]*)\]\s*TJ/g
    let tjArrMatch: RegExpExecArray | null
    while ((tjArrMatch = tjArrRe.exec(block)) !== null) {
      const inner = tjArrMatch[1]
      const strRe = /\(([^)]*)\)/g
      let strMatch: RegExpExecArray | null
      while ((strMatch = strRe.exec(inner)) !== null) {
        blocks.push(strMatch[1])
      }
    }
  }

  const joined = blocks.join(' ').replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\s{2,}/g, ' ').trim()
  if (joined.length > 100) return joined.slice(0, 50000)

  // Fallback: any printable ASCII from the raw bytes
  const printable = raw.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s{2,}/g, ' ').trim()
  return printable.slice(0, 50000)
}

/** Convert CSV/TSV text to a readable summary (first 200 rows). */
function extractCsvText(raw: string): string {
  const lines = raw.split(/\r?\n/).filter(l => l.trim())
  return lines.slice(0, 200).join('\n').slice(0, 30000)
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(withCors(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(req) })
  }

  const corsH = getCorsHeaders(req)

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsH, 'Content-Type': 'application/json' },
    })

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) return json({ error: 'Authentication required' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return json({ error: 'Invalid or expired session' }, 401)

    // ── Parse body ──────────────────────────────────────────────────────────
    const body = await req.json()
    const { reference_material_id } = body
    if (!reference_material_id) return json({ error: 'reference_material_id is required' }, 400)

    // ── Fetch reference record ──────────────────────────────────────────────
    const { data: ref, error: refError } = await (supabase as any)
      .from('tender_reference_materials')
      .select('*')
      .eq('id', reference_material_id)
      .single()

    if (refError || !ref) return json({ error: 'Reference material not found' }, 404)

    // ── Mark as extracting ──────────────────────────────────────────────────
    await (supabase as any)
      .from('tender_reference_materials')
      .update({ extraction_status: 'extracting' })
      .eq('id', reference_material_id)

    // ── Download file from storage ─────────────────────────────────────────
    if (!ref.file_path) {
      await (supabase as any)
        .from('tender_reference_materials')
        .update({ extraction_status: 'failed', extraction_notes: 'No file path recorded.' })
        .eq('id', reference_material_id)
      return json({ error: 'No file path on record' }, 400)
    }

    const { data: fileData, error: dlError } = await supabase
      .storage
      .from('evidence')
      .download(ref.file_path)

    if (dlError || !fileData) {
      const note = `Download failed: ${dlError?.message || 'unknown error'}`
      await (supabase as any)
        .from('tender_reference_materials')
        .update({ extraction_status: 'failed', extraction_notes: note })
        .eq('id', reference_material_id)
      return json({ error: note }, 502)
    }

    // ── Extract text by file kind ──────────────────────────────────────────
    const kind: string = ref.file_kind || 'unknown'
    let extractedText = ''
    let extractionNotes: string | null = null

    try {
      if (kind === 'pdf') {
        const buffer = await fileData.arrayBuffer()
        extractedText = extractPdfText(buffer)
        if (extractedText.length < 50) {
          extractionNotes = 'PDF extraction yielded little text — this may be a scanned PDF. Human review recommended.'
        }
      } else if (kind === 'document') {
        const buffer = await fileData.arrayBuffer()
        extractedText = await extractDocxText(buffer)
      } else if (kind === 'spreadsheet') {
        // For Excel files: read as text and extract any readable content
        const buffer = await fileData.arrayBuffer()
        const rawText = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
        // Try to find cell values in XML (xlsx is a zip — extract readable strings)
        const sharedStrings = rawText.match(/<si>([\s\S]*?)<\/si>/g) || []
        if (sharedStrings.length > 0) {
          extractedText = sharedStrings
            .map(s => s.replace(/<[^>]+>/g, '').trim())
            .filter(s => s.length > 0)
            .slice(0, 500)
            .join(' | ')
            .slice(0, 30000)
        } else {
          // Old xls or unreadable xlsx: strip XML tags
          extractedText = stripXml(rawText).slice(0, 30000)
        }
        if (extractedText.length < 50) {
          extractionNotes = 'Spreadsheet extraction yielded little text. Consider converting to CSV for better results.'
        }
      } else if (kind === 'text') {
        // CSV, TXT, JSON
        const rawText = await fileData.text()
        const fileName = (ref.file_name || '').toLowerCase()
        if (fileName.endsWith('.csv') || fileName.endsWith('.tsv')) {
          extractedText = extractCsvText(rawText)
        } else {
          extractedText = rawText.slice(0, 50000)
        }
      } else if (kind === 'image') {
        // Server-side OCR not available in Deno edge functions
        extractedText = `[Image file: ${ref.file_name || 'unknown'}]\n\nAutomatic OCR is not available server-side. Please manually enter the extracted text in the text field below.`
        extractionNotes = 'OCR — image file detected. Automatic server-side OCR is not available. Human review and manual text entry required.'
      } else {
        // Unknown type — attempt raw text decode
        const rawText = await fileData.text()
        extractedText = rawText.slice(0, 50000)
        extractionNotes = 'Unknown file type — text extraction may be incomplete. Human review recommended.'
      }
    } catch (extractErr: any) {
      const note = `Extraction error: ${extractErr?.message || String(extractErr)}`
      await (supabase as any)
        .from('tender_reference_materials')
        .update({ extraction_status: 'failed', extraction_notes: note })
        .eq('id', reference_material_id)
      return json({ error: note }, 500)
    }

    // ── Persist extracted text ─────────────────────────────────────────────
    const finalStatus = kind === 'image' ? 'needs_review' : (extractedText.length > 30 ? 'extracted' : 'needs_review')

    await (supabase as any)
      .from('tender_reference_materials')
      .update({
        extracted_text: extractedText,
        extraction_status: finalStatus,
        extraction_notes: extractionNotes,
      })
      .eq('id', reference_material_id)

    return json({
      success: true,
      reference_material_id,
      extraction_status: finalStatus,
      extraction_notes: extractionNotes,
      extracted_length: extractedText.length,
    })

  } catch (err: any) {
    console.error('process-reference-material error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), {
      status: 500,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    })
  }
}))
