export type RouteField = {
  key: string;
  label: string;
  type: "string" | "password" | "textarea" | "boolean" | "number" | "select" | "multiselect" | "date" | "datetime" | "json";
  required?: boolean;
  target?: "params" | "input" | "workflowData";
  options?: string[];
  default?: string | number | boolean | string[];
  description?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  section?: string;
  groupPath?: string[];
  order?: number;
  visibleWhen?: {
    field: string;
    operator: "equals" | "notEquals" | "in" | "truthy" | "falsy";
    value?: string | string[];
  };
  optionsSource?: {
    endpoint: string;
    queryParam?: string;
  };
};

export type CatalogEvent = {
  id: string;
  title: string;
  description: string;
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
