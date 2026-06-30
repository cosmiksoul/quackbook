import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'
import type { Table } from 'apache-arrow'
import { arrowToRows, type ResultColumn } from '../core/arrowToRows'
import {
  buildCloneTable,
  buildDescribe,
  buildLoadCsvRaw,
  buildLoadParquet,
  buildSniffCsv,
  rawTableName,
} from '../core/sql'

export interface DuckDBClient {
  /** Register raw file bytes under a virtual filename DuckDB can read. */
  registerFile(name: string, data: Uint8Array): Promise<void>
  /**
   * Materialize a registered CSV as TWO tables (model A): an immutable
   * all-VARCHAR raw cast-source (_qb_raw_<t>) plus a typed table (<t>),
   * initially an all_varchar copy of the raw baseline.
   */
  loadCsvAllVarchar(virtualName: string, tableName: string): Promise<void>
  /** Materialize a registered Parquet file as a typed table (no raw, M1 behavior). */
  loadParquet(virtualName: string, tableName: string): Promise<void>
  /** DuckDB's inferred (native-typed) schema of a registered CSV. */
  sniffCsv(virtualName: string): Promise<Table>
  /** Column names + DuckDB type names for a loaded table. */
  describeTable(tableName: string): Promise<ResultColumn[]>
  /** Run a statement whose result is not needed (DDL: CREATE OR REPLACE, ...). */
  exec(sql: string): Promise<void>
  /** Run a query and return the Arrow result table. */
  query(sql: string): Promise<Table>
  /** Run a query and return its FULL result serialized as CSV or Parquet bytes. */
  exportQuery(sql: string, format: 'csv' | 'parquet'): Promise<Uint8Array>
}

export function createClient(db: AsyncDuckDB): DuckDBClient {
  async function run(sql: string): Promise<Table> {
    const conn = await db.connect()
    try {
      return await conn.query(sql)
    } finally {
      await conn.close()
    }
  }

  return {
    async registerFile(name, data) {
      await db.registerFileBuffer(name, data)
    },
    async loadCsvAllVarchar(virtualName, tableName) {
      const raw = rawTableName(tableName)
      await run(buildLoadCsvRaw(virtualName, raw))
      await run(buildCloneTable(tableName, raw))
    },
    async loadParquet(virtualName, tableName) {
      await run(buildLoadParquet(virtualName, tableName))
    },
    async sniffCsv(virtualName) {
      return run(buildSniffCsv(virtualName))
    },
    async describeTable(tableName) {
      const result = arrowToRows(await run(buildDescribe(tableName)))
      return result.rows.map((r) => ({
        name: String(r.column_name),
        type: String(r.column_type),
      }))
    },
    async exec(sql) {
      await run(sql)
    },
    query: run,
    async exportQuery(sql, format) {
      const ext = format === 'parquet' ? 'parquet' : 'csv'
      const fname = `qb-export.${ext}`
      const select = sql.trim().replace(/;\s*$/, '').trim()
      const fmt = format === 'parquet' ? 'PARQUET' : 'CSV, HEADER'
      await run(`COPY (${select}) TO '${fname}' (FORMAT ${fmt})`)
      const buf = await db.copyFileToBuffer(fname)
      await db.dropFile(fname)
      return buf
    },
  }
}
