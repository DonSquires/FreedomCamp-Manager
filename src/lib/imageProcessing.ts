/**
 * Utility Library: imageProcessing
 * Client-side image resize, compress, and optimization
 */

interface ResizeOptions {
  maxWidth?: number
  maxHeight?: number
  quality?: number
  format?: 'jpeg' | 'png' | 'webp'
}

interface CompressOptions {
  maxSizeMB?: number
  quality?: number
  format?: 'jpeg' | 'png' | 'webp'
}

/**
 * Resize image to fit within max dimensions while maintaining aspect ratio
 */
export async function resizeImage(
  file: File,
  options: ResizeOptions = {}
): Promise<Blob> {
  const {
    maxWidth = 1920,
    maxHeight = 1920,
    quality = 0.9,
    format = 'jpeg',
  } = options

  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)

      // Calculate new dimensions
      let width = img.width
      let height = img.height

      if (width > maxWidth) {
        height = (height * maxWidth) / width
        width = maxWidth
      }

      if (height > maxHeight) {
        width = (width * maxHeight) / height
        height = maxHeight
      }

      // Create canvas and draw resized image
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }

      ctx.drawImage(img, 0, 0, width, height)

      // Convert to blob
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('Failed to create blob'))
          }
        },
        `image/${format}`,
        quality
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }

    img.src = url
  })
}

/**
 * Compress image to target size (MB)
 */
export async function compressImage(
  file: File,
  options: CompressOptions = {}
): Promise<Blob> {
  const {
    maxSizeMB = 2,
    quality: initialQuality = 0.9,
    format = 'jpeg',
  } = options

  let currentQuality = initialQuality
  let blob = await resizeImage(file, { quality: currentQuality, format })

  // Iteratively reduce quality until size is acceptable
  while (blob.size > maxSizeMB * 1024 * 1024 && currentQuality > 0.1) {
    currentQuality -= 0.1
    blob = await resizeImage(file, { quality: currentQuality, format })
  }

  return blob
}

/**
 * Convert image to WebP format for better compression
 */
export async function convertToWebP(
  file: File,
  quality: number = 0.9
): Promise<Blob> {
  return resizeImage(file, { format: 'webp', quality })
}

/**
 * Create thumbnail from image
 */
export async function createThumbnail(
  file: File,
  size: number = 200
): Promise<Blob> {
  return resizeImage(file, {
    maxWidth: size,
    maxHeight: size,
    quality: 0.8,
    format: 'jpeg',
  })
}

/**
 * Get image dimensions without loading full image
 */
export async function getImageDimensions(
  file: File
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.width, height: img.height })
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }

    img.src = url
  })
}

/**
 * Validate image file
 */
export function validateImage(file: File): {
  valid: boolean
  error?: string
} {
  // Check file type
  if (!file.type.startsWith('image/')) {
    return { valid: false, error: 'File is not an image' }
  }

  // Check file size (max 10MB)
  if (file.size > 10 * 1024 * 1024) {
    return { valid: false, error: 'Image too large (max 10MB)' }
  }

  return { valid: true }
}

/**
 * Extract EXIF data from image
 */
export async function extractEXIF(file: File): Promise<any> {
  // Simplified EXIF extraction - in production use a library like exif-js
  return new Promise((resolve) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      const arr = new Uint8Array(e.target?.result as ArrayBuffer)
      const exifData: any = {}

      // Basic EXIF marker detection
      if (arr[0] === 0xff && arr[1] === 0xd8) {
        exifData.format = 'JPEG'
      }

      // In production, parse full EXIF data including GPS, timestamp, etc.
      resolve(exifData)
    }

    reader.readAsArrayBuffer(file.slice(0, 65536)) // Read first 64KB
  })
}

/**
 * Batch process multiple images
 */
export async function batchProcessImages(
  files: File[],
  options: ResizeOptions = {}
): Promise<Blob[]> {
  const results = await Promise.all(
    files.map(file => resizeImage(file, options))
  )
  return results
}

/**
 * Calculate image hash for duplicate detection
 */
export async function calculateImageHash(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = async (e) => {
      const buffer = e.target?.result as ArrayBuffer
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
      resolve(hashHex)
    }

    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Apply image rotation based on EXIF orientation
 */
export async function correctOrientation(file: File): Promise<Blob> {
  // In production, read EXIF orientation tag and apply rotation
  // For now, return as-is
  return file
}
