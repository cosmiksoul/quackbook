import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { arrowToRows } from '../core/arrowToRows'
import { buildSelectAll } from '../core/sql'
import { createClient, type DuckDBClient } from './duckdbClient'
import { createNodeDuckDB } from './nodeDuckDB'

let db: AsyncDuckDB
let client: DuckDBClient

beforeAll(async () => {
  db = await createNodeDuckDB()
  client = createClient(db)
})

afterAll(async () => {
  // Terminates the underlying worker so Vitest exits cleanly.
  await db.terminate()
})

describe('DuckDB client (node integration)', () => {
  it('loads a CSV as an all-VARCHAR table and queries it', async () => {
    const csv = 'country,n\nDE,12840\nPL,9610\n'
    await client.registerFile('events.csv', new TextEncoder().encode(csv))
    await client.loadCsvAllVarchar('events.csv', 'events')

    const table = await client.query(buildSelectAll('events'))
    const result = arrowToRows(table)

    expect(result.numRows).toBe(2)
    expect(result.columns.map((c) => c.name)).toEqual(['country', 'n'])
    // all_varchar baseline => numeric-looking column stays a STRING.
    expect(result.rows).toEqual([
      { country: 'DE', n: '12840' },
      { country: 'PL', n: '9610' },
    ])
  })
})
