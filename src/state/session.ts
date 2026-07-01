import { create } from 'zustand'
import type { QueryResult, ResultColumn } from '../core/arrowToRows'
import type { ColumnConfig } from '../core/schemaTypes'
import type { ColumnProfile } from '../core/profile'
import { buildSelectStar } from '../core/sql'
import {
  serializeReport,
  deserializeReport,
  type ReportDoc,
  type WidgetBlock,
} from '../core/report'
import { type ResultView, DEFAULT_VIEW } from '../core/resultQuery'

export interface Dataset {
  table: string
  fileName: string
  bytes: number
  kind: 'csv' | 'parquet' | 'view' | 'table'
  columns: { name: string; type: string; nullLoss?: number }[]
  // --- M7a: a mart (kind 'view'|'table') is a saved query; martSql is its
  // source SELECT (used to refresh a snapshot TABLE). Files have no martSql.
  martSql?: string
  // --- M2, only for kind === 'csv' ---
  rawTable?: string
  suggested?: { name: string; type: ColumnConfig['type'] }[]
  schemaConfig?: ColumnConfig[]
  schemaError?: string | null
  // --- M3 profile (source target), in-memory cache ---
  profile?: ColumnProfile[]
  rowCount?: number // relation row count (panel caption «N строк»)
  profiling?: boolean
  profileError?: string | null
}

export interface Tab {
  id: string
  title: string
  datasetTable: string | null
  sql: string
  result: QueryResult | null
  meta: { ms: number; rows: number } | null
  error: string | null
  // --- M3 profile (result target), in-memory cache (wired in slice 2) ---
  resultProfile?: ColumnProfile[]
  resultRowCount?: number
  resultProfiling?: boolean
  resultProfileError?: string | null
  // --- M8 windowed result ---
  mode?: 'paged' | 'raw'
  columns?: ResultColumn[]
  rowCount?: number // filtered match count (drives the pager)
  view?: ResultView
  window?: QueryResult | null // current page rows (paged) OR full result (raw)
  windowLoading?: boolean
  windowSeq?: number // latest-wins guard for async window fetches
}

export type ProfileTarget =
  | { kind: 'source'; table: string }
  | { kind: 'result'; tabId: string }
  | null

interface SessionState {
  datasets: Dataset[]
  tabs: Tab[]
  activeTabId: string | null
  mode: 'explore' | 'report'
  exploreView: 'table' | 'chart' | 'profile'
  profileTarget: ProfileTarget
  seq: number // deterministic id counter (no Math.random/Date.now)
  report: ReportDoc
  activeBlockId: string | null
  toast: string | null
  // actions
  addDataset: (dataset: Dataset) => void
  removeDataset: (table: string) => void
  setMode: (mode: 'explore' | 'report') => void
  reset: () => void
  openOrFocusTab: (table: string) => void
  openBlankTab: () => void
  seedTabs: (specs: { title: string; sql: string }[]) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  renameTab: (id: string, title: string) => void
  updateTabSql: (id: string, sql: string) => void
  setTabResult: (id: string, result: QueryResult, meta: { ms: number; rows: number }) => void
  setTabError: (id: string, message: string) => void
  setResultMeta: (id: string, meta: { columns: ResultColumn[]; rowCount: number; ms: number }) => void
  setRawResult: (id: string, window: QueryResult, ms: number) => void
  setWindow: (id: string, window: QueryResult | null, opts?: { rowCount?: number }) => void
  patchView: (id: string, patch: Partial<ResultView>) => void
  resetView: (id: string) => void
  setWindowLoading: (id: string, loading: boolean) => void
  nextWindowSeq: () => number
  setColumnConfig: (table: string, cfgs: ColumnConfig[]) => void
  stageColumn: (table: string, cfg: ColumnConfig) => void
  setSchemaError: (table: string, message: string | null) => void
  resetColumn: (table: string, origName: string) => void
  setApplied: (
    table: string,
    columns: { name: string; type: string }[],
    losses: Record<string, number>,
  ) => void
  setProfile: (table: string, profile: ColumnProfile[], rowCount: number) => void
  setProfiling: (table: string, profiling: boolean) => void
  setProfileError: (table: string, message: string | null) => void
  setResultProfile: (tabId: string, profile: ColumnProfile[], rowCount: number) => void
  setResultProfiling: (tabId: string, profiling: boolean) => void
  setResultProfileError: (tabId: string, message: string | null) => void
  setExploreView: (view: 'table' | 'chart' | 'profile') => void
  setProfileTarget: (target: ProfileTarget) => void
  pinResult: (fields: Omit<WidgetBlock, 'type' | 'id'>) => void
  addTextBlock: (markdown?: string) => void
  updateTextBlock: (id: string, markdown: string) => void
  updateWidgetTitle: (id: string, title: string) => void
  updateWidgetCaption: (id: string, caption: string) => void
  setWidgetVizType: (id: string, vizType: 'table' | 'chart') => void
  moveBlock: (id: string, dir: 'up' | 'down') => void
  removeBlock: (id: string) => void
  setActiveBlock: (id: string | null) => void
  loadReport: (doc: ReportDoc) => void
  setToast: (msg: string | null) => void
}

const initial = {
  datasets: [] as Dataset[],
  tabs: [] as Tab[],
  activeTabId: null as string | null,
  mode: 'explore' as const,
  exploreView: 'table' as const,
  profileTarget: null as ProfileTarget,
  seq: 0,
  report: { version: 1, blocks: [] } as ReportDoc,
  activeBlockId: null as string | null,
  toast: null as string | null,
}

const REPORT_KEY = 'quackbook.report'

/**
 * Load the persisted report STRUCTURE from localStorage (if any). Returns null
 * when there's nothing / it's bad / there's no localStorage (vitest node env).
 * NOTE: we hydrate the LIVE store with this AFTER create — `initial.report`
 * stays the empty doc so reset() clears to empty, not to the persisted doc.
 */
function loadPersistedReport(): ReportDoc | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(REPORT_KEY)
    return raw ? deserializeReport(raw) : null
  } catch {
    return null // bad / incompatible -> ignore, start empty
  }
}

export const useSession = create<SessionState>((set, get) => ({
  ...initial,
  addDataset: (dataset) =>
    set((s) => ({ datasets: [...s.datasets, dataset] })),
  removeDataset: (table) =>
    set((s) => ({ datasets: s.datasets.filter((d) => d.table !== table) })),
  setMode: (mode) => set({ mode }),
  reset: () => {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(REPORT_KEY)
      } catch {
        // ignore — storage may be unavailable
      }
    }
    set({ ...initial })
  },
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
  seedTabs: (specs) =>
    set((s) => {
      let seq = s.seq
      const created: Tab[] = specs.map((spec) => {
        seq += 1
        return {
          id: `tab-${seq}`,
          title: spec.title,
          datasetTable: null,
          sql: spec.sql,
          result: null,
          meta: null,
          error: null,
        }
      })
      return {
        tabs: [...s.tabs, ...created],
        activeTabId: created[0]?.id ?? s.activeTabId,
        seq,
      }
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
  renameTab: (id, title) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    })),
  updateTabSql: (id, sql) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, sql, resultProfile: undefined, resultRowCount: undefined }
          : t,
      ),
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
  setResultMeta: (id, meta) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, mode: 'paged', columns: meta.columns, rowCount: meta.rowCount,
              view: DEFAULT_VIEW, error: null, meta: { ms: meta.ms, rows: meta.rowCount } }
          : t,
      ),
    })),
  setRawResult: (id, window, ms) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, mode: 'raw', window, columns: window.columns, rowCount: window.numRows,
              windowLoading: false, error: null, meta: { ms, rows: window.numRows } }
          : t,
      ),
    })),
  setWindow: (id, window, opts) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, window, windowLoading: false,
              rowCount: opts?.rowCount ?? t.rowCount }
          : t,
      ),
    })),
  patchView: (id, patch) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, view: { ...(t.view ?? DEFAULT_VIEW), ...patch } } : t,
      ),
    })),
  resetView: (id) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, view: DEFAULT_VIEW } : t)) })),
  setWindowLoading: (id, loading) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, windowLoading: loading } : t)) })),
  nextWindowSeq: () => { const n = get().seq + 1; set({ seq: n }); return n },
  setColumnConfig: (table, cfgs) =>
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.table === table ? { ...d, schemaConfig: cfgs } : d,
      ),
    })),
  stageColumn: (table, cfg) =>
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.table === table
          ? {
              ...d,
              schemaConfig: (d.schemaConfig ?? []).map((c) =>
                c.origName === cfg.origName ? cfg : c,
              ),
            }
          : d,
      ),
    })),
  setSchemaError: (table, message) =>
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.table === table ? { ...d, schemaError: message } : d,
      ),
    })),
  resetColumn: (table, origName) =>
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.table !== table) return d
        // Reset == untype this column to the raw VARCHAR baseline (the header
        // «сброс», scoped to one column): original name, VARCHAR, included,
        // no format/sep/token.
        const restored: ColumnConfig = {
          origName,
          name: origName,
          type: 'VARCHAR',
          include: true,
        }
        return {
          ...d,
          schemaConfig: (d.schemaConfig ?? []).map((c) =>
            c.origName === origName ? restored : c,
          ),
        }
      }),
    })),
  setApplied: (table, columns, losses) =>
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.table === table
          ? {
              ...d,
              schemaError: null,
              profile: undefined, // re-materialized table -> stale profile
              rowCount: undefined,
              columns: columns.map((c) => ({
                name: c.name,
                type: c.type,
                nullLoss: losses[c.name] ?? 0,
              })),
            }
          : d,
      ),
    })),
  setProfile: (table, profile, rowCount) =>
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.table === table
          ? { ...d, profile, rowCount, profiling: false, profileError: null }
          : d,
      ),
    })),
  setProfiling: (table, profiling) =>
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.table === table ? { ...d, profiling } : d,
      ),
    })),
  setProfileError: (table, message) =>
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.table === table ? { ...d, profileError: message, profiling: false } : d,
      ),
    })),
  setResultProfile: (tabId, profile, rowCount) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              resultProfile: profile,
              resultRowCount: rowCount,
              resultProfiling: false,
              resultProfileError: null,
            }
          : t,
      ),
    })),
  setResultProfiling: (tabId, resultProfiling) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, resultProfiling } : t)),
    })),
  setResultProfileError: (tabId, message) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, resultProfileError: message, resultProfiling: false } : t,
      ),
    })),
  setExploreView: (exploreView) => set({ exploreView }),
  setProfileTarget: (profileTarget) => set({ profileTarget }),
  pinResult: (fields) =>
    set((s) => ({
      report: {
        version: 1,
        blocks: [
          ...s.report.blocks,
          { type: 'widget', id: `blk-${s.seq + 1}`, ...fields },
        ],
      },
      seq: s.seq + 1,
    })),
  addTextBlock: (markdown = '') =>
    set((s) => ({
      report: {
        version: 1,
        blocks: [
          ...s.report.blocks,
          { type: 'text', id: `blk-${s.seq + 1}`, markdown },
        ],
      },
      seq: s.seq + 1,
    })),
  updateTextBlock: (id, markdown) =>
    set((s) => ({
      report: {
        version: 1,
        blocks: s.report.blocks.map((b) =>
          b.id === id && b.type === 'text' ? { ...b, markdown } : b,
        ),
      },
    })),
  updateWidgetTitle: (id, title) =>
    set((s) => ({
      report: {
        version: 1,
        blocks: s.report.blocks.map((b) =>
          b.id === id && b.type === 'widget' ? { ...b, title } : b,
        ),
      },
    })),
  updateWidgetCaption: (id, caption) =>
    set((s) => ({
      report: {
        version: 1,
        blocks: s.report.blocks.map((b) =>
          b.id === id && b.type === 'widget' ? { ...b, caption } : b,
        ),
      },
    })),
  setWidgetVizType: (id, vizType) =>
    set((s) => ({
      report: {
        version: 1,
        blocks: s.report.blocks.map((b) =>
          b.id === id && b.type === 'widget' ? { ...b, vizType } : b,
        ),
      },
    })),
  moveBlock: (id, dir) =>
    set((s) => {
      const blocks = s.report.blocks
      const i = blocks.findIndex((b) => b.id === id)
      if (i === -1) return {}
      const j = dir === 'up' ? i - 1 : i + 1
      if (j < 0 || j >= blocks.length) return {}
      const next = [...blocks]
      ;[next[i], next[j]] = [next[j], next[i]]
      return { report: { version: 1, blocks: next } }
    }),
  removeBlock: (id) =>
    set((s) => ({
      report: {
        version: 1,
        blocks: s.report.blocks.filter((b) => b.id !== id),
      },
      activeBlockId: s.activeBlockId === id ? null : s.activeBlockId,
    })),
  setActiveBlock: (id) => set({ activeBlockId: id }),
  setToast: (toast) => set({ toast }),
  loadReport: (doc) =>
    set((s) => {
      let maxImported = 0
      for (const b of doc.blocks) {
        const m = /^blk-(\d+)$/.exec(b.id)
        if (m) maxImported = Math.max(maxImported, Number(m[1]))
      }
      return {
        report: doc,
        activeBlockId: null,
        seq: Math.max(s.seq, maxImported),
      }
    }),
}))

// Hydrate the live store from localStorage (structure only) via loadReport —
// NOT setState({ report }). loadReport also advances `seq` past the max blk-<n>
// in the persisted doc, so the next addTextBlock/pinResult after a reload mints
// a fresh id instead of colliding with a restored blk-N (and breaking React
// keys / move/remove targeting). It nulls activeBlockId too (fine on fresh
// load). initial.report stays the empty doc so reset() still clears to empty.
// This runs BEFORE subscribe() is attached, so it does not re-trigger autosave.
const persisted = loadPersistedReport()
if (persisted) useSession.getState().loadReport(persisted)

// Autosave: write whenever the report reference changes (block ops produce a
// fresh report object). Zustand v5 basic subscribe gives (state, prevState) —
// no subscribeWithSelector needed. Toast/other slices don't touch report, so
// they won't trigger a write.
useSession.subscribe((s, prev) => {
  if (s.report !== prev.report && typeof localStorage !== 'undefined') {
    try {
      // An empty report removes the key (so reset() / clearing the last block
      // truly leaves no persisted structure, not an empty doc echoed back).
      if (s.report.blocks.length === 0) localStorage.removeItem(REPORT_KEY)
      else localStorage.setItem(REPORT_KEY, serializeReport(s.report))
    } catch {
      // ignore — storage may be full / unavailable
    }
  }
})
