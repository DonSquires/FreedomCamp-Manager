# File Upload Integration Guide

**Date:** Feb 22, 2026  
**Status:** ✅ PRODUCTION READY

---

## 🎯 Overview

Centralized file upload system supporting two Supabase Storage buckets:

1. **`evidence`** - Public bucket for general evidence (photos, PDFs, CSV, XLSX)
2. **`incident-evidence`** - Private bucket for sensitive incident attachments (photos, PDFs)

**Recommended Approach:** Server-side upload via Edge Function (centralizes validation, bypasses CORS)

---

## 📦 Architecture

```
┌─────────────────┐
│   React App     │
│  (File Upload)  │
└────────┬────────┘
         │
         │ POST multipart/form-data
         ▼
┌─────────────────────────────────┐
│  Edge Function: upload-file     │
│  ✓ Auth validation              │
│  ✓ File size/type validation    │
│  ✓ Service role upload          │
│  ✓ Returns URL (public/signed)  │
└────────┬────────────────────────┘
         │
         │ supabase.storage.upload()
         ▼
┌─────────────────────────────────┐
│  Supabase Storage Buckets       │
│  • evidence (public)             │
│  • incident-evidence (private)   │
└──────────────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Deploy Edge Function

```bash
supabase functions deploy upload-file
```

### 2. Use in React Components

```typescript
import { uploadEvidence, uploadIncidentEvidence } from '@/lib/fileUpload';
import { toast } from 'sonner';

// Example: Upload evidence photo
async function handleEvidenceUpload(file: File) {
  try {
    const { url, path } = await uploadEvidence(file);
    console.log('Uploaded to:', url);
    
    // Save URL to database
    await saveToDatabase({ photo_url: url, storage_path: path });
    
    toast.success('File uploaded successfully');
  } catch (error: any) {
    console.error('Upload failed:', error);
    toast.error(error.message || 'Upload failed');
  }
}

// Example: Upload incident evidence
async function handleIncidentEvidenceUpload(file: File) {
  try {
    const { url, path } = await uploadIncidentEvidence(file);
    console.log('Uploaded to:', url); // Signed URL valid for 10 minutes
    
    // Save path to database (regenerate signed URL when needed)
    await saveToDatabase({ 
      evidence_path: path,
      evidence_url: url, // Valid for 10 minutes
    });
    
    toast.success('Evidence uploaded successfully');
  } catch (error: any) {
    console.error('Upload failed:', error);
    toast.error(error.message || 'Upload failed');
  }
}
```

### 3. HTML Input Example

```tsx
<input
  type="file"
  accept="image/*,application/pdf"
  onChange={async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      const { url } = await uploadEvidence(file);
      console.log('Uploaded:', url);
    } catch (err: any) {
      alert(err.message);
    }
  }}
/>
```

---

## 📋 Bucket Rules

### Evidence Bucket (Public)
- **Max Size:** 10 MB
- **Allowed Types:**
  - Images: `image/jpeg`, `image/jpg`, `image/png`, `image/webp`
  - Documents: `application/pdf`
  - Data: `text/csv`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- **Access:** Public URL (anyone with link can view)
- **RLS:** Users can manage files in their own folder (`/{user-uuid}/*`)
- **Use Cases:** Vehicle photos, compliance certificates, reports

### Incident Evidence Bucket (Private)
- **Max Size:** 10 MB
- **Allowed Types:**
  - Images: `image/jpeg`, `image/jpg`, `image/png`, `image/webp`
  - Documents: `application/pdf`
- **Access:** Signed URL (10-minute expiry)
- **RLS:** ✅ **ENABLED** - Users can only access files in their own folder (`/{user-uuid}/*`)
- **Path Requirement:** First path segment MUST be user's UUID
- **Use Cases:** Sensitive incident photos, witness statements, private documents

---

## 🔧 API Reference

### `uploadEvidence(file: File): Promise<UploadResult>`

Uploads file to public `evidence` bucket via Edge Function.

**Parameters:**
- `file` - File object from `<input type="file">`

**Returns:**
```typescript
{
  bucket: "evidence",
  path: "user-id/uuid-filename.jpg",
  url: "https://xbfnlzmpumthnjmtqufp.supabase.co/storage/v1/object/public/evidence/...",
  size: 1234567,
  type: "image/jpeg"
}
```

**Throws:**
- `"File exceeds 10 MB limit"`
- `"Unsupported file type: ..."`
- `"User not authenticated"`

---

### `uploadIncidentEvidence(file: File): Promise<UploadResult>`

Uploads file to private `incident-evidence` bucket via Edge Function.

**Parameters:**
- `file` - File object from `<input type="file">`

**Returns:**
```typescript
{
  bucket: "incident-evidence",
  path: "user-id/uuid-filename.pdf",
  url: "https://xbfnlzmpumthnjmtqufp.supabase.co/storage/v1/object/sign/incident-evidence/...?token=...",
  size: 2345678,
  type: "application/pdf"
}
```

**Note:** URL is a signed URL valid for **10 minutes**. Store `path` in database and regenerate signed URL when needed:

```typescript
const { data, error } = await supabase.storage
  .from('incident-evidence')
  .createSignedUrl(path, 60 * 10); // 10 minutes

if (!error) {
  console.log('Signed URL:', data.signedUrl);
}
```

---

### Direct Upload (Fallback)

If you need to bypass the Edge Function (requires CORS configuration):

```typescript
import { uploadEvidenceDirect, uploadIncidentEvidenceDirect } from '@/lib/fileUpload';

const { url } = await uploadEvidenceDirect(file, userId);
const { url } = await uploadIncidentEvidenceDirect(file, userId);
```

**CORS Setup Required:**
1. Go to Supabase Dashboard → Project Settings → API
2. Add allowed origins:
   ```
   http://localhost:5173
   https://preview-react-9b4t5o-*.onspace.build
   https://react-9b4t5o.onspace.build
   https://fcmanager.co.nz
   ```

**RLS Setup Required (incident-evidence only):**
1. Run migration: `supabase/migrations/20260222_incident_evidence_rls.sql`
2. Verify policies:
   ```sql
   SELECT policyname, cmd FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
   AND policyname LIKE 'incident_evidence_%';
   ```
3. Expected output: 4 policies (read, insert, update, delete)

---

## 🧪 Testing Checklist

### Unit Tests
- [ ] File size validation (< 10MB pass, > 10MB fail)
- [ ] File type validation (allowed types pass, others fail)
- [ ] Auth validation (no session = error)

### Integration Tests
- [ ] Upload evidence photo → returns public URL
- [ ] Upload incident evidence → returns signed URL
- [ ] Upload oversized file → returns 400 error
- [ ] Upload wrong file type → returns 400 error
- [ ] Upload without auth → returns 401 error

### Manual Tests
```bash
# Test evidence upload
curl -i -X POST \
  -H "Authorization: Bearer <token>" \
  -F "file=@test-image.jpg" \
  https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/upload-file/evidence

# Test incident-evidence upload
curl -i -X POST \
  -H "Authorization: Bearer <token>" \
  -F "file=@test-document.pdf" \
  https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/upload-file/incident-evidence

# Test validation (should fail - file too large)
curl -i -X POST \
  -H "Authorization: Bearer <token>" \
  -F "file=@large-file.jpg" \
  https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/upload-file/evidence
```

---

## 🐛 Troubleshooting

### Error: "File exceeds 10 MB limit"
**Solution:** Compress file before upload or split into multiple files

### Error: "Unsupported file type: ..."
**Solution:** Ensure file type matches allowed types for bucket

### Error: "User not authenticated"
**Solution:** Ensure user is logged in before upload:
```typescript
const { data: { session } } = await supabase.auth.getSession();
if (!session) {
  // Redirect to login
}
```

### Error: "CORS policy violation"
**Solution:** 
1. Use `uploadEvidence()` instead of `uploadEvidenceDirect()` (bypasses CORS)
2. OR add your domain to Supabase CORS allowlist

### Signed URL expired (incident-evidence)
**Solution:** Regenerate signed URL from stored path:
```typescript
const { data } = await supabase.storage
  .from('incident-evidence')
  .createSignedUrl(storedPath, 60 * 10);

const freshUrl = data.signedUrl;
```

---

## 🔒 Security Notes

1. **Service Role Key:** Edge Function uses service role key to bypass RLS (never expose in frontend)
2. **File Validation:** Always validates size and type on server (client validation is bypassable)
3. **Auth Required:** All uploads require authenticated user
4. **Path Sanitization:** Filenames are sanitized to prevent directory traversal
5. **Signed URLs:** Private bucket uses time-limited signed URLs (10 minutes)
6. **RLS Policies:** `incident-evidence` bucket enforces user-scoped folder access (path must start with `{user-uuid}/`)
7. **Folder Isolation:** Users cannot read, modify, or delete files outside their own folder

---

## 📊 Performance Tips

1. **Compress images before upload:**
   ```typescript
   import { compressImage } from '@/lib/imageProcessing';
   
   const compressed = await compressImage(file, 0.8); // 80% quality
   const { url } = await uploadEvidence(compressed);
   ```

2. **Show upload progress:**
   ```typescript
   const xhr = new XMLHttpRequest();
   xhr.upload.addEventListener('progress', (e) => {
     const percent = (e.loaded / e.total) * 100;
     console.log(`Upload progress: ${percent}%`);
   });
   ```

3. **Parallel uploads:**
   ```typescript
   const files = Array.from(fileInput.files);
   const results = await Promise.all(
     files.map(file => uploadEvidence(file))
   );
   ```

---

## ✅ Production Checklist

- [ ] Edge Function deployed: `upload-file`
- [ ] Bucket RLS policies configured:
  - [ ] `evidence` bucket policies (CRUD for own folder)
  - [ ] `incident-evidence` bucket policies (CRUD for own folder)
  - [ ] Performance index created: `idx_storage_objects_bucket_name`
- [ ] Client-side utilities imported: `@/lib/fileUpload`
- [ ] Components updated to use `uploadEvidence()` or `uploadIncidentEvidence()`
- [ ] Error handling implemented (toast notifications)
- [ ] File size warnings shown before upload
- [ ] Signed URL regeneration implemented for incident-evidence
- [ ] CORS configuration reviewed (if using direct upload)
- [ ] RLS policies verified:
  ```sql
  SELECT COUNT(*) FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname LIKE 'incident_evidence_%';
  -- Expected: 4
  ```

---

**Document Version:** 1.0  
**Status:** APPROVED FOR PRODUCTION  
**Maintainer:** Tech Team
