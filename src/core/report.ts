export type TextBlock = { type: 'text'; id: string; markdown: string }

export type WidgetBlock = {
  type: 'widget'
  id: string
  title: string
  sql: string
  datasetNames: string[]
  vizType: 'table' | 'chart'
  caption: string
}

export type Block = TextBlock | WidgetBlock

export type ReportDoc = { version: 1; blocks: Block[] }

/** Stable, pretty JSON of the report STRUCTURE (no widget results). */
export function serializeReport(doc: ReportDoc): string {
  return JSON.stringify(doc, null, 2)
}

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function validateBlock(b: unknown): Block {
  if (typeof b !== 'object' || b === null) throw new Error('malformed report')
  const r = b as Record<string, unknown>
  if (r.type === 'text') {
    if (!isString(r.id) || !isString(r.markdown)) {
      throw new Error('malformed report')
    }
    return { type: 'text', id: r.id, markdown: r.markdown }
  }
  if (r.type === 'widget') {
    if (
      !isString(r.id) ||
      !isString(r.title) ||
      !isString(r.sql) ||
      !Array.isArray(r.datasetNames) ||
      !r.datasetNames.every(isString) ||
      (r.vizType !== 'table' && r.vizType !== 'chart') ||
      !isString(r.caption)
    ) {
      throw new Error('malformed report')
    }
    return {
      type: 'widget',
      id: r.id,
      title: r.title,
      sql: r.sql,
      datasetNames: r.datasetNames as string[],
      vizType: r.vizType,
      caption: r.caption,
    }
  }
  throw new Error('malformed report')
}

/**
 * Parse + validate a report doc. `version` must be exactly 1, `blocks` an
 * array, each block a known type with its required primitive fields. Unknown
 * EXTRA fields inside a block are tolerated (forward-friendly): we rebuild each
 * block from its known fields and drop extras. Throws on bad JSON / version /
 * shape.
 */
export function deserializeReport(json: string): ReportDoc {
  const parsed: unknown = JSON.parse(json)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('malformed report')
  }
  const obj = parsed as Record<string, unknown>
  if (obj.version !== 1) throw new Error('unsupported report version')
  if (!Array.isArray(obj.blocks)) throw new Error('malformed report')
  return { version: 1, blocks: obj.blocks.map(validateBlock) }
}

/**
 * The set of dataset tables every WIDGET block depends on, deduped + sorted
 * ascending. Text blocks contribute nothing. Drives the rehydration banner
 * (which sources the report needs vs which are loaded).
 */
export function neededDatasets(doc: ReportDoc): string[] {
  const all = new Set<string>()
  for (const b of doc.blocks) {
    if (b.type === 'widget') for (const t of b.datasetNames) all.add(t)
  }
  return [...all].sort()
}
