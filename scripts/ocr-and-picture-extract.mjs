#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createWorker } from 'tesseract.js'
import { createCanvas } from '@napi-rs/canvas'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import JSZip from 'jszip'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const PDF_STANDARD_FONTS_URL = pathToFileURL(path.join(ROOT, 'node_modules/pdfjs-dist/standard_fonts/')).href

function parseArgs(argv) {
  const args = {
    index: path.join(ROOT, 'tmp/docs/storage-review/index.json'),
    outDir: path.join(ROOT, 'tmp/docs/ocr-output'),
    lang: 'eng',
    maxFiles: 9999,
    maxPages: 5,
    dpiScale: 2,
  }

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--index') args.index = path.resolve(argv[++i])
    else if (a === '--out') args.outDir = path.resolve(argv[++i])
    else if (a === '--lang') args.lang = argv[++i]
    else if (a === '--max-files') args.maxFiles = Number(argv[++i] || '9999')
    else if (a === '--max-pages') args.maxPages = Number(argv[++i] || '5')
    else if (a === '--dpi-scale') args.dpiScale = Number(argv[++i] || '2')
  }
  return args
}

function safeName(input) {
  return input.replace(/[^A-Za-z0-9._-]+/g, '_')
}

function isImageExt(ext) {
  return ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'].includes(ext.toLowerCase())
}

function isOcrFriendlyImagePath(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'].includes(ext)
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

async function renderPdfPageToPngBuffer(pdfPath, pageNo, scale = 2) {
  const data = await fs.readFile(pdfPath)
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(data),
    useWorkerFetch: false,
    isEvalSupported: false,
    standardFontDataUrl: PDF_STANDARD_FONTS_URL,
  })
  const pdf = await loadingTask.promise
  const page = await pdf.getPage(pageNo)
  const viewport = page.getViewport({ scale })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const ctx = canvas.getContext('2d')

  await page.render({ canvasContext: ctx, viewport }).promise
  return canvas.toBuffer('image/png')
}

async function extractOfficeMedia(filePath, outDir) {
  const data = await fs.readFile(filePath)
  const zip = await JSZip.loadAsync(data)
  const names = Object.keys(zip.files)
  const mediaFiles = names.filter((n) => /^(word|ppt|xl)\/media\//i.test(n) && !zip.files[n].dir)

  const extracted = []
  for (const mediaPath of mediaFiles) {
    const ext = path.extname(mediaPath) || '.bin'
    const base = safeName(path.basename(mediaPath, ext))
    const out = path.join(outDir, `${base}${ext.toLowerCase()}`)
    const buf = await zip.files[mediaPath].async('nodebuffer')
    await fs.writeFile(out, buf)
    extracted.push(out)
  }
  return extracted
}

async function ocrImageBuffer(worker, imgBuffer) {
  const { data } = await worker.recognize(imgBuffer)
  return (data?.text || '').trim()
}

async function main() {
  const args = parseArgs(process.argv)
  await ensureDir(args.outDir)

  const index = await readJson(args.index)
  const docs = index
    .filter((x) => x?.download_file && x?.status !== 'error')
    .slice(0, args.maxFiles)

  const worker = await createWorker(args.lang)

  const report = {
    generatedAt: new Date().toISOString(),
    args,
    totalCandidates: docs.length,
    processed: 0,
    results: [],
  }

  for (const item of docs) {
    const src = path.isAbsolute(item.download_file)
      ? item.download_file
      : path.join(ROOT, item.download_file)

    let stat
    try {
      stat = await fs.stat(src)
    } catch {
      continue
    }
    if (!stat.isFile()) continue

    const ext = (item.ext || path.extname(src)).toLowerCase()
    const stem = safeName(`${item.bucket}__${item.path}`)
    const fileOutDir = path.join(args.outDir, stem)
    await ensureDir(fileOutDir)

    const row = {
      bucket: item.bucket,
      path: item.path,
      source: src,
      ext,
      ocrTextFile: '',
      extractedPictures: [],
      errors: [],
    }

    try {
      if (ext === '.pdf') {
        const ocrChunks = []
        const data = await fs.readFile(src)
        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(data),
          useWorkerFetch: false,
          isEvalSupported: false,
          standardFontDataUrl: PDF_STANDARD_FONTS_URL,
        })
        const pdf = await loadingTask.promise
        const pageCount = Math.min(pdf.numPages, args.maxPages)

        for (let p = 1; p <= pageCount; p += 1) {
          const png = await renderPdfPageToPngBuffer(src, p, args.dpiScale)
          const imgOut = path.join(fileOutDir, `page-${String(p).padStart(3, '0')}.png`)
          await fs.writeFile(imgOut, png)
          row.extractedPictures.push(imgOut)

          const text = await ocrImageBuffer(worker, png)
          if (text) {
            ocrChunks.push(`\n\n===== PAGE ${p} =====\n${text}`)
          }
        }

        const ocrOut = path.join(fileOutDir, 'ocr.txt')
        await fs.writeFile(ocrOut, ocrChunks.join('\n'), 'utf8')
        row.ocrTextFile = ocrOut
      } else if (isImageExt(ext)) {
        const img = await fs.readFile(src)
        const text = await ocrImageBuffer(worker, img)
        const ocrOut = path.join(fileOutDir, 'ocr.txt')
        await fs.writeFile(ocrOut, text || '', 'utf8')
        row.ocrTextFile = ocrOut

        const copyOut = path.join(fileOutDir, `source${ext}`)
        await fs.writeFile(copyOut, img)
        row.extractedPictures.push(copyOut)
      } else if (['.docx', '.pptx', '.xlsx'].includes(ext)) {
        const pics = await extractOfficeMedia(src, fileOutDir)
        row.extractedPictures.push(...pics)

        if (pics.length > 0) {
          const ocrChunks = []
          for (const picPath of pics.slice(0, 30)) {
            if (!isOcrFriendlyImagePath(picPath)) continue
            try {
              const img = await fs.readFile(picPath)
              const text = await ocrImageBuffer(worker, img)
              if (text) {
                ocrChunks.push(`\n\n===== ${path.basename(picPath)} =====\n${text}`)
              }
            } catch (err) {
              row.errors.push(`OCR skipped for ${path.basename(picPath)}: ${String(err?.message || err)}`)
            }
          }
          const ocrOut = path.join(fileOutDir, 'ocr.txt')
          await fs.writeFile(ocrOut, ocrChunks.join('\n'), 'utf8')
          row.ocrTextFile = ocrOut
        }
      }
    } catch (err) {
      row.errors.push(String(err?.message || err))
    }

    report.results.push(row)
    report.processed += 1
  }

  await worker.terminate()

  const reportFile = path.join(args.outDir, 'report.json')
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2), 'utf8')

  const summary = [
    `Processed: ${report.processed}`,
    `Output: ${args.outDir}`,
    `Report: ${reportFile}`,
  ]
  // eslint-disable-next-line no-console
  console.log(summary.join('\n'))
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('ocr-and-picture-extract failed:', err)
  process.exit(1)
})
