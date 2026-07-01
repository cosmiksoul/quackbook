import { marked } from 'marked'
import type { ReportDoc, Block } from './report'
import type { QueryResult } from './arrowToRows'
import { formatCell } from './arrowToRows'

export type RenderedWidget =
  | { kind: 'table'; result: QueryResult }
  | { kind: 'chart'; svg: string }
  | { kind: 'empty'; missing: string[] }

export const EXPORT_ROW_CAP = 5000

// For element TEXT content / <pre> only — every call site is text, never an attribute, so not escaping single quotes is intentional and safe.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Light, print-friendly theme. Inlined so the exported file is self-contained.
const STYLE = `
  :root { color-scheme: light; }
  body { margin: 0; background: #fff; color: #1a1a1a;
    font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  .qb-report { max-width: 880px; margin: 0 auto; padding: 32px 24px; }
  .qb-widget, .qb-text { margin: 0 0 28px; }
  .qb-title { font-size: 18px; margin: 0 0 6px; }
  .qb-pills { margin: 0 0 8px; }
  .qb-pill { font: 11px ui-monospace, monospace; color: #555;
    background: #f0f0f0; border-radius: 4px; padding: 1px 6px; margin-right: 4px; }
  .qb-sql { margin: 0 0 8px; }
  .qb-sql summary { cursor: pointer; color: #555; font-size: 12px; }
  .qb-sql pre { background: #f6f6f6; border: 1px solid #e3e3e3; border-radius: 6px;
    padding: 8px; overflow: auto; font: 12px ui-monospace, monospace; }
  .qb-table { border-collapse: collapse; width: 100%; font-size: 13px; }
  .qb-table th, .qb-table td { border: 1px solid #ddd; padding: 4px 8px; text-align: left;
    font-family: ui-monospace, monospace; }
  .qb-table th { background: #f3f3f3; }
  .qb-chart svg { max-width: 100%; height: auto; }
  .qb-caption { color: #666; font-style: italic; font-size: 13px; margin: 6px 0 0; }
  .qb-cap { color: #999; font-style: italic; font-size: 12px; margin: 6px 0 0; }
  .qb-empty { color: #999; font-style: italic; }
  @media print {
    @page { margin: 16mm; }
    .qb-widget, .qb-text { break-inside: avoid; }
  }
`

function renderBlock(b: Block, rendered: Record<string, RenderedWidget>): string {
  if (b.type === 'text') {
    return `<section class="qb-text">${marked.parse(b.markdown || '') as string}</section>`
  }
  const pills = b.datasetNames
    .map((t) => `<span class="qb-pill">${escapeHtml(t)}</span>`)
    .join('')
  const sql = b.sql
    ? `<details class="qb-sql"><summary>SQL</summary><pre>${escapeHtml(b.sql)}</pre></details>`
    : ''
  const caption = b.caption ? `<p class="qb-caption">${escapeHtml(b.caption)}</p>` : ''
  return `<section class="qb-widget">
<h2 class="qb-title">${escapeHtml(b.title)}</h2>
<div class="qb-pills">${pills}</div>
${sql}
${renderResult(rendered[b.id])}
${caption}
</section>`
}

function renderResult(r: RenderedWidget | undefined): string {
  if (!r) return `<p class="qb-empty">нет данных</p>`
  if (r.kind === 'chart') return `<div class="qb-chart">${r.svg}</div>`
  if (r.kind === 'empty') {
    return r.missing.length
      ? `<p class="qb-empty">нет данных: ${escapeHtml(r.missing.join(', '))} — подгрузи источник(и)</p>`
      : `<p class="qb-empty">нет данных</p>`
  }
  return renderTable(r.result)
}

function renderTable(result: QueryResult): string {
  const head = result.columns.map((c) => `<th>${escapeHtml(c.name)}</th>`).join('')
  const shown = result.rows.length > EXPORT_ROW_CAP ? result.rows.slice(0, EXPORT_ROW_CAP) : result.rows
  const body = shown
    .map((row) => {
      const cells = result.columns
        .map((c) => `<td>${escapeHtml(formatCell(row[c.name]))}</td>`)
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')
  const cap =
    result.rows.length > EXPORT_ROW_CAP
      ? `<p class="qb-cap">таблица усечена: первые ${EXPORT_ROW_CAP} из ${result.rows.length} строк</p>`
      : ''
  return `<table class="qb-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${cap}`
}

export function buildReportHtml(
  doc: ReportDoc,
  rendered: Record<string, RenderedWidget>,
): string {
  const body = doc.blocks.map((b) => renderBlock(b, rendered)).join('\n')
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>quackbook — отчёт</title>
<style>${STYLE}</style>
</head>
<body>
<article class="qb-report">
${body}
</article>
</body>
</html>
`
}
