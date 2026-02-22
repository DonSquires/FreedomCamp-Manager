/**
 * Image Format Support - NZ-specific HEIC/HEIF handling
 * 
 * Extends standard web image formats with iOS camera formats.
 * Provides MIME type detection, validation, and conversion utilities.
 */

// NZ-compliant image format whitelist
export const SUPPORTED_IMAGE_FORMATS = {
  // Standard web formats
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/bmp': ['.bmp'],
  'image/tiff': ['.tiff', '.tif'],
  
  // iOS camera formats (HEIC/HEIF)
  'image/heic': ['.heic'],
  'image/heif': ['.heif'],
} as const;

// Flattened list for input accept attribute
export const IMAGE_ACCEPT_EXTENSIONS = Object.values(SUPPORTED_IMAGE_FORMATS)
  .flat()
  .join(',');

export const IMAGE_ACCEPT_MIMETYPES = Object.keys(SUPPORTED_IMAGE_FORMATS).join(',');

/**
 * Detect MIME type from file extension (fallback for iOS HEIC/HEIF)
 * Browsers don't always set correct MIME for HEIC/HEIF files
 */
export function getMimeTypeFromExtension(filename: string): string | null {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!ext) return null;

  for (const [mimeType, extensions] of Object.entries(SUPPORTED_IMAGE_FORMATS)) {
    if (extensions.includes(ext)) {
      return mimeType;
    }
  }

  return null;
}

/**
 * Validate image file with NZ format support
 */
export function validateImageFile(file: File): {
  valid: boolean;
  error?: string;
  detectedMime?: string;
} {
  // Try to get MIME from file.type first
  let mimeType = file.type;

  // Fallback: detect from extension (handles HEIC/HEIF from iOS)
  if (!mimeType || mimeType === 'application/octet-stream') {
    const detectedMime = getMimeTypeFromExtension(file.name);
    if (detectedMime) {
      mimeType = detectedMime;
    }
  }

  // Check if MIME type is supported
  if (!Object.keys(SUPPORTED_IMAGE_FORMATS).includes(mimeType)) {
    return {
      valid: false,
      error: `Unsupported image format: ${mimeType || 'unknown'}. Supported: ${IMAGE_ACCEPT_MIMETYPES}`,
    };
  }

  return {
    valid: true,
    detectedMime: mimeType,
  };
}

/**
 * Check if HEIC/HEIF conversion is needed
 * (for ALPR providers that don't support HEIC/HEIF)
 */
export function needsConversion(mimeType: string): boolean {
  return mimeType === 'image/heic' || mimeType === 'image/heif';
}

/**
 * Convert HEIC/HEIF to JPEG (client-side)
 * Uses browser's native canvas API
 */
export async function convertToJpeg(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      try {
        // Create canvas with image dimensions
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to get canvas context');
        }

        // Draw image to canvas
        ctx.drawImage(img, 0, 0);

        // Convert to JPEG blob
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Failed to convert image to JPEG'));
              return;
            }

            // Create new File from blob
            const jpegFile = new File(
              [blob],
              file.name.replace(/\.(heic|heif)$/i, '.jpg'),
              { type: 'image/jpeg' }
            );

            URL.revokeObjectURL(url);
            resolve(jpegFile);
          },
          'image/jpeg',
          0.92 // Quality: 92%
        );
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for conversion'));
    };

    img.src = url;
  });
}

/**
 * Prepare image file for upload
 * - Validates format
 * - Detects MIME type
 * - Optionally converts HEIC/HEIF to JPEG
 */
export async function prepareImageForUpload(
  file: File,
  options: {
    convertHeic?: boolean; // Default: true for ALPR compatibility
    maxSizeMB?: number; // Default: 10
  } = {}
): Promise<{
  file: File;
  mimeType: string;
  converted: boolean;
}> {
  const { convertHeic = true, maxSizeMB = 10 } = options;

  // Validate format
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const mimeType = validation.detectedMime!;

  // Check size
  const maxBytes = maxSizeMB * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error(`File exceeds ${maxSizeMB} MB limit`);
  }

  // Convert HEIC/HEIF if needed
  if (convertHeic && needsConversion(mimeType)) {
    console.log(`🔄 Converting ${mimeType} to JPEG for ALPR compatibility...`);
    const convertedFile = await convertToJpeg(file);
    return {
      file: convertedFile,
      mimeType: 'image/jpeg',
      converted: true,
    };
  }

  return {
    file,
    mimeType,
    converted: false,
  };
}

/**
 * Get file icon based on format
 */
export function getImageFormatIcon(mimeType: string): string {
  if (mimeType.includes('heic') || mimeType.includes('heif')) {
    return '📱'; // iOS camera
  }
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
    return '🖼️';
  }
  if (mimeType.includes('png')) {
    return '🎨';
  }
  if (mimeType.includes('webp')) {
    return '🌐';
  }
  return '📷';
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
