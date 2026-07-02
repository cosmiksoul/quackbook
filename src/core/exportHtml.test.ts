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

  it('экранирует сырой HTML текстового блока (XSS)', () => {
    const doc: ReportDoc = {
      version: 1,
      blocks: [{ type: 'text', id: 'blk-1', markdown: '<img src=x onerror="alert(1)">' }],
    }
    const html = buildReportHtml(doc, {})
    expect(html).not.toContain('<img src=x')
  })
})

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

import { EXPORT_ROW_CAP } from './exportHtml'

describe('buildReportHtml — table row cap', () => {
  const capDoc: ReportDoc = {
    version: 1,
    blocks: [
      { type: 'widget', id: 'blk-cap', title: 'Cap', sql: 'SELECT n', datasetNames: ['ds'], vizType: 'table', caption: '' },
    ],
  }

  it('truncates table to EXPORT_ROW_CAP rows and shows cap note', () => {
    const rows = Array.from({ length: EXPORT_ROW_CAP + 1 }, (_, i) => ({ n: i }))
    const rendered: Record<string, RenderedWidget> = {
      'blk-cap': {
        kind: 'table',
        result: { columns: [{ name: 'n', type: 'Int64' }], rows, numRows: rows.length },
      },
    }
    const html = buildReportHtml(capDoc, rendered)
    // header row + EXPORT_ROW_CAP body rows = EXPORT_ROW_CAP + 1 <tr> elements
    expect((html.match(/<tr>/g) || []).length).toBe(EXPORT_ROW_CAP + 1)
    expect(html).toContain(`первые ${EXPORT_ROW_CAP} из ${EXPORT_ROW_CAP + 1} строк`)
  })

  it('does not truncate or show cap note when rows <= EXPORT_ROW_CAP', () => {
    const rows = [{ n: 0 }, { n: 1 }, { n: 2 }]
    const rendered: Record<string, RenderedWidget> = {
      'blk-cap': {
        kind: 'table',
        result: { columns: [{ name: 'n', type: 'Int64' }], rows, numRows: rows.length },
      },
    }
    const html = buildReportHtml(capDoc, rendered)
    expect((html.match(/<tr>/g) || []).length).toBe(3 + 1)
    expect(html).not.toContain('таблица усечена')
  })
})

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
