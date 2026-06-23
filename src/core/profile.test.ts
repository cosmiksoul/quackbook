import { describe, expect, it } from 'vitest'
import { classifyColumn, parseSummarize, THRESHOLD_DISTINCT } from './profile'
import type { QueryResult } from './arrowToRows'

describe('classifyColumn', () => {
  it('numeric for integer/real/decimal families', () => {
    expect(classifyColumn('BIGINT', 100, THRESHOLD_DISTINCT)).toBe('numeric')
    expect(classifyColumn('HUGEINT', 100, THRESHOLD_DISTINCT)).toBe('numeric')
    expect(classifyColumn('DOUBLE', 100, THRESHOLD_DISTINCT)).toBe('numeric')
    expect(classifyColumn('FLOAT', 5, THRESHOLD_DISTINCT)).toBe('numeric')
    expect(classifyColumn('INTEGER', 9999, THRESHOLD_DISTINCT)).toBe('numeric')
    expect(classifyColumn('DECIMAL(18,3)', 7, THRESHOLD_DISTINCT)).toBe('numeric')
  })
  it('boolean is categorical regardless of distinct', () => {
    expect(classifyColumn('BOOLEAN', 2, THRESHOLD_DISTINCT)).toBe('categorical')
  })
  it('varchar under threshold is categorical, over threshold is highCardinality', () => {
    expect(classifyColumn('VARCHAR', 12, 50)).toBe('categorical')
    expect(classifyColumn('VARCHAR', 50, 50)).toBe('categorical') // <= threshold
    expect(classifyColumn('VARCHAR', 51, 50)).toBe('highCardinality')
  })
  it('date/timestamp/time are range', () => {
    expect(classifyColumn('DATE', 365, THRESHOLD_DISTINCT)).toBe('range')
    expect(classifyColumn('TIMESTAMP', 1000, THRESHOLD_DISTINCT)).toBe('range')
    expect(classifyColumn('TIMESTAMP WITH TIME ZONE', 1000, THRESHOLD_DISTINCT)).toBe('range')
    expect(classifyColumn('TIME', 24, THRESHOLD_DISTINCT)).toBe('range')
  })
  it('anything else is highCardinality', () => {
    expect(classifyColumn('UUID', 9, THRESHOLD_DISTINCT)).toBe('highCardinality')
    expect(classifyColumn('BLOB', 9, THRESHOLD_DISTINCT)).toBe('highCardinality')
  })
})

// SUMMARIZE returns column_name/column_type (Utf8), min/max/q50 (STRINGS),
// approx_unique (Int64 -> BigInt). null_percentage (Decimal) is IGNORED.
function fakeSummarize(
  rows: Record<string, unknown>[],
): QueryResult {
  return {
    columns: [
      { name: 'column_name', type: 'Utf8' },
      { name: 'column_type', type: 'Utf8' },
      { name: 'min', type: 'Utf8' },
      { name: 'max', type: 'Utf8' },
      { name: 'approx_unique', type: 'Int64' },
      { name: 'q50', type: 'Utf8' },
    ],
    rows,
    numRows: rows.length,
  }
}

describe('parseSummarize', () => {
  it('maps each row to {name,type,approxUnique,min,max,median}; counts as Number, stats as strings', () => {
    const r = fakeSummarize([
      { column_name: 'rev', column_type: 'DOUBLE', min: '0.99', max: '312.0', approx_unique: 240n, q50: '14.5' },
      { column_name: 'country', column_type: 'VARCHAR', min: 'AE', max: 'ZW', approx_unique: 12n, q50: null },
    ])
    expect(parseSummarize(r)).toEqual([
      { name: 'rev', type: 'DOUBLE', approxUnique: 240, min: '0.99', max: '312.0', median: '14.5' },
      { name: 'country', type: 'VARCHAR', approxUnique: 12, min: 'AE', max: 'ZW', median: null },
    ])
  })
  it('coerces a missing/null approx_unique to 0 and a null min/max to null', () => {
    const r = fakeSummarize([
      { column_name: 'x', column_type: 'BIGINT', min: null, max: null, approx_unique: null, q50: null },
    ])
    expect(parseSummarize(r)).toEqual([
      { name: 'x', type: 'BIGINT', approxUnique: 0, min: null, max: null, median: null },
    ])
  })
})
