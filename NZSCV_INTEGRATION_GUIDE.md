# NZSCV Integration Guide

Complete setup guide for integrating with the NZ Self-Contained Vehicle Registry.

---

## 📋 Overview

**What is NZSCV?**
- Official registry of certified self-contained vehicles in New Zealand
- Managed by Plumbers, Gasfitters and Drainlayers Board (PGDB)
- Provides API to verify vehicle certification status

**Why do we need a proxy?**
- NZSCV requires **IP whitelisting** for security
- Supabase Edge Functions use **dynamic IPs** (change constantly)
- **Solution**: Deploy proxy server with static IP

---

## 🚀 Step-by-Step Setup

### Step 1: Deploy Proxy Server

Choose one deployment option:

#### ✅ **Option A: DigitalOcean ($6/month)**

1. Create account at [DigitalOcean](https://www.digitalocean.com)
2. Create new Droplet:
   - Image: Ubuntu 22.04 LTS
   - Plan: Basic $6/month (1GB RAM)
   - Region: Sydney or Singapore (closest to NZ)
3. SSH into server and run setup:
   ```bash
   # Install Node.js
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs git
   
   # Upload proxy-server folder to /var/www/proxy-server
   # Then:
   cd /var/www/proxy-server
   npm install
   
   # Create .env file
   nano .env
   # Add credentials (see .env.example)
   
   # Install PM2 and start
   sudo npm install -g pm2
   pm2 start server.js --name nzscv-proxy
   pm2 startup
   pm2 save
   
   # Setup firewall
   sudo ufw allow 22
   sudo ufw allow 3000
   sudo ufw enable
   ```

4. Get your static IP:
   ```bash
   curl ifconfig.me
   ```
   **Save this IP - you'll need it for the NZSCV application!**

#### 🔵 **Option B: Railway ($10/month total)**

1. Go to [Railway.app](https://railway.app)
2. Sign up with GitHub
3. New Project → Deploy from GitHub
4. Add environment variables in dashboard
5. Settings → Networking → Allocate Static IP ($5)
6. Copy the static IP address

#### 🟣 **Option C: Fly.io ($1.94/month)**

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Deploy
cd proxy-server
fly launch
fly secrets set NZSCV_API_KEY=placeholder
fly secrets set NZSCV_ID_KEY=placeholder
fly secrets set PROXY_SECRET=$(openssl rand -hex 32)

# Get static IP
fly ips allocate-v4
fly ips list
```

---

### Step 2: Apply to NZSCV

1. **Fill out application form** (see `proxy-server/` folder for PDF)
   - Legal Name: Iron Eagle Security Limited
   - Contact: Your details
   - **IP Addresses**: Your proxy's static IP from Step 1

2. **Submit to**: applications@nzscv.co.nz

3. **Wait for approval** (usually 1-2 business days)

4. **Receive credentials**:
   - `NZSCV_API_KEY`
   - `NZSCV_ID_KEY`

---

### Step 3: Configure Proxy Server

Update your proxy server's environment variables:

```bash
# SSH into server
ssh root@YOUR_DROPLET_IP

# Edit environment file
cd /var/www/proxy-server
nano .env
```

Add your NZSCV credentials:
```env
NZSCV_API_KEY=your_actual_api_key_from_pgdb
NZSCV_ID_KEY=your_actual_id_key_from_pgdb
NZSCV_BASE_URL=https://dev.nzscv.co.nz
PROXY_SECRET=your_random_secret_here
PORT=3000
NODE_ENV=production
```

Restart server:
```bash
pm2 restart nzscv-proxy
```

---

### Step 4: Configure Supabase Edge Function

Add environment variables to Supabase:

1. Go to Supabase Dashboard → Edge Functions
2. Add secrets:
   ```bash
   # Your proxy server URL
   NZSCV_PROXY_URL=http://YOUR_DROPLET_IP:3000
   
   # Same secret as in proxy .env
   NZSCV_PROXY_SECRET=your_random_secret_here
   ```

3. Deploy the updated Edge Function:
   ```bash
   supabase functions deploy check-nzscv-status
   ```

---

### Step 5: Test Integration

#### Test 1: Proxy Health Check
```bash
curl http://YOUR_PROXY_URL:3000/health
```

Expected:
```json
{
  "status": "ok",
  "timestamp": "2025-02-15T12:00:00Z",
  "service": "NZSCV Proxy Server"
}
```

#### Test 2: Direct Proxy Call (with credentials)
```bash
curl -X POST http://YOUR_PROXY_URL:3000/api/nzscv/vehicle-info \
  -H "Content-Type: application/json" \
  -H "X-Proxy-Secret: YOUR_PROXY_SECRET" \
  -d '{"RegistrationNumber": "PUMPS2"}'
```

Expected (if NZSCV approved):
```json
{
  "VehicleRegistration": {
    "VehicleRegistration": "PUMPS2",
    "make": "Toyota",
    "model": "Highlander",
    "year": "2006",
    ...
  },
  "StatusCode": "200"
}
```

#### Test 3: Via Edge Function
```javascript
const { data, error } = await supabase.functions.invoke('check-nzscv-status', {
  body: { plate_number: 'PUMPS2' }
});
```

---

## 🔐 Security Checklist

- [ ] Proxy secret is random (32+ characters)
- [ ] Proxy secret matches in both `.env` and Supabase
- [ ] Firewall only allows port 22 (SSH) and 3000 (API)
- [ ] NZSCV credentials never committed to Git
- [ ] `.env` file excluded via `.gitignore`

---

## 📊 Integration Architecture

```
Frontend (React)
    ↓
Supabase Edge Function
    ↓ (over internet)
Proxy Server (Static IP) ← Whitelisted by NZSCV
    ↓ (authenticated with API key)
NZSCV API
```

---

## 💡 Usage in Application

### Update Canonical Vehicle Data
```typescript
async function checkSelfContainedStatus(plateNumber: string) {
  const { data, error } = await supabase.functions.invoke('check-nzscv-status', {
    body: { plate_number: plateNumber }
  });

  if (error) {
    console.error('NZSCV check failed:', error);
    return null;
  }

  if (data.found) {
    // Update canonical_vehicles table
    await supabase
      .from('canonical_vehicles')
      .update({
        self_contained: data.certification.is_current,
        self_contained_expiry: data.certification.expiry_date,
        vehicle_make: data.vehicle.make,
        vehicle_model: data.vehicle.model,
        vehicle_year: data.vehicle.year,
        nzscv_last_checked: new Date().toISOString(),
        nzscv_source: 'api',
      })
      .eq('plate_number', plateNumber);
  }

  return data;
}
```

---

## 🆘 Troubleshooting

### "NZSCV proxy not configured"
- Missing `NZSCV_PROXY_URL` in Supabase Edge Function secrets
- Fix: Add the environment variable in Supabase dashboard

### "401 Unauthorized" from NZSCV
- IP not whitelisted yet (application pending)
- Wrong API credentials
- Fix: Check application status with applications@nzscv.co.nz

### "Connection refused"
- Proxy server not running
- Firewall blocking port 3000
- Fix: `pm2 status` and `sudo ufw status`

### "504 Gateway Timeout"
- NZSCV API is slow/down
- Network issue
- Fix: Retry after a few seconds

---

## 📞 Support Contacts

**NZSCV Support:**
- Email: applications@nzscv.co.nz
- For: API credentials, IP whitelisting, technical issues

**Proxy Server Issues:**
- Check logs: `pm2 logs nzscv-proxy`
- Restart: `pm2 restart nzscv-proxy`

---

## 💰 Cost Breakdown

| Component | Provider | Cost/Month |
|-----------|----------|-----------|
| Proxy Server | DigitalOcean | $6.00 |
| Proxy Server | Railway | $10.00 |
| Proxy Server | Fly.io | $1.94 |
| NZSCV API Access | PGDB | FREE* |

*Free for approved certifying authorities and government agencies

---

## 🎯 Next Steps After Setup

1. ✅ Test with development environment (`dev.nzscv.co.nz`)
2. ✅ Verify data quality with known vehicles
3. ✅ Switch to production URL (`www.nzscv.co.nz`)
4. ✅ Add automatic NZSCV checks to vehicle observation workflow
5. ✅ Display certification badges in vehicle cards
6. ✅ Alert officers when certification expires

---

## 📝 Notes

- NZSCV enforces 1 request/second rate limit
- Certification data should be cached (check once per day max)
- Store `nzscv_last_checked` timestamp to avoid duplicate checks
- Display PGDB logo on certified vehicles (as per API requirements)
