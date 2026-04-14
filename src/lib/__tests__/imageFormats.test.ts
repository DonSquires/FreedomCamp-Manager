import { describe, it, expect } from 'vitest'
import {
  mimeTypeToFormat,
  detectFormatFromBytes,
  formatToExtension,
  formatToMimeType,
  isProcessableFormat,
  dataUrlPrefix,
  type SupportedImageFormat,
} from '../imageFormats'

// ── mimeTypeToFormat ─────────────────────────────────────────────────────────

describe('mimeTypeToFormat', () => {
  it('returns "jpeg" for image/jpeg', () => {
    expect(mimeTypeToFormat('image/jpeg')).toBe('jpeg')
  })

  it('returns "jpeg" for image/jpg', () => {
    expect(mimeTypeToFormat('image/jpg')).toBe('jpeg')
  })

  it('returns "png" for image/png', () => {
    expect(mimeTypeToFormat('image/png')).toBe('png')
  })

  it('returns "webp" for image/webp', () => {
    expect(mimeTypeToFormat('image/webp')).toBe('webp')
  })

  it('returns "heic" for image/heic', () => {
    expect(mimeTypeToFormat('image/heic')).toBe('heic')
  })

  it('returns "heif" for image/heif', () => {
    expect(mimeTypeToFormat('image/heif')).toBe('heif')
  })

  it('returns "gif" for image/gif', () => {
    expect(mimeTypeToFormat('image/gif')).toBe('gif')
  })

  it('returns "bmp" for image/bmp', () => {
    expect(mimeTypeToFormat('image/bmp')).toBe('bmp')
  })

  it('returns "unknown" for unrecognised MIME type', () => {
    expect(mimeTypeToFormat('application/octet-stream')).toBe('unknown')
    expect(mimeTypeToFormat('text/plain')).toBe('unknown')
    expect(mimeTypeToFormat('')).toBe('unknown')
  })

  it('is case-insensitive', () => {
    expect(mimeTypeToFormat('IMAGE/JPEG')).toBe('jpeg')
    expect(mimeTypeToFormat('Image/PNG')).toBe('png')
    expect(mimeTypeToFormat('IMAGE/WEBP')).toBe('webp')
  })
})

// ── detectFormatFromBytes ────────────────────────────────────────────────────

describe('detectFormatFromBytes', () => {
  it('detects JPEG from FF D8 magic bytes', () => {
    const bytes = new Uint8Array([0xFF, 0xD8, 0x00, 0x00])
    expect(detectFormatFromBytes(bytes)).toBe('jpeg')
  })

  it('detects PNG from 89 50 4E 47 magic bytes', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    expect(detectFormatFromBytes(bytes)).toBe('png')
  })

  it('detects WebP from RIFF header (52 49 46 46)', () => {
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46])
    expect(detectFormatFromBytes(bytes)).toBe('webp')
  })

  it('detects GIF from 47 49 46 magic bytes', () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x00])
    expect(detectFormatFromBytes(bytes)).toBe('gif')
  })

  it('detects BMP from 42 4D magic bytes', () => {
    const bytes = new Uint8Array([0x42, 0x4D, 0x00, 0x00])
    expect(detectFormatFromBytes(bytes)).toBe('bmp')
  })

  it('returns "unknown" for unrecognised byte sequence', () => {
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x00])
    expect(detectFormatFromBytes(bytes)).toBe('unknown')
  })
})

// ── formatToExtension ────────────────────────────────────────────────────────

describe('formatToExtension', () => {
  it('returns "jpg" for jpeg', () => {
    expect(formatToExtension('jpeg')).toBe('jpg')
  })

  it('returns "png" for png', () => {
    expect(formatToExtension('png')).toBe('png')
  })

  it('returns "webp" for webp', () => {
    expect(formatToExtension('webp')).toBe('webp')
  })

  it('returns "heic" for heic', () => {
    expect(formatToExtension('heic')).toBe('heic')
  })

  it('returns "heif" for heif', () => {
    expect(formatToExtension('heif')).toBe('heif')
  })

  it('returns "gif" for gif', () => {
    expect(formatToExtension('gif')).toBe('gif')
  })

  it('returns "bmp" for bmp', () => {
    expect(formatToExtension('bmp')).toBe('bmp')
  })

  it('returns "bin" for unknown', () => {
    expect(formatToExtension('unknown')).toBe('bin')
  })

  it('covers all SupportedImageFormat values', () => {
    const formats: SupportedImageFormat[] = ['jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'bmp', 'unknown']
    for (const format of formats) {
      expect(typeof formatToExtension(format)).toBe('string')
    }
  })
})

// ── formatToMimeType ─────────────────────────────────────────────────────────

describe('formatToMimeType', () => {
  it('returns "image/jpeg" for jpeg', () => {
    expect(formatToMimeType('jpeg')).toBe('image/jpeg')
  })

  it('returns "image/png" for png', () => {
    expect(formatToMimeType('png')).toBe('image/png')
  })

  it('returns "image/webp" for webp', () => {
    expect(formatToMimeType('webp')).toBe('image/webp')
  })

  it('returns "image/heic" for heic', () => {
    expect(formatToMimeType('heic')).toBe('image/heic')
  })

  it('returns "image/heif" for heif', () => {
    expect(formatToMimeType('heif')).toBe('image/heif')
  })

  it('returns "image/gif" for gif', () => {
    expect(formatToMimeType('gif')).toBe('image/gif')
  })

  it('returns "image/bmp" for bmp', () => {
    expect(formatToMimeType('bmp')).toBe('image/bmp')
  })

  it('returns "application/octet-stream" for unknown', () => {
    expect(formatToMimeType('unknown')).toBe('application/octet-stream')
  })

  it('round-trips through mimeTypeToFormat', () => {
    const processable: SupportedImageFormat[] = ['jpeg', 'png', 'webp', 'gif', 'bmp']
    for (const format of processable) {
      const mime = formatToMimeType(format)
      expect(mimeTypeToFormat(mime)).toBe(format)
    }
  })
})

// ── isProcessableFormat ──────────────────────────────────────────────────────

describe('isProcessableFormat', () => {
  it('returns true for jpeg', () => {
    expect(isProcessableFormat('jpeg')).toBe(true)
  })

  it('returns true for png', () => {
    expect(isProcessableFormat('png')).toBe(true)
  })

  it('returns true for webp', () => {
    expect(isProcessableFormat('webp')).toBe(true)
  })

  it('returns false for heic', () => {
    expect(isProcessableFormat('heic')).toBe(false)
  })

  it('returns false for heif', () => {
    expect(isProcessableFormat('heif')).toBe(false)
  })

  it('returns false for gif', () => {
    expect(isProcessableFormat('gif')).toBe(false)
  })

  it('returns false for bmp', () => {
    expect(isProcessableFormat('bmp')).toBe(false)
  })

  it('returns false for unknown', () => {
    expect(isProcessableFormat('unknown')).toBe(false)
  })
})

// ── dataUrlPrefix ────────────────────────────────────────────────────────────

describe('dataUrlPrefix', () => {
  it('returns correct prefix for jpeg', () => {
    expect(dataUrlPrefix('jpeg')).toBe('data:image/jpeg;base64,')
  })

  it('returns correct prefix for png', () => {
    expect(dataUrlPrefix('png')).toBe('data:image/png;base64,')
  })

  it('returns correct prefix for webp', () => {
    expect(dataUrlPrefix('webp')).toBe('data:image/webp;base64,')
  })

  it('returns correct prefix for unknown format', () => {
    expect(dataUrlPrefix('unknown')).toBe('data:application/octet-stream;base64,')
  })

  it('prefix always ends with ",base64,"', () => {
    const formats: SupportedImageFormat[] = ['jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif', 'unknown']
    for (const format of formats) {
      expect(dataUrlPrefix(format)).toContain(';base64,')
    }
  })
})
