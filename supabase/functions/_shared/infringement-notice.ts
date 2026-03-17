export const NZ_DEFAULT_SUMMARY_OF_RIGHTS = `
SUMMARY OF RIGHTS — FREEDOM CAMPING ACT 2011 (s20)

You have received this infringement notice for an alleged offence under the Freedom Camping Act 2011 (FCA) and/or the applicable local authority bylaw.

YOUR OPTIONS:

1. PAY THE FEE
   Pay the infringement fee shown on the front of this notice within 28 days of the issue date. Payment details are on the front of this notice.

2. WRITE IN (DENY THE OFFENCE)
   Send written submissions to the issuing authority within 28 days. Your submissions will be considered and you will be advised of the outcome. If the infringement is not cancelled, you may be served with a reminder notice.

3. REQUEST A COURT HEARING
   You may elect to have the matter dealt with by a court. Contact the issuing authority in writing within 28 days to request a hearing. Court costs may be awarded against you if you are convicted.

4. DO NOTHING
   If you do not respond within 28 days, a reminder notice may be issued with an additional fee. The matter may then be referred to the District Court.

For further information contact the issuing authority shown on the front of this notice.

This notice is issued under the Freedom Camping Act 2011 and/or the applicable territorial authority bylaw.
`.trim()

export function generateNoticeHtml(params: {
  noticeNumber: string
  platNumber: string
  vehicleMake?: string | null
  vehicleModel?: string | null
  offenceDescription: string
  legalBasis: string
  offenceDate: Date
  offenceLocation: string
  offenceGps?: string
  jurisdiction?: string
  amountDollars: string
  dueDt: Date
  serviceMethod: string
  recipientName?: string
  issuerWarrantNumber?: string
  issuerRole: string
  orgName: string
  orgAddress?: string
  orgPhone?: string
  orgEmail?: string
  paymentOnlineUrl?: string
  paymentBankAccount?: string
  paymentInstructions?: string
  objectionsEmail?: string
  objectionsPostalAddress?: string
  zoneName: string
  summaryOfRights: string
}): string {
  const nzDate = (d: Date) =>
    d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Pacific/Auckland' })
  const nzTime = (d: Date) =>
    d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Pacific/Auckland' })

  const vehicleDesc = [params.vehicleMake, params.vehicleModel].filter(Boolean).join(' ') || 'Not recorded'
  const orgContactLines = [
    params.orgAddress,
    params.orgPhone ? `Ph: ${params.orgPhone}` : null,
    params.orgEmail ? `Email: ${params.orgEmail}` : null,
  ].filter(Boolean).join('&nbsp;&nbsp;|&nbsp;&nbsp;')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Infringement Notice ${params.noticeNumber}</title>
  <style>
    @page { size: A4; margin: 12mm 15mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #000; background: #fff; }
    .page { width: 100%; max-width: 180mm; margin: 0 auto; }
    .page-break { page-break-before: always; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1e3a8a; padding-bottom: 7pt; margin-bottom: 10pt; }
    .org-name { font-size: 15pt; font-weight: bold; color: #1e3a8a; }
    .org-contact { font-size: 7.5pt; color: #444; margin-top: 3pt; }
    .notice-type { font-size: 18pt; font-weight: bold; color: #dc2626; text-align: right; }
    .notice-meta { font-size: 9pt; color: #444; text-align: right; margin-top: 3pt; }
    .plate-box { border: 3px solid #000; padding: 6pt 14pt; display: inline-block; font-size: 26pt; font-weight: bold; font-family: 'Courier New', monospace; letter-spacing: 4pt; margin: 6pt 0 2pt; background: #fff; }
    .section { margin-bottom: 9pt; }
    .section-title { font-weight: bold; font-size: 8.5pt; text-transform: uppercase; color: #444; border-bottom: 1px solid #bbb; padding-bottom: 2pt; margin-bottom: 4pt; letter-spacing: 0.5pt; }
    .field-row { display: flex; gap: 14pt; margin-bottom: 4pt; }
    .field { flex: 1; }
    .field-label { font-size: 7.5pt; color: #666; margin-bottom: 1pt; }
    .field-value { font-size: 10pt; border-bottom: 1px solid #ccc; padding-bottom: 1pt; min-height: 13pt; }
    .amount-box { border: 2.5px solid #dc2626; padding: 7pt 12pt; text-align: center; margin: 8pt 0; background: #fff9f9; }
    .amount-label { font-size: 8.5pt; text-transform: uppercase; color: #dc2626; font-weight: bold; letter-spacing: 0.5pt; }
    .amount-value { font-size: 22pt; font-weight: bold; color: #dc2626; margin: 2pt 0; }
    .amount-due { font-size: 9pt; color: #555; }
    .payment-box { border: 1px solid #1e3a8a; padding: 6pt 10pt; margin: 8pt 0; background: #f0f4ff; font-size: 9pt; }
    .payment-box-title { font-weight: bold; color: #1e3a8a; margin-bottom: 3pt; font-size: 8.5pt; text-transform: uppercase; }
    .contact-box { border: 1px solid #334155; padding: 6pt 10pt; margin: 8pt 0; background: #f8fafc; font-size: 9pt; }
    .contact-box-title { font-weight: bold; color: #0f172a; margin-bottom: 3pt; font-size: 8.5pt; text-transform: uppercase; }
    .footer { margin-top: 10pt; font-size: 7.5pt; color: #666; border-top: 1px solid #ccc; padding-top: 5pt; }
    .rights-title { font-size: 13pt; font-weight: bold; color: #1e3a8a; margin-bottom: 10pt; border-bottom: 2px solid #1e3a8a; padding-bottom: 4pt; }
    .rights-text { font-size: 9.5pt; line-height: 1.55; white-space: pre-wrap; }
    @media screen { .print-bar { background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px; margin-bottom: 14pt; display: flex; gap: 8px; align-items: center; border-radius: 6px; } }
    @media print { .print-bar { display: none; } }
  </style>
</head>
<body>
  <div class="print-bar">
    <button onclick="window.print()" style="background:#1e3a8a;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:12px;">Print Notice</button>
    <span style="font-size:12px;color:#64748b;">Notice ${params.noticeNumber} — ${params.platNumber}</span>
  </div>

  <div class="page">
    <div class="header">
      <div>
        <div class="org-name">${params.orgName}</div>
        <div style="font-size:8.5pt;color:#1e3a8a;font-weight:bold;margin-top:1pt;">Freedom Camping Act 2011 — Infringement Notice</div>
        ${orgContactLines ? `<div class="org-contact">${orgContactLines}</div>` : ''}
      </div>
      <div style="text-align:right;">
        <div class="notice-type">INFRINGEMENT NOTICE</div>
        <div class="notice-meta">Notice No: <strong>${params.noticeNumber}</strong></div>
        <div class="notice-meta">Date Issued: <strong>${nzDate(new Date())}</strong></div>
        <div class="notice-meta">Time Issued: <strong>${nzTime(new Date())}</strong></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Vehicle Identification</div>
      <div class="field-row">
        <div class="field" style="flex:0 0 auto;">
          <div class="field-label">Registration Plate</div>
          <div class="plate-box">${params.platNumber}</div>
        </div>
        <div class="field" style="padding-top:6pt;">
          <div class="field-row" style="margin-bottom:0;">
            <div class="field">
              <div class="field-label">Vehicle Make</div>
              <div class="field-value">${params.vehicleMake ?? '&nbsp;'}</div>
            </div>
            <div class="field">
              <div class="field-label">Vehicle Model</div>
              <div class="field-value">${params.vehicleModel ?? '&nbsp;'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Alleged Offence</div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">Date of Offence</div>
          <div class="field-value">${nzDate(params.offenceDate)}</div>
        </div>
        <div class="field">
          <div class="field-label">Time of Offence</div>
          <div class="field-value">${nzTime(params.offenceDate)}</div>
        </div>
      </div>
      <div class="field" style="margin-bottom:4pt;">
        <div class="field-label">Jurisdiction</div>
        <div class="field-value">${params.jurisdiction || params.zoneName || '&nbsp;'}</div>
      </div>
      <div class="field" style="margin-bottom:4pt;">
        <div class="field">
          <div class="field-label">Location of Offence (recorded address / locality)</div>
          <div class="field-value">${params.offenceLocation}</div>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">GPS Coordinates</div>
          <div class="field-value">${params.offenceGps || '&nbsp;'}</div>
        </div>
        <div class="field">
          <div class="field-label">Zone</div>
          <div class="field-value">${params.zoneName || '&nbsp;'}</div>
        </div>
      </div>
      <div class="field" style="margin-bottom:4pt;">
        <div class="field-label">Nature of Alleged Offence</div>
        <div class="field-value" style="font-weight:bold;">${params.offenceDescription}</div>
      </div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">Legal Basis</div>
          <div class="field-value">${params.legalBasis}</div>
        </div>
        <div class="field">
          <div class="field-label">Offence Reference No.</div>
          <div class="field-value">${params.noticeNumber}-01</div>
        </div>
      </div>
    </div>

    <div class="amount-box">
      <div class="amount-label">Infringement Fee Payable</div>
      <div class="amount-value">NZD $${params.amountDollars}</div>
      <div class="amount-due">Payment due within 28 days — by <strong>${nzDate(params.dueDt)}</strong></div>
    </div>

    <div class="payment-box">
      <div class="payment-box-title">How To Pay This Infringement</div>
      <div>${params.orgName}${params.orgAddress ? ' &mdash; ' + params.orgAddress : ''}</div>
      ${params.orgPhone ? `<div>Phone: ${params.orgPhone}</div>` : ''}
      ${params.orgEmail ? `<div>Email: ${params.orgEmail}</div>` : ''}
      ${params.paymentOnlineUrl ? `<div>Online payment: ${params.paymentOnlineUrl}</div>` : ''}
      ${params.paymentBankAccount ? `<div>Bank account: ${params.paymentBankAccount}</div>` : ''}
      ${params.paymentInstructions ? `<div style="margin-top:3pt;">${params.paymentInstructions}</div>` : ''}
      <div style="margin-top:3pt;font-size:8.5pt;color:#444;">Quote infringement notice number <strong>${params.noticeNumber}</strong> in all correspondence.</div>
    </div>

    <div class="contact-box">
      <div class="contact-box-title">How To Lodge An Objection</div>
      ${params.objectionsEmail ? `<div>Email objections to: ${params.objectionsEmail}</div>` : ''}
      ${params.objectionsPostalAddress ? `<div>Post objections to: ${params.objectionsPostalAddress}</div>` : ''}
      ${!params.objectionsEmail && !params.objectionsPostalAddress ? `<div>Send written objections to ${params.orgName} using the contact details above.</div>` : ''}
      <div style="margin-top:3pt;font-size:8.5pt;color:#444;">Written objections must quote notice number <strong>${params.noticeNumber}</strong> and be sent within 28 days.</div>
    </div>

    <div class="section">
      <div class="section-title">Issued To</div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">Name (if known)</div>
          <div class="field-value">${params.recipientName || 'Owner / Registered Operator of Vehicle'}</div>
        </div>
        <div class="field">
          <div class="field-label">Service Method</div>
          <div class="field-value">${params.serviceMethod === 'hand' ? 'Hand delivered (on-site)' : params.serviceMethod === 'post' ? 'Posted' : 'Email'}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Enforcement Officer</div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">Officer Warrant No.</div>
          <div class="field-value">${params.issuerWarrantNumber || '&nbsp;'}</div>
        </div>
        <div class="field">
          <div class="field-label">Role / Authority</div>
          <div class="field-value">${params.issuerRole}</div>
        </div>
      </div>
      <div class="field-row">
        <div class="field" style="flex:2;">
          <div class="field-label">Officer Signature</div>
          <div class="field-value" style="height:28pt;"></div>
        </div>
        <div class="field">
          <div class="field-label">Date Signed</div>
          <div class="field-value" style="height:28pt;"></div>
        </div>
      </div>
    </div>

    <div class="footer">
      See overleaf for Notes to Defendant (Summary of Rights). This notice is issued under section 20 of the Freedom Camping Act 2011 and/or the applicable territorial authority bylaw.
      Infringement notice number <strong>${params.noticeNumber}</strong> issued by <strong>${params.orgName}</strong> on ${nzDate(new Date())}.
    </div>
  </div>

  <div class="page page-break">
    <div class="rights-title">NOTES TO DEFENDANT — SUMMARY OF RIGHTS</div>
    <div class="rights-text">${params.summaryOfRights}</div>
    <div class="footer" style="margin-top:20pt;">
      Notice No: ${params.noticeNumber}&nbsp;&nbsp;|&nbsp;&nbsp;Vehicle: ${params.platNumber} ${vehicleDesc}&nbsp;&nbsp;|&nbsp;&nbsp;Issued: ${nzDate(new Date())}&nbsp;&nbsp;|&nbsp;&nbsp;${params.orgName}
    </div>
  </div>
</body>
</html>`
}