import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildResultTempDDL } from '../core/sql'
import { profileRelation } from '../features/useProfileActions'
import { createClient, type DuckDBClient } from './duckdbClient'
import { createNodeDuckDB } from './nodeDuckDB'

let db: AsyncDuckDB
let client: DuckDBClient

beforeAll(async () => {
  db = await createNodeDuckDB()
  client = createClient(db)
})

afterAll(async () => {
  await db.terminate()
})

// A real typed table: numeric (rev), categorical (country), with NULLs.
const CSV =
  'country,rev\n' +
  'DE,10\n' +
  'DE,20\n' +
  'DE,30\n' +
  'PL,40\n' +
  'PL,\n' + // null rev
  'RU,50\n'

describe('profileRelation over a real table (source path)', () => {
  it('classifies columns and fills distinct/null/top/histogram from DuckDB', async () => {
    await client.registerFile('p.csv', new TextEncoder().encode(CSV))
    // native-typed load (rev becomes BIGINT, country VARCHAR)
    await client.exec(
      `CREATE OR REPLACE TABLE p AS SELECT * FROM read_csv_auto('p.csv')`,
    )

    const { profiles, rowCount } = await profileRelation(client, 'p')
    const byName = Object.fromEntries(profiles.map((p) => [p.name, p]))

    // row count flows out for the panel caption
    expect(rowCount).toBe(6)

    // country: categorical, no nulls, DE is the top value with count 3.
    // NOTE: distinct comes from approx_unique (HLL) — NOT asserted exactly
    // (on 6 rows approx_count_distinct(country) returns 2, count(DISTINCT)=3).
    expect(byName.country.kind).toBe('categorical')
    expect(byName.country.nullCount).toBe(0)
    expect(byName.country.top?.[0]).toMatchObject({ value: 'DE', count: 3, frac: 1 })

    // rev: numeric, 1 null, histogram present (hi != lo), stats parsed as numbers
    expect(byName.rev.kind).toBe('numeric')
    expect(byName.rev.nullCount).toBe(1)
    expect(byName.rev.histogram && byName.rev.histogram.length).toBeGreaterThan(0)
    expect(byName.rev.stats?.min).toBe(10)
    expect(byName.rev.stats?.max).toBe(50)
  })
})

describe('result path: materialize a query into a regular result table, then profile it', () => {
  // SELF-CONTAINED: recreate table p in this describe so it does NOT depend on
  // the source-path describe running first (no intra-file execution-order coupling).
  const RCSV =
    'country,rev\n' + 'DE,10\n' + 'DE,20\n' + 'DE,30\n' + 'PL,40\n' + 'PL,\n' + 'RU,50\n'

  beforeAll(async () => {
    await client.registerFile('rp.csv', new TextEncoder().encode(RCSV))
    await client.exec(`CREATE OR REPLACE TABLE rp AS SELECT * FROM read_csv_auto('rp.csv')`)
  })

  it('profiles the result table with real inferred types across connections', async () => {
    // buildResultTempDDL now emits a REGULAR CREATE OR REPLACE TABLE (not TEMP),
    // so the table survives the client's fresh-per-call connections.
    await client.exec(
      buildResultTempDDL('tabX', 'SELECT country, sum(rev) AS total FROM rp GROUP BY country'),
    )
    const { profiles } = await profileRelation(client, '_qb_result_tabX')
    const byName = Object.fromEntries(profiles.map((pr) => [pr.name, pr]))
    expect(profiles.map((pr) => pr.name).sort()).toEqual(['country', 'total'])
    // total is a real numeric (HUGEINT — DuckDB widens integer SUM to HUGEINT),
    // classifyColumn matches HUGEINT, so it is numeric (not a CSV string column).
    expect(byName.total.kind).toBe('numeric')
  })
})
