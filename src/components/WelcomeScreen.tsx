import { useState } from 'react'
import type { DuckDBClient } from '../db/duckdbClient'
import { useSchemaActions } from '../features/useSchemaActions'
import { loadDemoData, seedExampleTabs, loadSampleReport } from '../features/demoData'

export function WelcomeScreen({ client }: { client: DuckDBClient }) {
  const { applyInferred } = useSchemaActions(client)
  const [busy, setBusy] = useState<null | 'data' | 'report'>(null)

  async function onData() {
    setBusy('data')
    try {
      await loadDemoData(client, applyInferred)
      seedExampleTabs()
    } catch (e) {
      alert('Не удалось загрузить демо-данные: ' + String(e))
    } finally {
      setBusy(null)
    }
  }

  async function onReport() {
    setBusy('report')
    try {
      await loadDemoData(client, applyInferred)
      await loadSampleReport()
    } catch (e) {
      alert('Не удалось открыть пример отчёта: ' + String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="welcome">
      <h1 className="welcome-title">Аналитический ноутбук в браузере</h1>
      <p className="welcome-lead">
        Брось CSV или Parquet в панель слева — и работай: пиши SQL с JOIN/UNION,
        смотри профиль значений, закрепляй результаты виджетами и собирай
        нарративный отчёт. Всё локально, без бэкенда.
      </p>
      <ol className="welcome-steps">
        <li><b>Данные.</b> CSV/Parquet → схема и типы в рейле слева.</li>
        <li><b>Исследование.</b> SQL → таблица, график, профиль значений.</li>
        <li><b>Отчёт.</b> Закрепи виджеты, впиши текст, выгрузи в HTML/PDF.</li>
      </ol>
      <div className="welcome-actions">
        <button className="welcome-cta" disabled={busy !== null} onClick={onData}>
          {busy === 'data' ? 'Грузим…' : 'Загрузить демо-данные'}
        </button>
        <button className="welcome-cta ghost" disabled={busy !== null} onClick={onReport}>
          {busy === 'report' ? 'Грузим…' : 'Открыть пример отчёта'}
        </button>
      </div>
      <p className="welcome-credit">
        Демо-данные из учебника{' '}
        <a href="https://github.com/cosmiksoul/sql-product-analytics-cookbook" target="_blank" rel="noopener noreferrer">
          «SQL 101: Рецепты продуктового аналитика»
        </a>{' '}
        · MIT. Запросы в книге на BigQuery — примеры в демо адаптированы под DuckDB.
      </p>
    </div>
  )
}
