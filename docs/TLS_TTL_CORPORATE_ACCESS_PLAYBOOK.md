# TLS + TTL Corporate Access Playbook

Updated: 2026-04-29
Owner: Platform Ops

This playbook defines how FieldOps Manager stays reachable on corporate networks while enforcing strong transport security.

## 1) Current Hosting Topology

- Web app: Vercel (HTTPS managed by Vercel certs)
- API and auth: Supabase (HTTPS managed by Supabase)
- Inference: RunPod endpoint (HTTPS)
- Proxy integration service: Railway (HTTPS endpoint)
- PTT signaling: dedicated host behind TLS reverse proxy (`https://ptt.<domain>` + `wss://ptt.<domain>/ws`)

## 2) TLS Baseline (Required)

### 2.1 Minimum protocol and cipher posture

- Allow TLS 1.2 and TLS 1.3 only.
- Disable TLS 1.0 and 1.1 at every edge.
- Prefer managed TLS termination (Vercel, Supabase, Railway, Cloudflare, or managed LB).

### 2.2 HTTPS-only behavior

- Redirect all HTTP traffic to HTTPS (301 or 308).
- Reject downgraded forwarded traffic on internal proxy paths.
- Ensure all frontend API/WebSocket endpoints are `https://` or `wss://`.

### 2.3 HSTS

- Require HSTS header on the web app entrypoints:
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- Only preload once all subdomains are permanently HTTPS.

## 3) TTL Baseline (Required)

### 3.1 DNS TTL policy

- Migration / cutover window: 300 seconds
- Normal steady state: 3600 to 14400 seconds
- Incident failover window: temporarily lower to 60 to 300 seconds

### 3.2 CDN and browser cache TTL policy

- Fingerprinted static assets: `Cache-Control: public, max-age=31536000, immutable`
- HTML entry and shell docs: `no-cache, no-store, must-revalidate`
- Service worker entrypoint: `no-cache, no-store, must-revalidate`
- API responses with sensitive/real-time data: `Cache-Control: no-store`

## 4) Corporate Network Block Avoidance

### 4.1 Reputation and categorization

- Keep stable production domains.
- Register domains with enterprise URL categorization providers if blocked.
- Publish a business-facing support page and contact details to improve reputation scoring.

### 4.2 Stable ingress

- Prefer stable front-door hostnames via managed edge providers.
- Avoid exposing ephemeral pod or preview hosts as primary user endpoints.

### 4.3 Firewall allowlisting package

Provide enterprise customers with:

- Primary app FQDNs
- PTT FQDNs (`wss` endpoint)
- Supabase project host (`*.supabase.co` limited to project ref where possible)
- Optional outbound list for maps/tiles if required by customer policy

## 5) Operational Controls for This Repo

### 5.1 Existing controls

- Vercel security headers and cache headers configured in `vercel.json`.
- Proxy server enforces HTTPS semantics behind reverse proxies.
- PTT standards require `wss://` in production.

### 5.2 New control added

- TLS/TTL audit script: `scripts/tls-ttl-audit.sh`
- Script validates:
  - HTTPS redirect behavior
  - HSTS header presence
  - TLS 1.2/1.3 handshake viability
  - DNS TTL values (if `dig` is installed)

## 6) Recommended Runtime Inputs

Set these before running the audit:

- `APP_HTTPS_URL` (for example: `https://fcmanager.co.nz`)
- `APP_HTTP_URL` (for example: `http://fcmanager.co.nz`)
- `PROXY_HTTPS_URL` (for example: `https://<proxy>.railway.app`)
- `PTT_HTTPS_URL` (for example: `https://ptt.fcmanager.co.nz`)
- `DNS_DOMAINS` (space-separated list, for example: `fcmanager.co.nz ptt.fcmanager.co.nz`)

Optional policy knobs:

- `DNS_TTL_MIN` (default `300`)
- `DNS_TTL_MAX` (default `14400`)

## 7) Standard Validation Flow

1. Run `bash scripts/tls-ttl-audit.sh` in CI or from a secure workstation.
2. Fix any FAIL findings before release.
3. Record outcomes in release notes or ops ticket.

## 8) Known Out-of-Repo Tasks

These cannot be enforced from code and must be completed in provider consoles:

- DNS authoritative TTL values (registrar/DNS provider)
- Domain category/reputation requests with enterprise filtering vendors
- Corporate customer firewall allowlist approvals
- TLS certificate lifecycle policy for non-managed hosts
