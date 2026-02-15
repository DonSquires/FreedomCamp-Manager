/**
 * Image Processing Utilities
 * Handles image cropping, compression, and SHA-256 hashing for evidence integrity
 */

export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProcessedImage {
  file: File;
  hash: string;
  width: number;
  height: number;
  url: string;
}

/**
 * Calculate SHA-256 hash of a file
 */
export async function calculateFileHash(file: File): Promise<string> {
  if (typeof window === 'undefined' || !crypto?.subtle) {
    throw new Error('Crypto API not available');
  }
  
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Crop image to specified region
 */
export async function cropImage(
  file: File,
  cropRegion?: CropRegion
): Promise<ProcessedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Canvas context not available'));
      return;
    }

    img.onload = async () => {
      try {
        let region: CropRegion;

        if (cropRegion) {
          region = cropRegion;
        } else {
          // Auto-detect plate region (center 40% of image)
          const centerX = img.width * 0.3;
          const centerY = img.height * 0.3;
          const width = img.width * 0.4;
          const height = img.height * 0.4;
          region = { x: centerX, y: centerY, width, height };
        }

        // Set canvas size to cropped dimensions
        canvas.width = region.width;
        canvas.height = region.height;

        // Draw cropped image
        ctx.drawImage(
          img,
          region.x,
          region.y,
          region.width,
          region.height,
          0,
          0,
          region.width,
          region.height
        );

        // Convert to blob with compression
        canvas.toBlob(
          async (blob) => {
            if (!blob) {
              reject(new Error('Failed to create blob'));
              return;
            }

            // Create file from blob
            const croppedFile = new File(
              [blob],
              `cropped_${file.name}`,
              { type: 'image/jpeg' }
            );

            // Calculate hash
            const hash = await calculateFileHash(croppedFile);

            // Create object URL
            const url = URL.createObjectURL(croppedFile);

            resolve({
              file: croppedFile,
              hash,
              width: region.width,
              height: region.height,
              url,
            });
          },
          'image/jpeg',
          0.85 // Quality
        );
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };

    img.src = URL.createObjectURL(file);
  });
}

/**
 * Detect plate region in image using simple edge detection
 */
export async function detectPlateRegion(file: File): Promise<CropRegion | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      resolve(null);
      return;
    }

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      // Simple heuristic: look for rectangular region in center-bottom half
      // In production, you'd use proper computer vision or AI detection
      const plateAspectRatio = 3.5; // Typical NZ plate aspect ratio
      const estimatedHeight = img.height * 0.15; // Plates are typically 15% of image height
      const estimatedWidth = estimatedHeight * plateAspectRatio;

      const x = (img.width - estimatedWidth) / 2;
      const y = img.height * 0.6; // Lower 40% of image

      resolve({
        x: Math.max(0, x),
        y: Math.max(0, y),
        width: Math.min(estimatedWidth, img.width),
        height: Math.min(estimatedHeight, img.height),
      });
    };

    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Add GPS and timestamp watermark to image (COURT-READY EVIDENCE)
 * Adds visible overlay with GPS coordinates, timestamp, officer info, zone name, and organization
 */
export async function addGPSWatermark(
  file: File,
  gpsData: { latitude: number; longitude: number; accuracy?: number } | null,
  metadata: {
    timestamp?: Date;
    officerName?: string;
    zoneName?: string;
    organizationName?: string;
    plateNumber?: string;
  } = {}
): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Canvas context not available'));
      return;
    }

    img.onload = () => {
      try {
        canvas.width = img.width;
        canvas.height = img.height;

        // Draw original image
        ctx.drawImage(img, 0, 0);

        // Watermark styling - Dynamic sizing based on image resolution
        const baseFontSize = Math.max(16, Math.floor(img.height * 0.020)); // 2% of height
        const padding = baseFontSize;
        const lineHeight = baseFontSize + 6;
        
        // Timestamp
        const timestamp = metadata.timestamp || new Date();
        const dateStr = timestamp.toLocaleDateString('en-NZ', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        });
        const timeStr = timestamp.toLocaleTimeString('en-NZ', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });

        // GPS Coordinates
        let gpsText = 'GPS: NOT AVAILABLE';
        if (gpsData) {
          const lat = gpsData.latitude.toFixed(6);
          const lng = gpsData.longitude.toFixed(6);
          const acc = gpsData.accuracy ? ` ±${Math.round(gpsData.accuracy)}m` : '';
          gpsText = `GPS: ${lat}, ${lng}${acc}`;
        }

        // Build watermark lines (bottom to top)
        const watermarkLines: string[] = [];
        
        // Line 1 (bottom): GPS + Plate Number
        if (metadata.plateNumber) {
          watermarkLines.push(`${gpsText} | PLATE: ${metadata.plateNumber}`);
        } else {
          watermarkLines.push(gpsText);
        }
        
        // Line 2: Date + Time
        watermarkLines.push(`${dateStr} ${timeStr} NZST`);
        
        // Line 3: Zone + Organization
        if (metadata.zoneName && metadata.organizationName) {
          watermarkLines.push(`${metadata.zoneName} | ${metadata.organizationName}`);
        } else if (metadata.zoneName) {
          watermarkLines.push(`ZONE: ${metadata.zoneName}`);
        } else if (metadata.organizationName) {
          watermarkLines.push(metadata.organizationName);
        }
        
        // Line 4 (top): Officer Name
        if (metadata.officerName) {
          watermarkLines.push(`OFFICER: ${metadata.officerName}`);
        }

        // Calculate total height needed
        const totalLines = watermarkLines.length;
        const totalHeight = (totalLines * lineHeight) + (padding * 2);
        const startY = img.height - padding;

        // Draw semi-transparent black background bar
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(0, img.height - totalHeight, img.width, totalHeight);

        // Configure text rendering for maximum readability
        ctx.font = `bold ${baseFontSize}px monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        
        // Shadow for text depth
        ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;

        // Draw each line (bottom to top)
        watermarkLines.forEach((line, index) => {
          const yPosition = startY - (index * lineHeight);
          
          // Use yellow for GPS line (most critical)
          if (index === 0) {
            ctx.fillStyle = '#FFFF00'; // Pure yellow for GPS
          }
          // Use green for timestamp (second most critical)
          else if (index === 1) {
            ctx.fillStyle = '#00FF00'; // Pure green for timestamp
          }
          // Use white for metadata
          else {
            ctx.fillStyle = '#FFFFFF';
          }
          
          ctx.fillText(line, padding, yPosition);
        });

        // Add court-ready indicator (top right corner)
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.font = `bold ${Math.floor(baseFontSize * 0.8)}px monospace`;
        ctx.textAlign = 'right';
        ctx.fillStyle = '#FF0000'; // Red for importance
        const courtReadyText = '🔒 COURT EVIDENCE';
        ctx.fillText(courtReadyText, img.width - padding, padding + baseFontSize);
        ctx.restore();

        // Convert to blob with high quality
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Failed to create watermarked blob'));
              return;
            }
            const watermarkedFile = new File([blob], file.name, { type: 'image/jpeg' });
            resolve(watermarkedFile);
          },
          'image/jpeg',
          0.95 // High quality for evidence
        );
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Compress image for storage
 */
export async function compressImage(
  file: File,
  maxWidth: number = 1920,
  maxHeight: number = 1080,
  quality: number = 0.85
): Promise<ProcessedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Canvas context not available'));
      return;
    }

    img.onload = async () => {
      try {
        // Calculate scaled dimensions
        let { width, height } = img;
        
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = width * ratio;
          height = height * ratio;
        }

        canvas.width = width;
        canvas.height = height;

        // Draw scaled image
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to blob
        canvas.toBlob(
          async (blob) => {
            if (!blob) {
              reject(new Error('Failed to create blob'));
              return;
            }

            const compressedFile = new File(
              [blob],
              `compressed_${file.name}`,
              { type: 'image/jpeg' }
            );

            const hash = await calculateFileHash(compressedFile);
            const url = URL.createObjectURL(compressedFile);

            resolve({
              file: compressedFile,
              hash,
              width,
              height,
              url,
            });
          },
          'image/jpeg',
          quality
        );
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Process evidence photo: auto-crop plate region and compress
 */
export async function processEvidencePhoto(file: File): Promise<{
  cropped: ProcessedImage;
  full: ProcessedImage;
}> {
  // Detect plate region
  const plateRegion = await detectPlateRegion(file);

  // Crop to plate region
  const cropped = await cropImage(file, plateRegion || undefined);

  // Compress full image
  const full = await compressImage(file);

  return { cropped, full };
}

/**
 * Batch process multiple photos
 */
export async function batchProcessPhotos(
  files: File[],
  onProgress?: (current: number, total: number) => void
): Promise<Array<{ cropped: ProcessedImage; full: ProcessedImage }>> {
  const results: Array<{ cropped: ProcessedImage; full: ProcessedImage }> = [];

  for (let i = 0; i < files.length; i++) {
    const processed = await processEvidencePhoto(files[i]);
    results.push(processed);
    onProgress?.(i + 1, files.length);
  }

  return results;
}

/**
 * Upload photo to Supabase Storage with metadata tracking
 */
export async function uploadPhotoWithMetadata(
  supabase: any,
  bucket: string,
  photo: ProcessedImage,
  metadata: {
    userId: string;
    organizationId: string;
    photoType: 'cropped' | 'full' | 'evidence';
    incidentId?: string;
    vehicleRecordId?: string;
    observationId?: string;
    gpsLatitude?: number;
    gpsLongitude?: number;
    gpsAccuracy?: number;
    courtReady?: boolean;
    retentionPolicy?: 'standard' | 'court_ready' | 'permanent' | 'temporary';
  }
): Promise<{ url: string; metadataId: string }> {
  // Upload to storage
  const fileName = `${metadata.userId}/${Date.now()}_${metadata.photoType}_${photo.hash.slice(0, 8)}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(fileName, photo.file);

  if (uploadError) throw uploadError;

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from(bucket)
    .getPublicUrl(fileName);

  // Create photo metadata record
  const { data: metadataRecord, error: metadataError } = await supabase
    .from('photo_metadata')
    .insert({
      photo_url: publicUrl,
      file_name: photo.file.name,
      bucket_name: bucket,
      storage_path: fileName,
      photo_hash: photo.hash,
      photo_type: metadata.photoType,
      file_size_bytes: photo.file.size,
      width: photo.width,
      height: photo.height,
      mime_type: photo.file.type,
      organization_id: metadata.organizationId,
      user_id: metadata.userId,
      incident_id: metadata.incidentId,
      vehicle_record_id: metadata.vehicleRecordId,
      observation_id: metadata.observationId,
      gps_latitude: metadata.gpsLatitude,
      gps_longitude: metadata.gpsLongitude,
      gps_accuracy: metadata.gpsAccuracy,
      court_ready: metadata.courtReady || false,
      retention_policy: metadata.retentionPolicy || 'standard',
    })
    .select()
    .single();

  if (metadataError) throw metadataError;

  return { url: publicUrl, metadataId: metadataRecord.id };
}
