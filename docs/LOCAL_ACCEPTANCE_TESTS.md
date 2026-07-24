# Локальные acceptance-тесты

Этот сценарий проверяет портал на реальной локальной сборке без облачных сервисов.

## 1. Подготовка

Используйте тестовые FreeIPA и XYOps. Не запускайте мутационные проверки на рабочих пользователях и процессах.

```bash
git pull
cp .env.example .env
```

Укажите в `.env`:

```env
PORTAL_IDENTITY_MODE=local
PORTAL_BOOTSTRAP_ADMIN_USERNAME=admin
PORTAL_BOOTSTRAP_ADMIN_PASSWORD=<надежный пароль>
PORTAL_BOOTSTRAP_ADMIN_NAME=Локальный администратор
PORTAL_SESSION_TTL_HOURS=12

IPA_URL=<тестовый FreeIPA>
IPA_USERNAME=<тестовый сервисный пользователь>
IPA_PASSWORD=<пароль>

XYOPS_URL=<тестовый XYOps>
XYOPS_API_KEY=<тестовый API key>
```

Запустите чистый контур:

```bash
docker compose down
docker volume rm freeipa-admin-dashboard-source_dashboard-data 2>/dev/null || true
docker compose up -d --build
docker compose ps
```

## 2. Первый вход

1. Откройте `http://localhost:3001`.
2. Убедитесь, что портал перенаправил на `/login`.
3. Войдите bootstrap-администратором.
4. Проверьте отображение имени и роли администратора.
5. Откройте `/access`.

Ожидаемый результат:

- вход успешен;
- cookie `portal_session` имеет `HttpOnly` и `SameSite=Strict`;
- в UI нет паролей, password hashes и session tokens;
- в локальной базе создан ровно один активный администратор.

## 3. Управление ролями

Создайте:

```text
portal-viewer   → viewer
portal-operator → operator
portal-admin2   → admin
```

Для каждой роли выполните отдельный вход.

### viewer

Должен:

- просматривать FreeIPA, каталог и операции.

Не должен:

- изменять FreeIPA;
- запускать XYOps;
- видеть настройки, аудит и управление доступом.

### operator

Должен:

- просматривать данные;
- создавать и изменять тестовые объекты FreeIPA;
- запускать разрешённые процессы XYOps.

Не должен:

- удалять объекты, когда требуется `freeipa.delete`;
- управлять настройками, аудитом и RBAC;
- согласовывать процессы как admin.

### admin

Должен:

- выполнять все операции operator;
- удалять тестовые объекты;
- управлять approvals, настройками, аудитом и RBAC.

## 4. Защита локального входа

### Неверный пароль

1. Пять раз введите неправильный пароль тестового пользователя.
2. Проверьте временную блокировку.
3. Убедитесь, что правильный пароль не разрешает вход до окончания блокировки или ручной разблокировки администратором.

### Смена пароля

1. Войдите тестовым пользователем в отдельном браузере.
2. Администратор меняет ему пароль.
3. Существующая сессия должна перестать работать.
4. Старый пароль не должен подходить.
5. Новый пароль должен работать.

### Последний администратор

Проверьте, что система запрещает:

- удалить последнего активного администратора;
- отключить его;
- сменить его роль на viewer или operator.

После создания второго администратора изменение первого должно стать возможным, кроме изменения собственной текущей учётной записи из активной сессии.

## 5. Персистентность

Создайте пользователей, измените роли и настройте интеграции. Затем:

```bash
docker compose restart
```

После перезапуска должны сохраниться:

- локальные пользователи;
- password hashes;
- роли и блокировки;
- настройки FreeIPA и XYOps;
- операции, approvals, metadata и аудит.

Bootstrap-переменные не должны перезаписать существующего администратора.

## 6. FreeIPA

Используйте префикс `portal-test-`.

Проверьте:

- получение пользователей и групп;
- создание тестового пользователя;
- редактирование имени и email;
- отключение и включение;
- сброс пароля;
- создание группы;
- добавление и удаление membership;
- удаление пользователя и группы;
- обработку неверных credentials и недоступного FreeIPA.

После теста не должно остаться объектов с префиксом `portal-test-`.

## 7. XYOps

Используйте специально выделенный безопасный Event или Workflow.

Проверьте:

- загрузку каталога;
- динамические options;
- запуск процесса;
- получение Job ID;
- переходы queued → running → terminal status;
- success и failed result;
- отмену;
- повтор;
- approval для опасного процесса;
- обработку `409`, `429` и `Retry-After`.

## 8. Автоматический smoke-прогон

```bash
cp .env.test.example .env.test
npm run test:local
```

Для реальных мутаций включите только в тестовой среде:

```env
LOCAL_TEST_MUTATIONS=true
LOCAL_TEST_CONFIRM_MUTATIONS=YES
LOCAL_TEST_FREEIPA_MUTATIONS=true
```

Для тестового запуска XYOps:

```env
LOCAL_TEST_XYOPS_RUN=true
LOCAL_TEST_XYOPS_EVENT_ID=<безопасный тестовый процесс>
LOCAL_TEST_XYOPS_VALUES_JSON={"message":"local acceptance smoke"}
LOCAL_TEST_XYOPS_WAIT_TERMINAL=true
```

## 9. Результаты

Проверьте:

```text
artifacts/local-integration/latest.json
artifacts/local-integration/<run-id>/report.json
artifacts/local-integration/<run-id>/report.html
artifacts/local-integration/compose.log
```

Отчёт не должен содержать:

- пароли;
- API keys;
- `ADMIN_TOKEN`;
- `CONFIG_ENCRYPTION_KEY`;
- session tokens;
- необработанные upstream bodies с секретами.

## 10. Критерий прохождения

Acceptance считается пройденным, когда:

- локальная аутентификация работает после перезапуска;
- серверная RBAC-матрица фактически ограничивает действия;
- FreeIPA CRUD и membership работают на тестовых объектах;
- тестовый XYOps процесс проходит полный жизненный цикл;
- аудит содержит действия с correlation ID;
- в логах, браузере и отчётах нет секретов.