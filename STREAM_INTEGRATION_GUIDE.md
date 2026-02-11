# Plate Recognizer Stream Integration Guide

## Overview

The FreedomCamp Manager now supports **Plate Recognizer Stream** for continuous video processing in driving mode, replacing manual camera scanning with automated webhook-based plate recognition.

## Architecture

```
IP Camera / USB Camera → Plate Recognizer Stream (local processing)
                              ↓
                        Middleware (optional)
                              ↓
                    Webhook → stream-webhook Edge Function
                              ↓
                    FreedomCamp Database + Real-time Updates
```

## Installation Steps

### 1. Install Plate Recognizer Stream

Follow the installation guide for your platform:
- **Linux/MacOS/Windows**: https://guides.platerecognizer.com/docs/stream/getting-started
- **Docker**: Recommended for production deployments

```bash
docker pull platerecognizer/alpr-stream:latest
```

### 2. Configure Stream

Create a `config.ini` file for your camera setup:

```ini
[cameras]
  [[camera-zone-01]]
  url = rtsp://camera-ip:554/stream1  # Your camera RTSP URL
  name = Zone 01 - Beach Road

webhook_targets = freedomcamp

[webhooks]
caching = yes

[[freedomcamp]]
url = https://YOUR_PROJECT.supabase.co/functions/v1/stream-webhook
image = vehicle, plate
request_timeout = 30
# IMPORTANT: Map camera to zone
header = camera-id: ZONE_ID:ORGANIZATION_ID
# Example: header = camera-id: 123e4567-e89b-12d3-a456-426614174000:abc123

[alpr]
region = nz  # New Zealand plates
```

### 3. Camera ID Format

The `camera-id` header **must** follow this format:

- **With organization**: `ZONE_ID:ORGANIZATION_ID`
- **Without organization**: `ZONE_ID`

Example:
```
header = camera-id: 550e8400-e29b-41d4-a716-446655440000:org123
```

To get your zone IDs:
1. Go to Admin Portal → Zone Management
2. Copy the zone UUID from the URL or zone details

### 4. Run Stream

```bash
# Docker (recommended)
docker run -it --rm \
  -v $(pwd)/config.ini:/app/config.ini \
  -p 8080:8080 \
  platerecognizer/alpr-stream

# Or direct installation
stream --config config.ini
```

### 5. Test Webhook

Stream will start sending webhooks to your Edge Function endpoint. Check Supabase Functions logs to verify:

```bash
supabase functions logs stream-webhook
```

Expected output:
```
📡 Stream webhook received: { timestamp: '2025-01-...', camera: 'zone_id:org_id', results: 1 }
🚗 Processing: ABC123 (confidence: 89%)
✅ Processed: ABC123
```

## Middleware Options

### Crop Plate and Forward

Reduces bandwidth by sending only plate crops:

```env
MIDDLEWARE_NAME=crop_plate
WEBHOOK_URL=https://YOUR_PROJECT.supabase.co/functions/v1/stream-webhook
```

```bash
docker run -it --env-file .env -p 8002:8002 --name stream-gateway \
  platerecognizer/stream-gateway
```

Update Stream config:
```ini
[[freedomcamp]]
url = http://YOUR_SERVER_IP:8002
```

### Direction of Travel (DOT)

Filter by vehicle direction (entering vs. exiting zones):

```env
MIDDLEWARE_NAME=dot
ALLOWED_DIRECTIONS=north,east  # Only process vehicles heading these directions
```

### Duplicate Filtering

Stream Gateway automatically filters duplicates - vehicles scanned within configurable time window.

Update `config.ini`:
```ini
[webhooks]
caching = yes
cache_duration = 30  # Don't re-send same plate for 30 seconds
```

## Multiple Cameras / Zones

To monitor multiple zones, add multiple camera configurations:

```ini
[cameras]
  [[camera-beach-road]]
  url = rtsp://camera1-ip:554/stream1
  name = Beach Road Zone

  [[camera-city-park]]
  url = rtsp://camera2-ip:554/stream1
  name = City Park Zone

webhook_targets = freedomcamp-beach, freedomcamp-park

[[freedomcamp-beach]]
url = https://YOUR_PROJECT.supabase.co/functions/v1/stream-webhook
header = camera-id: BEACH_ZONE_ID:ORG_ID

[[freedomcamp-park]]
url = https://YOUR_PROJECT.supabase.co/functions/v1/stream-webhook
header = camera-id: PARK_ZONE_ID:ORG_ID
```

## Real-Time Dashboard

The system automatically processes Stream webhooks in the background. To monitor activity:

1. **Admin Dashboard** → See total vehicles scanned per zone
2. **Vehicle Management** → View all auto-scanned records
3. **Breach Management** → See real-time compliance alerts
4. **Live Patrol Monitor** → Watch plates being scanned live

## Troubleshooting

### No webhooks received

1. Check Stream is running: `docker ps` or check process
2. Verify webhook URL is correct in `config.ini`
3. Check firewall allows outbound HTTPS to Supabase
4. Test webhook manually:
   ```bash
   curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/stream-webhook \
     -H "Content-Type: application/json" \
     -H "camera-id: test-zone:test-org" \
     -d '{"data":{"results":[{"plate":"TEST123","score":0.9}],"timestamp":"2025-01-25T12:00:00Z"},"hook":{}}'
   ```

### Low confidence detections

Adjust Stream settings in `config.ini`:
```ini
[alpr]
region = nz
min_score = 0.7  # Increase from default 0.5
```

### Duplicate scans

Enable caching in webhook config:
```ini
[webhooks]
caching = yes
cache_duration = 30  # seconds
```

### Camera feed issues

1. Verify RTSP URL: `ffplay rtsp://camera-ip:554/stream1`
2. Check camera resolution (1920x1080 recommended)
3. Ensure adequate lighting for plate visibility
4. Adjust camera angle for clearer plate capture

## Performance Tuning

### High Traffic Zones

For zones with heavy traffic (>50 vehicles/hour):

```ini
[alpr]
max_plate_width = 500  # Pixels, reduce processing load
frame_skip = 3  # Process every 3rd frame instead of all
```

### Storage Optimization

Disable vehicle image forwarding if not needed:

```ini
[[freedomcamp]]
url = https://YOUR_PROJECT.supabase.co/functions/v1/stream-webhook
image = plate  # Only send plate crop, not full vehicle image
```

### Processing Speed

Stream processes locally, so:
- **Fast**: Webhook calls happen after Stream already recognized the plate
- **Scalable**: Add more cameras without slowing down
- **Offline capable**: Stream continues working even if webhook endpoint is temporarily down (will retry)

## Migration from Manual Scanning

**Before Stream integration**: Officers manually scan plates with camera/phone
**After Stream integration**: 
- Stream continuously monitors fixed cameras
- Officers can still use handheld mode for on-foot patrols
- Automatic logging reduces manual data entry by 80%+

## Cost Comparison

### Manual Scanning (Current)
- Officer time: 30 seconds per vehicle
- Coverage: 20-30 vehicles per hour

### Stream Integration (Automated)
- Setup time: 2-3 hours (one-time)
- Coverage: 100+ vehicles per hour per camera
- Officer time: 0 seconds (automated)
- ROI: Break-even after ~10 hours of operation

## Security Considerations

1. **Webhook Authentication**: Edge Function validates camera-id header
2. **Data Encryption**: All data transmitted over HTTPS
3. **Access Control**: RLS policies restrict data access by organization
4. **Image Storage**: Photos stored in secure Supabase Storage bucket
5. **Audit Trail**: All plate scans logged with timestamp and camera ID

## Support

For Stream setup assistance:
- **Plate Recognizer**: https://guides.platerecognizer.com
- **FreedomCamp Manager**: contact@onspace.ai
- **Emergency**: Check Supabase Functions logs for detailed error messages

## Next Steps

After Stream is running:
1. ✅ Monitor first few hours of webhook data
2. ✅ Verify plate detections are accurate
3. ✅ Adjust confidence thresholds if needed
4. ✅ Enable middleware for advanced filtering
5. ✅ Add more cameras to expand coverage
6. ✅ Train field staff on new automated workflow
