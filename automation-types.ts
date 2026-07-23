export type FieldConditionOperator = "equals" | "notEquals" | "in" | "truthy" | "falsy";
export type FieldConditionValue = string | number | boolean | null | Array<string | number | boolean | null>;
export type FieldCondition =
  | { field: string; operator: FieldConditionOperator; value?: FieldConditionValue }
  | { all: FieldCondition[] }
  | { any: FieldCondition[] }
  | { not: FieldCondition };

export type RouteField = {
  key: string;
  label: string;
  type: "string" | "email" | "url" | "password" | "textarea" | "boolean" | "number" | "select" | "multiselect" | "date" | "datetime" | "json";
  required?: boolean;
  target?: "params" | "input" | "workflowData";
  options?: string[];
  default?: string | number | boolean | string[];
  description?: string;
  placeholder?: string;
  pattern?: string;
  readOnly?: boolean;
  min?: number;
  max?: number;
  section?: string;
  groupPath?: string[];
  order?: number;
  visibleWhen?: FieldCondition;
  optionsSource?: {
    endpoint: string;
    queryParam?: string;
  };
};

export type CatalogEvent = {
  id: string;
  title: string;
  description: string;
  operation?: string;
  kind: "event" | "workflow";
  enabled: boolean;
  category: string;
  plugin: string | null;
  fields: RouteField[];
  targets: string[];
  dangerous: boolean;
  schemaVersion?: string;
};

export type AutomationRoute = {
  key: string;
  title: string;
  operation: string;
  kind: "event" | "workflow";
  eventId: string;
  schemaVersion?: string;
  enabled?: boolean;
  targets?: string[];
  fields?: RouteField[];
};
