import { arrowToRows } from '../core/arrowToRows'
import { baselineConfig, parseInferredColumns } from '../core/schemaTypes'
import { rawTableName, tableNameFromFilename, uniqueTableName } from '../core/sql'
import type { DuckDBClient } from '../db/duckdbClient'
import type { Dataset } from '../state/session'

/**
 * Register + materialize one file as a Dataset. CSV -> raw all_varchar source
 * (_qb_raw_<t>) + typed copy (<t>, all_varchar baseline) + sniff inference
 * (suggested types) + baseline schemaConfig (M1 state until "типы"/"применить").
 * Parquet -> native types, no raw, no schema config (untouched by M2).
 * Throws on a per-file failure (caller reports it).
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

  if (kind === 'parquet') {
    await client.loadParquet(file.name, table)
    const columns = await client.describeTable(table)
    return { table, fileName: file.name, bytes: file.size, kind, columns }
  }

  await client.loadCsvAllVarchar(file.name, table)
  const columns = await client.describeTable(table)
  // Inference is best-effort: a sniff failure must not block the all_varchar
  // baseline (spec line 142). Empty suggested => "типы" no-op.
  let suggested: Dataset['suggested']
  try {
    suggested = parseInferredColumns(arrowToRows(await client.sniffCsv(file.name)))
  } catch {
    suggested = []
  }
  return {
    table,
    fileName: file.name,
    bytes: file.size,
    kind,
    columns,
    rawTable: rawTableName(table),
    suggested,
    schemaConfig: baselineConfig(columns),
    schemaError: null,
  }
}
