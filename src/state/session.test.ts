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
