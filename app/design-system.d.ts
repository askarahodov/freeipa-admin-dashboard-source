/**
 * Type definitions for the design-system.css global `ds-*` utility classes.
 * These are intentionally global (not CSS modules) so they can be applied
 * from any component via `className`.
 */

export type DsButtonVariant =
  | "ds-btn-primary"
  | "ds-btn-secondary"
  | "ds-btn-ghost"
  | "ds-btn-danger"
  | "ds-btn-icon";

export type DsButtonSize = "ds-btn-sm" | "ds-btn-lg";

export type DsInputValidation = "ds-error" | "ds-success" | "ds-warning";

export type DsBadgeTone =
  | "ds-badge-primary"
  | "ds-badge-success"
  | "ds-badge-warning"
  | "ds-badge-danger"
  | "ds-badge-neutral";

export type DsToastTone = "ds-toast-success" | "ds-toast-error" | "ds-toast-warning" | "ds-toast-info";

export type DsSkeletonVariant = "ds-skeleton" | "ds-skeleton-text" | "ds-skeleton-circle";

/** Single source of truth for the `ds-*` class names. */
export const DS_CLASSES = {
  field: "ds-field",
  fieldHelper: "ds-field-helper",
  fieldError: "ds-field-error",
  input: "ds-input",
  select: "ds-select",
  textarea: "ds-textarea",
  checkbox: "ds-checkbox",
  radio: "ds-radio",
  toggle: "ds-toggle",
  btn: "ds-btn",
  btnPrimary: "ds-btn-primary",
  btnSecondary: "ds-btn-secondary",
  btnGhost: "ds-btn-ghost",
  btnDanger: "ds-btn-danger",
  btnIcon: "ds-btn-icon",
  btnSm: "ds-btn-sm",
  btnLg: "ds-btn-lg",
  table: "ds-table",
  spinner: "ds-spinner",
  skeleton: "ds-skeleton",
  skeletonText: "ds-skeleton-text",
  skeletonCircle: "ds-skeleton-circle",
  empty: "ds-empty",
  progress: "ds-progress",
  card: "ds-card",
  cardBody: "ds-card-body",
  cardHeader: "ds-card-header",
} as const;

export type DsClassName = (typeof DS_CLASSES)[keyof typeof DS_CLASSES];
