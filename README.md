# Halty Backend (Strapi 5)

Headless CMS / API для приложения **Halty** — карта подработок в Минске.

Архитектура и паттерны взяты из **uplift-backend** (Strapi 4, Made4Fit), адаптированы под Strapi 5 и контракт фронтенда (`halty-frontend/src/services/strapiClient.ts`).

---

## Быстрый старт

### Docker (dev, recomended) 

Тот же dev-сервер, но в контейнере (`compose.dev.yaml` + `Dockerfile.dev`):

```bash
make docker-up      # собрать образ и запустить Strapi на :1337
make docker-logs    # логи (Ctrl+C — отцепиться)
make help           # все цели Makefile
```

- `make env` — создаёт `.env` из `.env.example` (вызывается автоматически из `docker-up`/`docker-build`). 
- Hot reload работает через bind-mounts `./src`, `./config`, `./types`. Зависимости стоят в образе (`/opt/node_modules`) — после правок в `package.json` нужно `make docker-build`.
- SQLite лежит на хосте в `./.tmp/data.db` (смонтирован в контейнер), поэтому пересид такой же, как в bare-metal: `make docker-reset-db`.
- Контекст сборки чистится через `.dockerignore` (нет `node_modules`, `.git`, `.tmp`, `.env`, апладов).

Makefile служит набором комманд Docker

### Local

```bash
npm install
npm run develop
```

**Работает на версиях Node с 20 по 25!!**

- Админка: http://localhost:1337/admin
- API: http://localhost:1337/api
- Примеры запросов: [docs/REQUESTS.http](./docs/REQUESTS.http)

---
---

## Маппинг UpLift → Halty

| UpLift | Halty | Назначение |
|--------|-------|------------|
| `exercise` | `vacancy` | Основной контент на карте |
| `category` | `vacancy.category` (enum) | Фильтр по типу работы |
| `favorite` | `application` | Действие пользователя, привязка к `owner` |
| `trainer` | `company` (поле в vacancy) | Работодатель |
| `/exercises/search` | `/vacancies/search` | Поиск по тексту |
| spatial / map | `/vacancies/nearby` | Вакансии в радиусе |
| `users-permissions` | то же | JWT auth |
| `inject-owner` | `src/helpers/inject-owner.ts` | Доступ только к своим откликам |
| `config/sync` roles | `src/helpers/permissions.ts` | Права при первом запуске |

---

## Roadmap — что делать по порядку

Отмечай `[x]` по мере выполнения. Статусы: **✅ готово** · **🟡 частично** · **⬜ todo**

---

### Фаза 0 — Инфраструктура

| # | Задача | Статус | Где |
|---|--------|--------|-----|
| 0.1 | Strapi 5 + TypeScript + SQLite | ✅ | корень проекта |
| 0.2 | Content types: `vacancy`, `application` | ✅ | `src/api/*` |
| 0.3 | Расширение User (`phone`, `tgUsername`, `tgConnected`) | ✅ | `src/extensions/users-permissions/` |
| 0.4 | Bootstrap: права Public / Authenticated | ✅ | `src/helpers/permissions.ts` |
| 0.5 | Seed: 2 тестовые вакансии | ✅ | `src/helpers/seed.ts` |
| 0.6 | PostgreSQL для prod (как в UpLift) | ⬜ | `config/database.ts` |
| 0.7 | S3 upload provider для медиа | ⬜ | `config/plugins.ts` |
| 0.8 | Config-sync / export ролей в git | ⬜ | аналог `config/sync/` в UpLift |

---

### Фаза 1 — Авторизация и профиль

> Аналог UpLift: `POST /api/auth/local`, `GET /api/users/me`, whitelist полей при update.

| # | Задача | Статус | API | Примечание |
|---|--------|--------|-----|------------|
| 1.1 | **Регистрация** пользователя | 🟡 | `POST /api/auth/local/register` | Включить permission `register` для роли **Public** в админке или bootstrap |
| 1.2 | **Логин**, получение JWT | 🟡 | `POST /api/auth/local` | Работает через users-permissions; фронт: `strapiClient.login()` |
| 1.3 | **Текущий пользователь** | 🟡 | `GET /api/users/me` | Permission `me` для Authenticated |
| 1.4 | **Обновление профиля** (whitelist) | ⬜ | `PUT /api/users/:id` | UpLift: только `name`, `phone`, `language` и т.д. — сделать extension |
| 1.5 | Роли **user** / **admin** | ⬜ | — | Сейчас admin определяется на фронте по `email.includes('admin')` — нужна нормальная роль |
| 1.6 | Forgot / reset password | ⬜ | `POST /api/auth/forgot-password` | Опционально |
| 1.7 | Подключение фронта | ⬜ | — | `VITE_USE_STRAPI=true`, `VITE_STRAPI_URL=http://localhost:1337` |

**Проверка:**
```http
POST /api/auth/local/register
POST /api/auth/local
GET  /api/users/me
Authorization: Bearer <jwt>
```

---

### Фаза 2 — Вакансии (контент на карте)

> Аналог UpLift: `exercise` — публичное чтение, кастомный search, premium gating (у нас пока без gating).

| # | Задача | Статус | API | Примечание |
|---|--------|--------|-----|------------|
| 2.1 | **Список вакансий** (public) | ✅ | `GET /api/vacancies?populate=*` | Фронт: `getVacancies()` |
| 2.2 | **Одна вакансия** | ✅ | `GET /api/vacancies/:id` | |
| 2.3 | **Фильтр по категории** | ✅ | `filters[category][$eq]=horeca` | enum: horeca, parks_green, retail, delivery, it_creative, service |
| 2.4 | **Поиск по тексту** | ✅ | `GET /api/vacancies/search?search=...` | Custom route, как `/exercises/search` |
| 2.5 | **Вакансии рядом** | ✅ | `GET /api/vacancies/nearby?lat=&lng=&radius=` | Haversine в `src/helpers/geo.ts` |
| 2.6 | **Создание вакансии** (admin) | 🟡 | `POST /api/vacancies` | Schema есть; нужна роль admin + publish |
| 2.7 | **Редактирование вакансии** | ⬜ | `PUT /api/vacancies/:id` | Только admin |
| 2.8 | **Удаление / снятие с публикации** | ⬜ | `DELETE /api/vacancies/:id` | Фронт: `apiClient.deleteVacancy()` — в Strapi ещё нет |
| 2.9 | Draft & Publish workflow | 🟡 | — | В schema включён `draftAndPublish`; при create нужен `status: published` |
| 2.10 | Связь vacancy ↔ applications | ✅ | populate | relation в schema |

**Поля vacancy** (из фронта `types.ts`):

`title`, `company`, `employerName`, `salary`, `category`, `categoryLabel`, `attachmentType`, `lat`, `lng`, `address`, `locationName`, `description`, `requirements[]`, `schedule`, `payoutType`, `color`, `accentColor`, `iconType`, `buildingHeight`, `zoneRadius`

---

### Фаза 3 — Отклик на вакансию

> Аналог UpLift: `favorite.create` с dedup (409) + `inject-owner`.

| # | Задача | Статус | API | Примечание |
|---|--------|--------|-----|------------|
| 3.1 | **Создать отклик** | 🟡 | `POST /api/applications` | Controller есть; фронт пока бьёт в Node API, не в Strapi |
| 3.2 | **Мои отклики** (только свои) | ✅ | `GET /api/applications?populate=*` | Owner filter в controller |
| 3.3 | **Один отклик** | ✅ | `GET /api/applications/:id` | |
| 3.4 | **Дубликат отклика** → 409 | ⬜ | — | UpLift pattern: не 403, а 409 (чтобы фронт не разлогинивал) |
| 3.5 | Автозаполнение из vacancy при create | ⬜ | — | При POST передаётся `{ vacancy }` — controller должен подтянуть title, company, lat/lng |
| 3.6 | `createApplication` в `strapiClient.ts` | ⬜ | — | Метод на фронте ещё не добавлен |

**Тело отклика при создании:**
```json
{
  "data": {
    "vacancy": "<documentId>",
    "role": "Смена",
    "company": "...",
    "location": "...",
    "lat": 53.9,
    "lng": 27.5,
    "salary": "...",
    "scheduleDate": "Сегодня с 10:00",
    "progressStep": 1,
    "status": "pending",
    "statusLabel": "Ожидает"
  }
}
```

---

### Фаза 4 — Прогресс отклика (workflow)

> На фронте: `progressStep` от 1 до 5, `STAGE_NAMES` в `NavigationSheet.tsx`.

| Шаг | `progressStep` | Название (UI) | Кто меняет | Действие |
|-----|----------------|---------------|------------|----------|
| 1 | 1 | Отправлен | система | Пользователь нажал «Откликнуться» |
| 2 | 2 | Доставлен | система / admin | Заявка попала к работодателю |
| 3 | 3 | Просмотрен | admin | Админ открыл отклик |
| 4 | 4 | Подтверждён | admin | Админ принял на смену → `status: active` |
| 5 | 5 | Смена | admin / user | Смена выполнена → `status: completed` |

**Статусы `application.status`:**

| status | statusLabel (пример) | UI на фронте |
|--------|----------------------|--------------|
| `pending` | Ожидает | жёлтый badge |
| `reviewing` | На рассмотрении | — |
| `active` | Активен | зелёный badge |
| `rejected` | Отклонён | — |
| `completed` | Завершён | — |
| `cancelled` | Отменён | серый badge |

| # | Задача | Статус | API | Примечание |
|---|--------|--------|-----|------------|
| 4.1 | **Обновить статус / шаг** | 🟡 | `PUT /api/applications/:id` | Фронт шлёт `{ step }` — маппить на `progressStep` |
| 4.2 | Custom route **PATCH /applications/:id/status** | ⬜ | как в Node API фронта | Единый контракт с `apiClient.updateApplicationStatus` |
| 4.3 | **Admin-only** смена progressStep | ⬜ | — | User может только `cancelled`; admin — шаги 2–5 |
| 4.4 | Системные сообщения в `messages[]` при смене шага | ⬜ | — | `{ text, from: 'employer', isSystem: true }` |
| 4.5 | `rejectionReason` при отказе | 🟡 | поле в schema | Логика в controller — todo |
| 4.6 | Lifecycle hooks (email / push / telegram) | ⬜ | — | Аналог UpLift webhooks — позже |

**Пример: админ подтверждает смену (шаг 4):**
```json
PUT /api/applications/:id
Authorization: Bearer <admin-jwt>

{
  "data": {
    "progressStep": 4,
    "status": "active",
    "statusLabel": "Активен"
  }
}
```

---

### Фаза 5 — Чат по отклику

> На фронте: `messages[]` в `ApplicationItem`, `apiClient.sendChatMessage()`.

| # | Задача | Статус | API | Примечание |
|---|--------|--------|-----|------------|
| 5.1 | Хранение сообщений | 🟡 | поле `messages` (json) | Сейчас json-массив в application |
| 5.2 | **Отправить сообщение** | ⬜ | `POST /api/applications/:id/messages` | Custom route + append в messages |
| 5.3 | Права: user пишет employer, admin отвечает | ⬜ | — | |
| 5.4 | WebSocket / realtime (как Node API фронта) | ⬜ | — | UpLift не использует WS; опционально |

**Формат сообщения:**
```json
{
  "id": "m1",
  "text": "Здравствуйте!",
  "from": "user",
  "time": "14:20",
  "isSystem": false
}
```

---

### Фаза 6 — Профиль и Telegram

| # | Задача | Статус | API | Примечание |
|---|--------|--------|-----|------------|
| 6.1 | Обновить phone / tgUsername | ⬜ | `PUT /api/users/:id` | Поля уже в schema user |
| 6.2 | **Подключить Telegram** | ⬜ | custom `/telegram/connect` | Как в Node API фронта |
| 6.3 | Тестовое push-уведомление | ⬜ | `/telegram/test-notification` | |
| 6.4 | Уведомление при смене progressStep | ⬜ | — | |

---

### Фаза 7 — Админка и CMS-страницы (позже)

> Аналог UpLift: `home-page`, `explore`, `privacy-policy` — single types.

| # | Задача | Статус | UpLift аналог |
|---|--------|--------|---------------|
| 7.1 | Landing / home-page | ⬜ | `home-page` |
| 7.2 | Explore blocks (категории на карте) | ⬜ | `explore` |
| 7.3 | Privacy / Terms | ⬜ | `privacy-policy`, `term-and-condition` |
| 7.4 | Configuration (staging emails) | ⬜ | `configuration` |

---

### Фаза 8 — Интеграция с фронтом

| # | Задача | Статус | Файл фронта |
|---|--------|--------|-------------|
| 8.1 | `VITE_USE_STRAPI=true` | ⬜ | `.env` |
| 8.2 | Health check | ✅ | `strapiClient.checkHealth()` |
| 8.3 | Vacancies CRUD через Strapi | 🟡 | `strapiClient.getVacancies`, `createVacancy` |
| 8.4 | Applications через Strapi | 🟡 | `getApplications`, `updateApplicationStatus` |
| 8.5 | createApplication в strapiClient | ⬜ | `apiClient.createApplication` fallback |
| 8.6 | Chat через Strapi | ⬜ | `sendChatMessage` |
| 8.7 | Убрать зависимость от Node API :3001 | ⬜ | `apiClient.ts` |

---

## Диаграмма пользовательского flow

```
[Гость]
   │
   ├─► GET /vacancies, /nearby, /search     ← карта без логина
   │
   ▼
[Регистрация / Логин]
   │
   ├─► GET /users/me
   │
   ▼
[Отклик на вакансию]
   │
   ├─► POST /applications  (progressStep: 1, status: pending)
   │
   ▼
[Admin смотрит отклики]
   │
   ├─► PUT /applications/:id  (step 2 → 3 → 4)
   │
   ▼
[Активная смена]  status: active, progressStep: 4
   │
   ├─► POST /applications/:id/messages  (чат)
   │
   ▼
[Завершение]  progressStep: 5, status: completed
```

---

## Структура проекта

```
src/
├── api/
│   ├── vacancy/          # Вакансии на карте
│   └── application/      # Отклики пользователя (owner-scoped)
├── extensions/
│   └── users-permissions/  # Расширенный User
├── helpers/
│   ├── geo.ts            # Haversine для /nearby
│   ├── inject-owner.ts   # Фильтр по owner (как UpLift)
│   ├── permissions.ts    # Bootstrap прав
│   └── seed.ts           # Тестовые данные
└── index.ts              # Bootstrap
docs/
└── REQUESTS.http         # Готовые HTTP-запросы для теста
```

---

## Команды

| Команда | Описание |
|---------|----------|
| `npm run develop` | Dev-сервер + hot reload |
| `npm run start` | Production |
| `npm run build` | Сборка admin panel |
| `make docker-up` | Dev-сервер в Docker на :1337 |
| `make help` | Список всех Docker-целей Makefile |

---

## Следующий шаг (рекомендация)

1. **Фаза 1** — довести register + login + `/users/me`, включить Strapi на фронте.
2. **Фаза 3.5–3.6** — `POST /applications` с автозаполнением из vacancy + метод в `strapiClient`.
3. **Фаза 4** — admin endpoint для смены `progressStep` / `status` по таблице выше.

Полный список curl/http — в [docs/REQUESTS.http](./docs/REQUESTS.http).
