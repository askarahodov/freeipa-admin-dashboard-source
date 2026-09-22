export const allowedAutomationOperations = Object.freeze([
  "user_add",
  "user_mod",
  "user_password",
  "user_enable",
  "user_disable",
  "user_del",
  "group_add",
  "group_del",
  "group_add_member",
  "group_remove_member",
] as const);

export function automationOperationAllowed(value: unknown): boolean {
  return allowedAutomationOperations.includes(String(value ?? "") as typeof allowedAutomationOperations[number]);
}
