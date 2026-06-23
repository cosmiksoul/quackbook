import type { QueryResult } from './arrowToRows'

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
