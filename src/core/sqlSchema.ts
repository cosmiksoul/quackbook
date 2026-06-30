import type { Dataset } from '../state/session'
import { isInternalTable } from './sql'

/**
 * Build a @codemirror/lang-sql schema namespace from loaded datasets:
 * `{ tableName: [columnName, ...] }`. Internal quackbook tables (_qb_*) are
 * excluded so completion only offers user-facing tables/columns.
 */
export function buildSqlSchema(datasets: Dataset[]): Record<string, string[]> {
  const schema: Record<string, string[]> = {}
  for (const d of datasets) {
    if (isInternalTable(d.table)) continue
    schema[d.table] = d.columns.map((c) => c.name)
  }
  return schema
}
