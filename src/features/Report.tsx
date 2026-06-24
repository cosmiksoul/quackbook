import { useRef, type ChangeEvent } from 'react'
import type { DuckDBClient } from '../db/duckdbClient'
import { useSession } from '../state/session'
import { TextBlockView } from '../components/TextBlockView'
import { WidgetBlockView } from '../components/WidgetBlockView'
import { serializeReport, deserializeReport } from '../core/report'

export function Report({ client }: { client: DuckDBClient }) {
  const report = useSession((s) => s.report)
  const activeBlockId = useSession((s) => s.activeBlockId)
  const addTextBlock = useSession((s) => s.addTextBlock)
  const setActiveBlock = useSession((s) => s.setActiveBlock)
  const loadReport = useSession((s) => s.loadReport)
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

  return (
    <div className="report">
      <div className="report-toolbar">
        <button onClick={() => addTextBlock()}>+ текст</button>
        <button onClick={save}>сохранить</button>
        <button onClick={() => fileRef.current?.click()}>открыть</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={open}
        />
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
                <WidgetBlockView block={block} client={client} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
