# NZSCV API Proxy Server

Static IP proxy for accessing NZSCV Self-Contained Vehicle Registry API from serverless environments.

## Why This Proxy?

NZSCV API requires **IP whitelisting**. Supabase Edge Functions use dynamic IPs, so this proxy provides a static IP address that can be whitelisted.

---

## 🚀 Deployment Options

### Option 1: DigitalOcean Droplet (Recommended - $6/month)

**Advantages:**
- ✅ Guaranteed static IP
- ✅ Simple setup
- ✅ Full control
- ✅ SSH access for debugging

**Steps:**

1. **Create Droplet**
   - Go to [DigitalOcean](https://www.digitalocean.com)
   - Create new Droplet
   - Choose: Ubuntu 22.04 LTS
   - Size: Basic $6/month (1GB RAM)
   - Region: Choose closest to NZ (Sydney/Singapore)
   - Add SSH key or password
   - Create Droplet

2. **SSH into server**
   ```bash
   ssh root@YOUR_DROPLET_IP
   ```

3. **Install Node.js**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   sudo apt-get install -y git
   ```

4. **Clone/Upload your code**
   ```bash
   mkdir /var/www
   cd /var/www
   # Upload the proxy-server folder here
   ```

5. **Install dependencies**
   ```bash
   cd /var/www/proxy-server
   npm install
   ```

6. **Create .env file**
   ```bash
   nano .env
   ```
   Paste your configuration (see .env.example)

7. **Install PM2 (process manager)**
   ```bash
   sudo npm install -g pm2
   pm2 start server.js --name nzscv-proxy
   pm2 startup
   pm2 save
   ```

8. **Setup firewall**
   ```bash
   sudo ufw allow 22
   sudo ufw allow 3000
   sudo ufw enable
   ```

9. **Get your static IP**
   ```bash
   curl ifconfig.me
   ```
   This is the IP you provide to NZSCV for whitelisting!

---

### Option 2: Railway ($5/month)

**Advantages:**
- ✅ Auto-deployment from Git
- ✅ Free $5 credit
- ✅ Simple dashboard

**Steps:**

1. Go to [Railway.app](https://railway.app)
2. Sign up with GitHub
3. Create New Project → Deploy from GitHub repo
4. Select this repository
5. Add environment variables in Railway dashboard:
   - `NZSCV_API_KEY`
   - `NZSCV_ID_KEY`
   - `NZSCV_BASE_URL`
   - `PROXY_SECRET`
6. Railway will auto-deploy
7. Go to Settings → Networking → Generate Domain
8. To get static IP:
   - Settings → Add Static IP ($5/month)
   - Copy the IP address
   - Provide this to NZSCV

---

### Option 3: Fly.io ($1.94/month for IPv4)

**Advantages:**
- ✅ Cheapest option
- ✅ Global edge network

**Steps:**

1. Install flyctl:
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. Login:
   ```bash
   fly auth login
   ```

3. Deploy:
   ```bash
   cd proxy-server
   fly launch
   ```

4. Set secrets:
   ```bash
   fly secrets set NZSCV_API_KEY=your_key
   fly secrets set NZSCV_ID_KEY=your_id
   fly secrets set NZSCV_BASE_URL=https://dev.nzscv.co.nz
   fly secrets set PROXY_SECRET=your_secret
   ```

5. Allocate static IPv4 ($1.94/month):
   ```bash
   fly ips allocate-v4
   fly ips list
   ```

6. Copy the IPv4 address and provide to NZSCV

---

## 🔐 Security Configuration

### Generate Proxy Secret

```bash
# Generate a random 32-character secret
openssl rand -hex 32
```

Use this value for `PROXY_SECRET` in your `.env` file.

---

## 📋 Application Form Instructions

Once deployed, fill out the NZSCV application form with:

1. **Legal Name**: Your company name
2. **Organization ID**: Your organization ID (if applicable)
3. **Contact Details**: Your contact info
4. **IP Addresses**: Your proxy server's static IP address
   - DigitalOcean: Get from droplet dashboard
   - Railway: From Static IP settings
   - Fly.io: From `fly ips list`

---

## 🧪 Testing Your Proxy

### NZSCV Test Environment

NZSCV provides a **test environment** at a different URL from production. The endpoint path also
differs, so use the `NZSCV_ENDPOINT_URL` variable to point to the correct URL:

| Environment | NZSCV_ENDPOINT_URL |
|---|---|
| **Test** | `https://tst.nzscv.co.nz/rest/info/v1/vehicleregistrationinfo` |
| **Production** | `https://www.nzscv.co.nz/api/rest/scv/v1/vehicleregistrationinfo` |

Set these as environment variables on your Railway/DigitalOcean server — **never commit credentials
to Git**. On Railway:

1. Open your proxy-server service → **Variables**
2. Add:
   - `NZSCV_ENDPOINT_URL` = the test or production URL above
   - `NZSCV_ID_KEY` = your API Identifier (from PGDB)
   - `NZSCV_API_KEY` = your API Authorization (from PGDB)
3. Redeploy

The proxy server sends:
- `PGDB-Identifier: <NZSCV_ID_KEY>` header
- `PGDB-Authorization: <NZSCV_API_KEY>` header

---

### Local Test (before NZSCV approval)

```bash
cd proxy-server
npm install
npm start
```

```bash
# Test endpoint
curl -X POST http://localhost:3000/api/nzscv/vehicle-info \
  -H "Content-Type: application/json" \
  -H "X-Proxy-Secret: your_secret_here" \
  -d '{"RegistrationNumber": "ABC123"}'
```

### Production Test (after deployment)

```bash
curl -X POST https://your-proxy-url.com/api/nzscv/vehicle-info \
  -H "Content-Type: application/json" \
  -H "X-Proxy-Secret: your_secret_here" \
  -d '{"RegistrationNumber": "ABC123"}'
```

### Report Email Relay Test (after deployment)

```bash
curl -X POST https://your-proxy-url.com/api/email/send-report \
  -H "Content-Type: application/json" \
  -H "X-Proxy-Secret: your_secret_here" \
  -d '{"recipient_email":"reports@fieldops.co.nz","subject":"Relay test","html":"<p>relay ok</p>"}'
```

Expected response (before NZSCV approval):
```json
{
  "errors": ["invalid api key."],
  "statusCode": "401"
}
```

This is normal! Once NZSCV approves your application and provides credentials, you'll get real data.

---

## 🔄 Maintenance

### View Logs (DigitalOcean with PM2)
```bash
pm2 logs nzscv-proxy
```

### Restart Service
```bash
pm2 restart nzscv-proxy
```

### Update Environment Variables
```bash
pm2 stop nzscv-proxy
nano /var/www/proxy-server/.env
pm2 restart nzscv-proxy
```

---

## 📊 Monitoring

Check if server is running:
```bash
curl https://your-proxy-url.com/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-02-15T12:00:00.000Z",
  "service": "NZSCV Proxy Server"
}
```

---

## 💰 Cost Summary

| Provider | Cost/Month | Static IP | Auto-Deploy |
|----------|-----------|-----------|-------------|
| DigitalOcean | $6 | ✅ Included | ❌ Manual |
| Railway | $5 + $5 | ✅ $5 extra | ✅ Yes |
| Fly.io | $1.94 | ✅ Included | ✅ Yes |

**Recommendation**: Use DigitalOcean for simplicity or Fly.io for lowest cost.

---

## ⚠️ Important Notes

1. **NZSCV Rate Limit**: 1 request per second - the proxy doesn't enforce this, your application must!
2. **Keep Secrets Safe**: Never commit `.env` to Git
3. **Whitelist Your IP**: Provide your proxy's static IP to NZSCV in the application form
4. **Test First**: Use development environment (dev.nzscv.co.nz) before production

---

## 🆘 Troubleshooting

### "Connection Refused"
- Check firewall: `sudo ufw status`
- Check server is running: `pm2 status`
- Verify port 3000 is open

### "401 Unauthorized" from NZSCV
- Verify API keys in `.env`
- Check if your IP is whitelisted with NZSCV
- Confirm you're using correct environment (dev vs production)

### "504 Gateway Timeout"
- NZSCV API is slow/down
- Check NZSCV service status

---

## 📞 Support

If you encounter issues:
1. Check logs: `pm2 logs nzscv-proxy`
2. Test health endpoint: `curl https://your-url.com/health`
3. Verify environment variables: `pm2 env 0`
