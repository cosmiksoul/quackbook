import { useState } from 'react'
import { marked } from 'marked'
import type { TextBlock } from '../core/report'
import { useSession } from '../state/session'

const PLACEHOLDER = '_пустой текст — кликни, чтобы редактировать_'

export function TextBlockView({ block }: { block: TextBlock }) {
  const updateTextBlock = useSession((s) => s.updateTextBlock)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(block.markdown)

  if (editing) {
    return (
      <textarea
        className="text-block-edit"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== block.markdown) updateTextBlock(block.id, draft)
          setEditing(false)
        }}
      />
    )
  }

  // local single-user content, no untrusted input -> no sanitizer (CLAUDE.md rule 2)
  const html = marked.parse(block.markdown || PLACEHOLDER) as string
  return (
    <div
      className="text-block"
      onClick={() => {
        setDraft(block.markdown)
        setEditing(true)
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
