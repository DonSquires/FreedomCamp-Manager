# SSL/TLS Compliance Guide

This document outlines the SSL/TLS security measures implemented in FreedomCamp Manager to ensure compliance with security best practices and industry standards.

## Overview

FreedomCamp Manager implements comprehensive SSL/TLS security across all components:

- **Frontend**: Hosted on Vercel with automatic HTTPS and security headers
- **Backend Services**: Express.js servers with Helmet.js security middleware
- **Edge Functions**: Supabase Edge Functions with strict CORS and security headers
- **Database**: Supabase PostgreSQL with encrypted connections

## Security Headers

### Frontend (Vercel)

The following security headers are configured in `vercel.json`:

| Header | Value | Purpose |
|--------|-------|---------|
| **Strict-Transport-Security (HSTS)** | `max-age=31536000; includeSubDomains; preload` | Enforces HTTPS for 1 year, includes subdomains, eligible for HSTS preload |
| **Content-Security-Policy** | See below | Prevents XSS, injection attacks, and unauthorized resource loading |
| **X-Frame-Options** | `DENY` | Prevents clickjacking by blocking iframe embedding |
| **X-Content-Type-Options** | `nosniff` | Prevents MIME type sniffing attacks |
| **X-XSS-Protection** | `1; mode=block` | Enables browser XSS filtering |
| **Referrer-Policy** | `strict-origin-when-cross-origin` | Controls referrer header information |
| **Permissions-Policy** | `geolocation=(self), camera=(self), microphone=(self), payment=()` | Restricts browser features |

### Content Security Policy (CSP)

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: blob: https: http:;
connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.openstreetmap.org https://tile.openstreetmap.org https://*.railway.app https://fcmanager.co.nz https://freedomcampmanager.onspace.build;
frame-ancestors 'none';
form-action 'self';
base-uri 'self';
object-src 'none';
upgrade-insecure-requests
```

### Backend Services (Express.js + Helmet.js)

All backend services (proxy-server, inference-service, ptt-server) use Helmet.js with:

- **HSTS**: 1-year max-age with includeSubDomains and preload
- **CSP**: Strict policy with self-only sources
- **X-Frame-Options**: DENY
- **X-Content-Type-Options**: nosniff
- **Referrer-Policy**: strict-origin-when-cross-origin

### Edge Functions (Supabase)

Security headers added via `withCors.ts`:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`

## CORS Configuration

### Allowed Origins

Production environments use a strict allowlist:

```
https://freedomcampmanager.onspace.build
https://fcmanager.co.nz
https://www.fcmanager.co.nz
https://react-9b4t5o.onspace.build
```

Preview builds matching `preview-react-9b4t5o-*.onspace.build` are automatically allowed.

Development environments (NODE_ENV !== 'production') also allow:
- `http://localhost:5173`
- `http://localhost:3000`

### DEV_CORS Flag

The `DEV_CORS=true` environment variable enables wildcard CORS (`*`) for development.

**SECURITY**: This flag is automatically disabled in production environments (`ENVIRONMENT=production` or `ENVIRONMENT=prod`).

## TLS Configuration

### Deployment Platforms

| Platform | TLS Version | Certificate |
|----------|-------------|-------------|
| Vercel | TLS 1.2+ | Automatic Let's Encrypt |
| Railway | TLS 1.2+ | Automatic Let's Encrypt |
| Supabase | TLS 1.2+ | Managed by Supabase |

### WebSocket Security

PTT signaling server WebSocket connections:
- Use `wss://` (WebSocket Secure) in production
- TLS termination handled by Railway

## Verification Checklist

### Pre-deployment

- [ ] All HTTP traffic redirects to HTTPS
- [ ] HSTS header present with max-age ≥ 31536000
- [ ] TLS 1.2+ only (no SSLv3, TLS 1.0, TLS 1.1)
- [ ] Strong cipher suites configured
- [ ] Certificate valid and not expiring soon

### Security Headers

- [ ] Content-Security-Policy defined
- [ ] X-Frame-Options: DENY
- [ ] X-Content-Type-Options: nosniff
- [ ] X-XSS-Protection enabled
- [ ] Referrer-Policy configured
- [ ] Permissions-Policy configured

### CORS & Authentication

- [ ] CORS origins allowlist (no wildcards in production)
- [ ] DEV_CORS disabled in production
- [ ] API key authentication enforced
- [ ] JWT verification enabled

## Testing Tools

### Command Line

```bash
# Verify headers
curl -I https://fcmanager.co.nz/

# Check SSL/TLS
openssl s_client -connect fcmanager.co.nz:443

# Test specific headers
curl -s -D- https://fcmanager.co.nz/ -o /dev/null | grep -i "strict-transport-security"
```

### Online Tools

- **SSL Labs**: https://www.ssllabs.com/ssltest/ (Target: A+ rating)
- **Security Headers**: https://securityheaders.com/ (Target: A+ rating)
- **CSP Evaluator**: https://csp-evaluator.withgoogle.com/
- **Mozilla Observatory**: https://observatory.mozilla.org/

## HSTS Preload

To submit the domain for HSTS preload:

1. Ensure HSTS header includes `preload` directive
2. Ensure all subdomains support HTTPS
3. Submit at https://hstspreload.org/

**Note**: HSTS preload is permanent and difficult to reverse. Ensure all subdomains are ready before submission.

## Certificate Management

### Automatic Renewal

All deployment platforms (Vercel, Railway, Supabase) handle automatic certificate renewal via Let's Encrypt.

### Monitoring

Set up alerts for:
- Certificate expiration (30 days warning)
- TLS handshake failures
- Security header compliance changes

## Incident Response

If a security issue is discovered:

1. **Assess**: Determine scope and impact
2. **Mitigate**: Apply immediate fixes (e.g., rotate API keys)
3. **Notify**: Alert relevant stakeholders
4. **Remediate**: Deploy permanent fix
5. **Review**: Post-incident analysis and documentation

## Compliance Standards

This configuration addresses requirements from:

- **OWASP Top 10**: XSS, Injection, Security Misconfiguration
- **PCI DSS**: TLS 1.2+ requirement
- **NIST Cybersecurity Framework**: Protect function
- **New Zealand GCSB Protective Security Requirements**: Network security

## Environment Variables

### Backend Services

```env
# Production settings
NODE_ENV=production
ALLOWED_ORIGINS=https://fcmanager.co.nz,https://freedomcampmanager.onspace.build
```

### Edge Functions

```env
# Production settings
ENVIRONMENT=production
# DEV_CORS is ignored in production even if set
```

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-04-01 | 1.0.0 | Initial SSL/TLS compliance implementation |

---

For questions or security concerns, contact the security team.
