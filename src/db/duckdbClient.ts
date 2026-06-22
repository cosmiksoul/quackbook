import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'
import type { Table } from 'apache-arrow'
import { quoteIdent, quoteLiteral } from '../core/sql'

export interface DuckDBClient {
  /** Register raw file bytes under a virtual filename DuckDB can read. */
  registerFile(name: string, data: Uint8Array): Promise<void>
  /** Materialize a registered CSV as an all-VARCHAR baseline table. */
  loadCsvAllVarchar(virtualName: string, tableName: string): Promise<void>
  /** Run a query and return the Arrow result table. */
  query(sql: string): Promise<Table>
}

export function createClient(db: AsyncDuckDB): DuckDBClient {
  return {
    async registerFile(name, data) {
      await db.registerFileBuffer(name, data)
    },
    async loadCsvAllVarchar(virtualName, tableName) {
      const conn = await db.connect()
      try {
        await conn.query(
          `CREATE OR REPLACE TABLE ${quoteIdent(tableName)} AS
             SELECT * FROM read_csv_auto(${quoteLiteral(virtualName)}, all_varchar = true)`,
        )
      } finally {
        await conn.close()
      }
    },
    async query(sql) {
      const conn = await db.connect()
      try {
        return await conn.query(sql)
      } finally {
        await conn.close()
      }
    },
  }
}
