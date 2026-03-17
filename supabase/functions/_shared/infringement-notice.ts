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
  offenceDescription: string
  legalBasis: string
  offenceDate: Date
  offenceLocation: string
  amountDollars: string
  dueDt: Date
  serviceMethod: string
  recipientName?: string
  issuerName: string
  issuerRole: string
  orgName: string
  zoneName: string
  summaryOfRights: string
}): string {
  const nzDate = (d: Date) =>
    d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Pacific/Auckland' })
  const nzTime = (d: Date) =>
    d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Pacific/Auckland' })

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Infringement Notice ${params.noticeNumber}</title>
  <style>
    @page { size: A4; margin: 15mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #000; background: #fff; }
    .page { width: 100%; max-width: 180mm; margin: 0 auto; }
    .page-break { page-break-before: always; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1e3a8a; padding-bottom: 8pt; margin-bottom: 12pt; }
    .org-name { font-size: 16pt; font-weight: bold; color: #1e3a8a; }
    .notice-type { font-size: 20pt; font-weight: bold; color: #dc2626; text-align: right; }
    .notice-number { font-size: 10pt; color: #666; text-align: right; }
    .plate-box { border: 3px solid #000; padding: 8pt 16pt; display: inline-block; font-size: 28pt; font-weight: bold; font-family: 'Courier New', monospace; letter-spacing: 4pt; margin: 8pt 0; background: #fff; }
    .section { margin-bottom: 10pt; }
    .section-title { font-weight: bold; font-size: 9pt; text-transform: uppercase; color: #555; border-bottom: 1px solid #ccc; padding-bottom: 2pt; margin-bottom: 4pt; }
    .field-row { display: flex; gap: 16pt; margin-bottom: 4pt; }
    .field { flex: 1; }
    .field-label { font-size: 8pt; color: #777; }
    .field-value { font-size: 10pt; border-bottom: 1px solid #ccc; padding-bottom: 1pt; min-height: 14pt; }
    .amount-box { border: 2px solid #dc2626; padding: 8pt 12pt; text-align: center; margin: 8pt 0; }
    .amount-label { font-size: 9pt; text-transform: uppercase; color: #dc2626; }
    .amount-value { font-size: 24pt; font-weight: bold; color: #dc2626; }
    .amount-due { font-size: 9pt; color: #555; }
    .footer { margin-top: 12pt; font-size: 8pt; color: #777; border-top: 1px solid #ccc; padding-top: 6pt; }
    .rights-title { font-size: 14pt; font-weight: bold; color: #1e3a8a; margin-bottom: 12pt; border-bottom: 2px solid #1e3a8a; padding-bottom: 4pt; }
    .rights-text { font-size: 10pt; line-height: 1.5; white-space: pre-wrap; }
    @media screen { .print-bar { background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px; margin-bottom: 16pt; display: flex; gap: 8px; align-items: center; } }
    @media print { .print-bar { display: none; } }
  </style>
</head>
<body>
  <div class="print-bar">
    <button onclick="window.print()" style="background:#1e3a8a;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:12px;">Print Notice</button>
    <span style="font-size:12px;color:#475569;">Use your browser print dialog to print or save as PDF.</span>
  </div>

  <div class="page">
    <div class="header">
      <div>
        <div class="org-name">${params.orgName}</div>
        <div style="font-size:9pt;color:#555;margin-top:2pt;">Freedom Camping Act 2011 Infringement Notice</div>
      </div>
      <div>
        <div class="notice-type">INFRINGEMENT</div>
        <div class="notice-number">Notice #: ${params.noticeNumber}</div>
      </div>
    </div>

    <div class="plate-box">${params.platNumber}</div>

    <div class="section">
      <div class="section-title">Offence Details</div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">Offence Description</div>
          <div class="field-value">${params.offenceDescription}</div>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">Legal Basis</div>
          <div class="field-value">${params.legalBasis}</div>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">Offence Date</div>
          <div class="field-value">${nzDate(params.offenceDate)} ${nzTime(params.offenceDate)}</div>
        </div>
        <div class="field">
          <div class="field-label">Location</div>
          <div class="field-value">${params.offenceLocation}</div>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">Zone</div>
          <div class="field-value">${params.zoneName}</div>
        </div>
        <div class="field">
          <div class="field-label">Service Method</div>
          <div class="field-value">${params.serviceMethod}</div>
        </div>
      </div>
    </div>

    <div class="amount-box">
      <div class="amount-label">Amount Due</div>
      <div class="amount-value">NZD $${params.amountDollars}</div>
      <div class="amount-due">Due by ${nzDate(params.dueDt)}</div>
    </div>

    <div class="section">
      <div class="section-title">Recipient</div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">Recipient Name</div>
          <div class="field-value">${params.recipientName || 'Unknown / On-site service'}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Issuing Officer</div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">Officer</div>
          <div class="field-value">${params.issuerName}</div>
        </div>
        <div class="field">
          <div class="field-label">Role</div>
          <div class="field-value">${params.issuerRole}</div>
        </div>
      </div>
    </div>

    <div class="footer">
      This notice was generated electronically and is valid without handwritten signature where permitted.
    </div>
  </div>

  <div class="page page-break">
    <div class="rights-title">Summary of Rights</div>
    <div class="rights-text">${params.summaryOfRights}</div>
  </div>
</body>
</html>`
}