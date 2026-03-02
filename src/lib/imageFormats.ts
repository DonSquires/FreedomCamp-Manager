/**
 * imageFormats.ts — Image format detection and conversion helpers.
 *
 * Used by the ALPR pipeline and evidence capture to ensure images are in a
 * compatible format before uploading to Supabase Storage or sending to Railway
 * inference services.
 */

export type SupportedImageFormat = 'jpeg' | 'png' | 'webp' | 'heic' | 'heif' | 'gif' | 'bmp' | 'unknown'

/** Detect image format from its MIME type string */
export function mimeTypeToFormat(mimeType: string): SupportedImageFormat {
  const lower = mimeType.toLowerCase()
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpeg'
  if (lower.includes('png')) return 'png'
  if (lower.includes('webp')) return 'webp'
  if (lower.includes('heic')) return 'heic'
  if (lower.includes('heif')) return 'heif'
  if (lower.includes('gif')) return 'gif'
  if (lower.includes('bmp')) return 'bmp'
  return 'unknown'
}

/** Detect image format from magic bytes (first 12 bytes of a file) */
export function detectFormatFromBytes(bytes: Uint8Array): SupportedImageFormat {
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'png'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'webp' // RIFF container
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif'
  if (bytes[0] === 0x42 && bytes[1] === 0x4D) return 'bmp'
  return 'unknown'
}

/** Get the file extension for a supported format */
export function formatToExtension(format: SupportedImageFormat): string {
  const map: Record<SupportedImageFormat, string> = {
    jpeg: 'jpg',
    png: 'png',
    webp: 'webp',
    heic: 'heic',
    heif: 'heif',
    gif: 'gif',
    bmp: 'bmp',
    unknown: 'bin',
  }
  return map[format]
}

/** Get the MIME type for a supported format */
export function formatToMimeType(format: SupportedImageFormat): string {
  const map: Record<SupportedImageFormat, string> = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    gif: 'image/gif',
    bmp: 'image/bmp',
    unknown: 'application/octet-stream',
  }
  return map[format]
}

/** Returns true if the format is accepted by Plate Recognizer and the inference service */
export function isProcessableFormat(format: SupportedImageFormat): boolean {
  return format === 'jpeg' || format === 'png' || format === 'webp'
}

/**
 * Convert a canvas/image to JPEG as a Blob (for upload).
 * `quality` is 0–1 (default 0.85).
 */
export async function convertToJpeg(
  input: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  quality = 0.85
): Promise<Blob> {
  const canvas = document.createElement('canvas')

  const drawToCanvas = (ctx: CanvasRenderingContext2D) => {
    ctx.drawImage(input as CanvasImageSource, 0, 0)
  }

  if (input instanceof HTMLImageElement) {
    canvas.width = input.naturalWidth
    canvas.height = input.naturalHeight
  } else if (input instanceof ImageBitmap) {
    canvas.width = input.width
    canvas.height = input.height
  } else {
    canvas.width = input.width
    canvas.height = input.height
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get 2D canvas context')
  drawToCanvas(ctx)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Canvas toBlob returned null'))
      },
      'image/jpeg',
      quality
    )
  })
}

/**
 * Returns the data URL format prefix for a given format.
 */
export function dataUrlPrefix(format: SupportedImageFormat): string {
  return `data:${formatToMimeType(format)};base64,`
}
