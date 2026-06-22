import { beforeEach, describe, expect, it } from 'vitest'
import { useSession, type Dataset } from './session'

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
