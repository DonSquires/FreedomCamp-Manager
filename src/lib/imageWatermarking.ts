/**
 * Image Watermarking Utility
 * 
 * CRITICAL FOR LEGAL COMPLIANCE:
 * All photos taken in the field MUST be watermarked with:
 * - GPS coordinates (latitude, longitude, accuracy)
 * - Date and time (NZ timezone)
 * - Officer name/ID
 * - Organization name
 * 
 * This ensures photos are court-ready evidence with full provenance
 * and cannot be disputed regarding location, time, or authenticity.
 */

interface WatermarkData {
  gpsLatitude: number;
  gpsLongitude: number;
  gpsAccuracy: number;
  timestamp: Date;
  officerName: string;
  organizationName?: string;
  zoneName?: string;
  plateNumber?: string;
}

/**
 * Apply visible watermark to image with GPS, date, time, and officer info
 * 
 * @param imageDataUrl - Base64 data URL of the original image
 * @param watermarkData - GPS, timestamp, and officer information
 * @returns Promise<string> - Base64 data URL of watermarked image
 */
export async function applyWatermark(
  imageDataUrl: string,
  watermarkData: WatermarkData
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      try {
        // Create canvas
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          throw new Error('Failed to get canvas context');
        }

        // Set canvas size to match image
        canvas.width = img.width;
        canvas.height = img.height;

        // Draw original image
        ctx.drawImage(img, 0, 0);

        // Prepare watermark text
        const lines = buildWatermarkText(watermarkData);

        // Watermark styling
        const fontSize = Math.max(16, Math.floor(img.width / 40)); // Responsive font size
        const lineHeight = fontSize * 1.4;
        const padding = fontSize * 0.8;
        const backgroundHeight = (lines.length * lineHeight) + (padding * 2);
        const backgroundWidth = img.width;

        // Draw semi-transparent background at bottom
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, img.height - backgroundHeight, backgroundWidth, backgroundHeight);

        // Draw watermark text
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.fillStyle = '#FFFFFF';
        ctx.textBaseline = 'top';

        lines.forEach((line, index) => {
          const y = img.height - backgroundHeight + padding + (index * lineHeight);
          ctx.fillText(line, padding, y);
        });

        // Add GPS accuracy indicator (color-coded)
        const accuracyColor = watermarkData.gpsAccuracy <= 10 ? '#00FF00' : 
                             watermarkData.gpsAccuracy <= 30 ? '#FFFF00' : 
                             watermarkData.gpsAccuracy <= 50 ? '#FFA500' : '#FF0000';
        
        ctx.fillStyle = accuracyColor;
        ctx.fillRect(img.width - padding - 20, img.height - backgroundHeight + padding, 15, 15);

        // Convert to base64
        const watermarkedDataUrl = canvas.toDataURL('image/jpeg', 0.95);
        resolve(watermarkedDataUrl);
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error('Failed to load image for watermarking'));
    };

    img.src = imageDataUrl;
  });
}

/**
 * Build watermark text lines
 */
function buildWatermarkText(data: WatermarkData): string[] {
  const lines: string[] = [];

  // Line 1: GPS coordinates with accuracy
  lines.push(
    `GPS: ${data.gpsLatitude.toFixed(6)}, ${data.gpsLongitude.toFixed(6)} (±${data.gpsAccuracy.toFixed(0)}m)`
  );

  // Line 2: Date and time (NZ timezone)
  const nzTime = data.timestamp.toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  lines.push(`DATE/TIME: ${nzTime} NZDT`);

  // Line 3: Officer and organization
  if (data.organizationName) {
    lines.push(`OFFICER: ${data.officerName} | ORG: ${data.organizationName}`);
  } else {
    lines.push(`OFFICER: ${data.officerName}`);
  }

  // Line 4: Zone and plate (if applicable)
  if (data.zoneName || data.plateNumber) {
    const parts: string[] = [];
    if (data.zoneName) parts.push(`ZONE: ${data.zoneName}`);
    if (data.plateNumber) parts.push(`PLATE: ${data.plateNumber}`);
    lines.push(parts.join(' | '));
  }

  return lines;
}

/**
 * Extract EXIF GPS data from image (for verification)
 * This can be used to verify watermark matches embedded EXIF data
 */
export async function extractGPSExif(imageDataUrl: string): Promise<{
  latitude: number;
  longitude: number;
  timestamp: Date;
} | null> {
  // Note: EXIF extraction requires additional library (exif-js or exifr)
  // For now, return null - can be implemented later
  console.warn('EXIF GPS extraction not yet implemented');
  return null;
}

/**
 * Embed GPS metadata in image EXIF (if supported)
 * This creates dual-layer proof: visible watermark + EXIF metadata
 */
export async function embedGPSMetadata(
  imageBlob: Blob,
  gpsData: {
    latitude: number;
    longitude: number;
    altitude?: number;
    timestamp: Date;
  }
): Promise<Blob> {
  // Note: EXIF writing requires additional library (piexifjs)
  // For now, return original blob - can be implemented later
  console.warn('EXIF GPS embedding not yet implemented - watermark only');
  return imageBlob;
}

/**
 * Generate court-ready evidence package
 * Combines watermarked image with JSON metadata file
 */
export function generateEvidencePackage(
  watermarkedImageDataUrl: string,
  metadata: {
    observation_id: string;
    plate_number: string;
    officer_id: string;
    officer_name: string;
    organization_id: string;
    organization_name: string;
    zone_id: string;
    zone_name: string;
    gps_latitude: number;
    gps_longitude: number;
    gps_accuracy: number;
    captured_at: string;
    device_info?: any;
  }
): { image: string; metadata: string } {
  const metadataJson = JSON.stringify(metadata, null, 2);
  
  return {
    image: watermarkedImageDataUrl,
    metadata: metadataJson,
  };
}
