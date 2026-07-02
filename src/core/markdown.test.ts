import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders normal markdown', () => {
    expect(renderMarkdown('**жирный**')).toContain('<strong>жирный</strong>')
  })
  it('renders lists', () => {
    expect(renderMarkdown('- пункт')).toContain('<li>пункт</li>')
  })
  it('escapes block-level raw HTML instead of passing it through', () => {
    const out = renderMarkdown('<img src=x onerror="alert(1)">')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })
  it('escapes inline raw HTML inside a paragraph', () => {
    const out = renderMarkdown('до <script>alert(1)</script> после')
    expect(out).not.toContain('<script>')
  })
})
