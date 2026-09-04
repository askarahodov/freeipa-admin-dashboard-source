# Локальная аутентификация и RBAC

Портал использует собственную локальную базу пользователей. Учётные записи FreeIPA управляются как отдельный доменный каталог и не используются для входа в портал.

## Режим работы

Стандартный Docker/production deployment использует локальную аутентификацию:

```env
PORTAL_IDENTITY_MODE=local
PORTAL_BOOTSTRAP_ADMIN_USERNAME=admin
PORTAL_BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-strong-password-at-least-12-characters
PORTAL_BOOTSTRAP_ADMIN_NAME=Локальный администратор
PORTAL_SESSION_TTL_HOURS=12
PORTAL_DEFAULT_ROLE=viewer
PORTAL_CLIENT_IP_SOURCE=none
```

Перед запуском placeholder-пароль необходимо заменить. Runtime проверяет local bootstrap credentials до запуска FreeIPA Gateway/Worker и прекращает startup, если username/password отсутствуют, пароль короче 12 символов или оставлен документированный placeholder.

Первый администратор создаётся только когда таблица `portal_users` пуста. После создания пользователя bootstrap-переменные больше не изменяют его пароль или роль.

`static` identity не является production-режимом. Для изолированной development-машины существует отдельный `.env.dev.example` с `PORTAL_RUNTIME_PROFILE=development`. Попытка запустить static identity без явного development/test/e2e profile отклоняется startup policy.

## Хранилище

### `portal_users`

Содержит:

- локальный логин;
- отображаемое имя;
- PBKDF2-SHA-256 hash и отдельную случайную salt;
- число итераций PBKDF2;
- роль `viewer`, `operator` или `admin`;
- legacy-поля `failed_attempts` / `locked_until`, которые больше не используются для блокировки входа и очищаются после успешной аутентификации;
- время последнего входа.

Сырые пароли не сохраняются.

### `portal_login_rate_limits`

Persistent anti-abuse state создаётся сервером при первом local login. Таблица содержит только:

- scope `client` или `username`;
- SHA-256 subject hash;
- число ошибок в текущем окне;
- начало окна, `blocked_until` и `updated_at`.

Сырые IP, username и пароли в limiter state не сохраняются. Записи старше 24 часов удаляются во время обработки последующих неудачных попыток.

### `portal_sessions`

Содержит только SHA-256 hash случайного session token. Сам token находится в браузере в cookie:

- `HttpOnly`;
- `SameSite=Strict`;
- `Secure` при HTTPS;
- ограниченный `Max-Age`.

После смены пароля, блокировки пользователя или ручного отзыва сессий все его session tokens удаляются.

## Вход и brute-force protection

```text
POST /api/auth/login
GET  /api/auth/session
POST /api/auth/logout
```

Логин защищён двумя persistent лимитами: по trusted client identity и по нормализованному username. Ошибочный пароль больше не увеличивает счётчик внутри `portal_users` и не может заблокировать конкретную учётную запись на 15 минут.

Текущая встроенная policy:

- client: 20 ошибок за 60 секунд;
- username: 8 ошибок за 5 минут;
- после достижения лимита применяется bounded exponential cooldown от 1 до 60 секунд;
- HTTP 429 содержит `Retry-After`;
- после окончания cooldown корректный пароль снова может быть использован;
- успешный вход очищает username limiter, но не client limiter;
- limiter state сохраняется в D1/SQLite и переживает restart процесса.

Неизвестный username, отключённый пользователь и неверный пароль проходят одинаковый PBKDF2 credential path и получают одинаковый публичный ответ `Неверный логин или пароль`. Это уменьшает возможность account enumeration по body/status и по очевидной разнице вычислительной работы.

### Trusted client identity

По умолчанию:

```env
PORTAL_CLIENT_IP_SOURCE=none
```

В этом режиме `X-Forwarded-For`, `Forwarded`, `X-Real-IP` и другие переданные клиентом адресные заголовки не используются. Client limiter работает с fail-closed anonymous bucket, а username limiter остаётся независимым.

Для прямого Cloudflare Worker deployment допустим явный режим:

```env
PORTAL_CLIENT_IP_SOURCE=cloudflare
```

Он использует только `CF-Connecting-IP`, поэтому его нельзя включать для произвольного self-hosted HTTP origin, где этот заголовок может быть прислан самим клиентом.

Для контролируемого reverse proxy используется authenticated boundary:

```env
PORTAL_CLIENT_IP_SOURCE=trusted-proxy
PORTAL_TRUSTED_PROXY_SECRET=<long-random-server-side-secret>
```

Reverse proxy обязан удалить входящий `X-Portal-Proxy-Secret`, установить собственное значение этого заголовка и сформировать `X-Forwarded-For`. При неверном/отсутствующем proxy secret forwarded address игнорируется. Общий TLS/security-header proxy profile будет централизован в #53; до этого не следует вводить дополнительные доверенные forwarded-header пути.

### Recovery последнего администратора

Rate limiter не создаёт permanent account lockout: максимальный cooldown ограничен 60 секундами. Для последнего администратора сначала дождитесь `Retry-After` и повторите вход с корректным паролем.

Смена пароля через серверный admin API одновременно отзывает sessions и очищает username limiter state. Это является штатным emergency unlock для учётной записи, когда доступна другая admin session. Если другой admin отсутствует, не удаляйте строки `portal_users` и не отключайте RBAC-проверки: дождитесь bounded cooldown и используйте штатный пароль/recovery workflow. Limiter не требует изменения или удаления admin account.

Rate-limit audit event `auth.login.rate_limited` не содержит password, raw IP или username; в metadata записываются только limiter scope и `Retry-After`.

Неаутентифицированные API-запросы получают HTTP 401, а HTML-запросы перенаправляются на `/login`.

## Управление доступом

Раздел `/access` доступен только роли `admin` и предоставляет:

- создание локального пользователя;
- назначение роли;
- включение и отключение;
- смену пароля;
- отзыв всех сессий;
- удаление пользователя;
- просмотр последнего входа и числа активных сессий.

Ссылка «Доступ» и выход из сессии доступны через локальную панель пользователя поверх основного Dashboard.

Сервер запрещает:

- удалить последнего активного администратора;
- отключить последнего активного администратора;
- понизить роль последнего активного администратора;
- удалить или отключить собственную активную учётную запись из текущей сессии.

Все изменения записываются в append-only аудит как `rbac.user.*`.

## API администратора

```text
GET    /api/auth/users
POST   /api/auth/users
PUT    /api/auth/users/:id
DELETE /api/auth/users/:id
POST   /api/auth/users/:id/password
DELETE /api/auth/users/:id/sessions
```

`worker/local-secure-entry.ts` самостоятельно проверяет session cookie и роль `admin`. После проверки он передаёт существующему порталу только серверно сформированную identity и роль. Клиент не может назначить себе роль заголовком запроса.

## Разделение с FreeIPA

Локальный пользователь портала и пользователь FreeIPA не связаны автоматически, даже когда у них совпадает логин.

- FreeIPA хранит доменные учётные записи, группы и membership.
- SQLite портала хранит только пользователей, которым разрешён вход в административный интерфейс.
- Группы FreeIPA не назначают роли портала.
- Удаление пользователя FreeIPA не удаляет локального пользователя портала и наоборот.

Такое разделение позволяет администрировать FreeIPA даже при ошибках каталога и не делает доступ к порталу зависимым от прав управляемого сервиса.
