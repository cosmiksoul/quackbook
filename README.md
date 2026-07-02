# quackbook

Браузерный аналитический ноутбук на DuckDB-WASM: исследуй CSV/Parquet → закрепляй результаты виджетами → собирай нарративный отчёт. Без бэкенда, всё в браузере, статика на GitHub Pages.

Референс: BigQuery (исследование + профиль) × Colab (ноутбук-нарратив) × Sublime (быстрый редактор с табами).

- **Скоуп:** `docs/scope-quackbook-v1.md`
- **Правила для Claude Code:** `CLAUDE.md`
- **Статус:** v1, в разработке. Каркас — React + TypeScript + Vite (решено, см. `DECISIONS.md`).

## Старт

```bash
npm ci            # установка (точные пины из package-lock)
npm run dev       # локальная разработка (http://localhost:5173)
npm test          # юнит + интеграционные тесты (Vitest, node-окружение)
npm run build     # продакшн-сборка в dist/
npm run preview   # локальный предпросмотр сборки
npm run lint      # ESLint
```

Требуется Node `^20.19.0 || >=22.12.0` (см. `.nvmrc`).

**Деплой:** push в `main` → GitHub Actions собирает и публикует на Pages.
Однократно вручную: **Settings → Pages → Source = GitHub Actions**.
Базовый путь в `vite.config.ts` (`/quackbook/`) должен совпадать с именем репозитория.
