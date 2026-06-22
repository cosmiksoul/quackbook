import { useSession } from '../state/session'
import { detectUsedColumns } from '../core/pruning'

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

  const used =
    schemaDataset && activeTab
      ? new Set(
          detectUsedColumns(
            activeTab.sql,
            schemaDataset.columns.map((c) => c.name),
          ),
        )
      : new Set<string>()

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
        </>
      )}
    </aside>
  )
}
