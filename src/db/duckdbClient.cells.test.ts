import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'
import { createNodeDuckDB } from './nodeDuckDB'
import { createClient, type DuckDBClient } from './duckdbClient'
import { arrowToRows, formatCell } from '../core/arrowToRows'

let db: AsyncDuckDB
let client: DuckDBClient

beforeAll(async () => {
  db = await createNodeDuckDB()
  client = createClient(db)
}, 60_000)

afterAll(async () => {
  await db.terminate()
})

// Каждый it самодостаточен — без intra-file coupling (по образцу duckdbClient.profile.test.ts).
describe('cell decoding over real DuckDB (DECIMAL scale, DATE/TIMESTAMP)', () => {
  it('DECIMAL(18,3): 1.5 приходит как 1.5, а не 1500', async () => {
    const r = arrowToRows(await client.query('SELECT CAST(1.5 AS DECIMAL(18,3)) AS d'))
    expect(Number(r.rows[0].d)).toBeCloseTo(1.5)
  })

  it('отрицательный DECIMAL сохраняет знак и шкалу', async () => {
    const r = arrowToRows(await client.query('SELECT CAST(-0.07 AS DECIMAL(10,2)) AS d'))
    expect(Number(r.rows[0].d)).toBeCloseTo(-0.07)
  })

  it('SUM по DECIMAL масштабируется корректно (DECIMAL(38,x))', async () => {
    const r = arrowToRows(await client.query(
      'SELECT sum(x) AS s FROM (VALUES (CAST(1.25 AS DECIMAL(18,2))), (CAST(2.50 AS DECIMAL(18,2)))) t(x)'))
    expect(Number(r.rows[0].s)).toBeCloseTo(3.75)
  })

  it('DATE рендерится ISO-датой, не epoch-миллисекундами', async () => {
    const r = arrowToRows(await client.query("SELECT DATE '2025-04-09' AS day"))
    expect(formatCell(r.rows[0].day, r.columns[0].type)).toBe('2025-04-09')
  })

  it('TIMESTAMP рендерится ISO datetime', async () => {
    const r = arrowToRows(await client.query("SELECT TIMESTAMP '2025-04-09 10:30:00' AS ts"))
    expect(formatCell(r.rows[0].ts, r.columns[0].type)).toBe('2025-04-09 10:30:00')
  })

  it('HUGEINT остаётся точным (scale 0 не конвертируется в float)', async () => {
    const r = arrowToRows(await client.query('SELECT 170141183460469231731687303715884105727::HUGEINT AS h'))
    expect(formatCell(r.rows[0].h, r.columns[0].type)).toBe('170141183460469231731687303715884105727')
  })
})
