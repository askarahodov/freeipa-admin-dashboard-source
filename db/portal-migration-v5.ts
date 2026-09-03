import { portalLoginRateLimitsTable } from "./portal-login-rate-limit-schema.ts";

export const portalMigrationV5TableStatements = Object.freeze([
  portalLoginRateLimitsTable.sql,
]);

export const portalMigrationV5SecondaryStatements = Object.freeze([] as string[]);

export const portalMigrationV5Statements = Object.freeze([
  ...portalMigrationV5TableStatements,
  ...portalMigrationV5SecondaryStatements,
]);
