import type { DuckDBClient } from '../db/duckdbClient'
import type { ReportDoc } from '../core/report'
import { arrowToRows } from '../core/arrowToRows'
import { buildChartSpec } from '../core/chartSpec'
import { buildReportHtml, type RenderedWidget } from '../core/exportHtml'
import { plotFigure } from '../components/plotFigure'

const LIGHT = { background: '#ffffff', color: '#1a1a1a' }

/**
 * Re-run every widget's SQL against the in-memory tables and bake the current
 * results into a self-contained HTML string. Widgets whose sources aren't
 * loaded (query throws) become an «empty» note; non-blocking (missingCount).
 */
export async function renderReport(
  client: DuckDBClient,
  doc: ReportDoc,
  loadedTables: string[],
): Promise<{ html: string; missingCount: number }> {
  const loaded = new Set(loadedTables)
  const rendered: Record<string, RenderedWidget> = {}
  let missingCount = 0

  for (const b of doc.blocks) {
    if (b.type !== 'widget') continue
    const missing = b.datasetNames.filter((t) => !loaded.has(t))
    try {
      const result = arrowToRows(await client.query(b.sql))
      const spec = b.vizType === 'chart' ? buildChartSpec(result.columns) : null
      if (spec) {
        const fig = plotFigure(spec, result.rows, LIGHT)
        rendered[b.id] = { kind: 'chart', svg: fig.outerHTML }
      } else {
        rendered[b.id] = { kind: 'table', result }
      }
    } catch (e) {
      console.warn('[export] widget query failed', b.id, e)
      rendered[b.id] = { kind: 'empty', missing }
      missingCount++
    }
  }

  return { html: buildReportHtml(doc, rendered), missingCount }
}

/** Trigger a browser download of `html` as a .html file. */
export function downloadHtml(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Print `html` via a hidden iframe (full static tables + light theme). */
export function printHtml(html: string): void {
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  // Call print() only after the iframe document has fully loaded and laid out.
  // srcdoc triggers onload reliably; onafterprint removes the iframe when done.
  // Fallback timeout ensures the iframe is removed even if onafterprint never fires.
  iframe.onload = () => {
    const win = iframe.contentWindow
    if (!win) {
      iframe.remove()
      return
    }
    win.onafterprint = () => iframe.remove()
    win.focus()
    win.print()
    setTimeout(() => { if (iframe.isConnected) iframe.remove() }, 60000)
  }
  iframe.srcdoc = html
  document.body.appendChild(iframe)
}
