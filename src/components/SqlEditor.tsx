import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { EditorState, Prec, Compartment } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { sql } from '@codemirror/lang-sql'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'

// SQL token colors, tuned to the app's warm-amber-on-teal palette (index.css tokens).
const qbHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#e3a95c', fontWeight: '600' },
  { tag: [t.typeName, t.typeOperator], color: '#cf933f' },
  { tag: [t.string, t.special(t.string)], color: '#9dc98f' },
  { tag: [t.number, t.integer, t.float], color: '#74c0c8' },
  { tag: [t.bool, t.null, t.atom], color: '#e8826a' },
  { tag: t.function(t.variableName), color: '#e6c48f' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#5f7d78', fontStyle: 'italic' },
  { tag: [t.operator, t.compareOperator, t.logicOperator, t.arithmeticOperator], color: '#8fa8a3' },
  { tag: [t.punctuation, t.separator, t.paren, t.bracket], color: '#7c9490' },
])

// Dark editor chrome (gutter/cursor/selection/active line) matching the theme.
const qbEditorTheme = EditorView.theme(
  {
    '&': { color: 'var(--text)', backgroundColor: 'transparent' },
    '.cm-content': { caretColor: 'var(--accent)', fontFamily: 'var(--font-mono)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '& ::selection': { backgroundColor: 'rgba(227,169,92,.20)' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,.03)' },
    '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--text-faint)', border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,.03)', color: 'var(--text-dim)' },
    '.cm-tooltip': { backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--surface-2)', color: 'var(--text)' },
  },
  { dark: true },
)

interface Props {
  value: string
  onChange: (value: string) => void
  onRun: (sql: string) => void
  schema?: Record<string, string[]>
}

export function SqlEditor({ value, onChange, onRun, schema }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Keep latest callbacks in a ref so the mount-once extensions never go stale.
  const cb = useRef({ onChange, onRun })
  // eslint-disable-next-line react-hooks/refs
  cb.current = { onChange, onRun }

  const schemaComp = useRef(new Compartment())
  const schemaRef = useRef(schema)
  // eslint-disable-next-line react-hooks/refs
  schemaRef.current = schema

  // Drag-resizable height via the bottom handle — a much bigger target than the
  // native 16px corner grip. Default 168px; per-tab (SqlEditor is keyed by tab
  // id in Explore, so it resets to default on tab switch).
  const [height, setHeight] = useState(168)
  function startResize(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const bar = e.currentTarget
    const startY = e.clientY
    const startH = host.current?.offsetHeight ?? height
    bar.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => setHeight(Math.max(84, startH + (ev.clientY - startY)))
    const onUp = () => {
      bar.releasePointerCapture(e.pointerId)
      bar.removeEventListener('pointermove', onMove)
      bar.removeEventListener('pointerup', onUp)
    }
    bar.addEventListener('pointermove', onMove)
    bar.addEventListener('pointerup', onUp)
  }

  // Mount once. Do NOT depend on `value` (would recreate the editor per keystroke).
  useEffect(() => {
    const runKey = Prec.high(
      keymap.of([
        {
          key: 'Mod-Enter',
          run: (v) => {
            cb.current.onRun(v.state.doc.toString())
            return true // consume: no newline inserted
          },
        },
      ]),
    )
    const listener = EditorView.updateListener.of((u) => {
      if (u.docChanged) cb.current.onChange(u.state.doc.toString())
    })
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        qbEditorTheme,
        syntaxHighlighting(qbHighlight),
        schemaComp.current.of(sql({ schema: schemaRef.current ?? {} })),
        autocompletion(),
        runKey,
        keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap]),
        listener,
      ],
    })
    const v = new EditorView({ state, parent: host.current! })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync external value ONLY when it diverges from the doc (prevents cursor jump).
  useEffect(() => {
    const v = view.current
    if (!v) return
    const current = v.state.doc.toString()
    if (value === current) return
    v.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  // Reconfigure the SQL language with the latest schema when datasets change.
  useEffect(() => {
    const v = view.current
    if (!v) return
    v.dispatch({ effects: schemaComp.current.reconfigure(sql({ schema: schema ?? {} })) })
  }, [schema])

  return (
    <div className="sql-editor-wrap">
      <div className="sql-editor" ref={host} style={{ height }} />
      <div
        className="sql-resize"
        onPointerDown={startResize}
        title="потяни, чтобы изменить высоту редактора"
      />
    </div>
  )
}
