import { downloadResult } from '../features/exportResult'
import type { QueryResult } from '../core/arrowToRows'
import { buildChartSpec } from '../core/chartSpec'
import type { DuckDBClient } from '../db/duckdbClient'
import { useProfileActions } from '../features/useProfileActions'
import { useSession } from '../state/session'
import { detectReferencedTables } from '../core/pruning'
import { ResultGrid } from './ResultGrid'
import { Chart } from './Chart'
import { ProfilePanel } from './ProfilePanel'
import { Icon } from './Icon'

interface Props {
  result: QueryResult | null
  meta: { ms: number; rows: number } | null
  error: string | null
  tabId: string
  sql: string
  client: DuckDBClient
}

export function ResultPanel({ result, meta, error, tabId, sql, client }: Props) {
  const view = useSession((s) => s.exploreView)
  const setView = useSession((s) => s.setExploreView)
  const profileTarget = useSession((s) => s.profileTarget)
  const setProfileTarget = useSession((s) => s.setProfileTarget)
  const pinResult = useSession((s) => s.pinResult)
  const setToast = useSession((s) => s.setToast)
  const { profileResult } = useProfileActions(client)
  const spec = result ? buildChartSpec(result.columns) : null
  const showChart = view === 'chart' && spec && result

  async function exportResult(format: 'csv' | 'parquet') {
    try {
      await downloadResult(client, sql, format)
    } catch (e) {
      setToast('Экспорт не удался: ' + String(e))
    }
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
        {(result || (view === 'profile' && profileTarget?.kind === 'source')) && (
          <div className="view-toggle">
            <button
              className={view === 'table' ? 'on' : ''}
              disabled={!result}
              title={result ? '' : 'нет результата — запусти запрос'}
              onClick={() => setView('table')}
            >
              таблица
            </button>
            <button
              className={view === 'chart' ? 'on' : ''}
              disabled={!result || !spec}
              title={!result ? 'нет результата — запусти запрос' : spec ? '' : 'нет числовой колонки для графика'}
              onClick={() => setView('chart')}
            >
              график
            </button>
            <button
              className={view === 'profile' ? 'on' : ''}
              disabled={!result}
              title={result ? '' : 'нет результата — запусти запрос'}
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
        {result && (
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
        {result && (
          <div className="export-group">
            <span className="export-label">экспорт в</span>
            <button className="export-btn" title="скачать полный результат в CSV" onClick={() => void exportResult('csv')}>CSV</button>
            <button className="export-btn" title="скачать полный результат в Parquet" onClick={() => void exportResult('parquet')}>Parquet</button>
          </div>
        )}
      </header>
      {view === 'profile' && <ProfilePanel />}
      {view !== 'profile' && error && <pre className="result-error">{error}</pre>}
      {view !== 'profile' && !error && showChart && <Chart spec={spec!} rows={result!.rows} />}
      {view !== 'profile' && !error && result && !showChart && <ResultGrid result={result} />}
      {view !== 'profile' && !error && !result && (
        <p className="result-empty">Запусти запрос (⌘↵), чтобы увидеть строки.</p>
      )}
    </section>
  )
}
