# Administrator guide

## Для кого

Для администратора **самого портала Admin Dashboard Softrust** с текущей встроенной ролью `admin`.

Локальный администратор портала и администратор/учётная запись FreeIPA — разные сущности. Совпадение логина не связывает их автоматически.

Канонические источники:

- [`../../reference/PERMISSIONS.md`](../../reference/PERMISSIONS.md) — permissions;
- [`../../security/LOCAL_AUTH_RBAC.md`](../../security/LOCAL_AUTH_RBAC.md) — локальные пользователи, сессии и ограничения;
- [`../concepts/TERMINOLOGY.md`](../concepts/TERMINOLOGY.md) — понятия простым языком.

## Что вы сможете сделать

В зависимости от текущего route/policy contract администратор может:

- управлять локальными пользователями портала, ролями и сессиями;
- управлять настройками и интеграциями;
- видеть административный audit и diagnostics;
- выполнять разрешённые FreeIPA и XYOps действия;
- работать с backup/restore и maintenance capabilities;
- диагностировать состояние локальной базы, schema и внешних зависимостей.

Полный built-in `admin` получает все canonical permissions, но конкретный endpoint всё равно может иметь дополнительные same-origin, approval, maintenance, recovery или confirmation gates.

## Главная страница: Обзор

Operational Overview — первая точка для triage после входа. Он сводит в одном месте readiness локального runtime, состояние FreeIPA/XYOps, сигналы внимания, последние операции и разрешённые быстрые действия.

Используйте Overview для выбора следующего шага, а не как замену профильной диагностики:

- `portal-unready` относится к readiness самого портала и должен вести к schema-independent `/diagnostics/health`;
- degraded/unavailable FreeIPA или XYOps — отдельные dependency incidents и не означают автоматически, что портал нужно перезапускать;
- failed runs следует разбирать через Operations / Runs;
- pending approvals — через Approvals;
- stale/changed catalog metadata — через соответствующие settings/catalog workflows.

Быстрые действия формируются из effective permissions текущей сессии. Наличие кнопки в UI не является серверной авторизацией и не отменяет approval, maintenance, confirmation или другие safety gates.

`/diagnostics/health` предназначен для incident-проверки liveness/readiness/dependencies и доступен до обычных DB/schema gates. Административный `/diagnostics` остаётся отдельной локальной auth/admin поверхностью и не должен использоваться как единственный путь расследования portal readiness incident.

## Локальные пользователи портала

### Важно

`/access` управляет **локальными учётными записями портала**, а не пользователями FreeIPA.

Удаление локальной учётной записи портала не удаляет пользователя FreeIPA. Удаление FreeIPA user также не удаляет portal account.

### Создать локального пользователя

1. Откройте раздел управления доступом (`/access`).
2. Создайте локальную учётную запись.
3. Выберите минимально необходимую роль: `viewer`, `operator` или `admin`.
4. Передайте начальные credentials только через утверждённый безопасный канал вашей организации.
5. Проверьте, что пользователь может войти и получает ожидаемые effective permissions.

Не добавляйте `admin` «на всякий случай». Используйте минимальную роль, достаточную для рабочего процесса.

### Изменить роль или отключить пользователя

Перед изменением проверьте:

- кого именно вы редактируете;
- не является ли это последним активным администратором;
- какие активные sessions существуют;
- требуется ли пользователю сохранить доступ прямо сейчас.

Сервер защищает последнего активного администратора от удаления, отключения и понижения роли.

### Сбросить пароль

1. Найдите локального пользователя.
2. Выполните password reset штатным действием.
3. Не записывайте новый пароль в issue, лог или screenshot.
4. Учитывайте, что смена пароля отзывает существующие sessions пользователя.

### Отозвать sessions

Администратор может просматривать локальные sessions и отзывать чужие sessions. Текущую session следует завершать штатным logout.

При подозрении на компрометацию сначала отзовите доступ по штатному механизму, затем расследуйте audit и причину. Не пытайтесь вручную редактировать session rows.

## Brute-force / rate limiting

Локальный login имеет persistent anti-abuse protection по trusted client identity и username.

Если вход временно ограничен:

- следуйте `Retry-After`;
- не удаляйте пользователя ради снятия rate limit;
- не отключайте security boundary;
- помните, что текущий cooldown bounded и не создаёт permanent account lockout.

Точные правила принадлежат [`../../security/LOCAL_AUTH_RBAC.md`](../../security/LOCAL_AUTH_RBAC.md).

## Настройки портала

Administrative settings должны изменяться через текущий settings lifecycle и server-side validation.

Безопасный порядок:

1. откройте нужный settings domain;
2. изучите текущее effective значение и source, если интерфейс их показывает;
3. подготовьте изменение/draft;
4. выполните validation/test, если он доступен;
5. проверьте diff/impact;
6. примените изменение;
7. подтвердите фактический результат;
8. при проблеме используйте штатный rollback/revision path, а не ручную правку SQLite.

Не помещайте секретные значения в URL, issue, screenshot или browser storage.

Каноническая конфигурация: [`../../reference/CONFIGURATION.md`](../../reference/CONFIGURATION.md).

## FreeIPA integration

Портал обращается к FreeIPA через server-side boundary и private Gateway. Браузер не должен получать FreeIPA password или session cookie.

При настройке/диагностике:

- используйте штатный connection test/read-only probe, если он доступен;
- не отключайте TLS verification как обычный способ «починить соединение»;
- различайте DNS, timeout, authentication, permission и TLS failures;
- не копируйте raw upstream response в support ticket без безопасной процедуры;
- помните, что portal account и FreeIPA service account — разные identities.

Расширенная FreeIPA settings functionality из открытого backlog не должна считаться реализованной, пока она не находится на `main`.

## XYOps integration

XYOps остаётся владельцем определения процессов, очередей, scheduler, concurrency и rate limits.

Администратор портала может управлять доступной portal-side конфигурацией и policies, но не должен превращать портал во второй scheduler.

При ошибках выполнения:

- `409` — сначала перепроверьте текущее состояние и не повторяйте mutation вслепую;
- `429` — соблюдайте `Retry-After`;
- timeout не доказывает, что job не был создан;
- перед rerun проверьте Operations / Runs.

Подробнее: [`../../integrations/XYOPS_EXECUTION_OWNERSHIP.md`](../../integrations/XYOPS_EXECUTION_OWNERSHIP.md).

## Approvals

Approval policy — дополнительный safety gate, а не замена permissions.

`admin` имеет canonical `xyops.approve`, но approve/reject/execute дополнительно подчиняются текущим policy rules, requester separation, expiry и revalidation.

Не пытайтесь обходить approval через прямой API или временное изменение роли.

Канонический контракт: [`../../integrations/APPROVAL_GATES.md`](../../integrations/APPROVAL_GATES.md).

## Audit

Audit используется для расследования действий и состояния системы.

При работе с audit:

- ищите событие по времени, actor/action/resource и correlation ID, если доступны фильтры;
- не ожидайте увидеть passwords, cookies или secret values — они не должны попадать в audit;
- не используйте audit как источник для восстановления секретов;
- при расследовании фиксируйте только безопасные identifiers и normalized error codes.

## Diagnostics и health

Нужно различать три понятия:

- **liveness** — жив ли процесс;
- **readiness** — готов ли локальный runtime обслуживать запросы;
- **dependency health** — доступны ли внешние зависимости FreeIPA/XYOps.

Degraded XYOps или FreeIPA не означает автоматически, что сам портал необходимо перезапускать.

Канонический источник: [`../../operations/HEALTH_CONTRACTS.md`](../../operations/HEALTH_CONTRACTS.md).

## Storage и schema

Административные storage/schema операции требуют повышенной осторожности.

Используйте UI/API только для тех operations, которые явно поддерживаются текущим runtime. Не выполняйте arbitrary SQL через обходные инструменты и не редактируйте migration journal вручную.

Для точных процедур используйте:

- [`../../operations/STORAGE_STATUS.md`](../../operations/STORAGE_STATUS.md);
- [`../../operations/STORAGE_INTEGRITY.md`](../../operations/STORAGE_INTEGRITY.md);
- [`../../operations/DATABASE_MIGRATIONS.md`](../../operations/DATABASE_MIGRATIONS.md).

## Backup

Портал имеет отдельные permissions для sanitized backup, full encrypted backup, preview/test/selective restore stages.

Перед backup/restore:

- определите, какой именно тип операции требуется;
- используйте отдельную backup/recovery key boundary там, где это предусмотрено;
- никогда не прикладывайте backup или ключ к публичной issue;
- не считайте создание backup доказательством его восстанавливаемости, если test restore не выполнялся.

Точные payload/CLI процедуры не копируются в эту базу знаний; используйте профильные active runbooks.

## Maintenance mode

Maintenance — это safety boundary для операций, при которых обычные API и scheduled jobs должны быть остановлены.

Основные состояния:

- `inactive` — обычная работа;
- `entering` — maintenance подготовлен;
- `active` — обычные API/scheduled jobs заблокированы;
- `verifying` — выполняется проверка восстановленного состояния;
- `exiting` — ожидается завершение выхода;
- `failed` — gate остаётся закрытым, пока не выполнено безопасное восстановление.

Maintenance **не выходит автоматически** после restart или по таймеру.

Не удаляйте `portal_maintenance_state` вручную и не пытайтесь обходить maintenance через `ADMIN_TOKEN`.

Канонический runbook: [`../../operations/MAINTENANCE_MODE.md`](../../operations/MAINTENANCE_MODE.md).

## Recovery / restore

Полный offline restore — потенциально разрушительная эксплуатационная процедура. Эта Wiki намеренно не дублирует команды и controller/recovery secrets.

Перед restore:

1. остановите обычное изменение системы по утверждённой процедуре;
2. откройте актуальный recovery runbook;
3. убедитесь, что используете правильный backup/recovery point;
4. выполняйте exact confirmations из runbook;
5. после restore пройдите обязательную verification sequence;
6. не удаляйте retained original/recovery point до подтверждённого результата.

Точный источник: [`../../operations/OFFLINE_FULL_RESTORE.md`](../../operations/OFFLINE_FULL_RESTORE.md).

## Что означает degraded dependency

Если FreeIPA или XYOps degraded:

- локальные portal accounts/settings/audit/diagnostics могут продолжать работать;
- операции, требующие конкретной dependency, могут быть недоступны;
- не перезапускайте портал только для «очистки» внешней ошибки без диагностики;
- не отключайте TLS/RBAC/validation;
- сообщайте пользователям, какая функция недоступна и что продолжает работать.

## Перед опасным действием

Для delete, restore, maintenance, migration, session revocation и других чувствительных действий задайте себе четыре вопроса:

1. Я выбрал правильный объект/окружение?
2. Какой permission и дополнительный gate требуются?
3. Как я проверю успешный результат?
4. Какой штатный rollback/recovery path существует?

Если ответ на последний вопрос неизвестен, откройте canonical runbook до изменения.

## Что безопасно передать поддержке

Обычно допустимы:

- время события;
- тип операции;
- безопасный error code;
- correlation ID;
- версия/commit/image metadata, если это предусмотрено diagnostics;
- агрегированное health state.

Не передавайте без отдельной утверждённой процедуры:

- passwords;
- portal/FreeIPA session cookies;
- XYOps API key;
- `ADMIN_TOKEN`;
- `CONFIG_ENCRYPTION_KEY`;
- backup/recovery key;
- controller secret;
- raw database;
- `.env`;
- raw upstream bodies.

## Связанные материалы

- [`../concepts/TERMINOLOGY.md`](../concepts/TERMINOLOGY.md) — терминология;
- [`../../reference/PERMISSIONS.md`](../../reference/PERMISSIONS.md) — permissions;
- [`../../reference/API.md`](../../reference/API.md) — API boundaries;
- [`../../reference/CONFIGURATION.md`](../../reference/CONFIGURATION.md) — configuration;
- [`../../security/LOCAL_AUTH_RBAC.md`](../../security/LOCAL_AUTH_RBAC.md) — локальный auth/RBAC;
- [`../../operations/HEALTH_CONTRACTS.md`](../../operations/HEALTH_CONTRACTS.md) — health semantics;
- [`../../operations/MAINTENANCE_MODE.md`](../../operations/MAINTENANCE_MODE.md) — maintenance;
- [`../../operations/OFFLINE_FULL_RESTORE.md`](../../operations/OFFLINE_FULL_RESTORE.md) — offline restore.
