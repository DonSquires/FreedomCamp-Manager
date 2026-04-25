# FreedomCamp Manager — Production Architecture Plan

> **Document scope:** Describes the live PaaS/BaaS topology for `fcmanager.co.nz`, covering
> every hosted service, how they interconnect, how DNS is wired at iwantmyname, and the
> rationale for the multi-tenant email design.

---

## 1. At-a-Glance Stack Map

```
                                 ┌──────────────────────────────┐
                                 │      iwantmyname DNS          │
                                 │       fcmanager.co.nz         │
                                 └──────────┬───────────────────┘
                                            │ routes traffic by record type
              ┌─────────────────────────────┼───────────────────────────────┐
              │                             │                               │
              ▼ A / CNAME                   ▼ MX (corporate)               ▼ MX / TXT (org email)
  ┌───────────────────────┐    ┌─────────────────────────┐    ┌────────────────────────────┐
  │       VERCEL          │    │  HOSTINGER hPanel        │    │  POSTAL (dedicated VPS)    │
  │  React SPA            │    │  Staff inboxes           │    │  Hetzner / DigitalOcean    │
  │  fcmanager.co.nz      │    │  admin@fcmanager.co.nz   │    │  mail.fcmanager.co.nz      │
  └──────────┬────────────┘    └─────────────────────────┘    └────────────┬───────────────┘
             │ HTTPS API calls                                               │ webhooks (inbound)
             ▼                                                               │
  ┌───────────────────────┐        ┌───────────────────────┐               │
  │  SUPABASE             │◄──────►│  RAILWAY backend      │◄──────────────┘
  │  PostgreSQL + RLS     │        │  TypeScript API        │
  │  Edge Functions       │        │  proxy-server (NZSCV) │──────────────────────►┐
  │  Auth                 │        └──────────┬────────────┘                       │
  └───────────────────────┘                   │ AI job requests                    │
                                              ▼                                    │
                                  ┌───────────────────────┐                        │
                                  │  RUNPOD               │                        │
                                  │  Bob (Ollama LLM)     │                        │
                                  │  orc-ai-inference     │                        │
                                  └───────────────────────┘                        │
                                                                                    │
                              (Postal API: send org emails) ◄───────────────────────┘
```

---

## 2. Layer Descriptions

### 2.1 Frontend — Vercel

| Property | Value |
|---|---|
| Repository | `DonSquires/FreedomCamp-Manager-App` |
| Runtime | React 18 + TypeScript + Vite |
| Domain | `fcmanager.co.nz` (root) and `www.fcmanager.co.nz` |
| Deployment | Automatic from `main` branch via Vercel GitHub integration |
| Env vars | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

The React SPA is a fully static build deployed to Vercel's global CDN. All server-side
logic is handled by Supabase Edge Functions and the Railway backend — Vercel serves
no backend compute.

### 2.2 Backend — Railway

| Property | Value |
|---|---|
| Repository | `DonSquires/FreedomCamp-Manager` (`proxy-server/` directory) |
| Services | `proxy-server` (NZSCV/MotorWeb proxy) |
| Language | TypeScript / Node.js |

Railway hosts the proxy service that shields API keys for the NZSCV and MotorWeb
vehicle lookup integrations.  The Railway backend is also the integration point for
outbound Postal email API calls and the target for inbound Postal webhooks (see §4).

> **Port 25 note:** Railway, Vercel, and RunPod all block outbound connections on
> port 25 (SMTP). This is why the multi-tenant transactional mail server (Postal) must
> run on a dedicated VPS that has port 25 open.

### 2.3 Database & Auth — Supabase

| Property | Value |
|---|---|
| Project ref | `kxwjcupuxnnbnzcgmkoi` |
| Region | AWS ap-southeast-2 (Sydney) |
| Database | PostgreSQL with Row Level Security |
| Auth | Supabase Auth (JWT + magic link / email+password) |
| Edge Functions | ~30 production Deno functions in `supabase/functions/` |

**Multi-tenancy isolation** is enforced at the database layer using RLS policies scoped
to `org_id`.  Every tenant (organisation) can only read and write their own rows.  The
`organizations` table is the root of all tenancy relationships.

### 2.4 AI Services — RunPod

| Property | Value |
|---|---|
| Services | `Bob` (Ollama LLM chat/review), `orc-ai-inference-service` (ALPR/ORC) |
| Worker path | `runpod-worker/`, `runpod-gateway/` |
| Protocol | RunPod Serverless endpoint (HTTP polling) |
| Called by | Supabase Edge Functions via `INFERENCE_SERVICE_URL` |

Heavy GPU workloads are isolated to RunPod pods. The Railway backend and Supabase Edge
Functions never hold open CUDA/GPU resources — they fire API requests to the RunPod
endpoint and poll for results.

### 2.5 Corporate Email — Hostinger hPanel

| Property | Value |
|---|---|
| Purpose | Staff / company inboxes (`admin@fcmanager.co.nz`, `support@…`, etc.) |
| Accessed via | Standard IMAP/SMTP clients (Outlook, Apple Mail, webmail) |
| DNS records | MX records pointing to Hostinger mail servers (see §3) |

This is a traditional human-operated inbox tier. It is completely separate from the
transactional / multi-tenant email path.  Never route application-generated email
through hPanel — Hostinger imposes hourly sending caps that will break bulk
organisation notifications.

### 2.6 Multi-Tenant System Email — Postal (dedicated VPS)

| Property | Value |
|---|---|
| Software | [Postal](https://docs.postalserver.io/) (open-source SendGrid alternative) |
| Recommended VPS | Hetzner CX11 (€4/mo) or DigitalOcean Droplet ($4–$6/mo) |
| Subdomain | `mail.fcmanager.co.nz` (A record → VPS public IP) |
| API | Postal HTTP API (called from Railway backend) |
| Webhooks | Postal → Railway backend (inbound replies, bounce events) |

#### Why a dedicated VPS is required

Vercel, Railway, and RunPod are managed PaaS platforms that **block outbound port 25**
to prevent abuse of their shared IP ranges.  Port 25 is the standard SMTP relay port
used by mail transfer agents.  Without port 25 open, no container on those platforms can
receive or relay raw SMTP connections.

A cheap, dedicated Linux VPS (e.g., Hetzner) gives you:

1. A static public IP with port 25 open.
2. A clean IP that you control — you can set the PTR (reverse DNS) record.
3. Full Docker access to run the Postal container stack.

#### Outbound flow (org → camper)

```
Railway backend
  └─► POST /api/v1/send/message  (Postal HTTP API)
        └─► Postal SMTP relay
              └─► Recipient inbox
```

The Railway service calls the Postal API with the organisation's `from` address and
the message content.  Postal handles SMTP delivery, tracks delivery status, and records
open/click events.

#### Inbound flow (camper reply → dashboard)

```
Camper replies to  notifications@<org-slug>.fcmanager.co.nz
  └─► Postal receives via SMTP (port 25 open on VPS)
        └─► Postal fires HTTP webhook  →  Railway backend  POST /webhooks/postal/inbound
              └─► Railway parses payload, stores reply in Supabase
                    under the correct organisation's thread
```

---

## 3. DNS Configuration (iwantmyname)

All records are managed in iwantmyname under `fcmanager.co.nz`.

### 3.1 Web App (Vercel)

| Record type | Name | Value | Notes |
|---|---|---|---|
| `A` | `@` (root) | `76.76.21.21` | Vercel's Anycast IP for apex domains |
| `CNAME` | `www` | `cname.vercel-dns.com.` | Redirects www → Vercel |

> Vercel provides their current IP/CNAME values in **Project → Settings → Domains**.
> Use whatever Vercel shows there — the table above is illustrative.

### 3.2 Corporate Staff Email (Hostinger hPanel)

| Record type | Name | Value | Priority | Notes |
|---|---|---|---|---|
| `MX` | `@` | `mx1.hostinger.com.` | `10` | Primary mail server |
| `MX` | `@` | `mx2.hostinger.com.` | `20` | Fallback mail server |
| `TXT` | `@` | `v=spf1 include:_spf.mail.hostinger.com ~all` | — | SPF record |
| `TXT` | `default._domainkey` | *(DKIM key from hPanel)* | — | DKIM; get exact value from Hostinger |
| `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@fcmanager.co.nz` | — | DMARC reporting |

> Retrieve the exact DKIM and SPF values from **hPanel → Email → Email Accounts → DNS Records**.
> Hostinger generates the DKIM key per domain.

### 3.3 Multi-Tenant Organisation Email (Postal VPS)

| Record type | Name | Value | Priority | Notes |
|---|---|---|---|---|
| `A` | `mail` | `<POSTAL_VPS_IP>` | — | Points `mail.fcmanager.co.nz` to VPS |
| `MX` | `mail` | `mail.fcmanager.co.nz.` | `10` | Postal receives mail for `mail.fcmanager.co.nz` |
| `TXT` | `mail` | `v=spf1 a:mail.fcmanager.co.nz ~all` | — | SPF for the mail subdomain |
| `TXT` | `postal._domainkey.mail` | *(DKIM key from Postal)* | — | Postal generates this on first run |
| `PTR` | *(at VPS provider)* | `mail.fcmanager.co.nz` | — | **Set at Hetzner/DigitalOcean**, not iwantmyname |

> The PTR (reverse DNS) record must be set in your **VPS provider's control panel**
> (e.g., Hetzner Cloud → Server → Networking → Reverse DNS), not at iwantmyname.
> Without it, outgoing mail will be rejected by Gmail and Microsoft.

---

## 4. Multi-Tenant Email Architecture

### 4.1 Organisation email addressing

Each organisation gets a subdomain-style sender identity managed through Postal:

```
notifications@<org-slug>.mail.fcmanager.co.nz
```

Or, for a cleaner UX, a top-level alias forwarded through Postal:

```
notifications+<org-id>@mail.fcmanager.co.nz
```

Postal can route replies to the correct organisation based on either the envelope
recipient or a custom header (`X-Org-Id`) added by the Railway backend on every send.

### 4.2 Supabase RLS & org context

Every email-related table (`email_threads`, `email_messages`, `email_events`) carries
an `org_id` column.  RLS policies ensure that officers and admins of Organisation A
cannot access threads belonging to Organisation B.

```sql
-- Example RLS policy for email_threads
CREATE POLICY "org_isolation" ON email_threads
  FOR ALL USING (org_id = (
    SELECT org_id FROM user_profiles WHERE id = auth.uid()
  ));
```

### 4.3 Railway backend integration points

| Endpoint | Direction | Purpose |
|---|---|---|
| `POST /api/v1/send/message` | Railway → Postal | Send outbound email for an org |
| `POST /webhooks/postal/inbound` | Postal → Railway | Receive inbound reply |
| `POST /webhooks/postal/delivery` | Postal → Railway | Bounce / delivery events |

The Railway backend authenticates to the Postal API using a `POSTAL_API_KEY` secret
stored in Railway's environment variables.  Inbound webhook payloads from Postal are
verified using a shared `POSTAL_WEBHOOK_SECRET`.

### 4.4 Secret placement

| Secret | Location | Used by |
|---|---|---|
| `POSTAL_API_KEY` | Railway env | Railway backend → Postal API |
| `POSTAL_WEBHOOK_SECRET` | Railway env | Verify Postal webhook signatures |
| `POSTAL_SMTP_HOST` | Supabase Edge Function secrets | Edge fns that send via SMTP |
| `SMTP_HOST` / `SMTP_PASSWORD` | Supabase Edge Function secrets | `send-report-email`, `generate-infringement` |

---

## 5. Postal VPS Setup Checklist

Use this checklist when provisioning the dedicated Postal VPS.

- [ ] Spin up a VPS (Hetzner CX11 or DigitalOcean Basic) with Ubuntu 22.04 LTS
- [ ] Confirm outbound port 25 is open (contact provider if blocked)
- [ ] Set a static hostname: `mail.fcmanager.co.nz`
- [ ] Set PTR (reverse DNS) at VPS provider → `mail.fcmanager.co.nz`
- [ ] Add `A` record in iwantmyname: `mail` → `<VPS_IP>`
- [ ] Install Docker and Docker Compose
- [ ] Follow the [Postal installation guide](https://docs.postalserver.io/install/installation) to deploy Postal in Docker
- [ ] Create a mail server in Postal for `fcmanager.co.nz`
- [ ] Copy the generated SPF and DKIM values from Postal → add to iwantmyname DNS
- [ ] Create an API credential in Postal → store as `POSTAL_API_KEY` in Railway
- [ ] Configure inbound routes in Postal to forward to Railway webhook URL
- [ ] Set `POSTAL_WEBHOOK_SECRET` in both Postal and Railway
- [ ] Send a test email and verify DKIM / DMARC pass using [mail-tester.com](https://www.mail-tester.com)

---

## 6. How All the Pieces Connect (End-to-End Flow)

```
Officer opens fcmanager.co.nz
  ├─ Vercel serves React SPA
  ├─ SPA authenticates → Supabase Auth (JWT)
  ├─ SPA queries data → Supabase Edge Functions → PostgreSQL (RLS)
  │
  ├─ Plate scan
  │   ├─ SPA → Supabase vehicle-ingest edge fn
  │   ├─ Edge fn → Railway proxy → NZSCV lookup
  │   └─ Edge fn → RunPod orc-ai-inference (ALPR/ORC enrichment)
  │
  ├─ Bob AI chat
  │   ├─ SPA → Supabase onspace-ai-chat edge fn
  │   └─ Edge fn → RunPod Bob endpoint (Ollama)
  │
  └─ Send enforcement notice to camper
      ├─ Railway backend calls Postal API → email sent from Postal VPS
      └─ Camper replies → Postal receives → webhook → Railway → stored in Supabase
```

---

## 7. Related Documents

| Document | Purpose |
|---|---|
| [STACK_ACCESS_MAP.md](STACK_ACCESS_MAP.md) | Service-by-service access paths and secrets placement |
| [SECRETS_REGISTRY.md](SECRETS_REGISTRY.md) | Master list of secrets by control plane |
| [EMAIL_SETUP.md](EMAIL_SETUP.md) | SMTP secrets for Supabase Edge Functions |
| [RAILWAY_DEPLOYMENT_GUIDE.md](RAILWAY_DEPLOYMENT_GUIDE.md) | Deploying the proxy-server to Railway |
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | Full production deployment checklist |
| [docs/adr/](adr/) | Architectural Decision Records |
