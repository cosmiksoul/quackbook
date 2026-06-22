import { create } from 'zustand'
import type { QueryResult, ResultColumn } from '../core/arrowToRows'
import { buildSelectStar } from '../core/sql'

export interface Dataset {
  table: string
  fileName: string
  bytes: number
  kind: 'csv' | 'parquet'
  columns: ResultColumn[]
}

export interface Tab {
  id: string
  title: string
  datasetTable: string | null
  sql: string
  result: QueryResult | null
  meta: { ms: number; rows: number } | null
  error: string | null
}

interface SessionState {
  datasets: Dataset[]
  tabs: Tab[]
  activeTabId: string | null
  mode: 'explore' | 'report'
  seq: number // deterministic id counter (no Math.random/Date.now)
  // actions
  addDataset: (dataset: Dataset) => void
  setMode: (mode: 'explore' | 'report') => void
  reset: () => void
  openOrFocusTab: (table: string) => void
  openBlankTab: () => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTabSql: (id: string, sql: string) => void
  setTabResult: (id: string, result: QueryResult, meta: { ms: number; rows: number }) => void
  setTabError: (id: string, message: string) => void
}

const initial = {
  datasets: [] as Dataset[],
  tabs: [] as Tab[],
  activeTabId: null as string | null,
  mode: 'explore' as const,
  seq: 0,
}

export const useSession = create<SessionState>((set) => ({
  ...initial,
  addDataset: (dataset) =>
    set((s) => ({ datasets: [...s.datasets, dataset] })),
  setMode: (mode) => set({ mode }),
  reset: () => set({ ...initial }),
  openOrFocusTab: (table) =>
    set((s) => {
      const existing = s.tabs.find((t) => t.datasetTable === table)
      if (existing) return { activeTabId: existing.id }
      const id = `tab-${s.seq + 1}`
      const tab: Tab = {
        id,
        title: table,
        datasetTable: table,
        sql: buildSelectStar(table),
        result: null,
        meta: null,
        error: null,
      }
      return { tabs: [...s.tabs, tab], activeTabId: id, seq: s.seq + 1 }
    }),
  openBlankTab: () =>
    set((s) => {
      const n = s.tabs.filter((t) => t.datasetTable === null).length + 1
      const id = `tab-${s.seq + 1}`
      const tab: Tab = {
        id,
        title: `Запрос ${n}`,
        datasetTable: null,
        sql: '',
        result: null,
        meta: null,
        error: null,
      }
      return { tabs: [...s.tabs, tab], activeTabId: id, seq: s.seq + 1 }
    }),
  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      if (idx === -1) return {}
      const tabs = s.tabs.filter((t) => t.id !== id)
      let activeTabId = s.activeTabId
      if (activeTabId === id) {
        const next = tabs[idx] ?? tabs[idx - 1] ?? null
        activeTabId = next ? next.id : null
      }
      return { tabs, activeTabId }
    }),
  setActiveTab: (id) => set({ activeTabId: id }),
  updateTabSql: (id, sql) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, sql } : t)),
    })),
  setTabResult: (id, result, meta) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, result, meta, error: null } : t,
      ),
    })),
  setTabError: (id, message) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, error: message } : t)),
    })),
}))
