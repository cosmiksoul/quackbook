import { useState } from 'react'
import { useSession, type Dataset } from '../state/session'
import { detectReferencedTables, detectUsedColumns } from '../core/pruning'
import type { DuckDBClient } from '../db/duckdbClient'
import { SchemaColumnEditor } from '../components/SchemaColumnEditor'
import { useSchemaActions } from './useSchemaActions'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}K`
  return `${(n / (1024 * 1024)).toFixed(1)}M`
}

export function Rail({ client }: { client: DuckDBClient }) {
  const datasets = useSession((s) => s.datasets)
  const tabs = useSession((s) => s.tabs)
  const activeTabId = useSession((s) => s.activeTabId)
  const openOrFocusTab = useSession((s) => s.openOrFocusTab)
  const { applyInferred, apply } = useSchemaActions(client)
  const stageColumn = useSession((s) => s.stageColumn)
  const resetColumn = useSession((s) => s.resetColumn)
  const [editing, setEditing] = useState<{ table: string; origName: string } | null>(null)

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
        const canType = ds.kind === 'csv' && (ds.suggested?.length ?? 0) > 0
        const hasIncluded =
          (ds.schemaConfig?.filter((c) => c.include).length ?? 0) > 0
        return (
          <div className="schema-block" key={ds.table}>
            <div className="rail-section-label schema-head">
              <span>
                Схема · {ds.fileName}{' '}
                <span className="schema-count">
                  {used.size}/{ds.columns.length}
                </span>
              </span>
              <span className="schema-actions">
                {ds.dirty && (
                  <button
                    className="schema-btn apply"
                    disabled={!hasIncluded}
                    onClick={() => void apply(ds.table)}
                    title={
                      hasIncluded
                        ? 'ре-материализовать таблицу из текущей конфигурации'
                        : 'нужна хотя бы одна включённая колонка'
                    }
                  >
                    применить
                  </button>
                )}
                {canType && (
                  <button
                    className="schema-btn"
                    onClick={() => void applyInferred(ds.table)}
                    title="применить предложенные типы одним кликом"
                  >
                    типы
                  </button>
                )}
              </span>
            </div>
            {ds.schemaError && (
              <div className="schema-error" role="alert">
                {ds.schemaError}
              </div>
            )}
            <ul className="schema">
              {(() => {
                const includedCount =
                  ds.schemaConfig?.filter((c) => c.include).length ?? 0
                return ds.columns.map((c) => {
                  const cfg = ds.schemaConfig?.find((x) => x.origName === c.name)
                  const open =
                    editing?.table === ds.table && editing?.origName === c.name
                  // Allow un-including only when >1 column is currently included.
                  const canDisableInclude = includedCount > 1
                  return (
                    <li
                      className={used.has(c.name) ? 'schema-col used' : 'schema-col'}
                      key={c.name}
                    >
                      <span className="col-name">{c.name}</span>
                      <span className="col-meta">
                        <span className="col-type">{c.type}</span>
                        {c.nullLoss != null && c.nullLoss > 0 && (
                          <span className="col-warn" title={`${c.nullLoss} → NULL`}>
                            ⚠ {c.nullLoss}
                          </span>
                        )}
                        {cfg && (
                          <button
                            className="col-edit"
                            aria-label={`правка ${c.name}`}
                            onClick={() =>
                              setEditing(
                                open ? null : { table: ds.table, origName: c.name },
                              )
                            }
                          >
                            ✎
                          </button>
                        )}
                      </span>
                      {open && cfg && (
                        <SchemaColumnEditor
                          config={cfg}
                          canDisableInclude={canDisableInclude}
                          onStage={(next) => stageColumn(ds.table, next)}
                          onReset={(orig) => {
                            resetColumn(ds.table, orig)
                            setEditing(null)
                          }}
                          onClose={() => setEditing(null)}
                        />
                      )}
                    </li>
                  )
                })
              })()}
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
