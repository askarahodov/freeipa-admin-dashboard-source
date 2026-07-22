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
};

export type AutomationRoute = {
  key: string;
  title: string;
  operation: string;
  kind: "event" | "workflow";
  eventId: string;
  enabled?: boolean;
  targets?: string[];
  fields?: RouteField[];
};
