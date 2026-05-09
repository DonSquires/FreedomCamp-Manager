/**
 * NZSCV API PROXY SERVER
 * Provides static IP whitelisting for NZSCV Self-Contained Vehicle Registry API
 * Also provides email relay for edge functions: /api/email/send-report, /api/email/send-invite
 * 
 * Deploy this to: DigitalOcean Droplet, Railway, or Fly.io
 * Cost: $5-6/month for static IP
 * Deployment: git push proxy-server/** → GitHub Actions → Railway CLI → railway up
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const axios = require('axios');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

// Reject downgraded requests when a reverse proxy forwards protocol headers.
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    const forwardedProto = req.headers['x-forwarded-proto'];
    if (forwardedProto && String(forwardedProto).toLowerCase() !== 'https') {
      return res.status(400).json({ error: 'HTTPS required', message: 'Plain HTTP requests are not accepted in production.' });
    }
  }
  next();
});

// ---------------------------------------------------------------------------
// Security headers with helmet
// ---------------------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false, // Required for some API integrations
  hsts: {
    maxAge: 31536000, // 1 year in seconds
    includeSubDomains: true,
    preload: true,
  },
}));

// ---------------------------------------------------------------------------
// CORS configuration - strict allowlist for production
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
const DEFAULT_ORIGINS = [
  'https://freedomcampmanager.onspace.build',
  'https://fcmanager.co.nz',
  'https://www.fcmanager.co.nz',
];

// In development, allow localhost
if (process.env.NODE_ENV !== 'production') {
  DEFAULT_ORIGINS.push('http://localhost:5173', 'http://localhost:3000');
}

const allowedOrigins = new Set([...DEFAULT_ORIGINS, ...ALLOWED_ORIGINS]);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    // Check exact match
    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }
    
    // Check for preview subdomain pattern
    try {
      const url = new URL(origin);
      if (url.host.endsWith('.onspace.build') && url.host.startsWith('preview-react-9b4t5o-')) {
        return callback(null, true);
      }
    } catch {}
    
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-proxy-secret', 'x-client-info', 'apikey'],
  maxAge: 86400, // 24 hours
};

// ---------------------------------------------------------------------------
// Per-IP rate limiter — applied to all authenticated proxy routes.
// Default: 60 requests per minute per IP.  Override with PROXY_RATE_LIMIT_PER_MIN.
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = parseInt(process.env.PROXY_RATE_LIMIT_PER_MIN || '60', 10);
const rateLimitMiddleware = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', message: 'Rate limit exceeded. Please try again later.' },
});

// Escape untrusted strings for safe HTML interpolation
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validates the x-proxy-secret header.
 * Returns null when auth passes, or an Express-ready {status, body} when it fails.
 *
 * Two distinct cases:
 *  - PROXY_SECRET not configured  → 503  (mis-configured server, not a client fault)
 *  - PROXY_SECRET set but header missing/wrong → 401
 */
function checkProxyAuth(req) {
  if (!PROXY_SECRET) {
    return { status: 503, body: { error: 'Service not configured', message: 'PROXY_SECRET environment variable is not set on this server.' } };
  }
  const authHeader = req.headers['x-proxy-secret'];
  if (!authHeader || authHeader !== PROXY_SECRET) {
    return { status: 401, body: { error: 'Unauthorized', message: 'Invalid proxy authentication' } };
  }
  return null;
}

// Module-level email format validator (basic RFC 5322 subset — sufficient for
// pre-validation before the email is passed to a mail service).
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Environment variables validation
const NZSCV_API_KEY = process.env.NZSCV_API_KEY;
const NZSCV_ID_KEY = process.env.NZSCV_ID_KEY;
const NZSCV_BASE_URL = process.env.NZSCV_BASE_URL || 'https://www.nzscv.co.nz';
// NZSCV_ENDPOINT_URL overrides the full endpoint URL — set this to match the target
// environment (test or production). See proxy-server/.env.example for the correct values.
const NZSCV_ENDPOINT_URL = process.env.NZSCV_ENDPOINT_URL ||
  `${NZSCV_BASE_URL}/api/rest/scv/v1/vehicleregistrationinfo`;
const NZSCV_METHOD = (process.env.NZSCV_METHOD || '').toUpperCase();
const MOTORWEB_API_KEY = process.env.MOTORWEB_API_KEY;
const MOTORWEB_ID_KEY = process.env.MOTORWEB_ID_KEY;
const MOTORWEB_BASE_URL = process.env.MOTORWEB_BASE_URL || 'https://robot.motorweb.co.nz';
const PROXY_SECRET = process.env.PROXY_SECRET; // Secret to authenticate your Edge Functions
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USERNAME = process.env.SMTP_USERNAME;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const SMTP_FROM_EMAIL = process.env.SMTP_FROM_EMAIL;
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || 'FieldOps Manager';
const SMTP_REPORTS_FROM_EMAIL = process.env.SMTP_REPORTS_FROM_EMAIL || SMTP_FROM_EMAIL;
const SMTP_REPORTS_FROM_NAME = process.env.SMTP_REPORTS_FROM_NAME || 'FieldOps Reports';
const SITE_URL = process.env.SITE_URL || 'https://fcmanager.co.nz';

// Dispute flow — Supabase, Runpod, and Postal credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;
const POSTAL_API_URL = process.env.POSTAL_API_URL;
const POSTAL_API_KEY = process.env.POSTAL_API_KEY;

if (!MOTORWEB_API_KEY || !MOTORWEB_ID_KEY) {
  console.warn('⚠️  WARNING: MotorWeb API credentials not configured (enrichment will fail)');
}

if (!PROXY_SECRET) {
  console.warn('⚠️  WARNING: No PROXY_SECRET set. Anyone can use this proxy!');
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('⚠️  WARNING: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — dispute lookup/submit will return mock data');
}

if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
  console.warn('⚠️  WARNING: RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID not set — AI evidence analysis will be skipped');
}

if (!POSTAL_API_URL || !POSTAL_API_KEY) {
  console.warn('⚠️  WARNING: POSTAL_API_URL / POSTAL_API_KEY not set — dispute confirmation emails will be skipped');
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'NZSCV Proxy Server',
  });
});

// PTT stream multiplexing context resolver.
// Resolves whether a provider should stay in tactical stream or move into
// diplomatic/client stream based on contractor_jurisdictions delegation.
app.post('/api/ptt/multiplex-context', rateLimitMiddleware, async (req, res) => {
  try {
    const authResult = checkProxyAuth(req);
    if (authResult) {
      return res.status(authResult.status).json(authResult.body);
    }

    const providerOrgId = String(req.body?.provider_org_id || '').trim();
    const clientOrgId = String(req.body?.client_org_id || '').trim();
    const branchId = String(req.body?.branch_id || '').trim();

    if (!providerOrgId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'provider_org_id is required',
      });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(200).json({
        success: true,
        stream: 'tactical',
        tactical_channel: `org:${providerOrgId}`,
        diplomatic_channel: null,
        handshake_active: false,
        reason: 'supabase_not_configured',
      });
    }

    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    };

    const filters = [
      `provider_id=eq.${encodeURIComponent(providerOrgId)}`,
      'ptt_bridge_active=is.true',
    ];
    if (clientOrgId) filters.push(`client_id=eq.${encodeURIComponent(clientOrgId)}`);
    if (branchId) filters.push(`branch_id=eq.${encodeURIComponent(branchId)}`);

    const queryUrl = `${SUPABASE_URL}/rest/v1/contractor_jurisdictions` +
      `?select=id,provider_id,client_id,branch_id,access_level,ptt_bridge_active` +
      `&${filters.join('&')}` +
      '&limit=1';

    const supabaseRes = await axios.get(queryUrl, { headers, timeout: 10000 });
    const row = Array.isArray(supabaseRes.data) ? supabaseRes.data[0] : null;
    const isDelegated = !!row && ['enforce', 'admin'].includes(String(row.access_level || '').toLowerCase());

    return res.status(200).json({
      success: true,
      stream: isDelegated ? 'diplomatic' : 'tactical',
      tactical_channel: `org:${providerOrgId}`,
      diplomatic_channel: isDelegated ? `org:${row.client_id}` : null,
      handshake_active: isDelegated,
      access_level: row?.access_level || null,
      provider_org_id: providerOrgId,
      client_org_id: row?.client_id || clientOrgId || null,
      branch_id: row?.branch_id || branchId || null,
      reason: isDelegated ? 'contractor_jurisdiction_active' : 'no_active_contractor_jurisdiction',
    });
  } catch (error) {
    const isSchemaIssue = String(error?.response?.data?.message || '').toLowerCase().includes('contractor_jurisdictions');
    if (isSchemaIssue) {
      const providerOrgId = String(req.body?.provider_org_id || '').trim();
      return res.status(200).json({
        success: true,
        stream: 'tactical',
        tactical_channel: providerOrgId ? `org:${providerOrgId}` : null,
        diplomatic_channel: null,
        handshake_active: false,
        reason: 'contractor_jurisdictions_not_deployed',
      });
    }

    console.error('❌ multiplex-context error:', error?.response?.data || error?.message || error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to resolve PTT multiplex context',
    });
  }
});

// NZSCV API Proxy endpoint
app.post('/api/nzscv/vehicle-info', rateLimitMiddleware, async (req, res) => {
  try {
    const authResult = checkProxyAuth(req);
    if (authResult) {
      console.warn('🚫 Unauthorized proxy access attempt');
      return res.status(authResult.status).json(authResult.body);
    }

    const { RegistrationNumber } = req.body;

    if (!RegistrationNumber) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'RegistrationNumber is required'
      });
    }

    console.log('🔍 Proxy request for:', RegistrationNumber);

    const headers = {
      'PGDB-Authorization': NZSCV_API_KEY,
      'PGDB-Identifier': NZSCV_ID_KEY,
      'Content-Type': 'application/json',
    };

    const inferredMethod = NZSCV_METHOD || (NZSCV_ENDPOINT_URL.includes('/api/rest/info/') ? 'GET' : 'POST');
    let response;

    if (inferredMethod === 'GET') {
      response = await axios.get(NZSCV_ENDPOINT_URL, {
        headers,
        params: { RegistrationNumber },
        timeout: 10000,
      });
    } else {
      try {
        response = await axios.post(
          NZSCV_ENDPOINT_URL,
          { RegistrationNumber },
          {
            headers,
            timeout: 10000,
          }
        );
      } catch (postError) {
        // Some NZSCV environments expose a GET endpoint even when POST path looks valid.
        if (postError?.response?.status === 404 || postError?.response?.status === 405) {
          response = await axios.get(NZSCV_ENDPOINT_URL, {
            headers,
            params: { RegistrationNumber },
            timeout: 10000,
          });
        } else {
          throw postError;
        }
      }
    }

    console.log('✅ NZSCV Response:', response.data.StatusCode);

    // Forward response
    res.status(response.status).json(response.data);

  } catch (error) {
    console.error('❌ NZSCV API Error:', error.response?.data || error.message);

    if (error.response) {
      // NZSCV API returned an error
      res.status(error.response.status).json(error.response.data);
    } else if (error.code === 'ECONNABORTED') {
      // Timeout
      res.status(504).json({
        error: 'Gateway Timeout',
        message: 'NZSCV API request timed out'
      });
    } else {
      // Network or other error
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to connect to NZSCV API'
      });
    }
  }
});

// Invite email endpoint
app.post('/api/email/send-invite', rateLimitMiddleware, async (req, res) => {
  try {
    const authResult = checkProxyAuth(req);
    if (authResult) {
      console.warn('🚫 Unauthorized invite email request');
      return res.status(authResult.status).json(authResult.body);
    }

    if (!SMTP_HOST || !SMTP_USERNAME || !SMTP_PASSWORD || !SMTP_FROM_EMAIL) {
      return res.status(503).json({
        error: 'Email service not configured',
        code: 'SMTP_NOT_CONFIGURED',
        message: 'Set SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_EMAIL on proxy server.',
      });
    }

    if (SMTP_FROM_EMAIL.toLowerCase() !== SMTP_USERNAME.toLowerCase()) {
      return res.status(400).json({
        error: 'SMTP_FROM_EMAIL must match SMTP_USERNAME for reliable delivery.',
        code: 'SMTP_FROM_MISMATCH',
      });
    }

    const { email, first_name, invite_url } = req.body || {};
    if (!email || !invite_url) {
      return res.status(400).json({
        error: 'email and invite_url are required',
        code: 'INVALID_PAYLOAD',
      });
    }

    // Sanitise user-supplied values before embedding in HTML
    const safeFirstName = escapeHtml(first_name);
    const safeInviteUrl = encodeURI(invite_url);          // normalise URL
    const safeInviteUrlDisplay = escapeHtml(invite_url);  // display text (not href)
    const greeting = safeFirstName ? `Hi ${safeFirstName},` : 'Hi,';
    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#1e3a5f;padding:32px 40px;">
            <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">FieldOps Manager</h1>
            <p style="color:#93c5fd;margin:4px 0 0;font-size:13px;">Iron Eagle Security / OnSpace AI</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="font-size:16px;color:#374151;margin:0 0 16px;">${greeting}</p>
            <p style="font-size:15px;color:#374151;margin:0 0 16px;">
              You have been invited to join <strong>FieldOps Manager</strong>. Click below to set your password and access the platform.
            </p>
            <p style="text-align:center;margin:32px 0;">
              <a href="${safeInviteUrl}" style="background:#1e3a5f;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:15px;font-weight:600;display:inline-block;">
                Accept Invitation &amp; Set Password
              </a>
            </p>
            <p style="font-size:13px;color:#6b7280;margin:0 0 8px;">If the button does not work, copy and paste this link:</p>
            <p style="font-size:12px;color:#374151;word-break:break-all;background:#f9fafb;padding:12px;border-radius:4px;margin:0 0 24px;">${safeInviteUrlDisplay}</p>
            <p style="font-size:13px;color:#ef4444;margin:0 0 24px;">This link expires in <strong>24 hours</strong>.</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
            <p style="font-size:12px;color:#9ca3af;margin:0;">If you were not expecting this invitation, you can ignore this email.<br>
            Need help? Visit <a href="${SITE_URL}" style="color:#1e3a5f;">${SITE_URL}</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USERNAME,
        pass: SMTP_PASSWORD,
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });

    await transporter.sendMail({
      from: `${SMTP_FROM_NAME} <${SMTP_FROM_EMAIL}>`,
      to: email,
      subject: "You've been invited to FieldOps Manager",
      html,
      text: `${greeting}\n\nYou have been invited to FieldOps Manager.\n\nAccept your invitation and set your password:\n${safeInviteUrl}\n\nThis link expires in 24 hours.`
    });

    console.log('✅ Invite email sent:', email);
    return res.status(200).json({ message: 'Invite email sent' });
  } catch (error) {
    const message = String(error?.message || error || 'Unknown SMTP error').slice(0, 400);
    console.error('❌ Invite email error:', message);
    return res.status(500).json({
      error: 'Failed to send invite email',
      code: 'SMTP_SEND_FAILED',
      details: message,
    });
  }
});

// Report email relay endpoint (called by Supabase Edge Functions)
app.post('/api/email/send-report', rateLimitMiddleware, async (req, res) => {
  try {
    const authResult = checkProxyAuth(req);
    if (authResult) {
      console.warn('🚫 Unauthorized report email request');
      return res.status(authResult.status).json(authResult.body);
    }

    if (!SMTP_HOST || !SMTP_USERNAME || !SMTP_PASSWORD || !SMTP_REPORTS_FROM_EMAIL) {
      return res.status(503).json({
        error: 'Email service not configured',
        code: 'SMTP_NOT_CONFIGURED',
        message: 'Set SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, SMTP_REPORTS_FROM_EMAIL on proxy server.',
      });
    }

    const {
      recipient_email,
      subject,
      html,
      text,
      from_email,
      from_name,
      report_type,
    } = req.body || {};

    if (!recipient_email || !EMAIL_REGEX.test(String(recipient_email))) {
      return res.status(400).json({
        error: 'recipient_email is required and must be valid',
        code: 'INVALID_RECIPIENT',
      });
    }

    if (!subject || !html) {
      return res.status(400).json({
        error: 'subject and html are required',
        code: 'INVALID_PAYLOAD',
      });
    }

    const effectiveFromEmail = from_email || SMTP_REPORTS_FROM_EMAIL;
    const effectiveFromName = from_name || SMTP_REPORTS_FROM_NAME;

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USERNAME,
        pass: SMTP_PASSWORD,
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });

    await transporter.sendMail({
      from: `${effectiveFromName} <${effectiveFromEmail}>`,
      to: recipient_email,
      subject,
      html,
      text: text || `FieldOps report (${report_type || 'dashboard'}) attached in HTML body.`,
    });

    console.log('✅ Report email relayed:', recipient_email);
    return res.status(200).json({ success: true, delivery: 'proxy_relay' });
  } catch (error) {
    const message = String(error?.message || error || 'Unknown SMTP error').slice(0, 400);
    console.error('❌ Report relay error:', message);
    return res.status(500).json({
      error: 'Failed to relay report email',
      code: 'SMTP_SEND_FAILED',
      details: message,
    });
  }
});

// MotorWeb Current Owner Check endpoint
// PLACEHOLDER — MotorWeb API credentials (MOTORWEB_API_KEY, MOTORWEB_ID_KEY)
// have not been provisioned yet.  The endpoint returns 503 until credentials
// are configured via environment variables.
app.get('/motorweb/currentOwnerCheck', rateLimitMiddleware, async (req, res) => {
  try {
    const authResult = checkProxyAuth(req);
    if (authResult) {
      console.warn('🚫 Unauthorized MotorWeb access attempt');
      return res.status(authResult.status).json(authResult.body);
    }

    if (!MOTORWEB_API_KEY || !MOTORWEB_ID_KEY) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'MotorWeb API credentials not configured'
      });
    }

    const { plateOrVin, specificReason } = req.query;

    if (!plateOrVin) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'plateOrVin query parameter is required'
      });
    }

    const reason = specificReason || 'Freedom Camping Compliance Check';

    console.log('🔍 MotorWeb request for:', plateOrVin, '| Reason:', reason);

    // Call MotorWeb API
    const motorwebUrl = `${MOTORWEB_BASE_URL}/b2b/currentOwnerCheck/generate/4.0?plateOrVin=${encodeURIComponent(plateOrVin)}&specificReason=${encodeURIComponent(reason)}`;
    
    const response = await axios.get(motorwebUrl, {
      headers: {
        'PGDB-Authorization': MOTORWEB_API_KEY,
        'PGDB-Identifier': MOTORWEB_ID_KEY,
      },
      timeout: 15000, // 15 second timeout (MotorWeb can be slow)
    });

    console.log('✅ MotorWeb Response received (', response.data.length, 'chars)');

    // Return XML response
    res.set('Content-Type', 'text/xml');
    res.status(200).send(response.data);

  } catch (error) {
    console.error('❌ MotorWeb API Error:', error.response?.data || error.message);

    if (error.response) {
      // MotorWeb API returned an error
      res.set('Content-Type', error.response.headers['content-type'] || 'text/plain');
      res.status(error.response.status).send(error.response.data);
    } else if (error.code === 'ECONNABORTED') {
      // Timeout
      res.status(504).json({
        error: 'Gateway Timeout',
        message: 'MotorWeb API request timed out'
      });
    } else {
      // Network or other error
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to connect to MotorWeb API'
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Public Dispute Flow — Rate limiter (stricter: 10 req / min / IP)
// Prevents brute-force enumeration of ticket numbers.
// ---------------------------------------------------------------------------
const disputeRateLimitMiddleware = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', message: 'Rate limit exceeded. Please try again in a minute.' },
});

// ---------------------------------------------------------------------------
// POST /api/disputes/lookup
//
// Accepts { ticket_number, vehicle_reg } (or { token } for QR deep-links).
// Verifies the combination against the infringement_notices table in Supabase.
// Returns a sanitised ticket + organisation branding payload — sensitive
// internal fields (officer name, financial routing, internal notes) are
// deliberately stripped before the response is sent to the browser.
// ---------------------------------------------------------------------------
app.post('/api/disputes/lookup', disputeRateLimitMiddleware, async (req, res) => {
  try {
    const authResult = checkProxyAuth(req);
    if (authResult) {
      console.warn('🚫 Unauthorized dispute lookup attempt');
      return res.status(authResult.status).json(authResult.body);
    }

    const { ticket_number, vehicle_reg, token } = req.body || {};

    // At least one lookup strategy must be provided
    if (!token && (!ticket_number || !vehicle_reg)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Provide either a QR token or both ticket_number and vehicle_reg.',
      });
    }

    // Validate token format up-front (before any DB or mock path) to reject
    // malformed or potentially injected values early.
    if (token) {
      const trimmedToken = String(token).trim();
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmedToken)) {
        return res.status(400).json({ error: 'Bad Request', message: 'Invalid token format.' });
      }
    }

    // --- Supabase lookup ---
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      // Supabase not configured — return a mocked response so the frontend can
      // be developed and tested without live credentials.
      console.warn('⚠️  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — returning mock data');

      // Use the actual inputs when available, fall back to demo values for the
      // token-only path where ticket_number/vehicle_reg may not be present.
      const mockTicketNumber = escapeHtml(ticket_number || (token ? 'FCM-DEMO' : ticket_number));
      const mockVehicleReg   = escapeHtml(((vehicle_reg || (token ? 'DEMO01' : vehicle_reg)) || '').toUpperCase());

      return res.status(200).json({
        ticket: {
          id: 'mock-uuid-0000-0000-0000-000000000001',
          notice_number: mockTicketNumber || 'FCM-DEMO',
          plate_number: mockVehicleReg || 'DEMO01',
          offence_date: new Date().toISOString(),
          offence_description: 'Freedom camping in a prohibited area (mock)',
          fine_amount: 200,
          due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'issued',
        },
        organization: {
          name: 'Demo Camp Management',
          logo_url: null,
          primary_color: '#1e3a5f',
          dispute_instructions: 'Please describe your reason for dispute and attach any supporting evidence.',
          dispute_email: 'disputes@fcmanager.co.nz',
        },
      });
    }

    // Build Supabase query.
    // Use the REST API directly (no SDK dependency) so we keep the proxy-server
    // lean.  The service-role key is never forwarded to the browser.
    //
    // Maximum field lengths mirror the database column constraints:
    //   notice_number  VARCHAR(30)
    //   plate_number   VARCHAR(10)
    //   secure_token   VARCHAR(64)
    const NOTICE_NUMBER_MAX_LEN = 30;
    const PLATE_MAX_LEN         = 10;
    const TOKEN_MAX_LEN         = 64;
    // Columns fetched from Supabase — extracted to avoid duplication between query paths
    const SUPABASE_SELECT_FIELDS =
      'id,notice_number,plate_number,offence_date,offence_description,fine_amount,due_date,status,organization_id,' +
      'organizations(name,logo_url,primary_color,dispute_instructions,dispute_email)';

    let queryUrl;
    const supabaseHeaders = {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    };

    if (token) {
      // QR deep-link path — match on secure_token only.
      // Token already validated above; safe to encode directly.
      const safeToken = encodeURIComponent(String(token).trim().slice(0, TOKEN_MAX_LEN));
      queryUrl = `${SUPABASE_URL}/rest/v1/infringement_notices` +
        `?select=${SUPABASE_SELECT_FIELDS}` +
        `&secure_token=eq.${safeToken}` +
        `&status=neq.cancelled` +
        `&limit=1`;
    } else {
      // Manual entry path — require both ticket number AND vehicle reg
      const safeNoticeNumber = encodeURIComponent(String(ticket_number).trim().toUpperCase().slice(0, NOTICE_NUMBER_MAX_LEN));
      const safePlate        = encodeURIComponent(String(vehicle_reg).trim().toUpperCase().slice(0, PLATE_MAX_LEN));
      queryUrl = `${SUPABASE_URL}/rest/v1/infringement_notices` +
        `?select=${SUPABASE_SELECT_FIELDS}` +
        `&notice_number=eq.${safeNoticeNumber}` +
        `&plate_number=eq.${safePlate}` +
        `&status=neq.cancelled` +
        `&limit=1`;
    }

    const supabaseRes = await axios.get(queryUrl, { headers: supabaseHeaders, timeout: 10000 });
    const rows = supabaseRes.data;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No matching infringement notice found. Please check the ticket number and vehicle registration.',
      });
    }

    const row = rows[0];
    const org = row.organizations || {};

    // Return only the fields the public dispute form needs
    return res.status(200).json({
      ticket: {
        id:                  row.id,
        notice_number:       row.notice_number,
        plate_number:        row.plate_number,
        offence_date:        row.offence_date,
        offence_description: row.offence_description,
        fine_amount:         row.fine_amount,
        due_date:            row.due_date,
        status:              row.status,
      },
      organization: {
        name:                 org.name              || 'FieldOps Manager',
        logo_url:             org.logo_url          || null,
        primary_color:        org.primary_color     || '#1e3a5f',
        dispute_instructions: org.dispute_instructions || 'Please describe your reason for dispute.',
        dispute_email:        org.dispute_email     || null,
      },
    });

  } catch (error) {
    console.error('❌ Dispute lookup error:', error.response?.data || error.message);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to look up infringement notice.',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/disputes/submit
//
// Accepts the full dispute form payload:
//   { ticket_id, claimant_name, claimant_email, claimant_phone?,
//     dispute_reason, evidence_image? }
//
// Orchestrates:
//   1. Input validation + sanitisation
//   2. Evidence image upload → Supabase Storage
//   3. AI evidence analysis → Runpod serverless endpoint
//   4. Dispute record write → Supabase `dispute_submissions`
//   5. Confirmation emails  → Postal (claimant receipt + org admin alert)
// ---------------------------------------------------------------------------
app.post('/api/disputes/submit', disputeRateLimitMiddleware, async (req, res) => {
  try {
    const authResult = checkProxyAuth(req);
    if (authResult) {
      console.warn('🚫 Unauthorized dispute submit attempt');
      return res.status(authResult.status).json(authResult.body);
    }

    const {
      ticket_id,
      claimant_name,
      claimant_email,
      claimant_phone,
      dispute_reason,
      evidence_image,   // base64 data-URI or pre-signed URL string
    } = req.body || {};

    // ── 1. Input validation ──────────────────────────────────────────────
    if (!ticket_id || !claimant_name || !claimant_email || !dispute_reason) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'ticket_id, claimant_name, claimant_email, and dispute_reason are required.',
      });
    }

    if (!EMAIL_REGEX.test(claimant_email)) {
      return res.status(400).json({ error: 'Bad Request', message: 'Invalid email address.' });
    }

    if (String(dispute_reason).length > 2000) {
      return res.status(400).json({ error: 'Bad Request', message: 'dispute_reason must be 2000 characters or fewer.' });
    }

    const safeClaimantName   = escapeHtml(String(claimant_name).trim().slice(0, 100));
    const safeClaimantEmail  = String(claimant_email).trim().toLowerCase().slice(0, 254);
    const safeDisputeReason  = escapeHtml(String(dispute_reason).trim().slice(0, 2000));
    const safeClaimantPhone  = claimant_phone ? escapeHtml(String(claimant_phone).trim().slice(0, 30)) : null;

    // ── 2. Evidence image upload → Supabase Storage ──────────────────────
    // TODO: When SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are configured,
    //       replace this placeholder with a real upload.
    //
    // Steps:
    //   a. Validate that evidence_image is a genuine image (PNG/JPEG/WEBP).
    //   b. Reject files larger than 10 MB.
    //   c. Convert base64 data-URI to a Buffer.
    //   d. Upload to the 'dispute-evidence' Storage bucket via:
    //        PUT ${SUPABASE_URL}/storage/v1/object/dispute-evidence/${ticket_id}/${Date.now()}.jpg
    //      with Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}
    //   e. Capture the resulting public URL.
    let evidenceUrl = null;

    if (evidence_image) {
      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        console.warn('⚠️  Supabase Storage not configured — skipping evidence upload');
        evidenceUrl = '(evidence upload skipped — Supabase not configured)';
      } else {
        // PLACEHOLDER: Replace with real Supabase Storage upload
        // const imgBuffer = Buffer.from(evidence_image.replace(/^data:(image\/(?:png|jpeg|webp));base64,/, ''), 'base64');
        // NOTE: validate the MIME type prefix matches image/png, image/jpeg, or image/webp
        //       before extracting bytes — do NOT accept arbitrary MIME types.
        // const uploadPath = `${ticket_id}/${Date.now()}.jpg`;
        // await axios.put(
        //   `${SUPABASE_URL}/storage/v1/object/dispute-evidence/${uploadPath}`,
        //   imgBuffer,
        //   {
        //     headers: {
        //       'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        //       'Content-Type': 'image/jpeg',
        //     },
        //     timeout: 30000,
        //   }
        // );
        // evidenceUrl = `${SUPABASE_URL}/storage/v1/object/public/dispute-evidence/${uploadPath}`;
        console.log('📎 Evidence image received — upload placeholder active');
        evidenceUrl = null; // Replace with real upload logic above
      }
    }

    // ── 3. AI evidence analysis → Runpod ─────────────────────────────────
    // TODO: When RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID are configured,
    //       replace this placeholder with a real Runpod serverless call.
    //
    // Steps:
    //   a. POST to https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/runsync
    //      with Authorization: Bearer ${RUNPOD_API_KEY}
    //      body: { input: { dispute_text: safeDisputeReason, evidence_url: evidenceUrl } }
    //   b. The worker runs OCR on the image and NLP on the text.
    //   c. It returns { summary, confidence_score, ocr_text, flags[] }.
    //   d. Store the result as ai_analysis on the dispute record.
    let aiAnalysis = null;

    if (RUNPOD_API_KEY && RUNPOD_ENDPOINT_ID) {
      try {
        // PLACEHOLDER: Replace with real Runpod call
        // const runpodRes = await axios.post(
        //   `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/runsync`,
        //   { input: { dispute_text: safeDisputeReason, evidence_url: evidenceUrl } },
        //   {
        //     headers: { 'Authorization': `Bearer ${RUNPOD_API_KEY}`, 'Content-Type': 'application/json' },
        //     timeout: 60000,
        //   }
        // );
        // aiAnalysis = runpodRes.data?.output || null;
        console.log('🤖 Runpod AI analysis placeholder active');
      } catch (runpodError) {
        // Non-fatal — log and continue without AI analysis
        console.error('⚠️  Runpod analysis failed (non-fatal):', runpodError.message);
      }
    } else {
      console.warn('⚠️  RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID not set — skipping AI analysis');
    }

    // ── 4. Dispute record write → Supabase ───────────────────────────────
    // Generate a human-readable reference number for the submission
    const referenceNumber = `DS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.warn('⚠️  Supabase not configured — skipping dispute record write');
    } else {
      // PLACEHOLDER: Replace with real Supabase INSERT
      // await axios.post(
      //   `${SUPABASE_URL}/rest/v1/dispute_submissions`,
      //   {
      //     infringement_notice_id: ticket_id,
      //     reference_number:       referenceNumber,
      //     claimant_name:          safeClaimantName,
      //     claimant_email:         safeClaimantEmail,
      //     claimant_phone:         safeClaimantPhone,
      //     message:                safeDisputeReason,
      //     evidence_url:           evidenceUrl,
      //     ai_analysis:            aiAnalysis,
      //     status:                 'pending_review',
      //     source_type:            'public_portal',
      //     submitted_at:           new Date().toISOString(),
      //   },
      //   {
      //     headers: {
      //       'apikey':        SUPABASE_SERVICE_ROLE_KEY,
      //       'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      //       'Content-Type':  'application/json',
      //       'Prefer':        'return=representation',
      //     },
      //     timeout: 10000,
      //   }
      // );
      console.log('💾 Dispute record write placeholder active — reference:', referenceNumber);
    }

    // ── 5. Confirmation emails → Postal ──────────────────────────────────
    // TODO: When POSTAL_API_URL and POSTAL_API_KEY are configured,
    //       replace these placeholders with real Postal HTTP API calls.
    //
    // Postal API reference: https://docs.postalserver.io/developer/api
    //
    // Claimant confirmation email:
    //   POST ${POSTAL_API_URL}/api/v1/send/message
    //   X-Server-API-Key: ${POSTAL_API_KEY}
    //   body: { to: [safeClaimantEmail], from: "disputes@fcmanager.co.nz",
    //           subject: "Dispute Received — ${referenceNumber}", html_body: "…" }
    //
    // Organisation admin alert:
    //   POST ${POSTAL_API_URL}/api/v1/send/message
    //   X-Server-API-Key: ${POSTAL_API_KEY}
    //   body: { to: [<org_dispute_email>], from: "disputes@fcmanager.co.nz",
    //           subject: "New Dispute Submission — ${referenceNumber}", html_body: "…" }
    if (POSTAL_API_URL && POSTAL_API_KEY) {
      try {
        // PLACEHOLDER: Replace with real Postal API calls
        // const claimantHtml = `<p>Hi ${safeClaimantName},</p>
        //   <p>Your dispute <strong>${referenceNumber}</strong> has been received and is under review.</p>
        //   <p>We will contact you at ${safeClaimantEmail} with an outcome.</p>`;
        //
        // await axios.post(
        //   `${POSTAL_API_URL}/api/v1/send/message`,
        //   { to: [safeClaimantEmail], from: 'disputes@fcmanager.co.nz',
        //     subject: `Dispute Received — ${referenceNumber}`, html_body: claimantHtml },
        //   { headers: { 'X-Server-API-Key': POSTAL_API_KEY, 'Content-Type': 'application/json' }, timeout: 15000 }
        // );
        console.log('📧 Postal confirmation email placeholder active');
      } catch (postalError) {
        // Non-fatal — the dispute is already saved; email failure should not block the response
        console.error('⚠️  Postal email failed (non-fatal):', postalError.message);
      }
    } else {
      console.warn('⚠️  POSTAL_API_URL / POSTAL_API_KEY not set — skipping confirmation emails');
    }

    // ── 6. Success response ───────────────────────────────────────────────
    console.log(`✅ Dispute submitted: ${referenceNumber} for ticket ${ticket_id}`);
    return res.status(201).json({
      success: true,
      reference: referenceNumber,
      message: 'Your dispute has been received. You will receive a confirmation email shortly.',
    });

  } catch (error) {
    console.error('❌ Dispute submit error:', error.response?.data || error.message);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to submit dispute. Please try again or contact support.',
    });
  }
});

// Rate limiting info endpoint (optional)
app.get('/api/info', (req, res) => {
  res.json({
    service: 'NZSCV & MotorWeb Proxy Server',
    version: '1.1.0',
    endpoints: {
      health: 'GET /health',
      nzscvVehicleInfo: 'POST /api/nzscv/vehicle-info',
      motorwebOwnerCheck: 'GET /motorweb/currentOwnerCheck?plateOrVin=ABC123&specificReason=...',
      sendInviteEmail: 'POST /api/email/send-invite',
      sendReportEmail: 'POST /api/email/send-report',
      disputeLookup: 'POST /api/disputes/lookup',
      disputeSubmit: 'POST /api/disputes/submit',
    },
    rateLimit: {
      maxHitsPerSecond: 1,
      note: 'Both NZSCV and MotorWeb enforce 1 request/second limit'
    },
    motorwebConfigured: !!(MOTORWEB_API_KEY && MOTORWEB_ID_KEY),
    nzscvConfigured: !!(NZSCV_API_KEY && NZSCV_ID_KEY),
    nzscvEndpoint: NZSCV_ENDPOINT_URL,
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   🚀 Vehicle Registry Proxy Server   ║
  ╠═══════════════════════════════════════╣
  ║   Port: ${PORT.toString().padEnd(29)}║
  ║   Environment: ${(process.env.NODE_ENV || 'development').padEnd(22)}║
  ║   NZSCV: ${(NZSCV_API_KEY ? '✓ Configured' : '✗ Not configured').padEnd(26)}║
  ║   MotorWeb: ${(MOTORWEB_API_KEY ? '✓ Configured' : '✗ Not configured').padEnd(23)}║
  ╚═══════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT received, shutting down gracefully...');
  process.exit(0);
});
