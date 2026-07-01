import { useState, useEffect } from 'react'
import { downloadResult } from '../features/exportResult'
import { buildChartSpec } from '../core/chartSpec'
import type { DuckDBClient } from '../db/duckdbClient'
import { useProfileActions } from '../features/useProfileActions'
import { useMartActions } from '../features/useMartActions'
import type { MartKind } from '../core/mart'
import { useSession } from '../state/session'
import { detectReferencedTables } from '../core/pruning'
import { ResultGrid } from './ResultGrid'
import { ResultPager } from './ResultPager'
import { Chart } from './Chart'
import { ProfilePanel } from './ProfilePanel'
import { Icon } from './Icon'
import { ColumnFilter as ColumnFilterPopover } from './ColumnFilter'
import type { SortSpec, ColumnFilter } from '../core/resultQuery'
import { DEFAULT_VIEW, CHART_CAP, buildWhere, buildOrderBy, buildEffectiveSql } from '../core/resultQuery'
import { resultTempName, quoteIdent } from '../core/sql'
import { arrowToRows, type QueryResult } from '../core/arrowToRows'

function filterLabel(f: ColumnFilter): string {
  if (f.type === 'text') return `${f.col} ${f.op} «${f.value}»`
  if (f.type === 'null') return `${f.col} ${f.op === 'isNull' ? 'is null' : 'not null'}`
  if (f.type === 'number' || f.type === 'date') return `${f.col} ∈ [${f.min ?? '−∞'}, ${f.max ?? '+∞'}]`
  return `${f.col} ∈ {${f.values.join(', ')}}`
}

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
  const [searchDraft, setSearchDraft] = useState('')
  const [filterCol, setFilterCol] = useState<{ col: string; rect: DOMRect } | null>(null)
  const [chartData, setChartData] = useState<QueryResult | null>(null)

  // display = current page rows (paged) or full result (raw); written by Task 3 flow
  const display = tab?.window ?? null
  // resultView = the paging/sorting/filter config (named to avoid shadowing `view` = exploreView)
  const resultView = tab?.view ?? DEFAULT_VIEW

  // Reset searchDraft when switching tabs so the previous tab's draft doesn't leak
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { setSearchDraft(resultView.search) }, [tabId])
  // Debounce: commit search to store 250ms after the draft stops changing
  useEffect(() => {
    const h = setTimeout(() => {
      if (searchDraft !== resultView.search) patchView(tabId, { search: searchDraft, page: 1 })
    }, 250)
    return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft])

  // Fetch bounded, view-respecting chart data for paged mode
  useEffect(() => {
    if (view !== 'chart' || tab?.mode !== 'paged' || !tab.columns) {
      setChartData(null) // eslint-disable-line react-hooks/set-state-in-effect
      return
    }
    const cols = tab.columns.map((c) => c.name)
    const where = buildWhere(cols, resultView)
    const order = buildOrderBy(resultView.sorts)
    const q = [`SELECT * FROM ${quoteIdent(resultTempName(tabId))}`, where, order, `LIMIT ${CHART_CAP}`].filter(Boolean).join(' ')
    void client.query(q).then((t) => setChartData(arrowToRows(t))).catch(() => setChartData(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, tabId, tab?.mode, tab?.rowCount, resultView.search, JSON.stringify(resultView.filters), JSON.stringify(resultView.sorts)])

  const spec = display ? buildChartSpec(display.columns) : null
  const showChart = view === 'chart' && spec && display

  // For chart rendering: paged → bounded fetch; raw → in-memory window (already the full small result)
  const chartSrc = tab?.mode === 'paged' ? chartData : display
  const chartSpec = chartSrc ? buildChartSpec(chartSrc.columns) : null

  function toggleSort(col: string, additive: boolean) {
    const cur = resultView.sorts
    const i = cur.findIndex((s) => s.col === col)
    let next: SortSpec[]
    if (i < 0) next = additive ? [...cur, { col, dir: 'asc' }] : [{ col, dir: 'asc' }]
    else if (cur[i].dir === 'asc') { const c = [...cur]; c[i] = { col, dir: 'desc' }; next = additive ? c : [{ col, dir: 'desc' }] }
    else next = additive ? cur.filter((s) => s.col !== col) : []
    patchView(tabId, { sorts: next, page: 1 })
  }

  function openFilter(col: string, rect: DOMRect) {
    setFilterCol({ col, rect })
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
        {tab?.mode === 'paged' && (resultView.sorts.length > 0 || resultView.filters.length > 0 || resultView.search) && (
          <button
            className="export-btn"
            title="перенести текущий вид (WHERE/ORDER BY) в SQL"
            onClick={() => {
              const eff = buildEffectiveSql(sql, (tab.columns ?? []).map((c) => c.name), resultView)
              void navigator.clipboard.writeText(eff)
              setToast('SQL вида скопирован в буфер')
            }}
          >
            как SQL
          </button>
        )}
        {tab?.mode === 'paged' && (
          <input
            className="result-search"
            placeholder="поиск по всем колонкам…"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
          />
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
      {(resultView.filters.length > 0 || resultView.search) && (
        <div className="filter-chips">
          {resultView.search && (
            <span className="chip">
              поиск: «{resultView.search}»
              <button onClick={() => patchView(tabId, { search: '', page: 1 })}>×</button>
            </span>
          )}
          {resultView.filters.map((f, i) => (
            <span className="chip" key={f.col + i}>
              {filterLabel(f)}
              <button onClick={() => patchView(tabId, { filters: resultView.filters.filter((_, j) => j !== i), page: 1 })}>×</button>
            </span>
          ))}
          <button className="chip-clear" onClick={() => patchView(tabId, { filters: [], search: '', page: 1 })}>сбросить всё</button>
        </div>
      )}
      {view === 'profile' && <ProfilePanel />}
      {view !== 'profile' && error && <pre className="result-error">{error}</pre>}
      {view !== 'profile' && !error && showChart && chartSrc && chartSpec && (
        <>
          <Chart spec={chartSpec} rows={chartSrc.rows} />
          {tab?.mode === 'paged' && (tab.rowCount ?? 0) > CHART_CAP && (
            <p className="chart-cap-note">график по первым {CHART_CAP} из {tab.rowCount} строк — агрегируй запросом для полной картины</p>
          )}
        </>
      )}
      {view !== 'profile' && !error && display && !showChart && (
        <ResultGrid
          result={display}
          sorts={resultView.sorts}
          onToggleSort={toggleSort}
          onOpenFilter={openFilter}
        />
      )}
      {view !== 'profile' && !error && tab?.mode === 'paged' && display && (
        <ResultPager
          total={tab.rowCount ?? 0} page={resultView.page} pageSize={resultView.pageSize}
          onPage={(p) => patchView(tabId, { page: p })}
          onPageSize={(n) => patchView(tabId, { pageSize: n, page: 1 })}
        />
      )}
      {view !== 'profile' && !error && !display && (
        <p className="result-empty">Запусти запрос (⌘↵), чтобы увидеть строки.</p>
      )}
      {filterCol && tab?.columns && (
        <ColumnFilterPopover
          tabId={tabId}
          col={filterCol.col}
          type={tab.columns.find((c) => c.name === filterCol.col)!.type}
          client={client}
          rect={filterCol.rect}
          onClose={() => setFilterCol(null)}
          onApply={(f) => {
            patchView(tabId, { filters: [...resultView.filters.filter((x) => x.col !== f.col), f], page: 1 })
            setFilterCol(null)
          }}
        />
      )}
    </section>
  )
}
