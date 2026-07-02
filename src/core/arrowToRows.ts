import { DataType, type Field, type Table } from 'apache-arrow'

export interface ResultColumn {
  name: string
  type: string
}

export interface QueryResult {
  columns: ResultColumn[]
  rows: Record<string, unknown>[]
  numRows: number
}

/** Unscaled decimal digits + scale -> plain decimal string: ('1500', 3) -> '1.500'. */
export function scaleDecimalDigits(digits: string, scale: number): string {
  const neg = digits.startsWith('-')
  let d = neg ? digits.slice(1) : digits
  d = d.padStart(scale + 1, '0')
  const i = d.length - scale
  const s = `${d.slice(0, i)}.${d.slice(i)}`
  return neg ? `-${s}` : s
}

/**
 * Format a cell value as a display string (null/undefined → '', bigint → string,
 * Date → ISO). `type` (строка типа колонки, Arrow или DuckDB) отличает
 * дату-без-времени от timestamp; сравнение регистронезависимое по префиксу.
 */
export function formatCell(value: unknown, type?: string): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) {
    const iso = value.toISOString() // DuckDB TIMESTAMP наивный; epoch-значения UTC
    const t = type?.toUpperCase() ?? ''
    return t.startsWith('DATE') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ')
  }
  return String(value)
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
 * Per-column converter for raw Arrow cell values. Arrow JS returns DECIMAL as an
 * UNSCALED BigNum (1.500 -> 1500) and DATE/TIMESTAMP as epoch millis — both are
 * wrong to display as-is. Decimal(scale>0) -> Number via the scaled string
 * (double-точность принята осознанно: правильный порядок величины важнее хвоста
 * >15 значащих цифр); scale 0 (HUGEINT) остаётся как есть (точность).
 * Date/Timestamp -> JS Date (Plot рисует нативно; formatCell рендерит ISO).
 */
function cellConverter(field: Field): (v: unknown) => unknown {
  const t = field.type
  if (DataType.isDecimal(t) && t.scale > 0) {
    const scale = t.scale
    return (v) => (v == null ? v : Number(scaleDecimalDigits(String(v), scale)))
  }
  if (DataType.isDate(t) || DataType.isTimestamp(t)) {
    return (v) => (v == null ? v : new Date(Number(v)))
  }
  return (v) => v
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
  const convert = fields.map((f) => cellConverter(f))
  const vectors = fields.map((_, i) => table.getChildAt(i))
  const rows: Record<string, unknown>[] = []
  for (let r = 0; r < table.numRows; r++) {
    const row: Record<string, unknown> = {}
    for (let c = 0; c < names.length; c++) {
      const v = vectors[c]?.get(r)
      row[names[c]] = v === undefined ? null : convert[c](v)
    }
    rows.push(row)
  }
  return { columns, rows, numRows: table.numRows }
}
