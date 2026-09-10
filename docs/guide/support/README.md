# Support guide

## Для кого

Для первой и второй линии поддержки портала. Цель — быстро собрать безопасную evidence, правильно определить владельца проблемы и не запрашивать у пользователя секреты.

## Что спросить сначала

Попросите сообщить:

- что пользователь пытался сделать;
- примерное время события;
- роль пользователя: viewer/operator/admin, если это известно;
- какой раздел был открыт;
- безопасный status/error code;
- correlation ID, если интерфейс его показывает;
- повторяется ли проблема после обычного повторного открытия страницы или только у одного действия.

Не просите «прислать всё из DevTools/логов» без конкретной безопасной процедуры.

## Что запрещено запрашивать

Не просите пользователя присылать:

- пароль;
- portal session cookie;
- FreeIPA session cookie;
- XYOps API key;
- `ADMIN_TOKEN`;
- `CONFIG_ENCRYPTION_KEY`;
- backup/recovery key;
- controller secret;
- `.env` целиком;
- raw production database;
- private key;
- raw upstream response с неизвестным содержимым.

Если расследование действительно требует чувствительный материал, используйте отдельную утверждённую security procedure вне обычного тикета.

## Как классифицировать обращение

### Пользователь не может войти

Проверьте:

- используется ли локальная portal account, а не FreeIPA login;
- не получает ли пользователь rate-limit/cooldown response;
- корректно ли введено имя учётной записи;
- существует ли проблема только у одного пользователя;
- доступен ли сам portal runtime.

Не просите пароль для проверки.

### Пользователь видит Forbidden

`403/forbidden` прежде всего означает authorization decision, а не неисправность UI.

Проверьте роль и требуемый permission по [`../../reference/PERMISSIONS.md`](../../reference/PERMISSIONS.md). Не предлагайте обход через direct API.

### Пустой список

Отличайте настоящий empty result от unavailable dependency или фильтра, который исключил записи.

Попросите пользователя очистить фильтр и указать, какой именно раздел пуст.

### FreeIPA недоступна

Передайте администратору/DevOps время и безопасный error category/correlation ID. Не запрашивайте FreeIPA service-account password или session cookie.

### XYOps недоступен или run неясен

Если был timeout, не советуйте немедленно повторять запуск: сначала нужно проверить, не создан ли run уже. Для `429` учитывайте `Retry-After`.

### Настройки не применились

Уточните:

- какой settings domain изменялся;
- была ли validation/apply ошибка;
- есть ли revision/conflict message;
- какой безопасный error code/correlation ID.

Не просите secret field value.

### После обновления портал не готов

Эскалируйте Operations/DevOps с build/image metadata, readiness и schema/migration state. Не предлагайте вручную редактировать SQLite.

## Correlation ID

Correlation ID нужен, чтобы связать пользовательскую ошибку с серверными событиями без передачи полного request/response body.

Записывайте его точно, но не считайте correlation ID секретом, который даёт право доступа. Он является диагностическим идентификатором, а не credential.

## Безопасные данные для тикета

Обычно достаточно:

- timestamp;
- route/раздел без чувствительных query values;
- роль;
- action name;
- normalized error/status code;
- correlation ID;
- high-level dependency state;
- версия/build metadata, если она уже выдана штатным diagnostics.

Минимизируйте персональные данные: username/object ID включайте только если это необходимо для расследования и разрешено вашей организационной политикой.

## Как эскалировать

### User → Operator

Когда требуется обычная разрешённая mutation или запуск process.

### Operator → Administrator

Когда требуются delete/approve/settings/access/sessions/backup/maintenance или другие admin permissions.

### Administrator → Operations / DevOps

Когда проблема связана с deployment, health/readiness, network/DNS/TLS, storage/schema, backup/restore или длительным outage dependency.

### Operations / DevOps → Developer

Когда подтверждён воспроизводимый defect кода/contract regression или восстановление требует изменения реализации.

### Любой уровень → Security

Когда есть признаки credential/session compromise, secret exposure, authorization bypass или подозрительного доступа. Не продолжайте обычный troubleshooting с распространением чувствительных данных.

## Diagnostic archive

Полноценный redaction-safe support archive отслеживается в #62. Пока он не реализован на `main`, не обещайте пользователю кнопку/архив, которого нет, и не заменяйте его ручным сбором всего filesystem/environment.

## Работа с screenshots

Screenshot допустим только если:

- на нём нет passwords/tokens/cookies;
- скрыты лишние usernames/PII/internal URLs;
- он действительно помогает объяснить UI state;
- текстовые error code/correlation ID также записаны отдельно.

Screenshot не заменяет точный timestamp и reproduction steps.

## Чего не делать

- не отключать TLS verification для диагностики;
- не давать пользователю `ADMIN_TOKEN`;
- не повышать роль до admin как универсальный способ проверки;
- не удалять database/maintenance/session rows вручную;
- не повторять non-idempotent XYOps run после timeout без проверки состояния;
- не закрывать incident только потому, что refresh временно скрыл симптом.

## Связанные материалы

- [`../troubleshooting/README.md`](../troubleshooting/README.md) — symptom-first triage;
- [`../operations/README.md`](../operations/README.md) — эксплуатация;
- [`../../reference/PERMISSIONS.md`](../../reference/PERMISSIONS.md) — роли и permissions;
- [`../../reference/ERROR_CODES.md`](../../reference/ERROR_CODES.md) — stable error codes;
- [`../../operations/HEALTH_CONTRACTS.md`](../../operations/HEALTH_CONTRACTS.md) — health semantics;
- [`../../security/SECURITY_MODEL.md`](../../security/SECURITY_MODEL.md) — security boundaries.
