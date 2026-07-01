# M8 «Интерактивная таблица результата» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the fetch-all-into-JS result grid with windowed pagination over a materialized `_qb_result_<tab>` snapshot, plus click-sort / global search / per-column filters pushed to SQL as a read-only view layer.

**Architecture:** On every SELECT `run()`, materialize the result into `_qb_result_<tab>` (existing `buildResultTempDDL`), read `count(*)` + schema, and fetch only the current page window (`LIMIT/OFFSET`). Sort/search/filters build `WHERE`/`ORDER BY` over that table (pure `core/resultQuery.ts`), never touching the editor SQL. Bulk stays in DuckDB's columnar WASM heap; JS/DOM holds one window. Non-SELECT statements fall back to the current direct-query `raw` mode.

**Tech Stack:** React 19 + TS 6, Zustand 5, DuckDB-WASM, `@tanstack/react-virtual` (already a dep — reused), Vitest 4 (node). Spec: `docs/superpowers/specs/2026-07-01-quackbook-m8-result-table-design.md`.

## Global Constraints

- **0 new dependencies.** Reuse `@tanstack/react-virtual`; do NOT add `@tanstack/react-table`, jQuery, or DataTables. Pagination/sort/filter is our own code + SQL to DuckDB.
- **Determinism:** never `Math.random`/`Date.now`/`new Date`. Window-race guard ids come from the store `seq` counter.
- **TDD boundary:** `core/resultQuery.ts` + store reducers are red→green (Vitest node, `src/**/*.test.ts`). Presentation (grid headers, pager footer, filter popovers, chips) is by-eye — no jsdom/RTL.
- **Firewall:** sort/filter are a read-only VIEW layer over the query result; NOT per-cell editing, NOT derived columns in the schema editor, NOT a visual join-builder. In scope.
- **Gate every task:** `npm run lint` (0 errors) + `npm run build` (tsc) + `npm test`, all green before commit.
- **Commits:** bash here-doc, message ending with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Branch: `m8-result-table` (off `main` `6404285`; spec `becb264`).

## File Structure

- **Create** `src/core/resultQuery.ts` (+ `.test.ts`) — pure types + SQL builders (window/count/effective/order-by/where/predicates).
- **Create** `src/features/useResultActions.ts` — run/materialize/count/window orchestration + race guard + result-table drop.
- **Create** `src/features/resultQuery.integration.test.ts` — node DuckDB: materialize → count → window → sort/filter change selection.
- **Create** `src/components/ResultPager.tsx` — pagination footer.
- **Create** `src/components/ColumnFilter.tsx` — per-column type-aware filter popover.
- **Modify** `src/state/session.ts` (+ `.test.ts`) — Tab model (`view`/`window`/`mode`/`rowCount`/`columns`/`windowSeq`) + reducers.
- **Modify** `src/features/Explore.tsx` — wire `useResultActions`; result-table cleanup effect.
- **Modify** `src/components/ResultPanel.tsx` — grid ← `window`; chart ← bounded fetch; search + chips + copy-as-SQL; mount `ResultPager`.
- **Modify** `src/components/ResultGrid.tsx` — render `window`; sortable headers + funnel button.
- **Modify** `src/features/useProfileActions.ts` — reuse the already-materialized result table.
- **Modify** `src/features/exportReport.ts` — cap widget tables to first N + note.
- **Modify** `src/index.css` — pager / headers / filter popover / chips styles.

---

### Task 1: `core/resultQuery.ts` — types + SQL builders (TDD)

**Files:** Create `src/core/resultQuery.ts`, `src/core/resultQuery.test.ts`.

**Interfaces produced:**
- Types `SortDir`, `SortSpec`, `ColumnFilter`, `ResultView`; consts `DEFAULT_VIEW`, `PAGE_SIZES`, `CHART_CAP`.
- `buildOrderBy(sorts): string`, `buildWhere(columns, view): string`, `buildWindowSql(table, columns, view): string`, `buildCountSql(table, columns, view): string`, `buildEffectiveSql(userSql, columns, view): string`.
**Consumes:** `quoteIdent`, `quoteLiteral` from `core/sql.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/core/resultQuery.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_VIEW, buildOrderBy, buildWhere, buildWindowSql, buildCountSql, buildEffectiveSql,
  type ResultView, type ColumnFilter,
} from './resultQuery'

const COLS = ['id', 'name', 'amount', 'day']
const view = (p: Partial<ResultView>): ResultView => ({ ...DEFAULT_VIEW, ...p })

describe('buildOrderBy', () => {
  it('empty when no sorts', () => { expect(buildOrderBy([])).toBe('') })
  it('single + multi, quoted', () => {
    expect(buildOrderBy([{ col: 'a', dir: 'asc' }])).toBe('ORDER BY "a" ASC')
    expect(buildOrderBy([{ col: 'a', dir: 'asc' }, { col: 'b', dir: 'desc' }]))
      .toBe('ORDER BY "a" ASC, "b" DESC')
  })
})

describe('buildWhere', () => {
  it('empty when no search/filters', () => { expect(buildWhere(COLS, view({}))).toBe('') })
  it('global search ORs every column cast to VARCHAR, escaped + ESCAPE', () => {
    const w = buildWhere(['a', 'b'], view({ search: '50%_x' }))
    expect(w).toBe(
      `WHERE ("a"::VARCHAR ILIKE '%50\\%\\_x%' ESCAPE '\\' OR "b"::VARCHAR ILIKE '%50\\%\\_x%' ESCAPE '\\')`,
    )
  })
  it('text contains predicate', () => {
    const f: ColumnFilter = { col: 'name', type: 'text', op: 'contains', value: "O'Neil" }
    expect(buildWhere(COLS, view({ filters: [f] })))
      .toBe(`WHERE ("name"::VARCHAR ILIKE '%O''Neil%' ESCAPE '\\')`)
  })
  it('number range uses typed comparisons', () => {
    const f: ColumnFilter = { col: 'amount', type: 'number', min: 10, max: 100 }
    expect(buildWhere(COLS, view({ filters: [f] })))
      .toBe(`WHERE ("amount" >= 10 AND "amount" <= 100)`)
  })
  it('set membership compares as VARCHAR', () => {
    const f: ColumnFilter = { col: 'name', type: 'set', values: ['US', 'UK'] }
    expect(buildWhere(COLS, view({ filters: [f] })))
      .toBe(`WHERE ("name"::VARCHAR IN ('US', 'UK'))`)
  })
  it('null / not-null', () => {
    expect(buildWhere(COLS, view({ filters: [{ col: 'x', type: 'null', op: 'isNull' }] })))
      .toBe(`WHERE ("x" IS NULL)`)
  })
  it('search AND filters combine', () => {
    const w = buildWhere(['a'], view({
      search: 'q',
      filters: [{ col: 'amount', type: 'number', min: 5, max: null }],
    }))
    expect(w).toBe(`WHERE ("a"::VARCHAR ILIKE '%q%' ESCAPE '\\') AND ("amount" >= 5)`)
  })
})

describe('buildWindowSql', () => {
  it('LIMIT/OFFSET from page + size, with where/order', () => {
    expect(buildWindowSql('_qb_result_t1', COLS, view({ page: 3, pageSize: 50 })))
      .toBe('SELECT * FROM "_qb_result_t1" LIMIT 50 OFFSET 100')
    expect(buildWindowSql('_qb_result_t1', COLS, view({
      page: 1, pageSize: 100, sorts: [{ col: 'amount', dir: 'desc' }], search: 'q',
    }))).toBe(
      `SELECT * FROM "_qb_result_t1" WHERE ("id"::VARCHAR ILIKE '%q%' ESCAPE '\\' OR ` +
      `"name"::VARCHAR ILIKE '%q%' ESCAPE '\\' OR "amount"::VARCHAR ILIKE '%q%' ESCAPE '\\' OR ` +
      `"day"::VARCHAR ILIKE '%q%' ESCAPE '\\') ORDER BY "amount" DESC LIMIT 100 OFFSET 0`,
    )
  })
})

describe('buildCountSql', () => {
  it('count over the table with the same where (no order/limit)', () => {
    expect(buildCountSql('_qb_result_t1', COLS, view({})))
      .toBe('SELECT count(*) AS n FROM "_qb_result_t1"')
    expect(buildCountSql('_qb_result_t1', ['a'], view({ search: 'q' })))
      .toBe(`SELECT count(*) AS n FROM "_qb_result_t1" WHERE ("a"::VARCHAR ILIKE '%q%' ESCAPE '\\')`)
  })
})

describe('buildEffectiveSql', () => {
  it('wraps the user sql (trailing ; stripped) with where + order', () => {
    expect(buildEffectiveSql('SELECT * FROM t;', ['a'], view({
      sorts: [{ col: 'a', dir: 'asc' }], search: 'q',
    }))).toBe(
      `SELECT * FROM (SELECT * FROM t) WHERE ("a"::VARCHAR ILIKE '%q%' ESCAPE '\\') ORDER BY "a" ASC`,
    )
  })
})
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run src/core/resultQuery.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/core/resultQuery.ts`**

```ts
import { quoteIdent, quoteLiteral } from './sql'

export type SortDir = 'asc' | 'desc'
export interface SortSpec { col: string; dir: SortDir }

export type ColumnFilter =
  | { col: string; type: 'text'; op: 'contains' | 'equals' | 'startsWith'; value: string }
  | { col: string; type: 'null'; op: 'isNull' | 'notNull' }
  | { col: string; type: 'number'; min: number | null; max: number | null }
  | { col: string; type: 'date'; min: string | null; max: string | null }
  | { col: string; type: 'set'; values: string[] }

export interface ResultView {
  page: number // 1-based
  pageSize: number
  sorts: SortSpec[]
  search: string
  filters: ColumnFilter[]
}

export const PAGE_SIZES = [50, 100, 500]
export const CHART_CAP = 5000
export const DEFAULT_VIEW: ResultView = { page: 1, pageSize: 100, sorts: [], search: '', filters: [] }

/** Escape LIKE wildcards (\ % _) so search text is matched literally; used with ESCAPE '\'. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m)
}

/** `col::VARCHAR ILIKE '%<escaped>%' ESCAPE '\'` — a case-insensitive literal-contains. */
function likeContains(col: string, text: string): string {
  return `${quoteIdent(col)}::VARCHAR ILIKE ${quoteLiteral('%' + escapeLike(text) + '%')} ESCAPE '\\'`
}

export function buildOrderBy(sorts: SortSpec[]): string {
  if (sorts.length === 0) return ''
  return 'ORDER BY ' + sorts.map((s) => `${quoteIdent(s.col)} ${s.dir === 'desc' ? 'DESC' : 'ASC'}`).join(', ')
}

function globalSearch(columns: string[], search: string): string | null {
  const q = search.trim()
  if (q === '') return null
  return '(' + columns.map((c) => likeContains(c, q)).join(' OR ') + ')'
}

function columnPredicate(f: ColumnFilter): string | null {
  const col = quoteIdent(f.col)
  if (f.type === 'text') {
    if (f.value === '') return null
    const esc = quoteLiteral((f.op === 'startsWith' ? '' : '%') + escapeLike(f.value) + '%')
    if (f.op === 'equals') return `(${col}::VARCHAR = ${quoteLiteral(f.value)})`
    return `(${col}::VARCHAR ILIKE ${esc} ESCAPE '\\')`
  }
  if (f.type === 'null') return `(${col} IS ${f.op === 'isNull' ? 'NULL' : 'NOT NULL'})`
  if (f.type === 'number') {
    const parts: string[] = []
    if (f.min != null) parts.push(`${col} >= ${f.min}`)
    if (f.max != null) parts.push(`${col} <= ${f.max}`)
    return parts.length ? `(${parts.join(' AND ')})` : null
  }
  if (f.type === 'date') {
    const parts: string[] = []
    if (f.min) parts.push(`${col} >= ${quoteLiteral(f.min)}`)
    if (f.max) parts.push(`${col} <= ${quoteLiteral(f.max)}`)
    return parts.length ? `(${parts.join(' AND ')})` : null
  }
  // set
  if (f.values.length === 0) return null
  return `(${col}::VARCHAR IN (${f.values.map((v) => quoteLiteral(v)).join(', ')}))`
}

export function buildWhere(columns: string[], view: ResultView): string {
  const clauses: string[] = []
  const gs = globalSearch(columns, view.search)
  if (gs) clauses.push(gs)
  for (const f of view.filters) {
    const p = columnPredicate(f)
    if (p) clauses.push(p)
  }
  return clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''
}

/** `SELECT * FROM <table> [WHERE ...] [ORDER BY ...] LIMIT size OFFSET (page-1)*size`. */
export function buildWindowSql(table: string, columns: string[], view: ResultView): string {
  const where = buildWhere(columns, view)
  const order = buildOrderBy(view.sorts)
  const offset = (Math.max(1, view.page) - 1) * view.pageSize
  return [`SELECT * FROM ${quoteIdent(table)}`, where, order, `LIMIT ${view.pageSize} OFFSET ${offset}`]
    .filter(Boolean).join(' ')
}

/** `SELECT count(*) AS n FROM <table> [WHERE ...]` — the (filtered) total. */
export function buildCountSql(table: string, columns: string[], view: ResultView): string {
  const where = buildWhere(columns, view)
  return [`SELECT count(*) AS n FROM ${quoteIdent(table)}`, where].filter(Boolean).join(' ')
}

/** Portable copy-as-SQL: wrap the user's original query + the active view's where/order. */
export function buildEffectiveSql(userSql: string, columns: string[], view: ResultView): string {
  const select = userSql.trim().replace(/;\s*$/, '').trim()
  const where = buildWhere(columns, view)
  const order = buildOrderBy(view.sorts)
  return [`SELECT * FROM (${select})`, where, order].filter(Boolean).join(' ')
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run src/core/resultQuery.test.ts` → PASS.

- [ ] **Step 5: Gate + commit**

Run: `npm run lint && npm run build && npm test` → all green.

```bash
git add src/core/resultQuery.ts src/core/resultQuery.test.ts
git commit -F- <<'EOF'
feat(m8): core/resultQuery — window/count/effective SQL builders (TDD)

Pure ResultView model + buildOrderBy/buildWhere (global search ILIKE + typed
column predicates, LIKE-escaped) + buildWindowSql/buildCountSql/buildEffectiveSql.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: Tab result model + store reducers (TDD)

**Files:** Modify `src/state/session.ts` (Tab interface ~34-47; SessionState ~54-100; impls). Test `src/state/session.test.ts`.

**Interfaces produced:** Tab gains `mode?: 'paged'|'raw'`, `columns?: ResultColumn[]`, `rowCount?: number`, `view?: ResultView`, `window?: QueryResult | null`, `windowLoading?: boolean`, `windowSeq?: number`. Store actions: `setResultMeta`, `setWindow`, `patchView`, `resetView`, `setWindowLoading`, `nextWindowSeq`.
**Consumes:** `ResultView`, `DEFAULT_VIEW` (Task 1); `QueryResult`, `ResultColumn`.

- [ ] **Step 1: Write failing tests** — add to `src/state/session.test.ts`:

```ts
import { DEFAULT_VIEW } from '../core/resultQuery'
// ... inside the describe block (beforeEach resets the store) ...

it('setResultMeta seeds paged mode, columns, rowCount, default view', () => {
  const s = useSession.getState()
  s.openBlankTab()
  const id = useSession.getState().activeTabId!
  s.setResultMeta(id, { columns: [{ name: 'a', type: 'INTEGER' }], rowCount: 42, ms: 3 })
  const t = useSession.getState().tabs.find((x) => x.id === id)!
  expect(t.mode).toBe('paged')
  expect(t.rowCount).toBe(42)
  expect(t.columns).toEqual([{ name: 'a', type: 'INTEGER' }])
  expect(t.view).toEqual(DEFAULT_VIEW)
  expect(t.meta).toEqual({ ms: 3, rows: 42 })
})

it('patchView merges into the view; resetView restores default', () => {
  const s = useSession.getState()
  s.openBlankTab()
  const id = useSession.getState().activeTabId!
  s.setResultMeta(id, { columns: [], rowCount: 0, ms: 1 })
  s.patchView(id, { page: 4, search: 'q' })
  expect(useSession.getState().tabs.find((x) => x.id === id)!.view)
    .toEqual({ ...DEFAULT_VIEW, page: 4, search: 'q' })
  s.resetView(id)
  expect(useSession.getState().tabs.find((x) => x.id === id)!.view).toEqual(DEFAULT_VIEW)
})

it('nextWindowSeq increments the store seq and returns it (race guard)', () => {
  const s = useSession.getState()
  const a = s.nextWindowSeq()
  const b = useSession.getState().nextWindowSeq()
  expect(b).toBe(a + 1)
})
```

- [ ] **Step 2: Run → FAIL** (`setResultMeta is not a function`).

- [ ] **Step 3: Implement.** In `src/state/session.ts`:

Add import: `import { type ResultView, DEFAULT_VIEW } from '../core/resultQuery'` and ensure `ResultColumn`/`QueryResult` are imported from `../core/arrowToRows`.

Extend `Tab` (after `error`):
```ts
  // --- M8 windowed result ---
  mode?: 'paged' | 'raw'
  columns?: ResultColumn[]
  rowCount?: number // filtered match count (drives the pager)
  view?: ResultView
  window?: QueryResult | null // current page rows (paged) OR full result (raw)
  windowLoading?: boolean
  windowSeq?: number // latest-wins guard for async window fetches
```

Declare in `SessionState` (near `setTabResult`):
```ts
  setResultMeta: (id: string, meta: { columns: ResultColumn[]; rowCount: number; ms: number }) => void
  setWindow: (id: string, window: QueryResult | null, opts?: { rowCount?: number }) => void
  patchView: (id: string, patch: Partial<ResultView>) => void
  resetView: (id: string) => void
  setWindowLoading: (id: string, loading: boolean) => void
  nextWindowSeq: () => number
```

Implement (near `setTabResult`):
```ts
  setResultMeta: (id, meta) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, mode: 'paged', columns: meta.columns, rowCount: meta.rowCount,
              view: DEFAULT_VIEW, error: null, meta: { ms: meta.ms, rows: meta.rowCount } }
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
```
(Confirm the store factory exposes `get` — Zustand `create((set, get) => ...)`; if `get` is not in scope, add it to the factory signature.)

Keep the existing `setTabResult`/`setTabError` for the `raw`-mode fallback (Task 3 sets `mode:'raw'` + `window`). Add a `setRawResult` if cleaner, or reuse `setTabResult` writing to `window` — Task 3 decides. For this task, add:
```ts
  setRawResult: (id: string, window: QueryResult, ms: number) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, mode: 'raw', window, columns: window.columns, rowCount: window.numRows,
              windowLoading: false, error: null, meta: { ms, rows: window.numRows } }
          : t,
      ),
    })),
```
(declare it in `SessionState` too).

- [ ] **Step 4: Run tests → PASS.**

- [ ] **Step 5: Gate + commit**

```bash
git add src/state/session.ts src/state/session.test.ts
git commit -F- <<'EOF'
feat(m8): Tab windowed-result model + view reducers (TDD)

Tab gains mode/columns/rowCount/view/window/windowLoading/windowSeq; store
actions setResultMeta/setRawResult/setWindow/patchView/resetView/nextWindowSeq.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: `useResultActions` orchestration + Explore wiring + cleanup + integration

**Files:** Create `src/features/useResultActions.ts`, `src/features/resultQuery.integration.test.ts`. Modify `src/features/Explore.tsx`.

**Interfaces produced:** `useResultActions(client)` → `{ runQuery(tabId, sql), fetchWindow(tabId), dropResult(tabId) }`.
**Consumes:** Task 1 builders + `resultTempName`/`buildResultTempDDL`/`buildDropTable` (core/sql); Task 2 store actions; `client.exec`/`query`/`describeTable`; `arrowToRows`.

- [ ] **Step 1: Write the failing integration test** — `src/features/resultQuery.integration.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'
import { createNodeDuckDB } from '../db/nodeDuckDB'
import { createClient, type DuckDBClient } from '../db/duckdbClient'
import { useSession } from '../state/session'
import { useResultActions } from './useResultActions'

let db: AsyncDuckDB
let client: DuckDBClient

beforeAll(async () => {
  db = await createNodeDuckDB()
  client = createClient(db)
  await client.exec(`CREATE OR REPLACE TABLE nums AS SELECT i AS id, i % 3 AS grp FROM range(250) t(i)`)
}, 60_000)
afterAll(async () => { await db.terminate() })
beforeEach(() => { useSession.getState().reset() })

function newTab(sql: string): string {
  const s = useSession.getState()
  s.openBlankTab()
  const id = useSession.getState().activeTabId!
  s.updateTabSql(id, sql)
  return id
}

describe('useResultActions over real DuckDB', () => {
  it('runQuery materializes, counts, and loads page 1 window', async () => {
    const { runQuery } = useResultActions(client)
    const id = newTab('SELECT * FROM nums')
    await runQuery(id, 'SELECT * FROM nums')
    const t = useSession.getState().tabs.find((x) => x.id === id)!
    expect(t.mode).toBe('paged')
    expect(t.rowCount).toBe(250)
    expect(t.window!.rows.length).toBe(100) // default page size
    expect(t.columns!.map((c) => c.name)).toEqual(['id', 'grp'])
  })

  it('fetchWindow honors page + filter (filtered count + page rows)', async () => {
    const { runQuery, fetchWindow } = useResultActions(client)
    const id = newTab('SELECT * FROM nums')
    await runQuery(id, 'SELECT * FROM nums')
    useSession.getState().patchView(id, { filters: [{ col: 'grp', type: 'number', min: 0, max: 0 }] })
    await fetchWindow(id)
    const t = useSession.getState().tabs.find((x) => x.id === id)!
    expect(t.rowCount).toBe(84) // 0,3,6,... in [0,250)
    useSession.getState().patchView(id, { page: 2, pageSize: 50 })
    await fetchWindow(id)
    expect(useSession.getState().tabs.find((x) => x.id === id)!.window!.rows.length).toBe(34) // 84-50
  })

  it('non-SELECT falls back to raw mode', async () => {
    const { runQuery } = useResultActions(client)
    const id = newTab('PRAGMA version')
    await runQuery(id, 'PRAGMA version')
    expect(useSession.getState().tabs.find((x) => x.id === id)!.mode).toBe('raw')
  })

  it('dropResult removes the result table', async () => {
    const { runQuery, dropResult } = useResultActions(client)
    const id = newTab('SELECT * FROM nums')
    await runQuery(id, 'SELECT * FROM nums')
    await dropResult(id)
    await expect(client.query(`SELECT * FROM "_qb_result_${id}"`)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run → FAIL** (module missing).

- [ ] **Step 3: Implement `src/features/useResultActions.ts`:**

```ts
import { arrowToRows, type ResultColumn } from '../core/arrowToRows'
import { buildResultTempDDL, buildDropTable, resultTempName } from '../core/sql'
import { buildWindowSql, buildCountSql, DEFAULT_VIEW } from '../core/resultQuery'
import type { DuckDBClient } from '../db/duckdbClient'
import { useSession } from '../state/session'

export function useResultActions(client: DuckDBClient) {
  async function countMatches(table: string, columns: string[], view = DEFAULT_VIEW): Promise<number> {
    const rows = arrowToRows(await client.query(buildCountSql(table, columns, view))).rows
    return Number(rows[0]?.n ?? 0)
  }

  // Materialize the result snapshot, count, load page 1. Non-SELECT -> raw fallback.
  async function runQuery(tabId: string, sql: string): Promise<void> {
    const seq = useSession.getState().nextWindowSeq()
    const t0 = performance.now()
    const table = resultTempName(tabId)
    try {
      await client.exec(buildResultTempDDL(tabId, sql))
    } catch {
      // Not materializable (non-SELECT: PRAGMA/EXPLAIN/DDL) -> current direct path.
      try {
        const raw = arrowToRows(await client.query(sql))
        if (useSession.getState().nextWindowSeq() >= seq) useSession.getState().setRawResult(tabId, raw, performance.now() - t0)
      } catch (e) {
        useSession.getState().setTabError(tabId, String(e))
      }
      return
    }
    try {
      const columns: ResultColumn[] = await client.describeTable(table)
      const rowCount = await countMatches(table, columns.map((c) => c.name))
      useSession.getState().setResultMeta(tabId, { columns, rowCount, ms: performance.now() - t0 })
      await fetchWindow(tabId, seq)
    } catch (e) {
      useSession.getState().setTabError(tabId, String(e))
    }
  }

  // Fetch the current page window for a tab's view; recount when filters/search set.
  async function fetchWindow(tabId: string, seqIn?: number): Promise<void> {
    const st = useSession.getState()
    const tab = st.tabs.find((t) => t.id === tabId)
    if (!tab || tab.mode !== 'paged' || !tab.columns) return
    const seq = seqIn ?? st.nextWindowSeq()
    const table = resultTempName(tabId)
    const cols = tab.columns.map((c) => c.name)
    const view = tab.view ?? DEFAULT_VIEW
    st.setWindowLoading(tabId, true)
    try {
      const hasFilter = view.search.trim() !== '' || view.filters.length > 0
      const rowCount = hasFilter ? await countMatches(table, cols, view) : tab.rowCount
      const win = arrowToRows(await client.query(buildWindowSql(table, cols, view)))
      // latest-wins: only apply if no newer fetch started
      if ((useSession.getState().tabs.find((t) => t.id === tabId)?.windowSeq ?? 0) <= seq) {
        useSession.setState((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, windowSeq: seq } : t)) }))
        useSession.getState().setWindow(tabId, win, { rowCount })
      }
    } catch (e) {
      useSession.getState().setTabError(tabId, String(e))
    }
  }

  async function dropResult(tabId: string): Promise<void> {
    try { await client.exec(buildDropTable(resultTempName(tabId))) } catch { /* fire-and-forget */ }
  }

  return { runQuery, fetchWindow, dropResult }
}
```
(If the latest-wins guard via `windowSeq` proves awkward in tests, simplify to comparing a module-scope `Map<tabId, seq>`; keep behavior: a stale response never overwrites a newer view.)

- [ ] **Step 4: Wire `Explore.tsx`.** Replace the current `run()` body and add a window-refetch effect + cleanup:

```ts
import { useEffect, useMemo, useRef } from 'react'
import { useResultActions } from './useResultActions'
// ...
const { runQuery, fetchWindow, dropResult } = useResultActions(client)

async function run(sql: string) {
  if (!tab) return
  await runQuery(tab.id, sql)
}

// Refetch the window whenever the active tab's view changes (page/sort/search/filter).
const view = tab?.view
useEffect(() => {
  if (tab && tab.mode === 'paged') void fetchWindow(tab.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [tab?.id, view?.page, view?.pageSize, JSON.stringify(view?.sorts), view?.search, JSON.stringify(view?.filters)])

// Drop result tables for tabs that were closed.
const knownTabs = useRef<Set<string>>(new Set())
useEffect(() => {
  const now = new Set(tabs.map((t) => t.id))
  for (const id of knownTabs.current) if (!now.has(id)) void dropResult(id)
  knownTabs.current = now
}, [tabs, dropResult])
```
Remove the old `arrowToRows(await client.query(...))` block. Keep `setTabError` import usage (now inside `useResultActions`). The `run()` call sites (`onRun={run}`, `run(tab.sql)`) stay.

- [ ] **Step 5: Run integration test → PASS; full gate.**

Run: `npx vitest run src/features/resultQuery.integration.test.ts` then `npm run lint && npm run build && npm test`.

- [ ] **Step 6: Commit**

```bash
git add src/features/useResultActions.ts src/features/resultQuery.integration.test.ts src/features/Explore.tsx
git commit -F- <<'EOF'
feat(m8): windowed run/fetch orchestration + Explore wiring + cleanup

useResultActions.runQuery materializes _qb_result_<tab>, counts, loads page 1;
fetchWindow reloads the page on view change (recounting when filtered); dropResult
drops the table; non-SELECT falls back to raw mode. Explore refetches on view
change and drops result tables of closed tabs. Node integration test over DuckDB.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: ResultGrid — render window + sortable headers (by-eye)

**Files:** Modify `src/components/ResultGrid.tsx`, `src/components/ResultPanel.tsx`, `src/index.css`.

**Interfaces:** ResultGrid gains props `sorts: SortSpec[]`, `onToggleSort(col, additive)`, `onOpenFilter(col, anchorRect)`. ResultPanel passes `tab.window` as the grid `result` and the active `view`.
**Consumes:** Task 1 types, Task 2 view, Task 3 fetch (via ResultPanel/Explore already wired).

- [ ] **Step 1: ResultGrid** — render `result` = the window; make headers interactive:

```tsx
import type { SortSpec } from '../core/resultQuery'

export function ResultGrid({
  result, sorts, onToggleSort, onOpenFilter,
}: {
  result: QueryResult
  sorts: SortSpec[]
  onToggleSort: (col: string, additive: boolean) => void
  onOpenFilter: (col: string, rect: DOMRect) => void
}) {
  // ...existing virtualizer setup...
  const sortIndex = (name: string) => sorts.findIndex((s) => s.col === name)
  return (
    <div className="grid-scroll" ref={parentRef}>
      <div className="grid-head" style={{ width: gridW }}>
        {columns.map((c) => {
          const si = sortIndex(c.name)
          const dir = si >= 0 ? sorts[si].dir : null
          return (
            <div className="grid-cell grid-th" key={c.name} style={{ width: COL_W }} title={`${c.name}: ${c.type}`}>
              <span className="th-label" onClick={(e) => onToggleSort(c.name, e.shiftKey)}>
                {c.name}
                {dir && <span className="th-sort">{dir === 'asc' ? '▲' : '▼'}{sorts.length > 1 ? si + 1 : ''}</span>}
              </span>
              <button
                className="th-filter"
                title="фильтр по колонке"
                onClick={(e) => onOpenFilter(c.name, (e.currentTarget as HTMLElement).getBoundingClientRect())}
              >⏷</button>
            </div>
          )
        })}
      </div>
      {/* ...existing virtualized body unchanged... */}
    </div>
  )
}
```

- [ ] **Step 2: ResultPanel** — point the grid at the window + wire sort/filter to the store view:

```tsx
// derive from the active tab (ResultPanel already has tabId; read the tab):
const tab = useSession((s) => s.tabs.find((t) => t.id === tabId))
const patchView = useSession((s) => s.patchView)
const window = tab?.window ?? null
const view = tab?.view ?? DEFAULT_VIEW

function toggleSort(col: string, additive: boolean) {
  const cur = view.sorts
  const i = cur.findIndex((s) => s.col === col)
  let next: SortSpec[]
  if (i < 0) next = additive ? [...cur, { col, dir: 'asc' }] : [{ col, dir: 'asc' }]
  else if (cur[i].dir === 'asc') { const c = [...cur]; c[i] = { col, dir: 'desc' }; next = additive ? c : [{ col, dir: 'desc' }] }
  else next = additive ? cur.filter((s) => s.col !== col) : []
  patchView(tabId, { sorts: next, page: 1 })
}
```
Replace `<ResultGrid result={result} />` with `window && <ResultGrid result={window} sorts={view.sorts} onToggleSort={toggleSort} onOpenFilter={openFilter} />`. (Prop `result`/`meta` from Explore can stay for the `raw` path; prefer `window`.) `openFilter` is fleshed out in Task 7 — stub it to `() => {}` here so the build is green.

- [ ] **Step 3: CSS** (append to `src/index.css`):
```css
.grid-th { display: flex; align-items: center; gap: 4px; justify-content: space-between; }
.th-label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; user-select: none; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.th-label:hover { color: var(--text); }
.th-sort { color: var(--accent); font-size: 10px; }
.th-filter { border: 0; background: transparent; color: var(--text-faint); cursor: pointer; font-size: 10px; padding: 0 2px; opacity: 0; }
.grid-th:hover .th-filter, .th-filter.on { opacity: 1; }
.th-filter:hover { color: var(--text); }
```

- [ ] **Step 4: Gate (lint+build), eyeball, commit.** `npm run lint && npm run build`; then `npm run dev`: click headers cycle asc/desc/off, shift-click stacks sort, grid reloads sorted pages.

```bash
git add src/components/ResultGrid.tsx src/components/ResultPanel.tsx src/index.css
git commit -F- <<'EOF'
feat(m8): render window + click/shift sortable grid headers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: `ResultPager` footer (by-eye)

**Files:** Create `src/components/ResultPager.tsx`; modify `src/components/ResultPanel.tsx`, `src/index.css`.

**Interfaces:** `<ResultPager tabId total pageSize page onPage onPageSize />`. Reads nothing else; ResultPanel mounts it under the grid for `paged` mode.

- [ ] **Step 1: `ResultPager.tsx`:**

```tsx
import { PAGE_SIZES } from '../core/resultQuery'

export function ResultPager({
  total, page, pageSize, onPage, onPageSize,
}: {
  total: number; page: number; pageSize: number
  onPage: (p: number) => void; onPageSize: (n: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const clampP = (p: number) => Math.min(pages, Math.max(1, p))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className="grid-pager">
      <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} title="строк на странице">
        {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}/стр</option>)}
      </select>
      <span className="pager-range">{from}–{to} из {total}</span>
      <span className="pager-nav">
        <button disabled={page <= 1} onClick={() => onPage(1)} title="первая">⇤</button>
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} title="назад">←</button>
        <span>стр.{' '}
          <input className="pager-jump" type="number" min={1} max={pages} defaultValue={page}
            key={page}
            onKeyDown={(e) => { if (e.key === 'Enter') onPage(clampP(Number((e.target as HTMLInputElement).value))) }}
          /> из {pages}
        </span>
        <button disabled={page >= pages} onClick={() => onPage(page + 1)} title="вперёд">→</button>
        <button disabled={page >= pages} onClick={() => onPage(pages)} title="последняя">⇥</button>
      </span>
      <span className="pager-row">к строке{' '}
        <input className="pager-jump" type="number" min={1} max={total}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const r = Math.min(total, Math.max(1, Number((e.target as HTMLInputElement).value)))
            onPage(Math.ceil(r / pageSize))
          }}
        />
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Mount in ResultPanel** (below the grid, only when `tab.mode === 'paged'`):
```tsx
{tab?.mode === 'paged' && window && (
  <ResultPager
    total={tab.rowCount ?? 0} page={view.page} pageSize={view.pageSize}
    onPage={(p) => patchView(tabId, { page: p })}
    onPageSize={(n) => patchView(tabId, { pageSize: n, page: 1 })}
  />
)}
```

- [ ] **Step 3: CSS:**
```css
.grid-pager { display: flex; align-items: center; gap: 14px; padding: 6px 4px 0; font-size: 12px; color: var(--text-dim); flex-wrap: wrap; }
.grid-pager select { background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 2px 4px; }
.pager-nav { display: inline-flex; align-items: center; gap: 4px; }
.pager-nav button { background: var(--surface); color: var(--text-dim); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 1px 7px; cursor: pointer; }
.pager-nav button:disabled { opacity: .4; cursor: default; }
.pager-jump { width: 56px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 1px 4px; font-family: var(--font-mono); }
```

- [ ] **Step 4: Gate (lint+build), eyeball, commit.** Verify nav, jump-to-page (Enter), jump-to-row, page-size change; range text updates.

```bash
git add src/components/ResultPager.tsx src/components/ResultPanel.tsx src/index.css
git commit -F- <<'EOF'
feat(m8): pagination footer (size, nav, jump-to-page/row, range)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: Global search + filter chips + clear-all (by-eye)

**Files:** Modify `src/components/ResultPanel.tsx`, `src/index.css`.

- [ ] **Step 1: Search input** (debounced) in the panel header near the pager or above the grid:
```tsx
const [searchDraft, setSearchDraft] = useState('')
useEffect(() => { setSearchDraft(view.search) }, [tabId]) // reset on tab switch
useEffect(() => {
  const h = setTimeout(() => { if (searchDraft !== view.search) patchView(tabId, { search: searchDraft, page: 1 }) }, 250)
  return () => clearTimeout(h)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [searchDraft])
// JSX:
{tab?.mode === 'paged' && (
  <input className="result-search" placeholder="поиск по всем колонкам…"
    value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} />
)}
```
Use `import { useState, useEffect } from 'react'`. (`Date.now`-free debounce via `setTimeout` is fine — timers are allowed; only `Date.now`/`Math.random`/`new Date` are banned.)

- [ ] **Step 2: Active-filter chips + clear-all** (above the grid, when `view.filters.length || view.search`):
```tsx
function filterLabel(f: ColumnFilter): string {
  if (f.type === 'text') return `${f.col} ${f.op} «${f.value}»`
  if (f.type === 'null') return `${f.col} ${f.op === 'isNull' ? 'is null' : 'not null'}`
  if (f.type === 'number' || f.type === 'date') return `${f.col} ∈ [${f.min ?? '−∞'}, ${f.max ?? '+∞'}]`
  return `${f.col} ∈ {${f.values.join(', ')}}`
}
// JSX:
{(view.filters.length > 0 || view.search) && (
  <div className="filter-chips">
    {view.search && <span className="chip">поиск: «{view.search}»<button onClick={() => patchView(tabId, { search: '', page: 1 })}>×</button></span>}
    {view.filters.map((f, i) => (
      <span className="chip" key={f.col + i}>{filterLabel(f)}
        <button onClick={() => patchView(tabId, { filters: view.filters.filter((_, j) => j !== i), page: 1 })}>×</button>
      </span>
    ))}
    <button className="chip-clear" onClick={() => patchView(tabId, { filters: [], search: '', page: 1 })}>сбросить всё</button>
  </div>
)}
```

- [ ] **Step 3: CSS:**
```css
.result-search { background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 3px 8px; font-size: 12px; min-width: 200px; }
.filter-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.chip { display: inline-flex; align-items: center; gap: 4px; background: var(--surface-2); color: var(--text-dim); border: 1px solid var(--border); border-radius: 12px; padding: 2px 4px 2px 9px; font-size: 11.5px; }
.chip button { border: 0; background: transparent; color: var(--text-faint); cursor: pointer; }
.chip button:hover { color: var(--danger); }
.chip-clear { border: 0; background: transparent; color: var(--accent); cursor: pointer; font-size: 11.5px; }
```

- [ ] **Step 4: Gate, eyeball, commit.** Type in search → grid filters (debounced), chip appears; remove chip / clear-all resets.

```bash
git add src/components/ResultPanel.tsx src/index.css
git commit -F- <<'EOF'
feat(m8): global search (debounced) + active-filter chips + clear-all

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 7: `ColumnFilter` per-column popover (by-eye)

**Files:** Create `src/components/ColumnFilter.tsx`; modify `src/components/ResultPanel.tsx`, `src/index.css`.

**Interfaces:** `<ColumnFilter col type client tableName rect onApply(filter) onClose />`. `type` = the DuckDB type from `tab.columns`. For low-cardinality it queries distinct values from `_qb_result_<tab>`.
**Consumes:** `ColumnFilter` type (Task 1), `resultTempName`, `client.query`, `quoteIdent`.

- [ ] **Step 1: Classify by DuckDB type** — helper (put in `ColumnFilter.tsx`):
```ts
function kindOf(duckType: string): 'text' | 'number' | 'date' {
  const t = duckType.toUpperCase()
  if (/INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|HUGEINT/.test(t)) return 'number'
  if (/DATE|TIME/.test(t)) return 'date'
  return 'text'
}
const DISTINCT_MAX = 50
```

- [ ] **Step 2: Component** — on open, query `SELECT DISTINCT "col"::VARCHAR AS v FROM "_qb_result_<tab>" LIMIT DISTINCT_MAX+1`; if ≤ DISTINCT_MAX show a checklist (`type:'set'`), else show the type-specific input (text contains/equals; number min/max; date from/to; + is null/not null). Apply builds the matching `ColumnFilter` and calls `onApply`. Position the popover at `rect` (fixed, below the funnel). Full component:

```tsx
import { useEffect, useState } from 'react'
import type { ColumnFilter as CF } from '../core/resultQuery'
import { resultTempName, quoteIdent } from '../core/sql'
import { arrowToRows } from '../core/arrowToRows'
import type { DuckDBClient } from '../db/duckdbClient'

export function ColumnFilter({
  tabId, col, type, client, rect, onApply, onClose,
}: {
  tabId: string; col: string; type: string; client: DuckDBClient
  rect: DOMRect; onApply: (f: CF) => void; onClose: () => void
}) {
  const kind = kindOf(type)
  const [distinct, setDistinct] = useState<string[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [text, setText] = useState(''); const [op, setOp] = useState<'contains' | 'equals' | 'startsWith'>('contains')
  const [min, setMin] = useState(''); const [max, setMax] = useState('')

  useEffect(() => {
    const q = `SELECT DISTINCT ${quoteIdent(col)}::VARCHAR AS v FROM ${quoteIdent(resultTempName(tabId))} LIMIT ${DISTINCT_MAX + 1}`
    void client.query(q).then((t) => {
      const vals = arrowToRows(t).rows.map((r) => String(r.v ?? ''))
      setDistinct(vals.length <= DISTINCT_MAX ? vals : null)
    }).catch(() => setDistinct(null))
  }, [tabId, col, client])

  function applySet() { onApply({ col, type: 'set', values: [...checked] }) }
  function applyTyped() {
    if (kind === 'number') onApply({ col, type: 'number', min: min ? Number(min) : null, max: max ? Number(max) : null })
    else if (kind === 'date') onApply({ col, type: 'date', min: min || null, max: max || null })
    else onApply({ col, type: 'text', op, value: text })
  }

  return (
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div className="col-filter" style={{ top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 260) }}>
        {distinct ? (
          <>
            <div className="cf-list">
              {distinct.map((v) => (
                <label key={v}><input type="checkbox" checked={checked.has(v)}
                  onChange={(e) => { const n = new Set(checked); e.target.checked ? n.add(v) : n.delete(v); setChecked(n) }} />
                  {v === '' ? '∅' : v}</label>
              ))}
            </div>
            <div className="cf-actions"><button onClick={applySet}>применить</button><button onClick={onClose}>отмена</button></div>
          </>
        ) : (
          <>
            {kind === 'text' && (<>
              <select value={op} onChange={(e) => setOp(e.target.value as typeof op)}>
                <option value="contains">содержит</option><option value="equals">равно</option><option value="startsWith">начинается</option>
              </select>
              <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="значение" />
            </>)}
            {(kind === 'number' || kind === 'date') && (<div className="cf-range">
              <input value={min} onChange={(e) => setMin(e.target.value)} placeholder={kind === 'date' ? 'от (YYYY-MM-DD)' : 'мин'} />
              <input value={max} onChange={(e) => setMax(e.target.value)} placeholder={kind === 'date' ? 'до' : 'макс'} />
            </div>)}
            <div className="cf-nulls">
              <button onClick={() => onApply({ col, type: 'null', op: 'isNull' })}>is null</button>
              <button onClick={() => onApply({ col, type: 'null', op: 'notNull' })}>not null</button>
            </div>
            <div className="cf-actions"><button onClick={applyTyped}>применить</button><button onClick={onClose}>отмена</button></div>
          </>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 3: Wire in ResultPanel.** Add state `const [filterCol, setFilterCol] = useState<{ col: string; rect: DOMRect } | null>(null)`; `openFilter(col, rect) = () => setFilterCol({ col, rect })`. Render `{filterCol && tab?.columns && <ColumnFilter tabId={tabId} col={filterCol.col} type={tab.columns.find(c=>c.name===filterCol.col)!.type} client={client} rect={filterCol.rect} onClose={() => setFilterCol(null)} onApply={(f) => { patchView(tabId, { filters: [...view.filters.filter(x => x.col !== f.col), f], page: 1 }); setFilterCol(null) }} />}`. (Replaces the Task-4 stub `openFilter`.)

- [ ] **Step 4: CSS:**
```css
.popover-backdrop { position: fixed; inset: 0; z-index: 40; }
.col-filter { position: fixed; z-index: 41; width: 240px; max-height: 320px; overflow: auto; display: flex; flex-direction: column; gap: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); box-shadow: var(--shadow-card); padding: 10px; }
.col-filter select, .col-filter input { background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 3px 6px; font-size: 12px; }
.cf-list { display: flex; flex-direction: column; gap: 3px; max-height: 200px; overflow: auto; font-size: 12px; }
.cf-list label { display: flex; align-items: center; gap: 6px; color: var(--text-dim); }
.cf-range { display: flex; gap: 6px; }
.cf-nulls, .cf-actions { display: flex; gap: 6px; }
.cf-actions button:first-child { background: var(--accent); color: #15201a; border: 1px solid var(--accent); border-radius: var(--radius-sm); padding: 3px 10px; cursor: pointer; }
.cf-actions button:last-child, .cf-nulls button { background: var(--surface-2); color: var(--text-dim); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 3px 8px; cursor: pointer; }
```

- [ ] **Step 5: Gate, eyeball, commit.** Funnel on a low-card column → checklist; on a numeric column → range; apply → chip + filtered pages + filtered count.

```bash
git add src/components/ColumnFilter.tsx src/components/ResultPanel.tsx src/index.css
git commit -F- <<'EOF'
feat(m8): per-column type-aware filter popover (text/number/date/low-card set)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 8: Chart bounded fetch + cap note (by-eye)

**Files:** Modify `src/components/ResultPanel.tsx` (chart path).

- [ ] **Step 1:** When the chart view is active, fetch a bounded, view-respecting result and plot it:
```ts
import { CHART_CAP } from '../core/resultQuery'
import { buildWhere, buildOrderBy } from '../core/resultQuery'
import { resultTempName } from '../core/sql'
// ...
const [chartData, setChartData] = useState<QueryResult | null>(null)
useEffect(() => {
  if (view0 !== 'chart' || tab?.mode !== 'paged' || !tab.columns) { setChartData(null); return }
  const cols = tab.columns.map((c) => c.name)
  const where = buildWhere(cols, view); const order = buildOrderBy(view.sorts)
  const q = [`SELECT * FROM ${quoteIdent(resultTempName(tabId))}`, where, order, `LIMIT ${CHART_CAP}`].filter(Boolean).join(' ')
  void client.query(q).then((t) => setChartData(arrowToRows(t)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [view0, tabId, tab?.rowCount, view.search, JSON.stringify(view.filters), JSON.stringify(view.sorts)])
```
(`view0` = the existing `view` state var for the table/chart/profile toggle — rename the local to avoid colliding with `tab.view`; use the store's `exploreView`.)

- [ ] **Step 2:** Render the chart from `chartData` (capped) with a note when `rowCount > CHART_CAP`:
```tsx
{showChart && chartData && (<>
  <Chart spec={buildChartSpec(chartData.columns)!} rows={chartData.rows} />
  {(tab?.rowCount ?? 0) > CHART_CAP && (
    <p className="chart-cap-note">график по первым {CHART_CAP} из {tab!.rowCount} строк — агрегируй запросом для полной картины</p>
  )}
</>)}
```
Replace the old `spec`/`result.rows` chart branch. Keep the "нет числовой колонки" behavior via `buildChartSpec(chartData.columns)` being null.

- [ ] **Step 3:** CSS: `.chart-cap-note { color: var(--text-faint); font-size: 11.5px; margin-top: 6px; }`

- [ ] **Step 4: Gate, eyeball, commit.** On a >5000-row result switch to chart → plots first N + note; filters narrow the chart.

```bash
git add src/components/ResultPanel.tsx src/index.css
git commit -F- <<'EOF'
feat(m8): chart plots first N (view-respecting) with a cap note

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 9: Profile reuse (skip re-materialization) — refactor

**Files:** Modify `src/features/useProfileActions.ts` (`profileResult`).

**Interfaces:** unchanged signature; `profileResult` now assumes `run()` already materialized `_qb_result_<tab>` and only materializes if missing.

- [ ] **Step 1:** Change `profileResult` to try profiling the existing table first, materializing only as a fallback:
```ts
async function profileResult(tabId: string, sql: string): Promise<void> {
  const st = useSession.getState()
  const tab = st.tabs.find((t) => t.id === tabId)
  if (!tab || tab.resultProfile) return
  if (!sql.trim()) return
  st.setResultProfiling(tabId, true)
  try {
    // run() already materialized _qb_result_<tab> in M8; materialize only if absent.
    try { await profileRelation(client, resultTempName(tabId)) } catch { await client.exec(buildResultTempDDL(tabId, sql)) }
    const { profiles, rowCount } = await profileRelation(client, resultTempName(tabId))
    useSession.getState().setResultProfile(tabId, profiles, rowCount)
  } catch (e) {
    useSession.getState().setResultProfileError(tabId, String(e))
  }
}
```
(Simpler alternative: always `CREATE OR REPLACE` as today — it is idempotent and cheap. If the two-profileRelation-calls pattern is wasteful, keep the single `buildResultTempDDL` materialize + one `profileRelation` — the net win is that the table is warm. Choose the cheapest: a single existence check `SELECT 1 FROM _qb_result_<tab> LIMIT 1` before deciding.) Keep the existing `useProfileActions.test.ts` green; adjust the assertion if it asserted exec was called (now conditional).

- [ ] **Step 2:** Update `src/features/useProfileActions.test.ts` if it asserts the materialize `exec` call — under the reuse path the table may already exist. Keep a test that a cold profile still works (materializes when absent).

- [ ] **Step 3: Gate + commit.**
```bash
git add src/features/useProfileActions.ts src/features/useProfileActions.test.ts
git commit -F- <<'EOF'
feat(m8): result profile reuses the run()-materialized table

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 10: Export cap on widget tables (TDD + render)

**Files:** Modify `src/features/exportReport.ts` (and `src/core/exportHtml.ts` if the cap note renders there). Test the cap in the existing export test file.

**Interfaces:** exported widget tables render at most `EXPORT_ROW_CAP` rows with a note when truncated.

- [ ] **Step 1:** Add `export const EXPORT_ROW_CAP = 5000` (in `exportReport.ts`). In `renderReport`, after `arrowToRows`, slice rows to the cap and record whether truncated; pass a `truncated`/`total` hint so `buildReportHtml` renders a note under the table. Write a failing unit test asserting: given a result of N > cap rows, the rendered HTML contains only cap rows + the note text (mirror the existing `core/exportHtml.test.ts` structure).

- [ ] **Step 2:** Implement the slice + note. In `exportHtml.buildReportHtml` table branch, when a widget carries `{ truncated: true, total }`, append `<p class="cap">первые {cap} из {total} строк</p>`.

- [ ] **Step 3:** Run the export tests → PASS; full gate.

- [ ] **Step 4: Commit.**
```bash
git add src/features/exportReport.ts src/core/exportHtml.ts src/core/exportHtml.test.ts
git commit -F- <<'EOF'
feat(m8): cap exported widget tables to first N rows with a note

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 11: Copy-as-SQL button (by-eye)

**Files:** Modify `src/components/ResultPanel.tsx`.

- [ ] **Step 1:** Add a «скопировать как SQL» button (shown when `view.sorts.length || view.filters.length || view.search`), using `buildEffectiveSql(tab.sql, columns, view)` and the clipboard:
```tsx
import { buildEffectiveSql } from '../core/resultQuery'
// ...
{tab?.mode === 'paged' && (view.sorts.length > 0 || view.filters.length > 0 || view.search) && (
  <button className="export-btn" title="перенести текущий вид (WHERE/ORDER BY) в SQL"
    onClick={() => {
      const eff = buildEffectiveSql(tab.sql, (tab.columns ?? []).map((c) => c.name), view)
      void navigator.clipboard.writeText(eff)
      setToast('SQL вида скопирован в буфер')
    }}>
    как SQL
  </button>
)}
```

- [ ] **Step 2: Gate, eyeball, commit.** Sort/filter → button appears → click copies a runnable `SELECT * FROM (<sql>) WHERE … ORDER BY …`; paste into a tab, run, pin/mart works.

```bash
git add src/components/ResultPanel.tsx
git commit -F- <<'EOF'
feat(m8): «как SQL» copies the active view (WHERE/ORDER BY) to the clipboard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Self-Review

**Spec coverage:** materialize+count+window (T3) ✓; classic pagination + jump (T5) ✓; sort tri-state/multi (T4) + global search (T6) + per-column typed filters + low-card (T7) ✓; view-layer/editor-untouched + copy-as-SQL (T1/T11) ✓; chart first-N + note (T8) ✓; profile reuse (T9) ✓; export cap (T10) ✓; raw fallback + cleanup + race guard (T3/T2) ✓; testable core `resultQuery.ts` (T1) + store (T2) + integration (T3) ✓.

**Placeholder scan:** UI tasks carry concrete JSX/CSS; logic tasks carry full code. The Task-4 `openFilter` stub is intentional (fleshed out in T7) and noted.

**Type consistency:** `ResultView`/`ColumnFilter`/`SortSpec` (T1) used verbatim by store (T2), actions (T3), grid (T4), filter (T7), chart (T8), copy-as-SQL (T11). `resultTempName`/`buildResultTempDDL`/`buildDropTable` reused from `core/sql.ts`. `client.describeTable` returns `ResultColumn[]` → `tab.columns`. Window/count builders take `(table, columns, view)` consistently.

**Risk notes for the executor:** (1) the latest-wins race guard in T3 is the subtlest part — if `windowSeq` bookkeeping is awkward, use a module `Map<tabId, number>`; the invariant is "a stale response never overwrites a newer view." (2) T4 changes ResultPanel props; keep the `raw`-mode path rendering `tab.window` too so non-SELECT still shows rows. (3) Effects that depend on `view` use `JSON.stringify(sorts/filters)` to avoid identity churn.
