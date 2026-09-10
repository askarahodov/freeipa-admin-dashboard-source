# Troubleshooting: поиск причины по симптому

## Для кого

Для пользователя, оператора, администратора и первой линии поддержки, которым нужно безопасно определить область проблемы до эскалации.

Этот раздел не заменяет технические runbooks. Он помогает понять **что наблюдать, что проверить и куда передать проблему**, не предлагая опасных обходов security, storage или recovery contracts.

## Сначала определите тип проблемы

Перед любыми действиями зафиксируйте:

- примерное время события;
- роль пользователя;
- раздел портала и действие;
- видимый status/error code;
- безопасный идентификатор объекта или run, если он доступен;
- повторяется ли проблема после обновления страницы или нового чтения состояния.

Не прикладывайте пароль, session cookie, API key, encryption key, raw database или необработанный upstream response.

## Не удаётся войти

Проверьте:

1. используется ли локальная учётная запись портала, а не FreeIPA account;
2. не истекла ли текущая сессия;
3. доступен ли сам портал;
4. одинаково ли воспроизводится проблема в новой сессии.

Не пытайтесь обходить вход через `ADMIN_TOKEN`, прямой API или подмену cookie.

Если проблема сохраняется, передайте администратору время попытки, username без пароля и видимое сообщение об ошибке.

## Раздел или действие недоступны

Возможные причины:

- у роли нет нужного permission;
- объект скрыт текущей visibility policy;
- функция находится в maintenance/restricted state;
- внешняя dependency недоступна.

Проверьте текущую роль и назначение действия. Отсутствие кнопки и HTTP `403` не следует обходить прямым API-вызовом: server-side authorization остаётся authoritative.

Канонический permission contract: [`../../reference/PERMISSIONS.md`](../../reference/PERMISSIONS.md).

## Пустой список пользователей или групп

Пустой результат не равен ошибке FreeIPA.

1. очистите фильтры;
2. повторите чтение;
3. проверьте, показывает ли портал состояние dependency как unavailable/degraded;
4. если доступны другие FreeIPA reads, сравните их поведение.

Не создавайте или изменяйте объекты только ради проверки чтения production-каталога.

## FreeIPA недоступна или degraded

Признаки могут включать невозможность загрузить directory data или выполнить mutation.

Безопасные действия:

1. не отключайте TLS verification для обхода ошибки;
2. не меняйте integration credentials вслепую;
3. проверьте доступные health/dependency diagnostics в пределах своей роли;
4. при uncertain mutation outcome сначала перечитайте объект и убедитесь, была ли операция применена;
5. эскалируйте администратору/operations, если dependency остаётся недоступной.

Браузер не должен получать FreeIPA credentials или session cookie.

## XYOps process не запускается

Проверьте:

1. виден ли process в текущем catalog;
2. есть ли у роли `xyops.run`;
3. не требуется ли approval;
4. нет ли уже созданного run для этой операции;
5. не возвращает ли сервис `409` или `429`.

XYOps владеет scheduler/queue/concurrency/rate-limit contract. Портал не должен создавать второй механизм оркестрации.

Подробнее: [`../../integrations/XYOPS_EXECUTION_OWNERSHIP.md`](../../integrations/XYOPS_EXECUTION_OWNERSHIP.md).

## Получен 409 Conflict

Не повторяйте mutation автоматически.

1. перечитайте текущее состояние;
2. проверьте существующий run/object;
3. убедитесь, что действие не было уже выполнено;
4. передайте поддержке время, действие, видимый код и безопасный ID объекта/run.

Correlation ID передавайте только если он действительно показан вам или доступен службе поддержки через её административные инструменты.

## Получен 429 Too Many Requests

Если виден `Retry-After`, следуйте ему. Не запускайте несколько повторов параллельно и не пытайтесь обойти лимит.

Для длительных или повторяющихся ограничений передайте operations сведения о времени, process/action и видимый статус.

## Run завис или результат непонятен

1. обновите состояние run;
2. не создавайте duplicate run до проверки фактического результата;
3. проверьте, разрешён ли cancel или rerun текущим server-side contract;
4. если outcome неизвестен, эскалируйте с run ID и временем.

Не считайте timeout браузера доказательством того, что upstream execution не началось.

## Портал жив, но часть функций не работает

Это может быть degraded dependency, а не outage самого портала.

Различайте:

- **liveness** — процесс портала работает;
- **readiness** — портал готов обслуживать ожидаемый сценарий;
- **dependency status** — FreeIPA, XYOps или другая зависимость доступна/недоступна.

Техническая семантика: [`../../operations/HEALTH_CONTRACTS.md`](../../operations/HEALTH_CONTRACTS.md).

## Портал не проходит readiness

Для обычного пользователя это причина обратиться к administrator/operations, а не пытаться чинить runtime.

Для operations:

1. используйте canonical health/readiness contract;
2. определите, какая обязательная dependency или startup condition нарушена;
3. сверяйте runtime с supported deployment matrix;
4. не заменяйте production launcher development runtime ради быстрого обхода.

См. [`../../architecture/DEPLOYMENT_MATRIX.md`](../../architecture/DEPLOYMENT_MATRIX.md).

## Проблема после изменения настроек

Если ошибка появилась после settings change:

1. зафиксируйте, какой раздел и параметр менялись, без значения секрета;
2. проверьте текущий status/diagnostics;
3. не вставляйте secret values в issue или screenshot;
4. используйте поддерживаемую процедуру возврата/исправления конфигурации, если она документирована canonical reference/runbook.

Не редактируйте SQLite вручную ради восстановления settings.

## Storage или schema warning

Не выполняйте ручные SQLite mutations.

Operations/administrator должны использовать существующие storage diagnostics, migration preflight и recovery tooling. Если требуется destructive restore, переходите только к canonical offline restore runbook.

См. [`../../operations/OFFLINE_FULL_RESTORE.md`](../../operations/OFFLINE_FULL_RESTORE.md).

## Maintenance mode

Если портал находится в maintenance:

- часть действий может быть намеренно заблокирована;
- это не следует трактовать как проблему RBAC;
- не обходите maintenance через прямой API;
- уточните у administrator/operations причину и ожидаемый operational workflow.

См. [`../../operations/MAINTENANCE_MODE.md`](../../operations/MAINTENANCE_MODE.md).

## Когда нужна немедленная эскалация

Передавайте проблему administrator/operations без дополнительных экспериментов, если наблюдается одно из следующего:

- возможная потеря или повреждение данных;
- подозрение на компрометацию credentials/session;
- повторяющиеся несанкционированные действия;
- storage integrity failure;
- невозможность безопасно определить outcome destructive/mutating operation;
- недоступность обязательной production dependency, которая не восстанавливается штатно;
- необходимость full restore.

## Что приложить к обращению

Безопасный минимальный набор:

- время и timezone;
- роль пользователя;
- раздел и действие;
- видимый status/error code;
- run/object ID при наличии и допустимости;
- dependency name, если портал явно показывает её как degraded;
- краткие шаги воспроизведения без секретов.

Дополнительные diagnostics должен собирать administrator/operations по предназначенным для этого процедурам.

## Связанные материалы

- [`../getting-started/README.md`](../getting-started/README.md) — основные состояния для пользователя;
- [`../operator/README.md`](../operator/README.md) — operator workflows;
- [`../operations/README.md`](../operations/README.md) — эксплуатационный обзор;
- [`../support/README.md`](../support/README.md) — безопасная первая линия поддержки;
- [`../../operations/HEALTH_CONTRACTS.md`](../../operations/HEALTH_CONTRACTS.md) — health contract;
- [`../../architecture/DEPLOYMENT_MATRIX.md`](../../architecture/DEPLOYMENT_MATRIX.md) — поддерживаемые deployment modes;
- [`../../operations/OFFLINE_FULL_RESTORE.md`](../../operations/OFFLINE_FULL_RESTORE.md) — authoritative full restore procedure.
