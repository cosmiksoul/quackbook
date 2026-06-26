import { useState } from 'react'
import { useSession } from '../state/session'

export function TabStrip() {
  const tabs = useSession((s) => s.tabs)
  const activeTabId = useSession((s) => s.activeTabId)
  const setActiveTab = useSession((s) => s.setActiveTab)
  const closeTab = useSession((s) => s.closeTab)
  const openBlankTab = useSession((s) => s.openBlankTab)
  const renameTab = useSession((s) => s.renameTab)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  function startEdit(id: string, title: string) {
    setEditingId(id)
    setDraft(title)
  }
  function commit() {
    if (editingId && draft.trim()) renameTab(editingId, draft.trim())
    setEditingId(null)
  }

  return (
    <div className="tab-strip">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={t.id === activeTabId ? 'tab on' : 'tab'}
          onClick={() => setActiveTab(t.id)}
          onDoubleClick={() => startEdit(t.id, t.title)}
        >
          {editingId === t.id ? (
            <input
              className="tab-rename"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                else if (e.key === 'Escape') setEditingId(null)
              }}
            />
          ) : (
            <span className="tab-title">{t.title}</span>
          )}
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation()
              closeTab(t.id)
            }}
            aria-label="закрыть таб"
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-add" onClick={() => openBlankTab()} aria-label="новый таб">
        +
      </button>
    </div>
  )
}
