import {
  portalRestoreStageIndex,
  portalRestoreStageTable,
} from "./portal-restore-stage-schema.ts";

export const portalMigrationV2TableStatements = Object.freeze([
  portalRestoreStageTable.sql,
]) as readonly string[];

export const portalMigrationV2SecondaryStatements = Object.freeze([
  portalRestoreStageIndex.sql,
]) as readonly string[];

export const portalMigrationV2Statements = Object.freeze([
  ...portalMigrationV2TableStatements,
  ...portalMigrationV2SecondaryStatements,
]) as readonly string[];
