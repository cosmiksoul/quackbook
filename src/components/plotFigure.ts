import * as Plot from '@observablehq/plot'
import type { ChartSpec } from '../core/chartSpec'

/** Build the bar/line figure used by both the live Chart and the HTML export. */
export function plotFigure(
  spec: ChartSpec,
  rows: Record<string, unknown>[],
  style: { background: string; color: string },
): HTMLElement | SVGSVGElement {
  // X — дата-строки (strftime): парсим в Date, чтобы Plot дал временную ось
  // (аккуратные тики по месяцам), а не ординал с тиком на каждую из N дат.
  const data = spec.xDates
    ? rows.map((r) => ({ ...r, [spec.x]: r[spec.x] == null ? null : new Date(String(r[spec.x])) }))
    : rows
  const mark =
    spec.kind === 'bar'
      ? Plot.barY(data, { x: spec.x, y: spec.y, sort: { x: '-y' } })
      : Plot.lineY(data, { x: spec.x, y: spec.y })
  return Plot.plot({
    marks: [mark, Plot.ruleY([0])],
    x: { label: spec.x },
    y: { label: spec.y, grid: true },
    height: 280,
    marginLeft: 56,
    style,
  })
}
