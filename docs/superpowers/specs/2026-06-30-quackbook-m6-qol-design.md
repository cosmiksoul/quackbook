# quackbook M6 «Quality of life» — дизайн

**Статус:** дизайн принят пользователем, готов к написанию плана.
**Ветка:** `m6-qol` (от `main`).
**Дата:** 2026-06-30.

## Цель

Снизить порог входа и доточить эргономику отгруженного v1 четырьмя firewall-чистыми
улучшениями, углубляющими существующий цикл (данные → SQL/профиль → отчёт → экспорт),
не добавляя новых структурных поверхностей:

1. **Онбординг** — welcome-экран на пустом состоянии Исследования.
2. **Демо-данные** из учебника пользователя «SQL 101: Рецепты продуктового аналитика»
   (`github.com/cosmiksoul/sql-product-analytics-cookbook`, MIT) + засеянные примеры
   запросов + готовый пример отчёта + ссылка на книгу.
3. **Экспорт результата** запроса в CSV / Parquet.
4. **Схема-осознанный SQL-автокомплит** (таблицы + их колонки).
5. **About/архитектура** — модалка по «?» в топбаре.

## Глобальные ограничения (наследуются всеми задачами плана)

- **Стек/пины не трогаем:** `@duckdb/duckdb-wasm@1.32.0`, `apache-arrow@17.0.0`, React 19,
  Vite 8. **Новых зависимостей нет** — `@codemirror/lang-sql@6.10.0` уже в `dependencies`.
- **Детерминизм:** id только через стор-счётчик `seq`; **никаких** `Math.random` / `Date.now` /
  `new Date` (падают в тулчейне).
- **TDD-граница:** логика (данные/чистые функции/пламбинг) — red→green Vitest (node env,
  `src/**/*.test.ts`); презентация (welcome/About/кнопки/попап) — глазами. Без jsdom/RTL.
- **Гейт каждой задачи:** `npm run lint` 0 ошибок + `npm run build` (полный tsc) + `npm test`.
- **Хирургические правки**, следование существующим паттернам.
- **Firewall (CLAUDE.md) — НЕ строим:** dashboard-грид/канвас/drag-resize/много-колонок,
  визуальный join-builder, правку ячеек/вычисляемые колонки, OPFS-персист, шеринг-ссылкой/
  права, таб «План». welcome/About — это **состояния/оверлей, не роуты**.

## Источник демо-данных

Учебник пользователя, лицензия **MIT** (редистрибуция разрешена; сохраняем нотис + кредит).
Две связанные таблицы, join по `UserID` (BIGINT, 18-значный → опирается на правило
quackbook BigInt→строка в отображении):

| Таблица | Колонки |
|---|---|
| **payments** | `UserID`, `DateUTC`, `RevenueUSD`, `PaymentAttemptID`, `RenewalType` (New/Renewal) |
| **users** | `UserID`, `DateUTC`, `ControlOrTest` (A/B-группа), `PhotoCount`, `MaritalStatus` |

Домен — подписочный/dating-продукт. `DateUTC` в форме `2025-07-28 05:29:26.58 UTC`
(суффикс ` UTC` + дробные секунды).

### Решения по формату (зафиксировано через AskUserQuestion)

- **`payments` → CSV** (`public/demo/payments.csv`, ~322 КБ). Грузится штатным `loadOneFile`
  (all_varchar baseline). Демо-загрузчик **применяет инференс-типизацию** к `payments` сразу
  после загрузки (через существующий `useSchemaActions.applyInferred`), так `RevenueUSD`→DOUBLE,
  `PaymentAttemptID`/`UserID`→BIGINT. `DateUTC` инференс **не** типизирует (суффикс ` UTC`) —
  остаётся VARCHAR и парсится в примерах запросов. Это честный data-quality момент из книги.
- **`users` → Parquet** (`public/demo/users.parquet`, ~сотни КБ вместо 3.75 МБ CSV). Конвертация
  build-time (см. data-prep): `DateUTC`→TIMESTAMP, `UserID`→BIGINT, `PhotoCount`→INTEGER,
  `ControlOrTest`/`MaritalStatus`→VARCHAR. Грузится штатным `loadOneFile` (parquet-ветка, нативные типы).
- Так демо задействует **оба** пути загрузки quackbook (CSV+типизация и Parquet).
- Демо-файлы грузятся **по клику** (не на старте) — размер не бьёт по initial load.

## Пиллар 1+2 — Онбординг + демо

### Навигация (зафиксировано)
- **WelcomeScreen заменяет `explore-empty`** в `Shell.tsx` (когда `mode==='explore' && datasets.length===0`).
  Никакого нового роута.
- **About — кнопка «?»** в `topbar-right` → `AboutModal` (оверлей). Доступен всегда.

### WelcomeScreen (`src/components/WelcomeScreen.tsx`)
Содержимое: заголовок «что это» (1-2 строки) + 3-шаговый сценарий (данные → SQL+профиль →
отчёт+экспорт) + кредит/ссылка на книгу (репо + бесплатный PDF, «данные: … MIT») + **две кнопки**:

- **«Загрузить демо-данные»** → `loadDemoData(client)` (грузит `users`+`payments`, типизирует
  payments) + `seedExampleTabs()` (4 таба с готовым SQL, первый активен). Сразу есть что запускать.
- **«Открыть пример отчёта»** → `loadDemoData(client)` (идемпотентно) + `loadSampleReport(client)` +
  `setMode('report')`.

Кнопки во время загрузки — в состоянии «грузим…» (дизейбл). Ошибка fetch/load → существующий
alert-путь, как в `Shell.handleFiles`.

### Оркестратор (`src/features/demoData.ts`)
- `loadDemoData(client, deps): Promise<void>` — для каждого демо-файла: `fetch(url)` →
  `new File([bytes], name)` → существующий `loadOneFile(client, file, taken)` → `addDataset(ds)`.
  Идемпотентно (если `users`/`payments` уже есть — пропустить). После payments — применить инференс.
  `deps` = нужные стор-экшены/`applyInferred` (передаём из React-вызова, не тянем стор внутри утиля).
- Имена таблиц **детерминированы**: `tableNameFromFilename('payments.csv')→'payments'`,
  `'users.parquet'→'users'` — поэтому SQL примеров и виджеты готового отчёта резолвятся в свежей сессии.
- `seedExampleTabs(deps)` — создаёт N табов из `EXAMPLE_QUERIES` через новый стор-экшен
  `seedTabs(tabs: {title, sql}[])` (детерминированные id через `seq`; первый таб активен).
- `loadSampleReport(client, deps)` — `fetch('demo/sample-report.json')` → `deserializeReport(text)` →
  `loadReport(doc)`.

### Стор: новый экшен `seedTabs`
`seedTabs: (tabs: { title: string; sql: string }[]) => void` — добавляет табы пачкой
(каждый: id из `seq`, `datasetTable: null`, заданные `title`/`sql`), активным делает первый из пачки.
Чистая мутация поверх существующей `Tab`-модели.

### Примеры запросов (`src/core/exampleQueries.ts`)
`EXAMPLE_QUERIES: { title: string; sql: string }[]` — 4 рецепта, портированных на DuckDB.
Предлагаемый набор (план финализирует/проверит на реальных данных):

1. **DAU — дневная аудитория** (`users`):
   ```sql
   SELECT CAST(DateUTC AS DATE) AS day, count(DISTINCT UserID) AS dau
   FROM users GROUP BY 1 ORDER BY 1;
   ```
2. **Выручка по дням + накопительно** (`payments`, window + парс DateUTC):
   ```sql
   SELECT day, daily_revenue,
          sum(daily_revenue) OVER (ORDER BY day) AS cumulative_revenue
   FROM (
     SELECT CAST(strptime(replace(DateUTC,' UTC',''), '%Y-%m-%d %H:%M:%S.%f') AS DATE) AS day,
            sum(RevenueUSD) AS daily_revenue
     FROM payments GROUP BY 1
   ) ORDER BY day;
   ```
3. **ARPU vs ARPPU** (join, ARPU=выручка/все юзеры, ARPPU=выручка/платящие):
   ```sql
   SELECT
     round(sum(p.RevenueUSD) / (SELECT count(DISTINCT UserID) FROM users), 2) AS arpu,
     round(sum(p.RevenueUSD) / count(DISTINCT p.UserID), 2) AS arppu
   FROM payments p;
   ```
4. **A/B-uplift конверсии в оплату** (`ControlOrTest` × наличие платежа):
   ```sql
   SELECT u.ControlOrTest AS variant,
          count(DISTINCT u.UserID) AS users,
          count(DISTINCT p.UserID) AS payers,
          round(100.0 * count(DISTINCT p.UserID) / count(DISTINCT u.UserID), 2) AS conversion_pct
   FROM users u LEFT JOIN payments p ON p.UserID = u.UserID
   GROUP BY 1 ORDER BY 1;
   ```

### Готовый отчёт (`public/demo/sample-report.json`)
Сериализованный `ReportDoc` (`{ version: 1, blocks: [...] }`), авторизуется вручную с
детерминированными id; грузится штатным `deserializeReport`/`loadReport`. Структура:
заголовок (text) + интро (text) + виджет DAU (chart) + нота (text) + виджет накопительной
выручки (chart) + виджет A/B-uplift (table) + закрытие со ссылкой на книгу (text). Виджеты
ссылаются на таблицы `users`/`payments` (резолвятся после `loadDemoData`). Тест проверяет, что
JSON десериализуется и ссылается только на `users`/`payments`.

## Пиллар 3 — Экспорт результата

- **`duckdbClient.exportQuery(sql, format): Promise<Uint8Array>`** — снять трейлинг `;`, обернуть:
  `COPY (<sql>) TO 'qb-export.<ext>' (FORMAT CSV, HEADER)` либо `(FORMAT PARQUET)` в DuckDB VFS →
  `db.copyFileToBuffer('qb-export.<ext>')` → байты → удалить vfs-файл. Гоняет **полный** запрос
  (не превью-лимит грида).
- **`src/features/exportResult.ts` `downloadResult(client, sql, format)`** — `exportQuery` →
  `Blob([bytes], {type})` → download (Firefox-safe: append anchor + deferred revoke, как
  `exportReport.downloadHtml`). Имя `quackbook-result.{csv,parquet}`.
- **UI:** кнопки **CSV** / **Parquet** в тулбаре Результата (`ResultPanel`), видимы только при
  успешном результате. Экспортируют SQL **активного таба**.

## Пиллар 4 — Схема-осознанный автокомплит

- **`src/core/sqlSchema.ts` `buildSqlSchema(datasets): Record<string, string[]>`** (**TDD**) —
  по каждому не-внутреннему датасету (`!isInternalTable`) маппит `table → columns[]`. Пустой ввод → `{}`.
- **`SqlEditor`** принимает проп `schema: Record<string,string[]>`. `sql()` (был без аргумента)
  становится `sql({ schema })`, обёрнут в CM6 **`Compartment`**; при смене `schema` —
  `view.dispatch({ effects: schemaCompartment.reconfigure(sql({ schema })) })`. Монтаж по-прежнему
  один раз; реконфиг — отдельным `useEffect([schema])`. Подсказывает имена таблиц и, после `table.`,
  колонки этой таблицы.
- **Источник:** `Explore` берёт `datasets` (фильтр `isInternalTable`) → `buildSqlSchema` → проп в `SqlEditor`.

## About (`src/components/AboutModal.tsx`)

Модалка, управляется стейтом `Shell` (`aboutOpen`); кнопка «?» в `topbar-right`. Оверлей +
диалог, закрытие по Esc / клику вне / крестику. Содержимое (коротко): что такое quackbook;
стек (DuckDB-WASM в Web Worker, Arrow, всё в браузере, без бэкенда); ограничения v1 (только
локальные файлы, reload очищает, экспорт самодостаточный); кредит книге + ссылки (репо, бесплатный
PDF); MIT.

## Структура файлов

**Новые:**
- `public/demo/payments.csv`, `public/demo/users.parquet`, `public/demo/sample-report.json`
- `public/demo/DATA-LICENSE` (MIT-нотис учебника — атрибуция при редистрибуции)
- `src/features/demoData.ts` — оркестратор демо
- `src/core/exampleQueries.ts` — 4 рецепта `{title, sql}[]` (константа)
- `src/core/sqlSchema.ts` (+`.test.ts`) — `buildSqlSchema`
- `src/features/exportResult.ts` — `downloadResult`
- `src/components/WelcomeScreen.tsx`, `src/components/AboutModal.tsx`

**Модифицируются:**
- `src/db/duckdbClient.ts` (+ node-`.test.ts`) — `exportQuery`
- `src/components/SqlEditor.tsx` — проп `schema` + Compartment-реконфиг
- `src/features/Explore.tsx` — построить схему, прокинуть в `SqlEditor`
- `src/components/ResultPanel.tsx` — кнопки CSV/Parquet
- `src/features/Shell.tsx` — WelcomeScreen вместо `explore-empty`; «?» + AboutModal
- `src/state/session.ts` — экшен `seedTabs`
- `src/index.css` — стили welcome/About/export

## Граница тестов

**Логика (red→green):**
- `core/sqlSchema.test.ts` — исключение `_qb_*`, маппинг колонок, пустой ввод.
- `db/duckdbClient.export.test.ts` (node) — CSV round-trip (создать таблицу → exportQuery →
  распарсить байты → проверить header+строки) и Parquet round-trip (export → `read_parquet` →
  проверить rowcount). Доказывает синтаксис `COPY ... (FORMAT …)` в WASM-сборке.
- `core/report` — добавить тест: `sample-report.json` десериализуется и ссылается только на
  `users`/`payments`.
- Table-name детерминизм демо (`tableNameFromFilename` — возможно уже покрыто `sql.test`).

**Глазами:** WelcomeScreen, AboutModal, кнопки экспорта (скачивание), вид засеянных табов,
попап автокомплита.

## Data-prep (build-time, явные задачи плана)

1. Скачать `users.csv` + `payments.csv` из repo учебника (raw.githubusercontent, MIT).
2. Сконвертировать `users.csv → public/demo/users.parquet` через DuckDB (CLI/throwaway-скрипт)
   с типизацией (`UserID`→BIGINT, `DateUTC`→TIMESTAMP через `strptime(replace(…,' UTC',''),
   '%Y-%m-%d %H:%M:%S.%f')`, `PhotoCount`→INTEGER). Проверить размер + загрузку.
3. Положить `payments.csv → public/demo/payments.csv`.
4. Авторизовать `public/demo/sample-report.json` (детерминированные id), проверить десериализацию.
5. Положить `public/demo/DATA-LICENSE` (MIT-нотис учебника).
6. `.gitignore` — убедиться, что `public/demo/*.parquet`/`*.csv` **трекаются** (как `fixtures/metrics.parquet`).

## Скоуп / слайсы

M6 крупный (4 пиллара + data-prep). План разрежет на отгружаемые слайсы, рекомендуемый порядок:
1. **Демо + онбординг** (data-prep → demoData → seedTabs → exampleQueries → sample-report → WelcomeScreen).
2. **About** (модалка + «?»).
3. **Экспорт результата** (exportQuery → downloadResult → кнопки).
4. **Автокомплит** (buildSqlSchema → SqlEditor Compartment → Explore-проброс).

Каждый слайс — самодостаточный, гейт-зелёный, отгружаемый.

## Трассировка к скоупу

Все пять улучшений — quality-of-life поверх отгруженного v1 (M0–M5 + визуальный редизайн),
явно одобрены пользователем как одна веха M6 (2026-06-30). Демо-данные и ссылка на книгу — по
прямому запросу пользователя. Ничего из firewall-списка не вводится.
