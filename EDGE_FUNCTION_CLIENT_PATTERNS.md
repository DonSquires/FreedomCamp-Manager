# Edge Function Client Integration Patterns

**Date:** Feb 22, 2026  
**Status:** ✅ PRODUCTION STANDARD

---

## 🎯 Quick Reference

### ✅ RECOMMENDED: Use Supabase SDK

```typescript
import { supabase } from '@/lib/supabase';

// JSON payloads (most Edge Functions)
const { data, error } = await supabase.functions.invoke('vehicle-ingest', {
  body: {
    plateText: 'ABC123',
    imageUrl: 'https://...',
    metadata: { /* ... */ }
  }
});

if (error) {
  console.error('Function error:', error);
  throw new Error(error.message);
}

console.log('Success:', data);
```

### ⚠️ EXCEPTION: FormData Uploads

```typescript
import { supabase } from '@/lib/supabase';

// For multipart/form-data only (file uploads)
const { data: { session } } = await supabase.auth.getSession();
if (!session) throw new Error('Not authenticated');

const formData = new FormData();
formData.append('file', file);

const response = await fetch(
  `${supabase.supabaseUrl}/functions/v1/upload-file/evidence`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      // ⚠️ Don't set Content-Type - browser adds boundary automatically
    },
    body: formData,
  }
);

const json = await response.json();
if (!response.ok) throw new Error(json.error);
```

---

## 📋 Why Use SDK Instead of Raw Fetch?

| Feature | Supabase SDK | Raw `fetch()` |
|---------|--------------|---------------|
| **JWT Auto-Injection** | ✅ Automatic | ❌ Manual `Bearer ${token}` |
| **Accept Header** | ✅ Auto-set to `application/json` | ❌ Must set manually |
| **Error Handling** | ✅ Typed error object | ❌ Manual parsing |
| **CORS** | ✅ Handled by SDK | ⚠️ Requires manual headers |
| **Session Refresh** | ✅ Auto-refreshes tokens | ❌ Manual refresh logic |
| **Type Safety** | ✅ TypeScript types | ❌ Manual types |

---

## 🚀 Complete Examples

### Example 1: Vehicle Ingest (JSON Payload)

**❌ BAD: Raw Fetch (Error-Prone)**
```typescript
const response = await fetch(
  'https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/vehicle-ingest',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`, // ❌ Manually managed token
      'Accept': 'application/json', // ❌ Easy to forget
      'apikey': process.env.VITE_SUPABASE_ANON_KEY!, // ❌ Exposed key
    },
    body: JSON.stringify(payload),
  }
);

const json = await response.json(); // ❌ No error handling
```

**✅ GOOD: Supabase SDK (Robust)**
```typescript
import { supabase } from '@/lib/supabase';

const { data, error } = await supabase.functions.invoke('vehicle-ingest', {
  body: {
    plateText: 'ABC123',
    imageUrl: photoUrl,
    metadata: {
      gpsLatitude: -43.53,
      gpsLongitude: 172.63,
      recordedAt: new Date().toISOString(),
    }
  }
});

if (error) {
  console.error('Vehicle ingest failed:', error);
  throw new Error(error.message);
}

console.log('Observation created:', data.observationId);
```

---

### Example 2: File Upload (FormData Exception)

**Why Raw Fetch:** `supabase.functions.invoke()` doesn't support `FormData` body type.

**✅ CORRECT Pattern:**
```typescript
import { supabase } from '@/lib/supabase';

async function uploadEvidence(file: File): Promise<string> {
  // 1. Validate session
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('User not authenticated');
  }

  // 2. Prepare FormData
  const formData = new FormData();
  formData.append('file', file);

  // 3. Call Edge Function with raw fetch (required for FormData)
  const response = await fetch(
    `${supabase.supabaseUrl}/functions/v1/upload-file/evidence`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        // ⚠️ IMPORTANT: Don't set Content-Type for FormData
        // Browser automatically sets: multipart/form-data; boundary=----...
      },
      body: formData,
    }
  );

  // 4. Parse response
  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error('Upload failed:', { status: response.status, error: json });
    throw new Error(json.error || `Upload failed (${response.status})`);
  }

  return json.url;
}
```

---

### Example 3: CSV Export (Binary Response)

**Why Raw Fetch:** Need to handle non-JSON response (CSV file download).

**✅ CORRECT Pattern:**
```typescript
import { supabase } from '@/lib/supabase';

async function exportObservationsCSV(filters: any): Promise<void> {
  // 1. Validate session
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('User not authenticated');
  }

  // 2. Call Edge Function with raw fetch (need Blob response)
  const response = await fetch(
    `${supabase.supabaseUrl}/functions/v1/observations-export`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'text/csv', // ✅ Specify CSV response
      },
      body: JSON.stringify(filters),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Export failed: ${error}`);
  }

  // 3. Trigger browser download
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'observations.csv';
  a.click();
  URL.revokeObjectURL(url);
}
```

---

### Example 4: Error Handling Best Practices

```typescript
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

async function createIncidentReport(payload: any) {
  try {
    const { data, error } = await supabase.functions.invoke('create-incident', {
      body: payload
    });

    if (error) {
      console.error('Incident creation failed:', error);
      
      // Check for specific error types
      if (error.message?.includes('Unauthorized')) {
        toast.error('Session expired. Please log in again.');
        // Redirect to login
        return;
      }
      
      if (error.message?.includes('validation')) {
        toast.error('Invalid incident data. Please check your inputs.');
        return;
      }
      
      // Generic error
      toast.error(error.message || 'Failed to create incident report');
      return;
    }

    // Success
    toast.success('Incident report created successfully');
    console.log('Incident ID:', data.incidentId);
    
  } catch (err: any) {
    console.error('Unexpected error:', err);
    toast.error('An unexpected error occurred');
  }
}
```

---

## 🔍 Decision Tree

```
┌─────────────────────────────────┐
│  Need to call Edge Function?    │
└────────────┬────────────────────┘
             │
             ▼
     ┌───────────────────┐
     │ What's the body?  │
     └───────┬───────────┘
             │
     ┌───────┴────────┐
     │                │
     ▼                ▼
┌─────────┐    ┌──────────────┐
│  JSON   │    │  FormData    │
│ Object  │    │  or Binary   │
└────┬────┘    └──────┬───────┘
     │                │
     ▼                ▼
┌──────────────────┐  ┌──────────────────┐
│ USE SDK:         │  │ USE RAW FETCH:   │
│                  │  │                  │
│ supabase         │  │ fetch(url, {     │
│  .functions      │  │   headers: {     │
│  .invoke('fn', { │  │     Authorization│
│    body: {...}   │  │   },             │
│  })              │  │   body: formData │
│                  │  │ })               │
└──────────────────┘  └──────────────────┘
```

---

## 🧪 Testing Checklist

### Unit Tests
- [ ] Function invocation with valid payload → success
- [ ] Function invocation without auth → 401 error
- [ ] Function invocation with invalid payload → 400 error
- [ ] Error object contains message and correlation ID

### Integration Tests
- [ ] SDK auto-injects JWT token (inspect Network tab)
- [ ] Session refresh works seamlessly (test after 1 hour)
- [ ] CORS headers present in response
- [ ] Error responses include CORS headers

### Manual Tests
```bash
# Test with curl (simulate SDK behavior)
curl -i -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "apikey: <anon-key>" \
  -d '{"plateText": "ABC123"}' \
  https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/vehicle-ingest
```

---

## ⚠️ Common Pitfalls

### 1. Setting Content-Type for FormData
```typescript
// ❌ WRONG: Browser can't set boundary
headers: {
  'Content-Type': 'multipart/form-data', // ❌ Missing boundary
}

// ✅ CORRECT: Let browser set it automatically
headers: {
  'Authorization': `Bearer ${token}`,
  // No Content-Type header
}
```

### 2. Not Checking Error Before Using Data
```typescript
// ❌ WRONG: Data might be undefined
const { data, error } = await supabase.functions.invoke('fn', { body });
console.log(data.result); // ❌ Error if error exists

// ✅ CORRECT: Check error first
const { data, error } = await supabase.functions.invoke('fn', { body });
if (error) {
  console.error(error);
  return;
}
console.log(data.result); // ✅ Safe
```

### 3. Using Raw Fetch for JSON Payloads
```typescript
// ❌ WRONG: Manual token management
const response = await fetch(url, {
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify(payload),
});

// ✅ CORRECT: SDK handles auth automatically
const { data, error } = await supabase.functions.invoke('fn', { body: payload });
```

### 4. Not Handling 401 Unauthorized
```typescript
// ❌ WRONG: No session expiry handling
const { data, error } = await supabase.functions.invoke('fn', { body });
if (error) toast.error(error.message);

// ✅ CORRECT: Detect expired session
const { data, error } = await supabase.functions.invoke('fn', { body });
if (error) {
  if (error.message?.includes('Unauthorized')) {
    // Redirect to login
    window.location.href = '/login';
  } else {
    toast.error(error.message);
  }
}
```

---

## 📊 Performance Tips

1. **Avoid Parallel Auth Checks:**
   ```typescript
   // ❌ WRONG: Multiple session checks
   const { data: { session } } = await supabase.auth.getSession();
   const result1 = await callFunction1(session.access_token);
   const { data: { session: session2 } } = await supabase.auth.getSession();
   const result2 = await callFunction2(session2.access_token);

   // ✅ CORRECT: Reuse session
   const { data: { session } } = await supabase.auth.getSession();
   const [result1, result2] = await Promise.all([
     callFunction1(session.access_token),
     callFunction2(session.access_token),
   ]);
   ```

2. **Cache Session for Batch Operations:**
   ```typescript
   const { data: { session } } = await supabase.auth.getSession();
   const token = session?.access_token;

   const uploads = files.map(file => uploadFile(file, token));
   await Promise.all(uploads);
   ```

3. **Use SDK for Auto-Refresh:**
   ```typescript
   // SDK automatically refreshes expired tokens
   const { data, error } = await supabase.functions.invoke('fn', { body });
   // No manual refresh logic needed
   ```

---

## ✅ Production Checklist

- [ ] All JSON Edge Function calls use `supabase.functions.invoke()`
- [ ] FormData uploads use raw `fetch()` with proper auth headers
- [ ] CSV exports use raw `fetch()` with Accept header
- [ ] Error responses checked before accessing data
- [ ] 401 errors trigger login redirect
- [ ] Network errors show user-friendly messages
- [ ] CORS headers present in all responses
- [ ] Session refresh tested (wait 1 hour, retry request)

---

**Document Version:** 1.0  
**Status:** APPROVED FOR PRODUCTION  
**Maintainer:** Tech Team
