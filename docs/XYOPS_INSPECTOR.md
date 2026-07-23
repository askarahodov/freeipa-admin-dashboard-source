# Инспектор контрактов XYOps

Инспектор выполняет только чтение против тестового или production инстанса
XYOps и создает санитизированный JSON-отчет. Его цель — заменить угаданные
сопоставления полей точными контрактами API, возвращаемыми вашей версией XYOps.

## Безопасность

- только `GET`-запросы;
- ключ API считывается из `XYOPS_API_KEY` и никогда не записывается в отчет;
- заголовки авторизации и сырые тела ответов не сохраняются;
- свойства `password`, `secret`, `token`, `key`, `cookie`, `credential`
  заменяются на `[REDACTED]`;
- хосты, ID, заголовки, имена, описания, users, URLs заменяются заполнителями;
- файл создается с правами `0600`, имя игнорируется Git.

Отчет сохраняет имена свойств JSON и безопасные структурные значения
(типы полей, destinations, required, ranges). Всегда проверяйте файл перед
передачей: пользовательские имена свойств могут описывать внутренние понятия.

## Запуск

Используйте выделенный read-only ключ XYOps:

```bash
export XYOPS_URL="https://xyops.company.local"
export XYOPS_API_KEY="replace-with-read-only-key"
npm run inspect:xyops
```

Проверяются каталог Events и опциональные endpoints: server, server-group,
Toolset, active jobs. Неподдерживаемые endpoints записываются как ошибки,
не мешая созданию отчета. Сбой каталога Events — ненулевой exit code.

Версия 3 классифицирует ошибки до HTTP-ответа. В отчете только категория,
разрешенный код и общая подсказка. Распространенные категории:
`dns`, `tls`, `timeout`, `connection_refused`, `connection_reset`, `network`.

Если все зонды имеют `status: 0`:

- `dns`: запуститесь из требуемой сети/VPN;
- `tls`: используйте `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`;
- `connection_refused`: проверьте адрес и порт XYOps;
- `timeout`: проверьте маршрут и увеличьте `--timeout`;
- `network`: проверьте версию Node.js, URL, proxy и TLS.

Не отключайте проверку TLS и не добавляйте credentials в URL.

XYOps может вернуть HTTP 200 с ненулевым JSON `code`. Версия 3 фиксирует
`httpOk` и `apiCode`, treating application-level errors как failed probes.

```bash
npm run inspect:xyops -- --output ./xyops-inspection.json
npm run inspect:xyops -- --include-names   # только если допустимо раскрытие имен
```

## Что отправлять

После проверки предоставьте `xyops-inspection-*.json`.
Этого достаточно для адаптации портала под реальные контракты Events,
Workflows, Toolsets, targets и jobs без доступа к сети или credentials.
