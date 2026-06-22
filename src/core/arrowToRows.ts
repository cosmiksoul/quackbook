import type { Table } from 'apache-arrow'

export interface ResultColumn {
  name: string
  type: string
}

export interface QueryResult {
  columns: ResultColumn[]
  rows: Record<string, unknown>[]
  numRows: number
}

/** Disambiguate duplicate column names: ['id','id'] -> ['id','id_1']. */
export function dedupeColumnNames(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((name) => {
    const count = seen.get(name) ?? 0
    seen.set(name, count + 1)
    return count === 0 ? name : `${name}_${count}`
  })
}

/**
 * Shape an Apache Arrow Table into plain column metadata + row objects.
 * Reads values by COLUMN INDEX (not row.toJSON()) so duplicate column names
 * from a JOIN do not collapse — names are deduped to keep every column.
 */
export function arrowToRows(table: Table): QueryResult {
  const fields = table.schema.fields
  const names = dedupeColumnNames(fields.map((f) => f.name))
  const columns = fields.map((f, i) => ({ name: names[i], type: String(f.type) }))
  const vectors = fields.map((_, i) => table.getChildAt(i))
  const rows: Record<string, unknown>[] = []
  for (let r = 0; r < table.numRows; r++) {
    const row: Record<string, unknown> = {}
    for (let c = 0; c < names.length; c++) {
      const v = vectors[c]?.get(r)
      row[names[c]] = v === undefined ? null : v
    }
    rows.push(row)
  }
  return { columns, rows, numRows: table.numRows }
}
