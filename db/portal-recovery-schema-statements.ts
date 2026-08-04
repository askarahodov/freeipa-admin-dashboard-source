import { portalSchemaTriggers } from "./portal-schema.ts";

function quoteCanonicalIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw new Error("Canonical recovery schema identifier is invalid");
  }
  return `"${value}"`;
}

export const portalRecoveryDropAuditTriggerStatements = Object.freeze(
  portalSchemaTriggers.map((trigger) => `DROP TRIGGER IF EXISTS ${quoteCanonicalIdentifier(trigger.name)};`),
) as readonly string[];

export const portalRecoveryCreateAuditTriggerStatements = Object.freeze(
  portalSchemaTriggers.map((trigger) => `${trigger.sql};`),
) as readonly string[];
