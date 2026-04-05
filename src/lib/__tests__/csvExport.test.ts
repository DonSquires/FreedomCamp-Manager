import { describe, it, expect } from 'vitest'
import { arrayToCSV, CSVColumn } from '../csvExport'

describe('arrayToCSV', () => {
  it('generates headers from column labels', () => {
    const columns: CSVColumn[] = [
      { key: 'name', label: 'Name' },
      { key: 'age', label: 'Age' },
    ]
    const csv = arrayToCSV([], columns)
    expect(csv).toBe('Name,Age')
  })

  it('generates data rows', () => {
    const columns: CSVColumn[] = [
      { key: 'name', label: 'Name' },
      { key: 'value', label: 'Value' },
    ]
    const data = [
      { name: 'Alpha', value: 1 },
      { name: 'Beta', value: 2 },
    ]
    const csv = arrayToCSV(data, columns)
    const lines = csv.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('Name,Value')
    expect(lines[1]).toBe('Alpha,1')
    expect(lines[2]).toBe('Beta,2')
  })

  it('applies format functions', () => {
    const columns: CSVColumn[] = [
      { key: 'active', label: 'Active', format: (val) => (val ? 'Yes' : 'No') },
    ]
    const data = [{ active: true }, { active: false }]
    const csv = arrayToCSV(data, columns)
    const lines = csv.split('\n')
    expect(lines[1]).toBe('Yes')
    expect(lines[2]).toBe('No')
  })

  it('handles null and undefined values', () => {
    const columns: CSVColumn[] = [
      { key: 'name', label: 'Name' },
    ]
    const data = [{ name: null }, { name: undefined }]
    const csv = arrayToCSV(data, columns)
    const lines = csv.split('\n')
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe('')
  })

  it('escapes commas in values', () => {
    const columns: CSVColumn[] = [
      { key: 'address', label: 'Address' },
    ]
    const data = [{ address: 'Wellington, New Zealand' }]
    const csv = arrayToCSV(data, columns)
    const lines = csv.split('\n')
    expect(lines[1]).toBe('"Wellington, New Zealand"')
  })

  it('escapes quotes in values', () => {
    const columns: CSVColumn[] = [
      { key: 'note', label: 'Note' },
    ]
    const data = [{ note: 'Said "hello"' }]
    const csv = arrayToCSV(data, columns)
    const lines = csv.split('\n')
    expect(lines[1]).toBe('"Said ""hello"""')
  })

  it('escapes newlines in values', () => {
    const columns: CSVColumn[] = [
      { key: 'text', label: 'Text' },
    ]
    const data = [{ text: 'line1\nline2' }]
    const csv = arrayToCSV(data, columns)
    expect(csv).toContain('"line1\nline2"')
  })

  it('passes row to format function', () => {
    const columns: CSVColumn[] = [
      {
        key: 'first',
        label: 'Full Name',
        format: (val, row) => `${val} ${row.last}`,
      },
    ]
    const data = [{ first: 'John', last: 'Doe' }]
    const csv = arrayToCSV(data, columns)
    const lines = csv.split('\n')
    expect(lines[1]).toBe('John Doe')
  })

  it('handles empty data array', () => {
    const columns: CSVColumn[] = [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ]
    const csv = arrayToCSV([], columns)
    expect(csv).toBe('A,B')
  })

  it('escapes header labels with commas', () => {
    const columns: CSVColumn[] = [
      { key: 'x', label: 'First, Last' },
    ]
    const csv = arrayToCSV([], columns)
    expect(csv).toBe('"First, Last"')
  })
})
