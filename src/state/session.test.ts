import { beforeEach, describe, expect, it } from 'vitest'
import { useSession, type Dataset } from './session'
import type { ColumnConfig } from '../core/schemaTypes'
import type { ColumnProfile } from '../core/profile'
import type { ReportDoc, WidgetBlock } from '../core/report'

const ds = (table: string): Dataset => ({
  table,
  fileName: `${table}.csv`,
  bytes: 10,
  kind: 'csv',
  columns: [{ name: 'a', type: 'VARCHAR' }],
})

beforeEach(() => useSession.getState().reset())

describe('session: datasets + mode + reset', () => {
  it('starts empty in explore mode', () => {
    const s = useSession.getState()
    expect(s.datasets).toEqual([])
    expect(s.tabs).toEqual([])
    expect(s.activeTabId).toBeNull()
    expect(s.mode).toBe('explore')
  })
  it('adds datasets', () => {
    useSession.getState().addDataset(ds('events'))
    useSession.getState().addDataset(ds('orders'))
    expect(useSession.getState().datasets.map((d) => d.table)).toEqual([
      'events',
      'orders',
    ])
  })
  it('switches mode', () => {
    useSession.getState().setMode('report')
    expect(useSession.getState().mode).toBe('report')
  })
  it('reset clears everything back to defaults', () => {
    const s = useSession.getState()
    s.addDataset(ds('events'))
    s.setMode('report')
    s.reset()
    const after = useSession.getState()
    expect(after.datasets).toEqual([])
    expect(after.tabs).toEqual([])
    expect(after.activeTabId).toBeNull()
    expect(after.mode).toBe('explore')
  })
})

describe('session: tabs', () => {
  it('openOrFocusTab creates a dataset-seeded tab, then focuses it on re-open', () => {
    const s = useSession.getState()
    s.openOrFocusTab('events')
    let st = useSession.getState()
    expect(st.tabs).toHaveLength(1)
    expect(st.tabs[0]).toMatchObject({
      title: 'events',
      datasetTable: 'events',
      sql: 'SELECT * FROM "events"',
    })
    expect(st.activeTabId).toBe(st.tabs[0].id)

    // open another dataset, then re-open the first -> focus, не дублируем
    useSession.getState().openOrFocusTab('orders')
    const firstId = st.tabs[0].id
    useSession.getState().openOrFocusTab('events')
    st = useSession.getState()
    expect(st.tabs).toHaveLength(2)
    expect(st.activeTabId).toBe(firstId)
  })

  it('openBlankTab adds an unattached scratch tab with a running title', () => {
    const s = useSession.getState()
    s.openBlankTab()
    s.openBlankTab()
    const st = useSession.getState()
    expect(st.tabs.map((t) => t.title)).toEqual(['Запрос 1', 'Запрос 2'])
    expect(st.tabs[0].datasetTable).toBeNull()
    expect(st.activeTabId).toBe(st.tabs[1].id)
  })

  it('updateTabSql / setTabResult / setTabError mutate the right tab', () => {
    const s = useSession.getState()
    s.openOrFocusTab('events')
    const id = useSession.getState().tabs[0].id
    s.updateTabSql(id, 'SELECT 1')
    s.setTabResult(id, { columns: [], rows: [], numRows: 0 }, { ms: 3, rows: 0 })
    let t = useSession.getState().tabs[0]
    expect(t.sql).toBe('SELECT 1')
    expect(t.meta).toEqual({ ms: 3, rows: 0 })
    expect(t.error).toBeNull()
    s.setTabError(id, 'boom')
    t = useSession.getState().tabs[0]
    expect(t.error).toBe('boom')
  })

  it('closeTab removes it and re-points activeTabId', () => {
    const s = useSession.getState()
    s.openOrFocusTab('events')
    s.openOrFocusTab('orders')
    const [a, b] = useSession.getState().tabs
    s.setActiveTab(a.id)
    s.closeTab(a.id)
    const st = useSession.getState()
    expect(st.tabs.map((t) => t.id)).toEqual([b.id])
    expect(st.activeTabId).toBe(b.id)
  })

  it('closing the last tab sets activeTabId to null', () => {
    const s = useSession.getState()
    s.openOrFocusTab('events')
    s.closeTab(useSession.getState().tabs[0].id)
    expect(useSession.getState().activeTabId).toBeNull()
  })

  it('ids are deterministic (tab-1, tab-2, ...)', () => {
    const s = useSession.getState()
    s.openOrFocusTab('events')
    s.openBlankTab()
    expect(useSession.getState().tabs.map((t) => t.id)).toEqual([
      'tab-1',
      'tab-2',
    ])
  })
})

const csvDs = (table: string): Dataset => ({
  table,
  fileName: `${table}.csv`,
  bytes: 10,
  kind: 'csv',
  columns: [
    { name: 'id', type: 'VARCHAR' },
    { name: 'rev', type: 'VARCHAR' },
  ],
  rawTable: `_qb_raw_${table}`,
  suggested: [
    { name: 'id', type: 'BIGINT' },
    { name: 'rev', type: 'DOUBLE' },
  ],
  schemaConfig: [
    { origName: 'id', name: 'id', type: 'VARCHAR', include: true },
    { origName: 'rev', name: 'rev', type: 'VARCHAR', include: true },
  ],
})

describe('session: schema config — setColumnConfig / stageColumn (M2)', () => {
  it('setColumnConfig replaces the whole config (used by "типы")', () => {
    useSession.getState().reset()
    const s = useSession.getState()
    s.addDataset(csvDs('events'))
    const next: ColumnConfig[] = [
      { origName: 'id', name: 'id', type: 'BIGINT', include: true },
      { origName: 'rev', name: 'rev', type: 'DOUBLE', include: true },
    ]
    s.setColumnConfig('events', next)
    const d = useSession.getState().datasets[0]
    expect(d.schemaConfig).toEqual(next)
  })

  it('stageColumn edits one column by origName', () => {
    useSession.getState().reset()
    const s = useSession.getState()
    s.addDataset(csvDs('events'))
    s.stageColumn('events', {
      origName: 'rev',
      name: 'revenue',
      type: 'DOUBLE',
      include: true,
      decimalSep: ',',
    })
    const d = useSession.getState().datasets[0]
    expect(d.schemaConfig).toEqual([
      { origName: 'id', name: 'id', type: 'VARCHAR', include: true },
      { origName: 'rev', name: 'revenue', type: 'DOUBLE', include: true, decimalSep: ',' },
    ])
  })

  it('setSchemaError stores a per-dataset error message', () => {
    useSession.getState().reset()
    const s = useSession.getState()
    s.addDataset(csvDs('events'))
    s.setSchemaError('events', 'boom')
    expect(useSession.getState().datasets[0].schemaError).toBe('boom')
    s.setSchemaError('events', null)
    expect(useSession.getState().datasets[0].schemaError).toBeNull()
  })
})

describe('session: schema config — resetColumn / setApplied (M2)', () => {
  it('resetColumn returns a column to the raw VARCHAR baseline', () => {
    useSession.getState().reset()
    const s = useSession.getState()
    s.addDataset(csvDs('events'))
    s.stageColumn('events', {
      origName: 'rev',
      name: 'x',
      type: 'DOUBLE',
      include: false,
      decimalSep: ',',
    })
    s.resetColumn('events', 'rev')
    const d = useSession.getState().datasets[0]
    // reset == untype this column to the raw baseline (same as the header «сброс»,
    // scoped to one column): original name, VARCHAR, included, no format/sep/token.
    expect(d.schemaConfig?.find((c) => c.origName === 'rev')).toEqual({
      origName: 'rev',
      name: 'rev',
      type: 'VARCHAR',
      include: true,
    })
  })

  it('setApplied updates columns + per-column nullLoss', () => {
    useSession.getState().reset()
    const s = useSession.getState()
    s.addDataset(csvDs('events'))
    s.stageColumn('events', { origName: 'rev', name: 'rev', type: 'DOUBLE', include: true })
    s.setApplied(
      'events',
      [
        { name: 'id', type: 'BIGINT' },
        { name: 'rev', type: 'DOUBLE' },
      ],
      { rev: 3 },
    )
    const d = useSession.getState().datasets[0]
    expect(d.columns).toEqual([
      { name: 'id', type: 'BIGINT', nullLoss: 0 },
      { name: 'rev', type: 'DOUBLE', nullLoss: 3 },
    ])
  })
})

const profileFixture: ColumnProfile[] = [
  { name: 'id', type: 'BIGINT', distinct: 4, nullCount: 0, kind: 'numeric' },
]

describe('session: source profile state (M3)', () => {
  it('setProfiling toggles the per-dataset flag', () => {
    useSession.getState().reset()
    const s = useSession.getState()
    s.addDataset(csvDs('events'))
    s.setProfiling('events', true)
    expect(useSession.getState().datasets[0].profiling).toBe(true)
  })

  it('setProfile stores profiles + rowCount, clears flag + error', () => {
    useSession.getState().reset()
    const s = useSession.getState()
    s.addDataset(csvDs('events'))
    s.setProfiling('events', true)
    s.setProfile('events', profileFixture, 48210)
    const d = useSession.getState().datasets[0]
    expect(d.profile).toEqual(profileFixture)
    expect(d.rowCount).toBe(48210)
    expect(d.profiling).toBe(false)
    expect(d.profileError).toBeNull()
  })

  it('setProfileError stores the message and clears the flag', () => {
    useSession.getState().reset()
    const s = useSession.getState()
    s.addDataset(csvDs('events'))
    s.setProfiling('events', true)
    s.setProfileError('events', 'boom')
    const d = useSession.getState().datasets[0]
    expect(d.profileError).toBe('boom')
    expect(d.profiling).toBe(false)
  })

  it('setApplied invalidates a cached source profile + rowCount (re-materialized table)', () => {
    useSession.getState().reset()
    const s = useSession.getState()
    s.addDataset(csvDs('events'))
    s.setProfile('events', profileFixture, 48210)
    s.setApplied('events', [{ name: 'id', type: 'BIGINT' }], {})
    const d = useSession.getState().datasets[0]
    expect(d.profile).toBeUndefined()
    expect(d.rowCount).toBeUndefined()
  })
})

describe('session: explore view + profile target (M3, shared)', () => {
  it('defaults to table view and no profile target', () => {
    useSession.getState().reset()
    const s = useSession.getState()
    expect(s.exploreView).toBe('table')
    expect(s.profileTarget).toBeNull()
  })
  it('setExploreView / setProfileTarget update the shared view selectors', () => {
    useSession.getState().reset()
    const s = useSession.getState()
    s.setExploreView('profile')
    s.setProfileTarget({ kind: 'source', table: 'events' })
    const after = useSession.getState()
    expect(after.exploreView).toBe('profile')
    expect(after.profileTarget).toEqual({ kind: 'source', table: 'events' })
  })
})

describe('session: result profile state + invalidation (M3)', () => {
  it('setResultProfile / setResultProfiling / setResultProfileError act on the right tab', () => {
    useSession.getState().reset()
    const s = useSession.getState()
    s.openOrFocusTab('events')
    const id = useSession.getState().tabs[0].id
    s.setResultProfiling(id, true)
    expect(useSession.getState().tabs[0].resultProfiling).toBe(true)
    s.setResultProfile(id, profileFixture, 1234)
    let t = useSession.getState().tabs[0]
    expect(t.resultProfile).toEqual(profileFixture)
    expect(t.resultRowCount).toBe(1234)
    expect(t.resultProfiling).toBe(false)
    expect(t.resultProfileError).toBeNull()
    s.setResultProfileError(id, 'bad sql')
    t = useSession.getState().tabs[0]
    expect(t.resultProfileError).toBe('bad sql')
    expect(t.resultProfiling).toBe(false)
  })

  it('updateTabSql invalidates a cached result profile + rowCount (new SQL -> recompute)', () => {
    useSession.getState().reset()
    const s = useSession.getState()
    s.openOrFocusTab('events')
    const id = useSession.getState().tabs[0].id
    s.setResultProfile(id, profileFixture, 1234)
    s.updateTabSql(id, 'SELECT 2')
    const t = useSession.getState().tabs[0]
    expect(t.resultProfile).toBeUndefined()
    expect(t.resultRowCount).toBeUndefined()
  })
})

const widgetFields = (
  over: Partial<Omit<WidgetBlock, 'type' | 'id'>> = {},
): Omit<WidgetBlock, 'type' | 'id'> => ({
  title: 'Запрос',
  sql: 'SELECT * FROM events',
  datasetNames: ['events'],
  vizType: 'table',
  caption: '',
  ...over,
})

describe('session: report (M4)', () => {
  it('starts with an empty report and no active block', () => {
    const s = useSession.getState()
    expect(s.report).toEqual({ version: 1, blocks: [] })
    expect(s.activeBlockId).toBeNull()
  })

  it('pinResult appends a widget block with id blk-1 and the given fields', () => {
    useSession.getState().pinResult(widgetFields({ title: 'Выручка' }))
    const b = useSession.getState().report.blocks
    expect(b).toHaveLength(1)
    expect(b[0]).toEqual({
      type: 'widget',
      id: 'blk-1',
      title: 'Выручка',
      sql: 'SELECT * FROM events',
      datasetNames: ['events'],
      vizType: 'table',
      caption: '',
    })
  })

  it('addTextBlock appends an empty text block; ids increment across mixed pin/add', () => {
    const s = useSession.getState()
    s.pinResult(widgetFields())
    s.addTextBlock()
    const b = useSession.getState().report.blocks
    expect(b.map((x) => x.id)).toEqual(['blk-1', 'blk-2'])
    expect(b[1]).toEqual({ type: 'text', id: 'blk-2', markdown: '' })
  })

  it('updateTextBlock / updateWidgetTitle / updateWidgetCaption / setWidgetVizType edit by id', () => {
    const s = useSession.getState()
    s.pinResult(widgetFields()) // blk-1 widget
    s.addTextBlock() // blk-2 text
    s.updateTextBlock('blk-2', '## note')
    s.updateWidgetTitle('blk-1', 'Новый')
    s.updateWidgetCaption('blk-1', 'подпись')
    s.setWidgetVizType('blk-1', 'chart')
    const [w, t] = useSession.getState().report.blocks as [
      WidgetBlock,
      { markdown: string },
    ]
    expect(t.markdown).toBe('## note')
    expect(w.title).toBe('Новый')
    expect(w.caption).toBe('подпись')
    expect(w.vizType).toBe('chart')
  })

  it('moveBlock swaps with the neighbor; no-op at the edges', () => {
    const s = useSession.getState()
    s.addTextBlock() // blk-1
    s.addTextBlock() // blk-2
    s.addTextBlock() // blk-3
    s.moveBlock('blk-2', 'up')
    expect(useSession.getState().report.blocks.map((b) => b.id)).toEqual([
      'blk-2',
      'blk-1',
      'blk-3',
    ])
    s.moveBlock('blk-2', 'up') // already first -> no-op
    expect(useSession.getState().report.blocks.map((b) => b.id)).toEqual([
      'blk-2',
      'blk-1',
      'blk-3',
    ])
    s.moveBlock('blk-3', 'down') // already last -> no-op
    expect(useSession.getState().report.blocks.map((b) => b.id)).toEqual([
      'blk-2',
      'blk-1',
      'blk-3',
    ])
  })

  it('removeBlock drops the block and nulls activeBlockId if it pointed there', () => {
    const s = useSession.getState()
    s.addTextBlock() // blk-1
    s.addTextBlock() // blk-2
    s.setActiveBlock('blk-1')
    s.removeBlock('blk-1')
    const after = useSession.getState()
    expect(after.report.blocks.map((b) => b.id)).toEqual(['blk-2'])
    expect(after.activeBlockId).toBeNull()
  })

  it('setActiveBlock sets and clears', () => {
    const s = useSession.getState()
    s.addTextBlock()
    s.setActiveBlock('blk-1')
    expect(useSession.getState().activeBlockId).toBe('blk-1')
    s.setActiveBlock(null)
    expect(useSession.getState().activeBlockId).toBeNull()
  })

  it('loadReport replaces blocks, nulls active, and advances seq past max blk-<n>', () => {
    const s = useSession.getState()
    s.setActiveBlock('blk-x')
    const doc: ReportDoc = {
      version: 1,
      blocks: [
        { type: 'text', id: 'blk-3', markdown: 'a' },
        { type: 'text', id: 'blk-5', markdown: 'b' },
      ],
    }
    s.loadReport(doc)
    const after = useSession.getState()
    expect(after.report).toEqual(doc)
    expect(after.activeBlockId).toBeNull()
    // next added block must not collide with blk-5
    after.addTextBlock()
    expect(useSession.getState().report.blocks.at(-1)!.id).toBe('blk-6')
  })

  it('reset clears report back to empty and activeBlockId to null', () => {
    const s = useSession.getState()
    s.pinResult(widgetFields())
    s.setActiveBlock('blk-1')
    s.reset()
    const after = useSession.getState()
    expect(after.report).toEqual({ version: 1, blocks: [] })
    expect(after.activeBlockId).toBeNull()
  })
})

describe('session: renameTab (M5)', () => {
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
})

describe('session: toast (M4)', () => {
  it('setToast sets and clears; reset clears a non-null toast', () => {
    const s = useSession.getState()
    expect(s.toast).toBeNull()
    s.setToast('закреплено в отчёт')
    expect(useSession.getState().toast).toBe('закреплено в отчёт')
    s.setToast(null)
    expect(useSession.getState().toast).toBeNull()
    // reset-clears: set a NON-null toast first, then reset, then assert null.
    // This is the assertion guarding the Step 3 trap — reset() is set({...initial}),
    // a shallow merge, so it only clears `toast` if `toast` is present in `initial`.
    // Omitting the `initial` entry (but adding the field + create action) would
    // pass setToast set/clear yet leave a stale toast after reset; this line fails
    // in that case.
    s.setToast('again')
    s.reset()
    expect(useSession.getState().toast).toBeNull()
  })
})
