/**
 * GENERATE VEHICLE REPORT
 * Creates a court-ready PDF evidence report for a specific vehicle
 * Includes canonical vehicle details and selected observations
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const {
      vehicle,
      observations,
      organization,
      generated_by,
      generated_at,
    } = await req.json();

    console.log('📄 Generating vehicle evidence report:', vehicle.plate_number);

    // Generate HTML for PDF
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Arial', sans-serif;
      font-size: 12px;
      line-height: 1.6;
      color: #000;
      padding: 20px;
      background: white;
    }
    .header {
      text-align: center;
      border-bottom: 3px solid #1e40af;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header h1 {
      font-size: 24px;
      color: #1e40af;
      margin-bottom: 10px;
      font-weight: bold;
      text-transform: uppercase;
    }
    .header .subtitle {
      font-size: 14px;
      color: #64748b;
      margin-bottom: 5px;
    }
    .org-details {
      text-align: center;
      font-size: 11px;
      color: #64748b;
      margin-bottom: 20px;
    }
    .vehicle-header {
      background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
      color: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 25px;
    }
    .vehicle-header h2 {
      font-size: 28px;
      margin-bottom: 15px;
      font-weight: bold;
      letter-spacing: 2px;
    }
    .vehicle-info-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin-top: 15px;
    }
    .info-item {
      background: rgba(255, 255, 255, 0.1);
      padding: 10px;
      border-radius: 4px;
    }
    .info-item label {
      display: block;
      font-size: 10px;
      text-transform: uppercase;
      margin-bottom: 4px;
      opacity: 0.8;
    }
    .info-item value {
      display: block;
      font-size: 14px;
      font-weight: bold;
    }
    .status-badges {
      display: flex;
      gap: 10px;
      margin-top: 15px;
      flex-wrap: wrap;
    }
    .badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: bold;
    }
    .badge.flagged {
      background: #dc2626;
      color: white;
    }
    .badge.homeless {
      background: #06b6d4;
      color: white;
    }
    .badge.enforcement {
      background: #f59e0b;
      color: white;
    }
    .badge.self-contained {
      background: #10b981;
      color: white;
    }
    .badge.not-self-contained {
      background: #6b7280;
      color: white;
    }
    .summary-section {
      background: #f8fafc;
      border: 2px solid #e2e8f0;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 25px;
    }
    .summary-section h3 {
      font-size: 16px;
      color: #1e40af;
      margin-bottom: 15px;
      border-bottom: 2px solid #1e40af;
      padding-bottom: 8px;
      font-weight: bold;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 15px;
    }
    .summary-item {
      text-align: center;
      padding: 15px;
      background: white;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
    }
    .summary-item .number {
      font-size: 32px;
      font-weight: bold;
      color: #1e40af;
      margin-bottom: 5px;
    }
    .summary-item .number.red {
      color: #dc2626;
    }
    .summary-item .label {
      font-size: 11px;
      color: #64748b;
      text-transform: uppercase;
    }
    .observations-section {
      margin-top: 30px;
    }
    .observations-section h3 {
      font-size: 18px;
      color: #1e40af;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid #1e40af;
      font-weight: bold;
    }
    .observation-card {
      background: white;
      border: 2px solid #e2e8f0;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 20px;
      page-break-inside: avoid;
    }
    .observation-card.breach {
      border-color: #dc2626;
      background: #fef2f2;
    }
    .observation-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 1px solid #e2e8f0;
    }
    .observation-number {
      font-size: 20px;
      font-weight: bold;
      color: #1e40af;
    }
    .observation-date {
      font-size: 14px;
      font-weight: bold;
      color: #334155;
    }
    .observation-status {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: bold;
      text-transform: uppercase;
    }
    .observation-status.breach {
      background: #dc2626;
      color: white;
    }
    .observation-status.compliant {
      background: #10b981;
      color: white;
    }
    .observation-status.non-compliant {
      background: #f59e0b;
      color: white;
    }
    .observation-details {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin-bottom: 10px;
    }
    .detail-item {
      font-size: 11px;
    }
    .detail-item label {
      color: #64748b;
      font-weight: bold;
      display: inline-block;
      min-width: 80px;
    }
    .detail-item value {
      color: #000;
    }
    .observation-notes {
      background: #f8fafc;
      border-left: 4px solid #1e40af;
      padding: 10px;
      margin-top: 10px;
      font-size: 11px;
      font-style: italic;
      color: #334155;
    }
    .observation-photo {
      margin-top: 15px;
      text-align: center;
    }
    .observation-photo img {
      max-width: 100%;
      max-height: 300px;
      border-radius: 6px;
      border: 2px solid #e2e8f0;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #1e40af;
      font-size: 10px;
      color: #64748b;
      text-align: center;
    }
    .footer strong {
      color: #1e40af;
    }
    .page-break {
      page-break-after: always;
    }
    @media print {
      body {
        padding: 10px;
      }
      .observation-card {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <h1>🚔 Vehicle Evidence Report</h1>
    <div class="subtitle">Freedom Camping Compliance Report</div>
    <div class="org-details">
      ${organization?.name || 'Unknown Organization'}<br>
      ${organization?.contact_email || ''} ${organization?.contact_phone ? '| ' + organization.contact_phone : ''}
    </div>
  </div>

  <!-- Vehicle Information Header -->
  <div class="vehicle-header">
    <h2>${vehicle.plate_number}</h2>
    <div class="vehicle-info-grid">
      <div class="info-item">
        <label>Make/Model</label>
        <value>${vehicle.vehicle_make || 'Unknown'} ${vehicle.vehicle_model || ''}</value>
      </div>
      <div class="info-item">
        <label>Year</label>
        <value>${vehicle.vehicle_year || 'Unknown'}</value>
      </div>
      <div class="info-item">
        <label>Color</label>
        <value>${vehicle.vehicle_color || 'Unknown'}</value>
      </div>
      <div class="info-item">
        <label>First Seen</label>
        <value>${new Date(vehicle.first_seen_at).toLocaleDateString('en-NZ')}</value>
      </div>
      <div class="info-item">
        <label>Last Seen</label>
        <value>${new Date(vehicle.last_seen_at).toLocaleDateString('en-NZ')}</value>
      </div>
      <div class="info-item">
        <label>Report Date</label>
        <value>${new Date(generated_at).toLocaleDateString('en-NZ')}</value>
      </div>
    </div>

    <!-- Status Badges -->
    <div class="status-badges">
      ${vehicle.self_contained 
        ? '<span class="badge self-contained">✓ Self-Contained</span>'
        : '<span class="badge not-self-contained">✗ Not Self-Contained</span>'
      }
      ${vehicle.is_flagged 
        ? `<span class="badge flagged">🚩 Flagged: ${vehicle.flagged_reason}</span>`
        : ''
      }
      ${vehicle.homeless_status === 'confirmed' 
        ? '<span class="badge homeless">🏠 Homeless (Confirmed)</span>'
        : ''
      }
      ${vehicle.enforcement_count > 0 
        ? `<span class="badge enforcement">⚠️ ${vehicle.enforcement_count} Prior Enforcement${vehicle.enforcement_count !== 1 ? 's' : ''}</span>`
        : ''
      }
    </div>
  </div>

  <!-- Summary Section -->
  <div class="summary-section">
    <h3>📊 Vehicle Summary</h3>
    <div class="summary-grid">
      <div class="summary-item">
        <div class="number">${vehicle.total_observations}</div>
        <div class="label">Total Observations</div>
      </div>
      <div class="summary-item">
        <div class="number red">${vehicle.total_breaches}</div>
        <div class="label">Total Breaches</div>
      </div>
      <div class="summary-item">
        <div class="number">${vehicle.enforcement_count || 0}</div>
        <div class="label">Enforcement Actions</div>
      </div>
      <div class="summary-item">
        <div class="number">${observations.length}</div>
        <div class="label">Included in Report</div>
      </div>
    </div>
  </div>

  <!-- Observations Section -->
  <div class="observations-section">
    <h3>📋 Evidence Records (${observations.length} Observations)</h3>
    
    ${observations.map((obs: any, idx: number) => `
      <div class="observation-card ${obs.is_breach ? 'breach' : ''}">
        <div class="observation-header">
          <div>
            <span class="observation-number">#${idx + 1}</span>
            <span class="observation-status ${obs.is_breach ? 'breach' : obs.is_compliant ? 'compliant' : 'non-compliant'}">
              ${obs.is_breach ? '🚨 BREACH' : obs.is_compliant ? '✓ Compliant' : '⚠️ Non-Compliant'}
            </span>
            ${obs.breach_type ? `<span class="observation-status breach">${obs.breach_type}</span>` : ''}
          </div>
          <div class="observation-date">
            ${new Date(obs.recorded_at).toLocaleDateString('en-NZ', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </div>
        </div>

        <div class="observation-details">
          <div class="detail-item">
            <label>Zone:</label>
            <value>${obs.zone_name}</value>
          </div>
          <div class="detail-item">
            <label>Officer:</label>
            <value>${obs.officer_name}</value>
          </div>
          ${obs.gps_latitude && obs.gps_longitude ? `
            <div class="detail-item">
              <label>GPS Lat:</label>
              <value>${obs.gps_latitude.toFixed(6)}</value>
            </div>
            <div class="detail-item">
              <label>GPS Lng:</label>
              <value>${obs.gps_longitude.toFixed(6)}</value>
            </div>
          ` : ''}
          ${obs.gps_accuracy ? `
            <div class="detail-item">
              <label>GPS Accuracy:</label>
              <value>${obs.gps_accuracy.toFixed(2)}m</value>
            </div>
          ` : ''}
          <div class="detail-item">
            <label>Self-Contained:</label>
            <value>${obs.self_contained ? 'Yes' : 'No'}</value>
          </div>
          ${obs.has_incident ? `
            <div class="detail-item">
              <label>⚠️ Incident:</label>
              <value>Yes</value>
            </div>
          ` : ''}
          ${obs.has_hs_incident ? `
            <div class="detail-item">
              <label>⚠️ H&S Issue:</label>
              <value>Yes</value>
            </div>
          ` : ''}
        </div>

        ${obs.officer_notes ? `
          <div class="observation-notes">
            <strong>Officer Notes:</strong> ${obs.officer_notes}
          </div>
        ` : ''}

        ${obs.photo ? `
          <div class="observation-photo">
            <img src="${obs.photo}" alt="Evidence Photo ${idx + 1}" />
            <div style="margin-top: 5px; font-size: 10px; color: #64748b;">
              Photo Hash: ${obs.photo_hash || 'N/A'}
            </div>
          </div>
        ` : ''}
      </div>
    `).join('')}
  </div>

  <!-- Footer -->
  <div class="footer">
    <p><strong>Report Generated:</strong> ${new Date(generated_at).toLocaleString('en-NZ')}</p>
    <p><strong>Generated By:</strong> ${generated_by}</p>
    <p style="margin-top: 10px; font-size: 9px;">
      This report contains evidence collected under the Freedom Camping Act 2011.<br>
      All observations include GPS coordinates, timestamps, and photographic evidence where applicable.<br>
      Officer observations are verified and authenticated at the time of recording.
    </p>
  </div>
</body>
</html>
    `;

    // For now, return HTML (you can integrate with a PDF generation service later)
    // Common options: puppeteer, pdfkit, jsPDF, or third-party APIs like PDFMonkey, DocRaptor
    
    // Temporary: Return HTML for browser to print as PDF
    return new Response(
      JSON.stringify({
        success: true,
        html,
        message: 'Report HTML generated - please print as PDF from browser',
        // In production, you'd return a PDF URL:
        // pdf_url: 'https://storage.url/reports/vehicle-ABC123-123456.pdf'
      }),
      {
        headers: {
          ...getCorsHeaders(req),
          'Content-Type': 'application/json',
        },
      }
    );

  } catch (error: any) {
    console.error('❌ Vehicle report generation failed:', error);
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to generate vehicle report',
      }),
      {
        status: 500,
        headers: {
          ...getCorsHeaders(req),
          'Content-Type': 'application/json',
        },
      }
    );
  }
});
