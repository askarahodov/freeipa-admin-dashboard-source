import type { FieldCondition, FieldConditionOperator, FieldConditionValue } from "./automation-types";

const MAX_CONDITION_DEPTH = 8;
const MAX_CONDITION_CHILDREN = 50;

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizedOperator(value: unknown): FieldConditionOperator | null {
  const operator = String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (["equals", "equal", "eq", "==", "==="].includes(operator)) return "equals";
  if (["notequals", "notequal", "neq", "!=", "!=="].includes(operator)) return "notEquals";
  if (["in", "oneof", "includes", "containsany"].includes(operator)) return "in";
  if (["truthy", "true", "isset", "present"].includes(operator)) return "truthy";
  if (["falsy", "false", "empty", "notset", "absent"].includes(operator)) return "falsy";
  return null;
}

function normalizedValue(value: unknown): FieldConditionValue | undefined {
  if (Array.isArray(value)) {
    const values = value
      .filter((item): item is string | number | boolean | null => item === null || ["string", "number", "boolean"].includes(typeof item))
      .slice(0, 100);
    return values.length ? values : undefined;
  }
  return value === null || ["string", "number", "boolean"].includes(typeof value)
    ? value as string | number | boolean | null
    : undefined;
}

function normalizedChildren(value: unknown, depth: number): FieldCondition[] {
  const source = Array.isArray(value) ? value : [value];
  return source.slice(0, MAX_CONDITION_CHILDREN)
    .map((item) => normalizeFieldCondition(item, depth + 1))
    .filter((item): item is FieldCondition => Boolean(item));
}

export function normalizeFieldCondition(raw: unknown, depth = 0): FieldCondition | undefined {
  if (depth >= MAX_CONDITION_DEPTH) return undefined;
  if (Array.isArray(raw)) {
    const all = normalizedChildren(raw, depth);
    return all.length ? { all } : undefined;
  }

  const source = recordValue(raw);
  if (!source) return undefined;
  const combinator = String(source.combinator ?? source.logic ?? source.operator ?? "")
    .trim().toLowerCase().replace(/[\s_-]+/g, "");

  const notSource = source.not ?? (combinator === "not" ? source.condition ?? source.conditions ?? source.children ?? source.rules : undefined);
  if (notSource !== undefined) {
    const not = normalizeFieldCondition(notSource, depth + 1);
    return not ? { not } : undefined;
  }

  const allSource = source.all ?? source.and ?? source.every
    ?? (combinator === "and" || combinator === "all" ? source.conditions ?? source.children ?? source.rules : undefined);
  if (allSource !== undefined) {
    const all = normalizedChildren(allSource, depth);
    return all.length ? { all } : undefined;
  }

  const anySource = source.any ?? source.or ?? source.some
    ?? (combinator === "or" || combinator === "any" ? source.conditions ?? source.children ?? source.rules : undefined);
  if (anySource !== undefined) {
    const any = normalizedChildren(anySource, depth);
    return any.length ? { any } : undefined;
  }

  if (Array.isArray(source.conditions) || Array.isArray(source.children) || Array.isArray(source.rules)) {
    const all = normalizedChildren(source.conditions ?? source.children ?? source.rules, depth);
    return all.length ? { all } : undefined;
  }

  const field = String(source.field ?? source.key ?? source.dependsOn ?? source.depends_on ?? "").trim().slice(0, 120);
  if (!field) return undefined;
  const operator = normalizedOperator(source.operator ?? (source.equals !== undefined ? "equals" : "truthy")) ?? "equals";
  const value = normalizedValue(source.value ?? source.equals ?? source.values);
  return value === undefined ? { field, operator } : { field, operator, value };
}

function truthyValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return Boolean(normalized) && !["false", "0", "off", "no", "null", "undefined"].includes(normalized);
  }
  return Boolean(value);
}

function scalarValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function predicateMatches(condition: Extract<FieldCondition, { field: string }>, values: Record<string, unknown>): boolean {
  const current = values[condition.field];
  if (condition.operator === "truthy") return truthyValue(current);
  if (condition.operator === "falsy") return !truthyValue(current);

  const actual = Array.isArray(current) ? current.map(scalarValue) : scalarValue(current);
  const expected = Array.isArray(condition.value) ? condition.value.map(scalarValue) : scalarValue(condition.value);

  if (condition.operator === "in") {
    const expectedValues = Array.isArray(expected) ? expected : [expected];
    return Array.isArray(actual)
      ? actual.some((value) => expectedValues.includes(value))
      : expectedValues.includes(actual);
  }

  const equal = Array.isArray(actual)
    ? Array.isArray(expected)
      ? actual.length === expected.length && actual.every((value, index) => value === expected[index])
      : actual.includes(expected)
    : Array.isArray(expected)
      ? expected.includes(actual)
      : actual === expected;
  return condition.operator === "notEquals" ? !equal : equal;
}

export function fieldConditionMatches(condition: FieldCondition | undefined, values: Record<string, unknown>): boolean {
  if (!condition) return true;
  if ("all" in condition) return condition.all.every((item) => fieldConditionMatches(item, values));
  if ("any" in condition) return condition.any.some((item) => fieldConditionMatches(item, values));
  if ("not" in condition) return !fieldConditionMatches(condition.not, values);
  return predicateMatches(condition, values);
}

export function conditionFieldNames(condition: FieldCondition | undefined): string[] {
  if (!condition) return [];
  if ("field" in condition) return [condition.field];
  const nested = "all" in condition ? condition.all : "any" in condition ? condition.any : [condition.not];
  return Array.from(new Set(nested.flatMap(conditionFieldNames))).slice(0, 50);
}
