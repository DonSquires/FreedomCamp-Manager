import { describe, it, expect } from 'vitest'
import {
  mimeTypeToFormat,
  detectFormatFromBytes,
  formatToExtension,
  formatToMimeType,
  isProcessableFormat,
  dataUrlPrefix,
} from '../imageFormats'

// ── mimeTypeToFormat ────────────────────────────────────────────────────────

describe('mimeTypeToFormat', () => {
  it('detects jpeg from "image/jpeg"', () => {
    expect(mimeTypeToFormat('image/jpeg')).toBe('jpeg')
  })

  it('detects jpeg from "image/jpg"', () => {
    expect(mimeTypeToFormat('image/jpg')).toBe('jpeg')
  })

  it('detects png from "image/png"', () => {
    expect(mimeTypeToFormat('image/png')).toBe('png')
  })

  it('detects webp from "image/webp"', () => {
    expect(mimeTypeToFormat('image/webp')).toBe('webp')
  })

  it('detects heic from "image/heic"', () => {
    expect(mimeTypeToFormat('image/heic')).toBe('heic')
  })

  it('detects heif from "image/heif"', () => {
    expect(mimeTypeToFormat('image/heif')).toBe('heif')
  })

  it('detects gif from "image/gif"', () => {
    expect(mimeTypeToFormat('image/gif')).toBe('gif')
  })

  it('detects bmp from "image/bmp"', () => {
    expect(mimeTypeToFormat('image/bmp')).toBe('bmp')
  })

  it('returns "unknown" for unrecognised MIME types', () => {
    expect(mimeTypeToFormat('application/octet-stream')).toBe('unknown')
    expect(mimeTypeToFormat('text/plain')).toBe('unknown')
    expect(mimeTypeToFormat('')).toBe('unknown')
  })

  it('is case-insensitive', () => {
    expect(mimeTypeToFormat('IMAGE/JPEG')).toBe('jpeg')
    expect(mimeTypeToFormat('Image/PNG')).toBe('png')
  })
})

// ── detectFormatFromBytes ───────────────────────────────────────────────────

describe('detectFormatFromBytes', () => {
  it('detects JPEG from FF D8 magic bytes', () => {
    const bytes = new Uint8Array([0xFF, 0xD8, 0x00, 0x00])
    expect(detectFormatFromBytes(bytes)).toBe('jpeg')
  })

  it('detects PNG from 89 50 4E 47 magic bytes', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    expect(detectFormatFromBytes(bytes)).toBe('png')
  })

  it('detects WebP (RIFF container) from 52 49 46 46 magic bytes', () => {
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00])
    expect(detectFormatFromBytes(bytes)).toBe('webp')
  })

  it('detects GIF from 47 49 46 magic bytes', () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    expect(detectFormatFromBytes(bytes)).toBe('gif')
  })

  it('detects BMP from 42 4D magic bytes', () => {
    const bytes = new Uint8Array([0x42, 0x4D, 0x00, 0x00])
    expect(detectFormatFromBytes(bytes)).toBe('bmp')
  })

  it('returns "unknown" for unrecognised magic bytes', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03])
    expect(detectFormatFromBytes(bytes)).toBe('unknown')
  })

  it('returns "unknown" for empty array', () => {
    const bytes = new Uint8Array([])
    expect(detectFormatFromBytes(bytes)).toBe('unknown')
  })
})

// ── formatToExtension ───────────────────────────────────────────────────────

describe('formatToExtension', () => {
  it('maps jpeg to "jpg"', () => {
    expect(formatToExtension('jpeg')).toBe('jpg')
  })

  it('maps png to "png"', () => {
    expect(formatToExtension('png')).toBe('png')
  })

  it('maps webp to "webp"', () => {
    expect(formatToExtension('webp')).toBe('webp')
  })

  it('maps heic to "heic"', () => {
    expect(formatToExtension('heic')).toBe('heic')
  })

  it('maps heif to "heif"', () => {
    expect(formatToExtension('heif')).toBe('heif')
  })

  it('maps gif to "gif"', () => {
    expect(formatToExtension('gif')).toBe('gif')
  })

  it('maps bmp to "bmp"', () => {
    expect(formatToExtension('bmp')).toBe('bmp')
  })

  it('maps unknown to "bin"', () => {
    expect(formatToExtension('unknown')).toBe('bin')
  })
})

// ── formatToMimeType ────────────────────────────────────────────────────────

describe('formatToMimeType', () => {
  it('maps jpeg to "image/jpeg"', () => {
    expect(formatToMimeType('jpeg')).toBe('image/jpeg')
  })

  it('maps png to "image/png"', () => {
    expect(formatToMimeType('png')).toBe('image/png')
  })

  it('maps webp to "image/webp"', () => {
    expect(formatToMimeType('webp')).toBe('image/webp')
  })

  it('maps heic to "image/heic"', () => {
    expect(formatToMimeType('heic')).toBe('image/heic')
  })

  it('maps heif to "image/heif"', () => {
    expect(formatToMimeType('heif')).toBe('image/heif')
  })

  it('maps gif to "image/gif"', () => {
    expect(formatToMimeType('gif')).toBe('image/gif')
  })

  it('maps bmp to "image/bmp"', () => {
    expect(formatToMimeType('bmp')).toBe('image/bmp')
  })

  it('maps unknown to "application/octet-stream"', () => {
    expect(formatToMimeType('unknown')).toBe('application/octet-stream')
  })
})

// ── isProcessableFormat ─────────────────────────────────────────────────────

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

// ── dataUrlPrefix ───────────────────────────────────────────────────────────

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

  it('returns correct prefix for gif', () => {
    expect(dataUrlPrefix('gif')).toBe('data:image/gif;base64,')
  })

  it('returns correct prefix for bmp', () => {
    expect(dataUrlPrefix('bmp')).toBe('data:image/bmp;base64,')
  })

  it('returns correct prefix for unknown', () => {
    expect(dataUrlPrefix('unknown')).toBe('data:application/octet-stream;base64,')
  })
})
