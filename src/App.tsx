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
