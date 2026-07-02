import { tableFromArrays } from 'apache-arrow'
import { describe, expect, it } from 'vitest'
import { arrowToRows, dedupeColumnNames, formatCell, scaleDecimalDigits } from './arrowToRows'

describe('arrowToRows', () => {
  it('extracts column names and row objects from an Arrow table', () => {
    const table = tableFromArrays({
      country: ['DE', 'PL', 'RU'],
      n: [12840, 9610, 8205],
    })

    const result = arrowToRows(table)

    expect(result.numRows).toBe(3)
    expect(result.columns.map((c) => c.name)).toEqual(['country', 'n'])
    expect(result.rows[0]).toEqual({ country: 'DE', n: 12840 })
    expect(result.rows).toHaveLength(3)
  })

  it('reports column type names', () => {
    const table = tableFromArrays({ country: ['DE'] })
    const result = arrowToRows(table)
    // apache-arrow@17 stringifies a string column built by tableFromArrays as
    // 'Dictionary<Int32, Utf8>' (dictionary-encoded). Plan permitted adjusting
    // this literal to the actual String(f.type) value.
    expect(result.columns[0]).toEqual({ name: 'country', type: 'Dictionary<Int32, Utf8>' })
  })
})

describe('dedupeColumnNames', () => {
  it('leaves unique names untouched', () => {
    expect(dedupeColumnNames(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })
  it('suffixes repeats in order', () => {
    expect(dedupeColumnNames(['id', 'id', 'x', 'id'])).toEqual([
      'id',
      'id_1',
      'x',
      'id_2',
    ])
  })
})

describe('scaleDecimalDigits', () => {
  it('inserts the decimal point at scale', () => {
    expect(scaleDecimalDigits('1500', 3)).toBe('1.500')
  })
  it('pads small magnitudes with zeros', () => {
    expect(scaleDecimalDigits('7', 2)).toBe('0.07')
  })
  it('keeps the sign', () => {
    expect(scaleDecimalDigits('-7', 2)).toBe('-0.07')
  })
})

describe('formatCell', () => {
  it('null/undefined -> empty string', () => {
    expect(formatCell(null)).toBe('')
    expect(formatCell(undefined)).toBe('')
  })
  it('bigint -> string', () => {
    expect(formatCell(42n)).toBe('42')
  })
  it('Date + Date-type -> date only (ISO)', () => {
    expect(formatCell(new Date(Date.UTC(2025, 3, 9)), 'Date32<DAY>')).toBe('2025-04-09')
    expect(formatCell(new Date(Date.UTC(2025, 3, 9)), 'DATE')).toBe('2025-04-09')
  })
  it('Date + Timestamp-type -> datetime (ISO, UTC)', () => {
    expect(formatCell(new Date(Date.UTC(2025, 3, 9, 10, 30)), 'Timestamp<MICROSECOND>')).toBe('2025-04-09 10:30:00')
  })
})
