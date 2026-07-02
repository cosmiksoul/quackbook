import { describe, expect, it } from 'vitest'
import {
  buildHistogramQuery,
  buildNullCountQuery,
  buildTopValuesQuery,
  classifyColumn,
  interpretHistogram,
  interpretNullCounts,
  interpretTopValues,
  parseSummarize,
  THRESHOLD_DISTINCT,
} from './profile'
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
  it('classifies TIMESTAMP_NS / TIMESTAMP_MS / TIMESTAMP_S as range', () => {
    expect(classifyColumn('TIMESTAMP_NS', 1000, 50)).toBe('range')
    expect(classifyColumn('TIMESTAMP_MS', 1000, 50)).toBe('range')
    expect(classifyColumn('TIMESTAMP_S', 1000, 50)).toBe('range')
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

describe('buildNullCountQuery', () => {
  it('one pass: total + a FILTERed null count per column, quoted idents', () => {
    expect(buildNullCountQuery('events', ['country', 'rev'])).toBe(
      'SELECT count(*) AS total, ' +
        'count(*) FILTER (WHERE "country" IS NULL) AS n0, ' +
        'count(*) FILTER (WHERE "rev" IS NULL) AS n1 ' +
        'FROM "events"',
    )
  })
  it('escapes identifiers with embedded quotes', () => {
    expect(buildNullCountQuery('_qb_raw_t', ['we"ird'])).toBe(
      'SELECT count(*) AS total, ' +
        'count(*) FILTER (WHERE "we""ird" IS NULL) AS n0 ' +
        'FROM "_qb_raw_t"',
    )
  })
  it('still selects total when there are no columns', () => {
    expect(buildNullCountQuery('events', [])).toBe('SELECT count(*) AS total FROM "events"')
  })
})

describe('interpretNullCounts', () => {
  it('maps total + n0..nk (BigInt) into Number total and per-column counts', () => {
    const row = { total: 48210n, n0: 0n, n1: 3n }
    expect(interpretNullCounts(row, ['country', 'rev'])).toEqual({
      total: 48210,
      nulls: { country: 0, rev: 3 },
    })
  })
  it('coerces null/undefined cells to 0', () => {
    expect(interpretNullCounts({ total: null, n0: null }, ['x'])).toEqual({
      total: 0,
      nulls: { x: 0 },
    })
  })
})

describe('buildTopValuesQuery', () => {
  it('GROUP BY a non-null column ORDER BY count DESC LIMIT k, quoted ident', () => {
    expect(buildTopValuesQuery('events', 'country', 7)).toBe(
      'SELECT "country" AS v, count(*) AS c FROM "events" ' +
        'WHERE "country" IS NOT NULL GROUP BY "country" ORDER BY c DESC LIMIT 7',
    )
  })
})

describe('interpretTopValues', () => {
  it('normalizes frac by the max count, casts BigInt to Number, stringifies values', () => {
    const rows = [
      { v: 'DE', c: 12840n },
      { v: 'PL', c: 9610n },
      { v: 'RU', c: 6420n },
    ]
    expect(interpretTopValues(rows)).toEqual([
      { value: 'DE', count: 12840, frac: 1 },
      { value: 'PL', count: 9610, frac: 9610 / 12840 },
      { value: 'RU', count: 6420, frac: 0.5 },
    ])
  })
  it('renders boolean values as true/false strings', () => {
    expect(interpretTopValues([{ v: true, c: 3n }, { v: false, c: 1n }])).toEqual([
      { value: 'true', count: 3, frac: 1 },
      { value: 'false', count: 1, frac: 1 / 3 },
    ])
  })
  it('returns [] for an empty result (empty table)', () => {
    expect(interpretTopValues([])).toEqual([])
  })
})

describe('buildHistogramQuery', () => {
  it('equi-width floor bucketing with least() clamp, quoted ident', () => {
    expect(buildHistogramQuery('events', 'rev', 0, 300, 12)).toBe(
      'SELECT least(12 - 1, floor(("rev" - 0) / ((300 - 0) / 12)))::INT AS bucket, count(*) AS n ' +
        'FROM "events" WHERE "rev" IS NOT NULL GROUP BY 1 ORDER BY 1',
    )
  })
  it('returns null for a degenerate range (hi == lo) -> histogram omitted', () => {
    expect(buildHistogramQuery('events', 'rev', 5, 5, 12)).toBeNull()
  })
  it('histogram groups by position so a real column named "bucket" cannot shadow the alias', () => {
    const sql = buildHistogramQuery('t', 'rev', 0, 10, 12)
    expect(sql).toContain('GROUP BY 1 ORDER BY 1')
    expect(sql).not.toContain('GROUP BY bucket')
  })
})

describe('interpretHistogram', () => {
  it('fills empty buckets with zero and computes each bin lo/hi', () => {
    // rows for buckets 0 and 2 only; lo=0, hi=300, bins=3 -> width 100.
    const rows = [
      { bucket: 0, n: 10n },
      { bucket: 2, n: 4n },
    ]
    expect(interpretHistogram(rows, 0, 300, 3)).toEqual([
      { lo: 0, hi: 100, count: 10 },
      { lo: 100, hi: 200, count: 0 },
      { lo: 200, hi: 300, count: 4 },
    ])
  })
  it('clamps an overflow bucket index into the last bin (least() guards SQL too)', () => {
    const rows = [{ bucket: 3, n: 2n }] // bins=3 -> only 0..2 valid; 3 -> last bin
    expect(interpretHistogram(rows, 0, 300, 3)).toEqual([
      { lo: 0, hi: 100, count: 0 },
      { lo: 100, hi: 200, count: 0 },
      { lo: 200, hi: 300, count: 2 },
    ])
  })
})
