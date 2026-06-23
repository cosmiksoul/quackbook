import { useSession } from '../state/session'
import type { DuckDBClient } from '../db/duckdbClient'
import { buildDropTable, rawTableName } from '../core/sql'
import { CsvDropzone } from '../components/CsvDropzone'
import { loadOneFile } from './loadFiles'
import { Explore } from './Explore'
import { Report } from './Report'
import { Rail } from './Rail'

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
        if (d.kind === 'csv') {
          await client.query(buildDropTable(rawTableName(d.table)))
        }
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
    </div>
  )
}
