import type { QueryResult } from './arrowToRows'
import { quoteIdent } from './sql'

/** How a column is profiled (drives which card body renders). */
export type ColumnKind = 'numeric' | 'categorical' | 'range' | 'highCardinality'

/** A categorical column profiles into at most TOP_K top values (with bars). */
export interface TopValue {
  value: string // string rendering (boolean -> 'true'/'false'); null bucket excluded
  count: number
  frac: number // count / max(count) in the set -> bar width 0..1
}

/** One equi-width numeric histogram bin. */
export interface HistogramBin {
  lo: number
  hi: number
  count: number
}

/** The full per-column profile rendered by a ProfileCard. */
export interface ColumnProfile {
  name: string
  type: string // DuckDB column_type verbatim (badge)
  distinct: number // approx_unique
  nullCount: number
  kind: ColumnKind
  // categorical (incl. boolean):
  top?: TopValue[]
  moreDistinct?: number // distinct - top.length, for "+N ещё"
  // numeric:
  histogram?: HistogramBin[]
  stats?: { min: number; median: number; max: number }
  // range (date/timestamp/time):
  range?: { min: string; median: string; max: string }
}

/** Distinct-count threshold: VARCHAR with approx_unique <= this is categorical. */
export const THRESHOLD_DISTINCT = 50
/** How many top values a categorical card shows. */
export const TOP_K = 7
/** Equi-width bins for a numeric histogram. */
export const HISTOGRAM_BINS = 12

/**
 * Classify a column from its DuckDB type + approx distinct count. numeric ->
 * histogram + min/median/max; boolean/low-card VARCHAR -> categorical top
 * values; high-card VARCHAR/other -> highCardinality (distinct + null only);
 * date/timestamp/time -> range (min/median/max only, no binning in v1).
 */
export function classifyColumn(
  columnType: string,
  approxUnique: number,
  threshold: number,
): ColumnKind {
  const t = columnType.toUpperCase()
  if (
    /^(BIGINT|INTEGER|INT|SMALLINT|TINYINT|HUGEINT|UBIGINT|UINTEGER|USMALLINT|UTINYINT|UHUGEINT|DOUBLE|FLOAT|REAL|DECIMAL|NUMERIC)\b/.test(
      t,
    )
  )
    return 'numeric'
  if (/^BOOL/.test(t)) return 'categorical'
  if (/^(DATE|TIMESTAMP|TIME)\b/.test(t)) return 'range'
  if (/^VARCHAR\b/.test(t)) {
    return approxUnique <= threshold ? 'categorical' : 'highCardinality'
  }
  return 'highCardinality'
}

/** One column's raw SUMMARIZE facts (stats kept as strings, count as Number). */
export interface SummarizeColumn {
  name: string
  type: string
  approxUnique: number
  min: string | null
  max: string | null
  median: string | null // SUMMARIZE q50
}

/** Coerce a possibly-null SUMMARIZE stat cell to a trimmed string or null. */
function toStatString(v: unknown): string | null {
  return v == null ? null : String(v)
}

/**
 * Parse a SUMMARIZE result into per-column facts. approx_unique is Int64
 * (BigInt) -> Number; min/max/q50 stay strings (heterogeneous columns).
 * null_percentage (Decimal) is intentionally NOT read — it decodes wrong via
 * arrowToRows; null counts come from a separate clean pass (buildNullCountQuery).
 */
export function parseSummarize(result: QueryResult): SummarizeColumn[] {
  return result.rows.map((r) => ({
    name: String(r.column_name),
    type: String(r.column_type),
    approxUnique: Number(r.approx_unique ?? 0),
    min: toStatString(r.min),
    max: toStatString(r.max),
    median: toStatString(r.q50),
  }))
}

/**
 * Build a single-pass query that returns total row count plus, per column, the
 * number of NULLs via count(*) FILTER (WHERE "col" IS NULL). A dedicated clean
 * pass instead of SUMMARIZE's null_percentage (which decodes wrong). The total
 * doubles as the relation's row count (panel caption «N строк»). Columns map to
 * positional aliases n0..nk (idents quoted/escaped).
 */
export function buildNullCountQuery(table: string, columns: string[]): string {
  const parts = ['count(*) AS total']
  columns.forEach((col, i) => {
    parts.push(`count(*) FILTER (WHERE ${quoteIdent(col)} IS NULL) AS n${i}`)
  })
  return `SELECT ${parts.join(', ')} FROM ${quoteIdent(table)}`
}

/** Interpret the {total, n0..nk} row (BigInt) into total + {col: nullCount}. */
export function interpretNullCounts(
  row: Record<string, unknown>,
  columns: string[],
): { total: number; nulls: Record<string, number> } {
  const nulls: Record<string, number> = {}
  columns.forEach((col, i) => {
    nulls[col] = Number(row[`n${i}`] ?? 0)
  })
  return { total: Number(row.total ?? 0), nulls }
}

/**
 * Build a top-K query for a categorical column: group non-null values, order by
 * frequency, cap at k. v/c aliases feed interpretTopValues. ident is quoted.
 */
export function buildTopValuesQuery(table: string, col: string, k: number): string {
  const c = quoteIdent(col)
  return (
    `SELECT ${c} AS v, count(*) AS c FROM ${quoteIdent(table)} ` +
    `WHERE ${c} IS NOT NULL GROUP BY ${c} ORDER BY c DESC LIMIT ${k}`
  )
}

/** Render value (boolean -> 'true'/'false'), Number(count), frac = count/max. */
export function interpretTopValues(rows: Record<string, unknown>[]): TopValue[] {
  const counts = rows.map((r) => Number(r.c ?? 0))
  const maxCount = Math.max(...counts, 0)
  return rows.map((r, i) => ({
    value: String(r.v),
    count: counts[i],
    frac: maxCount > 0 ? counts[i] / maxCount : 0,
  }))
}

/**
 * Build a manual equi-width histogram query (width_bucket/histogram(col,N) are
 * absent in this build): bucket = least(BINS-1, floor((c - lo)/((hi-lo)/BINS))).
 * Returns null for a degenerate range (hi == lo) — the caller omits the
 * histogram and shows only min/median/max. Idents quoted; lo/hi are numbers.
 */
export function buildHistogramQuery(
  table: string,
  col: string,
  lo: number,
  hi: number,
  bins: number,
): string | null {
  if (hi === lo) return null
  const c = quoteIdent(col)
  return (
    `SELECT least(${bins} - 1, floor((${c} - ${lo}) / ((${hi} - ${lo}) / ${bins})))::INT AS bucket, ` +
    `count(*) AS n FROM ${quoteIdent(table)} WHERE ${c} IS NOT NULL GROUP BY bucket ORDER BY bucket`
  )
}

/**
 * Turn sparse {bucket, n} rows into a dense bins-long HistogramBin[]: empty
 * buckets get count 0, each bin's lo/hi are computed from the equi-width step.
 * Bucket indices are clamped into [0, bins-1] (the SQL least() already does this).
 */
export function interpretHistogram(
  rows: Record<string, unknown>[],
  lo: number,
  hi: number,
  bins: number,
): HistogramBin[] {
  const width = (hi - lo) / bins
  const counts = new Array<number>(bins).fill(0)
  for (const r of rows) {
    let b = Number(r.bucket ?? 0)
    if (b < 0) b = 0
    if (b > bins - 1) b = bins - 1
    counts[b] += Number(r.n ?? 0)
  }
  return counts.map((count, i) => ({
    lo: lo + i * width,
    hi: lo + (i + 1) * width,
    count,
  }))
}
