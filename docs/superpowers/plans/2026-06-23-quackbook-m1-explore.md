# M1 «Исследование» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить M0-скелет в полноценный режим «Исследование»: несколько файлов (CSV+Parquet) в одной in-memory DuckDB, схема в рейле с pruning-подсветкой, бленд-табы редакторов, SQL с JOIN/UNION, результат в виртуализированном гриде и на авто-чарте.

**Architecture:** Четыре зоны (`db/` — единственный, кто говорит с DuckDB; `core/` — чистая логика под TDD; `state/` — Zustand-стор сессии; `features/`+`components/` — React UI). Логика (билдеры SQL, имена таблиц, дедуп колонок, pruning, chart-spec, операции стора) пишется TDD-first; презентация (CSS, рендер грида/чарта) — глазами.

**Tech Stack:** React 19 + TS + Vite 8; Vitest 4 (node env); `@duckdb/duckdb-wasm@1.32.0` + `apache-arrow@17.0.0`; raw CodeMirror 6; Observable Plot; `@tanstack/react-virtual`; Zustand 5.

**Источник истины:** `docs/superpowers/specs/2026-06-23-quackbook-m1-explore-design.md`. Ветка: `m1-explore`.

**Сборка двумя срезами:** Срез 1 (Tasks 1–14) — фундамент Explore (один редактор, грид). Срез 2 (Tasks 15–21) — табы, pruning, чарт. После Task 14 — промежуточная проверка `npm run build`/`npm run dev` (деплоя нет: одна ветка, один финиш в конце).

**Каждый коммит заканчивается трейлером:**
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
В примерах коммитов ниже трейлер опущен для краткости — добавляй его всегда.

---

## Контракт сигнатур (единый для всех задач)

Чтобы поздние задачи совпадали с ранними по именам/типам:

```ts
// core/sql.ts
quoteIdent(name: string): string                       // есть
quoteLiteral(value: string): string                    // есть
buildSelectAll(table: string, limit = 100): string     // есть (НЕ менять)
buildSelectStar(table: string): string                 // нов.: `SELECT * FROM "t"`
tableNameFromFilename(fileName: string): string         // нов.
uniqueTableName(desired: string, taken: string[]): string // нов.
buildLoadCsv(virtualFile: string, table: string): string  // нов.
buildLoadParquet(virtualFile: string, table: string): string // нов.
buildDescribe(table: string): string                   // нов.: `DESCRIBE "t"`
buildDropTable(table: string): string                  // нов.: `DROP TABLE IF EXISTS "t"`

// core/arrowToRows.ts
interface ResultColumn { name: string; type: string }            // есть
interface QueryResult { columns: ResultColumn[]; rows: Record<string, unknown>[]; numRows: number } // есть
dedupeColumnNames(names: string[]): string[]           // нов.
arrowToRows(table: Table): QueryResult                 // рефактор (индексное чтение + дедуп)

// core/pruning.ts
detectUsedColumns(sql: string, columns: string[]): string[]   // нов.

// core/chartSpec.ts
isNumericType(type: string): boolean                   // нов.
isTemporalType(type: string): boolean                  // нов.
interface ChartSpec { kind: 'bar' | 'line'; x: string; y: string } // нов.
buildChartSpec(columns: ResultColumn[]): ChartSpec | null         // нов.

// db/duckdbClient.ts (interface DuckDBClient)
registerFile(name: string, data: Uint8Array): Promise<void>      // есть
loadCsvAllVarchar(virtualName: string, tableName: string): Promise<void> // рефактор на buildLoadCsv
loadParquet(virtualName: string, tableName: string): Promise<void>       // нов.
describeTable(tableName: string): Promise<ResultColumn[]>        // нов.
query(sql: string): Promise<Table>                     // есть

// state/session.ts (Zustand useSession)
interface Dataset { table: string; fileName: string; bytes: number; kind: 'csv' | 'parquet'; columns: ResultColumn[] }
interface Tab { id: string; title: string; datasetTable: string | null; sql: string; result: QueryResult | null; meta: { ms: number; rows: number } | null; error: string | null }
// actions: addDataset, setMode, reset, openOrFocusTab(table), openBlankTab,
//          closeTab(id), setActiveTab(id), updateTabSql(id, sql),
//          setTabResult(id, result, meta), setTabError(id, msg)
```

---

# СРЕЗ 1 — Фундамент Explore

## Task 1: Зависимости M1

**Files:**
- Modify: `package.json` (+ `package-lock.json`)

- [ ] **Step 1: Установить зависимости с точными пинами**

Run:
```bash
npm install --save-exact \
  @codemirror/state@6.6.0 \
  @codemirror/view@6.43.1 \
  @codemirror/lang-sql@6.10.0 \
  @codemirror/commands@6.10.3 \
  @codemirror/autocomplete@6.20.3 \
  @codemirror/language@6.12.3 \
  @observablehq/plot@0.6.17 \
  @tanstack/react-virtual@3.14.3 \
  zustand@5
```
(`zustand@5` зарезолвится в текущий 5.x и запинится точно через `--save-exact`.)

- [ ] **Step 2: Дедуп и проверка единственного экземпляра CM6 core**

Run:
```bash
npm dedupe
npm ls @codemirror/state @codemirror/view
```
Expected: по одному экземпляру `@codemirror/state` и `@codemirror/view` (две копии state молча ломают редактор — facets сравниваются по идентичности).

- [ ] **Step 3: Проверка, что сборка и тесты не сломались**

Run:
```bash
npm run build && npm test
```
Expected: build зелёный; тесты M0 (10) зелёные.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add M1 deps (codemirror6, observable-plot, react-virtual, zustand)"
```

---

## Task 2: `core/sql.ts` — имена таблиц из имён файлов

**Files:**
- Modify: `src/core/sql.ts`
- Test: `src/core/sql.test.ts`

- [ ] **Step 1: Дописать падающие тесты**

Добавить в `src/core/sql.test.ts`:
```ts
import {
  buildSelectAll,
  quoteIdent,
  quoteLiteral,
  tableNameFromFilename,
  uniqueTableName,
} from './sql'

describe('tableNameFromFilename', () => {
  it('strips the extension and keeps a clean base name', () => {
    expect(tableNameFromFilename('events.csv')).toBe('events')
    expect(tableNameFromFilename('orders.parquet')).toBe('orders')
  })
  it('replaces invalid identifier chars with underscores', () => {
    expect(tableNameFromFilename('My Data!.csv')).toBe('My_Data_')
  })
  it('prefixes a leading digit so the identifier is valid', () => {
    expect(tableNameFromFilename('2024.csv')).toBe('_2024')
  })
  it('falls back to "table" when nothing usable remains', () => {
    expect(tableNameFromFilename('.csv')).toBe('table')
    expect(tableNameFromFilename('')).toBe('table')
  })
  it('handles names with multiple dots (only last extension stripped)', () => {
    expect(tableNameFromFilename('a.b.csv')).toBe('a_b')
  })
})

describe('uniqueTableName', () => {
  it('returns the desired name when free', () => {
    expect(uniqueTableName('events', [])).toBe('events')
    expect(uniqueTableName('events', ['orders'])).toBe('events')
  })
  it('suffixes on collision', () => {
    expect(uniqueTableName('events', ['events'])).toBe('events_1')
    expect(uniqueTableName('events', ['events', 'events_1'])).toBe('events_2')
  })
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/core/sql.test.ts`
Expected: FAIL — `tableNameFromFilename is not a function`.

- [ ] **Step 3: Реализовать**

Добавить в `src/core/sql.ts`:
```ts
/** Derive a safe SQL identifier from a file name (strip extension, sanitize). */
export function tableNameFromFilename(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '') // strip last extension
  let ident = base.replace(/[^A-Za-z0-9_]/g, '_') // invalid chars -> _
  if (ident === '') return 'table'
  if (/^[0-9]/.test(ident)) ident = `_${ident}` // identifiers cannot start with a digit
  return ident
}

/** Make `desired` unique against `taken` by appending _1, _2, ... */
export function uniqueTableName(desired: string, taken: string[]): string {
  if (!taken.includes(desired)) return desired
  let i = 1
  while (taken.includes(`${desired}_${i}`)) i++
  return `${desired}_${i}`
}
```

- [ ] **Step 4: Запустить — зелёный**

Run: `npx vitest run src/core/sql.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/sql.ts src/core/sql.test.ts
git commit -m "feat(core): derive unique table names from file names"
```

---

## Task 3: `core/sql.ts` — билдеры загрузки/интроспекции

**Files:**
- Modify: `src/core/sql.ts`
- Test: `src/core/sql.test.ts`

- [ ] **Step 1: Дописать падающие тесты**

Добавить в `src/core/sql.test.ts` (импорт расширить):
```ts
import {
  buildDescribe,
  buildDropTable,
  buildLoadCsv,
  buildLoadParquet,
  buildSelectStar,
} from './sql'

describe('buildSelectStar', () => {
  it('builds an unbounded select-star with a quoted ident', () => {
    expect(buildSelectStar('events')).toBe('SELECT * FROM "events"')
    expect(buildSelectStar('we"ird')).toBe('SELECT * FROM "we""ird"')
  })
})

describe('buildLoadCsv', () => {
  it('creates an all-VARCHAR table from a registered CSV', () => {
    expect(buildLoadCsv('events.csv', 'events')).toBe(
      `CREATE OR REPLACE TABLE "events" AS SELECT * FROM read_csv_auto('events.csv', all_varchar = true)`,
    )
  })
})

describe('buildLoadParquet', () => {
  it('creates a table from a registered Parquet file', () => {
    expect(buildLoadParquet('orders.parquet', 'orders')).toBe(
      `CREATE OR REPLACE TABLE "orders" AS SELECT * FROM read_parquet('orders.parquet')`,
    )
  })
})

describe('buildDescribe', () => {
  it('describes a quoted table', () => {
    expect(buildDescribe('events')).toBe('DESCRIBE "events"')
  })
})

describe('buildDropTable', () => {
  it('drops a quoted table if it exists', () => {
    expect(buildDropTable('events')).toBe('DROP TABLE IF EXISTS "events"')
  })
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/core/sql.test.ts`
Expected: FAIL — `buildLoadCsv is not a function`.

- [ ] **Step 3: Реализовать**

Добавить в `src/core/sql.ts`:
```ts
/** `SELECT * FROM <table>` (unbounded) — the seed query for a dataset tab. */
export function buildSelectStar(table: string): string {
  return `SELECT * FROM ${quoteIdent(table)}`
}

/** DDL: materialize a registered CSV as an all-VARCHAR baseline table. */
export function buildLoadCsv(virtualFile: string, table: string): string {
  return `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS SELECT * FROM read_csv_auto(${quoteLiteral(virtualFile)}, all_varchar = true)`
}

/** DDL: materialize a registered Parquet file as a typed table. */
export function buildLoadParquet(virtualFile: string, table: string): string {
  return `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS SELECT * FROM read_parquet(${quoteLiteral(virtualFile)})`
}

/** Introspection: DuckDB DESCRIBE gives DuckDB type names (VARCHAR, DATE, ...). */
export function buildDescribe(table: string): string {
  return `DESCRIBE ${quoteIdent(table)}`
}

/** Reset helper: drop a table if present. */
export function buildDropTable(table: string): string {
  return `DROP TABLE IF EXISTS ${quoteIdent(table)}`
}
```

- [ ] **Step 4: Запустить — зелёный**

Run: `npx vitest run src/core/sql.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/sql.ts src/core/sql.test.ts
git commit -m "feat(core): SQL builders for csv/parquet load, describe, drop, select-star"
```

---

## Task 4: `core/arrowToRows.ts` — дедуп дублей имён колонок

**Files:**
- Modify: `src/core/arrowToRows.ts`
- Test: `src/core/arrowToRows.test.ts`

Контекст: `JOIN` со `SELECT *` может дать две колонки с одним именем (`id`). Текущий `row.toJSON()` схлопывает их (последняя побеждает) → колонка теряется. Чиним: дедуп имён + индексное чтение значений.

- [ ] **Step 1: Дописать падающие тесты**

Добавить в `src/core/arrowToRows.test.ts`:
```ts
import { arrowToRows, dedupeColumnNames } from './arrowToRows'

describe('dedupeColumnNames', () => {
  it('leaves unique names untouched', () => {
    expect(dedupeColumnNames(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })
  it('suffixes repeats in order', () => {
    expect(dedupeColumnNames(['id', 'id', 'x', 'id'])).toEqual([
      'id',
      'id_1',
      'x',
      'id_2',
    ])
  })
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/core/arrowToRows.test.ts`
Expected: FAIL — `dedupeColumnNames is not a function`.

- [ ] **Step 3: Реализовать (дедуп + индексное чтение)**

Заменить содержимое `src/core/arrowToRows.ts` на:
```ts
import type { Table } from 'apache-arrow'

export interface ResultColumn {
  name: string
  type: string
}

export interface QueryResult {
  columns: ResultColumn[]
  rows: Record<string, unknown>[]
  numRows: number
}

/** Disambiguate duplicate column names: ['id','id'] -> ['id','id_1']. */
export function dedupeColumnNames(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((name) => {
    const count = seen.get(name) ?? 0
    seen.set(name, count + 1)
    return count === 0 ? name : `${name}_${count}`
  })
}

/**
 * Shape an Apache Arrow Table into plain column metadata + row objects.
 * Reads values by COLUMN INDEX (not row.toJSON()) so duplicate column names
 * from a JOIN do not collapse — names are deduped to keep every column.
 */
export function arrowToRows(table: Table): QueryResult {
  const fields = table.schema.fields
  const names = dedupeColumnNames(fields.map((f) => f.name))
  const columns = fields.map((f, i) => ({ name: names[i], type: String(f.type) }))
  const vectors = fields.map((_, i) => table.getChildAt(i))
  const rows: Record<string, unknown>[] = []
  for (let r = 0; r < table.numRows; r++) {
    const row: Record<string, unknown> = {}
    for (let c = 0; c < names.length; c++) {
      const v = vectors[c]?.get(r)
      row[names[c]] = v === undefined ? null : v
    }
    rows.push(row)
  }
  return { columns, rows, numRows: table.numRows }
}
```

- [ ] **Step 4: Запустить — зелёный (вкл. существующие тесты)**

Run: `npx vitest run src/core/arrowToRows.test.ts`
Expected: PASS — новые тесты + старые (`country`/`n` строки `{country:'DE', n:12840}`, тип `'Dictionary<Int32, Utf8>'`) проходят без изменений.

- [ ] **Step 5: Commit**

```bash
git add src/core/arrowToRows.ts src/core/arrowToRows.test.ts
git commit -m "fix(core): dedupe duplicate column names; read Arrow by column index"
```

---

## Task 5: `db/duckdbClient.ts` — Parquet, DESCRIBE + smoke-интеграция

**Files:**
- Modify: `src/db/duckdbClient.ts`
- Test: `src/db/duckdbClient.test.ts`

- [ ] **Step 1: Расширить интеграционный тест (падающий)**

Заменить содержимое `src/db/duckdbClient.test.ts` на:
```ts
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { arrowToRows } from '../core/arrowToRows'
import { buildSelectStar } from '../core/sql'
import { createClient, type DuckDBClient } from './duckdbClient'
import { createNodeDuckDB } from './nodeDuckDB'

let db: AsyncDuckDB
let client: DuckDBClient

beforeAll(async () => {
  db = await createNodeDuckDB()
  client = createClient(db)
})

afterAll(async () => {
  await db.terminate()
})

describe('DuckDB client (node integration)', () => {
  it('loads a CSV as an all-VARCHAR table and queries it', async () => {
    const csv = 'country,n\nDE,12840\nPL,9610\n'
    await client.registerFile('events.csv', new TextEncoder().encode(csv))
    await client.loadCsvAllVarchar('events.csv', 'events')

    const result = arrowToRows(await client.query(buildSelectStar('events')))
    expect(result.numRows).toBe(2)
    expect(result.rows).toEqual([
      { country: 'DE', n: '12840' }, // all_varchar => numeric-looking stays a STRING
      { country: 'PL', n: '9610' },
    ])
  })

  it('describes a table with DuckDB type names', async () => {
    const cols = await client.describeTable('events')
    expect(cols.map((c) => c.name)).toEqual(['country', 'n'])
    // all_varchar baseline => both columns are VARCHAR
    expect(cols.every((c) => c.type === 'VARCHAR')).toBe(true)
  })

  it('joins a CSV and a Parquet across one in-memory DB', async () => {
    // Build a tiny Parquet in DuckDB itself, export bytes, re-register it.
    const conn = await db.connect()
    await conn.query(
      `COPY (SELECT 'DE' AS country, 'Germany' AS label) TO 'labels.parquet' (FORMAT parquet)`,
    )
    await conn.close()
    const buf = await db.copyFileToBuffer('labels.parquet')
    await client.registerFile('labels2.parquet', buf)
    await client.loadParquet('labels2.parquet', 'labels')

    const result = arrowToRows(
      await client.query(
        `SELECT e.country, l.label, e.n FROM "events" e JOIN "labels" l ON e.country = l.country`,
      ),
    )
    expect(result.rows).toEqual([{ country: 'DE', label: 'Germany', n: '12840' }])
  })
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/db/duckdbClient.test.ts`
Expected: FAIL — `client.describeTable is not a function` / `client.loadParquet is not a function`.

- [ ] **Step 3: Реализовать (рефактор + новые методы)**

Заменить содержимое `src/db/duckdbClient.ts` на:
```ts
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'
import type { Table } from 'apache-arrow'
import { arrowToRows, type ResultColumn } from '../core/arrowToRows'
import { buildDescribe, buildLoadCsv, buildLoadParquet } from '../core/sql'

export interface DuckDBClient {
  /** Register raw file bytes under a virtual filename DuckDB can read. */
  registerFile(name: string, data: Uint8Array): Promise<void>
  /** Materialize a registered CSV as an all-VARCHAR baseline table. */
  loadCsvAllVarchar(virtualName: string, tableName: string): Promise<void>
  /** Materialize a registered Parquet file as a typed table. */
  loadParquet(virtualName: string, tableName: string): Promise<void>
  /** Column names + DuckDB type names for a loaded table. */
  describeTable(tableName: string): Promise<ResultColumn[]>
  /** Run a query and return the Arrow result table. */
  query(sql: string): Promise<Table>
}

export function createClient(db: AsyncDuckDB): DuckDBClient {
  async function run(sql: string): Promise<Table> {
    const conn = await db.connect()
    try {
      return await conn.query(sql)
    } finally {
      await conn.close()
    }
  }

  return {
    async registerFile(name, data) {
      await db.registerFileBuffer(name, data)
    },
    async loadCsvAllVarchar(virtualName, tableName) {
      await run(buildLoadCsv(virtualName, tableName))
    },
    async loadParquet(virtualName, tableName) {
      await run(buildLoadParquet(virtualName, tableName))
    },
    async describeTable(tableName) {
      const result = arrowToRows(await run(buildDescribe(tableName)))
      return result.rows.map((r) => ({
        name: String(r.column_name),
        type: String(r.column_type),
      }))
    },
    query: run,
  }
}
```

- [ ] **Step 4: Запустить — зелёный**

Run: `npx vitest run src/db/duckdbClient.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 5: Полная проверка типов**

Run: `npm run build`
Expected: зелёный. (`buildSelectAll` ещё используется `App.tsx` M0 — он временно живёт до Task 13; убедись, что `String(f.type)` в `arrowToRows` и новые импорты не дали TS-ошибок.)

- [ ] **Step 6: Commit**

```bash
git add src/db/duckdbClient.ts src/db/duckdbClient.test.ts
git commit -m "feat(db): parquet load + describeTable; csv-cross-parquet join smoke test"
```

---

## Task 6: `state/session.ts` — стор: датасеты, режим, reset

**Files:**
- Create: `src/state/session.ts`
- Test: `src/state/session.test.ts`

- [ ] **Step 1: Падающий тест**

Создать `src/state/session.test.ts`:
```ts
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
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run src/state/session.test.ts`
Expected: FAIL — cannot find module `./session`.

- [ ] **Step 3: Реализовать стор (датасеты/режим/reset + заготовка под табы)**

Создать `src/state/session.ts`:
```ts
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
```

- [ ] **Step 4: Зелёный**

Run: `npx vitest run src/state/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/session.ts src/state/session.test.ts
git commit -m "feat(state): zustand session store (datasets, mode, reset)"
```

---

## Task 7: `state/session.ts` — операции с табами

**Files:**
- Modify: `src/state/session.ts`
- Test: `src/state/session.test.ts`

- [ ] **Step 1: Падающие тесты**

Добавить в `src/state/session.test.ts`:
```ts
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
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run src/state/session.test.ts`
Expected: FAIL — `openOrFocusTab is not a function`.

- [ ] **Step 3: Реализовать действия с табами**

В `src/state/session.ts`: импортировать билдер сид-запроса и расширить интерфейс + действия.

Добавить импорт сверху:
```ts
import { buildSelectStar } from '../core/sql'
```
Добавить сигнатуры в `interface SessionState` (после `reset`):
```ts
  openOrFocusTab: (table: string) => void
  openBlankTab: () => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTabSql: (id: string, sql: string) => void
  setTabResult: (id: string, result: QueryResult, meta: { ms: number; rows: number }) => void
  setTabError: (id: string, message: string) => void
```
Добавить реализацию действий внутрь `create(...)` (рядом с существующими):
```ts
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
```

- [ ] **Step 4: Зелёный**

Run: `npx vitest run src/state/session.test.ts`
Expected: PASS (все тесты Task 6 + Task 7).

- [ ] **Step 5: Commit**

```bash
git add src/state/session.ts src/state/session.test.ts
git commit -m "feat(state): tab actions (open/focus, blank, close, sql, result, error)"
```

---

## Task 8: `components/SqlEditor.tsx` — редактор CodeMirror 6

**Files:**
- Create: `src/components/SqlEditor.tsx`

Презентация/интеграция — проверяется глазами (не юнит-тестом: CM6 требует DOM, node-env его не меряет).

- [ ] **Step 1: Реализовать редактор**

Создать `src/components/SqlEditor.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import { EditorState, Prec } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { sql } from '@codemirror/lang-sql'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'

interface Props {
  value: string
  onChange: (value: string) => void
  onRun: (sql: string) => void
}

export function SqlEditor({ value, onChange, onRun }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Keep latest callbacks in a ref so the mount-once extensions never go stale.
  const cb = useRef({ onChange, onRun })
  cb.current = { onChange, onRun }

  // Mount once. Do NOT depend on `value` (would recreate the editor per keystroke).
  useEffect(() => {
    const runKey = Prec.high(
      keymap.of([
        {
          key: 'Mod-Enter',
          run: (v) => {
            cb.current.onRun(v.state.doc.toString())
            return true // consume: no newline inserted
          },
        },
      ]),
    )
    const listener = EditorView.updateListener.of((u) => {
      if (u.docChanged) cb.current.onChange(u.state.doc.toString())
    })
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        sql(),
        autocompletion(),
        runKey,
        keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap]),
        listener,
      ],
    })
    const v = new EditorView({ state, parent: host.current! })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync external value ONLY when it diverges from the doc (prevents cursor jump).
  useEffect(() => {
    const v = view.current
    if (!v) return
    const current = v.state.doc.toString()
    if (value === current) return
    v.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  return <div className="sql-editor" ref={host} />
}
```

- [ ] **Step 2: Проверка типов**

Run: `npm run build`
Expected: зелёный (компонент компилируется; визуально проверим в Task 13).

- [ ] **Step 3: Commit**

```bash
git add src/components/SqlEditor.tsx
git commit -m "feat(ui): CodeMirror 6 SQL editor with Mod-Enter run"
```

---

## Task 9: `components/ResultGrid.tsx` — виртуализированный грид

**Files:**
- Create: `src/components/ResultGrid.tsx`
- Delete: `src/components/ResultTable.tsx` (заменяется; удаляется в Task 13 при отвязке от App)

- [ ] **Step 1: Реализовать грид (rows-only virtualization)**

Создать `src/components/ResultGrid.tsx`:
```tsx
import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { QueryResult } from '../core/arrowToRows'

const ROW_H = 28
const COL_W = 160

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'bigint') return value.toString()
  return String(value)
}

export function ResultGrid({ result }: { result: QueryResult }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const { columns, rows } = result
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
    useFlushSync: false, // React 19: silence flushSync-in-lifecycle warning
  })
  const gridW = columns.length * COL_W

  return (
    <div className="grid-scroll" ref={parentRef}>
      <div className="grid-head" style={{ width: gridW }}>
        {columns.map((c) => (
          <div
            className="grid-cell grid-th"
            key={c.name}
            style={{ width: COL_W }}
            title={`${c.name}: ${c.type}`}
          >
            {c.name}
          </div>
        ))}
      </div>
      <div
        className="grid-body"
        style={{ height: rowVirtualizer.getTotalSize(), width: gridW }}
      >
        {rowVirtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index]
          return (
            <div
              className="grid-row"
              key={vi.key}
              style={{ transform: `translateY(${vi.start}px)`, width: gridW }}
            >
              {columns.map((c) => {
                const v = row[c.name]
                return (
                  <div
                    className="grid-cell"
                    key={c.name}
                    style={{
                      width: COL_W,
                      textAlign: typeof v === 'number' || typeof v === 'bigint' ? 'right' : 'left',
                    }}
                  >
                    {formatCell(v)}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Проверка типов**

Run: `npm run build`
Expected: зелёный.

- [ ] **Step 3: Commit**

```bash
git add src/components/ResultGrid.tsx
git commit -m "feat(ui): virtualized result grid (rows-only, sticky header)"
```

---

## Task 10: `components/ResultPanel.tsx` — мета + грид (пока только таблица)

**Files:**
- Create: `src/components/ResultPanel.tsx`

В Срезе 1 панель показывает только таблицу + мету и ошибку. Тогл «График» добавится в Срезе 2 (Task 20).

- [ ] **Step 1: Реализовать панель**

Создать `src/components/ResultPanel.tsx`:
```tsx
import type { QueryResult } from '../core/arrowToRows'
import { ResultGrid } from './ResultGrid'

interface Props {
  result: QueryResult | null
  meta: { ms: number; rows: number } | null
  error: string | null
}

export function ResultPanel({ result, meta, error }: Props) {
  return (
    <section className="result-panel">
      <header className="panel-head">
        <span className="panel-title">Результат</span>
        {meta && (
          <span className="panel-meta">
            {meta.rows} строк · {meta.ms.toFixed(1)} мс
          </span>
        )}
      </header>
      {error && <pre className="result-error">{error}</pre>}
      {!error && result && <ResultGrid result={result} />}
      {!error && !result && (
        <p className="result-empty">Запусти запрос (⌘↵), чтобы увидеть строки.</p>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Проверка типов**

Run: `npm run build`
Expected: зелёный.

- [ ] **Step 3: Commit**

```bash
git add src/components/ResultPanel.tsx
git commit -m "feat(ui): result panel (meta + grid + error/empty states)"
```

---

## Task 11: `features/Rail.tsx` — источники + схема (без подсветки)

**Files:**
- Create: `src/features/Rail.tsx`

Подсветка pruning добавится в Срезе 2 (Task 17). Сейчас рейл: список источников (клик → openOrFocusTab) + схема активного датасета.

- [ ] **Step 1: Реализовать рейл**

Создать `src/features/Rail.tsx`:
```tsx
import { useSession } from '../state/session'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}K`
  return `${(n / (1024 * 1024)).toFixed(1)}M`
}

export function Rail() {
  const datasets = useSession((s) => s.datasets)
  const tabs = useSession((s) => s.tabs)
  const activeTabId = useSession((s) => s.activeTabId)
  const openOrFocusTab = useSession((s) => s.openOrFocusTab)

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  const schemaTable = activeTab?.datasetTable ?? datasets[0]?.table ?? null
  const schemaDataset = datasets.find((d) => d.table === schemaTable) ?? null

  return (
    <aside className="rail">
      <div className="rail-section-label">Источники</div>
      <ul className="sources">
        {datasets.map((d) => (
          <li key={d.table}>
            <button
              className={
                d.table === schemaTable ? 'source active' : 'source'
              }
              onClick={() => openOrFocusTab(d.table)}
            >
              <span className="source-kind">{d.kind === 'csv' ? 'csv' : 'pq'}</span>
              <span className="source-name">{d.fileName}</span>
              <span className="source-size">{formatBytes(d.bytes)}</span>
            </button>
          </li>
        ))}
        {datasets.length === 0 && (
          <li className="sources-empty">Брось CSV / Parquet</li>
        )}
      </ul>

      {schemaDataset && (
        <>
          <div className="rail-section-label">
            Схема · {schemaDataset.fileName}
          </div>
          <ul className="schema">
            {schemaDataset.columns.map((c) => (
              <li className="schema-col" key={c.name}>
                <span className="col-name">{c.name}</span>
                <span className="col-type">{c.type}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  )
}
```

- [ ] **Step 2: Проверка типов**

Run: `npm run build`
Expected: зелёный.

- [ ] **Step 3: Commit**

```bash
git add src/features/Rail.tsx
git commit -m "feat(ui): rail with sources list + active-dataset schema"
```

---

## Task 12: Оркестрация загрузки (`loadFiles`)

**Files:**
- Create: `src/features/loadFiles.ts`

> Только новый файл — ничем ещё не импортируется, поэтому сборка остаётся зелёной. Переписывание `CsvDropzone` (ломающее M0-`App.tsx`) сделано атомарно в Task 13 вместе с фиксом.

- [ ] **Step 1: Реализовать оркестрацию загрузки**

Создать `src/features/loadFiles.ts`:
```ts
import { tableNameFromFilename, uniqueTableName } from '../core/sql'
import type { DuckDBClient } from '../db/duckdbClient'
import type { Dataset } from '../state/session'

/**
 * Register + materialize one file as a Dataset. CSV -> all_varchar baseline;
 * Parquet -> native types. Throws on a per-file failure (caller reports it).
 */
export async function loadOneFile(
  client: DuckDBClient,
  file: File,
  takenTableNames: string[],
): Promise<Dataset> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  await client.registerFile(file.name, bytes)
  const kind: Dataset['kind'] = file.name.toLowerCase().endsWith('.parquet')
    ? 'parquet'
    : 'csv'
  const table = uniqueTableName(tableNameFromFilename(file.name), takenTableNames)
  if (kind === 'parquet') await client.loadParquet(file.name, table)
  else await client.loadCsvAllVarchar(file.name, table)
  const columns = await client.describeTable(table)
  return { table, fileName: file.name, bytes: file.size, kind, columns }
}
```

- [ ] **Step 2: Проверка типов**

Run: `npm run build`
Expected: ЗЕЛЁНЫЙ (`loadFiles.ts` ещё не импортируется; M0-`App.tsx` не тронут).

- [ ] **Step 3: Commit**

```bash
git add src/features/loadFiles.ts
git commit -m "feat: load orchestration (register + materialize file -> Dataset)"
```

---

## Task 13: Shell + Explore + Report + переписать App

**Files:**
- Create: `src/features/Shell.tsx`
- Create: `src/features/Explore.tsx`
- Create: `src/features/Report.tsx`
- Modify: `src/components/CsvDropzone.tsx` (CSV → мульти CSV/Parquet; `onFile` → `onFiles`)
- Modify: `src/App.tsx` (полная замена тела)
- Delete: `src/components/ResultTable.tsx`

Это интеграционная задача Среза 1: всё собирается, появляется рабочий цикл «drop → один редактор → Run → грид».

- [ ] **Step 1: Report-заглушка**

Создать `src/features/Report.tsx`:
```tsx
export function Report() {
  return (
    <div className="report-stub">
      Режим «Отчёт» появится в вехе M4.
    </div>
  )
}
```

- [ ] **Step 2: Explore (один активный редактор + панель результата)**

Создать `src/features/Explore.tsx`. В Срезе 1 без полосы табов: показываем активный таб (или подсказку). Полосу табов добавит Task 15.
```tsx
import { useSession } from '../state/session'
import type { DuckDBClient } from '../db/duckdbClient'
import { arrowToRows } from '../core/arrowToRows'
import { SqlEditor } from '../components/SqlEditor'
import { ResultPanel } from '../components/ResultPanel'

export function Explore({ client }: { client: DuckDBClient }) {
  const tabs = useSession((s) => s.tabs)
  const activeTabId = useSession((s) => s.activeTabId)
  const updateTabSql = useSession((s) => s.updateTabSql)
  const setTabResult = useSession((s) => s.setTabResult)
  const setTabError = useSession((s) => s.setTabError)

  const tab = tabs.find((t) => t.id === activeTabId) ?? null

  async function run(sql: string) {
    if (!tab) return
    const t0 = performance.now()
    try {
      const table = await client.query(sql)
      const result = arrowToRows(table)
      setTabResult(tab.id, result, {
        ms: performance.now() - t0,
        rows: result.numRows,
      })
    } catch (e) {
      setTabError(tab.id, String(e))
    }
  }

  if (!tab) {
    return (
      <div className="explore-empty">
        Кликни источник в рейле, чтобы открыть запрос.
      </div>
    )
  }

  return (
    <div className="explore">
      <section className="query-panel">
        <header className="panel-head">
          <span className="panel-title">Запрос</span>
          <button className="run-btn" onClick={() => run(tab.sql)}>
            ▶ запустить
          </button>
        </header>
        <SqlEditor
          key={tab.id}
          value={tab.sql}
          onChange={(v) => updateTabSql(tab.id, v)}
          onRun={run}
        />
      </section>
      <ResultPanel result={tab.result} meta={tab.meta} error={tab.error} />
    </div>
  )
}
```
> Примечание: `key={tab.id}` пересоздаёт `SqlEditor` при смене таба — каждый таб получает свой `EditorView` (изоляция undo/selection), как рекомендовал ресёрч.

- [ ] **Step 3: Shell (топбар, тогл, Reset, dropzone, роутинг режима)**

Создать `src/features/Shell.tsx`:
```tsx
import { useSession } from '../state/session'
import type { DuckDBClient } from '../db/duckdbClient'
import { buildDropTable } from '../core/sql'
import { CsvDropzone } from '../components/CsvDropzone'
import { loadOneFile } from './loadFiles'
import { Explore } from './Explore'
import { Report } from './Report'

export function Shell({ client }: { client: DuckDBClient }) {
  const mode = useSession((s) => s.mode)
  const setMode = useSession((s) => s.setMode)
  const datasets = useSession((s) => s.datasets)
  const addDataset = useSession((s) => s.addDataset)
  const reset = useSession((s) => s.reset)

  async function handleFiles(files: File[]) {
    const taken = useSession.getState().datasets.map((d) => d.table)
    for (const file of files) {
      try {
        const ds = await loadOneFile(client, file, taken)
        taken.push(ds.table)
        addDataset(ds)
      } catch (e) {
        // Per-file failure: surface, keep loading the rest.
        alert(`Не удалось загрузить ${file.name}: ${String(e)}`)
      }
    }
  }

  async function handleReset() {
    for (const d of useSession.getState().datasets) {
      try {
        await client.query(buildDropTable(d.table))
      } catch {
        // ignore — table may already be gone
      }
    }
    reset()
  }

  return (
    <div className="shell">
      <header className="topbar">
        <span className="logo">quackbook</span>
        <nav className="mode-toggle">
          <button
            className={mode === 'explore' ? 'on' : ''}
            onClick={() => setMode('explore')}
          >
            исследование
          </button>
          <button
            className={mode === 'report' ? 'on' : ''}
            onClick={() => setMode('report')}
          >
            отчёт
          </button>
        </nav>
        <div className="topbar-right">
          <span className="pill-local">● local</span>
          <button className="reset-btn" onClick={handleReset}>
            Reset
          </button>
        </div>
      </header>

      <div className="dropzone-bar">
        <CsvDropzone onFiles={handleFiles} />
      </div>

      <main className="workspace">
        {mode === 'explore' ? (
          datasets.length === 0 ? (
            <div className="explore-empty">
              Брось файлы выше, чтобы начать.
            </div>
          ) : (
            <Explore client={client} />
          )
        ) : (
          <Report />
        )}
      </main>
    </div>
  )
}
```
> Рейл подключим в Task 14 вместе со стилями раскладки (чтобы CSS-грид рейл+рабочая область был один цельный кусок). Пока Shell без рейла, источники открываются позже кликом в рейле.

- [ ] **Step 4: Переписать CsvDropzone (мульти-файл CSV/Parquet) + App (лоадер → Shell)**

Сначала заменить содержимое `src/components/CsvDropzone.tsx` на мульти-файловую версию (`onFile` → `onFiles`, приём `.parquet`, `multiple`):
```tsx
import { useRef, useState } from 'react'

interface Props {
  onFiles: (files: File[]) => void
  disabled?: boolean
}

export function CsvDropzone({ onFiles, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  function pick(list: FileList | null) {
    const files = list ? Array.from(list) : []
    if (files.length) onFiles(files)
  }

  return (
    <div
      className={over ? 'dropzone over' : 'dropzone'}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (!disabled) pick(e.dataTransfer.files)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.parquet,text/csv"
        multiple
        hidden
        onChange={(e) => pick(e.target.files)}
      />
      Перетащи CSV / Parquet (можно несколько) или кликни
    </div>
  )
}
```

Затем заменить содержимое `src/App.tsx` на:
```tsx
import { useEffect, useRef, useState } from 'react'
import { getBrowserDuckDB } from './db/browserDuckDB'
import { createClient, type DuckDBClient } from './db/duckdbClient'
import { Shell } from './features/Shell'

type InitState = 'loading' | 'ready' | 'error'

export function App() {
  const [initState, setInitState] = useState<InitState>('loading')
  const [error, setError] = useState<string | null>(null)
  const clientRef = useRef<DuckDBClient | null>(null)

  useEffect(() => {
    let cancelled = false
    getBrowserDuckDB()
      .then((db) => {
        if (cancelled) return
        clientRef.current = createClient(db)
        setInitState('ready')
      })
      .catch((e) => {
        if (cancelled) return
        setError(String(e))
        setInitState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (initState === 'loading')
    return <p className="status boot">Инициализация DuckDB-WASM…</p>
  if (initState === 'error')
    return <p className="status error boot">Ошибка инициализации: {error}</p>
  return <Shell client={clientRef.current!} />
}
```

- [ ] **Step 5: Удалить мёртвый компонент**

Run:
```bash
git rm src/components/ResultTable.tsx
```

- [ ] **Step 6: Проверка типов + сборка**

Run: `npm run build`
Expected: зелёный (M0-`ResultTable` больше не импортируется; `buildSelectAll` теперь не используется приложением, но остаётся как библиотечная функция с тестами — это ок).

- [ ] **Step 7: Тесты**

Run: `npm test`
Expected: все зелёные (логика не тронута).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: shell with mode toggle, multi-file load, single-editor explore"
```

---

## Task 14: Подключить рейл + стили Среза 1, ручная проверка

**Files:**
- Modify: `src/features/Shell.tsx` (вставить `<Rail/>` в раскладку)
- Modify: `src/index.css` (раскладка shell/rail/explore/grid)

- [ ] **Step 1: Вставить рейл в Shell**

В `src/features/Shell.tsx` добавить импорт:
```tsx
import { Rail } from './Rail'
```
Заменить блок `<main className="workspace">…</main>` на раскладку рейл + рабочая область:
```tsx
      <div className="body">
        <Rail />
        <main className="workspace">
          {mode === 'explore' ? (
            datasets.length === 0 ? (
              <div className="explore-empty">
                Брось файлы выше, чтобы начать.
              </div>
            ) : (
              <Explore client={client} />
            )
          ) : (
            <Report />
          )}
        </main>
      </div>
```

- [ ] **Step 2: Стили раскладки (дописать в конец `src/index.css`)**

```css
/* --- M1 shell layout --- */
.shell { display: flex; flex-direction: column; height: 100vh; }
.boot { padding: 28px 22px; }
.topbar {
  display: flex; align-items: center; gap: 18px;
  padding: 10px 16px; border-bottom: 1px solid #1d363b;
}
.logo { font-weight: 700; color: #e3a95c; }
.mode-toggle { display: flex; gap: 4px; background: #11262a; border-radius: 8px; padding: 3px; }
.mode-toggle button {
  border: 0; background: transparent; color: #8da6a2;
  padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 13px;
}
.mode-toggle button.on { background: #1d363b; color: #e9eeea; }
.topbar-right { margin-left: auto; display: flex; align-items: center; gap: 12px; }
.pill-local { color: #6fae8e; font-size: 12px; font-family: ui-monospace, monospace; }
.reset-btn, .run-btn {
  border: 1px solid #34555a; background: #11262a; color: #e9eeea;
  padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 13px;
}
.run-btn { background: #e3a95c; color: #15201a; border-color: #e3a95c; font-weight: 600; }
.dropzone-bar { padding: 10px 16px; }
.dropzone-bar .dropzone { margin: 0; padding: 14px; }
.body { display: flex; flex: 1; min-height: 0; }
.rail {
  width: 260px; flex: 0 0 260px; border-right: 1px solid #1d363b;
  padding: 14px; overflow: auto;
}
.rail-section-label {
  text-transform: uppercase; font-size: 10.5px; letter-spacing: .06em;
  color: #5c7975; margin: 14px 0 8px;
}
.sources { list-style: none; padding: 0; margin: 0; }
.source {
  display: flex; align-items: center; gap: 8px; width: 100%;
  border: 0; background: transparent; color: #c8d6d2; cursor: pointer;
  padding: 7px 8px; border-radius: 6px; text-align: left; font-size: 13px;
}
.source.active, .source:hover { background: #11262a; }
.source-kind { font-size: 9px; text-transform: uppercase; color: #5c7975; }
.source-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-size { color: #5c7975; font-size: 11px; }
.sources-empty, .explore-empty, .result-empty, .report-stub {
  color: #5c7975; font-size: 13px; padding: 10px 8px;
}
.schema { list-style: none; padding: 0; margin: 0; }
.schema-col {
  display: flex; justify-content: space-between; gap: 8px;
  padding: 5px 8px; font-size: 12.5px; font-family: ui-monospace, monospace;
}
.col-name { color: #c8d6d2; }
.col-type { color: #5c7975; font-size: 10.5px; }
.workspace { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 16px; gap: 16px; overflow: auto; }
.explore { display: flex; flex-direction: column; gap: 16px; min-height: 0; flex: 1; }
.panel-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.panel-title { font-weight: 600; font-size: 14px; }
.panel-meta { margin-left: auto; color: #8da6a2; font-size: 12px; font-family: ui-monospace, monospace; }
.query-panel .sql-editor {
  border: 1px solid #1d363b; border-radius: 8px; overflow: hidden;
}
.cm-editor { font-size: 13px; }
.result-error {
  color: #e8826a; background: #20100e; border: 1px solid #4a2018;
  border-radius: 8px; padding: 12px; white-space: pre-wrap; font-size: 12.5px;
}
/* grid */
.grid-scroll {
  flex: 1; min-height: 200px; overflow: auto; position: relative;
  border: 1px solid #1d363b; border-radius: 8px;
}
.grid-head {
  position: sticky; top: 0; z-index: 1; display: flex; background: #0d1c1f;
}
.grid-body { position: relative; }
.grid-row { position: absolute; top: 0; left: 0; height: 28px; display: flex; }
.grid-cell {
  flex: 0 0 auto; height: 28px; line-height: 28px; padding: 0 10px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: ui-monospace, monospace; font-size: 12.5px;
  border-bottom: 1px solid #122a2e;
}
.grid-th { color: #5c7975; text-transform: uppercase; font-size: 10.5px; }
```

- [ ] **Step 3: Ручная проверка (глазами)**

Run: `npm run dev`
Проверить в браузере:
1. Лоадер → пустое состояние с подсказкой.
2. Брось 2 файла (CSV и/или второй CSV). В рейле — источники + схема (CSV → все `VARCHAR`).
3. Клик по источнику → открывается запрос `SELECT * FROM "..."`, активная схема в рейле.
4. Напиши запрос с `JOIN`/`GROUP BY`, нажми ▶ или ⌘↵ → грид со строками, мета «N строк · X мс».
5. Reset → всё чисто.
6. Тогл «отчёт» → заглушка; «исследование» → назад.

- [ ] **Step 4: Сборка + тесты**

Run: `npm run build && npm test`
Expected: оба зелёные.

- [ ] **Step 5: Commit (конец Среза 1)**

```bash
git add -A
git commit -m "feat(ui): rail wired into shell + M1 layout styles (slice 1 done)"
```

---

# СРЕЗ 2 — Табы, pruning, чарт

## Task 15: `components/TabStrip.tsx` + полоса табов в Explore

**Files:**
- Create: `src/components/TabStrip.tsx`
- Modify: `src/features/Explore.tsx`

- [ ] **Step 1: Полоса табов**

Создать `src/components/TabStrip.tsx`:
```tsx
import { useSession } from '../state/session'

export function TabStrip() {
  const tabs = useSession((s) => s.tabs)
  const activeTabId = useSession((s) => s.activeTabId)
  const setActiveTab = useSession((s) => s.setActiveTab)
  const closeTab = useSession((s) => s.closeTab)
  const openBlankTab = useSession((s) => s.openBlankTab)

  return (
    <div className="tab-strip">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={t.id === activeTabId ? 'tab on' : 'tab'}
          onClick={() => setActiveTab(t.id)}
        >
          <span className="tab-title">{t.title}</span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation()
              closeTab(t.id)
            }}
            aria-label="закрыть таб"
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-add" onClick={() => openBlankTab()} aria-label="новый таб">
        +
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Вставить полосу в Explore**

В `src/features/Explore.tsx` добавить импорт:
```tsx
import { TabStrip } from '../components/TabStrip'
```
И вставить `<TabStrip />` первой строкой внутри корневого `<div className="explore">` (перед `<section className="query-panel">`). Также заменить раннюю заглушку `if (!tab)` так, чтобы полоса табов была видна даже без активного таба:
```tsx
  if (!tab) {
    return (
      <div className="explore">
        <TabStrip />
        <div className="explore-empty">
          Открой источник в рейле или нажми «+» для пустого запроса.
        </div>
      </div>
    )
  }
```

- [ ] **Step 3: Стили полосы (дописать в `src/index.css`)**

```css
.tab-strip { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.tab {
  display: flex; align-items: center; gap: 6px; cursor: pointer;
  background: #11262a; color: #8da6a2; border: 1px solid #1d363b;
  border-radius: 6px; padding: 4px 6px 4px 10px; font-size: 12.5px;
}
.tab.on { background: #1d363b; color: #e9eeea; }
.tab-close, .tab-add {
  border: 0; background: transparent; color: #5c7975; cursor: pointer;
  font-size: 14px; line-height: 1; padding: 2px 5px; border-radius: 4px;
}
.tab-close:hover { color: #e8826a; }
.tab-add { border: 1px solid #1d363b; background: #11262a; }
```

- [ ] **Step 4: Ручная проверка + сборка**

Run: `npm run dev` (несколько источников → несколько табов; «+» добавляет «Запрос N»; × закрывает; переключение сохраняет SQL и результат каждого таба), затем `npm run build`.
Expected: работает; build зелёный.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): blend tab strip (open/focus, blank +, close)"
```

---

## Task 16: `core/pruning.ts` — какие колонки читает запрос

**Files:**
- Create: `src/core/pruning.ts`
- Test: `src/core/pruning.test.ts`

Эвристика (не полный SQL-парсер): по токенам-идентификаторам. `SELECT *` / `t.*` → все колонки; `count(*)` — НЕ все. Регистронезависимо.

- [ ] **Step 1: Падающие тесты**

Создать `src/core/pruning.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { detectUsedColumns } from './pruning'

const cols = ['user_id', 'country', 'zip', 'signup', 'revenue']

describe('detectUsedColumns', () => {
  it('SELECT * uses all columns', () => {
    expect(detectUsedColumns('SELECT * FROM events', cols).sort()).toEqual(
      [...cols].sort(),
    )
  })
  it('qualified star (t.*) uses all columns', () => {
    expect(
      detectUsedColumns('SELECT e.* FROM events e', cols).sort(),
    ).toEqual([...cols].sort())
  })
  it('count(*) does NOT count as all-columns', () => {
    expect(
      detectUsedColumns(
        'SELECT country, count(*) AS n FROM events GROUP BY 1 ORDER BY n DESC',
        cols,
      ),
    ).toEqual(['country'])
  })
  it('matches qualified and unqualified column tokens', () => {
    expect(
      detectUsedColumns(
        'SELECT e.user_id, revenue FROM events e',
        cols,
      ).sort(),
    ).toEqual(['revenue', 'user_id'])
  })
  it('ignores unknown identifiers', () => {
    expect(detectUsedColumns('SELECT total FROM orders', cols)).toEqual([])
  })
  it('is case-insensitive', () => {
    expect(detectUsedColumns('select COUNTRY from events', cols)).toEqual([
      'country',
    ])
  })
})
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run src/core/pruning.test.ts`
Expected: FAIL — cannot find module `./pruning`.

- [ ] **Step 3: Реализовать**

Создать `src/core/pruning.ts`:
```ts
/**
 * Heuristic: which of `columns` does `sql` read? Identifier-token match, not a
 * full SQL parser — false positives on aliases/literals are acceptable for a
 * rail highlight. `SELECT *` / `t.*` => all columns; `count(*)` => not all.
 */
export function detectUsedColumns(sql: string, columns: string[]): string[] {
  // A select-star is a `*` whose previous non-space char is not '(' (so
  // count(*) is excluded). `e.*` qualifies too (prev char '.').
  let star = false
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] !== '*') continue
    let j = i - 1
    while (j >= 0 && /\s/.test(sql[j])) j--
    if (sql[j] !== '(') {
      star = true
      break
    }
  }
  if (star) return [...columns]

  const tokens = new Set(
    (sql.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? []),
  )
  return columns.filter((c) => tokens.has(c.toLowerCase()))
}
```

- [ ] **Step 4: Зелёный**

Run: `npx vitest run src/core/pruning.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/pruning.ts src/core/pruning.test.ts
git commit -m "feat(core): heuristic used-column detection for pruning highlight"
```

---

## Task 17: Подсветка pruning в рейле

**Files:**
- Modify: `src/features/Rail.tsx`

- [ ] **Step 1: Подсветить читаемые колонки + счётчик**

В `src/features/Rail.tsx` добавить импорт:
```tsx
import { detectUsedColumns } from '../core/pruning'
```
Внутри `Rail`, после вычисления `schemaDataset`, добавить:
```tsx
  const used =
    schemaDataset && activeTab
      ? new Set(
          detectUsedColumns(
            activeTab.sql,
            schemaDataset.columns.map((c) => c.name),
          ),
        )
      : new Set<string>()
```
Заменить рендер `schema`-списка на версию с подсветкой + хвостовой подписью:
```tsx
          <ul className="schema">
            {schemaDataset.columns.map((c) => (
              <li
                className={used.has(c.name) ? 'schema-col used' : 'schema-col'}
                key={c.name}
              >
                <span className="col-name">{c.name}</span>
                <span className="col-type">{c.type}</span>
              </li>
            ))}
          </ul>
          <p className="rail-note">
            ▸ подсвечены колонки, которые читает текущий запрос (
            {used.size} / {schemaDataset.columns.length})
          </p>
```

- [ ] **Step 2: Стили подсветки (дописать в `src/index.css`)**

```css
.schema-col { opacity: .45; }
.schema-col.used { opacity: 1; }
.schema-col.used .col-name { color: #e9eeea; }
.rail-note { color: #5c7975; font-size: 11px; margin-top: 10px; line-height: 1.4; }
```

- [ ] **Step 3: Ручная проверка + сборка**

Run: `npm run dev` (запрос `SELECT country, count(*) FROM events GROUP BY 1` → подсвечена только `country`, счётчик `1 / N`; `SELECT *` → все), затем `npm run build`.
Expected: подсветка следует запросу; build зелёный.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): rail pruning highlight follows the active query"
```

---

## Task 18: `core/chartSpec.ts` — авто-выбор осей/типа

**Files:**
- Create: `src/core/chartSpec.ts`
- Test: `src/core/chartSpec.test.ts`

- [ ] **Step 1: Падающие тесты**

Создать `src/core/chartSpec.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { buildChartSpec, isNumericType, isTemporalType } from './chartSpec'

describe('type predicates', () => {
  it('recognizes numeric Arrow types', () => {
    expect(isNumericType('Int64')).toBe(true)
    expect(isNumericType('Float64')).toBe(true)
    expect(isNumericType('Decimal<18, 3>')).toBe(true)
    expect(isNumericType('Utf8')).toBe(false)
    // dictionary-of-strings is categorical, NOT numeric
    expect(isNumericType('Dictionary<Int32, Utf8>')).toBe(false)
  })
  it('recognizes temporal Arrow types', () => {
    expect(isTemporalType('Date32<DAY>')).toBe(true)
    expect(isTemporalType('Timestamp<MICROSECOND>')).toBe(true)
    expect(isTemporalType('Utf8')).toBe(false)
  })
})

describe('buildChartSpec', () => {
  it('picks first non-numeric as X, first numeric as Y, bar by default', () => {
    expect(
      buildChartSpec([
        { name: 'country', type: 'Utf8' },
        { name: 'n', type: 'Int64' },
      ]),
    ).toEqual({ kind: 'bar', x: 'country', y: 'n' })
  })
  it('uses line when X is temporal', () => {
    expect(
      buildChartSpec([
        { name: 'm', type: 'Date32<DAY>' },
        { name: 'arpu', type: 'Float64' },
      ]),
    ).toEqual({ kind: 'line', x: 'm', y: 'arpu' })
  })
  it('returns null when there is no numeric column', () => {
    expect(
      buildChartSpec([
        { name: 'a', type: 'Utf8' },
        { name: 'b', type: 'Utf8' },
      ]),
    ).toBeNull()
  })
  it('returns null when there is no non-numeric column for X', () => {
    expect(
      buildChartSpec([{ name: 'n', type: 'Int64' }]),
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run src/core/chartSpec.test.ts`
Expected: FAIL — cannot find module `./chartSpec`.

- [ ] **Step 3: Реализовать**

Создать `src/core/chartSpec.ts`:
```ts
import type { ResultColumn } from './arrowToRows'

/** Numeric Arrow type label (not dictionary-of-strings). */
export function isNumericType(type: string): boolean {
  return /^(Int|Uint|Float|Decimal)/.test(type)
}

/** Date/time Arrow type label. */
export function isTemporalType(type: string): boolean {
  return /^(Date|Timestamp|Time)/.test(type)
}

export interface ChartSpec {
  kind: 'bar' | 'line'
  x: string
  y: string
}

/**
 * Auto-pick a simple chart: first non-numeric column => X (category),
 * first numeric column => Y. Line if X is temporal, else bar.
 * Null if there is no numeric column or no non-numeric column.
 */
export function buildChartSpec(columns: ResultColumn[]): ChartSpec | null {
  const x = columns.find((c) => !isNumericType(c.type))
  const y = columns.find((c) => isNumericType(c.type))
  if (!x || !y) return null
  return { kind: isTemporalType(x.type) ? 'line' : 'bar', x: x.name, y: y.name }
}
```

- [ ] **Step 4: Зелёный**

Run: `npx vitest run src/core/chartSpec.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/chartSpec.ts src/core/chartSpec.test.ts
git commit -m "feat(core): auto chart-spec (x/y/kind inference from column types)"
```

---

## Task 19: `components/Chart.tsx` — рендер через Observable Plot

**Files:**
- Create: `src/components/Chart.tsx`

Граница чарт-либы. Презентация — глазами.

- [ ] **Step 1: Реализовать `<Chart>`**

Создать `src/components/Chart.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import * as Plot from '@observablehq/plot'
import type { ChartSpec } from '../core/chartSpec'

interface Props {
  spec: ChartSpec
  rows: Record<string, unknown>[]
}

export function Chart({ spec, rows }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const mark =
      spec.kind === 'bar'
        ? Plot.barY(rows, { x: spec.x, y: spec.y, sort: { x: '-y' } })
        : Plot.lineY(rows, { x: spec.x, y: spec.y })
    const fig = Plot.plot({
      marks: [mark, Plot.ruleY([0])],
      x: { label: spec.x },
      y: { label: spec.y, grid: true },
      height: 280,
      marginLeft: 56,
      style: { background: 'transparent', color: '#c8d6d2' },
    })
    el.replaceChildren(fig)
    return () => fig.remove() // avoid leaking SVG nodes
  }, [spec, rows])
  return <div className="chart" ref={ref} />
}
```

- [ ] **Step 2: Проверка типов**

Run: `npm run build`
Expected: зелёный.

- [ ] **Step 3: Commit**

```bash
git add src/components/Chart.tsx
git commit -m "feat(ui): Chart component (Observable Plot bar/line)"
```

---

## Task 20: Тогл Таблица/График в панели результата

**Files:**
- Modify: `src/components/ResultPanel.tsx`

- [ ] **Step 1: Добавить тогл + рендер чарта**

Заменить содержимое `src/components/ResultPanel.tsx` на:
```tsx
import { useState } from 'react'
import type { QueryResult } from '../core/arrowToRows'
import { buildChartSpec } from '../core/chartSpec'
import { ResultGrid } from './ResultGrid'
import { Chart } from './Chart'

interface Props {
  result: QueryResult | null
  meta: { ms: number; rows: number } | null
  error: string | null
}

export function ResultPanel({ result, meta, error }: Props) {
  const [view, setView] = useState<'table' | 'chart'>('table')
  const spec = result ? buildChartSpec(result.columns) : null
  const showChart = view === 'chart' && spec && result

  return (
    <section className="result-panel">
      <header className="panel-head">
        <span className="panel-title">Результат</span>
        {meta && (
          <span className="panel-meta">
            {meta.rows} строк · {meta.ms.toFixed(1)} мс
          </span>
        )}
        {result && (
          <div className="view-toggle">
            <button
              className={view === 'table' ? 'on' : ''}
              onClick={() => setView('table')}
            >
              таблица
            </button>
            <button
              className={view === 'chart' ? 'on' : ''}
              disabled={!spec}
              title={spec ? '' : 'нет числовой колонки для графика'}
              onClick={() => setView('chart')}
            >
              график
            </button>
          </div>
        )}
      </header>
      {error && <pre className="result-error">{error}</pre>}
      {!error && showChart && <Chart spec={spec!} rows={result!.rows} />}
      {!error && result && !showChart && <ResultGrid result={result} />}
      {!error && !result && (
        <p className="result-empty">Запусти запрос (⌘↵), чтобы увидеть строки.</p>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Стили тогла + чарта (дописать в `src/index.css`)**

```css
.view-toggle { display: flex; gap: 2px; background: #11262a; border-radius: 7px; padding: 3px; }
.view-toggle button {
  border: 0; background: transparent; color: #8da6a2; cursor: pointer;
  padding: 4px 10px; border-radius: 5px; font-size: 12px;
}
.view-toggle button.on { background: #1d363b; color: #e9eeea; }
.view-toggle button:disabled { opacity: .4; cursor: not-allowed; }
.chart { padding: 8px 4px; }
```

- [ ] **Step 3: Ручная проверка**

Run: `npm run dev`
Проверить: `SELECT country, count(*) AS n FROM events GROUP BY 1 ORDER BY n DESC` → тогл «график» активен, bar-чарт; `SELECT *` по all_varchar CSV → «график» выключен (нет числовой колонки); тогл переключает таблица↔график.

- [ ] **Step 4: Сборка + тесты**

Run: `npm run build && npm test`
Expected: оба зелёные.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): table/chart toggle with auto bar/line chart"
```

---

## Task 21: Финальная проверка вехи M1

**Files:** —

- [ ] **Step 1: Полный прогон**

Run:
```bash
npm run lint && npm run build && npm test
```
Expected: lint 0 ошибок; build зелёный (DuckDB-бандлы в `dist/assets/`); все тесты зелёные (core/sql, arrowToRows, pruning, chartSpec, state/session, db smoke).

- [ ] **Step 2: Сквозная ручная приёмка (критерий вехи)**

Run: `npm run dev`. Сценарий:
1. Лоадер → пусто.
2. Брось CSV + Parquet → оба в рейле, у Parquet родные типы, у CSV — `VARCHAR`.
3. Открой табы по обоим источникам; «+» добавляет пустой «Запрос N».
4. В пустом табе напиши `JOIN` между двумя таблицами → грид со строками, мета.
5. Рейл подсвечивает читаемые колонки активного запроса (счётчик `k / N`).
6. Агрегирующий запрос → тогл «график» → bar/line.
7. Reset → всё чисто, пустое состояние.
8. Hard-reload → пустое состояние (таблицы испаряются — ожидаемо).

- [ ] **Step 3: Завершение ветки**

Перейти к **superpowers:finishing-a-development-branch** (тесты зелёные → опции merge/PR). Это смерджит `m1-explore` в `main` и триггерит деплой на Pages.

---

## Покрытие спека (self-review)

- Shell/тогл/local/Reset → Tasks 13, 14. ✓
- Rail источники+схема (DuckDB-типы через DESCRIBE) → Tasks 5, 11. ✓
- Бленд-табы (open/focus, blank «+», close) → Tasks 7, 15. ✓
- CM6-редактор + ⌘↵ → Task 8. ✓
- Виртуализированный грид + мета → Tasks 9, 10. ✓
- Мульти-файл CSV+Parquet + JOIN/UNION → Tasks 5, 12. ✓
- Pruning-подсветка → Tasks 16, 17. ✓
- Авто-чарт (bar/line, отключён без числовой колонки) → Tasks 18, 19, 20. ✓
- Zustand-стор → Tasks 6, 7. ✓
- Дедуп дублей колонок (JOIN) → Task 4. ✓
- Имена таблиц из файлов + коллизии → Task 2. ✓
- Обработка ошибок (SQL → панель; per-file load) → Tasks 12, 13. ✓
- TDD на всей логике core/state; db smoke; презентация глазами → по задачам. ✓
- Отложено (типы/профиль/закрепить/сохранить/автокомплит) — не строим. ✓
