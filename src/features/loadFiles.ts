import { tableNameFromFilename, uniqueTableName } from '../core/sql'
import type { DuckDBClient } from '../db/duckdbClient'
import type { Dataset } from '../state/session'

/**
 * Register + materialize one file as a Dataset. CSV -> all_varchar baseline;
 * Parquet -> native types. Throws on a per-file failure (caller reports it).
 */
export async function loadOneFile(
  client: DuckDBClient,
  file: File,
  takenTableNames: string[],
): Promise<Dataset> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  await client.registerFile(file.name, bytes)
  const kind: Dataset['kind'] = file.name.toLowerCase().endsWith('.parquet')
    ? 'parquet'
    : 'csv'
  const table = uniqueTableName(tableNameFromFilename(file.name), takenTableNames)
  if (kind === 'parquet') await client.loadParquet(file.name, table)
  else await client.loadCsvAllVarchar(file.name, table)
  const columns = await client.describeTable(table)
  return { table, fileName: file.name, bytes: file.size, kind, columns }
}
