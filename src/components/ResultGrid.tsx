import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { QueryResult } from '../core/arrowToRows'
import { formatCell } from '../core/arrowToRows'
import type { SortSpec } from '../core/resultQuery'

const ROW_H = 28
const COL_W = 160

export function ResultGrid({
  result,
  sorts,
  onToggleSort,
  onOpenFilter,
}: {
  result: QueryResult
  sorts: SortSpec[]
  onToggleSort: (col: string, additive: boolean) => void
  onOpenFilter: (col: string, rect: DOMRect) => void
}) {
  const parentRef = useRef<HTMLDivElement>(null)
  const { columns, rows } = result
  // TanStack Virtual returns non-memoized fns; the hook is stable here. (known, accepted)
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
    useFlushSync: false, // React 19: silence flushSync-in-lifecycle warning
  })
  const gridW = columns.length * COL_W
  const sortIndex = (name: string) => sorts.findIndex((s) => s.col === name)

  return (
    <div className="grid-scroll" ref={parentRef}>
      <div className="grid-head" style={{ width: gridW }}>
        {columns.map((c) => {
          const si = sortIndex(c.name)
          const dir = si >= 0 ? sorts[si].dir : null
          return (
            <div className="grid-cell grid-th" key={c.name} style={{ width: COL_W }} title={`${c.name}: ${c.type}`}>
              <span className="th-label" onClick={(e) => onToggleSort(c.name, e.shiftKey)}>
                {c.name}
                {dir && <span className="th-sort">{dir === 'asc' ? '▲' : '▼'}{sorts.length > 1 ? si + 1 : ''}</span>}
              </span>
              <button
                className="th-filter"
                title="фильтр по колонке"
                onClick={(e) => onOpenFilter(c.name, (e.currentTarget as HTMLElement).getBoundingClientRect())}
              >⏷</button>
            </div>
          )
        })}
      </div>
      <div
        className="grid-body"
        style={{ height: rowVirtualizer.getTotalSize(), width: gridW }}
      >
        {rowVirtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index]
          return (
            <div
              className="grid-row"
              key={vi.key}
              style={{ transform: `translateY(${vi.start}px)`, width: gridW }}
            >
              {columns.map((c) => {
                const v = row[c.name]
                return (
                  <div
                    className="grid-cell"
                    key={c.name}
                    style={{
                      width: COL_W,
                      textAlign: typeof v === 'number' || typeof v === 'bigint' ? 'right' : 'left',
                    }}
                  >
                    {formatCell(v)}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
