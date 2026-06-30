import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'
import { createNodeDuckDB } from '../db/nodeDuckDB'
import { createClient, type DuckDBClient } from '../db/duckdbClient'
import { arrowToRows } from './arrowToRows'
import { EXAMPLE_QUERIES } from './exampleQueries'

let db: AsyncDuckDB
let client: DuckDBClient

beforeAll(async () => {
  db = await createNodeDuckDB()
  client = createClient(db)
  const demo = resolve(import.meta.dirname, '../../public/demo')
  await client.registerFile('payments.csv', new Uint8Array(readFileSync(resolve(demo, 'payments.csv'))))
  await client.loadCsvAllVarchar('payments.csv', 'payments') // all-VARCHAR; queries cast
  await client.registerFile('users.parquet', new Uint8Array(readFileSync(resolve(demo, 'users.parquet'))))
  await client.loadParquet('users.parquet', 'users')
}, 60_000)

afterAll(async () => { await db.terminate() })

describe('example queries run on the bundled demo data', () => {
  for (const q of EXAMPLE_QUERIES) {
    it(`returns rows: ${q.title}`, async () => {
      const res = arrowToRows(await client.query(q.sql))
      expect(res.numRows).toBeGreaterThan(0)
    })
  }
})
