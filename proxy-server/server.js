/**
 * NZSCV API PROXY SERVER
 * Provides static IP whitelisting for NZSCV Self-Contained Vehicle Registry API
 * 
 * Deploy this to: DigitalOcean Droplet, Railway, or Fly.io
 * Cost: $5-6/month for static IP
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Environment variables validation
const NZSCV_API_KEY = process.env.NZSCV_API_KEY;
const NZSCV_ID_KEY = process.env.NZSCV_ID_KEY;
const NZSCV_BASE_URL = process.env.NZSCV_BASE_URL || 'https://www.nzscv.co.nz';
const MOTORWEB_API_KEY = process.env.MOTORWEB_API_KEY;
const MOTORWEB_ID_KEY = process.env.MOTORWEB_ID_KEY;
const MOTORWEB_BASE_URL = process.env.MOTORWEB_BASE_URL || 'https://robot.motorweb.co.nz';
const PROXY_SECRET = process.env.PROXY_SECRET; // Secret to authenticate your Edge Functions

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
app.post('/api/nzscv/vehicle-info', async (req, res) => {
  try {
    // Verify proxy secret (if configured)
    const authHeader = req.headers['x-proxy-secret'];
    if (PROXY_SECRET && authHeader !== PROXY_SECRET) {
      console.warn('🚫 Unauthorized proxy access attempt');
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Invalid proxy authentication' 
      });
    }

    const { RegistrationNumber } = req.body;

    if (!RegistrationNumber) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'RegistrationNumber is required'
      });
    }

    console.log('🔍 Proxy request for:', RegistrationNumber);

    // Call NZSCV API
    const response = await axios.post(
      `${NZSCV_BASE_URL}/api/rest/scv/v1/vehicleregistrationinfo`,
      { RegistrationNumber },
      {
        headers: {
          'PGDB-Authorization': NZSCV_API_KEY,
          'PGDB-Identifier': NZSCV_ID_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10 second timeout
      }
    );

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

// MotorWeb Current Owner Check endpoint
app.get('/motorweb/currentOwnerCheck', async (req, res) => {
  try {
    // Verify proxy secret (if configured)
    const authHeader = req.headers['x-proxy-secret'];
    if (PROXY_SECRET && authHeader !== PROXY_SECRET) {
      console.warn('🚫 Unauthorized MotorWeb access attempt');
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Invalid proxy authentication' 
      });
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
    },
    rateLimit: {
      maxHitsPerSecond: 1,
      note: 'Both NZSCV and MotorWeb enforce 1 request/second limit'
    },
    motorwebConfigured: !!(MOTORWEB_API_KEY && MOTORWEB_ID_KEY),
    nzscvConfigured: !!(NZSCV_API_KEY && NZSCV_ID_KEY),
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
