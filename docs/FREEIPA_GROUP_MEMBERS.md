# Поиск и пагинация участников групп FreeIPA

## Назначение

Карточка группы в разделе `/groups` использует отдельный read-only endpoint для поиска, фильтрации, сортировки и постраничного просмотра участников.

Портал не реализует повторно FreeIPA JSON-RPC. Endpoint вызывает уже существующие серверные маршруты:

- `GET /api/integrations/groups` — получает группы через `group_find` или существующий membership fallback;
- `GET /api/integrations/users` — получает нормализованные карточки пользователей.

FreeIPA credentials остаются только на сервере.

## Endpoint

```text
GET /api/integrations/groups/members
```

Параметры:

| Параметр | Значения | По умолчанию |
|---|---|---|
| `group` | идентификатор группы FreeIPA | обязателен |
| `q` | логин, имя или email | пусто |
| `status` | `all`, `active`, `disabled`, `unknown` | `all` |
| `sort` | `uid`, `name`, `email`, `status` | `uid` |
| `direction` | `asc`, `desc` | `asc` |
| `page` | положительное число | `1` |
| `pageSize` | `10`, `25`, `50`, `100` | `25` |

Пример:

```text
/api/integrations/groups/members?group=devops&q=alex&status=active&sort=name&direction=asc&page=1&pageSize=25
```

## Ответ

```json
{
  "mode": "live",
  "group": {
    "name": "devops",
    "description": "Infrastructure",
    "members": 42,
    "memberUids": ["alice", "bob"],
    "type": "POSIX"
  },
  "members": [
    {
      "uid": "alice",
      "name": "Alice Admin",
      "email": "alice@example.test",
      "active": true
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 25,
    "total": 42,
    "totalPages": 2,
    "from": 1,
    "to": 25
  },
  "summary": {
    "total": 42,
    "active": 39,
    "disabled": 2,
    "unknown": 1,
    "filtered": 42
  }
}
```

`active: null` означает, что UID присутствует в membership группы, но карточка пользователя отсутствует в доступном результате `user_find`. Портал не считает такую запись активной или отключённой без подтверждённых данных.

## Интерфейс

В карточке группы доступны:

- поиск по логину, имени и email;
- фильтры активных, отключённых и записей без карточки;
- сортировка по логину, имени, email и статусу;
- направление сортировки;
- размер страницы 10, 25, 50 или 100;
- переход между страницами;
- ручное обновление списка.

Добавление и удаление участников продолжает использовать существующие action-модали и серверный permission `freeipa.write`. Для `viewer` список остаётся read-only.

## Ограничения

- пагинация выполняется сервером портала после получения нормализованного каталога FreeIPA;
- один запрос использует существующие маршруты групп и пользователей, поэтому не создаёт отдельного способа аутентификации в FreeIPA;
- вложенные группы и indirect membership не добавляются автоматически, если они отсутствуют в нормализованном `member_user`/membership fallback;
- изменение состава группы может привести к корректировке номера страницы при следующем обновлении.
