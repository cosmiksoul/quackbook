# quackbook M0 — Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a deployed Vite + React + TypeScript app that boots single-threaded DuckDB-WASM in a Web Worker, lets the user drop one CSV, registers it as an all-VARCHAR table, runs `SELECT * FROM t LIMIT n`, and renders the rows — with the data-layer logic under TDD and a GitHub Pages CI deploy.

**Architecture:** Three zones, mirroring the delivery spec. `core/` holds pure, TDD-covered functions (SQL builders, Arrow→rows shaping). `db/` wraps DuckDB-WASM: a browser instantiation (self-hosted bundles, single-thread, singleton) and a Node instantiation used only by the integration smoke test, both fronted by one `createClient` wrapper. `App` + `components/` are React UI (eye-tested), driving a `loading → ready → error` init state machine. In-memory only — reload yields empty state (no persistence; OPFS is firewalled to v1.5).

**Tech Stack:** Vite 8 + React 19 + TypeScript 6, Vitest 4 (node environment), `@duckdb/duckdb-wasm@1.32.0` + `apache-arrow@17.0.0` (exact pins), GitHub Actions → GitHub Pages.

---

## Pre-flight notes (read before Task 1)

- **Version pins are load-bearing.** Pin `@duckdb/duckdb-wasm` to **exactly `1.32.0`** — the npm `latest` dist-tag is a `-dev` prerelease (`1.33.1-dev57.0`) and `1.33.0` is not published. Pin `apache-arrow` to **exactly `17.0.0`** — duckdb-wasm 1.32.0 requires `^17.0.0`, `17.0.0` is the only 17.x release, and a transitive Arrow 21.x breaks `.toArray()/.toJSON()`. After install, run `npm ls apache-arrow` and confirm a **single** deduped copy.
- **`1.5.4` vs `1.32.0` is not a conflict.** `1.5.4` (CLAUDE.md/scope, per duckdb.org) is the embedded DuckDB **engine** version; `1.32.0` is the **npm package** version. Pin the npm package to `1.32.0`. Recommend (separately) clarifying both in CLAUDE.md; do not delete the `1.5.4` reference.
- **Single-thread on Pages needs no headers.** Use a `MANUAL_BUNDLES` with only `mvp` + `eh` (omit `coi`); `selectBundle` can then never pick the threaded bundle, so no COOP/COEP is required — which is exactly what GitHub Pages (no custom headers) can serve.
- **Node version:** Vite 8 requires Node `^20.19.0 || >=22.12.0`. Use Node 22 locally and in CI.
- **Repo name = Pages base.** `vite.config.ts` sets `base: '/quackbook/'` for production. If the GitHub repository is not named `quackbook`, change `REPO` accordingly, or the deployed page is blank with 404s on assets.
- **Vitest scope at M0:** all tests are pure/node (`*.test.ts`), so the config uses the **node** environment only. No jsdom / `@testing-library` yet — those arrive in M1 with the first React state test.

---

## Task 1: Scaffold project, pin dependencies, write config

**Files:**
- Create: `package.json`, `.nvmrc`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `eslint.config.js`, `.prettierrc.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/vite-env.d.ts`, `.gitignore`

- [ ] **Step 1: Scaffold the Vite react-ts template into a temp dir and copy it in**

The repo already contains files (CLAUDE.md, docs/, README.md). Scaffold into a sibling temp folder, then copy the generated app files in without clobbering existing docs.

Run:
```bash
npm create vite@latest .quackbook-scaffold -- --template react-ts
```
Then copy `index.html`, `src/`, `public/` (if present), and `tsconfig*.json` from `.quackbook-scaffold/` into the repo root, and delete `.quackbook-scaffold/`. (The files below overwrite the key ones — generated `src/App.tsx`, `src/App.css`, `src/assets/` may be deleted; we author our own.)

- [ ] **Step 2: Write `package.json`** (exact pins; M0-minimal dependency set)

```json
{
  "name": "quackbook",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "engines": {
    "node": "^20.19.0 || >=22.12.0"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "format": "prettier --write ."
  },
  "dependencies": {
    "react": "19.2.7",
    "react-dom": "19.2.7",
    "@duckdb/duckdb-wasm": "1.32.0",
    "apache-arrow": "17.0.0"
  },
  "devDependencies": {
    "vite": "8.0.16",
    "@vitejs/plugin-react": "6.0.2",
    "typescript": "6.0.3",
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.3",
    "vitest": "4.1.9",
    "eslint": "10.5.0",
    "@eslint/js": "10.0.1",
    "typescript-eslint": "8.62.0",
    "eslint-plugin-react-hooks": "7.1.1",
    "eslint-plugin-react-refresh": "0.5.3",
    "globals": "17.7.0",
    "prettier": "3.8.4"
  }
}
```

- [ ] **Step 3: Write `.nvmrc`**

```
22
```

- [ ] **Step 4: Write `vite.config.ts`** (base, react, duckdb exclude, vitest node config — one file)

```typescript
/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// GitHub Pages PROJECT page is served under https://<user>.github.io/quackbook/
// so the production base must be '/quackbook/'. The dev server stays at '/'.
// Change REPO if the GitHub repository has a different name.
const REPO = 'quackbook'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? `/${REPO}/` : '/',
  plugins: [react()],
  // REQUIRED: keep DuckDB out of dep pre-bundling so Vite resolves the raw
  // worker/.wasm files referenced via ?url imports.
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
  test: {
    // M0: every test is pure/node (core/ + db/ integration). No jsdom yet.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // duckdb-node.cjs is CommonJS; inline it so Vitest transforms it
    // consistently instead of externalizing.
    server: { deps: { inline: ['@duckdb/duckdb-wasm'] } },
  },
}))
```

- [ ] **Step 5: Write the three tsconfig files**

`tsconfig.json`:
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

`tsconfig.app.json`:
```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src"]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 6: Write `eslint.config.js`** (flat config)

```javascript
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
)
```

- [ ] **Step 7: Write `.prettierrc.json`**

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 80
}
```

- [ ] **Step 8: Write `src/vite-env.d.ts`** (gives `?url` import types)

```typescript
/// <reference types="vite/client" />
```

- [ ] **Step 9: Write `index.html`**

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>quackbook</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 10: Write `src/main.tsx` and a minimal `src/App.tsx` placeholder + `src/index.css`**

`src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`src/App.tsx` (placeholder — replaced in Task 6):
```tsx
export function App() {
  return <main className="app">quackbook</main>
}
```

`src/index.css`:
```css
:root {
  font-family: system-ui, sans-serif;
  color-scheme: dark;
}
body {
  margin: 0;
  background: #0f1e21;
  color: #e9eeea;
}
.app {
  max-width: 1100px;
  margin: 0 auto;
  padding: 28px 22px;
}
```

- [ ] **Step 11: Write `.gitignore`** (Vite defaults)

```
node_modules
dist
*.local
.DS_Store
node_modules/.tmp
```

- [ ] **Step 12: Install and verify build + lint**

Run:
```bash
npm install
npm ls apache-arrow
npm run build
npm run lint
```
Expected: `npm ls apache-arrow` shows a single `apache-arrow@17.0.0`. `npm run build` completes and emits `dist/`. `npm run lint` reports no errors.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite+React+TS, pin deps, base config"
```

---

## Task 2: `core/sql.ts` — SQL string builders (TDD)

**Files:**
- Create: `src/core/sql.ts`
- Test: `src/core/sql.test.ts`

- [ ] **Step 1: Write the failing test**

`src/core/sql.test.ts`:
```typescript
import { describe, expect, it } from 'vitest'
import { buildSelectAll, quoteIdent, quoteLiteral } from './sql'

describe('quoteIdent', () => {
  it('double-quotes an identifier', () => {
    expect(quoteIdent('events')).toBe('"events"')
  })
  it('escapes embedded double-quotes', () => {
    expect(quoteIdent('we"ird')).toBe('"we""ird"')
  })
})

describe('quoteLiteral', () => {
  it('single-quotes a string literal', () => {
    expect(quoteLiteral('events.csv')).toBe("'events.csv'")
  })
  it('escapes embedded single-quotes', () => {
    expect(quoteLiteral("o'brien.csv")).toBe("'o''brien.csv'")
  })
})

describe('buildSelectAll', () => {
  it('builds a select-all with default limit 100', () => {
    expect(buildSelectAll('events')).toBe('SELECT * FROM "events" LIMIT 100')
  })
  it('honors an explicit limit', () => {
    expect(buildSelectAll('events', 5)).toBe('SELECT * FROM "events" LIMIT 5')
  })
  it('quotes the table identifier', () => {
    expect(buildSelectAll('we"ird')).toBe('SELECT * FROM "we""ird" LIMIT 100')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/core/sql.test.ts`
Expected: FAIL — cannot resolve `./sql` / functions not defined.

- [ ] **Step 3: Write minimal implementation**

`src/core/sql.ts`:
```typescript
/** Quote a SQL identifier (double-quote, escaping embedded double-quotes). */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** Quote a SQL string literal (single-quote, escaping embedded single-quotes). */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** Build `SELECT * FROM <table> LIMIT <limit>`; table identifier is quoted. */
export function buildSelectAll(table: string, limit = 100): string {
  return `SELECT * FROM ${quoteIdent(table)} LIMIT ${limit}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/core/sql.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/sql.ts src/core/sql.test.ts
git commit -m "feat(core): SQL identifier/literal quoting + buildSelectAll"
```

---

## Task 3: `core/arrowToRows.ts` — Arrow Table → plain rows (TDD)

**Files:**
- Create: `src/core/arrowToRows.ts`
- Test: `src/core/arrowToRows.test.ts`

- [ ] **Step 1: Write the failing test** (build an Arrow table in-memory, no DuckDB needed)

`src/core/arrowToRows.test.ts`:
```typescript
import { tableFromArrays } from 'apache-arrow'
import { describe, expect, it } from 'vitest'
import { arrowToRows } from './arrowToRows'

describe('arrowToRows', () => {
  it('extracts column names and row objects from an Arrow table', () => {
    const table = tableFromArrays({
      country: ['DE', 'PL', 'RU'],
      n: [12840, 9610, 8205],
    })

    const result = arrowToRows(table)

    expect(result.numRows).toBe(3)
    expect(result.columns.map((c) => c.name)).toEqual(['country', 'n'])
    expect(result.rows[0]).toEqual({ country: 'DE', n: 12840 })
    expect(result.rows).toHaveLength(3)
  })

  it('reports column type names', () => {
    const table = tableFromArrays({ country: ['DE'] })
    const result = arrowToRows(table)
    // apache-arrow stringifies a string column's type as 'Utf8'.
    expect(result.columns[0]).toEqual({ name: 'country', type: 'Utf8' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/core/arrowToRows.test.ts`
Expected: FAIL — cannot resolve `./arrowToRows`.

- [ ] **Step 3: Write minimal implementation**

`src/core/arrowToRows.ts`:
```typescript
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

/** Shape an Apache Arrow Table into plain column metadata + row objects. */
export function arrowToRows(table: Table): QueryResult {
  const columns = table.schema.fields.map((f) => ({
    name: f.name,
    type: String(f.type),
  }))
  const rows = table
    .toArray()
    .map((row) => row.toJSON() as Record<string, unknown>)
  return { columns, rows, numRows: table.numRows }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/core/arrowToRows.test.ts`
Expected: PASS (2 tests). If the type-name assertion fails because this apache-arrow build stringifies the type differently, adjust the expected literal to the actual `String(f.type)` value — the column-name and row-value assertions are the load-bearing ones.

- [ ] **Step 5: Commit**

```bash
git add src/core/arrowToRows.ts src/core/arrowToRows.test.ts
git commit -m "feat(core): arrowToRows shapes Arrow tables into rows"
```

---

## Task 4: `db/` client + Node instantiation + integration smoke test (TDD)

This task verifies the real DuckDB round-trip **and** the exact `all_varchar` SQL by asserting every column comes back as a string.

**Files:**
- Create: `src/db/nodeDuckDB.ts`, `src/db/duckdbClient.ts`
- Test: `src/db/duckdbClient.test.ts`

- [ ] **Step 1: Write the failing integration test**

`src/db/duckdbClient.test.ts`:
```typescript
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { arrowToRows } from '../core/arrowToRows'
import { buildSelectAll } from '../core/sql'
import { createClient, type DuckDBClient } from './duckdbClient'
import { createNodeDuckDB } from './nodeDuckDB'

let db: AsyncDuckDB
let client: DuckDBClient

beforeAll(async () => {
  db = await createNodeDuckDB()
  client = createClient(db)
})

afterAll(async () => {
  // Terminates the underlying worker so Vitest exits cleanly.
  await db.terminate()
})

describe('DuckDB client (node integration)', () => {
  it('loads a CSV as an all-VARCHAR table and queries it', async () => {
    const csv = 'country,n\nDE,12840\nPL,9610\n'
    await client.registerFile('events.csv', new TextEncoder().encode(csv))
    await client.loadCsvAllVarchar('events.csv', 'events')

    const table = await client.query(buildSelectAll('events'))
    const result = arrowToRows(table)

    expect(result.numRows).toBe(2)
    expect(result.columns.map((c) => c.name)).toEqual(['country', 'n'])
    // all_varchar baseline => numeric-looking column stays a STRING.
    expect(result.rows).toEqual([
      { country: 'DE', n: '12840' },
      { country: 'PL', n: '9610' },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/db/duckdbClient.test.ts`
Expected: FAIL — cannot resolve `./duckdbClient` / `./nodeDuckDB`.

- [ ] **Step 3: Write the Node instantiation**

`src/db/nodeDuckDB.ts`:
```typescript
import * as duckdb from '@duckdb/duckdb-wasm'
import { createRequire } from 'node:module'
import * as path from 'node:path'

const require = createRequire(import.meta.url)

/**
 * Instantiate duckdb-wasm in Node from LOCAL dist files (no network).
 * Used only by integration tests. Resolves the package's dist dir and points
 * at the EH (single-thread) bundle.
 */
export async function createNodeDuckDB(): Promise<duckdb.AsyncDuckDB> {
  const distDir = path.dirname(require.resolve('@duckdb/duckdb-wasm'))
  const bundle: duckdb.DuckDBBundle = {
    mainModule: path.resolve(distDir, 'duckdb-eh.wasm'),
    mainWorker: path.resolve(distDir, 'duckdb-node-eh.worker.cjs'),
    pthreadWorker: null,
  }
  const logger = new duckdb.VoidLogger()
  // createWorker (Node target) wraps node:worker_threads behind a
  // web-Worker-compatible shim; do NOT construct a worker_threads Worker.
  const worker = await duckdb.createWorker(bundle.mainWorker!)
  const db = new duckdb.AsyncDuckDB(logger, worker)
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
  return db
}
```

- [ ] **Step 4: Write the client wrapper**

`src/db/duckdbClient.ts`:
```typescript
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'
import type { Table } from 'apache-arrow'
import { quoteIdent, quoteLiteral } from '../core/sql'

export interface DuckDBClient {
  /** Register raw file bytes under a virtual filename DuckDB can read. */
  registerFile(name: string, data: Uint8Array): Promise<void>
  /** Materialize a registered CSV as an all-VARCHAR baseline table. */
  loadCsvAllVarchar(virtualName: string, tableName: string): Promise<void>
  /** Run a query and return the Arrow result table. */
  query(sql: string): Promise<Table>
}

export function createClient(db: AsyncDuckDB): DuckDBClient {
  return {
    async registerFile(name, data) {
      await db.registerFileBuffer(name, data)
    },
    async loadCsvAllVarchar(virtualName, tableName) {
      const conn = await db.connect()
      try {
        await conn.query(
          `CREATE OR REPLACE TABLE ${quoteIdent(tableName)} AS
             SELECT * FROM read_csv_auto(${quoteLiteral(virtualName)}, all_varchar = true)`,
        )
      } finally {
        await conn.close()
      }
    },
    async query(sql) {
      const conn = await db.connect()
      try {
        return await conn.query(sql)
      } finally {
        await conn.close()
      }
    },
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- src/db/duckdbClient.test.ts`
Expected: PASS (1 test). If `read_csv_auto(..., all_varchar = true)` errors on this engine build, switch the statement to `read_csv(${quoteLiteral(virtualName)}, auto_detect = true, all_varchar = true)` and re-run — the test is the verification gate for the exact syntax. If the run hangs after passing, confirm `db.terminate()` is in `afterAll`.

- [ ] **Step 6: Commit**

```bash
git add src/db/nodeDuckDB.ts src/db/duckdbClient.ts src/db/duckdbClient.test.ts
git commit -m "feat(db): duckdb client + node integration smoke test"
```

---

## Task 5: `db/browserDuckDB.ts` — single-thread browser instantiation (singleton)

Browser-only code (not unit-tested; verified by type-check/build and by the Task 6 manual run).

**Files:**
- Create: `src/db/browserDuckDB.ts`

- [ ] **Step 1: Write the browser instantiation**

`src/db/browserDuckDB.ts`:
```typescript
import * as duckdb from '@duckdb/duckdb-wasm'
// Vite rewrites each ?url import to a hashed asset whose final URL already
// includes `base` — no manual BASE_URL concatenation needed.
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'

// Only mvp + eh => single-threaded. NO `coi` entry => selectBundle can never
// pick the SharedArrayBuffer/threaded bundle, which GitHub Pages cannot serve
// (no COOP/COEP headers).
const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
}

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null

/**
 * Lazily instantiate ONE shared single-threaded DuckDB-WASM instance.
 * The module-level promise makes React 18/19 StrictMode double-invokes safe.
 */
export function getBrowserDuckDB(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const bundle = await duckdb.selectBundle(MANUAL_BUNDLES)
      const worker = new Worker(bundle.mainWorker!)
      const logger = new duckdb.ConsoleLogger()
      const db = new duckdb.AsyncDuckDB(logger, worker)
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
      return db
    })()
  }
  return dbPromise
}
```

- [ ] **Step 2: Verify it type-checks and builds**

Run: `npm run build`
Expected: PASS — `tsc -b` resolves the `?url` imports via `vite/client` types and `vite build` bundles the four DuckDB assets into `dist/assets/`.

- [ ] **Step 3: Commit**

```bash
git add src/db/browserDuckDB.ts
git commit -m "feat(db): single-thread browser duckdb-wasm singleton"
```

---

## Task 6: React app — loading state, CSV drop/pick, run, render table

UI (eye-tested per CLAUDE.md). Complete code below; no placeholders.

**Files:**
- Create: `src/components/CsvDropzone.tsx`, `src/components/ResultTable.tsx`
- Modify: `src/App.tsx` (replace placeholder), `src/index.css` (append styles)

- [ ] **Step 1: Write `src/components/CsvDropzone.tsx`**

```tsx
import { useRef, useState } from 'react'

interface Props {
  onFile: (file: File) => void
  disabled?: boolean
}

export function CsvDropzone({ onFile, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  function pick(files: FileList | null) {
    const file = files?.[0]
    if (file) onFile(file)
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
        accept=".csv,text/csv"
        hidden
        onChange={(e) => pick(e.target.files)}
      />
      Перетащи CSV сюда или кликни, чтобы выбрать
    </div>
  )
}
```

- [ ] **Step 2: Write `src/components/ResultTable.tsx`**

```tsx
import type { QueryResult } from '../core/arrowToRows'

interface Props {
  result: QueryResult
}

// bigint cannot be rendered/serialized directly (JSON.stringify throws on it);
// stringify any bigint cell. DuckDB BIGINT/COUNT/SUM surface as bigint.
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'bigint') return value.toString()
  return String(value)
}

export function ResultTable({ result }: Props) {
  return (
    <table className="data">
      <thead>
        <tr>
          {result.columns.map((c) => (
            <th key={c.name}>{c.name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.rows.map((row, i) => (
          <tr key={i}>
            {result.columns.map((c) => (
              <td key={c.name}>{formatCell(row[c.name])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 3: Replace `src/App.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { CsvDropzone } from './components/CsvDropzone'
import { ResultTable } from './components/ResultTable'
import { arrowToRows, type QueryResult } from './core/arrowToRows'
import { buildSelectAll } from './core/sql'
import { getBrowserDuckDB } from './db/browserDuckDB'
import { createClient, type DuckDBClient } from './db/duckdbClient'

type InitState = 'loading' | 'ready' | 'error'

export function App() {
  const [initState, setInitState] = useState<InitState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [sourceName, setSourceName] = useState<string | null>(null)
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

  async function handleFile(file: File) {
    const client = clientRef.current
    if (!client) return
    setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await client.registerFile(file.name, bytes)
      await client.loadCsvAllVarchar(file.name, 'uploaded')
      const table = await client.query(buildSelectAll('uploaded'))
      setSourceName(file.name)
      setResult(arrowToRows(table))
    } catch (e) {
      setError(String(e))
    }
  }

  if (initState === 'loading') {
    return (
      <main className="app">
        <p className="status">Инициализация DuckDB-WASM…</p>
      </main>
    )
  }

  if (initState === 'error') {
    return (
      <main className="app">
        <p className="status error">Ошибка инициализации: {error}</p>
      </main>
    )
  }

  return (
    <main className="app">
      <h1>quackbook</h1>
      <CsvDropzone onFile={handleFile} />
      {error && <p className="status error">{error}</p>}
      {result && (
        <>
          <p className="status">
            {sourceName} · {result.numRows} строк · {result.columns.length}{' '}
            колонок
          </p>
          <ResultTable result={result} />
        </>
      )}
    </main>
  )
}
```

- [ ] **Step 4: Append styles to `src/index.css`**

```css
h1 {
  font-size: 20px;
  font-weight: 700;
}
.dropzone {
  border: 1px dashed #34555a;
  border-radius: 10px;
  padding: 28px;
  text-align: center;
  color: #8da6a2;
  cursor: pointer;
  margin: 16px 0;
}
.dropzone.over {
  border-color: #e3a95c;
  color: #e9eeea;
}
.status {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: #8da6a2;
}
.status.error {
  color: #e8826a;
}
table.data {
  width: 100%;
  border-collapse: collapse;
  font-family: ui-monospace, monospace;
  font-size: 12.5px;
}
table.data th,
table.data td {
  text-align: left;
  padding: 7px 12px;
  border-bottom: 1px solid #1d363b;
}
table.data th {
  color: #5c7975;
  text-transform: uppercase;
  font-size: 10.5px;
}
```

- [ ] **Step 5: Verify build, lint, and a manual dev run**

Run:
```bash
npm run build
npm run lint
npm run dev
```
Expected: build + lint pass. In the dev server: the page shows "Инициализация DuckDB-WASM…" briefly, then the dropzone. Drop a small CSV (with a header row) → a table of its rows renders, with the "<file> · N строк · M колонок" line. No console errors about workers or wasm.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/CsvDropzone.tsx src/components/ResultTable.tsx src/index.css
git commit -m "feat(ui): csv dropzone, query run, result table + loading state"
```

---

## Task 7: GitHub Pages deploy (Actions) + README

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `README.md`

- [ ] **Step 1: Write `.github/workflows/deploy.yml`**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: ['main']
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: 'pages'
  cancel-in-progress: false

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
      - name: Install dependencies
        run: npm ci
      - name: Build
        run: npm run build
      - name: Setup Pages
        uses: actions/configure-pages@v5
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: './dist'
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Replace the `## Старт` section of `README.md`**

Replace the existing `## Старт` / `TBD` block with:
```markdown
## Старт

```bash
npm ci            # установка (точные пины из package-lock)
npm run dev       # локальная разработка (http://localhost:5173)
npm test          # юнит + интеграционные тесты (Vitest, node-окружение)
npm run build     # продакшн-сборка в dist/
npm run preview   # локальный предпросмотр сборки
npm run lint      # ESLint
```

Требуется Node `^20.19.0 || >=22.12.0` (см. `.nvmrc`).

**Деплой:** push в `main` → GitHub Actions собирает и публикует на Pages.
Однократно вручную: **Settings → Pages → Source = GitHub Actions**.
Базовый путь в `vite.config.ts` (`/quackbook/`) должен совпадать с именем репозитория.
```

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/deploy.yml README.md
git commit -m "ci: deploy to GitHub Pages + README start section"
git push -u origin HEAD
```

- [ ] **Step 4: One-time manual GitHub setup + verify the deploy**

In the GitHub repo UI: **Settings → Pages → Build and deployment → Source → GitHub Actions**. Then wait for the `Deploy to GitHub Pages` workflow run to go green (Actions tab).

- [ ] **Step 5: Manual acceptance against M0 done-criteria**

On the deployed URL `https://<user>.github.io/quackbook/`:
1. Page shows the loader, then the dropzone (WASM initialized).
2. Drop a small CSV with a header row → its rows render in the table; the meta line shows row/column counts.
3. Hard-reload the page → it returns to the empty initial state (dropzone, no table) — confirming in-memory-only with no persistence.

Confirm: no `coi`/SharedArrayBuffer/COOP errors in the console; the `.wasm` assets load from `/quackbook/assets/...` (Network tab), not from a CDN.

---

## Done criteria (M0 complete when all true)

- [ ] On the deployed Pages URL, dropping a CSV shows its rows in a table.
- [ ] A loader is visible while WASM initializes.
- [ ] Reload yields an empty initial state (in-memory only; no persistence code added).
- [ ] `npm test` is green: `core/sql`, `core/arrowToRows`, and the `db/` integration smoke test (which proves the all-VARCHAR load).
- [ ] `npm run build` and `npm run lint` pass.
- [ ] CI deploy workflow is green and self-hosts the DuckDB assets (no CDN call).

## Out of scope for M0 (do NOT add — later milestones / firewall)

Schema inference & typing (`sniff_csv`, TRY_CAST, type editor) → M2. Profile (SUMMARIZE/histograms) → M3. Notebook/report blocks, pin, export → M4/M5. Tabs, mode toggle, rail, multi-file UI, charts → M1+. State library (Zustand), CodeMirror, virtualized grid, Observable Plot, marked, dnd-kit → install when their milestone arrives. OPFS/persistence, key-hint, dashboard grid → firewalled.
