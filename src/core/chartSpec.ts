import type { ResultColumn } from './arrowToRows'

/** Numeric Arrow type label (not dictionary-of-strings). */
export function isNumericType(type: string): boolean {
  return /^(Int|Uint|Float|Decimal)/.test(type)
}

/** Date/time Arrow type label. */
export function isTemporalType(type: string): boolean {
  return /^(Date|Timestamp|Time)/.test(type)
}

export interface ChartSpec {
  kind: 'bar' | 'line'
  x: string
  y: string
}

/**
 * Auto-pick a simple chart: first non-numeric column => X (category),
 * first numeric column => Y. Line if X is temporal, else bar.
 * Null if there is no numeric column or no non-numeric column.
 */
export function buildChartSpec(columns: ResultColumn[]): ChartSpec | null {
  const x = columns.find((c) => !isNumericType(c.type))
  const y = columns.find((c) => isNumericType(c.type))
  if (!x || !y) return null
  return { kind: isTemporalType(x.type) ? 'line' : 'bar', x: x.name, y: y.name }
}
