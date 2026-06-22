import { create } from 'zustand'
import type { QueryResult, ResultColumn } from '../core/arrowToRows'

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
}))
