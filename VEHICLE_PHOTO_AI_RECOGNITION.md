# Vehicle Photo AI Recognition System

## Overview
The FreedomCamp Manager uses **OnSpace AI (Google Gemini 3 Flash)** to automatically recognize vehicle details from uploaded photos. The system does NOT require plate reading - it focuses on vehicle identification.

## How It Works

### 1. Photo Upload Process (VehicleRecords.tsx)

When an admin uploads a photo in edit mode:

```typescript
const handlePhotoUpload = async (file: File) => {
  // 1. Upload photo to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from('evidence')
    .upload(filePath, file);

  // 2. Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('evidence')
    .getPublicUrl(filePath);

  // 3. Automatically analyze photo using AI
  const { data: analysisData } = await supabase.functions.invoke('analyze-vehicle-photo', {
    body: {
      plateNumber: viewingVehicle.plate_number, // Already known
      photoUrl: publicUrl,
    },
  });

  // 4. Auto-populate form fields with AI results
  setEditFormData(prev => ({
    ...prev,
    vehicle_make: analysisData.make || prev.vehicle_make,
    vehicle_model: analysisData.model || prev.vehicle_model,
    vehicle_color: analysisData.color || prev.vehicle_color,
    vehicle_year: analysisData.year || prev.vehicle_year,
  }));
}
```

### 2. AI Vehicle Recognition (analyze-vehicle-photo edge function)

**What it extracts from photos:**
- ✅ Vehicle Make (e.g., Toyota, Ford, Mercedes)
- ✅ Vehicle Model (e.g., Hiace, Transit, Sprinter)
- ✅ Vehicle Color (primary exterior color)
- ✅ Vehicle Year (estimated from design/style)
- ✅ Vehicle Type (car, van, motorhome, campervan, etc.)
- ✅ Self-contained stickers (green/blue NZ stickers)
- ✅ Self-contained capability (based on body style)

**AI Model Used:**
- **google/gemini-3-flash-preview** via OnSpace AI
- Optimized for visual recognition
- Temperature: 0.1 (focused, deterministic)
- Max tokens: 800

**Key Features:**
- 🚫 **Does NOT read license plates** - plate number is already known and passed as parameter
- 🔍 **Focuses on vehicle identification** - make, model, year, color
- 🎯 **Self-contained detection** - looks for green/blue stickers and campervan features
- 📊 **Confidence scoring** - returns 0-100 confidence score
- 🕐 **24-hour deduplication** - won't re-analyze same vehicle within 24 hours

### 3. Best Photo Selection (select-best-vehicle-photo edge function)

Automatically selects the best profile photo from multiple photos using AI scoring:

**Scoring Criteria (0-100):**
- 40 points: License plate clearly visible and readable
- 20 points: Full vehicle in frame
- 15 points: Good lighting and image quality
- 15 points: Front or side angle (preferred over rear)
- 10 points: Minimal obstructions

**Smart Behavior:**
- Only sets profile photo if none exists (sticky behavior)
- Analyzes all photos and ranks them
- Stores score and selection metadata
- Called automatically when multiple photos exist

### 4. Multi-Source Vehicle Enrichment

The system tries multiple data sources in sequence:

```typescript
// 1️⃣ Photo Analysis (AI recognition)
const photoData = await invoke('analyze-vehicle-photo', { 
  plateNumber, photoUrl 
});

// 2️⃣ NZSCV Database (official NZ self-contained certification)
const nzscvData = await invoke('check-nzscv-status', { 
  plateNumber 
});

// 3️⃣ Carjam NZ (comprehensive NZ vehicle registration data)
const carjamData = await scrapeCarjam(plateNumber);

// Combine results from all sources
enrichedData = { ...photoData, ...nzscvData, ...carjamData };
```

## User Experience

### In Vehicle Records Page

1. **Admin clicks "Edit Vehicle"** in vehicle detail modal
2. **Admin uploads photo** via camera or file selection
3. **System automatically:**
   - Uploads photo to storage
   - Analyzes photo with AI
   - Extracts make, model, year, color
   - Auto-fills form fields
   - Shows toast notification of progress
4. **Admin can:**
   - Review auto-filled details
   - Override any field if AI is incorrect
   - Save changes to canonical_vehicles

### In Batch Enrichment (VehicleEnrichmentMaintenance.tsx)

1. **Admin selects vehicles** missing make/model details
2. **System processes in batches** (5-50 vehicles at a time)
3. **For each vehicle:**
   - Tries photo analysis (if profile photo exists)
   - Tries NZSCV database lookup
   - Tries Carjam NZ scraping
   - Combines results from all sources
4. **Results displayed** with source badges (📸 Photo, 🗄️ NZSCV, 🚗 Carjam)

## Technical Details

### Edge Function: analyze-vehicle-photo

**Location:** `supabase/functions/analyze-vehicle-photo/index.ts`

**Input:**
```json
{
  "plateNumber": "ABC123",
  "photoUrl": "https://storage.url/photo.jpg"
}
```

**Output:**
```json
{
  "success": true,
  "plateNumber": "ABC123",
  "analysis": {
    "make": "Toyota",
    "model": "Hiace",
    "color": "White",
    "year": "2020",
    "is_self_contained": true,
    "has_green_sticker": false,
    "has_blue_sticker": true,
    "vehicle_type": "van",
    "confidence": 85
  }
}
```

### Edge Function: select-best-vehicle-photo

**Location:** `supabase/functions/select-best-vehicle-photo/index.ts`

**Input:**
```json
{
  "plateNumber": "ABC123",
  "photoUrls": [
    "https://storage.url/photo1.jpg",
    "https://storage.url/photo2.jpg",
    "https://storage.url/photo3.jpg"
  ]
}
```

**Output:**
```json
{
  "bestPhoto": "https://storage.url/photo2.jpg",
  "score": 92,
  "allAnalyses": [
    { "url": "...", "score": 78, "reasons": ["..."] },
    { "url": "...", "score": 92, "reasons": ["..."] },
    { "url": "...", "score": 65, "reasons": ["..."] }
  ]
}
```

## Database Schema

### canonical_vehicles table

**AI-related fields:**
```sql
- vehicle_make: text (from AI recognition)
- vehicle_model: text (from AI recognition)
- vehicle_year: integer (from AI recognition)
- vehicle_color: text (from AI recognition)
- profile_photo: text (best photo URL)
- profile_photo_selected_at: timestamp
- profile_photo_metadata: jsonb (score, reasons, etc.)
- nzscv_last_checked: timestamp (NZSCV database check)
- nzscv_source: text (data source tracking)
```

## Benefits

✅ **No Manual Data Entry** - AI extracts vehicle details automatically
✅ **No Plate Reading Required** - Plate number is already known
✅ **Multi-Source Enrichment** - Combines photo AI + NZSCV + Carjam
✅ **Smart Photo Selection** - AI picks the best profile photo
✅ **Batch Processing** - Process hundreds of vehicles efficiently
✅ **Confidence Scoring** - Know how reliable the AI results are
✅ **Admin Override** - Humans can correct AI mistakes
✅ **Sticky Behavior** - Profile photos don't change unexpectedly

## Future Enhancements

- Add vehicle damage detection
- Detect unauthorized modifications
- Recognize vehicle accessories (roof racks, bike carriers)
- Extract license plate expiry date from sticker
- Detect commercial vs private vehicles
