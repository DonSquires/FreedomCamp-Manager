/**
 * File Upload Utilities
 * 
 * Centralized file upload helpers for Supabase Storage.
 * Supports two upload methods:
 * 1. Server-side (via Edge Function) - RECOMMENDED
 * 2. Direct client-side - Fallback option
 */

import { supabase } from './supabase';

// Bucket configuration
export const BUCKET_RULES = {
  evidence: {
    maxMB: 10,
    allowedTypes: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'text/csv',
    ],
    isPublic: true,
  },
  'incident-evidence': {
    maxMB: 10,
    allowedTypes: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'application/pdf',
    ],
    isPublic: false,
  },
} as const;

export type BucketName = keyof typeof BUCKET_RULES;

export interface UploadResult {
  bucket: string;
  path: string;
  url: string;
  size?: number;
  type?: string;
}

/**
 * Validate file before upload
 */
function validateFile(file: File, bucket: BucketName): void {
  const rules = BUCKET_RULES[bucket];
  const maxBytes = rules.maxMB * 1024 * 1024;

  if (file.size > maxBytes) {
    throw new Error(`File exceeds ${rules.maxMB} MB limit`);
  }

  if (!rules.allowedTypes.includes(file.type)) {
    throw new Error(
      `Unsupported file type: ${file.type}. Allowed types: ${rules.allowedTypes.join(', ')}`
    );
  }
}

/**
 * Get current authenticated session
 */
async function requireSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('User not authenticated');
  }
  return session;
}

/**
 * SERVER-SIDE UPLOAD (RECOMMENDED)
 * 
 * Uploads file via Edge Function with server-side validation.
 * Bypasses CORS issues and centralizes security rules.
 * Uses Supabase SDK for automatic JWT auth handling.
 * 
 * @param bucket - Target bucket ('evidence' or 'incident-evidence')
 * @param file - File object from <input type="file">
 * @returns Upload result with URL
 */
export async function uploadViaFunction(
  bucket: BucketName,
  file: File
): Promise<UploadResult> {
  // Client-side pre-validation (fast fail)
  validateFile(file, bucket);

  await requireSession();

  // Use Supabase SDK for automatic auth header injection
  // Note: functions.invoke() doesn't support FormData, so we use raw fetch with proper headers
  const formData = new FormData();
  formData.append('file', file);

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('User not authenticated');
  }

  const url = `${supabase.supabaseUrl}/functions/v1/upload-file/${bucket}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      // Note: Don't set Content-Type - browser sets it automatically with boundary for multipart/form-data
    },
    body: formData,
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMessage = json.error || `Upload failed (${response.status})`;
    console.error('Upload via function failed:', { status: response.status, error: json });
    throw new Error(errorMessage);
  }

  return json as UploadResult;
}

/**
 * DIRECT CLIENT-SIDE UPLOAD (FALLBACK)
 * 
 * Uploads directly to Supabase Storage from browser.
 * Requires proper CORS configuration in Supabase Dashboard.
 * 
 * @param bucket - Target bucket
 * @param file - File object
 * @param userId - Current user ID
 * @returns Upload result with URL
 */
export async function uploadDirect(
  bucket: BucketName,
  file: File,
  userId: string
): Promise<UploadResult> {
  validateFile(file, bucket);

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${userId}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadError) {
    console.error('Direct upload error:', uploadError);
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  const rules = BUCKET_RULES[bucket];
  let url: string;

  if (rules.isPublic) {
    // Public bucket - get public URL
    const { data: publicUrlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(path);
    
    url = publicUrlData.publicUrl;
  } else {
    // Private bucket - get 10-minute signed URL
    const { data: signedData, error: signError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 60 * 10);

    if (signError) {
      console.error('Signed URL error:', signError);
      throw new Error(`Failed to generate signed URL: ${signError.message}`);
    }

    url = signedData.signedUrl;
  }

  return {
    bucket,
    path,
    url,
    size: file.size,
    type: file.type,
  };
}

/**
 * RECOMMENDED: Upload evidence (public)
 */
export async function uploadEvidence(file: File): Promise<UploadResult> {
  return uploadViaFunction('evidence', file);
}

/**
 * RECOMMENDED: Upload incident evidence (private)
 */
export async function uploadIncidentEvidence(file: File): Promise<UploadResult> {
  return uploadViaFunction('incident-evidence', file);
}

/**
 * FALLBACK: Direct upload evidence (requires CORS config)
 */
export async function uploadEvidenceDirect(
  file: File,
  userId: string
): Promise<UploadResult> {
  return uploadDirect('evidence', file, userId);
}

/**
 * FALLBACK: Direct upload incident evidence (requires CORS config)
 */
export async function uploadIncidentEvidenceDirect(
  file: File,
  userId: string
): Promise<UploadResult> {
  return uploadDirect('incident-evidence', file, userId);
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Get file type icon
 */
export function getFileTypeIcon(type: string): string {
  if (type.startsWith('image/')) return '🖼️';
  if (type === 'application/pdf') return '📄';
  if (type.includes('spreadsheet') || type === 'text/csv') return '📊';
  return '📎';
}

/**
 * Validate image dimensions (optional constraint)
 */
export async function validateImageDimensions(
  file: File,
  maxWidth?: number,
  maxHeight?: number
): Promise<{ width: number; height: number }> {
  if (!file.type.startsWith('image/')) {
    throw new Error('File is not an image');
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      
      if (maxWidth && img.width > maxWidth) {
        reject(new Error(`Image width exceeds ${maxWidth}px`));
        return;
      }
      
      if (maxHeight && img.height > maxHeight) {
        reject(new Error(`Image height exceeds ${maxHeight}px`));
        return;
      }

      resolve({ width: img.width, height: img.height });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}
