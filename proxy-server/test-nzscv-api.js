/**
 * NZSCV API Response Test Script
 * =============================================================================
 * Run this from a machine with the NZSCV-whitelisted IP to see the FULL raw
 * JSON response and discover every field the API actually returns.
 *
 * Usage:
 *   node test-nzscv-api.js [PLATE_NUMBER]
 *   node test-nzscv-api.js ABC123        ← check a specific plate
 *   node test-nzscv-api.js               ← run against several test plates
 *
 * Set credentials via env vars or edit the constants below.
 *
 * Environment:
 *   NZSCV_ENDPOINT_URL  (default: test environment)
 *   NZSCV_API_KEY       (PGDB-Authorization header value)
 *   NZSCV_ID_KEY        (PGDB-Identifier header value)
 * =============================================================================
 */

const https = require('https');

const ENDPOINT = process.env.NZSCV_ENDPOINT_URL
  || 'https://tst.nzscv.co.nz/rest/info/v1/vehicleregistrationinfo';
const API_AUTH = process.env.NZSCV_API_KEY
  || '13e5e5cc-07a0-422b-9fc3-9a5ddb031f22';   // test key — replace for production
const API_ID   = process.env.NZSCV_ID_KEY
  || 'e535c242-4746-449c-9060-712f9e446f59';    // test id  — replace for production

// ── Plates to test ────────────────────────────────────────────────────────────
// Pass a plate as a CLI arg, or edit this list.
// Use real NZ registration numbers for meaningful results.
const platesToTest = process.argv[2]
  ? [process.argv[2].toUpperCase().trim()]
  : [
      'ABC123',   // likely not on register
      'ZZZ999',   // likely not on register
      'TEST01',   // dummy
    ];

// ── HTTP helper ───────────────────────────────────────────────────────────────
async function checkPlate(plate) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ RegistrationNumber: plate });
    const url = new URL(ENDPOINT);

    const reqOpts = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + (url.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'PGDB-Authorization': API_AUTH,
        'PGDB-Identifier':    API_ID,
      },
      timeout: 15000,
    };

    let raw = '';
    const req = https.request(reqOpts, (res) => {
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({
          plate,
          httpStatus: res.statusCode,
          responseHeaders: res.headers,
          body: parsed,
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ plate, error: 'REQUEST TIMED OUT after 15s' });
    });
    req.on('error', (e) => {
      resolve({ plate, error: e.message, code: e.code });
    });

    req.write(payload);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log('='.repeat(70));
  console.log('NZSCV API Response Test');
  console.log('Endpoint :', ENDPOINT);
  console.log('API ID   :', API_ID.slice(0, 8) + '...');
  console.log('='.repeat(70));

  for (const plate of platesToTest) {
    console.log(`\n>>> Plate: ${plate}`);

    const result = await checkPlate(plate);

    if (result.error) {
      console.log('  ❌ NETWORK ERROR:', result.error);
      if (result.code === 'ENOTFOUND') {
        console.log('     → DNS could not resolve the host.');
        console.log('     → Ensure you are running this from the whitelisted IP.');
      }
      console.log('-'.repeat(70));
      continue;
    }

    console.log(`  HTTP Status: ${result.httpStatus}`);

    // ── Print every field in the response ─────────────────────────────────
    console.log('\n  ┌─ FULL RAW RESPONSE ─────────────────────────────────────');
    console.log(JSON.stringify(result.body, null, 4)
      .split('\n').map(l => '  │ ' + l).join('\n'));
    console.log('  └─────────────────────────────────────────────────────────');

    // ── Summary: what fields did we actually get? ──────────────────────────
    if (typeof result.body === 'object' && result.body !== null) {
      const topKeys = Object.keys(result.body);
      console.log('\n  ▶ Top-level keys:', topKeys);

      const vr = result.body.VehicleRegistration;
      if (vr && typeof vr === 'object') {
        console.log('  ▶ VehicleRegistration keys:', Object.keys(vr));
        console.log('  ▶ Relevant SC fields:');
        console.log('      VehicleRegistration :', vr.VehicleRegistration ?? '(not present)');
        console.log('      CertificateStatus   :', vr.CertificateStatus   ?? '(not present)');
        console.log('      CertificateExpiry   :', vr.CertificateExpiryDate ?? '(not present)');
        console.log('      CertificateIssue    :', vr.CertificateIssueDate  ?? '(not present)');
        console.log('      make                :', vr.make  ?? '(not present)');
        console.log('      model               :', vr.model ?? '(not present)');
        console.log('      year                :', vr.year  ?? '(not present)');
        console.log('      vin                 :', vr.vin   ?? '(not present)');
        console.log('      colour/color        :', vr.colour ?? vr.color ?? '(not present)');
        console.log('      MaxOccupants        :', vr.MaxOccupants ?? '(not present)');
      }
    }

    console.log('-'.repeat(70));
  }

  console.log('\nDone. Paste the output above back to the developer to update the');
  console.log('NZSCVResponse TypeScript interface with the actual API fields.');
})();
