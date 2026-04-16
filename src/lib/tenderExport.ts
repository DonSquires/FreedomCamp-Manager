/**
 * Tender Document Export Utilities
 *
 * generateTenderHtml    — builds a printable HTML document from sections
 * exportTenderPdf       — opens the HTML in a new tab / triggers browser print dialog
 * downloadTenderDocx    — downloads an HTML-based .doc file that Word can open
 */

export interface TenderSections {
  cover_letter?: string
  executive_summary?: string
  services_offered?: string
  pricing_notes?: string
  team_qualifications?: string
  health_and_safety?: string
  declaration?: string
}

export interface TenderDocMeta {
  title: string
  issuing_body?: string
  reference_number?: string
  due_date?: string
  organization_name?: string
  owner_name?: string
  export_date?: string
}

/** Build a clean, print-ready HTML string for a tender response. */
export function generateTenderHtml(meta: TenderDocMeta, sections: TenderSections): string {
  const sectionHtml = (heading: string, content: string | undefined): string => {
    if (!content?.trim()) return ''
    const lines = content
      .split('\n')
      .map((l) => `<p>${escapeHtml(l)}</p>`)
      .join('')
    return `<div class="section"><h2>${escapeHtml(heading)}</h2>${lines}</div>`
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(meta.title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #1a1a1a;
      background: #fff;
      padding: 0;
    }
    .page { max-width: 210mm; margin: 0 auto; padding: 20mm 25mm; }
    .header {
      border-bottom: 2px solid #003366;
      padding-bottom: 12px;
      margin-bottom: 28px;
      text-align: center;
    }
    .header-title { font-size: 10pt; color: #555; margin-bottom: 4px; }
    .header-org {
      font-size: 15pt;
      font-weight: bold;
      color: #003366;
      margin-bottom: 4px;
    }
    .header-ref { font-size: 9pt; color: #777; }
    h1 { font-size: 14pt; color: #003366; margin-bottom: 16px; }
    .cover { text-align: center; padding: 40px 0 60px; }
    .cover h1 { font-size: 20pt; margin-bottom: 12px; }
    .cover .meta-table { margin: 20px auto; width: auto; }
    .cover .meta-table td { padding: 4px 16px 4px 0; font-size: 10pt; }
    .cover .meta-table td:first-child { font-weight: bold; color: #555; }
    .section { margin-bottom: 28px; page-break-inside: avoid; }
    .section h2 {
      font-size: 12pt;
      color: #003366;
      border-bottom: 1px solid #cce0ff;
      padding-bottom: 4px;
      margin-bottom: 10px;
    }
    .section p { margin-bottom: 6px; }
    .footer {
      margin-top: 48px;
      border-top: 1px solid #ddd;
      padding-top: 10px;
      font-size: 8pt;
      color: #999;
      text-align: center;
    }
    @media print {
      .page { padding: 0; max-width: 100%; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="header-title">Tender Response</div>
    <div class="header-org">${escapeHtml(meta.organization_name || 'Iron Eagle Security')}</div>
    ${meta.reference_number ? `<div class="header-ref">Ref: ${escapeHtml(meta.reference_number)}</div>` : ''}
  </div>

  <div class="cover">
    <h1>${escapeHtml(meta.title)}</h1>
    <table class="meta-table">
      <tbody>
        ${meta.issuing_body ? `<tr><td>Submitted to:</td><td>${escapeHtml(meta.issuing_body)}</td></tr>` : ''}
        ${meta.reference_number ? `<tr><td>Reference:</td><td>${escapeHtml(meta.reference_number)}</td></tr>` : ''}
        ${meta.due_date ? `<tr><td>Submission date:</td><td>${escapeHtml(meta.due_date)}</td></tr>` : ''}
        ${meta.export_date ? `<tr><td>Prepared:</td><td>${escapeHtml(meta.export_date)}</td></tr>` : ''}
        ${meta.owner_name ? `<tr><td>Prepared by:</td><td>${escapeHtml(meta.owner_name)}</td></tr>` : ''}
      </tbody>
    </table>
  </div>

  ${sectionHtml('Cover Letter', sections.cover_letter)}
  ${sectionHtml('Executive Summary', sections.executive_summary)}
  ${sectionHtml('Services Offered', sections.services_offered)}
  ${sectionHtml('Pricing', sections.pricing_notes)}
  ${sectionHtml('Team Qualifications', sections.team_qualifications)}
  ${sectionHtml('Health & Safety', sections.health_and_safety)}
  ${sectionHtml('Declaration', sections.declaration)}

  <div class="footer">
    Confidential — prepared by ${escapeHtml(meta.organization_name || 'Iron Eagle Security')} on ${escapeHtml(meta.export_date || new Date().toLocaleDateString('en-NZ'))}
  </div>
</div>
</body>
</html>`
}

/** Open the generated HTML in a new window and trigger the browser print dialog. */
export function exportTenderPdf(html: string): void {
  const win = window.open('', '_blank')
  if (!win) {
    alert('Pop-up blocked. Please allow pop-ups for this site and try again.')
    return
  }
  win.document.open()
  win.document.write(html)
  win.document.close()

  const tryPrint = () => {
    win.focus()
    win.print()
  }

  if (win.document.readyState === 'complete') {
    tryPrint()
  } else {
    win.onload = tryPrint
  }
}

/**
 * Download the HTML document as a .doc file.
 * Word (and LibreOffice Writer) can open HTML files with the .doc extension.
 */
export function downloadTenderDocx(html: string, fileName: string): void {
  const blob = new Blob([html], { type: 'application/msword;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.endsWith('.doc') ? fileName : `${fileName}.doc`
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 100)
}

/** Safe HTML entity escaping */
function escapeHtml(text: string): string {
  return (text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
