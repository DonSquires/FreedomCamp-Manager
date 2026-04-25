# Public Dispute Flow — Architecture

This document describes the end-to-end architecture for the **Public Dispute Submission** feature in FieldOps Manager.

---

## Overview

When a freedom-camping enforcement notice is issued, the recipient must have a clear and accessible path to lodge a dispute. This feature provides:

1. A **single public URL** (`fcmanager.co.nz/dispute`) printed on every ticket.
2. A **QR Code** on physical tickets that deep-links to the specific notice.
3. A **multi-step flow** that requires only two pieces of identifying information (ticket number + vehicle registration) so that no account is needed.

---

## Service Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PUBLIC USER (Browser)                        │
│               https://fcmanager.co.nz/dispute                        │
└───────────────────────────┬─────────────────────────────────────────┘
                            │  HTTPS / REST
                            ▼
┌───────────────────────────────────────────────────────────────────────┐
│                     VERCEL  (React SPA Frontend)                       │
│                                                                        │
│  /dispute            — Global lookup form                              │
│  /d/[token]          — Direct deep-link from QR code                  │
│                                                                        │
│  Sends API calls to Railway backend (never directly to Supabase)      │
└───────────────────────────┬───────────────────────────────────────────┘
                            │  HTTPS / REST  (x-proxy-secret header)
                            ▼
┌───────────────────────────────────────────────────────────────────────┐
│                RAILWAY  (Node/Express TypeScript Backend)              │
│                                                                        │
│  POST /api/disputes/lookup   — Verify ticket + vehicle reg,           │
│                                return sanitised ticket + org branding  │
│  POST /api/disputes/submit   — Accept dispute text + evidence,        │
│                                orchestrate Supabase / Runpod / Postal │
│                                                                        │
│  • Validates inputs and rate-limits public traffic                     │
│  • Strips sensitive internal fields before responding to the browser   │
│  • Uses SUPABASE_SERVICE_ROLE_KEY for trusted DB writes                │
└──────────┬────────────────────────┬──────────────────┬────────────────┘
           │                        │                  │
           ▼                        ▼                  ▼
┌──────────────────┐  ┌─────────────────────┐  ┌──────────────────────┐
│  SUPABASE        │  │  RUNPOD  (AI)        │  │  POSTAL  (VPS Email) │
│                  │  │                      │  │                      │
│  • Looks up      │  │  • Receives dispute  │  │  • Sends HTML email  │
│    infringement  │  │    text + image URL  │  │    to claimant       │
│    notices table │  │  • Runs OCR / NLP    │  │    confirming receipt│
│  • Reads org     │  │    evidence analysis │  │  • Alerts org admin  │
│    branding      │  │  • Returns AI        │  │    of new dispute    │
│  • Writes        │  │    summary score     │  │  • Uses org-specific │
│    dispute       │  │                      │  │    sender alias      │
│    submission    │  │                      │  │                      │
│  • Stores        │  │                      │  │                      │
│    evidence to   │  │                      │  │                      │
│    Storage       │  │                      │  │                      │
└──────────────────┘  └─────────────────────┘  └──────────────────────┘
```

---

## Step-by-Step Flow

### Step 1 — Ticket Lookup (`POST /api/disputes/lookup`)

**Actor:** Public user on Vercel frontend.

| Field | Description |
|---|---|
| `ticket_number` | The infringement notice number printed on the physical ticket (e.g. `FCM-10042`). |
| `vehicle_reg` | The vehicle registration (license plate) listed on the ticket. |

**Railway actions:**

1. Validates that both fields are non-empty and within expected formats.
2. Queries Supabase `infringement_notices` table using the `service_role` key — matching on `notice_number` and `plate_number`.
3. Joins the `organizations` table to retrieve branding data (name, logo URL, primary colour, dispute instructions).
4. Strips all sensitive internal fields (officer name, financial routing, internal notes) before responding.
5. Returns a clean JSON payload the frontend uses to render the branded dispute form.

**Response shape:**

```json
{
  "ticket": {
    "id": "uuid",
    "notice_number": "FCM-10042",
    "plate_number": "ABC123",
    "offence_date": "2026-04-25T08:00:00+12:00",
    "offence_description": "Freedom camping in prohibited area",
    "fine_amount": 200,
    "due_date": "2026-05-25T23:59:59+12:00",
    "status": "issued"
  },
  "organization": {
    "name": "Camp Alpha Management",
    "logo_url": "https://…/logo.png",
    "primary_color": "#1e3a5f",
    "dispute_instructions": "Please describe your reason for dispute and attach any supporting evidence.",
    "dispute_email": "disputes@campalpha.co.nz"
  }
}
```

---

### Step 2 — Dispute Submission (`POST /api/disputes/submit`)

**Actor:** Public user submitting the completed dispute form on Vercel.

| Field | Type | Description |
|---|---|---|
| `ticket_id` | `string` | UUID returned from the lookup step. |
| `claimant_name` | `string` | Full name of the person lodging the dispute. |
| `claimant_email` | `string` | Contact email address. |
| `claimant_phone` | `string` (optional) | Contact phone number. |
| `dispute_reason` | `string` | Free-text explanation (max 2000 chars). |
| `evidence_image` | `string` (base64 or URL) | Optional photo evidence (permit, signage, etc.). |

**Railway actions:**

1. **Input validation** — sanitises all text fields; validates email format; limits text to 2000 characters.
2. **Evidence upload → Supabase Storage** — if an image is provided, validates it is a genuine image (PNG/JPEG/WEBP, ≤ 10 MB) and uploads it to the `dispute-evidence` storage bucket. Stores the resulting public URL.
3. **AI Analysis → Runpod** — POSTs the dispute text and evidence image URL to the configured Runpod serverless endpoint. The AI worker runs OCR on the image and an NLP summary of the text, returning a structured summary and a confidence score.
4. **Record write → Supabase** — INSERTs a row into `dispute_submissions` linking the `infringement_notice_id`, claimant contact details, dispute text, evidence URL, and AI analysis result.
5. **Confirmation email → Postal** — Calls the Postal HTTP API to:
   - Send a branded confirmation email to the claimant acknowledging receipt.
   - Send an internal alert to the organisation's dispute management inbox.
6. Returns `{ success: true, reference: "DS-…" }` to the frontend.

---

## Environment Variables

All variables below must be set in Railway's environment configuration.

| Variable | Service | Purpose |
|---|---|---|
| `PROXY_SECRET` | Railway | Shared secret that Vercel must include in every request as `x-proxy-secret`. Prevents public abuse of the API. |
| `SUPABASE_URL` | Supabase | Project URL (e.g. `https://xxxx.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Service-role JWT — used only server-side; never exposed to the browser. |
| `RUNPOD_API_KEY` | Runpod | API key for authenticating Runpod serverless calls. |
| `RUNPOD_ENDPOINT_ID` | Runpod | Serverless endpoint ID for the evidence-analysis worker. |
| `POSTAL_API_URL` | Postal VPS | Base URL of your self-hosted Postal server (e.g. `https://mail.fcmanager.co.nz`). |
| `POSTAL_API_KEY` | Postal VPS | API key issued by Postal for this mail server. |
| `SITE_URL` | Railway | Canonical public URL used in email links (e.g. `https://fcmanager.co.nz`). |

---

## Security Considerations

- The `x-proxy-secret` header prevents the public from calling Railway directly — all traffic must come through the Vercel frontend (or be issued a valid secret for server-to-server calls).
- The Supabase `service_role` key is **never** sent to the browser; it lives only on Railway.
- Rate limiting (`express-rate-limit`) applies to both dispute endpoints at 10 requests / minute / IP to prevent brute-force ticket enumeration.
- Both `ticket_number` and `vehicle_reg` must match to reveal any ticket data — a single field alone is not sufficient.
- Evidence images are validated for MIME type and maximum file size before upload.
- All user-supplied text is sanitised before being stored or embedded in HTML emails.

---

## QR Code Deep-Link Pattern

When an infringement notice is generated, the system stores a `secure_token` (random UUID / short ID) on the `infringement_notices` row. This token is embedded in a QR code printed on the physical ticket:

```
https://fcmanager.co.nz/d/<secure_token>
```

When scanned, the Vercel frontend calls `POST /api/disputes/lookup` with the token instead of the ticket number, skipping the manual entry step entirely.

The `lookup` endpoint accepts an optional `token` field as an alternative to `ticket_number` + `vehicle_reg`.

---

## Related Files

| File | Role |
|---|---|
| `proxy-server/server.js` | Railway Express server — hosts the dispute API routes. |
| `src/pages/Disputes.tsx` | Admin portal view for reviewing submitted disputes. |
| `supabase/functions/generate-infringement/index.ts` | Generates the infringement notice record (including `secure_token`). |
| `docs/DECISIONS.md` | Durable architecture decisions. |
| `docs/SECRETS_REGISTRY.md` | Canonical list of all environment variable secrets. |
