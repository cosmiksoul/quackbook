import { beforeEach, describe, expect, it } from 'vitest'
import { useSession, type Dataset } from './session'
import type { ColumnConfig } from '../core/schemaTypes'

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
  dirty: false,
})

describe('session: schema config — setColumnConfig / stageColumn (M2)', () => {
  it('setColumnConfig replaces the whole config and clears dirty (used by "типы")', () => {
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
    expect(d.dirty).toBe(false)
  })

  it('stageColumn edits one column by origName and marks dirty', () => {
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
    expect(d.dirty).toBe(true)
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
  it('resetColumn returns a column to the raw VARCHAR baseline and marks dirty', () => {
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
    expect(d.dirty).toBe(true)
  })

  it('setApplied updates columns + per-column nullLoss and clears dirty', () => {
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
    expect(d.dirty).toBe(false)
    expect(d.columns).toEqual([
      { name: 'id', type: 'BIGINT', nullLoss: 0 },
      { name: 'rev', type: 'DOUBLE', nullLoss: 3 },
    ])
  })
})
