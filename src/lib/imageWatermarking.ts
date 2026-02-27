/**
 * Utility Library: imageWatermarking
 * Evidence photo watermarking for legal compliance
 */

interface WatermarkOptions {
  text?: string
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
  opacity?: number
  fontSize?: number
  fontFamily?: string
  color?: string
  backgroundColor?: string
  padding?: number
  timestamp?: boolean
  gpsCoordinates?: { lat: number; lng: number }
  userName?: string
  organizationName?: string
}

interface WatermarkData {
  timestamp: string
  gpsCoordinates?: string
  userName?: string
  organizationName?: string
  plateNumber?: string
  zoneName?: string
  customText?: string
}

/**
 * Apply text watermark to image
 */
export async function applyTextWatermark(
  file: File,
  options: WatermarkOptions = {}
): Promise<Blob> {
  const {
    text = 'Evidence Photo',
    position = 'bottom-right',
    opacity = 0.7,
    fontSize = 16,
    fontFamily = 'Arial',
    color = '#FFFFFF',
    backgroundColor = 'rgba(0, 0, 0, 0.5)',
    padding = 10,
  } = options

  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)

      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }

      // Draw original image
      ctx.drawImage(img, 0, 0)

      // Configure text style
      ctx.font = `${fontSize}px ${fontFamily}`
      ctx.globalAlpha = opacity

      // Measure text
      const textMetrics = ctx.measureText(text)
      const textWidth = textMetrics.width
      const textHeight = fontSize

      // Calculate position
      let x = padding
      let y = padding + textHeight

      switch (position) {
        case 'top-right':
          x = canvas.width - textWidth - padding
          y = padding + textHeight
          break
        case 'bottom-left':
          x = padding
          y = canvas.height - padding
          break
        case 'bottom-right':
          x = canvas.width - textWidth - padding
          y = canvas.height - padding
          break
        case 'center':
          x = (canvas.width - textWidth) / 2
          y = canvas.height / 2
          break
      }

      // Draw background
      if (backgroundColor) {
        ctx.fillStyle = backgroundColor
        ctx.fillRect(
          x - padding / 2,
          y - textHeight - padding / 2,
          textWidth + padding,
          textHeight + padding
        )
      }

      // Draw text
      ctx.fillStyle = color
      ctx.fillText(text, x, y)

      ctx.globalAlpha = 1

      // Convert to blob
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('Failed to create watermarked image'))
          }
        },
        'image/jpeg',
        0.95
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
 * Apply comprehensive evidence watermark
 */
export async function applyEvidenceWatermark(
  file: File,
  data: WatermarkData
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)

      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }

      // Draw original image
      ctx.drawImage(img, 0, 0)

      // Configure watermark style
      const fontSize = 14
      const lineHeight = 18
      const padding = 10
      const backgroundColor = 'rgba(0, 0, 0, 0.7)'
      const textColor = '#FFFFFF'

      ctx.font = `${fontSize}px Arial`

      // Build watermark lines
      const lines: string[] = []
      
      if (data.timestamp) {
        lines.push(`Recorded: ${data.timestamp}`)
      }
      if (data.gpsCoordinates) {
        lines.push(`GPS: ${data.gpsCoordinates}`)
      }
      if (data.plateNumber) {
        lines.push(`Plate: ${data.plateNumber}`)
      }
      if (data.zoneName) {
        lines.push(`Zone: ${data.zoneName}`)
      }
      if (data.userName) {
        lines.push(`Officer: ${data.userName}`)
      }
      if (data.organizationName) {
        lines.push(`Org: ${data.organizationName}`)
      }
      if (data.customText) {
        lines.push(data.customText)
      }

      // Calculate watermark dimensions
      const maxWidth = Math.max(...lines.map(line => ctx.measureText(line).width))
      const watermarkWidth = maxWidth + padding * 2
      const watermarkHeight = lines.length * lineHeight + padding * 2

      // Position at bottom-left
      const x = padding
      const y = canvas.height - watermarkHeight - padding

      // Draw background
      ctx.fillStyle = backgroundColor
      ctx.fillRect(x, y, watermarkWidth, watermarkHeight)

      // Draw text lines
      ctx.fillStyle = textColor
      lines.forEach((line, index) => {
        ctx.fillText(line, x + padding, y + padding + (index + 1) * lineHeight)
      })

      // Convert to blob
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('Failed to create watermarked image'))
          }
        },
        'image/jpeg',
        0.95
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
 * Apply timestamp watermark
 */
export async function applyTimestampWatermark(
  file: File,
  timestamp?: Date
): Promise<Blob> {
  const timestampText = (timestamp || new Date()).toLocaleString('en-NZ', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Pacific/Auckland',
  })

  return applyTextWatermark(file, {
    text: timestampText,
    position: 'bottom-right',
    fontSize: 14,
  })
}

/**
 * Apply GPS coordinates watermark
 */
export async function applyGPSWatermark(
  file: File,
  latitude: number,
  longitude: number
): Promise<Blob> {
  const gpsText = `GPS: ${latitude.toFixed(6)}°, ${longitude.toFixed(6)}°`

  return applyTextWatermark(file, {
    text: gpsText,
    position: 'bottom-left',
    fontSize: 12,
  })
}

/**
 * Apply court-ready watermark (comprehensive)
 */
export async function applyCourtReadyWatermark(
  file: File,
  evidence: {
    plateNumber: string
    zoneName: string
    recordedAt: string
    recordedBy: string
    organizationName: string
    gpsCoordinates: { lat: number; lng: number }
  }
): Promise<Blob> {
  const gpsText = `${evidence.gpsCoordinates.lat.toFixed(6)}°, ${evidence.gpsCoordinates.lng.toFixed(6)}°`
  
  return applyEvidenceWatermark(file, {
    timestamp: evidence.recordedAt,
    gpsCoordinates: gpsText,
    plateNumber: evidence.plateNumber,
    zoneName: evidence.zoneName,
    userName: evidence.recordedBy,
    organizationName: evidence.organizationName,
  })
}

/**
 * Add invisible digital signature to image metadata
 */
export async function addDigitalSignature(
  file: File,
  signature: string
): Promise<Blob> {
  // In production, embed signature in EXIF metadata or use steganography
  // For now, return as-is (signature would be stored separately in database)
  return file
}

/**
 * Verify image watermark integrity
 */
export async function verifyWatermark(file: File): Promise<{
  hasWatermark: boolean
  watermarkData?: WatermarkData
}> {
  // In production, extract and verify watermark from image
  // For now, return basic check
  return { hasWatermark: false }
}

/**
 * Remove watermark (for authorized users only)
 */
export async function removeWatermark(file: File): Promise<Blob> {
  // This should only be available to admins with proper permissions
  // In production, this would require server-side authorization
  console.warn('Watermark removal requires admin authorization')
  return file
}

/**
 * Batch watermark multiple images
 */
export async function batchWatermark(
  files: File[],
  options: WatermarkOptions
): Promise<Blob[]> {
  const results = await Promise.all(
    files.map(file => applyTextWatermark(file, options))
  )
  return results
}

/**
 * Create watermark preview (without modifying original)
 */
export async function previewWatermark(
  file: File,
  options: WatermarkOptions
): Promise<string> {
  const watermarked = await applyTextWatermark(file, options)
  return URL.createObjectURL(watermarked)
}
