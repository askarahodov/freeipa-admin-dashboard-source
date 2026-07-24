# Локальное интеграционное тестирование

Контур предназначен только для локального запуска без облачных сервисов. Он использует отдельный Docker Compose профиль и отдельный том SQLite/D1-совместимого хранилища, поэтому рабочая база портала не затрагивается.

## Подготовка

```bash
cp .env.test.example .env.test
```

В `.env.test` укажите реальные адреса тестовых FreeIPA и XYOps, выделенные учётные данные и API-ключи. Не используйте production FreeIPA, production XYOps или production service accounts.

## Read-only smoke test

По умолчанию выполняются только безопасные проверки:

- health и status портала;
- доступность локального хранилища;
- чтение пользователей и групп FreeIPA;
- загрузка каталога XYOps;
- чтение истории операций;
- опциональная проверка dynamic options.

Запуск:

```bash
npm run test:local
```

Артефакты сохраняются в `artifacts/local-integration/`:

- `latest.json`;
- `<run-id>/report.json`;
- `<run-id>/report.html`;
- `compose.log`.

Секретные поля удаляются из отчётов рекурсивно.

## Реальный CRUD FreeIPA

Для разрешения мутаций нужны одновременно три значения:

```env
LOCAL_TEST_MUTATIONS=true
LOCAL_TEST_CONFIRM_MUTATIONS=YES
LOCAL_TEST_FREEIPA_MUTATIONS=true
```

Runner создаёт только объекты с обязательным префиксом `portal-test`, проверяет создание пользователя и группы, membership, disable/enable и затем удаляет тестовые объекты в `finally`.

При аварийном завершении проверьте наличие объектов с префиксом `portal-test-` и удалите их вручную перед повтором.

## Реальный запуск XYOps

Используйте отдельный безопасный Event/Workflow, созданный специально для тестов и не требующий approval:

```env
LOCAL_TEST_MUTATIONS=true
LOCAL_TEST_CONFIRM_MUTATIONS=YES
LOCAL_TEST_XYOPS_RUN=true
LOCAL_TEST_XYOPS_EVENT_ID=portal-test-smoke
LOCAL_TEST_XYOPS_VALUES_JSON={"message":"local smoke"}
LOCAL_TEST_XYOPS_TARGETS_JSON=[]
LOCAL_TEST_XYOPS_WAIT_TERMINAL=true
LOCAL_TEST_XYOPS_POLL_SECONDS=120
```

Runner проверяет наличие Process ID в каталоге, ожидает `jobId`, синхронизирует `/runs?sync=1` и при включённом ожидании требует terminal status: `success`, `failed` или `cancelled`.

## Dynamic options

```env
LOCAL_TEST_OPTIONS_EVENT_ID=portal-test-smoke
LOCAL_TEST_OPTIONS_FIELD_KEY=target
LOCAL_TEST_OPTIONS_QUERY=test
```

## Полезные команды

```bash
# Полный локальный прогон
npm run test:local

# Только runner против уже запущенного портала
npm run test:integration:smoke

# Оставить контейнер после теста
LOCAL_TEST_KEEP_RUNNING=true npm run test:local

# Посмотреть состояние
sudo docker compose --env-file .env.test -f compose.test.yaml ps

# Удалить тестовый контейнер, но сохранить тестовую БД
sudo docker compose --env-file .env.test -f compose.test.yaml down

# Полностью удалить отдельную тестовую БД
sudo docker compose --env-file .env.test -f compose.test.yaml down -v
```

## Требования безопасности

- тестовый том имеет имя `freeipa-admin-dashboard-test-data` и не совпадает с рабочим `dashboard-data`;
- static identity применяется только в изолированном локальном профиле;
- реальные мутации выключены по умолчанию;
- префикс тестовых объектов обязан начинаться с `portal-test`;
- пароли, токены и API-ключи не записываются в отчёт;
- `.env.test` не должен попадать в Git.
