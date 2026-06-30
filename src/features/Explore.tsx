import { useSession } from '../state/session'
import type { DuckDBClient } from '../db/duckdbClient'
import { arrowToRows } from '../core/arrowToRows'
import { SqlEditor } from '../components/SqlEditor'
import { ResultPanel } from '../components/ResultPanel'
import { ProfilePanel } from '../components/ProfilePanel'
import { TabStrip } from '../components/TabStrip'
import { Icon } from '../components/Icon'

export function Explore({ client }: { client: DuckDBClient }) {
  const tabs = useSession((s) => s.tabs)
  const activeTabId = useSession((s) => s.activeTabId)
  const updateTabSql = useSession((s) => s.updateTabSql)
  const setTabResult = useSession((s) => s.setTabResult)
  const setTabError = useSession((s) => s.setTabError)
  const exploreView = useSession((s) => s.exploreView)
  const profileTarget = useSession((s) => s.profileTarget)

  const tab = tabs.find((t) => t.id === activeTabId) ?? null

  async function run(sql: string) {
    if (!tab) return
    const t0 = performance.now()
    try {
      const table = await client.query(sql)
      const result = arrowToRows(table)
      setTabResult(tab.id, result, {
        ms: performance.now() - t0,
        rows: result.numRows,
      })
    } catch (e) {
      setTabError(tab.id, String(e))
    }
  }

  if (!tab) {
    return (
      <div className="explore">
        <TabStrip />
        {exploreView === 'profile' && profileTarget?.kind === 'source' ? (
          <section className="result-panel">
            <ProfilePanel />
          </section>
        ) : (
          <div className="explore-empty">
            Открой источник в рейле или нажми «+» для пустого запроса.
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="explore">
      <TabStrip />
      <section className="query-panel">
        <header className="panel-head">
          <span className="panel-title">Запрос</span>
          <button className="run-btn" onClick={() => run(tab.sql)}>
            <Icon name="play" /> запустить
          </button>
        </header>
        <SqlEditor
          key={tab.id}
          value={tab.sql}
          onChange={(v) => updateTabSql(tab.id, v)}
          onRun={run}
        />
      </section>
      <ResultPanel
        result={tab.result}
        meta={tab.meta}
        error={tab.error}
        tabId={tab.id}
        sql={tab.sql}
        client={client}
      />
    </div>
  )
}
