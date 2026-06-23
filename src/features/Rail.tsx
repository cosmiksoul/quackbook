import { useSession, type Dataset } from '../state/session'
import { detectReferencedTables, detectUsedColumns } from '../core/pruning'

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

  // The rail follows the active query: show the schema of every table it
  // references (a JOIN/UNION => several sections). Before a table is named
  // (blank/empty tab) fall back to the tab's own dataset, else the first
  // source, so the rail isn't empty.
  const referenced = activeTab
    ? detectReferencedTables(
        activeTab.sql,
        datasets.map((d) => d.table),
      )
    : []
  const shownTables =
    referenced.length > 0
      ? referenced
      : [activeTab?.datasetTable ?? datasets[0]?.table].filter(
          (t): t is string => t != null,
        )
  const shownDatasets = shownTables
    .map((t) => datasets.find((d) => d.table === t))
    .filter((d): d is Dataset => d != null)
  const shown = new Set(shownDatasets.map((d) => d.table))

  return (
    <aside className="rail">
      <div className="rail-section-label">Источники</div>
      <ul className="sources">
        {datasets.map((d) => (
          <li key={d.table}>
            <button
              className={shown.has(d.table) ? 'source active' : 'source'}
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

      {shownDatasets.map((ds) => {
        const used = new Set(
          activeTab
            ? detectUsedColumns(
                activeTab.sql,
                ds.columns.map((c) => c.name),
              )
            : [],
        )
        return (
          <div className="schema-block" key={ds.table}>
            <div className="rail-section-label">
              Схема · {ds.fileName}{' '}
              <span className="schema-count">
                {used.size}/{ds.columns.length}
              </span>
            </div>
            <ul className="schema">
              {ds.columns.map((c) => (
                <li
                  className={used.has(c.name) ? 'schema-col used' : 'schema-col'}
                  key={c.name}
                >
                  <span className="col-name">{c.name}</span>
                  <span className="col-type">{c.type}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      {shownDatasets.length > 0 && (
        <p className="rail-note">▸ подсвечены колонки, которые читает запрос</p>
      )}
    </aside>
  )
}
