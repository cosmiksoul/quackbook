import { describe, expect, it } from 'vitest'
import { buildCastExpr, buildCastValue } from './castBuilder'
import type { ColumnConfig } from './schemaTypes'

const base = (over: Partial<ColumnConfig>): ColumnConfig => ({
  origName: 'c',
  name: 'c',
  type: 'VARCHAR',
  include: true,
  ...over,
})

describe('buildCastValue (bare cast expression, no alias)', () => {
  it('VARCHAR passes the value through (no cast)', () => {
    expect(buildCastValue(base({ type: 'VARCHAR' }))).toBe('"c"')
  })
  it('BIGINT uses TRY_CAST', () => {
    expect(buildCastValue(base({ origName: 'n', type: 'BIGINT' }))).toBe(
      'TRY_CAST("n" AS BIGINT)',
    )
  })
  it('DOUBLE with decimal comma replaces , with . before casting', () => {
    expect(
      buildCastValue(base({ origName: 'rev', type: 'DOUBLE', decimalSep: ',' })),
    ).toBe(`TRY_CAST(replace("rev", ',', '.') AS DOUBLE)`)
  })
  it('DATE with format casts try_strptime result to DATE', () => {
    expect(
      buildCastValue(base({ origName: 'd', type: 'DATE', dateFormat: '%d.%m.%Y' })),
    ).toBe(`CAST(try_strptime("d", '%d.%m.%Y') AS DATE)`)
  })
  it('nullToken wraps the value in nullif before casting', () => {
    expect(
      buildCastValue(base({ origName: 'n', type: 'BIGINT', nullToken: 'NA' })),
    ).toBe(`TRY_CAST(nullif("n", 'NA') AS BIGINT)`)
  })
})

describe('buildCastExpr (cast value + target-name alias)', () => {
  it('VARCHAR passthrough, aliased to target name', () => {
    expect(buildCastExpr(base({ type: 'VARCHAR' }))).toBe('"c" AS "c"')
  })
  it('renames via the target name alias', () => {
    expect(buildCastExpr(base({ type: 'VARCHAR', name: 'label' }))).toBe(
      '"c" AS "label"',
    )
  })
  it('BIGINT uses TRY_CAST', () => {
    expect(buildCastExpr(base({ origName: 'n', name: 'n', type: 'BIGINT' }))).toBe(
      'TRY_CAST("n" AS BIGINT) AS "n"',
    )
  })
  it('DOUBLE with decimal comma replaces , with . before casting', () => {
    expect(
      buildCastExpr(
        base({ origName: 'rev', name: 'rev', type: 'DOUBLE', decimalSep: ',' }),
      ),
    ).toBe(`TRY_CAST(replace("rev", ',', '.') AS DOUBLE) AS "rev"`)
  })
  it('DOUBLE without comma casts directly', () => {
    expect(
      buildCastExpr(base({ origName: 'rev', name: 'rev', type: 'DOUBLE' })),
    ).toBe('TRY_CAST("rev" AS DOUBLE) AS "rev"')
  })
  it('DATE without format uses TRY_CAST', () => {
    expect(buildCastExpr(base({ origName: 'd', name: 'd', type: 'DATE' }))).toBe(
      'TRY_CAST("d" AS DATE) AS "d"',
    )
  })
  it('DATE with format casts try_strptime result to DATE', () => {
    expect(
      buildCastExpr(
        base({ origName: 'd', name: 'd', type: 'DATE', dateFormat: '%d.%m.%Y' }),
      ),
    ).toBe(`CAST(try_strptime("d", '%d.%m.%Y') AS DATE) AS "d"`)
  })
  it('TIMESTAMP without format uses TRY_CAST', () => {
    expect(
      buildCastExpr(base({ origName: 'ts', name: 'ts', type: 'TIMESTAMP' })),
    ).toBe('TRY_CAST("ts" AS TIMESTAMP) AS "ts"')
  })
  it('TIMESTAMP with format uses try_strptime directly', () => {
    expect(
      buildCastExpr(
        base({
          origName: 'ts',
          name: 'ts',
          type: 'TIMESTAMP',
          dateFormat: '%Y-%m-%d %H:%M',
        }),
      ),
    ).toBe(`try_strptime("ts", '%Y-%m-%d %H:%M') AS "ts"`)
  })
  it('BOOLEAN uses TRY_CAST', () => {
    expect(
      buildCastExpr(base({ origName: 'b', name: 'b', type: 'BOOLEAN' })),
    ).toBe('TRY_CAST("b" AS BOOLEAN) AS "b"')
  })
  it('nullToken applies to VARCHAR passthrough too', () => {
    expect(
      buildCastExpr(base({ origName: 's', name: 's', type: 'VARCHAR', nullToken: 'NA' })),
    ).toBe(`nullif("s", 'NA') AS "s"`)
  })
  it('escapes identifiers and literals (incl. quote in rename target)', () => {
    expect(
      buildCastExpr(
        base({ origName: 'we"ird', name: 'o"k', type: 'BIGINT', nullToken: "o'NA" }),
      ),
    ).toBe(`TRY_CAST(nullif("we""ird", 'o''NA') AS BIGINT) AS "o""k"`)
  })
})
