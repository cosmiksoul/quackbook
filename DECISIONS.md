# DECISIONS — quackbook

Лог решений, меняющих направление. Подробности — в `docs/superpowers/specs/`.

## 2026-06-22

- **Каркас: React + TypeScript + Vite.** Компонентный стейт ноутбука/табов/виджетов; бандл-оверхед React ничтожен рядом с DuckDB-WASM; edge проекта — движок данных, React освобождает усилия под него. TS усиливает TDD на логике. (Первое решение по скоупу — закрыто.)
- **Навигация: гибрид** — тогл Исследование/Отчёт + табы редакторов под датасеты внутри исследования. Решает расхождение скоуп (Sublime-табы) ↔ мокап (mode-toggle).
- **Key-хинт вырезан полностью** (ни v1, ни v1.5) — слишком дорого относительно ценности. Переопределяет скоуп (строка 67). Ручной JOIN/UNION через SQL остаётся в v1.
- **Single-thread DuckDB-WASM** — не требует COOP/COEP, совместимо со статикой на GitHub Pages.
- **Подход к деливери: сквозной скелет (depth-first), вехи M0–M5.** См. `docs/superpowers/specs/2026-06-22-quackbook-delivery-design.md`.
- **Стек (заменяемо, за границами модулей):** Observable Plot (чарты, за `<Chart>`), `@tanstack/react-virtual` (грид), CodeMirror 6 (редактор), `marked` (markdown), `dnd-kit` (перестановка), Zustand (стор), print-CSS/`window.print` (PDF).
