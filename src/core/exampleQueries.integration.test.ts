import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'
import { createNodeDuckDB } from '../db/nodeDuckDB'
import { createClient, type DuckDBClient } from '../db/duckdbClient'
import { arrowToRows } from './arrowToRows'
import { loadOneFile } from '../features/loadFiles'
import { suggestTypes } from './schemaTypes'
import { buildMaterializeDDL } from './castBuilder'
import { EXAMPLE_QUERIES } from './exampleQueries'
import { deserializeReport } from './report'

let db: AsyncDuckDB
let client: DuckDBClient

beforeAll(async () => {
  db = await createNodeDuckDB()
  client = createClient(db)
  const demo = resolve(import.meta.dirname, '../../public/demo')
  // Mirror the app's loadDemoData exactly: payments.csv is loaded AND typed via
  // inference (DateUTC -> TIMESTAMP, RevenueUSD -> DOUBLE, ...), users.parquet is
  // native. The recipes must run against the TYPED tables the app actually shows —
  // loading all-VARCHAR here would test a scenario the demo never produces.
  const pbytes = new Uint8Array(readFileSync(resolve(demo, 'payments.csv')))
  const ds = await loadOneFile(client, new File([pbytes], 'payments.csv'), [])
  await client.exec(buildMaterializeDDL(ds.table, ds.rawTable!, suggestTypes(ds.suggested!)))
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

describe('sample-report widget SQL runs on the demo data', () => {
  const json = readFileSync(
    resolve(import.meta.dirname, '../../public/demo/sample-report.json'),
    'utf8',
  )
  const widgets = deserializeReport(json).blocks.filter((b) => b.type === 'widget')
  for (const w of widgets) {
    it(`returns rows: ${w.type === 'widget' ? w.title : ''}`, async () => {
      if (w.type !== 'widget') return
      const res = arrowToRows(await client.query(w.sql))
      expect(res.numRows).toBeGreaterThan(0)
    })
  }
})
