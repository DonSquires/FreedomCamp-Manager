/**
 * xlsxExport.ts
 *
 * Utility for exporting data to Microsoft Excel (.xlsx) format.
 * Uses the `xlsx` (SheetJS) package which is already installed in this project.
 *
 * Usage:
 *   import { exportToXlsx, exportMultiSheetXlsx } from '@/lib/xlsxExport'
 *
 *   // Single sheet
 *   exportToXlsx(rows, columns, 'compliance-report')
 *
 *   // Multiple sheets (e.g. summary + data)
 *   exportMultiSheetXlsx([
 *     { name: 'Summary', rows: summaryRows, columns: summaryColumns },
 *     { name: 'Data', rows: dataRows, columns: dataColumns },
 *   ], 'weekly-report')
 */

import * as XLSX from 'xlsx'

export interface XlsxColumn<T = Record<string, unknown>> {
  /** Property key on the row object */
  key: keyof T & string
  /** Column header label shown in the spreadsheet */
  label: string
  /** Optional formatter applied before writing the cell value */
  format?: (value: unknown, row: T) => string | number | boolean | null
}

export interface XlsxSheet<T = Record<string, unknown>> {
  /** Sheet tab name (31 chars max — Excel limit) */
  name: string
  rows: T[]
  columns: XlsxColumn<T>[]
}

/**
 * Build a worksheet from rows + column definitions and apply minimal styling
 * (bold header row, auto-width columns).
 */
function buildWorksheet<T extends Record<string, unknown>>(
  rows: T[],
  columns: XlsxColumn<T>[],
): XLSX.WorkSheet {
  // Header row
  const header = columns.map((c) => c.label)

  // Data rows
  const data = rows.map((row) =>
    columns.map((col) => {
      const raw = row[col.key]
      if (col.format) return col.format(raw, row)
      if (raw === null || raw === undefined) return ''
      return raw as string | number | boolean
    }),
  )

  const wsData = [header, ...data]
  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // Auto-width: measure the widest value in each column
  const colWidths = columns.map((col, idx) => {
    const headerLen = col.label.length
    const maxDataLen = data.slice(1).reduce((max, rowArr) => {
      const cell = rowArr[idx]
      const len = cell != null ? String(cell).length : 0
      return Math.max(max, len)
    }, 0)
    return { wch: Math.min(Math.max(headerLen, maxDataLen) + 2, 60) }
  })
  ws['!cols'] = colWidths

  return ws
}

/**
 * Export a single array of records to a .xlsx file and trigger a browser download.
 *
 * @param rows     Array of data objects
 * @param columns  Column definitions (key + label + optional formatter)
 * @param filename Base filename without extension (e.g. 'compliance-report')
 */
export function exportToXlsx<T extends Record<string, unknown>>(
  rows: T[],
  columns: XlsxColumn<T>[],
  filename = 'export',
): void {
  const wb = XLSX.utils.book_new()
  const ws = buildWorksheet(rows, columns)
  XLSX.utils.book_append_sheet(wb, ws, 'Data')
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

/**
 * Export multiple named sheets into a single .xlsx workbook.
 *
 * @param sheets   Array of sheet definitions ({ name, rows, columns })
 * @param filename Base filename without extension
 */
export function exportMultiSheetXlsx<T extends Record<string, unknown>>(
  sheets: XlsxSheet<T>[],
  filename = 'export',
): void {
  const wb = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const ws = buildWorksheet(sheet.rows, sheet.columns)
    // Truncate sheet name to 31 chars (Excel limit)
    const safeName = sheet.name.slice(0, 31)
    XLSX.utils.book_append_sheet(wb, ws, safeName)
  }
  XLSX.writeFile(wb, `${filename}.xlsx`)
}
