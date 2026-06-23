import { arrowToRows } from '../core/arrowToRows'
import {
  buildHistogramQuery,
  buildNullCountQuery,
  buildTopValuesQuery,
  classifyColumn,
  interpretHistogram,
  interpretNullCounts,
  interpretTopValues,
  parseSummarize,
  type ColumnProfile,
  HISTOGRAM_BINS,
  THRESHOLD_DISTINCT,
  TOP_K,
} from '../core/profile'
import { quoteIdent } from '../core/sql'
import type { DuckDBClient } from '../db/duckdbClient'
import { useSession } from '../state/session'

/** A relation's full profile: per-column profiles + its row count. */
export interface RelationProfile {
  profiles: ColumnProfile[]
  rowCount: number
}

/**
 * The shared profiler core: profile a relation BY NAME (a real table or a
 * materialized result table). Pure side effects (queries) live here, no store.
 * Pipeline (spec lines 79-86): SUMMARIZE -> one null-count pass (also yields
 * the row count) -> classify -> per categorical a top-K query -> per numeric a
 * histogram query (omitted when hi == lo) -> assemble ColumnProfile[]. Counts
 * are Number()-ed; min/max/median parsed to numbers for numeric, kept strings
 * for range. Returns the column profiles + the relation row count (caption).
 */
export async function profileRelation(
  client: DuckDBClient,
  name: string,
): Promise<RelationProfile> {
  // 1. SUMMARIZE -> per-column facts (stats are strings, approx_unique Number).
  const summary = parseSummarize(
    arrowToRows(await client.query(`SUMMARIZE ${quoteIdent(name)}`)),
  )
  const colNames = summary.map((c) => c.name)

  // 2. one clean null-count pass (+ total row count).
  const ncRow = arrowToRows(await client.query(buildNullCountQuery(name, colNames))).rows[0] ?? {}
  const { total, nulls } = interpretNullCounts(ncRow, colNames)

  // 3..5. classify + per-kind detail query.
  const profiles: ColumnProfile[] = []
  for (const col of summary) {
    const kind = classifyColumn(col.type, col.approxUnique, THRESHOLD_DISTINCT)
    const base: ColumnProfile = {
      name: col.name,
      type: col.type,
      distinct: col.approxUnique,
      nullCount: nulls[col.name] ?? 0,
      kind,
    }

    if (kind === 'categorical') {
      const top = interpretTopValues(
        arrowToRows(await client.query(buildTopValuesQuery(name, col.name, TOP_K))).rows,
      )
      base.top = top
      base.moreDistinct = Math.max(0, col.approxUnique - top.length)
    } else if (kind === 'numeric') {
      const lo = col.min == null ? NaN : Number(col.min)
      const hi = col.max == null ? NaN : Number(col.max)
      // all-null numeric -> min/max null -> lo/hi NaN -> no stats, no histogram
      // (the card shows an explicit null marker — spec line 93).
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        const median = col.median == null ? NaN : Number(col.median)
        base.stats = { min: lo, median, max: hi } // median may be NaN; card renders «—»
        const histSql = buildHistogramQuery(name, col.name, lo, hi, HISTOGRAM_BINS)
        if (histSql) {
          base.histogram = interpretHistogram(
            arrowToRows(await client.query(histSql)).rows,
            lo,
            hi,
            HISTOGRAM_BINS,
          )
        }
      }
    } else if (kind === 'range') {
      base.range = { min: col.min ?? '', median: col.median ?? '', max: col.max ?? '' }
    }
    // highCardinality: distinct + nullCount only.

    profiles.push(base)
  }
  return { profiles, rowCount: total }
}

/**
 * Source-target orchestration: profile a dataset table, cache into the store.
 * Errors go to the store (setProfileError), never thrown — mirrors useSchemaActions.
 */
export function useProfileActions(client: DuckDBClient) {
  async function profile(table: string): Promise<void> {
    const st = useSession.getState()
    const ds = st.datasets.find((d) => d.table === table)
    if (!ds || ds.profile) return // cached -> no-op
    st.setProfiling(table, true)
    try {
      const { profiles, rowCount } = await profileRelation(client, table)
      useSession.getState().setProfile(table, profiles, rowCount)
    } catch (e) {
      useSession.getState().setProfileError(table, String(e))
    }
  }

  return { profile }
}
