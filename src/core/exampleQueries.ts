// 4 product-analytics recipes from the cookbook, ported BigQuery -> DuckDB, over
// the demo tables `users` (parquet, typed) + `payments` (csv). payments columns
// are cast explicitly (CAST(... AS DATE/DOUBLE/BIGINT)) so a recipe runs whether
// or not payments has been typed: those casts accept both the typed column and
// its all-VARCHAR form. (String functions like replace() do NOT accept a typed
// column, so we never feed one a bare column ref — auto-typing turns DateUTC,
// trailing " UTC" and all, straight into a TIMESTAMP.)
export const EXAMPLE_QUERIES: { title: string; sql: string }[] = [
  {
    title: 'DAU — дневная аудитория',
    sql: `SELECT CAST(DateUTC AS DATE) AS day, count(DISTINCT UserID) AS dau
FROM users
GROUP BY 1
ORDER BY 1;`,
  },
  {
    title: 'Выручка по дням (накопительно)',
    sql: `SELECT day,
       sum(daily_revenue) OVER (ORDER BY day) AS cumulative_revenue,
       daily_revenue
FROM (
  SELECT CAST(DateUTC AS DATE) AS day,
         sum(CAST(RevenueUSD AS DOUBLE)) AS daily_revenue
  FROM payments
  GROUP BY 1
)
ORDER BY day;`,
  },
  {
    title: 'ARPU vs ARPPU',
    sql: `SELECT
  round(sum(CAST(p.RevenueUSD AS DOUBLE)) / (SELECT count(DISTINCT UserID) FROM users), 2) AS arpu,
  round(sum(CAST(p.RevenueUSD AS DOUBLE)) / count(DISTINCT p.UserID), 2) AS arppu
FROM payments p;`,
  },
  {
    title: 'A/B-uplift: конверсия в оплату',
    sql: `SELECT u.ControlOrTest AS variant,
       count(DISTINCT u.UserID) AS users,
       count(DISTINCT p.UserID) AS payers,
       round(100.0 * count(DISTINCT p.UserID) / count(DISTINCT u.UserID), 2) AS conversion_pct
FROM users u
LEFT JOIN payments p ON CAST(p.UserID AS BIGINT) = u.UserID
GROUP BY 1
ORDER BY 1;`,
  },
]
