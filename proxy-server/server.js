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
const PROXY_SECRET = process.env.PROXY_SECRET; // Secret to authenticate your Edge Functions

if (!NZSCV_API_KEY || !NZSCV_ID_KEY) {
  console.error('❌ Missing NZSCV API credentials in environment variables');
  process.exit(1);
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

// Rate limiting info endpoint (optional)
app.get('/api/info', (req, res) => {
  res.json({
    service: 'NZSCV Proxy Server',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      vehicleInfo: 'POST /api/nzscv/vehicle-info'
    },
    rateLimit: {
      maxHitsPerSecond: 1,
      note: 'NZSCV enforces 1 request/second limit'
    }
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   🚀 NZSCV Proxy Server Running      ║
  ╠═══════════════════════════════════════╣
  ║   Port: ${PORT.toString().padEnd(29)}║
  ║   Environment: ${(process.env.NODE_ENV || 'development').padEnd(22)}║
  ║   NZSCV URL: ${NZSCV_BASE_URL.padEnd(24)}║
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
