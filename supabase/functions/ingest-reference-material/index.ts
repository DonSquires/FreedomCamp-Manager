/**
 * ingest-reference-material
 *
 * Server-side reference ingestion for Tender Reference Library.
 * Accepts multipart/form-data (title/type/file/manual_text), creates the
 * tender_reference_materials row, uploads file to storage (if provided), and
 * runs extraction in background via EdgeRuntime.waitUntil.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { withCors, getCorsHeaders } from '../_shared/withCors.ts'

const MAX_EXTRACTED_TEXT_LENGTH = 50000
const MAX_SPREADSHEET_TEXT_LENGTH = 30000
const MAX_CSV_ROWS = 200
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

const ALLOWED_TYPES = new Set([
  'policy',
  'pricing',
  'template',
  'compliance',
  'legal',
  'past_tender',
  'nz_reference',
  'other',
])

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
    return matches
      .map((m) => m.replace(/<[^>]+>/g, ''))
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, MAX_EXTRACTED_TEXT_LENGTH)
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
  return raw.split(/\r?\n/).filter((l) => l.trim()).slice(0, MAX_CSV_ROWS).join('\n').slice(0, MAX_SPREADSHEET_TEXT_LENGTH)
}

function classifyFileByName(fileName: string): string {
  const name = fileName.toLowerCase()
  if (name.endsWith('.pdf')) return 'pdf'
  if (name.endsWith('.doc') || name.endsWith('.docx')) return 'document'
  if (name.endsWith('.xls') || name.endsWith('.xlsx')) return 'spreadsheet'
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt') || name.endsWith('.json')) return 'text'
  if (/\.(jpg|jpeg|png|gif|bmp|webp)$/.test(name)) return 'image'
  return 'unknown'
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
}

async function doExtraction(
  supabaseAdmin: ReturnType<typeof createClient>,
  ref: Record<string, any>,
  referenceMaterialId: string,
): Promise<void> {
  try {
    const { data: fileData, error: dlError } = await supabaseAdmin
      .storage.from('evidence').download(ref.file_path)

    if (dlError || !fileData) {
      const note = `Download failed: ${dlError?.message || 'unknown error'}`
      await (supabaseAdmin as any).from('tender_reference_materials')
        .update({ extraction_status: 'failed', extraction_notes: note })
        .eq('id', referenceMaterialId)
      return
    }

    const kind: string = ref.file_kind || 'unknown'
    let extractedText = ''
    let extractionNotes: string | null = null

    try {
      if (kind === 'pdf') {
        extractedText = extractPdfText(await fileData.arrayBuffer())
        if (extractedText.length < 50) {
          extractionNotes = 'PDF extraction yielded little text. This may be a scanned PDF and may need manual review.'
        }
      } else if (kind === 'document') {
        extractedText = await extractDocxText(await fileData.arrayBuffer())
      } else if (kind === 'spreadsheet') {
        const buffer = await fileData.arrayBuffer()
        const rawText = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
        const sharedStrings = rawText.match(/<si>([\s\S]*?)<\/si>/g) || []
        if (sharedStrings.length > 0) {
          extractedText = sharedStrings
            .map((s) => s.replace(/<[^>]+>/g, '').trim())
            .filter((s) => s.length > 0)
            .slice(0, 500)
            .join(' | ')
            .slice(0, MAX_SPREADSHEET_TEXT_LENGTH)
        } else {
          extractedText = stripXml(rawText).slice(0, MAX_SPREADSHEET_TEXT_LENGTH)
        }
      } else if (kind === 'text') {
        const rawText = await fileData.text()
        const fileName = (ref.file_name || '').toLowerCase()
        extractedText = (fileName.endsWith('.csv') || fileName.endsWith('.tsv'))
          ? extractCsvText(rawText)
          : rawText.slice(0, MAX_EXTRACTED_TEXT_LENGTH)
      } else if (kind === 'image') {
        extractedText = `[Image file: ${ref.file_name || 'unknown'}]\n\nAutomatic OCR is not available server-side. Please manually enter extracted text.`
        extractionNotes = 'Image file detected. Server-side OCR is unavailable; manual review recommended.'
      } else {
        extractedText = (await fileData.text()).slice(0, MAX_EXTRACTED_TEXT_LENGTH)
        extractionNotes = 'Unknown file type. Extraction may be incomplete and should be reviewed.'
      }
    } catch (extractErr: any) {
      const note = `Extraction error: ${extractErr?.message || String(extractErr)}`
      await (supabaseAdmin as any).from('tender_reference_materials')
        .update({ extraction_status: 'failed', extraction_notes: note })
        .eq('id', referenceMaterialId)
      return
    }

    const finalStatus = kind === 'image' ? 'needs_review' : (extractedText.length > 30 ? 'extracted' : 'needs_review')

    await (supabaseAdmin as any).from('tender_reference_materials')
      .update({ extracted_text: extractedText, extraction_status: finalStatus, extraction_notes: extractionNotes })
      .eq('id', referenceMaterialId)

    console.log(`✅ Server-side reference ingest complete: ${referenceMaterialId} -> ${finalStatus}`)
  } catch (err: any) {
    console.error('Server-side doExtraction error:', err)
    await (supabaseAdmin as any).from('tender_reference_materials')
      .update({ extraction_status: 'failed', extraction_notes: `Unexpected error: ${err?.message?.slice(0, 200)}` })
      .eq('id', referenceMaterialId)
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

  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Authentication required' }, 401)

  const supabaseAnon = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  )

  const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token)
  if (authError || !user) return json({ error: 'Invalid or expired session' }, 401)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: profile } = await (supabaseAdmin as any)
    .from('user_profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.organization_id) return json({ error: 'User profile is missing organization' }, 403)
  if (!['admin', 'master', 'grand_master'].includes(String(profile.role || ''))) {
    return json({ error: 'Only admin or above can add references' }, 403)
  }

  const contentType = req.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return json({ error: 'Content-Type must be multipart/form-data' }, 415)
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return json({ error: 'Invalid multipart form body' }, 400)
  }

  const title = String(formData.get('title') || '').trim()
  const description = String(formData.get('description') || '').trim()
  const materialType = String(formData.get('material_type') || 'policy').trim()
  const manualText = String(formData.get('manual_text') || '').trim()
  const file = formData.get('file')

  if (!title) return json({ error: 'title is required' }, 400)
  if (!ALLOWED_TYPES.has(materialType)) return json({ error: 'material_type is invalid' }, 400)
  if (!(file instanceof File) && !manualText) {
    return json({ error: 'Either file or manual_text is required' }, 400)
  }

  let filePath: string | null = null
  let filePublicUrl: string | null = null
  let fileName: string | null = null
  let fileKind: string | null = null

  if (file instanceof File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      return json({ error: `File exceeds ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB limit` }, 400)
    }

    fileName = file.name
    fileKind = classifyFileByName(file.name)

    const safeName = sanitizeFileName(file.name)
    const storagePath = `tender-references/${profile.organization_id}/${Date.now()}-${crypto.randomUUID()}-${safeName}`

    const buffer = new Uint8Array(await file.arrayBuffer())
    const { error: uploadError } = await supabaseAdmin.storage
      .from('evidence')
      .upload(storagePath, buffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
        cacheControl: '3600',
      })

    if (uploadError) return json({ error: `Upload failed: ${uploadError.message}` }, 500)

    const { data: urlData } = supabaseAdmin.storage.from('evidence').getPublicUrl(storagePath)
    filePath = storagePath
    filePublicUrl = urlData?.publicUrl || null
  }

  const { data: inserted, error: insertError } = await (supabaseAdmin as any)
    .from('tender_reference_materials')
    .insert({
      organization_id: profile.organization_id,
      title,
      description: description || null,
      material_type: materialType,
      file_name: fileName,
      file_path: filePath,
      file_public_url: filePublicUrl,
      file_kind: fileKind,
      extracted_text: manualText || null,
      extraction_status: manualText ? 'extracted' : (filePath ? 'extracting' : 'needs_review'),
      extraction_notes: manualText ? 'Manual text provided during server ingest.' : null,
      is_active: true,
      version: 1,
      uploaded_by: user.id,
    })
    .select('id')
    .single()

  if (insertError || !inserted?.id) {
    return json({ error: insertError?.message || 'Failed to create reference material' }, 500)
  }

  if (filePath && !manualText) {
    const backgroundWork = doExtraction(
      supabaseAdmin,
      {
        file_path: filePath,
        file_kind: fileKind,
        file_name: fileName,
      },
      inserted.id as string,
    )

    // @ts-ignore EdgeRuntime is available in Supabase Deno runtime
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(backgroundWork)
    } else {
      await backgroundWork
    }
  }

  return json({
    accepted: true,
    reference_material_id: inserted.id,
    extraction_started: Boolean(filePath && !manualText),
    message: filePath && !manualText
      ? 'Reference created; extraction running in background.'
      : 'Reference created.',
  }, 202)
}))
