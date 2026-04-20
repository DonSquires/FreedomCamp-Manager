/**
 * Upload File Edge Function
 * 
 * Centralized file upload handler with validation and storage management.
 * Supports two buckets:
 * - evidence: Public bucket (max 10MB, images + PDF + CSV + XLSX)
 * - incident-evidence: Private bucket (max 10MB, images + PDF)
 * 
 * Usage:
 * POST /upload-file/evidence
 * POST /upload-file/incident-evidence
 * 
 * Body: multipart/form-data with 'file' field
 * 
 * Response:
 * {
 *   "bucket": "evidence",
 *   "path": "user-id/uuid-filename.jpg",
 *   "url": "https://..." // public URL or signed URL
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts';

// File validation rules per bucket
const BUCKET_RULES = {
  'evidence': {
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
};

function sanitizeFilename(filename: string): string {
  // Remove unsafe characters, keep only alphanumeric, dots, dashes, underscores
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

Deno.serve(withCors(async (req) => {
  // Extract bucket from URL path: /upload-file/{bucket}
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const bucket = pathParts[pathParts.length - 1] as keyof typeof BUCKET_RULES;

  // Validate bucket
  if (!bucket || !BUCKET_RULES[bucket]) {
    return errorResponse(
      `Invalid bucket. Must be one of: ${Object.keys(BUCKET_RULES).join(', ')}`,
      req,
      400
    );
  }

  // Validate auth
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return errorResponse('Missing authorization header', req, 401);
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }
  );

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

  if (userError || !user) {
    return errorResponse('Unauthorized', req, 401);
  }

  // Parse multipart/form-data
  const contentType = req.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return errorResponse('Content-Type must be multipart/form-data', req, 415);
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    console.error('Failed to parse form data:', err);
    return errorResponse('Invalid form data', req, 400);
  }

  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return errorResponse('Missing file in form data', req, 400);
  }

  // Validate file
  const rules = BUCKET_RULES[bucket];
  const maxBytes = rules.maxMB * 1024 * 1024;

  if (file.size > maxBytes) {
    return errorResponse(`File exceeds ${rules.maxMB} MB limit`, req, 400);
  }

  if (!rules.allowedTypes.includes(file.type)) {
    return errorResponse(
      `Unsupported file type: ${file.type}. Allowed: ${rules.allowedTypes.join(', ')}`,
      req,
      400
    );
  }

  // Generate safe storage path
  const safeName = sanitizeFilename(file.name);
  const ext = getFileExtension(safeName);
  const uuid = crypto.randomUUID();
  const path = `${user.id}/${uuid}${ext ? `.${ext}` : ''}`;

  // Upload to storage using service role (bypasses RLS)
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // Convert File to ArrayBuffer for upload
  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  const { error: uploadError } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType: file.type,
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadError) {
    console.error('Storage upload error:', uploadError);
    return errorResponse(
      `Upload failed: ${uploadError.message}`,
      req,
      500,
      { uploadError }
    );
  }

  // Generate appropriate URL
  let url: string;

  if (rules.isPublic) {
    // Public bucket - return public URL
    const { data: publicUrlData } = supabaseAdmin.storage
      .from(bucket)
      .getPublicUrl(path);
    
    url = publicUrlData.publicUrl;
  } else {
    // Private bucket - return 10-minute signed URL
    const { data: signedData, error: signError } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(path, 60 * 10); // 10 minutes

    if (signError) {
      console.error('Signed URL error:', signError);
      return errorResponse(
        `Failed to generate signed URL: ${signError.message}`,
        req,
        500
      );
    }

    url = signedData.signedUrl;
  }

  console.log(`✅ File uploaded: ${bucket}/${path} (${file.size} bytes)`);

  return jsonResponse(
    {
      bucket,
      path,
      url,
      size: file.size,
      type: file.type,
    },
    req
  );
}));
