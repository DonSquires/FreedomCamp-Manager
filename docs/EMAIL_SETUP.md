# Email Setup — SMTP Secrets for FieldOps Manager

## Canonical Provider Policy

For production, the canonical provider is Hostinger hPanel SMTP for domain `fcmanager.co.nz`.

- Primary SMTP host: `smtp.hostinger.com`
- General sender mailbox: `donotreply@fieldops.co.nz`
- Report sender mailbox: `reports@fieldops.co.nz`
- Legacy providers (Zoho/SendGrid/other) are transitional only and should be removed from DNS and secrets once hPanel is active.

## Overview

Three Supabase Edge Functions send email via SMTP:

| Edge Function | Purpose |
|---|---|
| `send-report-email` | Dashboard / compliance report delivery |
| `generate-infringement` | Infringement notice emails |
| `generate-notice-to-vacate` | Notice-to-vacate emails |

These functions read the same set of Supabase Edge Function secrets
(set via **Supabase Dashboard → Project Settings → Edge Functions → Manage Secrets**
or via `supabase secrets set`).

## Supabase Auth Invites

`create-user` no longer sends invitation emails through Edge Function SMTP.
It uses `supabase.auth.admin.inviteUserByEmail(...)`, which means invite delivery
is controlled by **Supabase Auth** configuration instead:

1. **Authentication → SMTP Settings**
2. **Authentication → Email Templates**
3. **Authentication → URL Configuration**

If user invites fail, check Supabase Auth SMTP/template setup and allowed redirect
URLs before checking the Edge Function SMTP secrets below.

---

## Required Secrets

| Secret | Required | Default | Description |
|---|---|---|---|
| `SMTP_HOST` | **Yes** | — | SMTP server hostname (production: `smtp.hostinger.com`) |
| `SMTP_PORT` | No | `587` | SMTP port. Use `587` for STARTTLS or `465` for implicit TLS |
| `SMTP_USERNAME` | **Yes** | — | SMTP authentication username |
| `SMTP_PASSWORD` | **Yes** | — | SMTP authentication password or API key |
| `SMTP_FROM_EMAIL` | **Yes** | — | General sender "From" address (production: `donotreply@fieldops.co.nz`) |
| `SMTP_FROM_NAME` | No | Varies per function | Display name for the sender (see below) |
| `SMTP_REPORTS_FROM_EMAIL` | No | Falls back to `SMTP_FROM_EMAIL` | Report-email sender (production: `reports@fieldops.co.nz`) |
| `SMTP_REPORTS_FROM_NAME` | No | Falls back to `SMTP_FROM_NAME` | Report-email sender display name |

### `SMTP_FROM_NAME` defaults

If `SMTP_FROM_NAME` is not set, each function falls back to its own default:

| Function | Default `SMTP_FROM_NAME` |
|---|---|
| `send-report-email` | `FieldOps Manager – Do Not Reply` |
| `generate-infringement` | `FieldOps Manager - Enforcement Notices` |
| `generate-notice-to-vacate` | `FieldOps Manager - Enforcement Notices` |

Setting `SMTP_FROM_NAME` overrides all of these with a single value.

---

## Setting the Secrets

### Via CLI

```bash
supabase secrets set \
  SMTP_HOST=smtp.hostinger.com \
  SMTP_PORT=465 \
  SMTP_USERNAME=donotreply@fieldops.co.nz \
  SMTP_PASSWORD=<hpanel_mailbox_password> \
  SMTP_FROM_EMAIL=donotreply@fieldops.co.nz \
  SMTP_REPORTS_FROM_EMAIL=reports@fieldops.co.nz \
  SMTP_FROM_NAME="FieldOps Manager"
```

### Via Dashboard

1. Open **Supabase Dashboard → Project Settings → Edge Functions → Manage Secrets**
2. Add each secret name/value pair listed above
3. Redeploy edge functions (secrets take effect on next cold start)

---

## Provider Examples (Legacy / Optional)

The examples below are supported by code, but are not the default production direction.
Prefer hPanel SMTP unless an explicit architecture decision overrides this.

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

### hPanel Migration Checklist (from legacy providers)

1. Create mailboxes in hPanel: `donotreply@fieldops.co.nz` and `reports@fieldops.co.nz`.
2. Set Supabase Edge Function SMTP secrets to hPanel values.
3. Set Supabase Auth custom SMTP to same hPanel mailbox.
4. Update DNS to hPanel mail routing:
  - MX: `mx1.hostinger.com`, `mx2.hostinger.com` (or exact hPanel-provided values)
  - SPF include for Hostinger mail
  - DKIM TXT from hPanel
  - DMARC policy (`p=quarantine` or stricter once stable)
5. Remove legacy provider DNS entries (for example Zoho MX/SPF).
6. Run live send test using `send-report-email` and verify inbox delivery.

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
| `WORKER_RESOURCE_LIMIT` | Edge Function runtime resource limit; check function logs, retry, and scale/runtime settings |
| Emails arrive in spam | Missing SPF/DKIM/DMARC DNS records for the sending domain |
| `certificate unknown` or TLS errors | Try switching `SMTP_PORT` between `587` and `465` |
