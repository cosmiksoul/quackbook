import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'
import { createNodeDuckDB } from './nodeDuckDB'
import { createClient, type DuckDBClient } from './duckdbClient'
import { arrowToRows } from '../core/arrowToRows'

let db: AsyncDuckDB
let client: DuckDBClient

beforeAll(async () => {
  db = await createNodeDuckDB()
  client = createClient(db)
}, 60_000)

afterAll(async () => {
  await db.terminate()
})

describe('dropFile', () => {
  it('frees the registered buffer; tables survive; re-register works (rehydration)', async () => {
    const csv = new TextEncoder().encode('a,b\n1,2\n')
    await client.registerFile('tmp_dropfile.csv', csv)
    await client.loadCsvAllVarchar('tmp_dropfile.csv', 'tmp_dropfile')

    await client.dropFile('tmp_dropfile.csv')

    // таблицы живут:
    expect(arrowToRows(await client.query('SELECT * FROM tmp_dropfile')).numRows).toBe(1)
    // файла больше нет:
    await expect(client.query("SELECT * FROM read_csv_auto('tmp_dropfile.csv')")).rejects.toThrow()
    // повторная регистрация того же имени работает (регидрация после reload).
    // Свежий буфер, не переиспользуем csv: registerFileBuffer передаёт
    // ArrayBuffer в воркер через postMessage transfer, детачит его у
    // вызывающей стороны — так же ведёт себя реальный File.arrayBuffer() при
    // повторном чтении после перезагрузки страницы.
    await client.registerFile('tmp_dropfile.csv', new TextEncoder().encode('a,b\n1,2\n'))
    expect(arrowToRows(await client.query("SELECT * FROM read_csv_auto('tmp_dropfile.csv')")).numRows).toBe(1)
  })
})
