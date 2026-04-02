/**
 * NZSCV API PROXY SERVER
 * Provides static IP whitelisting for NZSCV Self-Contained Vehicle Registry API
 * 
 * Deploy this to: DigitalOcean Droplet, Railway, or Fly.io
 * Cost: $5-6/month for static IP
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
const SITE_URL = process.env.SITE_URL || 'https://fcmanager.co.nz';

if (!MOTORWEB_API_KEY || !MOTORWEB_ID_KEY) {
  console.warn('⚠️  WARNING: MotorWeb API credentials not configured (enrichment will fail)');
}

if (!PROXY_SECRET) {
  console.warn('⚠️  WARNING: No PROXY_SECRET set. Anyone can use this proxy!');
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'NZSCV Proxy Server',
  });
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
