# Проверка локализованного каталога

## Автоматический выбор языка

Портал выбирает язык презентационных метаданных из `Accept-Language` после серверной проверки catalog visibility.

```bash
curl -sS \
  -H 'Accept-Language: en-GB,en;q=0.9,ru;q=0.8' \
  https://portal.example.test/api/integrations/catalog
```

Проверьте в ответе:

- `presentation.locale`;
- `presentation.availableLocales`;
- `presentationLocale` у процессов;
- заголовок `Content-Language`;
- заголовок `Vary: Accept-Language`.

## Явный язык

Параметр `locale` имеет приоритет над браузерным заголовком:

```bash
curl -sS \
  -H 'Accept-Language: ru' \
  'https://portal.example.test/api/integrations/catalog?locale=en-GB'
```

Для `en-GB` незаданные поля наследуются из `en`, затем из `defaultLocale`, базового override и исходных metadata XYOps.

## Проверка безопасности

Сравните доступность процессов для одной identity на разных языках. Список разрешённых Process ID должен оставаться одинаковым: локализованная категория применяется только после исходной visibility policy и не изменяет approval, `schemaVersion`, targets или выполнение XYOps.
