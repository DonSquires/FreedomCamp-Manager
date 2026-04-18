import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';
import { requireAuth } from '../_shared/requireAuth.ts';

/**
 * Generate Court-Ready PDF for Incident Reports
 * Server-side PDF generation using jsPDF equivalent or rendering HTML to PDF
 */

interface IncidentPDFRequest {
  incident_id: string;
  include_photos?: boolean;
  include_audit_trail?: boolean;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const { incident_id, include_photos = true, include_audit_trail = true } = await req.json() as IncidentPDFRequest;

    if (!incident_id) {
      return new Response(
        JSON.stringify({ error: 'incident_id is required' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    // Authenticate — only logged-in users may generate incident PDFs.
    const authResult = await requireAuth(req);
    if (!authResult.user) {
      return new Response(
        JSON.stringify({ error: authResult.error ?? 'Unauthorized' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch incident with all related data including matrix snapshot
    const { data: incident, error: incidentError } = await supabase
      .from('incidents')
      .select(`
        *,
        zone:zones!incidents_zone_id_fkey(id, name, description),
        organization:organizations(name, logo_url),
        user:user_profiles(first_name, last_name, email),
        incident_vehicles(
          vehicle:canonical_vehicles(plate_number, vehicle_make, vehicle_model, vehicle_color),
          vehicle_role
        ),
        incident_persons(person_name, person_role, contact_email, contact_phone),
        enforcement_action:enforcement_actions(action_type, notes, status)
      `)
      .eq('id', incident_id)
      .single();



    // Fetch active compliance matrix at time of incident.
    // Use incident.created_at as the reference timestamp (happened_at does not exist on incidents).
    let matrixSnapshot = null;
    if (incident.zone?.id) {
      const { data: matrix } = await supabase
        .from('zone_compliance_matrix')
        .select('*')
        .eq('zone_id', incident.zone.id)
        .lte('effective_from', incident.created_at)
        .or(`effective_to.is.null,effective_to.gte.${incident.created_at}`)
        .order('version', { ascending: false })
        .limit(1)
        .single();
      
      matrixSnapshot = matrix;
    }



    // Fetch audit trail if requested
    let auditTrail = [];
    if (include_audit_trail) {
      const { data: actions } = await supabase
        .from('incident_actions')
        .select('*, performed_by_user:user_profiles(first_name, last_name, email)')
        .eq('incident_id', incident_id)
        .order('timestamp', { ascending: true });
      
      auditTrail = actions || [];
    }

    // Generate HTML for PDF with matrix snapshot
    const html = generateIncidentHTML(incident, auditTrail, matrixSnapshot, include_photos);

    // Convert HTML to PDF using Deno's built-in capabilities
    // For production, you'd use a proper PDF generation library or service
    // Here we return HTML that can be converted client-side or via print API
    
    const pdfMetadata = {
      title: `Incident Report - ${incident.id}`,
      subject: `${incident.incident_type} at ${incident.zone?.name}`,
      creator: 'FieldOps Manager',
      producer: 'FieldOps Manager PDF Generator',
      creationDate: new Date().toISOString(),
      keywords: ['incident', 'court-ready', incident.incident_type, incident.zone?.name].join(', '),
    };

    // Return HTML with print stylesheet for client-side PDF generation
    // OR send to headless Chrome service for server-side rendering
    return new Response(
      JSON.stringify({
        html,
        metadata: pdfMetadata,
        incident_id: incident.id,
        court_ready: incident.retention_hold ?? false,
        generated_at: new Date().toISOString(),
      }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('PDF generation error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to generate PDF' }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});

function generateIncidentHTML(incident: any, auditTrail: any[], matrixSnapshot: any, includePhotos: boolean): string {
  const formatDate = (date: string) => new Date(date).toLocaleString('en-NZ', {
    dateStyle: 'full',
    timeStyle: 'long',
  });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <base href="https://www.ironeaglesecurity.co.nz">
  <title>Incident Report - ${incident.id}</title>
  <style>
    @page {
      size: A4;
      margin: 2cm;
    }
    
    body {
      font-family: 'Helvetica', 'Arial', sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 21cm;
      margin: 0 auto;
      padding: 20px;
    }
    
    .header {
      text-align: center;
      border-bottom: 3px solid #0F172A;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    
    .header h1 {
      margin: 0;
      color: #0F172A;
      font-size: 28px;
    }
    
    .header .subtitle {
      color: #64748b;
      margin-top: 10px;
      font-size: 14px;
    }
    
    .court-ready-badge {
      display: inline-block;
      background: #22c55e;
      color: white;
      padding: 8px 16px;
      border-radius: 4px;
      font-weight: bold;
      margin-top: 10px;
    }
    
    .section {
      margin: 30px 0;
      page-break-inside: avoid;
    }
    
    .section-title {
      font-size: 18px;
      font-weight: bold;
      color: #0F172A;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 8px;
      margin-bottom: 15px;
    }
    
    .field-grid {
      display: grid;
      grid-template-columns: 200px 1fr;
      gap: 12px;
      margin: 15px 0;
    }
    
    .field-label {
      font-weight: 600;
      color: #64748b;
    }
    
    .field-value {
      color: #1e293b;
    }
    
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    
    .badge-high {
      background: #fee2e2;
      color: #991b1b;
    }
    
    .badge-medium {
      background: #fef3c7;
      color: #92400e;
    }
    
    .badge-low {
      background: #dbeafe;
      color: #1e40af;
    }
    
    .photos-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
      margin: 20px 0;
    }
    
    .photo-container {
      page-break-inside: avoid;
    }
    
    .photo-container img {
      width: 100%;
      height: auto;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
    }
    
    .photo-hash {
      font-family: 'Courier New', monospace;
      font-size: 10px;
      color: #64748b;
      margin-top: 5px;
      word-break: break-all;
    }
    
    .audit-trail {
      margin: 20px 0;
    }
    
    .audit-entry {
      padding: 12px;
      border-left: 3px solid #3b82f6;
      background: #f8fafc;
      margin-bottom: 10px;
    }
    
    .audit-header {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin-bottom: 5px;
    }
    
    .audit-action {
      font-weight: 600;
      color: #0F172A;
    }
    
    .audit-time {
      color: #64748b;
    }
    
    .footer {
      margin-top: 50px;
      padding-top: 20px;
      border-top: 2px solid #e2e8f0;
      text-align: center;
      font-size: 12px;
      color: #64748b;
    }
    
    .signature-block {
      margin: 40px 0;
      page-break-inside: avoid;
    }
    
    .signature-line {
      border-top: 1px solid #333;
      margin-top: 50px;
      padding-top: 10px;
      width: 300px;
    }
    
    @media print {
      body {
        padding: 0;
      }
      
      .no-print {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
      ${incident.organization?.logo_url ? `<img src="${incident.organization.logo_url}" alt="${incident.organization?.name || 'Organisation'}" style="max-height:56px;max-width:180px;object-fit:contain;">` : '<div></div>'}
      <img src="/iron-eagle-security-logo.jpg" alt="Iron Eagle Security" style="height:44px;object-fit:contain;">
    </div>
    <h1>INCIDENT REPORT</h1>
    <div class="subtitle">FieldOps Manager &mdash; Iron Eagle Security &mdash; Court-Ready Documentation</div>
    ${incident.retention_hold ? '<div class="court-ready-badge">⚖ LEGAL HOLD — Retained for Legal/Court Use</div>' : ''}
  </div>

  <div class="section">
    <div class="section-title">Incident Details</div>
    <div class="field-grid">
      <div class="field-label">Incident ID:</div>
      <div class="field-value">${incident.id}</div>
      
      <div class="field-label">Type:</div>
      <div class="field-value">${incident.incident_type}</div>
      
      <div class="field-label">Severity:</div>
      <div class="field-value">
        <span class="badge badge-${incident.severity}">${incident.severity}</span>
      </div>
      
      <div class="field-label">Status:</div>
      <div class="field-value">${incident.status}</div>
      
      <div class="field-label">Date/Time of Incident:</div>
      <div class="field-value">${formatDate(incident.created_at)}</div>
      
      <div class="field-label">Zone:</div>
      <div class="field-value">${incident.zone?.name || 'N/A'}</div>
      
      <div class="field-label">Organization:</div>
      <div class="field-value">${incident.organization?.name || 'N/A'}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Description</div>
    <p>${incident.description}</p>
  </div>

  ${incident.evidence_notes ? `
  <div class="section">
    <div class="section-title">Evidence Notes</div>
    <p>${incident.evidence_notes}</p>
  </div>
  ` : ''}

  <div class="section">
    <div class="section-title">Location Information</div>
    <div class="field-grid">
      <div class="field-label">GPS Coordinates:</div>
      <div class="field-value">${incident.gps_latitude?.toFixed(6)}, ${incident.gps_longitude?.toFixed(6)}</div>
      
      <div class="field-label">GPS Accuracy:</div>
      <div class="field-value">±${incident.gps_accuracy?.toFixed(1)}m</div>
    </div>
  </div>

  ${incident.incident_vehicles && incident.incident_vehicles.length > 0 ? `
  <div class="section">
    <div class="section-title">Associated Vehicles</div>
    ${incident.incident_vehicles.map((v: any) => `
      <div class="field-grid">
        <div class="field-label">Plate Number:</div>
        <div class="field-value">${v.vehicle?.plate_number || 'Unknown'}</div>
        
        <div class="field-label">Make/Model:</div>
        <div class="field-value">${v.vehicle?.vehicle_make || ''} ${v.vehicle?.vehicle_model || ''}</div>
        
        <div class="field-label">Color:</div>
        <div class="field-value">${v.vehicle?.vehicle_color || 'N/A'}</div>
        
        <div class="field-label">Role:</div>
        <div class="field-value">${v.vehicle_role || 'involved'}</div>
      </div>
      <hr style="margin: 15px 0; border: none; border-top: 1px solid #e2e8f0;">
    `).join('')}
  </div>
  ` : ''}

  ${incident.incident_persons && incident.incident_persons.length > 0 ? `
  <div class="section">
    <div class="section-title">Associated Persons</div>
    ${incident.incident_persons.map((p: any) => `
      <div class="field-grid">
        <div class="field-label">Name:</div>
        <div class="field-value">${p.person_name}</div>
        
        <div class="field-label">Role:</div>
        <div class="field-value">${p.person_role || 'N/A'}</div>
        
        ${p.contact_email ? `
          <div class="field-label">Email:</div>
          <div class="field-value">${p.contact_email}</div>
        ` : ''}
        
        ${p.contact_phone ? `
          <div class="field-label">Phone:</div>
          <div class="field-value">${p.contact_phone}</div>
        ` : ''}
      </div>
      <hr style="margin: 15px 0; border: none; border-top: 1px solid #e2e8f0;">
    `).join('')}
  </div>
  ` : ''}

  ${matrixSnapshot ? `
  <div class="section">
    <div class="section-title">Compliance Matrix Snapshot</div>
    <p style="font-size: 14px; color: #64748b; margin-bottom: 15px;">
      This incident was evaluated using the compliance criteria in effect at the time of occurrence.
    </p>
    <div class="field-grid">
      <div class="field-label">Matrix Version:</div>
      <div class="field-value">v${matrixSnapshot.version}</div>
      
      <div class="field-label">Effective Period:</div>
      <div class="field-value">
        ${new Date(matrixSnapshot.effective_from).toLocaleDateString('en-NZ')} to 
        ${matrixSnapshot.effective_to ? new Date(matrixSnapshot.effective_to).toLocaleDateString('en-NZ') : 'present'}
      </div>
      
      <div class="field-label">Self-Contained Required:</div>
      <div class="field-value">${matrixSnapshot.self_contained_required ? 'Yes' : 'No'}</div>
      
      <div class="field-label">Nights Per Month:</div>
      <div class="field-value">${matrixSnapshot.nights_per_month}</div>
      
      <div class="field-label">Max Consecutive Nights:</div>
      <div class="field-value">${matrixSnapshot.max_consecutive_nights}</div>
      
      <div class="field-label">Day Visit Only:</div>
      <div class="field-value">${matrixSnapshot.day_visit_only ? 'Yes' : 'No'}</div>
      
      <div class="field-label">Homeless Exemption:</div>
      <div class="field-value">${matrixSnapshot.homeless_exemption ? 'Yes' : 'No'}</div>
      
      <div class="field-label">Allowed Days:</div>
      <div class="field-value">${matrixSnapshot.allowed_days.join(', ')}</div>
    </div>
    <div style="margin-top: 15px; padding: 12px; background: #f8fafc; border-radius: 4px;">
      <p style="font-size: 12px; color: #64748b; margin: 0;">
        <strong>Interpretation:</strong> Under this matrix version, ${matrixSnapshot.self_contained_required ? 'self-contained vehicles are required' : 'non-self-contained vehicles are permitted'}, 
        with a maximum of ${matrixSnapshot.nights_per_month} nights per month and ${matrixSnapshot.max_consecutive_nights} consecutive nights.
        ${matrixSnapshot.homeless_exemption ? ' Confirmed homeless status provides exemption from these limits.' : ''}
      </p>
    </div>
  </div>
  ` : ''}

  ${incident.enforcement_action ? `
  <div class="section">
    <div class="section-title">Enforcement Action</div>
    <div class="field-grid">
      <div class="field-label">Action Type:</div>
      <div class="field-value">${incident.enforcement_action.action_type}</div>

      <div class="field-label">Status:</div>
      <div class="field-value">${incident.enforcement_action.status}</div>

      ${incident.enforcement_action.notes ? `
        <div class="field-label">Notes:</div>
        <div class="field-value">${incident.enforcement_action.notes}</div>
      ` : ''}
    </div>
  </div>
  ` : ''}

  ${includePhotos && incident.photos && incident.photos.length > 0 ? `
  <div class="section">
    <div class="section-title">Evidence Photos (${incident.photos.length})</div>
    <div class="photos-grid">
      ${incident.photos.map((photo: string, idx: number) => `
        <div class="photo-container">
          <img src="${photo}" alt="Evidence photo ${idx + 1}" />
          <div class="photo-hash">
            Hash: ${incident.photo_hashes?.[idx] || 'N/A'}
          </div>
        </div>
      `).join('')}
    </div>
  </div>
  ` : ''}

  ${auditTrail.length > 0 ? `
  <div class="section">
    <div class="section-title">Audit Trail</div>
    <div class="audit-trail">
      ${auditTrail.map((action: any) => `
        <div class="audit-entry">
          <div class="audit-header">
            <span class="audit-action">${action.action_type}</span>
            <span class="audit-time">${formatDate(action.timestamp)}</span>
          </div>
          <div>By: ${action.performed_by_user?.first_name} ${action.performed_by_user?.last_name} (${action.performed_by_user?.email})</div>
          ${action.notes ? `<div>Notes: ${action.notes}</div>` : ''}
        </div>
      `).join('')}
    </div>
  </div>
  ` : ''}

  <div class="section">
    <div class="section-title">Report Metadata</div>
    <div class="field-grid">
      <div class="field-label">Reported By:</div>
      <div class="field-value">${incident.user?.first_name} ${incident.user?.last_name} (${incident.user?.email})</div>
      
      <div class="field-label">Reported At:</div>
      <div class="field-value">${formatDate(incident.created_at)}</div>
    </div>
  </div>

  ${incident.retention_hold ? `
  <div class="section signature-block">
    <div class="section-title">Legal Hold Certification</div>
    <p>This incident record is under legal hold and must not be modified or deleted.
       It is retained for potential use in legal proceedings or court.</p>
    
    <div class="signature-line">
      <strong>Signature:</strong> _______________________________
    </div>
    
    <div class="signature-line">
      <strong>Name:</strong> _______________________________
    </div>
    
    <div class="signature-line">
      <strong>Date:</strong> _______________________________
    </div>
  </div>
  ` : ''}

  <div class="footer">
    <p><strong>FieldOps Manager</strong> - Court-Ready Incident Report</p>
    <p>Generated: ${formatDate(new Date().toISOString())}</p>
    <p>Document ID: ${incident.id}</p>
    ${incident.retention_hold ? '<p style="color: #22c55e; font-weight: bold;">⚖ This document is under legal hold and retained for court use</p>' : ''}
  </div>
  <div style="margin-top:24px;padding-top:8px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
    <span style="font-size:8pt;color:#94a3b8;">Generated by <strong style="color:#1e3a8a;">FieldOps Manager</strong> &mdash; Iron Eagle Security</span>
    <img src="/iron-eagle-security-logo.jpg" alt="Iron Eagle Security" style="height:22px;opacity:0.55;object-fit:contain;">
  </div>
</body>
</html>
  `.trim();
}
