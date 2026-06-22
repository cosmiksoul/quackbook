import { describe, expect, it } from 'vitest'
import { buildChartSpec, isNumericType, isTemporalType } from './chartSpec'

describe('type predicates', () => {
  it('recognizes numeric Arrow types', () => {
    expect(isNumericType('Int64')).toBe(true)
    expect(isNumericType('Float64')).toBe(true)
    expect(isNumericType('Decimal<18, 3>')).toBe(true)
    expect(isNumericType('Utf8')).toBe(false)
    // dictionary-of-strings is categorical, NOT numeric
    expect(isNumericType('Dictionary<Int32, Utf8>')).toBe(false)
  })
  it('recognizes temporal Arrow types', () => {
    expect(isTemporalType('Date32<DAY>')).toBe(true)
    expect(isTemporalType('Timestamp<MICROSECOND>')).toBe(true)
    expect(isTemporalType('Utf8')).toBe(false)
  })
})

describe('buildChartSpec', () => {
  it('picks first non-numeric as X, first numeric as Y, bar by default', () => {
    expect(
      buildChartSpec([
        { name: 'country', type: 'Utf8' },
        { name: 'n', type: 'Int64' },
      ]),
    ).toEqual({ kind: 'bar', x: 'country', y: 'n' })
  })
  it('uses line when X is temporal', () => {
    expect(
      buildChartSpec([
        { name: 'm', type: 'Date32<DAY>' },
        { name: 'arpu', type: 'Float64' },
      ]),
    ).toEqual({ kind: 'line', x: 'm', y: 'arpu' })
  })
  it('returns null when there is no numeric column', () => {
    expect(
      buildChartSpec([
        { name: 'a', type: 'Utf8' },
        { name: 'b', type: 'Utf8' },
      ]),
    ).toBeNull()
  })
  it('returns null when there is no non-numeric column for X', () => {
    expect(
      buildChartSpec([{ name: 'n', type: 'Int64' }]),
    ).toBeNull()
  })
})
