# M5 — Export & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the report an offline, shareable, printable artifact (self-contained HTML + PDF) and close the accumulated polish backlog — the final v1 milestone.

**Architecture:** Export = variant A. A pure `core/exportHtml.buildReportHtml(doc, rendered)` assembles a self-contained light-theme HTML string from the report structure plus a per-widget `rendered` map; a thin `features/exportReport.ts` orchestrator re-runs each widget's SQL against the in-memory DuckDB to fill that map (tables via `arrowToRows`, charts via Observable Plot → inline SVG, missing sources → a note). PDF reuses the same HTML printed through a hidden iframe (NOT live `window.print`, because the grid is virtualized and the app is dark). Polish is mechanical fixes across existing files.

**Tech Stack:** React 19.2 + TypeScript 6 + Vite 8, Vitest 4 (node env), `@duckdb/duckdb-wasm@1.32.0` + `apache-arrow@17`, Observable Plot, `marked@18` (already a dep), Zustand 5, `@tanstack/react-virtual`.

## Global Constraints

- **Source of truth:** spec `docs/superpowers/specs/2026-06-26-quackbook-m5-export-polish-design.md`; scope `docs/scope-quackbook-v1.md` wins on conflict.
- **No new deps.** PDF via browser print only — NO jsPDF/pdfmake/html2canvas (firewall: bundle weight). `marked` is already installed; do not add `@types/marked` (ships its own types).
- **Gate every task:** `npm run lint` (0 errors; one known `useVirtualizer` warning until Task 14), `npm run build` (full tsc — not just tests), `npm test`. A task is done only when all three are green.
- **TDD for logic:** `core/exportHtml` and store actions get red→green→refactor. Presentation (light theme, chart SVG, print, CSS polish, focus styles) is verified by eye — the repo has no jsdom/RTL; Vitest `include` is `src/**/*.test.ts`, node env only.
- **Determinism:** ids come from the `seq` counter (`blk-<n>`/`tab-<n>`). NEVER `Math.random` / `Date.now` / `new Date` (they throw in this toolchain).
- **Surgical edits:** touch only what the task needs; don't reformat or "improve" neighbors. Report nearby junk, don't fix silently.
- **Commits:** small and frequent; every commit message ends with the trailer
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
  On Windows author multi-line messages via a bash here-doc (`git commit -F- <<'EOF' … EOF`), NOT PowerShell `@'…'@`.
- **Branch:** all work on `m5-export-polish` (already checked out off `main`).

## File Structure

**Slice 1 — Export (new):**
- `src/core/exportHtml.ts` — pure formatter: `RenderedWidget` type, `escapeHtml`, `buildReportHtml(doc, rendered)`, light-theme `<style>` constant. **Pure, TDD.**
- `src/core/exportHtml.test.ts` — unit tests for the above.
- `src/components/plotFigure.ts` — shared Observable Plot builder `plotFigure(spec, rows, style)` returning the DOM node. Used by `Chart.tsx` (dark) and the exporter (light).
- `src/features/exportReport.ts` — orchestrator `renderReport(client, report, loadedTables)` + `downloadHtml` + `printHtml` helpers. **Thin, by eye.**
- Modify `src/components/Chart.tsx` — use `plotFigure`.
- Modify `src/features/Report.tsx` — «экспорт HTML» + «PDF» buttons.
- Modify `src/index.css` — minimal styling for the new buttons (reuses `.report-toolbar button`).

**Slice 2 — Polish (modify):**
- `src/components/TextBlockView.tsx`, `src/components/WidgetBlockView.tsx`, `src/features/Rail.tsx` — M4 correctness minors.
- `src/state/session.ts`, `src/state/session.test.ts`, `src/features/loadFiles.ts` — remove dead `Dataset.dirty`; add `renameTab`.
- `src/components/TabStrip.tsx`, `src/index.css` — tab rename UI + Sublime-style strip + a11y/reduced-motion/responsive.
- `src/components/SchemaColumnEditor.tsx`, `src/features/Rail.tsx` — STRING label + «применить» relabel.
- `src/components/ResultGrid.tsx`, `vite.config.ts` — dev/build noise.
- `fixtures/`, `CLAUDE.md` — commit fixtures; fill commands.

---

## Slice 1 — Export

### Task 1: `core/exportHtml` — module, escaping, doc shell, text blocks

**Files:**
- Create: `src/core/exportHtml.ts`
- Test: `src/core/exportHtml.test.ts`

**Interfaces:**
- Consumes: `ReportDoc`, `Block` from `./report`; `QueryResult` from `./arrowToRows`; `marked` from `marked`.
- Produces:
  - `type RenderedWidget = { kind: 'table'; result: QueryResult } | { kind: 'chart'; svg: string } | { kind: 'empty'; missing: string[] }`
  - `function escapeHtml(s: string): string`
  - `function buildReportHtml(doc: ReportDoc, rendered: Record<string, RenderedWidget>): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/exportHtml.test.ts
import { describe, it, expect } from 'vitest'
import { buildReportHtml, escapeHtml } from './exportHtml'
import type { ReportDoc } from './report'

describe('escapeHtml', () => {
  it('escapes &, <, >, "', () => {
    expect(escapeHtml('a & b < c > "d"')).toBe('a &amp; b &lt; c &gt; &quot;d&quot;')
  })
})

describe('buildReportHtml — shell + text', () => {
  it('wraps an empty doc in a self-contained html document', () => {
    const html = buildReportHtml({ version: 1, blocks: [] }, {})
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<style>')
    expect(html).toContain('<article class="qb-report">')
  })

  it('renders a text block through marked', () => {
    const doc: ReportDoc = {
      version: 1,
      blocks: [{ type: 'text', id: 'blk-1', markdown: '# Привет' }],
    }
    expect(buildReportHtml(doc, {})).toContain('<h1>Привет</h1>')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/exportHtml.test.ts`
Expected: FAIL — cannot find module `./exportHtml`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/exportHtml.ts
import { marked } from 'marked'
import type { ReportDoc, Block } from './report'
import type { QueryResult } from './arrowToRows'

export type RenderedWidget =
  | { kind: 'table'; result: QueryResult }
  | { kind: 'chart'; svg: string }
  | { kind: 'empty'; missing: string[] }

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
  .qb-empty { color: #999; font-style: italic; }
  @media print {
    @page { margin: 16mm; }
    .qb-widget, .qb-text { break-inside: avoid; }
  }
`

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'bigint') return v.toString()
  return String(v)
}

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
  const body = result.rows
    .map((row) => {
      const cells = result.columns
        .map((c) => `<td>${escapeHtml(formatCell(row[c.name]))}</td>`)
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')
  return `<table class="qb-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/exportHtml.test.ts`
Expected: PASS (4 assertions across 3 tests).

- [ ] **Step 5: Gate + commit**

Run: `npm run lint && npm run build && npm test`
Expected: all green.

```bash
git add src/core/exportHtml.ts src/core/exportHtml.test.ts
git commit -F- <<'EOF'
feat(core): exportHtml — self-contained HTML formatter (shell + text + escape)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: `buildReportHtml` — widget tables

**Files:**
- Modify: `src/core/exportHtml.ts` (already handles tables from Task 1 — this task only ADDS tests proving it; if a test fails, fix the formatter).
- Test: `src/core/exportHtml.test.ts`

**Interfaces:**
- Consumes: `buildReportHtml`, `RenderedWidget` from Task 1.
- Produces: nothing new (verification task locking table behavior).

- [ ] **Step 1: Write the failing test**

```ts
// append to src/core/exportHtml.test.ts
import type { RenderedWidget } from './exportHtml'

describe('buildReportHtml — widget table', () => {
  const doc: ReportDoc = {
    version: 1,
    blocks: [
      { type: 'widget', id: 'blk-1', title: 'T', sql: 'SELECT 1', datasetNames: ['a'], vizType: 'table', caption: '' },
    ],
  }

  it('renders columns and rows as a static table', () => {
    const rendered: Record<string, RenderedWidget> = {
      'blk-1': {
        kind: 'table',
        result: {
          columns: [{ name: 'country', type: 'Utf8' }, { name: 'n', type: 'Int64' }],
          rows: [{ country: 'US', n: 3 }, { country: 'DE', n: 2 }],
          numRows: 2,
        },
      },
    }
    const html = buildReportHtml(doc, rendered)
    expect(html).toContain('<th>country</th>')
    expect(html).toContain('<td>US</td>')
    expect(html).toContain('<td>3</td>')
  })

  it('escapes html in cells and title', () => {
    const rendered: Record<string, RenderedWidget> = {
      'blk-1': {
        kind: 'table',
        result: { columns: [{ name: 'c', type: 'Utf8' }], rows: [{ c: '<b>x</b>' }], numRows: 1 },
      },
    }
    const evil: ReportDoc = { version: 1, blocks: [{ ...doc.blocks[0], title: 'A & B' } as typeof doc.blocks[0]] }
    const html = buildReportHtml(evil, rendered)
    expect(html).toContain('<td>&lt;b&gt;x&lt;/b&gt;</td>')
    expect(html).toContain('A &amp; B')
  })
})
```

- [ ] **Step 2: Run test**

Run: `npx vitest run src/core/exportHtml.test.ts`
Expected: PASS (table rendering already implemented in Task 1). If FAIL, fix `renderTable`/`renderBlock` until green.

- [ ] **Step 3: Gate + commit**

Run: `npm run lint && npm run build && npm test`

```bash
git add src/core/exportHtml.test.ts
git commit -F- <<'EOF'
test(core): exportHtml — widget table rendering + cell/title escaping

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: `buildReportHtml` — chart passthrough, missing-source note, SQL details, order

**Files:**
- Modify: `src/core/exportHtml.ts` (only if a test fails).
- Test: `src/core/exportHtml.test.ts`

**Interfaces:**
- Consumes: `buildReportHtml`, `RenderedWidget`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/core/exportHtml.test.ts
describe('buildReportHtml — chart / empty / sql / order', () => {
  const widgetDoc: ReportDoc = {
    version: 1,
    blocks: [
      { type: 'widget', id: 'blk-1', title: 'T', sql: 'SELECT 1', datasetNames: ['a'], vizType: 'chart', caption: '' },
    ],
  }

  it('inlines chart svg as-is', () => {
    const html = buildReportHtml(widgetDoc, { 'blk-1': { kind: 'chart', svg: '<svg id="x"></svg>' } })
    expect(html).toContain('<svg id="x"></svg>')
  })

  it('shows the missing-source note with names', () => {
    const html = buildReportHtml(widgetDoc, { 'blk-1': { kind: 'empty', missing: ['a', 'b'] } })
    expect(html).toContain('нет данных: a, b')
  })

  it('shows a generic note when empty with no names', () => {
    const html = buildReportHtml(widgetDoc, { 'blk-1': { kind: 'empty', missing: [] } })
    expect(html).toContain('нет данных')
    expect(html).not.toContain('источник(и)')
  })

  it('puts widget SQL in a collapsed details', () => {
    const html = buildReportHtml(widgetDoc, { 'blk-1': { kind: 'empty', missing: [] } })
    expect(html).toContain('<details')
    expect(html).toContain('SELECT 1')
  })

  it('preserves block order', () => {
    const d: ReportDoc = {
      version: 1,
      blocks: [
        { type: 'text', id: 't1', markdown: 'AAA' },
        { type: 'text', id: 't2', markdown: 'BBB' },
      ],
    }
    const html = buildReportHtml(d, {})
    expect(html.indexOf('AAA')).toBeLessThan(html.indexOf('BBB'))
  })
})
```

- [ ] **Step 2: Run test**

Run: `npx vitest run src/core/exportHtml.test.ts`
Expected: PASS (all behaviors implemented in Task 1). Fix the formatter if any fail.

- [ ] **Step 3: Gate + commit**

Run: `npm run lint && npm run build && npm test`

```bash
git add src/core/exportHtml.test.ts
git commit -F- <<'EOF'
test(core): exportHtml — chart passthrough, empty note, SQL details, order

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: Shared `plotFigure` + refactor `Chart`

**Files:**
- Create: `src/components/plotFigure.ts`
- Modify: `src/components/Chart.tsx`

**Interfaces:**
- Consumes: `ChartSpec` from `../core/chartSpec`; `* as Plot` from `@observablehq/plot`.
- Produces: `function plotFigure(spec: ChartSpec, rows: Record<string, unknown>[], style: { background: string; color: string }): (HTMLElement | SVGSVGElement)` — builds the same bar/line plot `Chart` used, parameterized by colors. Returned node's `.outerHTML` is a self-contained SVG.

This is presentation (Plot needs a DOM) — verified by eye + build, no node test.

- [ ] **Step 1: Create `plotFigure.ts`** (extract the exact Plot config from `Chart.tsx`, parameterizing `style`)

```ts
// src/components/plotFigure.ts
import * as Plot from '@observablehq/plot'
import type { ChartSpec } from '../core/chartSpec'

/** Build the bar/line figure used by both the live Chart and the HTML export. */
export function plotFigure(
  spec: ChartSpec,
  rows: Record<string, unknown>[],
  style: { background: string; color: string },
): HTMLElement | SVGSVGElement {
  const mark =
    spec.kind === 'bar'
      ? Plot.barY(rows, { x: spec.x, y: spec.y, sort: { x: '-y' } })
      : Plot.lineY(rows, { x: spec.x, y: spec.y })
  return Plot.plot({
    marks: [mark, Plot.ruleY([0])],
    x: { label: spec.x },
    y: { label: spec.y, grid: true },
    height: 280,
    marginLeft: 56,
    style,
  })
}
```

- [ ] **Step 2: Refactor `Chart.tsx` to use it**

Replace the body of the `useEffect` mark/fig construction. New `Chart.tsx`:

```tsx
// src/components/Chart.tsx
import { useEffect, useRef } from 'react'
import type { ChartSpec } from '../core/chartSpec'
import { plotFigure } from './plotFigure'

interface Props {
  spec: ChartSpec
  rows: Record<string, unknown>[]
}

export function Chart({ spec, rows }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fig = plotFigure(spec, rows, { background: 'transparent', color: '#c8d6d2' })
    el.replaceChildren(fig)
    return () => fig.remove() // avoid leaking SVG nodes
  }, [spec, rows])
  return <div className="chart" ref={ref} />
}
```

- [ ] **Step 3: Gate**

Run: `npm run lint && npm run build && npm test`
Expected: green (no behavior change).

- [ ] **Step 4: Eyeball**

Run `npm run dev`, run a query that draws a chart in Explore → chart still renders identically.

- [ ] **Step 5: Commit**

```bash
git add src/components/plotFigure.ts src/components/Chart.tsx
git commit -F- <<'EOF'
refactor(ui): extract shared plotFigure; Chart reuses it (export will too)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: `features/exportReport.ts` — orchestrator + download/print helpers

**Files:**
- Create: `src/features/exportReport.ts`

**Interfaces:**
- Consumes: `DuckDBClient` from `../db/duckdbClient`; `ReportDoc` from `../core/report`; `arrowToRows` from `../core/arrowToRows`; `buildChartSpec` from `../core/chartSpec`; `buildReportHtml`, `RenderedWidget` from `../core/exportHtml`; `plotFigure` from `../components/plotFigure`.
- Produces:
  - `async function renderReport(client: DuckDBClient, doc: ReportDoc, loadedTables: string[]): Promise<{ html: string; missingCount: number }>`
  - `function downloadHtml(html: string, filename: string): void`
  - `function printHtml(html: string): void`

Thin glue (DuckDB + Plot + DOM) — by eye + build, no node test.

- [ ] **Step 1: Create the file**

```ts
// src/features/exportReport.ts
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
        fig.remove()
      } else {
        rendered[b.id] = { kind: 'table', result }
      }
    } catch {
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
  a.click()
  URL.revokeObjectURL(url)
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
  document.body.appendChild(iframe)
  const win = iframe.contentWindow
  const docu = iframe.contentDocument
  if (!win || !docu) {
    iframe.remove()
    return
  }
  docu.open()
  docu.write(html)
  docu.close()
  // Give the iframe a tick to lay out before printing, then clean up.
  win.onafterprint = () => iframe.remove()
  win.focus()
  win.print()
}
```

- [ ] **Step 2: Gate**

Run: `npm run lint && npm run build && npm test`
Expected: green (module compiles; not yet wired).

- [ ] **Step 3: Commit**

```bash
git add src/features/exportReport.ts
git commit -F- <<'EOF'
feat(export): renderReport orchestrator + html download / iframe print helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: Wire «экспорт HTML» button in `Report.tsx`

**Files:**
- Modify: `src/features/Report.tsx`

**Interfaces:**
- Consumes: `renderReport`, `downloadHtml` from `../features/exportReport`; `useSession` (`datasets`, `setToast`).

`Report` already receives `client` and reads `report`. Add `datasets` + `setToast`, an async `exportHtml()` handler, and a button. The export buttons sit with «сохранить»/«открыть» and are gated on a non-empty report (mirror the existing `report.blocks.length > 0` used for «очистить»).

- [ ] **Step 1: Add imports + selectors + handler**

In `src/features/Report.tsx`, add to imports:

```tsx
import { renderReport, downloadHtml } from './exportReport'
```

Add selectors near the existing `useSession` calls:

```tsx
const datasets = useSession((s) => s.datasets)
const setToast = useSession((s) => s.setToast)
```

Add the handler next to `save`/`open`:

```tsx
async function exportHtml() {
  const loaded = datasets.map((d) => d.table)
  const { html, missingCount } = await renderReport(client, report, loaded)
  if (missingCount > 0) {
    setToast(`${missingCount} виджет(ов) без данных — выгружены с пометкой`)
  }
  downloadHtml(html, 'quackbook-report.html')
}
```

- [ ] **Step 2: Add the button**

In the toolbar JSX, alongside the export-related buttons (after «открыть», before «очистить»), gated like «очистить»:

```tsx
{report.blocks.length > 0 && (
  <button onClick={exportHtml}>экспорт HTML</button>
)}
```

- [ ] **Step 3: Gate**

Run: `npm run lint && npm run build && npm test`
Expected: green.

- [ ] **Step 4: Eyeball**

`npm run dev` → load CSV, pin 2 widgets (one table, one chart), go to Отчёт → «экспорт HTML» downloads `quackbook-report.html`. Open the file directly (double-click, offline) → light theme, full table, inline chart, captions, SQL in `<details>`. Then unload a source / open the report without data → export shows «нет данных» note + toast warned.

- [ ] **Step 5: Commit**

```bash
git add src/features/Report.tsx
git commit -F- <<'EOF'
feat(export): «экспорт HTML» button — bake widgets to a self-contained file

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 7: Wire «PDF» button (iframe print)

**Files:**
- Modify: `src/features/Report.tsx`

**Interfaces:**
- Consumes: `printHtml` from `./exportReport` (add to the existing import).

- [ ] **Step 1: Extend import + add handler**

Update the import to `import { renderReport, downloadHtml, printHtml } from './exportReport'`.

Add the handler:

```tsx
async function exportPdf() {
  const loaded = datasets.map((d) => d.table)
  const { html, missingCount } = await renderReport(client, report, loaded)
  if (missingCount > 0) {
    setToast(`${missingCount} виджет(ов) без данных — попадут в печать с пометкой`)
  }
  printHtml(html)
}
```

- [ ] **Step 2: Add the button** (next to «экспорт HTML», same gate)

```tsx
{report.blocks.length > 0 && (
  <button onClick={exportPdf}>PDF</button>
)}
```

- [ ] **Step 3: Gate**

Run: `npm run lint && npm run build && npm test`
Expected: green.

- [ ] **Step 4: Eyeball**

`npm run dev` → Отчёт with a table whose result is taller than the viewport → «PDF» opens the system print dialog showing the **light** report with the **full** table (not truncated by virtualization). Save to PDF → looks correct; widgets don't split awkwardly across pages.

- [ ] **Step 5: Commit**

```bash
git add src/features/Report.tsx
git commit -F- <<'EOF'
feat(export): «PDF» button — print the generated HTML via a hidden iframe

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Slice 2 — Polish

### Task 8: M4 correctness minors (4 fixes)

**Files:**
- Modify: `src/components/TextBlockView.tsx`, `src/components/WidgetBlockView.tsx`, `src/features/Rail.tsx`

All four are small UI fixes — verified by eye + build. No node test (UI).

- [ ] **Step 1: TextBlockView — write only on actual change**

In `src/components/TextBlockView.tsx`, change the `onBlur` to guard:

```tsx
onBlur={() => {
  if (draft !== block.markdown) updateTextBlock(block.id, draft)
  setEditing(false)
}}
```

- [ ] **Step 2: WidgetBlockView — hide empty source hint**

In `src/components/WidgetBlockView.tsx`, the error block currently always renders the «источник(и): …» hint. Gate it on a non-empty list:

```tsx
{error && (
  <div className="widget-error">
    <pre className="result-error">{error}</pre>
    {block.datasetNames.length > 0 && (
      <p className="widget-sources-hint">
        источник(и): {block.datasetNames.join(', ')} — подгрузи, если
        отсутствуют
      </p>
    )}
  </div>
)}
```

- [ ] **Step 3: WidgetBlockView — reset to loading when its SQL changes**

The rerun effect keeps the stale result/error visible while a new query runs. A synchronous `setState({ kind: 'loading' })` at the top of the effect re-trips `react-hooks/set-state-in-effect` (the exact reason M4 chose the discriminated-union shape — see `docs/BACKLOG.md`). The clean, lint-safe fix is to REMOUNT the view when the SQL changes, since its initial state is already `{ kind: 'loading' }`.

In `src/features/Report.tsx`, the widget branch currently renders `<WidgetBlockView block={block} client={client} />` inside a `<div key={block.id}>`. Add a `key` tied to the SQL so React rebuilds the view (fresh `loading` state) whenever the SQL changes:

```tsx
<WidgetBlockView key={block.sql} block={block} client={client} />
```

`WidgetBlockView.tsx` itself is unchanged. Today widget SQL is fixed at pin time, so this is a no-op safety net; it makes the loading-reset correct for any future editable-widget-SQL without re-introducing the lint violation. (loadedKey-driven re-runs — re-dropping a missing source — keep the existing behavior: the effect re-fires and the error is replaced by the result when the query returns.)

- [ ] **Step 4: Rail — blank in report mode without an active widget**

In `src/features/Rail.tsx`, the `currentSql` fallback follows the stale Explore tab when a non-widget block is active in report mode. Make report-mode require an active widget:

```tsx
const currentSql =
  mode === 'report'
    ? (activeWidget && activeWidget.type === 'widget' ? activeWidget.sql : null)
    : (activeTab?.sql ?? null)
```

(Explore mode behavior is unchanged.)

- [ ] **Step 5: Gate + eyeball**

Run: `npm run lint && npm run build && npm test` → green (lint still 0 errors).
`npm run dev`: clicking a text block in Отчёт no longer leaves the rail on a stale query; widget error from a scratch tab shows only the error text; a pinned widget error shows the hint.

- [ ] **Step 6: Commit**

```bash
git add src/components/TextBlockView.tsx src/components/WidgetBlockView.tsx src/features/Rail.tsx
git commit -F- <<'EOF'
fix(ui): M4 minors — blur-on-change, empty source hint, rail blank in report, widget loading-reset

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 9: Remove dead `Dataset.dirty`

**Files:**
- Modify: `src/state/session.ts`, `src/state/session.test.ts`, `src/features/loadFiles.ts`

The `dirty` flag is written but no longer read by any UI (M2 switched to immediate apply). Remove the field and its writes; update the store tests (drop the `dirty` assertions, keep the rest).

- [ ] **Step 1: Update the failing tests first**

In `src/state/session.test.ts`:
- Remove `dirty: false,` from the dataset fixture (line ~145).
- Remove the four `expect(d.dirty).toBe(...)` assertions (lines ~160, ~175, ~215, ~232).
- Adjust the test titles that mention dirty so they describe the remaining behavior, e.g.:
  - `'setColumnConfig replaces the whole config (used by "типы")'`
  - `'stageColumn edits one column by origName'`
  - `'resetColumn returns a column to the raw VARCHAR baseline'`
  - `'setApplied updates columns + per-column nullLoss'`

- [ ] **Step 2: Run tests to verify they now reference a field we will remove**

Run: `npx vitest run src/state/session.test.ts`
Expected: PASS (the `dirty` property still exists as optional; tests just no longer assert it). This confirms the test edit is clean before removing the field.

- [ ] **Step 3: Remove the field + writes**

- `src/state/session.ts`:
  - Delete `dirty?: boolean` from the `Dataset` interface (line ~23).
  - In `setColumnConfig`: `{ ...d, schemaConfig: cfgs, dirty: false }` → `{ ...d, schemaConfig: cfgs }`.
  - In `stageColumn`: remove the `dirty: true,` line.
  - In `resetColumn`: remove the `dirty: true,` line.
  - In `setApplied`: remove the `dirty: false,` line.
- `src/features/loadFiles.ts`: remove the `dirty: false,` line (~51).

- [ ] **Step 4: Gate**

Run: `npm run lint && npm run build && npm test`
Expected: green. `npm run build` confirms no remaining reference to `.dirty` (tsc would error otherwise).

- [ ] **Step 5: Commit**

```bash
git add src/state/session.ts src/state/session.test.ts src/features/loadFiles.ts
git commit -F- <<'EOF'
refactor(state): drop dead Dataset.dirty field (unused since M2 immediate-apply)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 10: `renameTab` store action + inline tab rename UI

**Files:**
- Modify: `src/state/session.ts`, `src/state/session.test.ts`, `src/components/TabStrip.tsx`

**Interfaces:**
- Produces: `renameTab: (id: string, title: string) => void` on the store.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/state/session.test.ts (inside the existing describe, or a new one)
it('renameTab changes a tab title and leaves others untouched', () => {
  const s = useSession.getState()
  s.reset()
  s.openBlankTab() // tab-1 «Запрос 1»
  s.openBlankTab() // tab-2 «Запрос 2»
  const [a, b] = useSession.getState().tabs
  useSession.getState().renameTab(a.id, 'Воронка')
  const after = useSession.getState().tabs
  expect(after.find((t) => t.id === a.id)!.title).toBe('Воронка')
  expect(after.find((t) => t.id === b.id)!.title).toBe(b.title)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/state/session.test.ts`
Expected: FAIL — `renameTab is not a function`.

- [ ] **Step 3: Implement the action**

In `src/state/session.ts`:
- Add to the `SessionState` interface (near `updateTabSql`): `renameTab: (id: string, title: string) => void`.
- Add the implementation (near `updateTabSql`):

```ts
renameTab: (id, title) =>
  set((s) => ({
    tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
  })),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/state/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the inline rename UI**

Rewrite `src/components/TabStrip.tsx` to support double-click → inline input (Enter/blur save, Esc cancel):

```tsx
import { useState } from 'react'
import { useSession } from '../state/session'

export function TabStrip() {
  const tabs = useSession((s) => s.tabs)
  const activeTabId = useSession((s) => s.activeTabId)
  const setActiveTab = useSession((s) => s.setActiveTab)
  const closeTab = useSession((s) => s.closeTab)
  const openBlankTab = useSession((s) => s.openBlankTab)
  const renameTab = useSession((s) => s.renameTab)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  function startEdit(id: string, title: string) {
    setEditingId(id)
    setDraft(title)
  }
  function commit() {
    if (editingId && draft.trim()) renameTab(editingId, draft.trim())
    setEditingId(null)
  }

  return (
    <div className="tab-strip">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={t.id === activeTabId ? 'tab on' : 'tab'}
          onClick={() => setActiveTab(t.id)}
          onDoubleClick={() => startEdit(t.id, t.title)}
        >
          {editingId === t.id ? (
            <input
              className="tab-rename"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                else if (e.key === 'Escape') setEditingId(null)
              }}
            />
          ) : (
            <span className="tab-title">{t.title}</span>
          )}
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation()
              closeTab(t.id)
            }}
            aria-label="закрыть таб"
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-add" onClick={() => openBlankTab()} aria-label="новый таб">
        +
      </button>
    </div>
  )
}
```

- [ ] **Step 6: Gate + eyeball + commit**

Run: `npm run lint && npm run build && npm test` → green.
`npm run dev`: double-click a tab title → inline input; Enter/blur saves, Esc cancels.

```bash
git add src/state/session.ts src/state/session.test.ts src/components/TabStrip.tsx
git commit -F- <<'EOF'
feat(ui): rename tabs (double-click inline) + renameTab store action

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 11: Sublime-style tab strip (CSS)

**Files:**
- Modify: `src/index.css` (the `.tab-strip`/`.tab`/`.tab.on`/`.tab-close`/`.tab-add` rules at lines ~116–128; add `.tab-rename`)

Pure presentation — by eye. Tighter tabs, clearer active tab, close-on-hover, an input style matching the title.

- [ ] **Step 1: Restyle**

Replace the tab block in `src/index.css` with a Sublime-ish treatment (keep the existing dark palette tokens). Example:

```css
.tab-strip { display: flex; align-items: flex-end; gap: 2px; flex-wrap: wrap; }
.tab {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 10px; font-size: 13px; color: #8da6a2; cursor: pointer;
  background: #0d1c1f; border: 1px solid #1d363b; border-bottom: 0;
  border-radius: 6px 6px 0 0; max-width: 220px;
}
.tab:hover { color: #c8d6d2; }
.tab.on { background: #1d363b; color: #e9eeea; }
.tab-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab-rename {
  background: #0c1c1f; color: #e9eeea; border: 1px solid #34555a;
  border-radius: 4px; font: inherit; padding: 1px 4px; width: 120px;
}
.tab-close, .tab-add {
  border: 0; background: transparent; color: #5c7975; cursor: pointer; font-size: 14px;
}
.tab .tab-close { opacity: 0; }
.tab:hover .tab-close, .tab.on .tab-close { opacity: 1; }
.tab-close:hover { color: #e8826a; }
.tab-add { border: 1px solid #1d363b; background: #11262a; border-radius: 6px; padding: 3px 9px; }
```

- [ ] **Step 2: Gate + eyeball + commit**

Run: `npm run lint && npm run build && npm test` → green.
`npm run dev`: tabs read as Sublime-style; active tab clearly distinct; close button appears on hover/active.

```bash
git add src/index.css
git commit -F- <<'EOF'
style(ui): Sublime-style tab strip (active tab, hover-close, rename input)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 12: STRING label + «применить» relabel

**Files:**
- Modify: `src/components/SchemaColumnEditor.tsx`, `src/features/Rail.tsx`

Label-only at the UI boundary. The internal `ColType`/SQL stays `VARCHAR` (STRING is just its display alias).

- [ ] **Step 1: SchemaColumnEditor — show STRING for VARCHAR + relabel button**

In `src/components/SchemaColumnEditor.tsx`:
- The type `<option>` render (line ~68):

```tsx
{TYPES.map((t) => (
  <option key={t} value={t}>
    {t === 'VARCHAR' ? 'STRING' : t}
  </option>
))}
```

- The apply button text (line ~121): `применить к колонке` → `применить`.

- [ ] **Step 2: Rail — show STRING for VARCHAR in the schema list**

In `src/features/Rail.tsx`, the column type span (line ~170):

```tsx
<span className="col-type">{c.type === 'VARCHAR' ? 'STRING' : c.type}</span>
```

- [ ] **Step 3: Gate + eyeball + commit**

Run: `npm run lint && npm run build && npm test` → green (no logic change; DDL still emits VARCHAR).
`npm run dev`: schema rail and the type picker show STRING; applying a column still works (typed table unaffected).

```bash
git add src/components/SchemaColumnEditor.tsx src/features/Rail.tsx
git commit -F- <<'EOF'
style(ui): display STRING for VARCHAR (UI-only alias); relabel «применить»

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 13: A11y + reduced-motion + responsive pass (CSS)

**Files:**
- Modify: `src/index.css`

Presentation/accessibility — by eye. Add: a visible focus ring for interactive elements, a `prefers-reduced-motion` block that disables transitions, and a narrow-viewport layout where the rail collapses below the workspace.

- [ ] **Step 1: Append a polish block to `src/index.css`**

```css
/* --- M5 a11y / motion / responsive --- */
:where(button, input, select, textarea, [tabindex], summary):focus-visible {
  outline: 2px solid #e3a95c;
  outline-offset: 1px;
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
@media (max-width: 720px) {
  .body { flex-direction: column; }
  .rail { width: auto; flex: none; border-right: 0; border-bottom: 1px solid #1d363b; }
}
```

- [ ] **Step 2: Gate + eyeball + commit**

Run: `npm run lint && npm run build && npm test` → green.
`npm run dev`: Tab-key shows a focus ring; with OS "reduce motion" on, transitions are off; narrow the window → rail stacks above the workspace.

```bash
git add src/index.css
git commit -F- <<'EOF'
style(ui): focus-visible ring, prefers-reduced-motion, narrow-viewport stacking

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 14: Dev/build noise cleanup

**Files:**
- Modify: `vite.config.ts`, `src/components/ResultGrid.tsx`

- [ ] **Step 1: Mute DuckDB sourcemap warnings + raise chunk warning limit**

In `vite.config.ts`, add a `customLogger` that drops exactly the DuckDB worker sourcemap lines, and bump `build.chunkSizeWarningLimit`:

```ts
import { defineConfig, createLogger } from 'vitest/config'
import react from '@vitejs/plugin-react'

const REPO = 'quackbook'

const logger = createLogger()
const warn = logger.warn
logger.warn = (msg, opts) => {
  if (typeof msg === 'string' && msg.includes('Sourcemap for') && msg.includes('duckdb')) return
  warn(msg, opts)
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? `/${REPO}/` : '/',
  plugins: [react()],
  customLogger: logger,
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    server: { deps: { inline: ['@duckdb/duckdb-wasm'] } },
  },
}))
```

NOTE: confirm `createLogger` is exported from `vitest/config` (it re-exports Vite's config API). If tsc/lint complains, import it from `'vite'` instead: `import { createLogger } from 'vite'`. Verify before committing.

- [ ] **Step 2: Silence the `useVirtualizer` lint warning**

In `src/components/ResultGrid.tsx`, add a justified disable directly above the `useVirtualizer` call (line ~17):

```tsx
// TanStack Virtual returns non-memoized fns; the hook is stable here. (known, accepted)
// eslint-disable-next-line react-hooks/incompatible-library
const rowVirtualizer = useVirtualizer({
```

- [ ] **Step 3: Gate**

Run: `npm run lint` → **0 warnings** now (was 1). Then `npm run build` → no chunk-size advisory in the log. `npm run dev` → no DuckDB sourcemap spam. `npm test` → green.

- [ ] **Step 4: Commit**

```bash
git add vite.config.ts src/components/ResultGrid.tsx
git commit -F- <<'EOF'
chore(build): mute DuckDB sourcemap warnings, raise chunk limit, silence useVirtualizer lint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 15: Commit fixtures + fill CLAUDE.md commands

**Files:**
- Add: `fixtures/acceptance.sql`, `fixtures/events.csv` (currently untracked)
- Modify: `CLAUDE.md` (the `## Команды` TBD section)

README «Старт» already lists `dev/test/build/preview/lint` — leave it. Only the CLAUDE.md commands stub is outstanding.

- [ ] **Step 1: Track the fixtures**

These are small acceptance artifacts (sibling to the committed `fixtures/dirty.csv`). Commit them.

- [ ] **Step 2: Fill CLAUDE.md commands**

Replace the `## Команды\n\nTBD — …` block in `CLAUDE.md` with the real commands (mirror README «Старт»):

```markdown
## Команды

- `npm ci` — установка (точные пины из package-lock)
- `npm run dev` — локальная разработка (http://localhost:5173)
- `npm test` — Vitest (node-окружение)
- `npm run build` — продакшн-сборка в `dist/` (полный type-check)
- `npm run preview` — предпросмотр сборки
- `npm run lint` — ESLint
- **Деплой:** push в `main` → GitHub Actions публикует на Pages.
```

- [ ] **Step 3: Gate + commit**

Run: `npm run lint && npm run build && npm test` → green (docs/fixtures don't affect it, but keep the discipline).

```bash
git add fixtures/acceptance.sql fixtures/events.csv CLAUDE.md
git commit -F- <<'EOF'
chore(repo): track acceptance fixtures; fill CLAUDE.md commands

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Self-Review

**Spec coverage:**
- Export HTML (self-contained, inline styles, rendered report) → Tasks 1–6. ✓
- Export PDF (iframe print of the same HTML) → Tasks 5, 7. ✓
- Light theme → Task 1 (`STYLE`) + Task 5 (`LIGHT` plot colors). ✓
- Missing-source widget = warn + note (non-blocking) → Task 1 (`empty` render) + Task 5 (`missingCount`) + Tasks 6/7 (toast). ✓
- Polish: M4 minors → Task 8; dead `dirty` → Task 9; tab rename → Task 10; Sublime tabs → Task 11; STRING + relabel → Task 12; a11y/motion/responsive → Task 13; dev/build noise → Task 14; fixtures + README/CLAUDE → Task 15. ✓
- TDD targets (`core/exportHtml`, `renameTab`) → Tasks 1–3, 10. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases". Two explicit "verify before committing" notes (Task 8 Step 3 lint-rule fallback; Task 14 `createLogger` import source) are deliberate decision points with both branches spelled out, not placeholders.

**Type consistency:** `RenderedWidget` (Task 1) is consumed verbatim in Tasks 2, 3, 5. `renderReport`/`downloadHtml`/`printHtml` signatures (Task 5) match their call sites (Tasks 6, 7). `plotFigure(spec, rows, style)` (Task 4) matches the export call (Task 5) and the `Chart` call (Task 4). `renameTab(id, title)` (Task 10) matches the store interface and TabStrip usage. `QueryResult.rows` is `Record<string, unknown>[]` — `renderTable` indexes by `row[c.name]`, consistent with `arrowToRows`.

**Scope:** Two independent slices, one milestone — consistent with M2–M4. No new product surface; no new deps; firewall respected (browser print, no PDF lib).
