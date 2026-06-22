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

/** Shape an Apache Arrow Table into plain column metadata + row objects. */
export function arrowToRows(table: Table): QueryResult {
  const columns = table.schema.fields.map((f) => ({
    name: f.name,
    type: String(f.type),
  }))
  const rows = table
    .toArray()
    .map((row) => row.toJSON() as Record<string, unknown>)
  return { columns, rows, numRows: table.numRows }
}
