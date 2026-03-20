# Email Setup — SMTP Secrets for FreedomCamp Manager

## Overview

Four Supabase Edge Functions send email via SMTP:

| Edge Function | Purpose |
|---|---|
| `send-report-email` | Dashboard / compliance report delivery |
| `create-user` | User invitation emails |
| `generate-infringement` | Infringement notice emails |
| `generate-notice-to-vacate` | Notice-to-vacate emails |

All four functions read the same set of Supabase Edge Function secrets
(set via **Supabase Dashboard → Project Settings → Edge Functions → Manage Secrets**
or via `supabase secrets set`).

---

## Required Secrets

| Secret | Required | Default | Description |
|---|---|---|---|
| `SMTP_HOST` | **Yes** | — | SMTP server hostname (e.g. `smtp.sendgrid.net`) |
| `SMTP_PORT` | No | `587` | SMTP port. Use `587` for STARTTLS or `465` for implicit TLS |
| `SMTP_USERNAME` | **Yes** | — | SMTP authentication username |
| `SMTP_PASSWORD` | **Yes** | — | SMTP authentication password or API key |
| `SMTP_FROM_EMAIL` | **Yes** | — | Sender "From" address (e.g. `noreply@yourdomain.co.nz`) |
| `SMTP_FROM_NAME` | No | Varies per function | Display name for the sender (see below) |

### `SMTP_FROM_NAME` defaults

If `SMTP_FROM_NAME` is not set, each function falls back to its own default:

| Function | Default `SMTP_FROM_NAME` |
|---|---|
| `send-report-email` | `FreedomCamp Manager – Do Not Reply` |
| `create-user` | `FreedomCamp Manager - Iron Eagle Security` |
| `generate-infringement` | `FreedomCamp Manager - Enforcement Notices` |
| `generate-notice-to-vacate` | `FreedomCamp Manager - Enforcement Notices` |

Setting `SMTP_FROM_NAME` overrides all of these with a single value.

---

## Setting the Secrets

### Via CLI

```bash
supabase secrets set \
  SMTP_HOST=smtp.sendgrid.net \
  SMTP_PORT=587 \
  SMTP_USERNAME=apikey \
  SMTP_PASSWORD=SG.xxxxxxxx \
  SMTP_FROM_EMAIL=noreply@yourdomain.co.nz \
  SMTP_FROM_NAME="FreedomCamp Manager"
```

### Via Dashboard

1. Open **Supabase Dashboard → Project Settings → Edge Functions → Manage Secrets**
2. Add each secret name/value pair listed above
3. Redeploy edge functions (secrets take effect on next cold start)

---

## Provider Examples

### SendGrid

```
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USERNAME=apikey
SMTP_PASSWORD=SG.your_sendgrid_api_key
SMTP_FROM_EMAIL=noreply@yourdomain.co.nz
```

### AWS SES

```
SMTP_HOST=email-smtp.ap-southeast-2.amazonaws.com
SMTP_PORT=587
SMTP_USERNAME=AKIA…your_ses_smtp_user
SMTP_PASSWORD=your_ses_smtp_password
SMTP_FROM_EMAIL=noreply@yourdomain.co.nz
```

### Resend

```
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USERNAME=resend
SMTP_PASSWORD=re_your_resend_api_key
SMTP_FROM_EMAIL=noreply@yourdomain.co.nz
```

### Mailgun

```
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USERNAME=postmaster@yourdomain.co.nz
SMTP_PASSWORD=your_mailgun_password
SMTP_FROM_EMAIL=noreply@yourdomain.co.nz
```

---

## Verifying

After setting secrets, send a test report email from the Admin Portal
(**Reports → Email Report**). If secrets are missing the edge function returns
a `503` response listing the missing secret names.

You can also check which secrets are set:

```bash
supabase secrets list
```

---

## TLS Behaviour

The edge functions automatically choose the TLS mode based on the port:

| Port | Mode |
|---|---|
| `465` | Implicit TLS (`connectTLS`) |
| `587` / other | STARTTLS (`connect` with upgrade) |

---

## Troubleshooting

| Symptom | Likely Cause |
|---|---|
| `503 — Email service not configured. Missing Supabase secrets: …` | One or more required SMTP secrets are not set |
| `SMTP timeout` | Firewall blocking outbound port 587/465, or wrong hostname |
| `Authentication failed` | Wrong `SMTP_USERNAME` or `SMTP_PASSWORD` |
| Emails arrive in spam | Missing SPF/DKIM/DMARC DNS records for the sending domain |
| `certificate unknown` or TLS errors | Try switching `SMTP_PORT` between `587` and `465` |
