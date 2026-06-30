// One-off: converts scripts/users_raw.csv -> public/demo/users.parquet with
// explicit types. Run: `node scripts/convertUsers.mjs`. Committed for reproducibility.
import * as duckdb from '@duckdb/duckdb-wasm'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { Worker } from 'node:worker_threads'

const require = createRequire(import.meta.url)

async function createNodeDuckDB() {
  const distDir = path.dirname(require.resolve('@duckdb/duckdb-wasm'))
  const wasmPath = path.resolve(distDir, 'duckdb-eh.wasm')
  const workerPath = path.resolve(distDir, 'duckdb-node-eh.worker.cjs')
  const nodeCjsPath = path.resolve(distDir, 'duckdb-node.cjs')
  const nodeWorker = new Worker(nodeCjsPath, {
    workerData: { mod: workerPath, name: 'duckdb', type: 'classic' },
  })
  const listeners = {}
  const workerShim = {
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn) },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn) },
    postMessage(data, transfer) { nodeWorker.postMessage(data, transfer) },
    terminate() { return nodeWorker.terminate() },
  }
  nodeWorker.on('message', (data) => (listeners['message'] ?? []).forEach((fn) => fn({ data, type: 'message' })))
  nodeWorker.on('error', (err) => (listeners['error'] ?? []).forEach((fn) => fn(err)))
  nodeWorker.on('exit', () => (listeners['close'] ?? []).forEach((fn) => fn({})))
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), workerShim)
  await db.instantiate(wasmPath, null)
  return db
}

const db = await createNodeDuckDB()
const csv = fs.readFileSync(path.resolve('scripts/users_raw.csv'))
await db.registerFileBuffer('users_raw.csv', new Uint8Array(csv))
const conn = await db.connect()
await conn.query(
  `COPY (
     SELECT CAST(UserID AS BIGINT) AS UserID,
            CAST(replace(DateUTC, ' UTC', '') AS TIMESTAMP) AS DateUTC,
            ControlOrTest,
            CAST(PhotoCount AS INTEGER) AS PhotoCount,
            MaritalStatus
     FROM read_csv_auto('users_raw.csv', all_varchar = true)
   ) TO 'users.parquet' (FORMAT PARQUET)`,
)
await conn.close()
const buf = await db.copyFileToBuffer('users.parquet')
fs.mkdirSync('public/demo', { recursive: true })
fs.writeFileSync('public/demo/users.parquet', buf)
await db.terminate()
console.log('wrote public/demo/users.parquet', buf.length, 'bytes')
