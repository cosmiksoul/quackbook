import { useEffect, useState } from 'react'
import type { ColumnFilter as CF } from '../core/resultQuery'
import { resultTempName, quoteIdent } from '../core/sql'
import { arrowToRows } from '../core/arrowToRows'
import type { DuckDBClient } from '../db/duckdbClient'

function kindOf(duckType: string): 'text' | 'number' | 'date' {
  const t = duckType.toUpperCase()
  if (/INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|HUGEINT/.test(t)) return 'number'
  if (/DATE|TIME/.test(t)) return 'date'
  return 'text'
}
const DISTINCT_MAX = 50

export function ColumnFilter({
  tabId, col, type, client, rect, onApply, onClose,
}: {
  tabId: string; col: string; type: string; client: DuckDBClient
  rect: DOMRect; onApply: (f: CF) => void; onClose: () => void
}) {
  const kind = kindOf(type)
  const [distinct, setDistinct] = useState<(string | null)[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [nullChecked, setNullChecked] = useState(false)
  const [text, setText] = useState(''); const [op, setOp] = useState<'contains' | 'equals' | 'startsWith'>('contains')
  const [min, setMin] = useState(''); const [max, setMax] = useState('')

  useEffect(() => {
    const q = `SELECT DISTINCT ${quoteIdent(col)}::VARCHAR AS v FROM ${quoteIdent(resultTempName(tabId))} ORDER BY v LIMIT ${DISTINCT_MAX + 1}`
    void client.query(q).then((t) => {
      const vals = arrowToRows(t).rows.map((r) => (r.v === null ? null : String(r.v)))
      setDistinct(vals.length <= DISTINCT_MAX ? vals : null)
    }).catch(() => setDistinct(null))
  }, [tabId, col, client])

  function applySet() {
    onApply({ col, type: 'set', values: [...checked], ...(nullChecked ? { includeNull: true } : {}) })
  }
  function applyTyped() {
    if (kind === 'number') onApply({ col, type: 'number', min: min ? Number(min) : null, max: max ? Number(max) : null })
    else if (kind === 'date') onApply({ col, type: 'date', min: min || null, max: max || null })
    else onApply({ col, type: 'text', op, value: text })
  }

  return (
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div className="col-filter" style={{ top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 260) }}>
        {distinct ? (
          <>
            <div className="cf-list">
              {distinct.map((v) => (
                <label key={v ?? '∅'}>
                  <input
                    type="checkbox"
                    checked={v === null ? nullChecked : checked.has(v)}
                    onChange={(e) => {
                      if (v === null) { setNullChecked(e.target.checked); return }
                      const n = new Set(checked)
                      if (e.target.checked) n.add(v)
                      else n.delete(v)
                      setChecked(n)
                    }}
                  />
                  {v === null ? '∅ (null)' : v === '' ? '(пусто)' : v}
                </label>
              ))}
            </div>
            <div className="cf-actions">
              <button onClick={applySet} disabled={checked.size === 0 && !nullChecked}>применить</button>
              <button onClick={onClose}>отмена</button>
            </div>
          </>
        ) : (
          <>
            {kind === 'text' && (<>
              <select value={op} onChange={(e) => setOp(e.target.value as typeof op)}>
                <option value="contains">содержит</option><option value="equals">равно</option><option value="startsWith">начинается</option>
              </select>
              <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="значение" />
            </>)}
            {(kind === 'number' || kind === 'date') && (<div className="cf-range">
              <input value={min} onChange={(e) => setMin(e.target.value)} placeholder={kind === 'date' ? 'от (YYYY-MM-DD)' : 'мин'} />
              <input value={max} onChange={(e) => setMax(e.target.value)} placeholder={kind === 'date' ? 'до' : 'макс'} />
            </div>)}
            <div className="cf-nulls">
              <button onClick={() => onApply({ col, type: 'null', op: 'isNull' })}>is null</button>
              <button onClick={() => onApply({ col, type: 'null', op: 'notNull' })}>not null</button>
            </div>
            <div className="cf-actions"><button onClick={applyTyped}>применить</button><button onClick={onClose}>отмена</button></div>
          </>
        )}
      </div>
    </>
  )
}
