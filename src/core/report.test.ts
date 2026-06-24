import { describe, expect, it } from 'vitest'
import {
  serializeReport,
  deserializeReport,
  neededDatasets,
  type ReportDoc,
} from './report'

const sample: ReportDoc = {
  version: 1,
  blocks: [
    { type: 'text', id: 'blk-1', markdown: '# Заголовок\nтекст' },
    {
      type: 'widget',
      id: 'blk-2',
      title: 'Выручка по странам',
      sql: 'SELECT country, sum(revenue) AS rev FROM events GROUP BY 1',
      datasetNames: ['events'],
      vizType: 'chart',
      caption: 'топ-страны',
    },
  ],
}

describe('serializeReport / deserializeReport', () => {
  it('round-trips a doc with a text + a widget block', () => {
    const json = serializeReport(sample)
    expect(typeof json).toBe('string')
    expect(deserializeReport(json)).toEqual(sample)
  })

  it('rejects an unsupported version', () => {
    expect(() => deserializeReport('{"version":2,"blocks":[]}')).toThrow(
      /version/,
    )
    expect(() => deserializeReport('{"blocks":[]}')).toThrow(/version/)
  })

  it('rejects a non-JSON string', () => {
    // The raw JSON.parse SyntaxError is the intended surface here (this is the
    // one error path that is NOT one of the module's own Error('...') messages).
    expect(() => deserializeReport('not json {')).toThrow(SyntaxError)
  })

  it('rejects a widget block missing sql', () => {
    const bad = JSON.stringify({
      version: 1,
      blocks: [
        {
          type: 'widget',
          id: 'blk-1',
          title: 't',
          datasetNames: [],
          vizType: 'table',
          caption: '',
        },
      ],
    })
    expect(() => deserializeReport(bad)).toThrow(/malformed/)
  })

  it('rejects a block with an unknown type', () => {
    const bad = JSON.stringify({
      version: 1,
      blocks: [{ type: 'chart', id: 'blk-1' }],
    })
    expect(() => deserializeReport(bad)).toThrow(/malformed/)
  })

  it('tolerates an extra unknown field on a valid block and drops it', () => {
    const withExtra = JSON.stringify({
      version: 1,
      blocks: [{ type: 'text', id: 'blk-1', markdown: 'hi', note: 'future' }],
    })
    const doc = deserializeReport(withExtra)
    expect(doc.blocks[0]).toMatchObject({
      type: 'text',
      id: 'blk-1',
      markdown: 'hi',
    })
    // validateBlock rebuilds each block from known fields, so unknown extras are
    // dropped (not merely ignored). Assert it explicitly — toMatchObject is a
    // subset check and would pass even if `note` survived.
    expect(Object.keys(doc.blocks[0])).not.toContain('note')
  })
})

describe('neededDatasets', () => {
  const widget = (
    id: string,
    datasetNames: string[],
  ): import('./report').WidgetBlock => ({
    type: 'widget',
    id,
    title: id,
    sql: 'SELECT 1',
    datasetNames,
    vizType: 'table',
    caption: '',
  })

  it('empty doc -> []', () => {
    expect(neededDatasets({ version: 1, blocks: [] })).toEqual([])
  })

  it('text-only doc -> []', () => {
    expect(
      neededDatasets({
        version: 1,
        blocks: [{ type: 'text', id: 'blk-1', markdown: 'hi' }],
      }),
    ).toEqual([])
  })

  it('unions overlapping datasetNames, deduped + sorted', () => {
    expect(
      neededDatasets({
        version: 1,
        blocks: [
          widget('blk-1', ['events', 'users']),
          { type: 'text', id: 'blk-2', markdown: 'note' },
          widget('blk-3', ['users', 'orders']),
        ],
      }),
    ).toEqual(['events', 'orders', 'users'])
  })
})
