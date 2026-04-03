import * as XLSX from 'xlsx'
import mammoth from 'mammoth'
import * as pdfjsLib from 'pdfjs-dist'
import Tesseract from 'tesseract.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString()

export interface ExtractedDocumentData {
  text: string
  headers: string[]
  strategy: 'full' | 'limited' | 'stage-only'
  rationale?: string
}

export interface ExtractionOptions {
  enableImageOcr?: boolean
}

function getExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split('.')
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

function parseDelimitedHeaders(text: string): string[] {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim())
  if (!firstLine) return []
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes('|') ? '|' : ','
  return firstLine
    .split(delimiter)
    .map((part) => part.replace(/^"|"$/g, '').trim())
    .filter(Boolean)
}

export async function extractDocumentData(file: File, options: ExtractionOptions = {}): Promise<ExtractedDocumentData> {
  const extension = getExtension(file.name)

  if (file.size > 25 * 1024 * 1024) {
    return {
      text: '',
      headers: [],
      strategy: 'stage-only',
      rationale: 'File is too large for safe browser-side extraction. Bob should stage it for review instead of attempting full parsing.',
    }
  }

  if (file.type.startsWith('text/') || ['txt', 'csv'].includes(extension)) {
    const text = await file.text()
    return {
      text,
      headers: extension === 'csv' ? parseDelimitedHeaders(text) : [],
      strategy: file.size > 5 * 1024 * 1024 ? 'limited' : 'full',
    }
  }

  if (extension === 'json') {
    const text = await file.text()
    try {
      const parsed = JSON.parse(text)
      const headers = Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'object'
        ? Object.keys(parsed[0])
        : parsed && typeof parsed === 'object'
          ? Object.keys(parsed)
          : []
      return { text, headers, strategy: 'full' }
    } catch {
      return { text, headers: [], strategy: 'limited', rationale: 'JSON could not be fully parsed as structured records; Bob is using raw text only.' }
    }
  }

  if (['xls', 'xlsx'].includes(extension)) {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' })
    const headers = rows[0] ? Object.keys(rows[0]) : []
    const text = rows
      .slice(0, 20)
      .map((row) => Object.values(row).join(' | '))
      .join('\n')
    return {
      text,
      headers,
      strategy: file.size > 10 * 1024 * 1024 ? 'limited' : 'full',
      rationale: file.size > 10 * 1024 * 1024 ? 'Spreadsheet preview was limited to avoid browser CPU spikes.' : undefined,
    }
  }

  if (extension === 'docx') {
    if (file.size > 12 * 1024 * 1024) {
      return {
        text: '',
        headers: [],
        strategy: 'stage-only',
        rationale: 'DOCX is large enough that Bob should stage it instead of extracting all text in the browser.',
      }
    }
    const buffer = await file.arrayBuffer()
    const result = await mammoth.extractRawText({ arrayBuffer: buffer })
    return { text: result.value || '', headers: [], strategy: 'full' }
  }

  if (extension === 'pdf') {
    if (file.size > 12 * 1024 * 1024) {
      return {
        text: '',
        headers: [],
        strategy: 'stage-only',
        rationale: 'PDF is large enough that Bob should stage it instead of extracting all text in the browser.',
      }
    }
    const buffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 5); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const pageText = content.items
        .map((item: any) => ('str' in item ? item.str : ''))
        .join(' ')
      pages.push(pageText)
    }
    return {
      text: pages.join('\n'),
      headers: [],
      strategy: pdf.numPages > 5 ? 'limited' : 'full',
      rationale: pdf.numPages > 5 ? 'Bob only extracted the first five pages to avoid timeout and CPU spikes.' : undefined,
    }
  }

  if (file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(extension)) {
    if (!options.enableImageOcr) {
      return {
        text: '',
        headers: [],
        strategy: 'limited',
        rationale: 'OCR was not requested for this image.',
      }
    }

    if (file.size > 6 * 1024 * 1024) {
      return {
        text: '',
        headers: [],
        strategy: 'stage-only',
        rationale: 'Image is too large for safe OCR in the browser. Bob should stage it for review.',
      }
    }

    const { data } = await Tesseract.recognize(file, 'eng')
    return {
      text: data.text || '',
      headers: [],
      strategy: 'limited',
      rationale: 'Bob used OCR on the image. Results may need human review.',
    }
  }

  return { text: '', headers: [], strategy: 'stage-only', rationale: 'This file type is not suitable for browser-side extraction.' }
}