# MotorWeb Integration Guide

## 🎯 Overview

This integration allows Freedom Camping Manager to enrich canonical vehicle records with **authoritative vehicle registration data** from MotorWeb API, including:

- **Vehicle Details**: Year, Make, Model, Color, Body Type, VIN, Engine Number
- **Owner Information**: Name, Company, Address (verified)
- **Registration Status**: WOF/Licence expiry, Active/Expired status, Odometer reading

---

## 📐 Architecture

```
Frontend                Edge Function              Railway Proxy           MotorWeb API
┌──────────┐           ┌──────────────┐           ┌────────────┐          ┌──────────────┐
│ Evidence │  ──────>  │ enrich-from- │  ──────>  │  Static IP │  ──────> │ Current Owner│
│  Report  │  invoke() │   motorweb   │  GET      │   Proxy    │  HTTPS   │    Check     │
│  Page    │           │              │           │            │          │  API 4.0     │
└──────────┘           └──────────────┘           └────────────┘          └──────────────┘
                              │                         │
                              │                         │
                              ▼                         ▼
                       ┌──────────────┐         Parse XML Response
                       │ Supabase DB  │         Extract Vehicle + Owner
                       │ canonical_   │         Update Database
                       │  vehicles    │
                       └──────────────┘
```

---

## 🔧 Setup Instructions

### 1. **Update Railway Proxy** (Deploy MotorWeb Endpoint)

The proxy server now supports **both NZSCV and MotorWeb** APIs.

**New Endpoint**: `GET /motorweb/currentOwnerCheck`

**Deploy to Railway:**
```bash
cd proxy-server
git add .
git commit -m "Add MotorWeb API support for vehicle enrichment"
git push railway main
```

---

### 2. **Configure MotorWeb Credentials on Railway**

Add these environment variables in Railway dashboard:

| Variable | Value | Description |
|----------|-------|-------------|
| `MOTORWEB_API_KEY` | Your MotorWeb API Key | Provided by PGDB |
| `MOTORWEB_ID_KEY` | Your MotorWeb ID Key | Provided by PGDB |
| `MOTORWEB_BASE_URL` | `https://robot.motorweb.co.nz` | MotorWeb production URL |

**How to get credentials:**
1. Contact PGDB (same provider as NZSCV): https://www.pgdb.co.nz/
2. Request MotorWeb "Current Owner Check" API access
3. Receive `PGDB-Authorization` and `PGDB-Identifier` keys
4. Add to Railway environment variables

---

### 3. **Configure Supabase Environment Variables**

Add Railway proxy URL to Supabase Edge Functions:

```bash
RAILWAY_PROXY_URL=https://freedomcamp-manager-production.up.railway.app
```

**How to set:**
1. Go to Supabase Dashboard → Project Settings → Edge Functions
2. Add environment variable:
   - Name: `RAILWAY_PROXY_URL`
   - Value: `https://freedomcamp-manager-production.up.railway.app`

---

### 4. **Deploy Edge Function**

```bash
supabase functions deploy enrich-from-motorweb
```

---

## 📊 API Response Structure

### MotorWeb XML Response

```xml
<current-owner-check version="2.9" vehicle-id="-xxxx" timestamp="2024-09-24T08:31:18.401">
  <year-of-manufacture value="2021">2021</year-of-manufacture>
  <make>Tesla</make>
  <model>Model 3 Standard Range Plus</model>
  <mvr-model>MODEL 3</mvr-model>
  <colour>White</colour>
  <body>Sedan</body>
  <vin>5YJ3E1EB3KF123456</vin>
  <owner current="true" owner-number="1">
    <sex-company code="M">Male</sex-company>
    <owner-name>JOE AVERAGE PUBLIC</owner-name>
    <owner-name-parts>
      <first-name>JOE</first-name>
      <middle-names>AVERAGE</middle-names>
      <last-name>PUBLIC</last-name>
    </owner-name-parts>
    <address label="Street address" usage="physical">
      <line-1>37 PUBLIC ROAD</line-1>
      <suburb>PUBLIC BAY</suburb>
      <town>AUCKLAND</town>
      <postcode>0630</postcode>
    </address>
    <ownership-date value="2021-09-23">23-Sep-2021</ownership-date>
    <owner-status code="C">Complete</owner-status>
  </owner>
  <wof>25-Apr-2025</wof>
  <licence>22-Jul-2025</licence>
  <registration>Active</registration>
  <latest-odometer>112,067 Km 11-Apr-2024</latest-odometer>
</current-owner-check>
```

### Edge Function Response

```json
{
  "success": true,
  "plate_number": "ABC123",
  "enriched": true,
  "source": "motorweb",
  "timestamp": "2024-02-16T08:31:18.401Z",
  "vehicle_data": {
    "vehicle_year": "2021",
    "vehicle_make": "Tesla",
    "vehicle_model": "Model 3 Standard Range Plus",
    "vehicle_color": "White",
    "vin": "5YJ3E1EB3KF123456",
    "wof_expiry": "25-Apr-2025",
    "licence_expiry": "22-Jul-2025",
    "registration_status": "Active"
  },
  "owner_data": {
    "owner_first_name": "JOE",
    "owner_last_name": "PUBLIC",
    "owner_address_line1": "37 PUBLIC ROAD",
    "owner_suburb": "PUBLIC BAY",
    "owner_town": "AUCKLAND",
    "owner_postcode": "0630",
    "ownership_date": "2021-09-23"
  },
  "canonical_record": {
    "plate_number": "ABC123",
    "vehicle_make": "Tesla",
    "vehicle_model": "Model 3 Standard Range Plus",
    "vehicle_year": 2021,
    "vehicle_color": "White",
    "owner_first_name": "JOE",
    "owner_last_name": "PUBLIC",
    "owner_address": "37 PUBLIC ROAD, PUBLIC BAY, AUCKLAND, 0630",
    "owner_address_verified": true,
    "nzscv_last_checked": "2024-02-16T08:31:18.401Z",
    "nzscv_source": "motorweb"
  }
}
```

---

## 🎨 Frontend Integration (Next Step)

### Option 1: **Enrich Button on Vehicle Evidence Report**

Add "Enrich from MotorWeb" button to `VehicleEvidenceReport.tsx`:

```tsx
<Button
  onClick={async () => {
    const { data, error } = await supabase.functions.invoke('enrich-from-motorweb', {
      body: { plateNumber: selectedVehicle.plate_number }
    });
    
    if (error) {
      toast.error('Enrichment failed: ' + error.message);
    } else {
      toast.success('Vehicle data enriched from MotorWeb!');
      // Refresh vehicle data
    }
  }}
>
  🔍 Enrich from MotorWeb
</Button>
```

### Option 2: **Auto-Enrich on Report Generation**

Silently enrich vehicle before generating PDF evidence report.

### Option 3: **Batch Enrichment Tool**

Create admin page to enrich all vehicles with incomplete data.

---

## 💰 Cost Estimation

| Service | Cost | Purpose |
|---------|------|---------|
| Railway Proxy | ~$10/month | Static IP for NZSCV + MotorWeb |
| MotorWeb API | Pay-per-query | Vehicle enrichment (contact PGDB for pricing) |
| NZSCV API | Pay-per-query | Self-contained sticker verification |

**Usage estimate:** 
- ~100 enforcement reports/month
- ~50 MotorWeb enrichment queries/month
- Total: ~$15-20/month (proxy + API calls)

---

## 🔒 Security

1. **Proxy Authentication**: Railway proxy requires `PROXY_SECRET` header
2. **Service Role Key**: Edge Function uses Supabase service role for database writes
3. **Rate Limiting**: Both APIs enforce 1 request/second (proxy handles this)
4. **Data Privacy**: Owner data only stored for enforcement/compliance purposes

---

## ✅ Testing

### Test Railway Proxy

```bash
curl "https://freedomcamp-manager-production.up.railway.app/motorweb/currentOwnerCheck?plateOrVin=ABC123&specificReason=Testing" \
  -H "x-proxy-secret: YOUR_PROXY_SECRET"
```

### Test Edge Function (via Supabase CLI)

```bash
supabase functions invoke enrich-from-motorweb \
  --data '{"plateNumber": "ABC123"}'
```

---

## 📋 Next Steps

1. ✅ Edge Function created (`enrich-from-motorweb`)
2. ✅ Railway proxy updated with MotorWeb endpoint
3. ⏳ **Configure MotorWeb credentials on Railway** (you need to do this)
4. ⏳ **Deploy updated proxy to Railway** (`git push railway main`)
5. ⏳ **Deploy Edge Function** (`supabase functions deploy enrich-from-motorweb`)
6. ⏳ **Add "Enrich" button to VehicleEvidenceReport.tsx** (I can do this)

---

## 🚨 Troubleshooting

### "MotorWeb API credentials not configured"
- Add `MOTORWEB_API_KEY` and `MOTORWEB_ID_KEY` to Railway environment variables
- Restart Railway deployment

### "Failed to connect to MotorWeb API"
- Check Railway proxy logs
- Verify MotorWeb base URL is correct
- Confirm API credentials are valid

### "XML parsing error"
- MotorWeb API may have changed XML schema
- Check Edge Function logs for raw XML response
- Update XML parsing logic if needed

---

## 📚 References

- **MotorWeb Docs**: https://robot.motorweb.co.nz/docs/
- **PGDB Contact**: https://www.pgdb.co.nz/
- **XML Schema**: currentownercheck-2.9.xsd

