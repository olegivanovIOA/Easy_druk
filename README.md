# Easy 3D Print · Dashboard v1.0

## Структура файлів

```
e3d_dashboard/
├── index.html          ← Головний дашборд (завантажувати на GitHub Pages)
├── data/
│   └── static.js       ← Статичні дані (проекти, цілі, метрики-покриття)
├── js/
│   ├── sheets_loader.js ← Завантаження з Google Sheets (CSV export)
│   ├── data_layer.js    ← Ізоляція джерел даних (мікросервісна архітектура)
│   ├── scoring.js       ← Движок скорингу проектів (70/30)
│   └── widgets.js       ← Менеджер віджетів + localStorage
└── README.md

```

## Розгортання на GitHub Pages

1. Завантажити всі файли в репозиторій `olegivanovIOA/Easy_druk`
   (або в окремий репо, наприклад `Easy_druk_dashboard`)
2. GitHub → Settings → Pages → Source: `main` branch, `/ (root)`
3. Дашборд буде доступний за URL:
   `https://olegivanovioa.github.io/Easy_druk/`

## Підключення Google Sheets (реальні дані)

### Крок 1 — Опублікувати аркуші

Для кожного Google Sheets файлу:
1. `File → Share → Publish to web`
2. Вибрати потрібний аркуш → `CSV`
3. Скопіювати URL

### Крок 2 — Вставити URL в `js/sheets_loader.js`

```js
urls: {
  projects:   'https://docs.google.com/spreadsheets/d/1GD3.../export?format=csv&gid=0',
  sprints_s1: 'https://docs.google.com/spreadsheets/d/1GD3.../export?format=csv&gid=SPRINT1_GID',
  sprints_s2: 'https://docs.google.com/spreadsheets/d/1GD3.../export?format=csv&gid=SPRINT2_GID',
  metrics:    'https://docs.google.com/spreadsheets/d/1RFZV.../export?format=csv&gid=485374783',
},
```

> GID кожного аркуша видно в URL Google Sheets після `#gid=`

### Важливо: CORS
Google Sheets CSV export підтримує CORS — дані завантажуються напряму з браузера без сервера.

## Архітектурні принципи

### Мікросервісна ізоляція джерел
- Кожне джерело (`projects`, `sprint1`, `sprint2`, `metrics`) завантажується **незалежно**
- Помилка одного джерела **не обвалює** решту
- При помилці — автоматично використовуються статичні дані з `data/static.js`
- Кожне джерело відображається в Status Bar вгорі (✓ / ✗ / …)

### Водяні знаки (демо-дані)
- Картки/графіки з демо-даними мають:
  - Сітчастий муар (CSS `repeating-linear-gradient`)
  - Текстовий водяний знак `ДЕМО · TBD`
- Якщо джерело недоступне при завантаженні — додається клас `.wm-err` (червоний муар)
- При підключенні реальних даних — водяні знаки зникають автоматично

### Скоринг проектів (70/30)
```
Виплата = Відповідальний × 70% + Учасники × 30% (порівну)
```
- Score проекту: `f(task_completion, time_progress, deadline)`
- Нормалізація 0–100 по всіх учасниках

### Фільтрація (рік / місяць)
- Глобальна — застосовується до всіх часових графіків
- "Всі місяці" = повний рік, один місяць = single-point view

### Менеджер віджетів
- Кожен віджет має id `w-{widget-id}` в DOM
- Налаштування зберігаються в `localStorage` (ключ `e3d_widget_prefs_v1`)
- Скинути: кнопка "↺ Скинути все" в drawer

## КПІ Проекту #3 — прогрес діджиталізації

На вкладці CEO є плашка "Реальні дані / всього метрик":
- **Зараз**: 12/174 = 6.9% (тільки `Так — збирається`)
- **Розширене**: 72/174 = 41.4% (`Так` + `Частково`)
- **Потенціал**: 111/174 = 63.8% (+ `Можна порахувати`)

Ця плашка оновлюватиметься по мірі підключення реальних джерел.

## Наступні кроки

1. Отримати Published CSV URL для Sheets
2. Вставити в `sheets_loader.js`
3. Завантажити файли на GitHub Pages
4. Після інтеграції з ПО Стріляного — замінити демо-дані по локаціях і виробництву
