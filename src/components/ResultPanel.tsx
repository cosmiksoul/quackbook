import { useState } from 'react'
import { downloadResult } from '../features/exportResult'
import { buildChartSpec } from '../core/chartSpec'
import type { DuckDBClient } from '../db/duckdbClient'
import { useProfileActions } from '../features/useProfileActions'
import { useMartActions } from '../features/useMartActions'
import type { MartKind } from '../core/mart'
import { useSession } from '../state/session'
import { detectReferencedTables } from '../core/pruning'
import { ResultGrid } from './ResultGrid'
import { Chart } from './Chart'
import { ProfilePanel } from './ProfilePanel'
import { Icon } from './Icon'
import type { SortSpec } from '../core/resultQuery'
import { DEFAULT_VIEW } from '../core/resultQuery'

interface Props {
  meta: { ms: number; rows: number } | null
  error: string | null
  tabId: string
  sql: string
  client: DuckDBClient
}

export function ResultPanel({ meta, error, tabId, sql, client }: Props) {
  // exploreView: the 'table'/'chart'/'profile' UI toggle — keep as `view`/`setView`
  const view = useSession((s) => s.exploreView)
  const setView = useSession((s) => s.setExploreView)
  const profileTarget = useSession((s) => s.profileTarget)
  const setProfileTarget = useSession((s) => s.setProfileTarget)
  const pinResult = useSession((s) => s.pinResult)
  const setToast = useSession((s) => s.setToast)
  const patchView = useSession((s) => s.patchView)
  const tab = useSession((s) => s.tabs.find((t) => t.id === tabId))
  const { profileResult } = useProfileActions(client)
  const { createMart } = useMartActions(client)
  const [martOpen, setMartOpen] = useState(false)
  const [martName, setMartName] = useState('')
  const [martKind, setMartKind] = useState<MartKind>('view')
  const [martErr, setMartErr] = useState<string | null>(null)

  // display = current page rows (paged) or full result (raw); written by Task 3 flow
  const display = tab?.window ?? null
  // resultView = the paging/sorting/filter config (named to avoid shadowing `view` = exploreView)
  const resultView = tab?.view ?? DEFAULT_VIEW
  const spec = display ? buildChartSpec(display.columns) : null
  const showChart = view === 'chart' && spec && display

  function toggleSort(col: string, additive: boolean) {
    const cur = resultView.sorts
    const i = cur.findIndex((s) => s.col === col)
    let next: SortSpec[]
    if (i < 0) next = additive ? [...cur, { col, dir: 'asc' }] : [{ col, dir: 'asc' }]
    else if (cur[i].dir === 'asc') { const c = [...cur]; c[i] = { col, dir: 'desc' }; next = additive ? c : [{ col, dir: 'desc' }] }
    else next = additive ? cur.filter((s) => s.col !== col) : []
    patchView(tabId, { sorts: next, page: 1 })
  }

  // openFilter: stub — Task 7 will implement the filter popover (no-op for now)
  function openFilter() {
    // intentionally empty
  }

  async function exportResult(format: 'csv' | 'parquet') {
    try {
      await downloadResult(client, sql, format)
    } catch (e) {
      setToast('Экспорт не удался: ' + String(e))
    }
  }

  async function submitMart() {
    const err = await createMart(martName, sql, martKind)
    if (err) {
      setMartErr(err)
      return
    }
    setToast(`витрина «${martName.trim()}» создана`)
    setMartOpen(false)
    setMartName('')
    setMartErr(null)
  }

  return (
    <section className="result-panel">
      <header className="panel-head">
        <span className="panel-title">Результат</span>
        {meta && (
          <span className="panel-meta">
            {meta.rows} строк · {meta.ms.toFixed(1)} мс
          </span>
        )}
        {(display || (view === 'profile' && profileTarget?.kind === 'source')) && (
          <div className="view-toggle">
            <button
              className={view === 'table' ? 'on' : ''}
              disabled={!display}
              title={display ? '' : 'нет результата — запусти запрос'}
              onClick={() => setView('table')}
            >
              таблица
            </button>
            <button
              className={view === 'chart' ? 'on' : ''}
              disabled={!display || !spec}
              title={!display ? 'нет результата — запусти запрос' : spec ? '' : 'нет числовой колонки для графика'}
              onClick={() => setView('chart')}
            >
              график
            </button>
            <button
              className={view === 'profile' ? 'on' : ''}
              disabled={!display}
              title={display ? '' : 'нет результата — запусти запрос'}
              onClick={() => {
                setProfileTarget({ kind: 'result', tabId })
                setView('profile')
                void profileResult(tabId, sql)
              }}
            >
              профиль
            </button>
          </div>
        )}
        {display && (
          <button
            className="pin-btn"
            title="закрепить результат в отчёт"
            onClick={() => {
              const st = useSession.getState()
              const datasetNames = detectReferencedTables(
                sql,
                st.datasets.map((d) => d.table),
              )
              const title =
                st.tabs.find((t) => t.id === tabId)?.title ?? 'Запрос'
              pinResult({
                title,
                sql,
                datasetNames,
                vizType: view === 'chart' ? 'chart' : 'table',
                caption: '',
              })
              setToast('закреплено в отчёт')
            }}
          >
            <Icon name="pin" /> закрепить
          </button>
        )}
        {display && (
          <div className="export-group">
            <span className="export-label">экспорт в</span>
            <button className="export-btn" title="скачать полный результат в CSV" onClick={() => void exportResult('csv')}>CSV</button>
            <button className="export-btn" title="скачать полный результат в Parquet" onClick={() => void exportResult('parquet')}>Parquet</button>
          </div>
        )}
        {display && (
          <button
            className="export-btn mart-open"
            title="сохранить результат как витрину (VIEW/TABLE)"
            onClick={() => {
              setMartOpen((v) => !v)
              setMartErr(null)
            }}
          >
            + витрина
          </button>
        )}
      </header>
      {martOpen && (
        <div className="mart-form">
          <input
            className="mart-name"
            autoFocus
            placeholder="имя_витрины"
            value={martName}
            onChange={(e) => {
              setMartName(e.target.value)
              setMartErr(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitMart()
            }}
          />
          <div className="mart-kind">
            <button
              className={martKind === 'view' ? 'on' : ''}
              onClick={() => setMartKind('view')}
              title="живая — пересчитывается при обращении"
            >
              VIEW
            </button>
            <button
              className={martKind === 'table' ? 'on' : ''}
              onClick={() => setMartKind('table')}
              title="снапшот — фиксирует результат"
            >
              TABLE
            </button>
          </div>
          <button className="mart-create" onClick={() => void submitMart()}>создать</button>
          <button
            className="mart-cancel"
            onClick={() => {
              setMartOpen(false)
              setMartErr(null)
            }}
          >
            отмена
          </button>
          <span className="mart-hint">латиница / цифры / _</span>
          {martErr && <span className="mart-err">{martErr}</span>}
        </div>
      )}
      {view === 'profile' && <ProfilePanel />}
      {view !== 'profile' && error && <pre className="result-error">{error}</pre>}
      {view !== 'profile' && !error && showChart && <Chart spec={spec!} rows={display!.rows} />}
      {view !== 'profile' && !error && display && !showChart && (
        <ResultGrid
          result={display}
          sorts={resultView.sorts}
          onToggleSort={toggleSort}
          onOpenFilter={openFilter}
        />
      )}
      {view !== 'profile' && !error && !display && (
        <p className="result-empty">Запусти запрос (⌘↵), чтобы увидеть строки.</p>
      )}
    </section>
  )
}
