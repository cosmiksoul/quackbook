import * as duckdb from '@duckdb/duckdb-wasm'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import { Worker } from 'node:worker_threads'

const require = createRequire(import.meta.url)

/**
 * Instantiate duckdb-wasm in Node from LOCAL dist files (no network).
 * Used only by integration tests. Resolves the package's dist dir and points
 * at the EH (single-thread) bundle.
 *
 * Implementation note: duckdb-node.cjs's createWorker() uses fetch() +
 * URL.createObjectURL() which don't work with file:// URLs in Node 24.
 * We bypass createWorker() and directly spawn duckdb-node.cjs as a
 * worker_threads.Worker with {workerData: {mod, name, type}} — which is
 * exactly what the internal Qe() Worker shim does. We also pass the raw
 * Windows path (not a file:// URL) to db.instantiate() because the worker's
 * readBinary uses fs.readFileSync on the normalized path.
 */
export async function createNodeDuckDB(): Promise<duckdb.AsyncDuckDB> {
  const distDir = path.dirname(require.resolve('@duckdb/duckdb-wasm'))
  const wasmPath = path.resolve(distDir, 'duckdb-eh.wasm')
  const workerPath = path.resolve(distDir, 'duckdb-node-eh.worker.cjs')
  const nodeCjsPath = path.resolve(distDir, 'duckdb-node.cjs')

  // Start duckdb-node.cjs as a worker thread with the EH worker module.
  // This replicates the internal Qe() Worker shim without going through
  // createWorker()'s fetch() call.
  const nodeWorker = new Worker(nodeCjsPath, {
    workerData: { mod: workerPath, name: 'duckdb', type: 'classic' },
  })

  // AsyncDuckDB expects a web-Worker-compatible object (addEventListener /
  // postMessage / terminate). Build a minimal shim over node worker_threads.
  type Listener = (e: unknown) => void
  const listeners: Record<string, Listener[]> = {}

  const workerShim = {
    addEventListener(type: string, fn: Listener) {
      ;(listeners[type] ??= []).push(fn)
    },
    removeEventListener(type: string, fn: Listener) {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn)
    },
    postMessage(data: unknown, transfer?: Transferable[]) {
      nodeWorker.postMessage(
        data,
        transfer as unknown as readonly import('node:worker_threads').TransferListItem[],
      )
    },
    terminate() {
      return nodeWorker.terminate()
    },
  }

  nodeWorker.on('message', (data) => {
    ;(listeners['message'] ?? []).forEach((fn) =>
      fn({ data, type: 'message' }),
    )
  })
  nodeWorker.on('error', (err) => {
    ;(listeners['error'] ?? []).forEach((fn) => fn(err))
  })
  nodeWorker.on('exit', () => {
    ;(listeners['close'] ?? []).forEach((fn) => fn({}))
  })

  const logger = new duckdb.VoidLogger()
  const db = new duckdb.AsyncDuckDB(
    logger,
    workerShim as unknown as globalThis.Worker,
  )
  // Raw OS path (not file:// URL): the EH worker's readBinary uses
  // nodePath.normalize() when the path is not a file: URI.
  await db.instantiate(wasmPath, null)
  return db
}
