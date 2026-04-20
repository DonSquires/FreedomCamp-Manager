# Modular Regulatory & Security Platform — Greenfield Build Plan

## Executive Summary

This document outlines the complete build plan for a **modular regulatory and security management platform** built from scratch. The platform is designed as a **standalone, white-label system** with a **CRM-centric hub** and pluggable service modules that can be individually licensed to clients and service providers.

**Target Market**: Security companies, councils, parking operators, noise control services, and any organization requiring field officer management and regulatory compliance.

**Business Model**: SaaS with per-module licensing — organizations pay only for the modules they need.

**Design Principles**:
- **100% Standalone** — No vendor lock-in, fully self-hosted option available
- **White-label** — Rebrandable for different operators
- **CRM-Centric** — Organizations, Users, and Zones all managed through the CRM as the central entity hub
- **Iron Eagle Ownership** — Iron Eagle Security is hardcoded as the platform owner
- **3rd Party APIs** — Integrate with existing services (NZSCV, Motoweb, OpenAI)
- **Self-hosted AI** — Option to run your own ALPR/inference on Railway

---

## Platform Owner

**Iron Eagle Security** is the platform owner and has ultimate control over all aspects of the system. This is hardcoded in the system initialization:

```sql
-- Platform owner (hardcoded - cannot be changed)
INSERT INTO organizations (
  id, name, organization_type, organization_level
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Iron Eagle Security',
  'platform_owner',
  0  -- Root level
) ON CONFLICT DO NOTHING;
```

The platform owner can:
- Create service provider accounts
- Assign modules to any organization
- View all data across all organizations
- Configure platform-wide settings
- Access all administrative functions

---

## Part 1: Platform Architecture

### 1.1 High-Level Architecture (CRM-Centric Model)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      REGULATORY/SECURITY PLATFORM                                │
│               (White-label, Standalone, Iron Eagle Owned)                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ╔════════════════════════════════════════════════════════════════════════════╗ │
│  ║                    CRM HUB (Central Entity Management)                      ║ │
│  ║ ┌──────────────────────────────────────────────────────────────────────┐   ║ │
│  ║ │  ACCOUNTS (Organizations)                                             │   ║ │
│  ║ │  ┌─────────────────────────────────────────────────────────────────┐ │   ║ │
│  ║ │  │ Iron Eagle Security (Platform Owner - Level 0)                  │ │   ║ │
│  ║ │  │    ├── Service Providers (Level 1) - contracted security cos    │ │   ║ │
│  ║ │  │    │      └── Clients (Level 2) - councils, property managers   │ │   ║ │
│  ║ │  │    └── Contractors (Level 1) - independent officers             │ │   ║ │
│  ║ │  └─────────────────────────────────────────────────────────────────┘ │   ║ │
│  ║ └──────────────────────────────────────────────────────────────────────┘   ║ │
│  ║ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐   ║ │
│  ║ │    USERS      │ │  ZONES/SITES  │ │   CONTRACTS   │ │   CONTACTS    │   ║ │
│  ║ │ (Assigned to  │ │ (Owned by     │ │ (Between      │ │ (Per-account  │   ║ │
│  ║ │  accounts)    │ │  accounts)    │ │  accounts)    │ │  stakeholders)│   ║ │
│  ║ └───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘   ║ │
│  ║ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐   ║ │
│  ║ │   INVOICES    │ │   PAYMENTS    │ │  ACTIVITIES   │ │ OPPORTUNITIES │   ║ │
│  ║ │ (Billing)     │ │ (Receipts)    │ │ (Tasks/Calls) │ │ (Pipeline)    │   ║ │
│  ║ └───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘   ║ │
│  ║ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐                     ║ │
│  ║ │   DOCUMENTS   │ │    NOTES      │ │     TAGS      │                     ║ │
│  ║ │ (Attachments) │ │ (Freeform)    │ │ (Categories)  │                     ║ │
│  ║ └───────────────┘ └───────────────┘ └───────────────┘                     ║ │
│  ╚════════════════════════════════════════════════════════════════════════════╝ │
│                                      │                                           │
│  ┌───────────────────────────────────┴────────────────────────────────────────┐ │
│  │                      CORE PLATFORM SERVICES                                 │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │ │
│  │  │   Auth   │ │ Tracking │ │ Welfare  │ │ PTT/Chat │ │  Audit   │         │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘         │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                      │ │
│  │  │ Reports  │ │  Notify  │ │ Billing  │ │ Bug Sys  │                      │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘                      │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                           │
│  ┌───────────────────────────────────┴────────────────────────────────────────┐ │
│  │                     3RD PARTY INTEGRATIONS                                  │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │ │
│  │  │  NZSCV   │ │ Motoweb  │ │  OpenAI  │ │ ParkPow  │ │  Stripe  │         │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘         │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                           │
│                    ┌─────────────────┼─────────────────┐                        │
│                    │                 │                 │                        │
│  ┌─────────────────┴───┐ ┌──────────┴──────────┐ ┌────┴─────────────────┐     │
│  │   SERVICE MODULES   │ │  SERVICE MODULES    │ │   SERVICE MODULES    │     │
│  ├─────────────────────┤ ├─────────────────────┤ ├──────────────────────┤     │
│  │ • Freedom Camping   │ │ • Guarding          │ │ • Rostering          │     │
│  │ • Parking           │ │ • Patrol            │ │ • Dispatch           │     │
│  │ • Noise Control     │ │ • EMS               │ │ • Ticketing          │     │
│  │ • Ticketing         │ │ • Incidents         │ │                      │     │
│  └─────────────────────┘ └─────────────────────┘ └──────────────────────┘     │
│       ENFORCEMENT             SECURITY                OPERATIONS              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Comprehensive CRM Features

The CRM Hub includes **11 core feature areas** that provide complete customer relationship management:

| Feature | Description | Key Tables |
|---------|-------------|------------|
| **Accounts** | Hierarchical organization management (Iron Eagle → Providers → Clients) | `organizations` |
| **Users** | User management with role-based access | `user_profiles` |
| **Zones/Sites** | Geographic and physical location management | `zones`, `client_sites` |
| **Contacts** | Named stakeholders at accounts (not system users) | `crm_contacts` |
| **Contracts** | Service agreements with SLA terms and line items | `crm_contracts`, `crm_contract_lines` |
| **Invoices** | Billing with line items and aging reports | `crm_invoices`, `crm_invoice_lines` |
| **Payments** | Payment tracking with Stripe integration | `crm_payments` |
| **Activities** | Calls, meetings, tasks, follow-ups | `crm_activities` |
| **Opportunities** | Sales pipeline with stage management | `crm_opportunities` |
| **Documents** | File attachments for any entity | `crm_documents` |
| **Notes** | Freeform notes with privacy controls | `crm_notes` |

**Additional Features:**
- **Tags** — Flexible categorization for accounts, contacts, and opportunities
- **Account History** — Complete audit trail of all changes
- **Aging Reports** — Overdue invoice tracking
- **Pipeline Reports** — Weighted opportunity value by stage

### 1.3 CRM-Centric Data Model

The CRM acts as the **central entity hub** for the entire platform:

```
                           ┌─────────────────────┐
                           │    ACCOUNTS         │
                           │   (Organizations)   │
                           │                     │
                           │ • Iron Eagle (L0)   │
                           │ • Providers (L1)    │
                           │ • Clients (L2)      │
                           └──────────┬──────────┘
                                      │
           ┌──────────────┬───────────┼───────────┬──────────────┐
           │              │           │           │              │
     ┌─────┴─────┐  ┌─────┴─────┐ ┌───┴───┐ ┌─────┴─────┐ ┌──────┴──────┐
     │  USERS    │  │  ZONES    │ │ SITES │ │ CONTACTS  │ │ CONTRACTS   │
     │           │  │           │ │       │ │           │ │             │
     │ Belong to │  │ Owned by  │ │Managed│ │ Named     │ │ Terms       │
     │ accounts  │  │ accounts  │ │  by   │ │ people    │ │ between     │
     │           │  │           │ │       │ │ at accts  │ │ accounts    │
     └───────────┘  └───────────┘ └───────┘ └───────────┘ └─────────────┘
```

**Key Relationships:**
- Every **User** belongs to an **Account** (organization)
- Every **Zone** is owned by an **Account**
- Every **Site** is managed by an **Account** (may be a client)
- Every **Contract** links a service provider to a client
- Every **Contact** is associated with an **Account**

### 1.3 Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Frontend** | React 18 + TypeScript + Vite | Fast builds, type safety, modern DX |
| **UI Components** | Tailwind CSS + shadcn/ui (Radix) | Consistent design system, accessible |
| **State Management** | Zustand + TanStack Query | Simple global state + powerful data fetching |
| **Forms** | react-hook-form + zod | Type-safe validation |
| **Routing** | react-router-dom v6 | Industry standard |
| **Backend** | Supabase (PostgreSQL + Edge Functions) | Rapid development, real-time, auth built-in |
| **Self-hosted AI** | Node.js + ONNX Runtime on RunPod | ALPR, face recognition, OCR |
| **Real-time Comms** | WebSocket + WebRTC | PTT, live tracking |
| **Package Manager** | Bun | Fast installs and builds |

### 1.3 3rd Party API Integrations

| Service | Purpose | API Type | Required? |
|---------|---------|----------|-----------|
| **NZSCV** | NZ Self-Contained Vehicle registry lookup | REST API | Optional (NZ only) |
| **Motoweb/NZTA** | NZ vehicle registration details | REST API | Optional (NZ only) |
| **OpenAI** | AI-powered analysis, report generation | REST API | Optional |
| **ParkPow/Plate Recognizer** | Cloud ALPR, parking management | REST API | Optional |
| **Stripe** | Payment processing, subscriptions | REST API | Required for billing |
| **SendGrid/Resend** | Transactional email | REST API | Optional |
| **Twilio** | SMS notifications | REST API | Optional |

### 1.4 Self-Hosted AI Services (Railway)

Instead of relying on external AI services, you can deploy your own inference service on Railway:

```
┌─────────────────────────────────────────────────────────────────┐
│                    INFERENCE SERVICE (Railway)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Node.js + ONNX Runtime                                         │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ENDPOINTS                                                    ││
│  │                                                              ││
│  │ POST /alpr          → License plate recognition (OCR)       ││
│  │ POST /face/encode   → Face encoding for recognition         ││
│  │ POST /face/compare  → Face comparison (1:1)                 ││
│  │ POST /face/search   → Face search (1:N)                     ││
│  │ POST /ocr           → Document text extraction              ││
│  │ GET  /health        → Service health check                  ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  MODELS (ONNX format)                                           │
│  • yolov8-plate-detector.onnx    — Plate detection             │
│  • lprnet-ocr.onnx               — Plate OCR                   │
│  • arcface-r100.onnx             — Face encoding               │
│  • retinaface-r50.onnx           — Face detection              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Benefits of self-hosted AI:**
- No per-API-call costs
- Full data privacy (images never leave your infrastructure)
- Customizable models for NZ plates
- Works offline/air-gapped if needed

### 1.5 Multi-Tenant Organization Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                    PLATFORM OPERATOR (Level 0)                   │
│                    "Your Company Ltd"                            │
│                    Role: grand_master                            │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ SERVICE       │   │ SERVICE         │   │ SERVICE         │
│ PROVIDER      │   │ PROVIDER        │   │ PROVIDER        │
│ "Security Co" │   │ "Allied Sec"    │   │ "Council X"     │
│ Level 1       │   │ Level 1         │   │ Level 1         │
│ Role: master  │   │ Role: master    │   │ Role: master    │
└───────────────┘   └─────────────────┘   └─────────────────┘
        │                     │
        ▼                     ▼
┌───────────────┐   ┌─────────────────┐
│ CLIENT        │   │ CLIENT          │
│ "Mall Corp"   │   │ "Event Venue"   │
│ Level 2       │   │ Level 2         │
│ Role: admin   │   │ Role: admin     │
└───────────────┘   └─────────────────┘
```

---

## Part 2: The Core Platform

The Core Platform is the foundation that **all service modules depend on**. It is always included and cannot be disabled.

### 2.1 Core Capabilities

| Capability | Description | Key Features |
|------------|-------------|--------------|
| **Authentication** | User identity & session management | Email/password, SSO, MFA, session tokens |
| **Authorization** | Role-based access control | Roles: grand_master, master, admin, admin_officer, officer, client_viewer |
| **Organizations** | Multi-tenant hierarchy | Parent/child orgs, data isolation, RLS |
| **User Profiles** | Officer & staff management | Credentials, certifications, compliance tracking |
| **Zones & Sites** | Geographic management | Geofencing, GPS boundaries, site addresses |
| **Live Tracking** | Real-time officer locations | GPS streaming, breadcrumb trails, geofence alerts |
| **Welfare System** | Officer safety monitoring | Check-in reminders, panic/SOS button, man-down detection, escalation workflows |
| **Audit Logging** | Complete action history | Who did what, when, with what data |
| **Notifications** | System-wide alerting | Push, email, SMS, in-app |
| **Reporting Engine** | Base report infrastructure | PDF generation, CSV export, scheduled reports |
| **Billing & Licensing** | Module subscriptions | Per-module pricing, usage metering, invoicing |
| **White-label Config** | Branding customization | Logo, colors, domain, email templates |
| **Self-Healing Bug System** | AI-powered bug detection & analysis | Auto error capture, AI diagnosis, fix suggestions, CI status integration |
| **PTT & Team Chat** | Real-time officer communication | Push-to-talk (WebRTC), team channels, direct messaging, VOX mode |

### 2.1.1 Self-Healing Bug System (Core Feature)

The platform includes an AI-powered bug detection and analysis system that automatically:

1. **Captures Errors Automatically** — Browser console errors, unhandled exceptions, and performance issues are captured in real-time
2. **AI-Powered Analysis** — Uses OpenAI (or self-hosted LLM) to diagnose issues and suggest fixes
3. **CI Status Integration** — Optionally pulls GitHub Actions status to include build context
4. **Escalation Workflow** — Auto-acknowledges reports, escalates unresolved issues
5. **No User Action Required** — Fire-and-forget background analysis

```typescript
// Auto-error capture → AI analysis → fix suggestion
useAutoErrorReporter()  // Captures console errors automatically
edgeFunctions.autoAnalyseReport({ report_id })  // AI diagnoses the issue
```

**AI Analysis Flow:**
```
User encounters error → Auto-captured → Bug report created
                                              ↓
                                        AI Analysis triggered
                                              ↓
                            ┌─────────────────┴─────────────────┐
                            ↓                                   ↓
                    Fetch CI status (optional)           Build diagnosis prompt
                            ↓                                   ↓
                            └─────────────────┬─────────────────┘
                                              ↓
                                    Call AI (OpenAI/Copilot)
                                              ↓
                                    Store diagnosis + fix suggestion
                                              ↓
                                    Update report status
```

### 2.1.2 PTT & Team Chat (Core Feature)

Real-time voice and text communication for field officers:

**Push-to-Talk Features:**
- **WebRTC-based** — Low latency, peer-to-peer audio
- **Half-duplex** — One speaker at a time per channel (radio-style)
- **Channel Types:**
  - `org:<id>` — Organization-wide broadcast
  - `team:<id>` — Team/deployment scoped
  - `incident:<id>` — Incident-specific
  - `direct:<user_id>` — 1:1 private calls
- **VOX Mode** — Voice-activated transmission
- **Bluetooth PTT** — Support for external PTT buttons
- **Fallback** — Audio clips uploaded to storage if WebRTC fails

**Infrastructure:**
```
┌─────────────────────────────────────────────────────────────────┐
│                    PTT SIGNALING SERVER (hPanel VPS 72.61.123.97)           │
├─────────────────────────────────────────────────────────────────┤
│  WebSocket-based signaling for WebRTC peer connections          │
│  • JWT authentication via ptt-signaling-token Edge Function     │
│  • Channel management (create, join, leave)                     │
│  • Presence tracking (online, busy, off-shift)                  │
│  • ICE server configuration (STUN + TURN)                       │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BROWSER/MOBILE CLIENT                         │
├─────────────────────────────────────────────────────────────────┤
│  • Hold-to-talk button (PTT mode)                               │
│  • Voice activity detection (VOX mode)                          │
│  • Active speaker indicator                                      │
│  • Channel selector                                              │
│  • Presence display (who's listening)                           │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1.3 Officer Welfare System (Core Feature)

Comprehensive safety monitoring for field officers:

**Welfare Check Features:**
- **Scheduled Check-ins** — Configurable intervals (e.g., every 30 minutes)
- **Overdue Alerts** — Automatic escalation when check-in missed
- **Panic/SOS Button** — 3-second hold to prevent accidental triggers
- **Man-Down Detection** — Accelerometer-based fall detection (mobile)
- **Multi-Level Escalation:**
  - Level 0: Peer notification
  - Level 1: Admin/supervisor notification
  - Level 2: High priority alert
  - Level 3: Critical (external notification)

**Escalation Timeline:**
```
Check-in due → 5 min overdue → Peer alert (Level 0)
                    ↓
              10 min overdue → Admin escalation (Level 1)
                    ↓
              15 min overdue → High priority (Level 2)
                    ↓
              30 min overdue → CRITICAL (Level 3)
                    ↓
              External notification (SMS to emergency contact)
```

**UI Components:**
- `FieldSafetyBar` — Always-visible safety strip on officer portals
- `OfficerWelfareWarningModal` — Full-screen alert requiring response
- `OfficerWelfareSettings` — Admin configuration page

### 2.2 Core Database Schema (CRM-Centric)

```sql
-- =============================================================================
-- CORE PLATFORM SCHEMA (CRM-Centric, Iron Eagle Owned)
-- =============================================================================

-- Platform configuration (white-label settings)
CREATE TABLE platform_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Branding
  platform_name TEXT NOT NULL DEFAULT 'Iron Eagle Security Platform',
  logo_url TEXT,
  favicon_url TEXT,
  primary_color TEXT DEFAULT '#3b82f6',
  
  -- Contact
  support_email TEXT DEFAULT 'support@ironeaglesecurity.co.nz',
  support_phone TEXT,
  
  -- Legal
  terms_url TEXT,
  privacy_url TEXT,
  
  -- API Keys (encrypted)
  nzscv_api_key_encrypted TEXT,
  motoweb_api_key_encrypted TEXT,
  openai_api_key_encrypted TEXT,
  stripe_api_key_encrypted TEXT,
  
  -- Feature toggles
  enable_nzscv_integration BOOLEAN DEFAULT FALSE,
  enable_motoweb_integration BOOLEAN DEFAULT FALSE,
  enable_openai_integration BOOLEAN DEFAULT FALSE,
  enable_self_hosted_ai BOOLEAN DEFAULT TRUE,
  
  -- AI Service URL (Railway deployment)
  inference_service_url TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- CRM HUB: ACCOUNTS (Organizations)
-- =============================================================================
-- The CRM Hub manages all accounts (organizations) in a hierarchical structure:
--   Level 0: Platform Owner (Iron Eagle Security - hardcoded)
--   Level 1: Service Providers & Contractors
--   Level 2: Clients (of service providers)
-- =============================================================================

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  
  -- Account type determines capabilities
  organization_type TEXT NOT NULL CHECK (organization_type IN (
    'platform_owner',    -- Iron Eagle Security (Level 0, only one)
    'service_provider',  -- Security companies (Level 1)
    'client',           -- Councils, property managers (Level 2)
    'contractor'        -- Independent contractors (Level 1)
  )),
  
  -- Hierarchy level (0 = root, 1 = provider/contractor, 2 = client)
  organization_level INTEGER NOT NULL DEFAULT 1,
  parent_organization_id UUID REFERENCES organizations(id),
  
  -- Contact info
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  
  -- Business details
  business_registration_number TEXT,
  gst_number TEXT,
  
  -- White-label overrides (optional)
  custom_logo_url TEXT,
  custom_primary_color TEXT,
  
  -- Settings
  timezone TEXT DEFAULT 'Pacific/Auckland',
  country_code TEXT DEFAULT 'NZ',
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Billing
  stripe_customer_id TEXT,
  billing_email TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hardcoded platform owner (Iron Eagle Security)
-- This is inserted on database initialization and cannot be deleted
INSERT INTO organizations (
  id,
  name,
  organization_type,
  organization_level,
  parent_organization_id,
  contact_email,
  is_active
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Iron Eagle Security',
  'platform_owner',
  0,
  NULL,
  'admin@ironeaglesecurity.co.nz',
  TRUE
) ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- CRM HUB: USERS
-- =============================================================================
-- All users belong to an account (organization)
-- =============================================================================

CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  
  -- Role & org assignment
  role TEXT NOT NULL CHECK (role IN (
    'grand_master',   -- Platform owner superuser
    'master',         -- Organization admin
    'admin',          -- Department admin
    'admin_officer',  -- Officer with admin rights
    'officer',        -- Field officer
    'client_viewer'   -- Read-only client access
  )),
  
  -- Account assignment (which org this user belongs to)
  organization_id UUID REFERENCES organizations(id),
  
  -- Employer (for contractors assigned to clients)
  employer_organization_id UUID REFERENCES organizations(id),
  
  -- Officer-specific
  job_title TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- CRM HUB: CONTACTS
-- =============================================================================
-- Named people at accounts (not system users, just contact info)
-- =============================================================================

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  
  -- Contact details
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  mobile TEXT,
  
  -- Role at the organization
  job_title TEXT,
  department TEXT,
  is_primary BOOLEAN DEFAULT FALSE,  -- Primary contact for the account
  
  -- Notes
  notes TEXT,
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- CRM HUB: CONTRACTS
-- =============================================================================
-- Contracts link service providers to clients
-- =============================================================================

CREATE TABLE contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Parties (service provider → client)
  provider_organization_id UUID NOT NULL REFERENCES organizations(id),
  client_organization_id UUID NOT NULL REFERENCES organizations(id),
  
  -- Contract details
  contract_number TEXT,
  name TEXT NOT NULL,
  description TEXT,
  
  -- Dates
  start_date DATE NOT NULL,
  end_date DATE,
  auto_renew BOOLEAN DEFAULT FALSE,
  
  -- Value
  contract_value_cents INTEGER,
  billing_frequency TEXT CHECK (billing_frequency IN ('monthly', 'quarterly', 'annually')),
  
  -- Status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'pending_approval', 'active', 'suspended', 'expired', 'cancelled'
  )),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contract line items (services included)
CREATE TABLE contract_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  
  -- Service details
  module_id TEXT NOT NULL,  -- References service module
  description TEXT,
  
  -- Pricing
  unit_price_cents INTEGER NOT NULL,
  quantity INTEGER DEFAULT 1,
  billing_type TEXT CHECK (billing_type IN ('fixed', 'per_seat', 'per_transaction', 'hourly')),
  
  -- SLA
  sla_response_minutes INTEGER,
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- CRM HUB: ZONES
-- =============================================================================
-- Geographic zones owned by accounts
-- =============================================================================

CREATE TABLE zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  description TEXT,
  
  -- Geography
  location_lat DECIMAL(10, 7),
  location_lng DECIMAL(10, 7),
  geometry JSONB,  -- GeoJSON polygon
  
  -- Zone type (module-agnostic)
  zone_type TEXT DEFAULT 'general',
  
  -- Settings
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- CRM HUB: SITES
-- =============================================================================
-- Physical sites managed by accounts
-- =============================================================================

CREATE TABLE client_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  
  -- Site details
  name TEXT NOT NULL,
  address TEXT,
  
  -- Geography
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  geofence_radius_meters INTEGER DEFAULT 100,
  
  -- Contact (on-site)
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  
  -- Service details
  contract_id UUID REFERENCES contracts(id),
  service_notes TEXT,
  
  -- Settings
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- CORE: LIVE OFFICER TRACKING
-- =============================================================================

CREATE TABLE officer_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id UUID NOT NULL REFERENCES user_profiles(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  
  -- Position
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  accuracy DECIMAL(10, 2),
  heading DECIMAL(5, 2),
  speed DECIMAL(6, 2),
  
  -- Context
  zone_id UUID REFERENCES zones(id),
  activity_status TEXT DEFAULT 'active',
  
  -- Timestamp
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- CORE: OFFICER WELFARE
-- =============================================================================

CREATE TABLE officer_welfare_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id UUID NOT NULL REFERENCES user_profiles(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  
  -- Check details
  check_type TEXT NOT NULL CHECK (check_type IN ('scheduled', 'manual', 'panic')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'ok', 'missed', 'escalated')),
  
  -- Timestamps
  scheduled_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  escalated_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(id),
  organization_id UUID REFERENCES organizations(id),
  
  -- Action details
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  
  -- Data
  old_values JSONB,
  new_values JSONB,
  metadata JSONB,
  
  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(id),
  organization_id UUID REFERENCES organizations(id),
  
  -- Content
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  
  -- Delivery
  channels TEXT[] DEFAULT '{"in_app"}',
  read_at TIMESTAMPTZ,
  
  -- Reference
  entity_type TEXT,
  entity_id UUID,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- MODULE SUBSCRIPTION SYSTEM
-- =============================================================================

-- Service modules registry
CREATE TABLE service_modules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('enforcement', 'security', 'operations', 'communication')),
  
  -- Display
  icon_name TEXT NOT NULL,
  color TEXT NOT NULL,
  display_order INTEGER DEFAULT 100,
  
  -- Pricing defaults (cents)
  default_billing_model TEXT NOT NULL CHECK (default_billing_model IN ('seat', 'transaction', 'hybrid', 'flat')),
  default_base_fee_cents INTEGER DEFAULT 0,
  default_per_seat_fee_cents INTEGER DEFAULT 0,
  default_per_transaction_fee_cents INTEGER DEFAULT 0,
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  is_core BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Organization module subscriptions
CREATE TABLE organization_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL REFERENCES service_modules(id),
  
  -- Subscription
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trial', 'suspended', 'cancelled')),
  
  -- Licensing
  licensed_seats INTEGER,  -- NULL = unlimited
  
  -- Billing
  billing_model TEXT NOT NULL,
  base_fee_cents INTEGER DEFAULT 0,
  per_seat_fee_cents INTEGER DEFAULT 0,
  per_transaction_fee_cents INTEGER DEFAULT 0,
  
  -- Trial
  trial_ends_at TIMESTAMPTZ,
  
  -- Audit
  enabled_at TIMESTAMPTZ DEFAULT NOW(),
  enabled_by UUID REFERENCES user_profiles(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (organization_id, module_id)
);

-- Usage events (for billing)
CREATE TABLE module_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  module_id TEXT NOT NULL REFERENCES service_modules(id),
  
  -- Event
  event_type TEXT NOT NULL,
  event_id UUID,
  billable_units INTEGER DEFAULT 1,
  
  -- Billing
  billing_period TEXT,  -- 'YYYY-MM'
  billed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- 3RD PARTY API CACHE (to reduce API calls and costs)
-- =============================================================================

-- NZSCV cache (Self-Contained Vehicle lookups)
CREATE TABLE nzscv_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number TEXT NOT NULL UNIQUE,
  
  -- NZSCV response data
  is_self_contained BOOLEAN,
  certificate_number TEXT,
  expiry_date DATE,
  vehicle_type TEXT,
  
  -- Cache metadata
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Motoweb cache (Vehicle registration lookups)
CREATE TABLE motoweb_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number TEXT NOT NULL UNIQUE,
  
  -- Motoweb response data
  make TEXT,
  model TEXT,
  year INTEGER,
  color TEXT,
  body_type TEXT,
  fuel_type TEXT,
  rego_expiry DATE,
  wof_expiry DATE,
  
  -- Cache metadata
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Part 3: 3rd Party API Integration Details

### 3.1 NZSCV (NZ Self-Contained Vehicle Registry)

**Purpose**: Check if a vehicle has a valid self-contained certificate for freedom camping compliance.

```typescript
// src/lib/integrations/nzscv.ts

interface NZSCVResponse {
  plate_number: string
  is_self_contained: boolean
  certificate_number?: string
  expiry_date?: string
  vehicle_type?: string
}

export async function checkNZSCV(plateNumber: string): Promise<NZSCVResponse> {
  // Check cache first
  const cached = await getCachedNZSCV(plateNumber)
  if (cached && !isExpired(cached.expires_at)) {
    return cached
  }

  // Call NZSCV API
  const response = await fetch(`${NZSCV_API_URL}/vehicles/${plateNumber}`, {
    headers: {
      'Authorization': `Bearer ${NZSCV_API_KEY}`,
      'Content-Type': 'application/json',
    },
  })

  const data = await response.json()
  
  // Cache the response
  await cacheNZSCVResponse(plateNumber, data)
  
  return data
}
```

### 3.2 Motoweb/NZTA (Vehicle Registration)

**Purpose**: Get vehicle details (make, model, year, color) from NZ registration database.

```typescript
// src/lib/integrations/motoweb.ts

interface MotowebResponse {
  plate_number: string
  make: string
  model: string
  year: number
  color: string
  body_type: string
  rego_expiry: string
  wof_expiry: string
}

export async function checkMotoweb(plateNumber: string): Promise<MotowebResponse> {
  // Check cache first
  const cached = await getCachedMotoweb(plateNumber)
  if (cached && !isExpired(cached.expires_at)) {
    return cached
  }

  // Call Motoweb API
  const response = await fetch(`${MOTOWEB_API_URL}/vehicle/${plateNumber}`, {
    headers: {
      'X-API-Key': MOTOWEB_API_KEY,
      'Content-Type': 'application/json',
    },
  })

  const data = await response.json()
  
  // Cache the response
  await cacheMotowebResponse(plateNumber, data)
  
  return data
}
```

### 3.3 OpenAI Integration (Optional AI Features)

**Purpose**: AI-powered features like report analysis, incident summarization, smart search.

```typescript
// src/lib/integrations/openai.ts

export async function analyzeIncidentReport(report: string): Promise<{
  summary: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  categories: string[]
  suggestedActions: string[]
}> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: INCIDENT_ANALYSIS_PROMPT },
        { role: 'user', content: report },
      ],
      response_format: { type: 'json_object' },
    }),
  })

  return response.json()
}
```

### 3.4 Self-Hosted AI Service (Railway)

**Purpose**: Run your own ALPR and face recognition without per-API-call costs.

```javascript
// inference-service/server.js (deployed on Railway)

const express = require('express')
const ort = require('onnxruntime-node')

const app = express()

// Load ONNX models
let plateDetector, plateOCR, faceDetector, faceEncoder

async function loadModels() {
  plateDetector = await ort.InferenceSession.create('./models/yolov8-plate.onnx')
  plateOCR = await ort.InferenceSession.create('./models/lprnet-ocr.onnx')
  faceDetector = await ort.InferenceSession.create('./models/retinaface.onnx')
  faceEncoder = await ort.InferenceSession.create('./models/arcface.onnx')
}

// ALPR endpoint
app.post('/alpr', async (req, res) => {
  const { image } = req.body  // Base64 image
  
  // Detect plate region
  const plateRegion = await detectPlate(plateDetector, image)
  
  // OCR the plate
  const plateText = await recognizePlate(plateOCR, plateRegion)
  
  res.json({
    plate_number: plateText,
    confidence: plateRegion.confidence,
    bbox: plateRegion.bbox,
  })
})

// Face encoding endpoint
app.post('/face/encode', async (req, res) => {
  const { image } = req.body
  
  // Detect face
  const faceRegion = await detectFace(faceDetector, image)
  
  // Generate embedding
  const embedding = await encodeFace(faceEncoder, faceRegion)
  
  res.json({
    embedding: Array.from(embedding),
    bbox: faceRegion.bbox,
  })
})

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    models_loaded: !!(plateDetector && plateOCR && faceDetector && faceEncoder),
  })
})

loadModels().then(() => {
  app.listen(process.env.PORT || 3001)
})
```

---

## Part 4: Service Modules

Each service module is a **self-contained vertical** that plugs into the Core Platform. Modules can be enabled/disabled per organization.

### 4.1 Module Inventory

#### 4.1.1 ENFORCEMENT Modules

| Module | Description | Key Features | 3rd Party APIs |
|--------|-------------|--------------|----------------|
| **Freedom Camping** | Vehicle compliance for camping zones | Plate scanning (ALPR), overnight tracking, breach detection, notice to vacate | NZSCV (SCV check), Motoweb (vehicle details), Self-hosted ALPR |
| **Parking Enforcement** | Parking violation management | Chalking, time limits, infringement notices, permits | ParkPow (optional), Self-hosted ALPR |
| **Noise Control** | Noise complaint management | Job dispatch, abatement notices (RMA s.326-328), equipment seizures | None required |
| **Ticketing & Infringements** | Infringement notice system | Fine issuance, dispute handling, payment tracking, court referrals, reminders | Stripe (payments), Email/SMS |

#### 4.1.2 SECURITY Modules

| Module | Description | Key Features | 3rd Party APIs |
|--------|-------------|--------------|----------------|
| **Site Guarding** | Static site security | Checkpoint verification, visitor logs, face recognition, POI/trespass lists | Self-hosted Face Recognition |
| **General Patrol** | Mobile patrol operations | Route tracking, alarm response, checkpoint hits, lone worker protocol | None required |
| **EMS Response** | Emergency coordination | Triage, dispatch, patient tracking | None required |
| **Incident Management** | Incident reporting & evidence | Incident creation, H&S reports, investigations, court-ready PDFs, witness statements | None required |

#### 4.1.3 OPERATIONS Modules

| Module | Description | Key Features | 3rd Party APIs |
|--------|-------------|--------------|----------------|
| **Rostering** | Shift scheduling | Visual roster board, availability, shift swaps, timesheets, payroll export | None required |
| **CRM** | Customer relationships | Accounts (clients/contractors), contacts, contracts, SLA tracking | None required |
| **Dispatch Console** | CAD-style dispatch | Job queue, officer status, proximity-based assignment, multi-service dispatch | None required |

#### 4.1.4 COMMUNICATION Modules (Included in Core)

| Module | Description | Key Features | 3rd Party APIs |
|--------|-------------|--------------|----------------|
| **PTT & Chat** | Real-time comms | Push-to-talk (WebRTC), channels, VOX mode, Bluetooth PTT, team chat | PTT Server (VPS 72.61.123.97) |

### 4.2 Complete Module Summary

| Module | Category | Pricing Model | Base Fee | Per Seat | Per Transaction |
|--------|----------|---------------|----------|----------|-----------------|
| Core Platform | - | Included | $0 | $0 | - |
| Freedom Camping | Enforcement | Seat | $149/mo | $29/seat | - |
| Parking Enforcement | Enforcement | Seat | $149/mo | $29/seat | - |
| Noise Control | Enforcement | Seat | $99/mo | $19/seat | - |
| Ticketing & Infringements | Enforcement | Hybrid | $199/mo | $29/seat | $1/ticket |
| Site Guarding | Security | Seat | $299/mo | $49/seat | - |
| General Patrol | Security | Seat | $199/mo | $39/seat | - |
| EMS Response | Security | Hybrid | $149/mo | $29/seat | $0.50/event |
| Incident Management | Security | Seat | $149/mo | $29/seat | - |
| Rostering | Operations | Seat | $99/mo | $19/seat | - |
| CRM | Operations | Seat | $99/mo | $19/seat | - |
| Dispatch Console | Operations | Seat | $149/mo | $29/seat | - |
| PTT & Chat | Communication | Included | $0 | $0 | - |

### 4.3 Module Feature Details

#### Ticketing & Infringements Module

A comprehensive infringement notice and fine management system:

**Notice Types:**
- **Warning Notice** — First-time courtesy notice (no fine)
- **Infringement Notice** — FCA/RMA fines ($200-$400 typical)
- **Breach Notice** — Formal compliance notice
- **Notice to Vacate** — Legal prohibition on re-entry
- **Seizure Receipt** — Equipment seizure under RMA s.328
- **Tow Request** — Request towing authority

**Status Workflow:**
```
Issued → Reminder Sent (14 days) → Reminder Sent (28 days) → Court Referred
                    ↓                          ↓
                   Paid                      Disputed → Reviewed → Withdrawn/Upheld
```

**Features:**
- Server-rendered PDF notices with QR codes
- OCR barcode for scanning
- Dispute intake portal (public-facing)
- Payment tracking (Stripe integration optional)
- Court referral workflow
- Automated reminder emails at 14/28 days
- Revenue reporting
- Officer certification (digital signatures)

**Database Tables:**
- `infringement_notices` — Notice records
- `infringement_notice_counters` — Sequential numbering
- `enforcement_actions` — Action tracking
- `enforcement_cases` — Case grouping
- `dispute_submissions` — Public disputes
- `payment_records` — Payment tracking

---

#### Incident Management Module

Comprehensive incident reporting for security events, H&S incidents, and investigations:

**Incident Types:**
- Site security incidents
- Health & Safety events
- Enforcement violations
- Person interactions
- Camera review requests
- Police referrals

**Features:**
- Multi-step incident creation form
- Evidence attachment (photos, documents)
- Witness statement capture
- Person of Interest (POI) linking
- Police involvement flag
- Camera review requests
- Investigation job creation
- Court-ready PDF generation
- Chronological incident timeline
- Bulk operations for admins

**Investigation Jobs:**
- Job templates for common scenarios
- Job type classification (NOISE, PARKING, SECURITY, etc.)
- Status workflow: `pending` → `assigned` → `en_route` → `on_scene` → `completed`
- Officer briefing with prior incidents
- Permanent END (Enforcement Notice Direction) flags

**Database Tables:**
- `incidents` — Incident records
- `incident_attachments` — Evidence files
- `investigation_jobs` — Investigation tracking
- `investigation_job_types` — Job classification
- `health_safety_reports` — H&S events
- `person_interactions` — Person incident history
- `witness_statements` — Witness records

---

## Part 5: Build Phases

### Phase 1: Core Platform Foundation (Weeks 1-4)

**Goal**: Build the foundational platform that all modules depend on.

#### Week 1: Project Setup & Auth
- [ ] Initialize Vite + React + TypeScript project
- [ ] Configure Tailwind CSS + shadcn/ui
- [ ] Set up Supabase project
- [ ] Create core database schema (orgs, users, zones)
- [ ] Implement authentication (login, logout, session)
- [ ] Build login page UI
- [ ] Create platform_config table for white-label settings

#### Week 2: User & Organization Management
- [ ] Build organization CRUD
- [ ] Build user profile CRUD
- [ ] Implement role-based access control
- [ ] Create organization hierarchy logic
- [ ] Build user management UI
- [ ] Build organization settings UI

#### Week 3: Zones, Tracking & Welfare
- [ ] Build zone management CRUD
- [ ] Implement geofencing logic
- [ ] Build live officer tracking (GPS ingest)
- [ ] Create real-time location streaming
- [ ] Build welfare check system
- [ ] Create live tracking map UI

#### Week 4: Core Infrastructure
- [ ] Build audit logging system
- [ ] Create notification system
- [ ] Build base reporting engine
- [ ] Create module subscription system
- [ ] Build platform admin dashboard
- [ ] Create settings & profile pages

### Phase 2: Self-Hosted AI Service (Week 5)

**Goal**: Deploy ALPR and face recognition on Railway.

#### Week 5: AI Service
- [ ] Set up Railway project
- [ ] Deploy inference service (Node.js + ONNX)
- [ ] Integrate ALPR models (YOLOv8 + LPRNet)
- [ ] Integrate face recognition models (RetinaFace + ArcFace)
- [ ] Create health check endpoints
- [ ] Test end-to-end image processing

### Phase 3: First Module — Freedom Camping (Weeks 6-8)

**Goal**: Build the first complete service module.

#### Week 6: Scanning & Compliance
- [ ] Create vehicle canonical table
- [ ] Build camera capture UI
- [ ] Integrate with self-hosted ALPR
- [ ] Create NZSCV integration (optional)
- [ ] Create Motoweb integration (optional)
- [ ] Implement compliance engine

#### Week 7: Enforcement Workflow
- [ ] Build breach alert system
- [ ] Create notice to vacate workflow
- [ ] Implement infringement notices
- [ ] Build enforcement action tracking
- [ ] Create admin breach management UI

#### Week 8: Module Polish
- [ ] Build vehicle history views
- [ ] Create compliance dashboard
- [ ] Implement zone-specific rules
- [ ] Add offline scanning support
- [ ] Testing & bug fixes

### Phase 4: Parking & Noise Modules (Weeks 9-11)

Similar structure to Phase 3...

### Phase 5: Security Modules (Weeks 12-14)

Similar structure...

### Phase 6: Operations Modules (Weeks 15-17)

Similar structure...

### Phase 7: Billing & Polish (Weeks 18-20)

- [ ] Integrate Stripe for payments
- [ ] Build usage metering
- [ ] Create invoice generation
- [ ] Final testing & documentation

---

## Part 6: Project Structure

```
platform/
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   │
│   ├── components/
│   │   ├── ui/                    # shadcn/ui
│   │   ├── layout/
│   │   └── features/
│   │
│   ├── modules/                   # SERVICE MODULES
│   │   ├── registry.ts            # Module definitions
│   │   ├── core/
│   │   ├── freedom-camping/
│   │   ├── parking/
│   │   ├── noise/
│   │   ├── guarding/
│   │   ├── patrol/
│   │   ├── rostering/
│   │   ├── ptt-chat/
│   │   ├── crm/
│   │   └── dispatch/
│   │
│   ├── lib/
│   │   ├── supabase.ts
│   │   └── integrations/          # 3RD PARTY APIS
│   │       ├── nzscv.ts
│   │       ├── motoweb.ts
│   │       ├── openai.ts
│   │       └── inference.ts       # Self-hosted AI
│   │
│   └── ...
│
├── supabase/
│   ├── migrations/
│   └── functions/
│
├── inference-service/             # SELF-HOSTED AI (Railway)
│   ├── server.js
│   ├── models/
│   │   ├── yolov8-plate.onnx
│   │   ├── lprnet-ocr.onnx
│   │   ├── retinaface.onnx
│   │   └── arcface.onnx
│   └── package.json
│
├── ptt-server/                    # PTT SIGNALING (hPanel VPS 72.61.123.97)
│   └── server.js
│
└── docs/
```

---

## Part 7: Pricing Summary

| Module | Base/mo | Per Seat | Per Transaction |
|--------|---------|----------|-----------------|
| **Core** | Included | — | — |
| Freedom Camping | $199 | $29 | $0.05/scan |
| Parking | $249 | $39 | $0.10/infringement |
| Noise Control | $149 | $29 | $0.25/job |
| Guarding | $299 | $49 | — |
| Patrol | $199 | $39 | — |
| Rostering | $99 | $19 | — |
| PTT/Chat | $49 | $9 | — |
| CRM | $99 | $19 | — |
| EMS | $149 | $29 | $0.50/incident |
| Dispatch | $149 | $29 | — |

**Bundle Discounts**: 3+ modules: 10% off | 5+ modules: 15% off | All modules: 25% off

---

## Part 8: Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     PRODUCTION DEPLOYMENT                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  VERCEL / CLOUDFLARE PAGES                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Frontend (React SPA)                                    │   │
│  │  • Static hosting with CDN                               │   │
│  │  • Environment variables for API URLs                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                      │
│                           ▼                                      │
│  SUPABASE                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  • PostgreSQL database (with RLS)                        │   │
│  │  • Edge Functions (API endpoints)                        │   │
│  │  • Auth (user management)                                │   │
│  │  • Storage (file uploads)                                │   │
│  │  • Realtime (live updates)                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                      │
│                           ▼                                      │
│  RAILWAY                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Service 1: Inference Service (ALPR, Face Recognition)  │   │
│  │  Service 2: PTT Signaling Server (WebSocket)            │   │
│  │  Service 3: Proxy Server (NZSCV, Motoweb)               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Part 9: Next Steps

1. **Approve this build plan**
2. **Set up development environment**
   - Create Supabase project
   - Create Railway project
   - Initialize Git repository
3. **Begin Phase 1** (Core Platform)
4. **Weekly progress reviews**
5. **Milestone demos** at end of each phase

---

*Document Version: 3.0 — Standalone/White-label Build*  
*Created: 2026-03-31*  
*Author: Development Team*
