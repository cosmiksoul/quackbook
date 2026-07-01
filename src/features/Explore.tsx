import { useEffect, useMemo, useRef } from 'react'
import { useSession } from '../state/session'
import type { DuckDBClient } from '../db/duckdbClient'
import { useResultActions } from './useResultActions'
import { SqlEditor } from '../components/SqlEditor'
import { buildSqlSchema } from '../core/sqlSchema'
import { ResultPanel } from '../components/ResultPanel'
import { ProfilePanel } from '../components/ProfilePanel'
import { TabStrip } from '../components/TabStrip'
import { Icon } from '../components/Icon'

export function Explore({ client }: { client: DuckDBClient }) {
  const tabs = useSession((s) => s.tabs)
  const activeTabId = useSession((s) => s.activeTabId)
  const updateTabSql = useSession((s) => s.updateTabSql)
  const exploreView = useSession((s) => s.exploreView)
  const profileTarget = useSession((s) => s.profileTarget)
  const datasets = useSession((s) => s.datasets)
  const schema = useMemo(() => buildSqlSchema(datasets), [datasets])

  const tab = tabs.find((t) => t.id === activeTabId) ?? null
  const { runQuery, fetchWindow, dropResult } = useResultActions(client)

  async function run(sql: string) {
    if (!tab) return
    await runQuery(tab.id, sql)
  }

  // Refetch the window whenever the active tab's view changes (page/sort/search/filter).
  const view = tab?.view
  useEffect(() => {
    if (tab && tab.mode === 'paged') void fetchWindow(tab.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.id, view?.page, view?.pageSize, JSON.stringify(view?.sorts), view?.search, JSON.stringify(view?.filters)])

  // Drop result tables for tabs that were closed.
  const knownTabs = useRef<Set<string>>(new Set())
  useEffect(() => {
    const now = new Set(tabs.map((t) => t.id))
    for (const id of knownTabs.current) if (!now.has(id)) void dropResult(id)
    knownTabs.current = now
  }, [tabs, dropResult])

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
          schema={schema}
        />
      </section>
      <ResultPanel
        meta={tab.meta}
        error={tab.error}
        tabId={tab.id}
        sql={tab.sql}
        client={client}
      />
    </div>
  )
}
