/**
 * xlsxExport.ts
 *
 * Utility for exporting data to Microsoft Excel (.xlsx) format.
 * Uses `write-excel-file` for lightweight browser-side workbook generation.
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

import writeXlsxFile from 'write-excel-file'

type XlsxPrimitive = string | number | boolean
type XlsxCell = { value?: XlsxPrimitive; fontWeight?: 'bold' }

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
function buildWorksheetRows<T extends Record<string, unknown>>(
  rows: T[],
  columns: XlsxColumn<T>[],
): Array<Array<XlsxCell>> {
  // Header row
  const header = columns.map((c) => ({ value: c.label, fontWeight: 'bold' as const }))

  // Data rows
  const data = rows.map((row) =>
    columns.map((col) => {
      const raw = row[col.key]
      if (col.format) {
        const value = col.format(raw, row)
        return value === null ? {} : { value: value as XlsxPrimitive }
      }
      if (raw === null || raw === undefined) return {}
      return { value: raw as XlsxPrimitive }
    }),
  )

  return [header, ...data]
}

function buildColumnWidths<T extends Record<string, unknown>>(
  rows: T[],
  columns: XlsxColumn<T>[],
): Array<{ width?: number }> {
  return columns.map((col) => {
    const headerLen = col.label.length
    const maxDataLen = rows.reduce((max, row) => {
      const raw = row[col.key]
      const cell = col.format ? col.format(raw, row) : (raw ?? '')
      return Math.max(max, String(cell).length)
    }, 0)
    return { width: Math.min(Math.max(headerLen, maxDataLen) + 2, 60) }
  })
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
): Promise<void> {
  const worksheetRows = buildWorksheetRows(rows, columns)
  const columnWidths = buildColumnWidths(rows, columns)

  return writeXlsxFile(worksheetRows, {
    columns: columnWidths,
    fileName: `${filename}.xlsx`,
    sheet: 'Data',
  })
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
): Promise<void> {
  const dataBySheet = sheets.map((sheet) => buildWorksheetRows(sheet.rows, sheet.columns))
  const columnsBySheet = sheets.map((sheet) => buildColumnWidths(sheet.rows, sheet.columns))
  const sheetNames = sheets.map((sheet) => sheet.name.slice(0, 31))

  return writeXlsxFile(dataBySheet, {
    columns: columnsBySheet,
    sheets: sheetNames,
    fileName: `${filename}.xlsx`,
  })
}
