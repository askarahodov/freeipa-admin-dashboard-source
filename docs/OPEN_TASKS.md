# Исторический снимок открытых задач

> Status: `superseded`
>
> Последняя дата прежнего snapshot: **30 июля 2026 года**.
>
> Этот файл больше **не является источником истины для текущего backlog**.

## Почему документ superseded

Проект развивается через несколько параллельных GitHub Issues и PR, в том числе с участием нескольких ИИ-агентов. Статический список задач в Markdown быстро начал расходиться с фактическим состоянием `main`: часть пунктов была реализована, часть изменила scope, а новые security/operations/documentation задачи появились позже даты snapshot.

Использование этого файла как текущего roadmap может приводить к неправильным решениям — например, повторной реализации уже существующего health/recovery/storage contract.

## Текущий source of truth

Для планируемой работы используйте:

1. **GitHub Issues** репозитория — текущий backlog и acceptance criteria;
2. **Epic #82** — программа инженерной документации;
3. [`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md) — продуктовый roadmap/snapshot, но не доказательство runtime;
4. [`DOCUMENTATION_INVENTORY.md`](DOCUMENTATION_INVENTORY.md) — статус актуальности инженерных документов;
5. [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md) — authoritative owners текущих контрактов.

Перед началом задачи ИИ-агент обязан проверить актуальный `main`, открытые PR по тому же owner-topic и профильный active-document.

## Историческая ценность

Предыдущая версия этого файла сохранена в Git history и может использоваться для анализа того, какие задачи считались открытыми на 30 июля 2026 года. Не копируйте старые `[ ]` пункты обратно в current documentation без проверки GitHub Issues и runtime.

## Правило актуальности

Новые текущие задачи **не добавляются** в этот файл. Если проекту понадобится machine-readable backlog snapshot, он должен генерироваться из GitHub Issues и явно указывать timestamp/source revision вместо ручного дублирования backlog в Markdown.
