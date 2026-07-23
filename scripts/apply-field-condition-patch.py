from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"Patch anchor not found in {path}: {old[:100]!r}")
    path.write_text(text.replace(old, new, 1))


worker = Path("worker/index.ts")
replace_once(
    worker,
    'import type { AutomationRoute, CatalogEvent, RouteField } from "../automation-types";\n',
    'import type { AutomationRoute, CatalogEvent, RouteField } from "../automation-types";\n'
    'import { fieldConditionMatches, normalizeFieldCondition } from "../field-conditions";\n',
)
replace_once(
    worker,
    '''function fieldCondition(source: Record<string, unknown>): RouteField["visibleWhen"] {\n  const raw = source.visibleWhen ?? source.visible_when ?? source.show_when ?? source.condition ?? source.depends_on;\n  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;\n  const condition = raw as Record<string, unknown>;\n  const field = String(condition.field ?? condition.key ?? condition.dependsOn ?? "").trim().slice(0, 120);\n  if (!field) return undefined;\n  const rawOperator = String(condition.operator ?? (condition.equals !== undefined ? "equals" : "truthy"));\n  const operator: NonNullable<RouteField["visibleWhen"]>["operator"] = ["equals", "notEquals", "in", "truthy", "falsy"].includes(rawOperator) ? rawOperator as NonNullable<RouteField["visibleWhen"]>["operator"] : "equals";\n  const rawValue = condition.value ?? condition.equals ?? condition.values;\n  const value = Array.isArray(rawValue) ? rawValue.map(String).slice(0, 100) : rawValue === undefined ? undefined : String(rawValue);\n  return { field, operator, value };\n}\n''',
    '''function fieldCondition(source: Record<string, unknown>): RouteField["visibleWhen"] {\n  return normalizeFieldCondition(source.visibleWhen ?? source.visible_when ?? source.show_when ?? source.condition ?? source.depends_on);\n}\n''',
)
replace_once(
    worker,
    '''function fieldVisible(field: RouteField, values: Record<string, unknown>): boolean {\n  const condition = field.visibleWhen;\n  if (!condition) return true;\n  const current = values[condition.field];\n  const truthy = current === true || current === "true" || current === "1" || current === "on" || Array.isArray(current) && current.length > 0 || typeof current === "string" && current.trim().length > 0;\n  if (condition.operator === "truthy") return truthy;\n  if (condition.operator === "falsy") return !truthy;\n  const actual = Array.isArray(current) ? current.map(String) : String(current ?? "");\n  const expected = Array.isArray(condition.value) ? condition.value.map(String) : String(condition.value ?? "");\n  if (condition.operator === "in") return Array.isArray(expected) && (Array.isArray(actual) ? actual.some((value) => expected.includes(value)) : expected.includes(actual));\n  const equal = Array.isArray(actual) ? actual.includes(String(expected)) : actual === expected;\n  return condition.operator === "notEquals" ? !equal : equal;\n}\n''',
    '''function fieldVisible(field: RouteField, values: Record<string, unknown>): boolean {\n  return fieldConditionMatches(field.visibleWhen, values);\n}\n''',
)

page = Path("app/page.tsx")
replace_once(
    page,
    'import type { AutomationRoute as SourceAutomationRoute, CatalogEvent, RouteField } from "../automation-types";\n',
    'import type { AutomationRoute as SourceAutomationRoute, CatalogEvent, RouteField } from "../automation-types";\n'
    'import { conditionFieldNames, fieldConditionMatches } from "../field-conditions";\n',
)
text = page.read_text()
old_summary = '${field.visibleWhen ? ` · ${field.visibleWhen.field}` : ""}'
new_summary = '${field.visibleWhen ? ` · ${conditionFieldNames(field.visibleWhen).join(", ")}` : ""}'
if old_summary in text:
    page.write_text(text.replace(old_summary, new_summary, 1))
elif new_summary not in text:
    raise SystemExit("Condition summary anchor not found in app/page.tsx")
replace_once(
    page,
    '''function conditionMatches(field: RouteField, values: Record<string, unknown>) {\n  const condition = field.visibleWhen;\n  if (!condition) return true;\n  const current = values[condition.field];\n  const truthy = current === true || current === "true" || current === "1" || current === "on" || Array.isArray(current) && current.length > 0 || typeof current === "string" && current.trim().length > 0;\n  if (condition.operator === "truthy") return truthy;\n  if (condition.operator === "falsy") return !truthy;\n  const expected = Array.isArray(condition.value) ? condition.value.map(String) : String(condition.value ?? "");\n  const actual = Array.isArray(current) ? current.map(String) : String(current ?? "");\n  if (condition.operator === "in") return Array.isArray(expected) && (Array.isArray(actual) ? actual.some((value) => expected.includes(value)) : expected.includes(actual));\n  const equal = Array.isArray(actual) ? actual.includes(String(expected)) : actual === expected;\n  return condition.operator === "notEquals" ? !equal : equal;\n}\n''',
    '''function conditionMatches(field: RouteField, values: Record<string, unknown>) {\n  return fieldConditionMatches(field.visibleWhen, values);\n}\n''',
)

Path(__file__).unlink()
