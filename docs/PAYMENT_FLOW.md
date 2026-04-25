# Payment Flow — Multi-Tenant Architecture

> **Audience**: Developers and architects maintaining the FieldOps Manager platform.  
> **Last updated**: 2026-04-25  
> **Relates to**: `docs/DISPUTE_FLOW.md`, `docs/RAILWAY_INTEGRATION.md`, `docs/SYSTEM_GUIDE.md`

---

## 1. The Challenge

New Zealand councils and organisations operating under the Freedom Camping Act have strict
financial compliance requirements:

- They cannot allow a third party to hold or commingle infringement fee revenue.
- Many councils have existing contracts with payment processors (typically
  **Windcave / Payment Express** or Datacom portals) that cannot be replaced by a
  platform-level Stripe account.
- Funds **must flow directly** from the payer into the respective organisation's bank
  account or gateway merchant account — no intermediary pooling.

This means FieldOps Manager must adapt to each organisation's payment constraints rather
than imposing a single gateway.

---

## 2. The Hybrid Solution

The system supports three payment modes, selected per-organisation via a `payment_config`
JSONB column on the `organizations` table (see §3).

### Option 1 — Redirect to Legacy Council Portal

**When used:** The council already operates a public payment portal (e.g. Windcave-hosted
page) and does not want to share API credentials.

**How it works:**

1. The Vercel frontend looks up the infringement ticket via the Railway payment-config
   endpoint.
2. `payment_config.type` is `"redirect"`.
3. The frontend renders a **"Pay Infringement"** button that navigates the user to the
   council's portal URL, appending the ticket reference and amount as query parameters:

   ```
   https://payments.example-council.govt.nz/pay?ref=FCM-10042&amount=200
   ```

4. The council's portal processes the payment independently.
5. Reconciliation is handled offline (see §4.1 — nightly SFTP/CSV import).

**Sequence:**

```
Payer (browser)
    │  GET /pay/FCM-10042
    ▼
Vercel (React)
    │  GET /api/payment-config/:ticketRef   ← Railway
    ▼
Railway
    │  SELECT payment_config FROM organizations …  ← Supabase
    ▼
Vercel renders: [Pay via Council Portal ↗]
    │  User clicks → redirect to council URL
    ▼
Council Payment Portal (external)
    │  Payment processed — council handles confirmation
    ▼
Railway cron (nightly): import SFTP CSV → mark ticket 'paid' in Supabase
```

---

### Option 2 — Direct API / Bring Your Own Gateway (BYOG)

**When used:** The organisation is comfortable providing their Windcave or Stripe API keys
to the platform so that checkout happens seamlessly inside the FieldOps Manager UI.

**How it works:**

1. An admin for the organisation enters their gateway credentials in the Organisation
   Settings page. Railway stores them **encrypted** (AES-256-GCM via Supabase Vault /
   Railway environment secrets — never in plaintext in the DB).
2. `payment_config.type` is `"windcave_api"` or `"stripe_api"`.
3. The Vercel frontend renders a credit-card input form directly on the payment page.
4. On submission, Vercel sends the card token/nonce to Railway
   (`POST /api/payments/process`).
5. Railway retrieves the organisation's encrypted API keys, constructs the payment
   request, and calls the gateway on behalf of the organisation.
6. Funds are deposited directly into the **organisation's merchant account** — FieldOps
   Manager never receives or holds the funds.
7. On gateway success, Railway immediately updates `infringement_notices.status` to
   `'paid'` and records the `payment_reference` in Supabase.
8. Railway triggers a confirmation email via the Postal VPS (see `docs/EMAIL_SETUP.md`).

**Sequence:**

```
Payer (browser)
    │  GET /pay/FCM-10042
    ▼
Vercel (React)
    │  GET /api/payment-config/:ticketRef   ← Railway
    ▼
Railway → Supabase (fetch payment_config, ticket details)
    │  Returns: { type: "windcave_api", amount: 200, ref: "FCM-10042" }
    ▼
Vercel renders: [Credit Card Form]
    │  User fills card details → POST /api/payments/process
    ▼
Railway
    │  Fetches encrypted API key from vault
    │  POST https://sec.windcave.com/api/…   ← Windcave / Stripe
    ▼
Gateway response: success
    │
Railway
    ├─ UPDATE infringement_notices SET status='paid', payment_reference=… ← Supabase
    └─ POST to Postal VPS → confirmation email to payer + org admin
    ▼
Vercel renders: "Payment Successful ✓"
```

---

### Option 3 — Manual Bank Transfer

**When used:** The organisation does not operate an online gateway and prefers manual
reconciliation (common for small councils or interim configurations).

**How it works:**

1. `payment_config.type` is `"bank_transfer"`.
2. The Vercel frontend displays the organisation's bank account number and the required
   payment reference (the ticket number), e.g.:

   ```
   Please transfer $200.00 to:
   Bank Account: 01-1234-5678901-00
   Reference: FCM-10042
   ```

3. This data is rendered directly from `payment_config` returned by Railway.
4. Reconciliation is manual — an admin marks the ticket as paid after verifying the
   bank statement.

---

## 3. Database Schema — Supabase

### 3.1 New Column: `organizations.payment_config`

```sql
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS payment_config JSONB DEFAULT NULL;

COMMENT ON COLUMN public.organizations.payment_config IS
  'Multi-tenant payment routing configuration. '
  'Null = no payment feature enabled for this org. '
  'See docs/PAYMENT_FLOW.md §3 for full schema.';
```

See the full migration: `supabase/migrations/20260613000001_organizations_payment_config.sql`

### 3.2 `payment_config` JSON Schema

All three options share the `type` discriminator field:

**Option 1 — Redirect:**

```json
{
  "type": "redirect",
  "payment_url": "https://payments.example-council.govt.nz/pay",
  "url_params": {
    "ref_param":    "ref",
    "amount_param": "amount"
  }
}
```

**Option 2 — Windcave API (BYOG):**

```json
{
  "type": "windcave_api",
  "merchant_id": "abc123",
  "api_key_secret_name": "ORG_UUID_WINDCAVE_API_KEY"
}
```

> `api_key_secret_name` is the key name inside the Supabase Vault / Railway environment
> secrets store. The actual key is **never stored in the JSONB column**.

**Option 2 — Stripe API (BYOG):**

```json
{
  "type": "stripe_api",
  "publishable_key": "pk_live_…",
  "secret_key_secret_name": "ORG_UUID_STRIPE_SECRET_KEY"
}
```

**Option 3 — Bank Transfer:**

```json
{
  "type": "bank_transfer",
  "bank_account": "01-1234-5678901-00",
  "account_name": "Example District Council",
  "reference_prefix": "FCM"
}
```

### 3.3 Relevant Existing Columns on `infringement_notices`

The `infringement_notices` table already has the columns required to track payment state:

| Column | Type | Purpose |
|--------|------|---------|
| `status` | `TEXT` | `'draft' → 'issued' → 'paid'` (or `'reminder_sent'`, `'court_referred'`) |
| `fee_amount` | `NUMERIC(10,2)` | The fine amount |
| `payment_reference` | `TEXT` | Reference stored after successful payment |
| `payment_methods` | `JSONB` | Legacy: `['bank_transfer', 'online']` array on the notice |
| `payment_deadline` | `DATE` | Due date shown to the payer |

---

## 4. Integration with Existing Architecture

### 4.1 Vercel (Frontend)

The public-facing payment page lives at two routes:

| Route | Description |
|-------|-------------|
| `/pay` | Generic lookup — enter Ticket # + vehicle registration |
| `/pay/[token]` | Direct link from QR code / SMS (same token model as `/d/[token]` in `DISPUTE_FLOW.md`) |

**Rendering logic (pseudo-code):**

```tsx
const { paymentConfig, ticket } = usePaymentConfig(ticketRef)

if (paymentConfig.type === 'redirect') {
  return <RedirectButton url={buildRedirectUrl(paymentConfig, ticket)} />
}

if (paymentConfig.type === 'windcave_api' || paymentConfig.type === 'stripe_api') {
  return <CheckoutForm ticket={ticket} />
}

if (paymentConfig.type === 'bank_transfer') {
  return <BankTransferInstructions config={paymentConfig} ticket={ticket} />
}
```

The frontend **never receives the raw API keys** — only the `payment_config` shape that
Railway has sanitised for public display.

### 4.2 Railway (Backend)

Railway orchestrates all secure payment operations.  
Current Railway services (see `docs/RAILWAY_INTEGRATION.md`):

| Service | Location | Purpose |
|---------|----------|---------|
| `proxy-server` | `proxy-server/` | NZSCV / MotorWeb proxy |

**New endpoints to implement:**

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/payment-config/:ticketRef` | Returns sanitised `payment_config` + ticket details for Vercel to render the correct UI. Strips sensitive fields (API key names). |
| `POST` | `/api/payments/process` | Accepts card token/nonce. Retrieves org API keys from vault. Calls Windcave or Stripe. On success updates Supabase + triggers email. |
| `POST` | `/api/payments/nightly-reconcile` | Cron endpoint (triggered by Railway cron schedule). Downloads SFTP CSV from legacy council portals and marks matching tickets as `paid` in Supabase. |

**Security rules for Railway payment endpoints:**

1. All endpoints validate a `Bearer` token (Supabase JWT) to prevent unauthenticated calls.
2. `GET /api/payment-config/:ticketRef` additionally requires matching ticket reference +
   vehicle registration (dual-auth, same as dispute lookup — see `DISPUTE_FLOW.md §3`).
3. API keys for BYOG gateways are stored in Railway environment secrets (injected at
   runtime) and are **never written to Supabase**.
4. All payment requests and responses are logged to `supabase.public.payment_audit_log`
   (write-only from Railway service role) for compliance.

### 4.3 Supabase

Supabase acts as the source of truth for:

- Organisation `payment_config` (which mode to use).
- `infringement_notices` status transitions (`issued → paid`).
- `payment_audit_log` — append-only compliance log written by Railway.

Supabase Edge Functions are **not** used in the payment critical path to avoid timeout
risk during gateway calls. Railway handles all gateway communication directly.

Row Level Security ensures:

- Public users can only read the specific notice they authenticated against (ticket # +
  registration).
- Only Railway's service-role key can write to `payment_audit_log`.
- Organisation admins can read their org's payment activity; they cannot read another
  org's `payment_config` API key names.

---

## 5. Alignment with DISPUTE_FLOW.md

| Concept | Dispute Flow | Payment Flow |
|---------|-------------|--------------|
| Public entry point | `/dispute` + `/d/[token]` | `/pay` + `/pay/[token]` |
| Dual-auth lookup | Ticket # + license plate | Ticket # + license plate |
| Railway role | Sanitises data, orchestrates AI + email | Sanitises payment config, orchestrates gateway + email |
| Supabase write | `disputes` table, evidence storage | `infringement_notices.status`, `payment_audit_log` |
| Email notifications | Payer acknowledgement + org alert | Payment receipt + org notification |
| Token / QR code | `infringements.secure_token` | Shared `secure_token` — one QR covers both dispute and pay |

The `secure_token` on an infringement notice can deep-link to either the dispute page
(`/d/[token]`) or the payment page (`/pay/[token]`), giving a single QR code on the
physical ticket that lets the payer choose which action to take.

---

## 6. Environment Variables

### Railway Payment Service

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key for DB writes (payment audit log, status updates) |
| `PAYMENT_WEBHOOK_SECRET` | Shared HMAC secret to validate Vercel → Railway payment requests |
| `ORG_{UUID}_WINDCAVE_API_KEY` | Per-org Windcave key (one variable per enrolled org) |
| `ORG_{UUID}_STRIPE_SECRET_KEY` | Per-org Stripe secret key (one variable per enrolled org) |
| `SFTP_RECONCILE_HOST` | Hostname of council SFTP server (for Option 1 nightly reconciliation) |
| `SFTP_RECONCILE_KEY` | Private key for SFTP authentication |

### Vercel (Frontend)

| Variable | Description |
|----------|-------------|
| `VITE_RAILWAY_PAYMENT_URL` | Base URL of Railway payment service |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (public) |

> **Never** expose `SUPABASE_SERVICE_ROLE_KEY` or gateway API keys to the Vercel frontend.

---

## 7. Security Checklist

- [ ] Gateway API keys are stored only in Railway environment secrets — never in Supabase JSONB.
- [ ] `GET /api/payment-config` strips `api_key_secret_name` / `secret_key_secret_name` fields before responding to the frontend.
- [ ] All Railway payment endpoints require a valid Supabase JWT.
- [ ] The dual-auth check (ticket # + registration) is enforced server-side in Railway, not just in the UI.
- [ ] `payment_audit_log` uses an append-only RLS policy — no UPDATE or DELETE permitted.
- [ ] HTTPS is enforced end-to-end (Vercel → Railway → Gateway).
- [ ] PCI DSS scope: because FieldOps Manager never stores raw card numbers (only tokens/nonces from the gateway SDK), the system operates outside PCI DSS Level 1 scope.

---

## 8. Future Considerations

- **Partial Payments / Payment Plans**: Not in scope for v1. The `payment_config` schema is extensible to support an `instalment_plan` type.
- **Refunds**: Railway would need a `POST /api/payments/refund` endpoint that calls the gateway's refund API. Requires auditing in `payment_audit_log`.
- **Multi-Currency**: Currently NZD only. Windcave and Stripe both support currency selection as a config parameter.
- **In-Person Payments**: A future `eftpos_terminal` type in `payment_config` could support Verifone/Ingenico SDK integration for officer-side collections.
