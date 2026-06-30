import { useEffect } from 'react'

export function AboutModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="О quackbook" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" aria-label="закрыть" onClick={onClose}>✕</button>
        <h2>quackbook</h2>
        <p>Браузерный аналитический ноутбук: данные → SQL и профиль значений → нарративный отчёт с экспортом. Без бэкенда.</p>
        <h3>Как устроено</h3>
        <p>DuckDB-WASM в Web Worker (Apache Arrow). Всё исполняется в браузере, статика на GitHub Pages — данные никуда не уходят.</p>
        <h3>Ограничения v1</h3>
        <ul>
          <li>только локально загруженные файлы (CSV / Parquet);</li>
          <li>перезагрузка страницы очищает данные (без персиста);</li>
          <li>экспорт самодостаточный: HTML / PDF / CSV / Parquet.</li>
        </ul>
        <h3>Данные демо</h3>
        <p>Из учебника «SQL 101: Рецепты продуктового аналитика» (MIT).</p>
        <p className="modal-foot">
          MIT ·{' '}
          <a href="https://github.com/cosmiksoul/sql-product-analytics-cookbook" target="_blank" rel="noopener noreferrer">учебник</a>
        </p>
      </div>
    </div>
  )
}
