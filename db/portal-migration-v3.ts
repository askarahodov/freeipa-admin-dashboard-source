import {
  portalMaintenanceStateIndex,
  portalMaintenanceStateTable,
} from "./portal-maintenance-schema.ts";

export const portalMigrationV3TableStatements = Object.freeze([
  portalMaintenanceStateTable.sql,
]);

export const portalMigrationV3SecondaryStatements = Object.freeze([
  portalMaintenanceStateIndex.sql,
]);

export const portalMigrationV3Statements = Object.freeze([
  ...portalMigrationV3TableStatements,
  ...portalMigrationV3SecondaryStatements,
]);
