import { Marked } from 'marked'

// For element TEXT content / <pre> only — every call site is text, never an
// attribute, so not escaping single quotes is intentional and safe.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Отдельный инстанс marked: сырой HTML НЕ пропускается, а экранируется.
// Отчёт — импортируемый формат (открытие .json + localStorage + экспорт .html),
// поэтому текст блоков — недоверенный ввод (XSS, review 2026-07-02).
const md = new Marked({
  renderer: {
    html(token) {
      return escapeHtml(token.text)
    },
  },
})

/** Markdown -> HTML; сырой HTML внутри markdown экранирован. */
export function renderMarkdown(markdown: string): string {
  return md.parse(markdown, { async: false }) as string
}
