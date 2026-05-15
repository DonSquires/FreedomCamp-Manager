/**
 * generate-compliance-pdf
 *
 * Supabase Edge Function (Deno) — invoked asynchronously by the
 * handle_automated_breach_notice() PostgreSQL trigger via pg_net.
 *
 * Generates an official RMA / Biosecurity enforcement notice as a
 * PDF using pdf-lib (pure TypeScript, Deno-compatible) and uploads
 * the result to the `compliance-vault` Storage bucket.
 *
 * POST body (from pg_net trigger):
 *   {
 *     incident_id: string   — UUID of the incidents row
 *     type:        string   — 'SMOKE_COMPLAINT' | 'BIOSECURITY_BREACH'
 *     location:    string   — human-readable site description
 *     timestamp:   string   — ISO-8601 NZ timestamp
 *   }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { getCorsHeaders, withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts';

// ── Constants ───────────────────────────────────────────────────────────────

const SMOKE_CITATION    = 'Resource Management Act 1991 — Section 326 (Abatement Notice)';
const BIO_CITATION      = 'Biosecurity Act 1993 — Containment Breach Notice';
const BUCKET            = 'compliance-vault';
const IRON_EAGLE        = 'IRON EAGLE SECURITY LIMITED';
const NOTICE_HEADER     = 'OFFICIAL ENFORCEMENT NOTICE';

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(withCors(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: { incident_id: string; type: string; location: string; timestamp: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', req, 400);
  }

  const { incident_id, type, location, timestamp } = body;

  if (!incident_id) return errorResponse('incident_id is required', req, 400);
  if (!type)        return errorResponse('type is required',        req, 400);

  // ── Verify incident exists ───────────────────────────────────────────────
  const { data: incident, error: fetchError } = await supabase
    .from('incidents')
    .select('id, type, location_string, raw_desc, created_at')
    .eq('id', incident_id)
    .single();

  if (fetchError || !incident) {
    return errorResponse(`Incident not found: ${incident_id}`, req, 404);
  }

  // ── Build PDF ────────────────────────────────────────────────────────────
  const pdfDoc   = await PDFDocument.create();
  const page     = pdfDoc.addPage([595, 842]); // A4 points
  const { width, height } = page.getSize();

  const fontBold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontNormal = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const BLACK  = rgb(0,    0,    0);
  const RED    = rgb(0.75, 0,    0);
  const GREY   = rgb(0.4,  0.4,  0.4);

  let y = height - 60;

  // Header ─────────────────────────────────────────────────
  page.drawText(IRON_EAGLE, {
    x: 50, y,
    size: 18, font: fontBold, color: BLACK,
  });

  y -= 28;
  page.drawText(NOTICE_HEADER, {
    x: 50, y,
    size: 14, font: fontBold, color: RED,
  });

  y -= 6;
  page.drawLine({
    start: { x: 50, y }, end: { x: width - 50, y },
    thickness: 1.5, color: RED,
  });

  // Reference block ─────────────────────────────────────────
  y -= 24;
  const refLines = [
    ['Incident Tracking ID', incident_id],
    ['Violation Classification', type.replace(/_/g, ' ')],
    ['Site Boundary Reference', location ?? 'Not recorded'],
    ['Enforcement Timestamp (NZST)', timestamp ?? new Date().toISOString()],
  ];

  for (const [label, value] of refLines) {
    page.drawText(`${label}:`, { x: 50, y, size: 10, font: fontBold,   color: GREY  });
    page.drawText(value,       { x: 220, y, size: 10, font: fontNormal, color: BLACK });
    y -= 18;
  }

  // Statutory declaration ────────────────────────────────────
  y -= 14;
  page.drawText('Statutory Declaration', {
    x: 50, y, size: 11, font: fontBold, color: BLACK,
  });

  y -= 6;
  page.drawLine({
    start: { x: 50, y }, end: { x: width - 50, y },
    thickness: 0.75, color: GREY,
  });

  y -= 20;

  const citation = type === 'SMOKE_COMPLAINT' ? SMOKE_CITATION : BIO_CITATION;
  page.drawText(citation, { x: 50, y, size: 10, font: fontBold, color: RED });

  y -= 20;
  const declarationText = type === 'SMOKE_COMPLAINT'
    ? 'This document constitutes an Abatement Notice issued under Section 326 of the Resource Management Act 1991. The subject property has been assessed as producing smoke or particulate emissions at or above the Ringelmann Scale 40% opacity threshold. Continued non-compliance will result in formal infringement proceedings and financial penalties as prescribed by the Act.'
    : 'This document constitutes a formal Breach Notice issued under the Biosecurity Act 1993. An authorised officer has identified conditions on the subject property that indicate the presence of a classified biosecurity hazard. The occupier is required to take immediate remedial action as directed by the issuing officer or face enforcement proceedings.';

  // Word-wrap body text at 70 chars per line
  const words     = declarationText.split(' ');
  let   line      = '';
  const lineWidth = 70;

  for (const word of words) {
    if ((line + word).length > lineWidth) {
      page.drawText(line.trim(), { x: 50, y, size: 9.5, font: fontNormal, color: BLACK });
      y -= 15;
      line = '';
    }
    line += word + ' ';
  }
  if (line.trim()) {
    page.drawText(line.trim(), { x: 50, y, size: 9.5, font: fontNormal, color: BLACK });
    y -= 15;
  }

  // Footer ─────────────────────────────────────────────────
  y -= 30;
  page.drawLine({
    start: { x: 50, y }, end: { x: width - 50, y },
    thickness: 0.5, color: GREY,
  });
  y -= 16;
  page.drawText('This notice was generated automatically by the Iron Eagle FieldOps Manager platform.', {
    x: 50, y, size: 8, font: fontNormal, color: GREY,
  });
  y -= 12;
  page.drawText('For enquiries contact: admin@ironeagle.co.nz | www.ironeagle.co.nz', {
    x: 50, y, size: 8, font: fontNormal, color: GREY,
  });

  // ── Serialise to bytes ────────────────────────────────────────────────────
  const pdfBytes = await pdfDoc.save();

  // ── Upload to Supabase Storage ────────────────────────────────────────────
  const storagePath = `notices/${incident_id}.pdf`;

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (storageError) {
    return errorResponse(`Storage upload failed: ${storageError.message}`, req, 500);
  }

  // Record the generated notice path on the incident row (non-fatal)
  await supabase
    .from('incidents')
    .update({ pdf_notice_path: storagePath })
    .eq('id', incident_id);

  return jsonResponse({ success: true, path: storagePath }, req, 201);
}));
