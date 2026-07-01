import { useRef, type ChangeEvent } from 'react'
import type { DuckDBClient } from '../db/duckdbClient'
import { useSession } from '../state/session'
import { TextBlockView } from '../components/TextBlockView'
import { WidgetBlockView } from '../components/WidgetBlockView'
import { RehydrationBanner } from '../components/RehydrationBanner'
import { serializeReport, deserializeReport } from '../core/report'
import { renderReport, downloadHtml, printHtml } from './exportReport'

export function Report({ client }: { client: DuckDBClient }) {
  const report = useSession((s) => s.report)
  const activeBlockId = useSession((s) => s.activeBlockId)
  const addTextBlock = useSession((s) => s.addTextBlock)
  const setActiveBlock = useSession((s) => s.setActiveBlock)
  const loadReport = useSession((s) => s.loadReport)
  const datasets = useSession((s) => s.datasets)
  const setToast = useSession((s) => s.setToast)
  const fileRef = useRef<HTMLInputElement>(null)

  function save() {
    const json = serializeReport(report)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'quackbook-report.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function open(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    try {
      const doc = deserializeReport(await file.text())
      loadReport(doc)
    } catch (err) {
      alert('Не удалось открыть отчёт: ' + String(err))
    }
  }

  async function exportHtml() {
    const loaded = datasets.map((d) => d.table)
    const { html, missingCount } = await renderReport(client, report, loaded)
    if (missingCount > 0) {
      setToast(`${missingCount} виджет(ов) без данных — выгружены с пометкой`)
    }
    downloadHtml(html, 'quackbook-report.html')
  }

  async function exportPdf() {
    const loaded = datasets.map((d) => d.table)
    const { html, missingCount } = await renderReport(client, report, loaded)
    if (missingCount > 0) {
      setToast(`${missingCount} виджет(ов) без данных — попадут в печать с пометкой`)
    }
    printHtml(html)
  }

  function clearReport() {
    if (report.blocks.length === 0) return
    // Clear by loading an empty doc — the autosave subscriber removes the
    // localStorage key on an empty report. Confirm: this wipes the notebook
    // (the structure can be kept via «сохранить» first).
    if (confirm('Очистить отчёт? Все блоки удалятся (структуру можно сохранить в JSON).')) {
      loadReport({ version: 1, blocks: [] })
    }
  }

  return (
    <div className="report">
      <RehydrationBanner />
      <div className="report-toolbar">
        <div className="toolbar-left">
          <button onClick={() => addTextBlock()}>+ текст</button>
          <button onClick={() => addTextBlock('```sql\n-- код\n```')}>+ код</button>
        </div>
        <div className="toolbar-right">
          {report.blocks.length > 0 && (
            <div className="tb-group">
              <span className="export-label">экспорт в</span>
              <button onClick={exportHtml}>HTML</button>
              <button onClick={exportPdf}>PDF</button>
            </div>
          )}
          <div className="tb-group">
            <span className="export-label">отчёт</span>
            <button onClick={save}>сохранить</button>
            <button onClick={() => fileRef.current?.click()}>открыть</button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={open}
          />
          {report.blocks.length > 0 && (
            <button className="report-clear" onClick={clearReport}>
              очистить
            </button>
          )}
        </div>
      </div>

      {report.blocks.length === 0 ? (
        <div className="report-stub">
          Закрепи результат в Исследовании (📌) или добавь текстовый блок.
        </div>
      ) : (
        <div className="report-stack">
          {report.blocks.map((block) => (
            <div
              key={block.id}
              className={
                block.id === activeBlockId
                  ? 'report-block active'
                  : 'report-block'
              }
              onClick={() => setActiveBlock(block.id)}
            >
              {block.type === 'text' ? (
                <TextBlockView block={block} />
              ) : (
                <WidgetBlockView key={block.sql} block={block} client={client} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
