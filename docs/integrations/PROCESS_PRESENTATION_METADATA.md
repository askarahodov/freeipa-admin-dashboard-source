# Управляемые презентационные метаданные процессов

Портал позволяет администратору изменить только пользовательское представление Event или Workflow, не копируя бизнес-логику XYOps.

## Граница ответственности

XYOps остаётся источником истины для:

- Process ID;
- типа Event или Workflow;
- полей и destinations;
- targets;
- `schemaVersion`;
- признака dangerous;
- выполнения, очередей, rate limits и concurrency;
- результатов и статусов Job.

Портал может переопределить только:

- `title`;
- `description`;
- презентационную `category`;
- `icon`;
- `order`;
- `help`;
- локализованные варианты `title`, `description`, `category` и `help`.

Презентационная категория не участвует в проверке доступа или approval policy. Visibility и approval всегда вычисляются по исходной категории, полученной из XYOps. Поэтому переименование или перевод раздела не позволяет обойти deny-правило.

## Формат

```json
{
  "version": 1,
  "defaultLocale": "ru",
  "processes": {
    "database-backup": {
      "title": "Резервное копирование БД",
      "description": "Создание и проверка резервной копии",
      "category": "Базы данных",
      "icon": "backup",
      "order": 10,
      "help": "Выберите БД и срок хранения.",
      "locales": {
        "en": {
          "title": "Database backup",
          "description": "Create and verify a database backup",
          "category": "Databases",
          "help": "Choose a database and retention period."
        },
        "en-GB": {
          "title": "Database backup (UK)"
        }
      }
    }
  }
}
```

Ключ объекта `processes` — точный ID процесса XYOps.

`order` — целое число от `-100000` до `100000`. Меньшие значения отображаются раньше.

`defaultLocale` и ключи `locales` используют безопасные BCP 47-теги, например `ru`, `en`, `en-GB`, `de-DE`. Теги канонизируются через `Intl.getCanonicalLocales`, поэтому `en-gb` сохраняется как `en-GB`.

В локализованном блоке разрешены только:

- `title`;
- `description`;
- `category`;
- `help`.

`icon` и `order` общие для всех языков: локализация не должна менять структуру каталога или порядок выполнения.

## Выбор языка

Сервер определяет язык каталога в следующем порядке:

1. явный query-параметр `locale`, например `/api/integrations/catalog?locale=en-GB`;
2. HTTP-заголовок `Accept-Language` браузера;
3. `defaultLocale` набора metadata;
4. базовые значения override;
5. исходные метаданные XYOps.

Для составного языка применяется fallback по уровням:

```text
en-GB → en → defaultLocale → базовый override → XYOps
```

Если `en-GB` содержит только `title`, остальные поля могут быть взяты из `en`. Если запрошенный язык отсутствует, сервер последовательно проверяет остальные допустимые языки из `Accept-Language`, затем `defaultLocale`.

Ответ каталога содержит:

```json
{
  "presentation": {
    "source": "database",
    "updatedAt": 1784816000000,
    "locale": "en-GB",
    "availableLocales": ["en", "en-GB", "ru"]
  }
}
```

Также сервер устанавливает:

```text
Content-Language: en-GB
Vary: Accept-Language
```

Каталог не кэшируется публично, но `Vary` фиксирует корректный HTTP-контракт для reverse proxy и будущих cache layers.

## Значки

В интерфейсе предусмотрены ключи:

```text
event
workflow
database
backup
server
user
group
security
network
settings
storage
deploy
report
```

Неизвестный безопасный ключ отображается как короткая буквенная метка. Значок не влияет на выполнение.

## Хранение и приоритет

Источники применяются в порядке:

```text
D1 process_presentation_sets
→ PORTAL_PROCESS_METADATA_JSON
→ исходные метаданные XYOps
```

В D1 используется одна текущая версия с идентификатором `current`. Сохранение через API заменяет весь набор целиком.

Существующий одноязычный JSON без `defaultLocale` и `locales` остаётся полностью совместимым.

Ограничения валидации:

- до 500 процессов;
- до 50 языков на процесс;
- до 5000 локализованных записей во всём наборе;
- только валидные Process ID и BCP 47 locale tags;
- управляющие символы удаляются;
- длина текстовых полей ограничена.

## API

Доступ требует права `settings.manage` и корректного `ADMIN_TOKEN`.

```text
GET /api/integrations/catalog/presentation
PUT /api/integrations/catalog/presentation
```

Тело PUT:

```json
{
  "metadata": {
    "version": 1,
    "defaultLocale": "ru",
    "processes": {}
  }
}
```

GET и PUT возвращают `availableLocales`.

Изменение записывается в аудит как:

```text
catalog.presentation.updated
```

В audit metadata сохраняются только версия, количество процессов, ID процессов, `defaultLocale` и количество языков. Переведённые тексты в audit metadata не копируются.

## Применение к каталогу

Последовательность GET каталога:

```text
загрузить исходный каталог XYOps
→ проверить visibility policy по исходным данным
→ определить язык запроса
→ применить базовые и локализованные presentation overrides
→ отсортировать отображаемые процессы
→ вернуть результат браузеру
```

Snapshots и история schema drift сохраняют исходный контракт XYOps. Изменение языка, title, category, icon, order или help не создаёт ложный schema drift.

`schemaVersion` одинакова для всех языков, потому что вычисляется до применения presentation metadata.

## Запуск и согласование

Новый запуск или approval-заявка получает название на языке, который был разрешён для текущего запроса. При этом:

- Event/Workflow ID остаётся исходным;
- approval policy проверяется по исходному Event;
- catalog visibility проверяется до локализации;
- локализованный title используется только как снимок пользовательского представления;
- ранее созданные заявки и операции не переводятся задним числом.

Это сохраняет историческую достоверность аудита: журнал показывает название, которое пользователь видел во время запуска.

## Интерфейс

В разделе «Настройки» доступен JSON-редактор. После сохранения каталог обновляется, и изменения применяются к:

- карточкам процессов;
- сгенерированной навигации по категориям;
- форме запуска;
- названиям новых approval-заявок;
- названиям новых записей журнала операций.

Обычный браузер передаёт `Accept-Language` автоматически. Явный `?locale=` предназначен для интеграционных клиентов, тестирования, ссылок и будущего переключателя языка интерфейса.

## Безопасность

Презентационные metadata:

- не изменяют `eventId`;
- не изменяют поля, targets и destinations;
- не изменяют `schemaVersion`;
- не отключают approval;
- не скрывают процесс вместо visibility policy;
- не управляют очередями и лимитами XYOps;
- не содержат секреты;
- применяются только после серверной авторизации;
- не позволяют локализованной категории обойти правило исходной категории XYOps.

Для скрытия процесса используйте catalog visibility policy, а для ограничений выполнения — конфигурацию XYOps.
