import { useEffect, useState } from 'react'
import type { WidgetBlock } from '../core/report'
import type { DuckDBClient } from '../db/duckdbClient'
import { arrowToRows, type QueryResult } from '../core/arrowToRows'
import { buildChartSpec } from '../core/chartSpec'
import { useSession } from '../state/session'
import { ResultGrid } from './ResultGrid'
import { Chart } from './Chart'

interface Props {
  block: WidgetBlock
  client: DuckDBClient
}

type WidgetState =
  | { kind: 'loading' }
  | { kind: 'ok'; result: QueryResult }
  | { kind: 'error'; message: string }

export function WidgetBlockView({ block, client }: Props) {
  const setWidgetVizType = useSession((s) => s.setWidgetVizType)
  const updateWidgetCaption = useSession((s) => s.updateWidgetCaption)
  const updateWidgetTitle = useSession((s) => s.updateWidgetTitle)
  const moveBlock = useSession((s) => s.moveBlock)
  const removeBlock = useSession((s) => s.removeBlock)

  // datasets is a separate store slice, so the rerun effect must ALSO depend on
  // the loaded subset of this widget's sources. Otherwise, after a reload the
  // re-dropped source (addDataset) wouldn't retrigger the query and the widget
  // would stay stuck on its missing-table error (the headline rehydration flow).
  const loadedKey = useSession((s) =>
    s.datasets
      .map((d) => d.table)
      .filter((t) => block.datasetNames.includes(t))
      .sort()
      .join('|'),
  )

  const [state, setState] = useState<WidgetState>({ kind: 'loading' })
  const [sqlOpen, setSqlOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(block.title)

  // Lazy rerun: each widget runs its own SQL against the in-memory tables on
  // mount (and when its sql/client change). Result lives in local state — it is
  // NEVER serialized (spec decision 4). Mirrors Explore.run.
  useEffect(() => {
    let cancelled = false
    client
      .query(block.sql)
      .then((table) => {
        if (cancelled) return
        setState({ kind: 'ok', result: arrowToRows(table) })
      })
      .catch((e) => {
        if (cancelled) return
        setState({ kind: 'error', message: String(e) })
      })
    return () => {
      cancelled = true
    }
  }, [block.sql, client, loadedKey])

  const result = state.kind === 'ok' ? state.result : null
  const error = state.kind === 'error' ? state.message : null
  const loading = state.kind === 'loading'

  const spec = result ? buildChartSpec(result.columns) : null
  const showChart = block.vizType === 'chart' && spec && result

  return (
    <div className="widget-block">
      <div className="widget-head">
        {editingTitle ? (
          <input
            className="widget-title-edit"
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => {
              const next = titleDraft.trim()
              if (next && next !== block.title) updateWidgetTitle(block.id, next)
              setEditingTitle(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              else if (e.key === 'Escape') { setTitleDraft(block.title); setEditingTitle(false) }
            }}
          />
        ) : (
          <span
            className="widget-title"
            title="кликни, чтобы переименовать"
            onClick={(e) => { e.stopPropagation(); setTitleDraft(block.title); setEditingTitle(true) }}
          >
            {block.title}
          </span>
        )}
        <span className="widget-datasets">
          {block.datasetNames.map((t) => (
            <span className="ds-pill" key={t}>
              {t}
            </span>
          ))}
        </span>
        <button
          className="widget-sql-toggle"
          onClick={() => setSqlOpen((v) => !v)}
          title="показать/скрыть SQL"
        >
          SQL {sqlOpen ? '▾' : '▸'}
        </button>
        <span className="widget-controls">
          <button onClick={() => moveBlock(block.id, 'up')} title="вверх">
            ↑
          </button>
          <button onClick={() => moveBlock(block.id, 'down')} title="вниз">
            ↓
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              removeBlock(block.id)
            }}
            title="удалить"
          >
            ✕
          </button>
        </span>
      </div>

      {sqlOpen && <pre className="widget-sql">{block.sql}</pre>}

      <div className="view-toggle widget-view-toggle">
        <button
          className={block.vizType === 'table' ? 'on' : ''}
          onClick={() => setWidgetVizType(block.id, 'table')}
        >
          таблица
        </button>
        <button
          className={block.vizType === 'chart' ? 'on' : ''}
          disabled={!spec}
          title={spec ? '' : 'нет числовой колонки для графика'}
          onClick={() => setWidgetVizType(block.id, 'chart')}
        >
          график
        </button>
      </div>

      {error && (
        <div className="widget-error">
          <pre className="result-error">{error}</pre>
          {block.datasetNames.length > 0 && (
            <p className="widget-sources-hint">
              источник(и): {block.datasetNames.join(', ')} — подгрузи, если
              отсутствуют
            </p>
          )}
        </div>
      )}
      {!error && loading && <p className="result-empty">пересчитываю…</p>}
      {!error && !loading && showChart && (
        <Chart spec={spec!} rows={result!.rows} />
      )}
      {!error && !loading && result && block.vizType === 'table' && (
        <ResultGrid result={result} sorts={[]} onToggleSort={() => {}} onOpenFilter={() => {}} />
      )}
      {/*
        Do NOT delete as "dead": this branch fires only for a loaded/rehydrated
        widget whose SAVED vizType is 'chart' but whose recomputed result has no
        numeric column. The chart toggle is disabled={!spec}, so a user can never
        reach vizType==='chart' && !spec by clicking — only a JSON open / reload
        produces it. (Spec line 71: chart toggle disabled when no numeric col.)
      */}
      {!error && !loading && result && block.vizType === 'chart' && !spec && (
        <p className="result-empty">нет числовой колонки для графика</p>
      )}

      <input
        className="widget-caption"
        placeholder="подпись…"
        value={block.caption}
        onChange={(e) => updateWidgetCaption(block.id, e.target.value)}
      />
    </div>
  )
}
