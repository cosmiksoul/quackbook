import type { ResultColumn } from './arrowToRows'

/** Numeric Arrow type label (not dictionary-of-strings). */
export function isNumericType(type: string): boolean {
  return /^(Int|Uint|Float|Decimal)/.test(type)
}

/** Date/time Arrow type label. */
export function isTemporalType(type: string): boolean {
  return /^(Date|Timestamp|Time)/.test(type)
}

/** Loose ISO-date string (e.g. "2025-04-09", optionally with a trailing time). */
function isIsoDateString(v: unknown): boolean {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)
}

export interface ChartSpec {
  kind: 'bar' | 'line'
  x: string
  y: string
  // X-значения — ISO-date СТРОКИ (напр. strftime), их надо распарсить в Date,
  // иначе Observable Plot строит ординальную point-шкалу (тик на каждое значение
  // + warning). Не ставится для настоящих Arrow-дат — те уже приходят как Date.
  xDates?: boolean
}

/**
 * Auto-pick a simple chart: first non-numeric column => X (category),
 * first numeric column => Y. Line if X is temporal — by Arrow type OR, when a
 * sample row is given, an ISO-date STRING value (a DATE formatted as text still
 * charts as a time series, ascending, not a value-sorted categorical bar).
 * Null if there is no numeric column or no non-numeric column.
 */
export function buildChartSpec(
  columns: ResultColumn[],
  sample?: Record<string, unknown>,
): ChartSpec | null {
  const x = columns.find((c) => !isNumericType(c.type))
  const y = columns.find((c) => isNumericType(c.type))
  if (!x || !y) return null
  const dateString = isIsoDateString(sample?.[x.name])
  const temporal = isTemporalType(x.type) || dateString
  const spec: ChartSpec = { kind: temporal ? 'line' : 'bar', x: x.name, y: y.name }
  if (dateString) spec.xDates = true
  return spec
}
