import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'
import { createNodeDuckDB } from '../db/nodeDuckDB'
import { createClient, type DuckDBClient } from '../db/duckdbClient'
import { arrowToRows } from '../core/arrowToRows'
import { useSession } from '../state/session'
import { useMartActions } from './useMartActions'

let db: AsyncDuckDB
let client: DuckDBClient

beforeAll(async () => {
  db = await createNodeDuckDB()
  client = createClient(db)
  const demo = resolve(import.meta.dirname, '../../public/demo')
  await client.registerFile('payments.csv', new Uint8Array(readFileSync(resolve(demo, 'payments.csv'))))
  await client.loadCsvAllVarchar('payments.csv', 'payments')
}, 60_000)

afterAll(async () => { await db.terminate() })
beforeEach(() => { useSession.getState().reset() }) // clean store per test; DuckDB objects persist

describe('useMartActions over real DuckDB', () => {
  it('creates a VIEW mart, stores it, and it is queryable from another statement', async () => {
    const { createMart } = useMartActions(client)
    const err = await createMart('rev_view', 'SELECT count(*) AS n FROM payments', 'view')
    expect(err).toBeNull()
    const ds = useSession.getState().datasets.find((d) => d.table === 'rev_view')
    expect(ds?.kind).toBe('view')
    expect(ds?.columns.map((c) => c.name)).toEqual(['n'])
    expect(arrowToRows(await client.query('SELECT * FROM rev_view')).numRows).toBe(1)
  })

  it('creates a TABLE (snapshot) mart', async () => {
    const { createMart } = useMartActions(client)
    expect(await createMart('rev_tbl', 'SELECT count(*) AS n FROM payments', 'table')).toBeNull()
    expect(useSession.getState().datasets.find((d) => d.table === 'rev_tbl')?.kind).toBe('table')
    expect(arrowToRows(await client.query('SELECT * FROM rev_tbl')).numRows).toBe(1)
  })

  it('rejects a colliding name and does not duplicate the store entry', async () => {
    const { createMart } = useMartActions(client)
    await createMart('dup', 'SELECT 1 AS n', 'view')
    const err = await createMart('dup', 'SELECT 2 AS n', 'view')
    expect(err).toBeTruthy()
    expect(useSession.getState().datasets.filter((d) => d.table === 'dup')).toHaveLength(1)
  })

  it('returns the DuckDB error (and stores nothing) when the query is invalid', async () => {
    const { createMart } = useMartActions(client)
    const err = await createMart('bad', 'SELECT * FROM no_such_table', 'view')
    expect(err).toBeTruthy()
    expect(useSession.getState().datasets.find((d) => d.table === 'bad')).toBeUndefined()
  })

  it('VIEW stays live; TABLE is a snapshot until refreshMart', async () => {
    const { createMart, refreshMart } = useMartActions(client)
    await client.exec('CREATE OR REPLACE TABLE src AS SELECT * FROM (VALUES (1)) t(x)')
    await createMart('v_live', 'SELECT count(*) AS c FROM src', 'view')
    await createMart('t_snap', 'SELECT count(*) AS c FROM src', 'table')
    await client.exec('CREATE OR REPLACE TABLE src AS SELECT * FROM (VALUES (1),(2)) t(x)')
    expect(Number(arrowToRows(await client.query('SELECT c FROM v_live')).rows[0].c)).toBe(2)
    expect(Number(arrowToRows(await client.query('SELECT c FROM t_snap')).rows[0].c)).toBe(1)
    await refreshMart('t_snap')
    expect(Number(arrowToRows(await client.query('SELECT c FROM t_snap')).rows[0].c)).toBe(2)
  })

  it('drops a mart from DuckDB and the store', async () => {
    const { createMart, dropMart } = useMartActions(client)
    await createMart('gone', 'SELECT 1 AS n', 'view')
    await dropMart('gone')
    expect(useSession.getState().datasets.find((d) => d.table === 'gone')).toBeUndefined()
    await expect(client.query('SELECT * FROM gone')).rejects.toThrow()
  })
})
